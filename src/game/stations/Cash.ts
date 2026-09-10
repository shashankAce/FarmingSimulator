import * as THREE from 'three';
import { CASH_STACK, makeCashStack } from '../procgen/Machines.ts';
import { ZONE, type PadSize } from '../Config.ts';

/** Air between packed bundles. Enough to read as a stack of notes, not a slab. */
const PACK_GAP = 0.1;

/** How long a collected bundle takes to shrink away. */
const SHRINK_TIME = 0.25;

/**
 * Bundles mid-vanish: collected, already credited, still on screen.
 *
 * Cash is taken a whole pad at a time now — the opening stake in one step, a
 * stall's counter in one sweep — and a pile of notes that blinks out the instant
 * you touch it reads as a bug rather than as a pickup. So the value leaves the
 * game immediately (the owner splices its own bookkeeping straight away, which
 * `CashField.count` and the tutorial both depend on) while the mesh shrinks to
 * nothing over a quarter of a second and is only then handed back to its pool.
 *
 * Shared by the ground cash and a stall's takings, which differ only in the
 * scale they shrink FROM — the till draws its bundles at `TILL_SCALE`, so a
 * hard-coded 1 here would pop them larger before shrinking them.
 */
export class ShrinkAway {
    private _items: Array<{ obj: THREE.Group; base: number; t: number }> = [];

    /** `recycle` is handed the group once it has shrunk to nothing. */
    constructor(private _recycle: (obj: THREE.Group) => void) {}

    add(obj: THREE.Group, base = 1): void {
        this._items.push({ obj, base, t: 0 });
    }

    update(dt: number): void {
        for (let i = this._items.length - 1; i >= 0; i--) {
            const item = this._items[i];
            item.t += dt;
            const k = item.t / SHRINK_TIME;
            if (k >= 1) {
                this._items.splice(i, 1);
                this._recycle(item.obj);
                continue;
            }
            // Cubed, so it holds its size for a moment and then goes quickly —
            // a linear shrink reads as the note sinking rather than being taken.
            item.obj.scale.setScalar(item.base * (1 - k) ** 3);
        }
    }

    /** Drops everything in flight straight into the pool. */
    flush(): void {
        for (const item of this._items) this._recycle(item.obj);
        this._items.length = 0;
    }
}

/**
 * Footprint of the packed block `grid()` lays down for `count` bundles.
 *
 * Lives here rather than in `Config.ts` because it is measured off
 * `CASH_STACK`, and `Config` cannot import `procgen/Machines.ts` — Machines
 * already imports `GRAPHICS` from Config, so that way round is a cycle.
 */
export function cashGridFootprint(count: number): PadSize {
    const { cols, rows } = gridShape(count);
    const m = ZONE.startCashMargin * 2;
    return {
        w: cols * CASH_STACK.w + (cols - 1) * PACK_GAP + m,
        d: rows * CASH_STACK.d + (rows - 1) * PACK_GAP + m,
    };
}

