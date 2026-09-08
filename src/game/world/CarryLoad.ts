import * as THREE from 'three';
import {
    BASKET_CAPACITY, CONTENT_SCALE, CRATE_PITCH, CRATE_SCALE, RACK_CAPACITY,
    makeBottleRack, makeCarrotBasket,
} from '../procgen/Containers.ts';
import { makeBottle, makeCarrot } from '../procgen/Machines.ts';

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
 * The shared crate scale (see `Containers.CRATE_SCALE`). At full size a stack
 * of crates is wider and taller than the character and hides them completely
 * from this camera angle, so this size is the one every other site matches.
 */
const CARRY_SCALE = CRATE_SCALE;

/**
 * What a character is carrying: a small stack of crates held out in front, not
 * a column of loose goods balanced on the head.
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

    /** True while anything is held — drives the character's carry pose. */
    get isCarrying(): boolean { return this._stack.length > 0; }

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

    /** Room for one more item of `kind`, either in an open crate or a new one. */
    accepts(kind: ItemKind): boolean {
        if (!this.isEmpty && this.kind !== kind) return false;
        const top = this._stack[this._stack.length - 1];
        if (top && top.items.length < CAPACITY[kind]) return true;
        return this._stack.length < this._maxContainers;
    }

    /** Room to take on a whole pre-filled crate (a rack lifted off the stand). */
    canAdopt(kind: ItemKind): boolean {
        if (!this.isEmpty && this.kind !== kind) return false;
        return this._stack.length < this._maxContainers;
    }

    /** Adds one item, opening a fresh crate when the current one is full. */
    push(kind: ItemKind): boolean {
        if (!this.accepts(kind)) return false;

        let top = this._stack[this._stack.length - 1];
        if (!top || top.items.length >= CAPACITY[kind]) {
            top = this._openCrate(kind);
        }

        const item = CarryLoad._acquireItem(kind);
        const slot = top.slots[top.items.length];
        item.position.copy(slot);
        item.scale.setScalar(CONTENT_SCALE[kind]);
        item.visible = true;
        top.group.add(item);
        top.items.push(item);
        return true;
    }

    /**
     * Takes on an already-filled crate in one go — how a rack is lifted off the
     * production stand. Returns false when there's no room for another crate.
     */
    adoptFilled(kind: ItemKind, count: number): boolean {
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

    /** Springs newly lifted crates up to size. */
    update(dt: number): void {
        for (const c of this._stack) {
            if (c.t >= 1) continue;
            c.t = Math.min(1, c.t + dt * 7);
            const p = c.t;
            const s = 1 + 2.0 * Math.pow(p - 1, 3) + 1.1 * Math.pow(p - 1, 2);
            c.group.scale.setScalar(Math.max(0.01, s) * CARRY_SCALE);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    private _openCrate(kind: ItemKind): Carried {
        const built = CarryLoad._acquireCrate(kind);
        built.group.visible = true;
        built.group.scale.setScalar(0.01);
        built.group.position.set(0, this._stackHeight(kind), 0);
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
