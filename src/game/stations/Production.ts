import * as THREE from 'three';
import { MACHINE, STATIONS } from '../Config.ts';
import { C } from '../Palette.ts';
import { at, cyl } from '../procgen/Primitives.ts';
import { BELT_Y, makeBottle, makeConveyor, makeJuicer, makeRack } from '../procgen/Machines.ts';
import type { GameState } from '../GameState.ts';

interface BeltBottle {
    obj: THREE.Group;
    /** 0 at the juicer end, 1 at the rack end. */
    t: number;
}

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
    private _rackBottles: THREE.Group[] = [];
    private _rackSlots: THREE.Vector3[] = [];
    private _rackOrigin = new THREE.Vector3();

    private _pool: THREE.Group[] = [];
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

        // ── Rack ──
        const rack = makeRack();
        this._rackOrigin.set(STATIONS.racks.x, 0, STATIONS.racks.z);
        at(rack.group, this._rackOrigin.x, 0, this._rackOrigin.z);
        this._rackSlots = rack.slots;
        this.group.add(rack.group);

        this.group.traverse(o => {
            if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
    }

    get rackCapacity(): number { return Math.min(MACHINE.rackCapacity, this._rackSlots.length); }
    get rackCount(): number { return this._rackBottles.length; }
    get isWorking(): boolean { return this._working; }

    /** True when the racks have room — the juicer stalls when they don't. */
    get hasRoom(): boolean {
        return this._rackBottles.length + this._beltBottles.length < this.rackCapacity;
    }

    /** Called when a character tips a carrot into the hopper. */
    acceptCarrot(): boolean {
        if (!this.hasRoom) return false;
        this._state.carrotsQueued++;
        // Bounce the funnel so the drop registers visually.
        this._funnel.scale.set(1.16, 0.86, 1.16);
        return true;
    }

    /** Removes one finished bottle from the racks, if any. */
    takeBottle(): boolean {
        const b = this._rackBottles.pop();
        if (!b) return false;
        this.group.remove(b);
        this._recycle(b);
        this._state.bottlesStocked = this._rackBottles.length;
        return true;
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

    private _parkInRack(obj: THREE.Group): void {
        if (this._rackBottles.length >= this.rackCapacity) {
            // Racks filled while this one was in transit — recycle rather than clip.
            this.group.remove(obj);
            this._recycle(obj);
            return;
        }
        const slot = this._rackSlots[this._rackBottles.length];
        obj.position.set(this._rackOrigin.x + slot.x, slot.y, this._rackOrigin.z + slot.z);
        obj.rotation.set(0, 0, 0);
        obj.scale.setScalar(0.85);
        this._rackBottles.push(obj);
        this._state.bottlesStocked = this._rackBottles.length;
    }

    private _recycle(obj: THREE.Group): void {
        obj.visible = false;
        obj.rotation.set(0, 0, 0);
        obj.scale.setScalar(1);
        this._pool.push(obj);
    }

    private _updateMachineMotion(dt: number): void {
        if (this._working) {
            this._wheelSpin += dt * 7;
            this._wheel.rotation.y = this._wheelSpin;
            for (const r of this._rollers) r.rotation.y += dt * 9;
            // Pulse the juice stream so it reads as flowing, not as a static rod.
            const s = 1 + Math.sin(this._wheelSpin * 4) * 0.14;
            this._pour.scale.set(s, 1, s);
        }
        // Ease the funnel back after an intake bounce.
        this._funnel.scale.lerp(UNIT, Math.min(1, dt * 8));
    }
}

const UNIT = new THREE.Vector3(1, 1, 1);
