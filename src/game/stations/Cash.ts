import * as THREE from 'three';
import { makeCashStack } from '../procgen/Machines.ts';
import { rangeOf } from '../procgen/Primitives.ts';

interface Pile {
    obj: THREE.Group;
    value: number;
    /** Landing animation progress, 0..1. */
    t: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    spin: number;
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

    get count(): number { return this._piles.length; }

    get total(): number {
        let t = 0;
        for (const p of this._piles) t += p.value;
        return t;
    }

    /**
     * Drops a stack worth `value`, arcing from `fromY` above the landing point
     * so payouts look like they're tossed out of the shop rather than teleporting.
     */
    drop(x: number, z: number, value: number, fromX = x, fromY = 2.2, fromZ = z): void {
        const obj = this._pool.pop() ?? makeCashStack();
        obj.visible = true;
        obj.scale.setScalar(1);
        this.group.add(obj);

        const pile: Pile = {
            obj,
            value,
            t: 0,
            from: new THREE.Vector3(fromX, fromY, fromZ),
            to: new THREE.Vector3(x, 0.06, z),
            spin: Math.random() * Math.PI * 2,
        };
        obj.position.copy(pile.from);
        obj.rotation.y = pile.spin;
        this._piles.push(pile);
    }

    /** Scatters `count` stacks over a rectangle, splitting `value` between them. */
    scatter(cx: number, cz: number, w: number, d: number, value: number, count: number): void {
        const per = Math.max(1, Math.round(value / count));
        let left = value;
        for (let i = 0; i < count; i++) {
            const amount = i === count - 1 ? left : Math.min(left, per);
            left -= amount;
            if (amount <= 0) break;
            this.drop(
                cx + rangeOf(Math.random, -w / 2 * 0.75, w / 2 * 0.75),
                cz + rangeOf(Math.random, -d / 2 * 0.75, d / 2 * 0.75),
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
            if (p.t < 1) continue;                 // still in the air
            const d = (p.to.x - x) ** 2 + (p.to.z - z) ** 2;
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
            if (p.t < 1) continue;
            const d = (p.to.x - x) ** 2 + (p.to.z - z) ** 2;
            if (d < bestD) { bestD = d; best = p; }
        }
        return best ? { x: best.to.x, z: best.to.z } : null;
    }

    update(dt: number): void {
        for (const p of this._piles) {
            if (p.t < 1) {
                p.t = Math.min(1, p.t + dt * 1.9);
                // Parabolic hop: lerp across, plus an arc that peaks mid-flight.
                p.obj.position.lerpVectors(p.from, p.to, p.t);
                p.obj.position.y += Math.sin(p.t * Math.PI) * 1.1;
                p.obj.rotation.y = p.spin + p.t * 4;
            } else {
                // Settled: a slow spin and gentle bob so it reads as collectable.
                p.obj.rotation.y += dt * 1.1;
                p.obj.position.y = 0.06 + Math.sin(performance.now() * 0.003 + p.spin) * 0.06;
            }
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
