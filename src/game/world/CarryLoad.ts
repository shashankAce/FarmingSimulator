import * as THREE from 'three';
import {
    BASKET_CAPACITY, CONTENT_SCALE, CRATE_DEPTH, CRATE_PITCH, CRATE_SCALE, LAID_CARROT_LEN,
    RACK_CAPACITY, makeBottleRack, makeCarrotBasket,
} from '../procgen/Containers.ts';
import { makeBottle, makeCarrot } from '../procgen/Machines.ts';
import { CHARACTER, DEV } from '../Config.ts';

export type ItemKind = 'carrot' | 'bottle';

interface Carried {
    kind: ItemKind;
    group: THREE.Group;
    slots: THREE.Vector3[];
    items: THREE.Group[];
    t: number;
}

const CAPACITY: Record<ItemKind, number> = { carrot: BASKET_CAPACITY, bottle: RACK_CAPACITY };
/** Vertical pitch when crates are stacked in the arms, before CARRY_SCALE. */
const PITCH: Record<ItemKind, number> = CRATE_PITCH;
/**
 * Crate scale on the character.
 *
 * `CRATE_SCALE` is a WORLD size and every other site uses it directly, but
 * these crates hang off a character that is itself scaled by `CHARACTER.scale`,
 * so the character's scale is divided back out. Without that, setting a crate
 * down on a counter would visibly shrink it.
 */
const CARRY_SCALE = CRATE_SCALE / CHARACTER.scale;
/**
 * How far behind the anchor a crate sits: exactly its own half-depth, so the
 * crate's FRONT face lands ON the anchor and rests against the back.
 *
 * The anchor is the character's back surface (`HOLD_Z` in
 * `procgen/Character.ts`), so a crate centred there has half of itself inside
 * the body — for a basket that was a third of a unit of torso. No air is added
 * on top: a gap here is what makes the load look like it is trailing the
 * character rather than being carried by them.
 *
 * Scaled by `CARRY_SCALE` because the depth is in crate-local units while the
 * position is in the anchor's space, where the crate's own scale does not apply.
 */
const BACK_OFF: Record<ItemKind, number> = {
    carrot: (CRATE_DEPTH.carrot / 2) * CARRY_SCALE,
    bottle: (CRATE_DEPTH.bottle / 2) * CARRY_SCALE,
};
/**
 * An item's flight from where it was picked into its slot.
 *
 * `PICK_RATE` is the reciprocal of the flight time, so 1.6 is a touch over half
 * a second — long enough to follow with the eye. `PICK_OVER` is the fraction of
 * that spent travelling ACROSS to the crate; the rest is the drop straight
 * down into the slot.
 *
 * That split is the whole point. A straight line from the soil to the slot
 * enters the crate through whichever WALL happens to face the carrot, so the
 * carrot appeared to pass through the side of the basket. Going up and over
 * first, then dropping, puts it in through the opening.
 */
const PICK_RATE = 1.6;
const PICK_OVER = 0.72;
/**
 * How far above its slot an item passes before dropping in, in crate-local
 * units. A basket's rim stands at 0.62 with its slots at about 0.47, so much
 * under 0.16 clips the item in through the rim on the way down.
 */
const PICK_RISE = 0.55;
/**
 * Shortest gap between two items leaving the ground, in seconds.
 *
 * A floor under the caller's own delays rather than a replacement for them: the
 * caller stages a sweep's carrots so they lie there a moment and go in a
 * stream, and this keeps that stream when the queue backs up and every item in
 * it is already overdue.
 */
const PICK_GAP = 0.07;
/**
 * How each kind sits in its crate: carrots tipped onto their side across the
 * basket's WIDTH, bottles standing up in their rack.
 *
 * `shift` is not cosmetic. An item's origin is at its base, so a carrot laid
 * flat runs its whole length out of ONE side of its slot instead of straddling
 * it — which is what had them hanging over the rim. Half a length back puts the
 * carrot on the cell rather than beside it.
 *
 * Always assigned rather than assumed, because items come from a pool and carry
 * whatever angle they were last given.
 */
const LAY: Record<ItemKind, { tilt: number; shift: number }> = {
    carrot: { tilt: -Math.PI / 2, shift: -LAID_CARROT_LEN / 2 },
    bottle: { tilt: 0, shift: 0 },
};

