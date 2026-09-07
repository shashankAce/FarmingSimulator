import * as THREE from 'three';
import { makeBottle, makeCarrot } from '../procgen/Machines.ts';

export type ItemKind = 'carrot' | 'bottle';

/**
 * The stack of goods a character balances over their head.
 *
 * Meshes are pooled per kind: items are handed back and forth between the field,
 * the juicer, the racks and the shop constantly, and rebuilding a carrot group
 * on every transfer is exactly the per-spawn garbage `skills/core/performance.md`
 * warns about. Nothing here is a `Node`, so `NodePool` itself doesn't apply —
 * this is the same idea applied to raw THREE groups.
 */
export class CarryStack {
    private _anchor: THREE.Object3D;
    private _items: Array<{ kind: ItemKind; obj: THREE.Group; t: number }> = [];
    private _capacity: number;

    private static _pool: Record<ItemKind, THREE.Group[]> = { carrot: [], bottle: [] };

    constructor(anchor: THREE.Object3D, capacity: number) {
        this._anchor = anchor;
        this._capacity = capacity;
    }

    get count(): number { return this._items.length; }
    get isFull(): boolean { return this._items.length >= this._capacity; }
    get isEmpty(): boolean { return this._items.length === 0; }
    get kind(): ItemKind | null { return this._items.length ? this._items[0].kind : null; }

    /** True when this stack can accept `kind` — stacks never mix item types. */
    accepts(kind: ItemKind): boolean {
        return !this.isFull && (this.isEmpty || this.kind === kind);
    }

    push(kind: ItemKind): boolean {
        if (!this.accepts(kind)) return false;
        const obj = CarryStack._acquire(kind);
        obj.visible = true;
        obj.scale.setScalar(0.01);
        this._anchor.add(obj);
        this._items.push({ kind, obj, t: 0 });
        this._layout();
        return true;
    }

    /** Removes the top item and returns its kind, or null when empty. */
    pop(): ItemKind | null {
        const top = this._items.pop();
        if (!top) return null;
        this._anchor.remove(top.obj);
        CarryStack._release(top.kind, top.obj);
        this._layout();
        return top.kind;
    }

    clear(): void { while (this.pop()) { /* drain */ } }

    /** Springs newly added items up to size and adds a lazy sway to the column. */
    update(dt: number): void {
        for (let i = 0; i < this._items.length; i++) {
            const it = this._items[i];
            it.t = Math.min(1, it.t + dt * 6);
            // Ease-out-back: a small overshoot reads as weight landing on the stack.
            const p = it.t;
            const s = 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);
            it.obj.scale.setScalar(Math.max(0.01, s));
            it.obj.rotation.y += dt * 0.6;
        }
    }

    private _layout(): void {
        const perRow = 2;
        const rowH = 0.46;
        for (let i = 0; i < this._items.length; i++) {
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const spread = this._items.length > 1 ? 0.2 : 0;
            this._items[i].obj.position.set(
                (col - (perRow - 1) / 2) * spread * 2,
                row * rowH,
                0,
            );
        }
    }

    private static _acquire(kind: ItemKind): THREE.Group {
        const pool = CarryStack._pool[kind];
        const reused = pool.pop();
        if (reused) return reused;
        return kind === 'carrot' ? makeCarrot() : makeBottle();
    }

    private static _release(kind: ItemKind, obj: THREE.Group): void {
        obj.visible = false;
        obj.rotation.set(0, 0, 0);
        CarryStack._pool[kind].push(obj);
    }
}
