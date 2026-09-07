import * as THREE from 'three';
import { MACHINE, STATIONS } from '../Config.ts';
import { C } from '../Palette.ts';
import { at, cyl } from '../procgen/Primitives.ts';
import { BELT_Y, makeBottle, makeConveyor, makeJuicer } from '../procgen/Machines.ts';
import { RACK_CAPACITY, makeBottleRack, makeRackStandFrame } from '../procgen/Containers.ts';
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
    /** Position along the stand, 0..STAND_SLOTS-1. */
    index: number;
}

/** How many racks the stand holds before the juicer has to stall. */
const STAND_SLOTS = 3;

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
    private _working = false;
    private _wheelSpin = 0;

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
    get rackCapacity(): number { return STAND_SLOTS * RACK_CAPACITY; }

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

    /** True while there's somewhere for the next bottle to go. */
    get hasRoom(): boolean {
        const racked = this.rackCount + this._beltBottles.length;
        return racked < STAND_SLOTS * RACK_CAPACITY;
    }

    /** Called when a character tips a carrot into the hopper. */
    acceptCarrot(): boolean {
        if (!this.hasRoom) return false;
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
        let best = -1;
        for (let i = 0; i < this._racks.length; i++) {
            if (this._racks[i].bottles.length === 0) continue;
            if (best < 0 || this._racks[i].bottles.length > this._racks[best].bottles.length) best = i;
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
        const canWork = this._state.carrotsQueued > 0 && this.hasRoom;
        this._working = canWork;
        this._pour.visible = canWork;

        if (!canWork) {
            this._processTimer = 0;
            return;
        }

        this._processTimer += dt;
        if (this._processTimer < MACHINE.processTime) return;
        this._processTimer -= MACHINE.processTime;

        this._state.carrotsQueued--;
        this._spawnBeltBottle();
    }

    private _spawnBeltBottle(): void {
        const obj = this._pool.pop() ?? makeBottle();
        obj.visible = true;
        obj.scale.setScalar(1);
        obj.position.set(STATIONS.conveyor.x0, BELT_Y + 0.07, STATIONS.conveyor.z);
        this.group.add(obj);
        this._beltBottles.push({ obj, t: 0 });
    }

    private _updateBelt(dt: number): void {
        const { x0, x1, z } = STATIONS.conveyor;
        for (let i = this._beltBottles.length - 1; i >= 0; i--) {
            const b = this._beltBottles[i];
            b.t += dt / MACHINE.beltTime;

            if (b.t >= 1) {
                this._beltBottles.splice(i, 1);
                this._parkInRack(b.obj);
                continue;
            }
            b.obj.position.set(x0 + (x1 - x0) * b.t, BELT_Y + 0.07, z);
            // A little wobble, as if the belt is rumbling.
            b.obj.rotation.z = Math.sin(b.t * 30) * 0.05;
        }
    }

    /** Files a finished bottle into the first rack on the stand with room. */
    private _parkInRack(obj: THREE.Group): void {
        const rack = this._openRack();
        if (!rack) {
            // Stand filled while this one was in transit — recycle rather than clip.
            this.group.remove(obj);
            this._recycle(obj);
            return;
        }
        const slot = rack.slots[rack.bottles.length];
        obj.position.copy(slot);
        obj.rotation.set(0, 0, 0);
        obj.scale.setScalar(0.78);
        this.group.remove(obj);
        rack.group.add(obj);
        rack.bottles.push(obj);
        this._state.bottlesStocked = this.rackCount;
    }

    /** The first rack with a free slot, opening a new one on the stand if needed. */
    private _openRack(): StandRack | null {
        for (const r of this._racks) {
            if (r.bottles.length < r.slots.length) return r;
        }
        if (this._racks.length >= STAND_SLOTS) return null;

        const used = new Set(this._racks.map(r => r.index));
        let index = 0;
        while (used.has(index) && index < STAND_SLOTS) index++;

        const built = this._rackPool.pop() ?? makeBottleRack();
        built.group.visible = true;
        built.group.position.set(
            this._rackOrigin.x + (index - (STAND_SLOTS - 1) / 2) * 1.35,
            0.92,
            this._rackOrigin.z,
        );
        this.group.add(built.group);

        const rack: StandRack = { group: built.group, slots: built.slots, bottles: [], index };
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