/** An item still flying from where it was picked into its slot in the crate. */
interface Picked {
    item: THREE.Group;
    kind: ItemKind;
    /**
     * The crate it is flying into — NULL while it still lies on the ground
     * waiting for a slot.
     *
     * Claimed late, when the item actually sets off, rather than at the moment
     * it was cut. One swing cuts a dozen carrots at once, and claiming up front
     * opened every crate they would eventually need in the same frame: two
     * baskets sprang up instantly, and since a crate stacks directly ON TOP of
     * the one below, the carrots still dropping into the lower basket fell
     * straight through the empty one above it.
     */
    crate: Carried | null;
    /** Seconds still to wait where it fell before setting off. */
    wait: number;
    t: number;
    /**
     * Where it was picked, in WORLD space, re-projected into its parent every
     * frame rather than converted once.
     *
     * The item is parented to a crate that rides a character who walks and —
     * mid-swing — turns through half a right angle. Held as a crate-local point
     * it therefore drifts and swings with them, so the carrot no longer set off
     * from the ground it grew in: it came in from wherever the character had
     * since carried that point to.
     */
    fromWorld: THREE.Vector3;
    /** Slot it is bound for, once a crate has been claimed. */
    to: THREE.Vector3;
    /** Angle it tips through on the way in — upright out of the soil, flat on landing. */
    tilt: number;
}

/**
 * What a character is carrying: a small stack of crates riding on their back
 * (see `holdAnchor` in `procgen/Character.ts`), not a column of loose goods
 * balanced on the head.
 *
 * Items always live inside a container — a slatted rack for bottles, an open
 * basket for carrots — and a container that runs empty is discarded outright.
 * That is what makes "sell the rack, the rack disappears" true rather than
 * bookkeeping.
 *
 * Containers and item meshes are both pooled: crates are picked up and emptied
 * constantly, and rebuilding one per trip is exactly the per-spawn garbage
 * `skills/core/performance.md` warns about.
 */
export class CarryLoad {
    private _anchor: THREE.Object3D;
    private _maxContainers: number;
    private _stack: Carried[] = [];
    private _picked: Picked[] = [];
    /**
     * Where cut items lie while they wait their turn. Scaled exactly like a
     * crate, so an item moves from here into one without changing size.
     */
    private _incoming = new THREE.Object3D();
    /** Seconds since the last item left the ground — see `PICK_GAP`. */
    private _sinceLaunch = 0;
    /** Scratch for projecting a world pick point into a crate. */
    private _inv = new THREE.Matrix4();
    private _tmp = new THREE.Vector3();

    private static _itemPool: Record<ItemKind, THREE.Group[]> = { carrot: [], bottle: [] };
    private static _cratePool: Record<ItemKind, Array<{ group: THREE.Group; slots: THREE.Vector3[] }>> =
        { carrot: [], bottle: [] };

    constructor(anchor: THREE.Object3D, maxContainers: number) {
        this._anchor = anchor;
        this._maxContainers = maxContainers;
        this._incoming.scale.setScalar(CARRY_SCALE);
        anchor.add(this._incoming);
    }

    /** Items cut and on their way in, but not yet in a crate. */
    private get _waiting(): number {
        let n = 0;
        for (const f of this._picked) if (!f.crate) n++;
        return n;
    }

    /** What those items are, or null when nothing is on its way in. */
    private get _waitingKind(): ItemKind | null {
        for (const f of this._picked) if (!f.crate) return f.kind;
        return null;
    }

    get containerCount(): number { return this._stack.length; }
    /**
     * Nothing on board — INCLUDING nothing still on its way in. A carrot that
     * has been cut and is arcing over is carried, as far as every caller that
     * asks this is concerned: it decides whether the drop button shows, whether
     * an assistant goes back to the field or on to the juicer, and whether a
     * tutorial step has been done.
     */
    get isEmpty(): boolean { return this._stack.length === 0 && this._picked.length === 0; }
    get kind(): ItemKind | null {
        return this._stack.length ? this._stack[0].kind : this._waitingKind;
    }

    get totalItems(): number {
        let n = 0;
        for (const c of this._stack) n += c.items.length;
        return n;
    }

