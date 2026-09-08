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
    /** False while the crate is still arcing in from a carrier's hands. */
    landed: boolean;
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
 * side; a growing tower reads as stock far more clearly at a glance than a row
 * that creeps sideways. `CRATE_PITCH` spaces them to clear the bottles standing
 * out of the crate below, so a crate rides on its neighbour's contents rather
 * than on its rim.
 *
 * Because the pile is index-ordered, ANY change to the middle of it has to
 * re-seat everything above — see `_restack`.
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
        rack: GroundRack; t: number;
        from: THREE.Vector3 | null; to: THREE.Vector3;
    }> = [];

    constructor(origin: { x: number; z: number }, yaw: number, maxRacks = 3, baseY = 0) {
        this._origin = origin;
        this._yaw = yaw;
        this._maxRacks = maxRacks;
        this._baseY = baseY;
    }

    /**
     * Height of the nth crate in the pile. `CRATE_PITCH` already allows for the
     * bottles standing proud of the crate below, so the tower does not intersect
     * its own contents.
     */
    private _stackY(index: number): number {
        return this._baseY + index * CRATE_PITCH.bottle * CRATE_SCALE;
    }

    /**
     * Re-seats the pile after a crate leaves the middle of it.
     *
     * That happens more than it looks: `takeBottle` serves from the topmost
     * LANDED crate, so while a fresh one is still arcing in, the crate it is
     * about to land on is the one being emptied. Walk in and out of a stall
     * during a sale and the crate under the incoming one vanishes.
     *
     * A crate still in flight is re-aimed rather than moved — its position is
     * owned by the animation until it arrives, so moving it here would be
     * overwritten on the very next frame.
     */
    private _restack(): void {
        for (let i = 0; i < this._racks.length; i++) {
            const rack = this._racks[i];
            const y = this._stackY(i);
            const flight = this._spring.find(f => f.rack === rack);
            if (flight) flight.to.y = y;
            else rack.group.position.y = y;
        }
    }

    get crateCount(): number { return this._racks.length; }

    get bottles(): number {
        let n = 0;
        for (const r of this._racks) n += r.bottles.length;
        return n;
    }

    /**
     * Bottles that can actually be sold right now — those in crates that have
     * finished arriving. A crate still in the air is stock the stall owns but
     * cannot serve from yet, and selling out of one lets a customer be served
     * against a rack that is mid-throw.
     */
    get readyBottles(): number {
        let n = 0;
        for (const r of this._racks) if (r.landed) n += r.bottles.length;
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

        // Piled in one spot, squared up with the counter under it.
        const to = new THREE.Vector3(
            this._origin.x, this._stackY(this._racks.length), this._origin.z);
        built.group.position.copy(from ?? to);
        built.group.rotation.y = this._yaw;
        this.group.add(built.group);

        const rack: GroundRack = {
            group: built.group, slots: built.slots, bottles: [], landed: !from,
        };
        for (let i = 0; i < Math.min(count, RACK_CAPACITY); i++) {
            const b = this._bottlePool.pop() ?? makeBottle();
            b.visible = true;
            b.position.copy(rack.slots[i]);
            b.scale.setScalar(CONTENT_SCALE.bottle);
            rack.group.add(b);
            rack.bottles.push(b);
        }

        this._racks.push(rack);
        this._spring.push({ rack, t: 0, from: from ? from.clone() : null, to });
        return true;
    }

    /**
     * Removes one bottle, emptying the TOP crate of the stack first. A crate
     * that runs out is discarded outright — same rule as a carried one.
     *
     * Top, not bottom. Serving from `_racks[0]` emptied the crate at the base
     * of the tower and then shuffled everything above it down a step, so a
     * crate visibly disappeared from the middle of the stack while the ones
     * over it dropped. Taking from the end means the only crate that can ever
     * vanish is the one on top, and no other crate has to move.
     *
     * Crates still in the air are skipped: their bottles are not sellable yet.
     */
    takeBottle(): boolean {
        let top = -1;
        for (let i = this._racks.length - 1; i >= 0; i--) {
            const r = this._racks[i];
            if (r.landed && r.bottles.length > 0) { top = i; break; }
        }
        if (top < 0) return false;

        const rack = this._racks[top];
        const b = rack.bottles.pop()!;
        rack.group.remove(b);
        b.visible = false;
        this._bottlePool.push(b);

        if (rack.bottles.length === 0) {
            this._racks.splice(top, 1);
            this.group.remove(rack.group);
            rack.group.visible = false;
            this._pool.push({ group: rack.group, slots: rack.slots });
            this._restack();
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
            s.rack.group.scale.setScalar(
                Math.max(0.01, 1 + 2.0 * Math.pow(p - 1, 3) + 1.1 * Math.pow(p - 1, 2)) * CRATE_SCALE);

            if (s.from) {
                // Straight line across, plus an arc peaking mid-flight — the
                // same toss `CashField` uses for a payout.
                s.rack.group.position.lerpVectors(s.from, s.to, p);
                s.rack.group.position.y += Math.sin(p * Math.PI) * FLIGHT_ARC;
            }

            if (s.t >= 1) {
                s.rack.group.scale.setScalar(CRATE_SCALE);
                s.rack.group.position.copy(s.to);
                s.rack.landed = true;
                this._spring.splice(i, 1);
            }
        }
    }

}