/** As square a block as the count allows. The last row runs short. */
function gridShape(count: number): { cols: number; rows: number } {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

interface Pile {
    obj: THREE.Group;
    value: number;
    at: THREE.Vector3;
    /** Bob phase only. Stacks are laid square and stay square. */
    phase: number;
}

/**
 * Loose cash lying on the ground — both the starting stake and everything the
 * shop pays out. Money is never credited automatically: it lands here and the
 * player (or a hired seller) has to physically walk over it.
 */
export class CashField {
    readonly group = new THREE.Group();

    private _piles: Pile[] = [];
    private _pool: THREE.Group[] = [];
    /** Own clock, so the bob stops when the game does. */
    private _t = 0;
    private _shrinking = new ShrinkAway(obj => {
        this.group.remove(obj);
        obj.visible = false;
        this._pool.push(obj);
    });

    get count(): number { return this._piles.length; }

    get total(): number {
        let t = 0;
        for (const p of this._piles) t += p.value;
        return t;
    }

    /**
     * Puts a stack worth `value` on the ground, already settled.
     *
     * There is no arc. Payouts used to be tossed out of a shop and land here,
     * which is what the flight was for, but takings go to a stall's collect pad
     * now and the only cash on the grass is the opening stake — which is meant
     * to be lying there when the game opens, not raining down onto it.
     */
    private _place(x: number, z: number, value: number): void {
        const obj = this._pool.pop() ?? makeCashStack();
        obj.visible = true;
        obj.scale.setScalar(1);
        // Square to the world and left that way. Pooled stacks carry the last
        // angle they were given, so this has to be assigned, not just skipped.
        obj.rotation.y = 0;
        obj.position.set(x, 0.06, z);
        this.group.add(obj);

        this._piles.push({
            obj,
            value,
            at: new THREE.Vector3(x, 0.06, z),
            phase: Math.random() * Math.PI * 2,
        });
    }

    /**
     * Lays `count` stacks out in a packed block centred on `cx, cz`, splitting
     * `value` between them.
     *
     * A block rather than a random spill: this is the opening stake sitting on
     * its own marked pad, and a tidy parcel reads as something laid out for the
     * player to take, where a scatter read as something that had fallen over.
     *
     * Packed to the BUNDLE, not to the pad. The pad is derived from this block
     * (`cashGridFootprint`, which shares `gridShape` with it) rather than the
     * other way round, so the notes are always the same distance apart however
     * many of them `ECONOMY.startCashPiles` asks for. Spacing them as a
     * fraction of the pad instead made six bundles sit in a loose scatter with
     * a metre of grass showing between them.
     */
    grid(cx: number, cz: number, value: number, count: number): void {
        const { cols, rows } = gridShape(count);
        const stepX = CASH_STACK.w + PACK_GAP;
        const stepZ = CASH_STACK.d + PACK_GAP;

        const per = Math.max(1, Math.round(value / count));
        let left = value;
        for (let i = 0; i < count; i++) {
            const amount = i === count - 1 ? left : Math.min(left, per);
            left -= amount;
            if (amount <= 0) break;
            this._place(
                cx + (i % cols - (cols - 1) / 2) * stepX,
                cz + (Math.floor(i / cols) - (rows - 1) / 2) * stepZ,
                amount,
            );
        }
    }

    /**
     * Picks up the single nearest settled stack within `radius`.
     * Returns its value, or 0 if there was nothing to take.
     */
    collectNearest(x: number, z: number, radius: number): number {
        let best = -1;
        let bestD = radius * radius;
        for (let i = 0; i < this._piles.length; i++) {
            const p = this._piles[i];
            const d = (p.at.x - x) ** 2 + (p.at.z - z) ** 2;
            if (d < bestD) { bestD = d; best = i; }
        }
        if (best < 0) return 0;
        const [p] = this._piles.splice(best, 1);
        this.group.remove(p.obj);
        p.obj.visible = false;
        this._pool.push(p.obj);
        return p.value;
    }

    /**
     * Takes the lot. Returns the total, or 0 if there was nothing there.
     *
     * The piles leave `_piles` in the same breath, before the animation has
     * played a frame: `count` is what retires the pad and satisfies the opening
     * tutorial step, and the assistants steer off `nearestPile`, so a bundle
     * still listed while it shrinks is a bundle everything keeps walking back to.
     */
    collectAll(): number {
        let total = 0;
        for (const p of this._piles) {
            total += p.value;
            this._shrinking.add(p.obj);
        }
        this._piles.length = 0;
        return total;
    }

    /** Position of the nearest settled stack, for steering toward loose cash. */
    nearestPile(x: number, z: number): { x: number; z: number } | null {
        let best: Pile | null = null;
        let bestD = Infinity;
        for (const p of this._piles) {
            const d = (p.at.x - x) ** 2 + (p.at.z - z) ** 2;
            if (d < bestD) { bestD = d; best = p; }
        }
        return best ? { x: best.at.x, z: best.at.z } : null;
    }

    update(dt: number): void {
        this._t += dt;
        this._shrinking.update(dt);
        for (const p of this._piles) {
            // A gentle bob so it reads as collectable. Offset per pile, or a
            // grid of them pulses in unison like one object.
            p.obj.position.y = p.at.y + Math.sin(this._t * 3 + p.phase) * 0.06;
        }
    }

    clear(): void {
        this._shrinking.flush();
        for (const p of this._piles) {
            this.group.remove(p.obj);
            p.obj.visible = false;
            this._pool.push(p.obj);
        }
        this._piles.length = 0;
    }
}