    /**
     * Where the crate that `popCrate` is about to hand over currently sits, in
     * world space — for anything animating it away from the arms.
     *
     * The TOP crate, not the anchor. Crates stack upward from the anchor at
     * `_stackHeight`, so the anchor is the bottom of the pile: animating from
     * it made every throw look like it came off the bottom of the stack while
     * the crate that actually left was the one on top. Falls back to the anchor
     * when nothing is held.
     */
    topCrateWorld(out: THREE.Vector3): THREE.Vector3 {
        const top = this._stack[this._stack.length - 1];
        return (top ? top.group : this._anchor).getWorldPosition(out);
    }

    /**
     * How many more of `kind` will fit, across the open crate and any crates
     * still to be opened. A batch harvest needs the whole number up front,
     * not just whether one more fits.
     */
    roomFor(kind: ItemKind): number {
        // Frozen: always room for a full load, so a sweep is never trimmed for
        // want of space and harvesting can run indefinitely.
        if (DEV.freezeCarry) return this._maxContainers * CAPACITY[kind];
        if (this.kind && this.kind !== kind) return 0;
        const top = this._stack[this._stack.length - 1];
        const inOpen = top ? CAPACITY[kind] - top.items.length : 0;
        const free = inOpen + (this._maxContainers - this._stack.length) * CAPACITY[kind];
        // Less whatever is already cut and on its way in: those have no slot
        // yet, so nothing else has subtracted them, and a second swing would
        // otherwise cut carrots into space the first one has already spoken for.
        return Math.max(0, free - this._waiting);
    }

    /** Room for one more item of `kind`, either in an open crate or a new one. */
    accepts(kind: ItemKind): boolean {
        if (DEV.freezeCarry) return true;
        return this.roomFor(kind) > 0;
    }

    /** Room to take on a whole pre-filled crate (a rack lifted off the stand). */
    canAdopt(kind: ItemKind): boolean {
        if (DEV.freezeCarry) return true;
        if (this.kind && this.kind !== kind) return false;
        return this._stack.length < this._maxContainers;
    }

    /** Adds one item, opening a fresh crate when the current one is full. */
    /**
     * Adds one item. `from` is where it was picked, in world space — given one,
     * the item ARCS into its slot instead of appearing there, so a harvested
     * carrot is seen leaving the ground and landing in the basket.
     *
     * `delay` holds it at `from` first. A sweep cuts several at once, and they
     * look like a harvest rather than a shower if they lie where they fell for
     * a moment and then go in one at a time.
     */
    push(kind: ItemKind, from?: THREE.Vector3, delay = 0): boolean {
        // Frozen: accepted and dropped on the floor. The caller still believes
        // the item went somewhere, so harvesting keeps cutting, but no crate is
        // built and the hands stay free for the animation being worked on.
        if (DEV.freezeCarry) return true;
        if (!this.accepts(kind)) return false;

        const item = CarryLoad._acquireItem(kind);
        const lay = LAY[kind];
        item.scale.setScalar(CONTENT_SCALE[kind]);
        item.visible = true;

        if (from) {
            // Queued, not placed: it lies where it was cut and claims a slot —
            // and a crate with it, if one is needed — only when it sets off.
            item.rotation.set(0, 0, 0);
            this._incoming.add(item);
            this._picked.push({
                item, kind, crate: null, wait: delay, t: 0,
                fromWorld: from.clone(), to: new THREE.Vector3(), tilt: lay.tilt,
            });
            return true;
        }

        let top = this._stack[this._stack.length - 1];
        if (!top || top.items.length >= CAPACITY[kind]) {
            top = this._openCrate(kind);
        }
        const slot = top.slots[top.items.length].clone();
        slot.x += lay.shift;
        item.rotation.set(0, 0, lay.tilt);
        top.group.add(item);
        top.items.push(item);
        item.position.copy(slot);
        return true;
    }

    /**
     * Takes on an already-filled crate in one go — how a rack is lifted off the
     * production stand. Returns false when there's no room for another crate.
     */
    adoptFilled(kind: ItemKind, count: number): boolean {
        if (DEV.freezeCarry) return true;
        if (!this.isEmpty && this.kind !== kind) return false;
        if (this._stack.length >= this._maxContainers) return false;

        this._openCrate(kind);
        for (let i = 0; i < Math.min(count, CAPACITY[kind]); i++) {
            const top = this._stack[this._stack.length - 1];
            const item = CarryLoad._acquireItem(kind);
            item.position.copy(top.slots[top.items.length]);
            item.scale.setScalar(CONTENT_SCALE[kind]);
            item.visible = true;
            top.group.add(item);
            top.items.push(item);
        }
        return true;
    }

