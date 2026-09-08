import * as THREE from 'three';
import { makeCashStack } from '../procgen/Machines.ts';

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
     * Lays `count` stacks out in a grid centred on `cx, cz`, splitting `value`
     * between them.
     *
     * A grid rather than a random spill: this is the opening stake sitting on
     * its own marked pad, and a tidy block reads as something laid out for the
     * player to take, where a scatter read as something that had fallen over.
     * The grid is as square as the count allows, kept inside three quarters of
     * the pad so no stack sits on the markings.
     */
    grid(cx: number, cz: number, w: number, d: number, value: number, count: number): void {
        const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
        const rows = Math.max(1, Math.ceil(count / cols));
        const stepX = (w * 0.75) / cols;
        const stepZ = (d * 0.75) / rows;

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
        for (const p of this._piles) {
            // A gentle bob so it reads as collectable. Offset per pile, or a
            // grid of them pulses in unison like one object.
            p.obj.position.y = p.at.y + Math.sin(this._t * 3 + p.phase) * 0.06;
        }
    }

    clear(): void {
        for (const p of this._piles) {
            this.group.remove(p.obj);
            p.obj.visible = false;
            this._pool.push(p.obj);
        }
        this._piles.length = 0;
    }
}
