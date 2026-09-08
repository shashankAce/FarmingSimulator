import * as THREE from 'three';
import { MACHINE, STATIONS } from '../Config.ts';
import { C } from '../Palette.ts';
import { at, cyl } from '../procgen/Primitives.ts';
import { BELT_Y, makeBottle, makeConveyor, makeJuicer } from '../procgen/Machines.ts';
import {
    CONTENT_SCALE, CRATE_PITCH, CRATE_SCALE, LOOSE_BOTTLE_SCALE, RACK_CAPACITY,
    makeBottleRack, makeRackStandFrame,
} from '../procgen/Containers.ts';
import type { GameState } from '../GameState.ts';

interface BeltBottle {
    obj: THREE.Group;
    /** 0 at the juicer end, 1 at the rack end. */
    t: number;
}

/** One rack sitting on the stand, filling up or waiting to be carried off. */
interface StandRack {
    group: THREE.Group;
    slots: THREE.Vector3[];
    bottles: THREE.Group[];
    /** Position along the stand, 0..rackStandSlots-1. */
    index: number;
    /** Height within that position's stack, 0 = on the trestle. */
    level: number;
}

const STAND_SLOTS = MACHINE.rackStandSlots;
const STACK_LIMIT = MACHINE.rackStackLimit;
/** Trestle surface the bottom crate of each stack rests on. */
const TRESTLE_Y = 0.93;
/** Spacing between stand positions, matched to the shared crate scale. */
const SLOT_PITCH = 1.35 * CRATE_SCALE;

/**
 * The juicer → conveyor → rack chain.
 *
 * Carrots dropped into the hopper become bottles at a fixed rate; each bottle
 * rides the belt and then parks in a rack slot until somebody carries it away.
 * The rack's slot count is the chain's back-pressure: fill it and the juicer
 * stalls rather than silently dropping product.
 */
export class Production {
    readonly group = new THREE.Group();

    private _state: GameState;
    private _wheel: THREE.Mesh;
    private _funnel: THREE.Group;
    private _rollers: THREE.Mesh[];
    private _pour: THREE.Mesh;

    private _beltBottles: BeltBottle[] = [];
    private _racks: StandRack[] = [];
    private _rackOrigin = new THREE.Vector3();

    private _pool: THREE.Group[] = [];
    private _rackPool: Array<{ group: THREE.Group; slots: THREE.Vector3[] }> = [];
    private _processTimer = 0;
    /**
     * Seconds per bottle. Mutable because the juicer speed upgrade rewrites it —
     * `MACHINE.processTime` is only the starting value.
     */
    processTime = MACHINE.processTime;
    private _working = false;
    private _wheelSpin = 0;
    private _produced = 0;