    /**
     * Removes one item from the topmost crate. When that crate runs empty it is
     * discarded entirely, which is the visible "the rack disappears" beat.
     */
    pop(): ItemKind | null {
        const top = this._stack[this._stack.length - 1];
        if (!top) return null;

        const item = top.items.pop();
        if (item) {
            top.group.remove(item);
            CarryLoad._releaseItem(top.kind, item);
        }

        const kind = top.kind;
        if (top.items.length === 0) this._discardTop();
        return kind;
    }

    /**
     * Hands over the topmost crate whole and reports what was in it — how a
     * rack is set down at a shop. Returns 0 when nothing is held.
     */
    popCrate(): number {
        const top = this._stack[this._stack.length - 1];
        if (!top) return 0;
        const count = top.items.length;
        this._discardTop();
        return count;
    }

    clear(): void {
        // The queue first: an item still on the ground belongs to no crate, so
        // discarding the stack would leave it behind, parented and visible.
        for (const f of this._picked) {
            if (!f.crate) {
                this._incoming.remove(f.item);
                CarryLoad._releaseItem(f.kind, f.item);
            }
        }
        this._picked.length = 0;
        while (this._stack.length) this._discardTop();
    }

    /** Springs newly lifted crates up to size, and moves picked items along. */
    update(dt: number): void {
        for (const c of this._stack) {
            if (c.t >= 1) continue;
            c.t = Math.min(1, c.t + dt * 7);
            const p = c.t;
            const s = 1 + 2.0 * Math.pow(p - 1, 3) + 1.1 * Math.pow(p - 1, 2);
            c.group.scale.setScalar(Math.max(0.01, s) * CARRY_SCALE);
        }

        this._advanceQueue(dt);
        this._advanceFlights(dt);
    }

    /**
     * Cut items still lying on the ground: holds each on its own patch of soil,
     * and sends them off one at a time.
     *
     * In cut order and no faster than `PICK_GAP`, which matters most exactly
     * when the queue has backed up behind a full crate: everything in it is by
     * then long past its own delay, and without the gap the whole remainder
     * would leave the ground on the single frame the next crate opens.
     */
    private _advanceQueue(dt: number): void {
        this._sinceLaunch += dt;
        this._incoming.updateWorldMatrix(true, false);
        this._inv.copy(this._incoming.matrixWorld).invert();

        let launched = false;
        let blocked = false;
        for (let i = 0; i < this._picked.length; i++) {
            const f = this._picked[i];
            if (f.crate) continue;

            // Pinned to where it was cut, in `_incoming`'s space as of this
            // frame — the spot is on the soil, not on the character walking
            // away from it.
            f.item.position.copy(this._tmp.copy(f.fromWorld).applyMatrix4(this._inv));

            if (f.wait > 0) { f.wait = Math.max(0, f.wait - dt); continue; }
            if (launched || blocked || this._sinceLaunch < PICK_GAP) continue;

            const got = this._claim(f);
            if (got === 'claimed') {
                // Flies from the next frame, out of its new parent.
                this._sinceLaunch = 0;
                launched = true;
            } else if (got === 'wait') {
                // The crate it wants is full and still receiving. Nothing
                // behind it can go either, but they all still need pinning.
                blocked = true;
            } else {
                // Nowhere left to put it — the load filled up while it lay
                // there. Better gone than stuck on the ground forever.
                this._incoming.remove(f.item);
                CarryLoad._releaseItem(f.kind, f.item);
                this._picked.splice(i, 1);
                i--;
            }
        }
    }

