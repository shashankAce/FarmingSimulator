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
/** Speed and hop height of an item arcing into a crate from where it was picked. */
const PICK_RATE = 3.4;
const PICK_ARC = 0.7;
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
    crate: Carried;
    /** Seconds still to wait where it fell before setting off. */
    wait: number;
    t: number;
    from: THREE.Vector3;
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

    private static _itemPool: Record<ItemKind, THREE.Group[]> = { carrot: [], bottle: [] };
    private static _cratePool: Record<ItemKind, Array<{ group: THREE.Group; slots: THREE.Vector3[] }>> =
        { carrot: [], bottle: [] };

    constructor(anchor: THREE.Object3D, maxContainers: number) {
        this._anchor = anchor;
        this._maxContainers = maxContainers;
    }

    get containerCount(): number { return this._stack.length; }
    get isEmpty(): boolean { return this._stack.length === 0; }
    get kind(): ItemKind | null { return this._stack.length ? this._stack[0].kind : null; }

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
        if (!this.isEmpty && this.kind !== kind) return 0;
        const top = this._stack[this._stack.length - 1];
        const inOpen = top ? CAPACITY[kind] - top.items.length : 0;
        return inOpen + (this._maxContainers - this._stack.length) * CAPACITY[kind];
    }

    /** Room for one more item of `kind`, either in an open crate or a new one. */
    accepts(kind: ItemKind): boolean {
        if (DEV.freezeCarry) return true;
        if (!this.isEmpty && this.kind !== kind) return false;
        const top = this._stack[this._stack.length - 1];
        if (top && top.items.length < CAPACITY[kind]) return true;
        return this._stack.length < this._maxContainers;
    }

    /** Room to take on a whole pre-filled crate (a rack lifted off the stand). */
    canAdopt(kind: ItemKind): boolean {
        if (DEV.freezeCarry) return true;
        if (!this.isEmpty && this.kind !== kind) return false;
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

        let top = this._stack[this._stack.length - 1];
        if (!top || top.items.length >= CAPACITY[kind]) {
            top = this._openCrate(kind);
        }

        const item = CarryLoad._acquireItem(kind);
        const lay = LAY[kind];
        const slot = top.slots[top.items.length].clone();
        slot.x += lay.shift;
        item.scale.setScalar(CONTENT_SCALE[kind]);
        item.rotation.set(0, 0, from ? 0 : lay.tilt);
        item.visible = true;
        top.group.add(item);
        top.items.push(item);

        if (from) {
            // Converted into the crate's own space: the item is parented to a
            // crate that is itself moving with the character, so a world-space
            // path would be re-applied on top of that motion every frame.
            top.group.updateWorldMatrix(true, false);
            const start = top.group.worldToLocal(from.clone());
            item.position.copy(start);
            this._picked.push({
                item, crate: top, wait: delay, t: 0,
                from: start, to: slot, tilt: lay.tilt,
            });
        } else {
            item.position.copy(slot);
        }
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
        while (this._stack.length) this._discardTop();
    }

    /** Springs newly lifted crates up to size, and flies picked items in. */
    update(dt: number): void {
        for (const c of this._stack) {
            if (c.t >= 1) continue;
            c.t = Math.min(1, c.t + dt * 7);
            const p = c.t;
            const s = 1 + 2.0 * Math.pow(p - 1, 3) + 1.1 * Math.pow(p - 1, 2);
            c.group.scale.setScalar(Math.max(0.01, s) * CARRY_SCALE);
        }

        for (let i = this._picked.length - 1; i >= 0; i--) {
            const f = this._picked[i];
            // Dropped or tipped out mid-flight: the item is already back in the
            // pool, so stop animating it before it is handed out again.
            if (!f.crate.items.includes(f.item)) { this._picked.splice(i, 1); continue; }

            if (f.wait > 0) { f.wait = Math.max(0, f.wait - dt); continue; }

            f.t = Math.min(1, f.t + dt * PICK_RATE);
            f.item.position.lerpVectors(f.from, f.to, f.t);
            f.item.position.y += Math.sin(f.t * Math.PI) * PICK_ARC;
            // Tips over as it travels: it leaves the soil standing, as it grew,
            // and is lying down by the time it settles.
            f.item.rotation.z = f.tilt * f.t;
            if (f.t >= 1) {
                f.item.position.copy(f.to);
                f.item.rotation.z = f.tilt;
                this._picked.splice(i, 1);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

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
