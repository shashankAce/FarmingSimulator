import * as THREE from 'three';
import { RACK_CAPACITY, makeBottleRack } from '../procgen/Containers.ts';
import { makeBottle } from '../procgen/Machines.ts';

interface GroundRack {
    group: THREE.Group;
    slots: THREE.Vector3[];
    bottles: THREE.Group[];
}

/**
 * The racks a seller sets down beside a stall.
 *
 * Stock is dropped, not held: the player walks up, puts the crates down, and
 * serves from them. That's why selling reads from here rather than from the
 * carrier's arms — and why walking away leaves the stock behind rather than
 * taking it with you.
 */
export class ShopStock {
    readonly group = new THREE.Group();

    private _racks: GroundRack[] = [];
    private _maxRacks: number;
    private _origin: { x: number; z: number };
    private _yaw: number;
    private _pool: Array<{ group: THREE.Group; slots: THREE.Vector3[] }> = [];
    private _bottlePool: THREE.Group[] = [];
    private _spring: Array<{ g: THREE.Group; t: number }> = [];

    constructor(origin: { x: number; z: number }, yaw: number, maxRacks = 3) {
        this._origin = origin;
        this._yaw = yaw;
        this._maxRacks = maxRacks;
    }

    get crateCount(): number { return this._racks.length; }

    get bottles(): number {
        let n = 0;
        for (const r of this._racks) n += r.bottles.length;
        return n;
    }

    get hasRoom(): boolean { return this._racks.length < this._maxRacks; }

    /** Sets a filled rack down in the next free spot. */
    addCrate(count: number): boolean {
        if (!this.hasRoom || count <= 0) return false;

        const built = this._pool.pop() ?? makeBottleRack();
        built.group.visible = true;
        built.group.scale.setScalar(0.01);

        // Racks line up alongside each other, angled with the stall.
        const index = this._racks.length;
        const offset = (index - (this._maxRacks - 1) / 2) * 1.45;
        built.group.position.set(
            this._origin.x + Math.cos(this._yaw) * offset,
            0,
            this._origin.z - Math.sin(this._yaw) * offset,
        );
        built.group.rotation.y = this._yaw;
        this.group.add(built.group);

        const rack: GroundRack = { group: built.group, slots: built.slots, bottles: [] };
        for (let i = 0; i < Math.min(count, RACK_CAPACITY); i++) {
            const b = this._bottlePool.pop() ?? makeBottle();
            b.visible = true;
            b.position.copy(rack.slots[i]);
            b.scale.setScalar(0.78);
            rack.group.add(b);
            rack.bottles.push(b);
        }

        this._racks.push(rack);
        this._spring.push({ g: built.group, t: 0 });
        return true;
    }

    /**
     * Removes one bottle, emptying the frontmost rack first. A rack that runs
     * out is discarded outright — same rule as a carried one.
     */
    takeBottle(): boolean {
        const rack = this._racks[0];
        if (!rack || rack.bottles.length === 0) return false;

        const b = rack.bottles.pop()!;
        rack.group.remove(b);
        b.visible = false;
        this._bottlePool.push(b);

        if (rack.bottles.length === 0) {
            this._racks.shift();
            this.group.remove(rack.group);
            rack.group.visible = false;
            this._pool.push({ group: rack.group, slots: rack.slots });
            this._relayout();
        }
        return true;
    }

    update(dt: number): void {
        for (let i = this._spring.length - 1; i >= 0; i--) {
            const s = this._spring[i];
            s.t = Math.min(1, s.t + dt * 7);
            const p = s.t;
            s.g.scale.setScalar(Math.max(0.01, 1 + 2.0 * Math.pow(p - 1, 3) + 1.1 * Math.pow(p - 1, 2)));
            if (s.t >= 1) { s.g.scale.setScalar(1); this._spring.splice(i, 1); }
        }
    }

    /** Shuffles the remaining racks up after one is emptied. */
    private _relayout(): void {
        for (let i = 0; i < this._racks.length; i++) {
            const offset = (i - (this._maxRacks - 1) / 2) * 1.45;
            this._racks[i].group.position.set(
                this._origin.x + Math.cos(this._yaw) * offset,
                0,
                this._origin.z - Math.sin(this._yaw) * offset,
            );
        }
    }
}