    /** Items in the air, on their way into a claimed slot. */
    private _advanceFlights(dt: number): void {
        // One inverse per crate rather than per item: everything in the air is
        // normally going into the same open crate.
        let projected: Carried | null = null;
        for (let i = this._picked.length - 1; i >= 0; i--) {
            const f = this._picked[i];
            if (!f.crate) continue;
            // Dropped or tipped out mid-flight: the item is already back in the
            // pool, so stop animating it before it is handed out again.
            if (!f.crate.items.includes(f.item)) { this._picked.splice(i, 1); continue; }

            if (f.crate !== projected) {
                projected = f.crate;
                f.crate.group.updateWorldMatrix(true, false);
                this._inv.copy(f.crate.group.matrixWorld).invert();
            }
            // Where it was cut, in the crate's space AS OF THIS FRAME, so the
            // launch point stays nailed to the ground it grew in.
            const start = this._tmp.copy(f.fromWorld).applyMatrix4(this._inv);

            f.t = Math.min(1, f.t + dt * PICK_RATE);
            // The point it is aiming for on the way across: over the slot, clear
            // of the rim.
            const over = f.to.y + PICK_RISE;
            if (f.t < PICK_OVER) {
                // Across and up, easing out, so it covers the ground early and
                // arrives over the crate rather than at its side.
                const e = 1 - Math.pow(1 - f.t / PICK_OVER, 2);
                f.item.position.set(
                    start.x + (f.to.x - start.x) * e,
                    start.y + (over - start.y) * e,
                    start.z + (f.to.z - start.z) * e,
                );
            } else {
                // Straight down into the slot, gathering speed as it falls.
                const u = (f.t - PICK_OVER) / (1 - PICK_OVER);
                f.item.position.set(f.to.x, over + (f.to.y - over) * u * u, f.to.z);
            }
            // Tips over on the way across: it leaves the soil standing, as it
            // grew, and is lying flat by the time it drops in.
            f.item.rotation.z = f.tilt * Math.min(1, f.t / PICK_OVER);
            if (f.t >= 1) {
                f.item.position.copy(f.to);
                f.item.rotation.z = f.tilt;
                this._picked.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gives a queued item a slot, opening a crate for it if it needs one.
     *
     * 'wait' means come back next frame: the open crate is full, but items are
     * still coming down into it, and stacking the next crate on top now would
     * put a lid over the slots they are dropping into. Waiting for them to land
     * is what makes crates appear one at a time, as each one fills, rather than
     * a whole sweep's worth springing up at once.
     */
    private _claim(f: Picked): 'claimed' | 'wait' | 'nowhere' {
        let top = this._stack[this._stack.length - 1];
        if (top && top.kind !== f.kind) return 'nowhere';

        if (top && top.items.length >= CAPACITY[f.kind]) {
            if (this._picked.some(p => p.crate === top)) return 'wait';
            top = undefined;
        }
        if (!top) {
            if (this._stack.length >= this._maxContainers) return 'nowhere';
            top = this._openCrate(f.kind);
        }

        const slot = top.slots[top.items.length].clone();
        slot.x += LAY[f.kind].shift;
        f.crate = top;
        f.to = slot;
        top.items.push(f.item);
        top.group.add(f.item);
        return 'claimed';
    }

    private _openCrate(kind: ItemKind): Carried {
        const built = CarryLoad._acquireCrate(kind);
        built.group.visible = true;
        built.group.scale.setScalar(0.01);
        built.group.position.set(0, this._stackHeight(kind), -BACK_OFF[kind]);
        this._anchor.add(built.group);

        const carried: Carried = { kind, group: built.group, slots: built.slots, items: [], t: 0 };
        this._stack.push(carried);
        return carried;
    }

    private _discardTop(): void {
        const top = this._stack.pop();
        if (!top) return;
        for (const item of top.items) {
            top.group.remove(item);
            CarryLoad._releaseItem(top.kind, item);
        }
        top.items.length = 0;
        this._anchor.remove(top.group);
        top.group.visible = false;
        top.group.scale.setScalar(1);
        CarryLoad._cratePool[top.kind].push({ group: top.group, slots: top.slots });
    }

    private _stackHeight(kind: ItemKind): number {
        return this._stack.length * PITCH[kind] * CARRY_SCALE;
    }

    private static _acquireItem(kind: ItemKind): THREE.Group {
        return CarryLoad._itemPool[kind].pop()
            ?? (kind === 'carrot' ? makeCarrot() : makeBottle());
    }

    private static _releaseItem(kind: ItemKind, obj: THREE.Group): void {
        obj.visible = false;
        obj.rotation.set(0, 0, 0);
        CarryLoad._itemPool[kind].push(obj);
    }

    private static _acquireCrate(kind: ItemKind): { group: THREE.Group; slots: THREE.Vector3[] } {
        return CarryLoad._cratePool[kind].pop()
            ?? (kind === 'bottle' ? makeBottleRack() : makeCarrotBasket());
    }
}

export { CAPACITY as CONTAINER_CAPACITY };