    constructor(state: GameState) {
        this._state = state;

        // ── Juicer ──
        const juicer = makeJuicer();
        at(juicer.group, STATIONS.juicer.x, 0, STATIONS.juicer.z);
        this._wheel = juicer.wheel;
        this._funnel = juicer.funnel;
        this.group.add(juicer.group);

        // Juice stream from the spout down onto the belt head — shown only while working.
        // Sits over the head of the belt, so the stream lands where bottles appear.
        this._pour = at(
            cyl(0.09, 0.09, 0.75, 6, C.JUICE, { emissive: 0x552b00 }),
            STATIONS.conveyor.x0, BELT_Y + 0.6, STATIONS.conveyor.z,
        );
        this._pour.visible = false;
        this.group.add(this._pour);

        // ── Conveyor ──
        const belt = makeConveyor(STATIONS.conveyor.x0, STATIONS.conveyor.x1);
        at(belt.group, 0, 0, STATIONS.conveyor.z);
        this._rollers = belt.rollers;
        this.group.add(belt.group);

        // ── Rack stand ──
        this._rackOrigin.set(STATIONS.racks.x, 0, STATIONS.racks.z);
        const trestle = makeRackStandFrame();
        at(trestle, this._rackOrigin.x, 0, this._rackOrigin.z);
        this.group.add(trestle);

        this.group.traverse(o => {
            if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
    }

    /** Total bottle capacity of the stand, for the HUD readout. */
    get rackCapacity(): number { return STAND_SLOTS * STACK_LIMIT * RACK_CAPACITY; }

    /** Bottles currently racked, across every rack on the stand. */
    get rackCount(): number {
        let n = 0;
        for (const r of this._racks) n += r.bottles.length;
        return n;
    }

    /** Racks with at least one bottle in them — what the player can carry off. */
    get readyRackCount(): number {
        let n = 0;
        for (const r of this._racks) if (r.bottles.length > 0) n++;
        return n;
    }

    get isWorking(): boolean { return this._working; }

    /** DEBUG: bottles currently riding the belt. */
    get __beltCount(): number { return this._beltBottles.length; }

    /** Lifetime bottles pressed, for throughput checks. */
    get totalProduced(): number { return this._produced; }

    /**
     * True while there's clearance at the head of the belt for another bottle.
     *
     * Deliberately does NOT consider rack space. Counting in-transit bottles
     * against rack capacity throttled the juicer to a 58% duty cycle at the
     * fastest tier: the belt holds ~10 bottles, which ate most of an 18-bottle
     * buffer and stalled production while the racks still had room. The belt is
     * its own buffer, and it backs up when the stand is full.
     */
    get hasRoom(): boolean {
        const last = this._beltBottles[this._beltBottles.length - 1];
        return !last || last.t > this._gapT;
    }

    /** Minimum spacing between belt bottles, as a fraction of belt length. */
    private get _gapT(): number {
        const len = Math.abs(STATIONS.conveyor.x1 - STATIONS.conveyor.x0);
        return len > 0 ? MACHINE.beltGap / len : 0.1;
    }

    /** True when the belt is backed up solid against a full stand. */
    get isJammed(): boolean {
        return !this.hasRoom && !this._hasRackSpace();
    }

    /** True once the hopper is holding everything it can take. */
    get hopperFull(): boolean {
        return this._state.carrotsQueued >= MACHINE.hopperCapacity;
    }

    /**
     * Called when a character tips a carrot into the hopper. Refuses a full one.
     *
     * A hard cap is only safe because the player can set a load down (see
     * `DropButton`). Without that, refusing here ends the run: a load is one
     * kind at a time, so somebody holding carrots with both a full hopper AND a
     * full rack stand could neither tip them nor lift a rack, and lifting a
     * rack is the only thing that clears the jam. Belt bottles stop dead at a
     * full stand, so nothing drains on its own.
     */
    acceptCarrot(): boolean {
        if (this.hopperFull) return false;

        this._state.carrotsQueued++;
        // Bounce the funnel so the drop registers visually.
        this._funnel.scale.set(1.16, 0.86, 1.16);
        return true;
    }

    /**
     * Lifts the fullest rack off the stand and reports how many bottles it held.
     * The caller materialises its own crate (see `CarryLoad.adoptFilled`) rather
     * than us re-parenting this one — a stand rack and a carried rack have
     * different lifetimes and pools.
     *
     * Partially filled racks count: blocking pickup until a rack is completely
     * full would stall the player behind the juicer for no good reason.
     */
    takeRack(): number {
        // Only whatever is on TOP of each stack can be lifted off.
        const topLevel = new Array<number>(STAND_SLOTS).fill(-1);
        for (const r of this._racks) topLevel[r.index] = Math.max(topLevel[r.index], r.level);

        let best = -1;
        for (let i = 0; i < this._racks.length; i++) {
            const r = this._racks[i];
            if (r.bottles.length === 0) continue;
            if (r.level !== topLevel[r.index]) continue;
            if (best < 0 || r.bottles.length > this._racks[best].bottles.length) best = i;
        }
        if (best < 0) return 0;

        const [rack] = this._racks.splice(best, 1);
        const count = rack.bottles.length;
        this._retireRack(rack);
        this._state.bottlesStocked = this.rackCount;
        return count;
    }

    update(dt: number): void {
        this._updateProcessing(dt);
        this._updateBelt(dt);
        this._updateMachineMotion(dt);
    }

    // ─────────────────────────────────────────────────────────────────────────

    private _updateProcessing(dt: number): void {
        const hasInput = this._state.carrotsQueued > 0;

        // "Working" means genuinely producing. It must NOT go false during the
        // fraction of a second after each bottle while the belt head clears, or
        // the machine visibly flickers between every single bottle.
        this._working = hasInput && !this.isJammed;
        this._pour.visible = this._working;

        if (!hasInput) {
            this._processTimer = 0;
            return;
        }

        this._processTimer += dt;
        if (this._processTimer < this.processTime) return;

        // Bottle is ready but the belt head is still occupied: HOLD it rather
        // than discarding the progress. Resetting the timer here is what turned
        // a brief spacing wait into a lost production cycle.
        if (!this.hasRoom) return;

        this._processTimer -= this.processTime;
        this._state.carrotsQueued--;
        this._spawnBeltBottle();
    }

    private _spawnBeltBottle(): void {
        this._produced++;
        const obj = this._pool.pop() ?? makeBottle();
        obj.visible = true;
        // Same on-screen size as one sitting in a crate, so a bottle doesn't
        // appear to shrink the moment it's racked.
        obj.scale.setScalar(LOOSE_BOTTLE_SCALE);
        obj.position.set(STATIONS.conveyor.x0, BELT_Y + 0.07, STATIONS.conveyor.z);
        this.group.add(obj);
        this._beltBottles.push({ obj, t: 0 });
    }

    /**
     * Advances the belt. Bottles queue behind one another and the head bottle
     * only leaves when a rack can take it, so a full stand backs the belt up
     * rather than stopping the machine.
     *
     * `_beltBottles[0]` is the oldest, i.e. the one furthest along.
     */
    private _updateBelt(dt: number): void {
        const { x0, x1, z } = STATIONS.conveyor;
        const gap = this._gapT;

        let limit = 1;
        for (const b of this._beltBottles) {
            const want = b.t + dt / MACHINE.beltTime;
            const next = Math.min(want, limit);
            // Only wobble while actually moving; a queued bottle should sit still.
            b.obj.rotation.z = next < want ? 0 : Math.sin(next * 30) * 0.05;
            b.t = next;
            b.obj.position.set(x0 + (x1 - x0) * b.t, BELT_Y + 0.07, z);
            limit = b.t - gap;
        }

        const head = this._beltBottles[0];
        if (!head || head.t < 1 - 1e-4) return;

        const rack = this._openRack();
        if (!rack) return;                 // stand full — the head waits on the belt
        this._beltBottles.shift();
        this._placeInRack(rack, head.obj);
    }

    /** Files a finished bottle into a rack slot. */
    private _placeInRack(rack: StandRack, obj: THREE.Group): void {
        const slot = rack.slots[rack.bottles.length];
        obj.position.copy(slot);
        obj.rotation.set(0, 0, 0);
        obj.scale.setScalar(CONTENT_SCALE.bottle);
        this.group.remove(obj);
        rack.group.add(obj);
        rack.bottles.push(obj);
        this._state.bottlesStocked = this.rackCount;
    }

    /** Whether any rack could accept another bottle right now. */
    private _hasRackSpace(): boolean {
        for (const r of this._racks) if (r.bottles.length < r.slots.length) return true;
        const depth = new Array<number>(STAND_SLOTS).fill(0);
        for (const r of this._racks) depth[r.index]++;
        return depth.some(d => d < STACK_LIMIT);
    }

    /**
     * The first rack with a free bottle slot, opening a new crate if needed.
     * New crates spread across the stand's positions before stacking upward, so
     * the stand fills left-to-right rather than growing one tall tower.
     */
    private _openRack(): StandRack | null {
        for (const r of this._racks) {
            if (r.bottles.length < r.slots.length) return r;
        }

        // Depth of each position's stack; pick the shallowest with room.
        const depth = new Array<number>(STAND_SLOTS).fill(0);
        for (const r of this._racks) depth[r.index]++;

        let index = -1;
        for (let i = 0; i < STAND_SLOTS; i++) {
            if (depth[i] >= STACK_LIMIT) continue;
            if (index < 0 || depth[i] < depth[index]) index = i;
        }
        if (index < 0) return null;

        const level = depth[index];
        const built = this._rackPool.pop() ?? makeBottleRack();
        built.group.visible = true;
        built.group.scale.setScalar(CRATE_SCALE);
        built.group.position.set(
            this._rackOrigin.x + (index - (STAND_SLOTS - 1) / 2) * SLOT_PITCH,
            TRESTLE_Y + level * CRATE_PITCH.bottle * CRATE_SCALE,
            this._rackOrigin.z,
        );
        this.group.add(built.group);

        const rack: StandRack = { group: built.group, slots: built.slots, bottles: [], index, level };
        this._racks.push(rack);
        return rack;
    }

    private _retireRack(rack: StandRack): void {
        for (const b of rack.bottles) {
            rack.group.remove(b);
            this._recycle(b);
        }
        rack.bottles.length = 0;
        this.group.remove(rack.group);
        rack.group.visible = false;
        rack.group.scale.setScalar(1);
        this._rackPool.push({ group: rack.group, slots: rack.slots });
    }

    private _recycle(obj: THREE.Group): void {
        obj.visible = false;
        obj.rotation.set(0, 0, 0);
        obj.scale.setScalar(1);
        this._pool.push(obj);
    }

    private _updateMachineMotion(dt: number): void {
        if (this._working) {
            // Negative: the belt runs toward -X, and the flywheel has to turn
            // with it. It was previously spinning against the product.
            this._wheelSpin -= dt * 7;
            this._wheel.rotation.y = this._wheelSpin;
            for (const r of this._rollers) r.rotation.y -= dt * 9;
            // Pulse the juice stream so it reads as flowing, not as a static rod.
            const s = 1 + Math.sin(this._wheelSpin * 4) * 0.14;
            this._pour.scale.set(s, 1, s);
        }
        // Ease the funnel back after an intake bounce.
        this._funnel.scale.lerp(UNIT, Math.min(1, dt * 8));
    }
}

const UNIT = new THREE.Vector3(1, 1, 1);
