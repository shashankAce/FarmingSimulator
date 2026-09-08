import * as THREE from 'three';
import { Scene } from 'noonengine';
import { ECONOMY, QUEUE, SHOP, SHOPS, resolveShop, type ShopPlacement } from '../Config.ts';
import { CASH_STACK, makeCashStack } from '../procgen/Machines.ts';
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
/** Size the takings are shown at on the collect pad. */
const TILL_SCALE = 0.75;

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

    /** Takings waiting on the collect pad, one entry per completed order. */
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

        this._stall = makeShop();
        this._tillSlots = this._tillLayout();
        at(rot(this._stall, 0, yaw, 0), stall.x, 0, stall.z);
        this._stall.visible = false;
        this.group.add(this._stall);

        this.stock = new ShopStock(this.place.stockPad, yaw, SHOP.stockCrates, SHOP.counterTop);
        this.group.add(this.stock.group);

        this.group.traverse(o => {
            if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });

        this.queue = new CustomerQueue(scene, this._queueLayout(), b => this._payOut(b), 0x5EED + index * 977);
        this.group.add(this.queue.group);
    }

    get isOpen(): boolean { return this._open && this._raise >= 1; }

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

    get isBuilding(): boolean { return this._building; }
    get frontWants(): number { return this.queue.frontWants; }

    /** 0..1 how stocked this stall is, for the serving pad's fill bar. */
    get stockFullness(): number { return this.stock.fullness; }

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
     *   2. serve the shopper at the front from the dropped stock.
     *
     * Sweeping the takings is deliberately NOT here — it lives on its own pad
     * (`collectPad` / `collectTick`), so a counter that fills up has to be
     * walked to and cleared instead of draining itself under whoever happens to
     * be serving. That is the whole point of the till cap: it is the thing that
     * turns a stocked stall into a job rather than a machine.
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

        return this._sellOne();
    }

    /** One tick at the takings pad: lift a single stack and bank it. */
    collectTick(credit: (value: number) => void): boolean {
        if (!this.isOpen) return false;
        const swept = this.collectTill();
        if (swept <= 0) return false;
        credit(swept);
        return true;
    }

    /** Takes one stack of cash off the counter. Returns its value, or 0. */
    collectTill(): number {
        const entry = this._till.pop();
        if (!entry) return 0;
        this.group.remove(entry.obj);
        entry.obj.visible = false;
        this._tillPool.push(entry.obj);
        return entry.value;
    }

    /** Cash on the counter waiting to be swept at the takings pad. */
    get hasTakings(): boolean { return this._till.length > 0; }

    /**
     * Every slot physically occupied. Distinct from `!tillHasRoom`, which also
     * reserves space for orders still in flight — that one gates sales, this
     * one is what the player can actually see on the pad.
     */
    get tillFull(): boolean { return this._till.length >= this._tillSlots.length; }

    /** Bottles left to sell here. */
    get hasStock(): boolean { return this.stock.bottles > 0; }

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
     * Where each stack of takings sits on the collect pad.
     *
     * A grid, not the old row along the counter top: the pad is nearly square,
     * so four in a line would hang off both ends of it.
     *
     * Laid out in the PAD's frame and then turned by the stall's yaw, because
     * the pad it sits on is turned too — a world-axis grid on a rotated pad
     * puts the cash at an angle to the markings under it. Columns run along the
     * counter, rows step back from it.
     */
    private _tillLayout(): THREE.Vector3[] {
        const pad = this.place.collectPad;
        const cols = Math.max(1, SHOP.tillCols);
        const rows = Math.max(1, SHOP.tillRows);
        const perLayer = cols * rows;
        // Spaced off the bundle, so the grid packs tight whatever size the pad
        // happens to be.
        const stepX = CASH_STACK.w * TILL_SCALE + SHOP.tillGap;
        const stepZ = CASH_STACK.d * TILL_SCALE + SHOP.tillGap;
        const cos = Math.cos(this.place.padYaw);
        const sin = Math.sin(this.place.padYaw);

        const slots: THREE.Vector3[] = [];
        for (let i = 0; i < SHOP.tillSlots; i++) {
            // Fill the grid, then start a second layer on top of the first.
            const n = i % perLayer;
            const lx = (n % cols - (cols - 1) / 2) * stepX;
            const lz = (Math.floor(n / cols) - (rows - 1) / 2) * stepZ;
            slots.push(new THREE.Vector3(
                pad.x + cos * lx + sin * lz,
                Math.floor(i / perLayer) * SHOP.tillLayer,
                pad.z - sin * lx + cos * lz,
            ));
        }
        return slots;
    }

    /**
     * A finished order pays out onto the collect pad rather than the ground.
     * The pad only holds `SHOP.tillSlots` of them, so takings left uncollected
     * eventually stop the stall — which is the whole point of the limit.
     */
    private _payOut(bottles: number): void {
        const value = bottles * ECONOMY.bottleValue;
        this._state.pendingPayout += value;

        // Physical slots, NOT `tillHasRoom`. That predicate also reserves room
        // for orders still in flight, and a shopper is still counted as one at
        // the instant they pay (`_onPay` runs while they are celebrating, one
        // line before their phase flips). Testing it here meant every payout
        // landing on the last free slot took the "never lose money" branch and
        // banked itself, so the HUD total climbed with nobody at the pad.
        if (this._till.length >= this._tillSlots.length) {
            this._state.addMoney(value);
            return;
        }

        const obj = this._tillPool.pop() ?? makeCashStack();
        obj.visible = true;
        obj.scale.setScalar(TILL_SCALE);
        obj.position.copy(this._tillSlots[this._till.length]);
        // Square to the grid, which is itself turned with the stall. Pooled
        // stacks carry the last angle they were given, so this has to be
        // assigned rather than left alone.
        obj.rotation.y = this.place.padYaw;
        // Parented to the stand, not the stall: these sit on world-axis pad
        // slots and must not pick up the stall's yaw.
        this.group.add(obj);
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
     * The stall currently rising out of its plot, if any.
     *
     * Distinct from `nextLocked`, which deliberately skips it — a stall being
     * built is already paid for and is not something to send the player at. It
     * is still what the player is LOOKING at, though, which is what this is for.
     */
    building(): ShopStand | null {
        return this.stands.find(s => s.isBuilding) ?? null;
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

    /**
     * One tick of sweeping at whichever open stall's TAKINGS pad this point is
     * on. Separate from `serveTick` so serving and banking cannot happen from
     * the same spot.
     */
    collectTick(x: number, z: number, credit: (value: number) => void, radius = 2.4): boolean {
        const stand = this.standAtCollect(x, z, radius);
        return stand ? stand.collectTick(credit) : false;
    }

    /** The open stall whose takings pad contains this point, if any. */
    standAtCollect(x: number, z: number, radius = 2.4): ShopStand | null {
        for (const s of this.stands) {
            if (!s.isOpen) continue;
            if (Math.hypot(s.place.collectPad.x - x, s.place.collectPad.z - z) <= radius) return s;
        }
        return null;
    }

    /** Nearest open stall with cash waiting on the counter. */
    nearestWithTakings(x: number, z: number): ShopStand | null {
        let best: ShopStand | null = null;
        let bestD = Infinity;
        for (const s of this.stands) {
            if (!s.isOpen || !s.hasTakings) continue;
            const d = (s.place.collectPad.x - x) ** 2 + (s.place.collectPad.z - z) ** 2;
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }

    /** The open stall whose serving pad contains this point, if any. */
    standAt(x: number, z: number, radius = 2.4): ShopStand | null {
        for (const s of this.stands) {
            if (!s.isOpen) continue;
            if (Math.hypot(s.sellPad.x - x, s.sellPad.z - z) <= radius) return s;
        }
        return null;
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
