import * as THREE from 'three';
import { CONTENT_SCALE, CRATE_PITCH, CRATE_SCALE, RACK_CAPACITY, makeBottleRack } from '../procgen/Containers.ts';
import { makeBottle } from '../procgen/Machines.ts';

/** Flight speed and hop height of a crate tossed onto a counter. */
const FLIGHT_RATE = 2.6;
const FLIGHT_ARC = 0.9;

interface GroundRack {
    group: THREE.Group;
    slots: THREE.Vector3[];
    bottles: THREE.Group[];
}

/**
 * The racks a seller stacks on a stall's counter.
 *
 * Stock is set down, not held: the player walks up, puts the crates on the
 * counter, and serves from them. That's why selling reads from here rather than
 * from the carrier's arms — and why walking away leaves the stock behind rather
 * than taking it with you.
 *
 * The racks pile ON TOP of each other in one spot rather than lining up side by
 * side; a counter is only so long, and a growing tower reads as stock far more
 * clearly at a glance than a row that creeps sideways.
 */
export class ShopStock {
    readonly group = new THREE.Group();

    private _racks: GroundRack[] = [];
    private _maxRacks: number;
    private _origin: { x: number; z: number };
    private _yaw: number;
    /** Counter-top height the stack starts from. */
    private _baseY: number;
    private _pool: Array<{ group: THREE.Group; slots: THREE.Vector3[] }> = [];
    private _bottlePool: THREE.Group[] = [];
    /**
     * Crates mid-flight from a carrier's hands onto the counter.
     *
     * `from` is null for one that simply appeared, which still gets the scale
     * pop but no travel — the animation has to degrade to the old behaviour
     * when nobody told us where it came from.
     */
    private _spring: Array<{
        g: THREE.Group; t: number;
        from: THREE.Vector3 | null; to: THREE.Vector3;
    }> = [];

    constructor(origin: { x: number; z: number }, yaw: number, maxRacks = 3, baseY = 0) {
        this._origin = origin;
        this._yaw = yaw;
        this._maxRacks = maxRacks;
        this._baseY = baseY;
    }

    /**
     * Height of the nth crate in the stack. `CRATE_PITCH` already allows for the
     * bottles standing proud of the crate below, so the tower does not intersect
     * its own contents.
     */
    private _stackY(index: number): number {
        return this._baseY + index * CRATE_PITCH.bottle * CRATE_SCALE;
    }

    get crateCount(): number { return this._racks.length; }

    get bottles(): number {
        let n = 0;
        for (const r of this._racks) n += r.bottles.length;
        return n;
    }

    get hasRoom(): boolean { return this._racks.length < this._maxRacks; }

    /** 0..1 how stocked this stall is, counting empty rack slots as space. */
    get fullness(): number {
        const capacity = this._maxRacks * RACK_CAPACITY;
        return capacity === 0 ? 0 : this.bottles / capacity;
    }

    /**
     * Sets a filled rack down in the next free spot.
     *
     * `from` is where it was being carried, in world space. Given one, the
     * crate ARCS out of the carrier's hands onto its slot rather than appearing
     * on the counter — which read as teleporting, since the hand-off and the
     * landing were the same instant.
     */
    addCrate(count: number, from?: THREE.Vector3): boolean {
        if (!this.hasRoom || count <= 0) return false;

        const built = this._pool.pop() ?? makeBottleRack();
        built.group.visible = true;
        built.group.scale.setScalar(0.01);

        // Stacked in one spot, squared up with the counter under them.
        const to = new THREE.Vector3(
            this._origin.x, this._stackY(this._racks.length), this._origin.z);
        built.group.position.copy(from ?? to);
        built.group.rotation.y = this._yaw;
        this.group.add(built.group);

        const rack: GroundRack = { group: built.group, slots: built.slots, bottles: [] };
        for (let i = 0; i < Math.min(count, RACK_CAPACITY); i++) {
            const b = this._bottlePool.pop() ?? makeBottle();
            b.visible = true;
            b.position.copy(rack.slots[i]);
            b.scale.setScalar(CONTENT_SCALE.bottle);
            rack.group.add(b);
            rack.bottles.push(b);
        }

        this._racks.push(rack);
        this._spring.push({ g: built.group, t: 0, from: from ? from.clone() : null, to });
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
            // A travelling crate takes longer than one that only pops into
            // size: at the scale rate the throw is over before it is read.
            s.t = Math.min(1, s.t + dt * (s.from ? FLIGHT_RATE : 7));
            const p = s.t;
            s.g.scale.setScalar(
                Math.max(0.01, 1 + 2.0 * Math.pow(p - 1, 3) + 1.1 * Math.pow(p - 1, 2)) * CRATE_SCALE);

            if (s.from) {
                // Straight line across, plus an arc peaking mid-flight — the
                // same toss `CashField` uses for a payout.
                s.g.position.lerpVectors(s.from, s.to, p);
                s.g.position.y += Math.sin(p * Math.PI) * FLIGHT_ARC;
            }

            if (s.t >= 1) {
                s.g.scale.setScalar(CRATE_SCALE);
                s.g.position.copy(s.to);
                this._spring.splice(i, 1);
            }
        }
    }

    /** Settles the tower down after the bottom crate is emptied and discarded. */
    private _relayout(): void {
        for (let i = 0; i < this._racks.length; i++) {
            this._racks[i].group.position.y = this._stackY(i);
        }
    }
}
