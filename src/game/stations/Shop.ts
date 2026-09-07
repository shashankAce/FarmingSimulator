import * as THREE from 'three';
import { Scene } from 'noonengine';
import { ECONOMY, QUEUE, SHOP, SHOPS, resolveShop, type ShopPlacement } from '../Config.ts';
import { makeCashStack } from '../procgen/Machines.ts';
import { ShopStock } from './ShopStock.ts';
import { obstacles } from '../world/Obstacles.ts';
import type { CarryLoad } from '../world/CarryLoad.ts';
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
    /** Crates set down beside this stall, which sales draw from. */
    readonly stock: ShopStock;

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

    /** Takings sitting on the counter, one entry per completed order. */
    private _till: Array<{ obj: THREE.Group; value: number }> = [];
    private _tillSlots: THREE.Vector3[] = [];
    private _tillPool: THREE.Group[] = [];
    /** Handle into the shared obstacle field; reshaped when the stall is built. */
    private _colliderId: number;

    constructor(scene: Scene, state: GameState, cash: CashField, index: number) {
        this._state = state;
        this._cash = cash;
        this.index = index;
        this.cost = SHOPS[index].cost;
        this.place = resolveShop(SHOPS[index]);
        this.sellPad = this.place.sellPad;

        const { stall, yaw } = this.place;

        this._frame = makeConstructionFrame(SHOP.frame.w, SHOP.frame.d, SHOP.frame.offset);
        at(rot(this._frame, 0, yaw, 0), stall.x, 0, stall.z);
        this.group.add(this._frame);

        // Blocks the construction deck now, the counter once it's built.
        const fb = this.place.frameBox;
        this._colliderId = obstacles.add(fb.x, fb.z, fb.w, fb.d);

        const built = makeShop();
        this._stall = built.group;
        this._tillSlots = built.cashSlots;
        at(rot(this._stall, 0, yaw, 0), stall.x, 0, stall.z);
        this._stall.visible = false;
        this.group.add(this._stall);

        this.stock = new ShopStock(this.place.dropPad, yaw, SHOP.stockCrates);
        this.group.add(this.stock.group);

        this.group.traverse(o => {
            if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });

        this.queue = new CustomerQueue(scene, this._queueLayout(), b => this._payOut(b), 0x5EED + index * 977);
        this.group.add(this.queue.group);
    }

    get isOpen(): boolean { return this._open && this._raise >= 1; }

    /** Cash waiting on the counter. */
    get tillCount(): number { return this._till.length; }

    get tillValue(): number {
        let v = 0;
        for (const t of this._till) v += t.value;
        return v;
    }

    /**
     * False once the counter is covered — no more sales until it's cleared.
     * Counts orders still in flight, so a burst of completions can't overflow.
     */
    get tillHasRoom(): boolean {
        return this._till.length + this.queue.pendingPayouts < this._tillSlots.length;
    }

    /** 0..1 how full the counter is, for the pad's fill bar. */
    get tillFullness(): number {
        return this._tillSlots.length === 0 ? 0 : this._till.length / this._tillSlots.length;
    }
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

        const cb = this.place.counterBox;
        obstacles.update(this._colliderId, cb.x, cb.z, cb.w, cb.d);

        // Bunting hangs on the fence beside this stall, running along it.
        this._bunting = makeBunting(12, 14);
        const b = this.place.bunting;
        at(rot(this._bunting, 0, b.yaw, 0), b.x, 0, b.z);
        this.group.add(this._bunting);

        this.queue.setActive(true);
    }

    /**
     * One tick of work at this counter:
     *   1. set down a crate you're carrying,
     *   2. serve the shopper at the front from the dropped stock,
     *   3. if that couldn't happen, sweep a stack of takings off the counter.
     *
     * Selling comes BEFORE sweeping on purpose. Sweep-first would empty the
     * till on the same tick it filled, so the cash would never actually be seen
     * on the counter and the limit would never bite. This way takings visibly
     * stack up to the cap, block the stall, and clearing them is what starts it
     * again — while step 3 still drains a counter that has nothing left to sell.
     *
     * Both the player and the hired shopkeeper go through this, so automation
     * plays by exactly the same rules.
     */
    serveTick(load: CarryLoad | null, credit: (value: number) => void): boolean {
        if (!this.isOpen) return false;

        if (load && load.kind === 'bottle' && this.stock.hasRoom) {
            const count = load.popCrate();
            if (count > 0) { this.stock.addCrate(count); return true; }
        }

        if (this._sellOne()) return true;

        // Sweep ONLY when the counter is actually in the way — either it's full
        // and blocking the next sale, or there's nothing left to sell and the
        // takings would otherwise be stranded. Sweeping on every idle tick (the
        // obvious version) empties the till the instant it fills, so the cash is
        // never seen and the limit never means anything.
        const blocking = !this.tillHasRoom;
        const idle = this.stock.bottles === 0;
        if (blocking || idle) {
            const swept = this.collectTill();
            if (swept > 0) { credit(swept); return true; }
        }

        return false;
    }

    /** Takes one stack of cash off the counter. Returns its value, or 0. */
    collectTill(): number {
        const entry = this._till.pop();
        if (!entry) return 0;
        this._stall.remove(entry.obj);
        entry.obj.visible = false;
        this._tillPool.push(entry.obj);
        return entry.value;
    }

    /** True when there is anything here worth walking over for. */
    get needsAttention(): boolean {
        return this.isOpen && (this._till.length > 0 || this.stock.bottles > 0);
    }

    private _sellOne(): boolean {
        if (!this.tillHasRoom) return false;        // counter covered — clear it first
        if (this.stock.bottles <= 0) return false;
        if (!this.queue.serve()) return false;
        this.stock.takeBottle();
        this._state.totalSold++;
        return true;
    }

    update(dt: number): void {
        this.queue.update(dt);
        this.stock.update(dt);
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

    /**
     * A finished order pays out onto the counter rather than the ground. The
     * counter only holds `SHOP.tillSlots` of them, so takings left uncollected
     * eventually stop the stall — which is the whole point of the limit.
     */
    private _payOut(bottles: number): void {
        const value = bottles * ECONOMY.bottleValue;
        this._state.pendingPayout += value;

        if (!this.tillHasRoom) {
            // Shouldn't happen (a full till blocks the sale), but never lose money.
            this._state.addMoney(value);
            return;
        }

        const obj = this._tillPool.pop() ?? makeCashStack();
        obj.visible = true;
        obj.scale.setScalar(0.75);
        obj.position.copy(this._tillSlots[this._till.length]);
        obj.rotation.y = (Math.random() - 0.5) * 0.5;
        // Parented to the stall so it inherits the stall's yaw automatically.
        this._stall.add(obj);
        this._till.push({ obj, value });
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
     * One tick of counter work at whichever open stall the seller is standing
     * on. Nothing happens unless they are actually on a serving pad — dropping
     * stock nearby is not enough to make a sale.
     */
    serveTick(x: number, z: number, load: CarryLoad | null, credit: (value: number) => void,
              radius = 2.4): boolean {
        const stand = this.standAt(x, z, radius);
        return stand ? stand.serveTick(load, credit) : false;
    }

    /** The open stall whose serving pad contains this point, if any. */
    standAt(x: number, z: number, radius = 2.4): ShopStand | null {
        for (const s of this.stands) {
            if (!s.isOpen) continue;
            if (Math.hypot(s.sellPad.x - x, s.sellPad.z - z) <= radius) return s;
        }
        return null;
    }

    /** Nearest open stall with takings on the counter or stock left to sell. */
    nearestNeedingAttention(x: number, z: number): ShopStand | null {
        let best: ShopStand | null = null;
        let bestD = Infinity;
        for (const s of this.stands) {
            if (!s.needsAttention) continue;
            const d = (s.sellPad.x - x) ** 2 + (s.sellPad.z - z) ** 2;
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }

    /** Total cash sitting uncollected across every counter — drives the HUD. */
    get tillTotal(): number {
        let v = 0;
        for (const s of this.stands) v += s.tillValue;
        return v;
    }

    update(dt: number): void {
        for (const s of this.stands) s.update(dt);
    }

    updateBubbles(sys: Parameters<CustomerQueue['updateBubbles']>[0]): void {
        for (const s of this.stands) s.queue.updateBubbles(sys);
    }
}
