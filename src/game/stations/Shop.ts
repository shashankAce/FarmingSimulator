import * as THREE from 'three';
import { Scene } from 'noonengine';
import { ECONOMY, QUEUE, SHOP, SHOPS, resolveShop, type ShopPlacement } from '../Config.ts';
import { at, rot } from '../procgen/Primitives.ts';
import { makeBunting, makeConstructionFrame, makeShop } from '../procgen/Structures.ts';
import { CashField } from './Cash.ts';
import { CustomerQueue, type QueueLayout } from './CustomerQueue.ts';
import type { GameState } from '../GameState.ts';

/**
 * One juice stand: a stall on some edge of the yard, the queue outside it, and
 * the unlock state that gates it.
 *
 * Nothing here knows which fence it's on — `resolveShop()` turns the stall's
 * `{ side, along }` config into every position it needs, so stalls can be
 * placed on any edge without touching this class.
 *
 * The first stand opens for free with the starting cash; the rest are paid off
 * by standing on their own serving pad, which doubles as the construction pad
 * until the stall is up.
 */
export class ShopStand {
    readonly group = new THREE.Group();
    readonly index: number;
    readonly cost: number;
    /** Fully resolved world placement for this stall. */
    readonly place: ShopPlacement;
    /** Where the player stands to build, then to serve. */
    readonly sellPad: { x: number; z: number };
    readonly queue: CustomerQueue;

    /** Money sunk into unlocking this stand so far. */
    paid = 0;

    private _state: GameState;
    private _cash: CashField;
    private _frame: THREE.Group;
    private _stall: THREE.Group;
    private _bunting: THREE.Group | null = null;
    private _raise = 0;
    private _building = false;
    private _open = false;

    constructor(scene: Scene, state: GameState, cash: CashField, index: number) {
        this._state = state;
        this._cash = cash;
        this.index = index;
        this.cost = SHOPS[index].cost;
        this.place = resolveShop(SHOPS[index]);
        this.sellPad = this.place.sellPad;

        const { stall, yaw } = this.place;

        this._frame = makeConstructionFrame();
        at(rot(this._frame, 0, yaw, 0), stall.x, 0, stall.z);
        this.group.add(this._frame);

        this._stall = makeShop();
        at(rot(this._stall, 0, yaw, 0), stall.x, 0, stall.z);
        this._stall.visible = false;
        this.group.add(this._stall);

        this.group.traverse(o => {
            if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });

        this.queue = new CustomerQueue(scene, this._queueLayout(), b => this._payOut(b), 0x5EED + index * 977);
        this.group.add(this.queue.group);
    }

    get isOpen(): boolean { return this._open && this._raise >= 1; }
    get isBuilding(): boolean { return this._building; }
    get frontWants(): number { return this.queue.frontWants; }

    /** 0..1 unlock progress, for the pad's fill bar. */
    get unlockProgress(): number {
        return this.cost <= 0 ? 1 : Math.min(1, this.paid / this.cost);
    }

    /** Starts the build animation. Idempotent. */
    build(): void {
        if (this._building || this._open) return;
        this._building = true;
        this._open = true;
        this._stall.visible = true;
        this._frame.visible = false;

        // Bunting hangs on the fence beside this stall, running along it.
        this._bunting = makeBunting(12, 14);
        const b = this.place.bunting;
        at(rot(this._bunting, 0, b.yaw, 0), b.x, 0, b.z);
        this.group.add(this._bunting);

        this.queue.setActive(true);
    }

    /** Hands one bottle over the counter; false when nobody is waiting. */
    sellBottle(): boolean {
        if (!this.isOpen) return false;
        if (!this.queue.serve()) return false;
        this._state.totalSold++;
        return true;
    }

    update(dt: number): void {
        this.queue.update(dt);
        if (!this._building) return;

        this._raise = Math.min(1, this._raise + dt * 1.1);
        const p = this._raise;
        const eased = 1 + 2.0 * Math.pow(p - 1, 3) + 1.1 * Math.pow(p - 1, 2);
        this._stall.position.y = (eased - 1) * 0.9;
        this._stall.scale.set(1, Math.max(0.05, eased), 1);

        if (this._raise >= 1) {
            this._stall.position.y = 0;
            this._stall.scale.set(1, 1, 1);
            this._building = false;
        }
    }

    private _queueLayout(): QueueLayout {
        const q = this.place.queue;
        return {
            counter: this.place.counter,
            slot0: q.slot0,
            step: q.step,
            slots: QUEUE.slots,
            spawn: q.spawn,
            exit: q.exit,
        };
    }

    /** A finished order pays out as cash tossed onto the player's side of the fence. */
    private _payOut(bottles: number): void {
        const value = bottles * ECONOMY.bottleValue;
        this._state.pendingPayout += value;
        // Cash lands on the player's side of the counter, a little further in
        // again from the serving pad so it never covers the pad's own markings.
        const p = this.place;
        const inward = {
            x: (p.sellPad.x - p.stall.x) / SHOP.sellDistance,
            z: (p.sellPad.z - p.stall.z) / SHOP.sellDistance,
        };
        this._cash.drop(
            p.sellPad.x + inward.x * 1.9 + (Math.random() - 0.5) * 1.6,
            p.sellPad.z + inward.z * 1.9 + (Math.random() - 0.5) * 1.6,
            value,
            p.stall.x, 2.6, p.stall.z,
        );
    }
}

/**
 * All the stands together. Selling routes to whichever stand the seller is
 * standing at, so the player's trip is the same regardless of how many are open.
 */
export class ShopRow {
    readonly group = new THREE.Group();
    readonly stands: ShopStand[] = [];
    readonly cash: CashField;

    constructor(scene: Scene, state: GameState, cash: CashField) {
        this.cash = cash;
        for (let i = 0; i < SHOPS.length; i++) {
            const stand = new ShopStand(scene, state, cash, i);
            this.stands.push(stand);
            this.group.add(stand.group);
        }
    }

    /** The free first stand, opened by collecting the starting cash. */
    openFirst(): void { this.stands[0].build(); }

    get anyOpen(): boolean { return this.stands.some(s => s.isOpen); }

    get openCount(): number { return this.stands.filter(s => s.isOpen).length; }

    /** The open stand nearest a point — where an assistant should head. */
    nearestOpen(x: number, z: number): ShopStand | null {
        let best: ShopStand | null = null;
        let bestD = Infinity;
        for (const s of this.stands) {
            if (!s.isOpen) continue;
            const d = (s.sellPad.x - x) ** 2 + (s.sellPad.z - z) ** 2;
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }

    /** The next stand the player could pay to unlock, if any. */
    nextLocked(): ShopStand | null {
        return this.stands.find(s => !s.isOpen && !s.isBuilding) ?? null;
    }

    /**
     * Sells one bottle at whichever open stand the seller is standing on.
     * Kept for callers that only know a position (the assistants).
     */
    sellNear(x: number, z: number, radius = 2.6): boolean {
        for (const s of this.stands) {
            if (!s.isOpen) continue;
            if (Math.hypot(s.sellPad.x - x, s.sellPad.z - z) > radius) continue;
            if (s.sellBottle()) return true;
        }
        return false;
    }

    update(dt: number): void {
        for (const s of this.stands) s.update(dt);
    }

    updateBubbles(sys: Parameters<CustomerQueue['updateBubbles']>[0]): void {
        for (const s of this.stands) s.queue.updateBubbles(sys);
    }
}
