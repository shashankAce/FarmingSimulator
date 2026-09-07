import * as THREE from 'three';
import {
    BASKET_CAPACITY, RACK_CAPACITY, makeBottleRack, makeCarrotBasket,
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
const PITCH: Record<ItemKind, number> = { carrot: 0.78, bottle: 0.86 };
/**
 * Carried crates are shrunk relative to the ones standing in the world. At full
 * size a stack of them is wider and taller than the character and hides them
 * completely from this camera angle.
 */
const CARRY_SCALE = 0.58;

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
        item.scale.setScalar(kind === 'bottle' ? 0.78 : 0.86);
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
            item.scale.setScalar(kind === 'bottle' ? 0.78 : 0.86);
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
