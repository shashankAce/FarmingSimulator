import { Scene } from 'noonengine';
import { ASSISTANT, MACHINE, STATIONS } from '../Config.ts';
import { FARMER_COLORS, SELLER_COLORS } from '../procgen/Character.ts';
import { Actor } from './Actor.ts';
import type { CarrotField } from '../world/CarrotField.ts';
import type { Production } from '../stations/Production.ts';
import type { Shop } from '../stations/Shop.ts';
import type { CashField } from '../stations/Cash.ts';

/** Everything an assistant needs to run the loop without knowing about the scene. */
export interface FarmContext {
    field: CarrotField;
    production: Production;
    shop: Shop;
    cash: CashField;
    /** Credits money directly — used when a seller collects a payout stack. */
    creditMoney(amount: number): void;
}

type FarmerPhase = 'to-field' | 'harvesting' | 'to-juicer' | 'unloading';
type SellerPhase = 'to-rack' | 'loading' | 'to-shop' | 'selling' | 'to-cash' | 'collecting';

/**
 * A hired hand that runs one half of the production loop on its own.
 *
 * Both variants are the same state machine shape: walk to a station, transfer
 * items on a fixed tick, walk to the next one. They deliberately use the same
 * `transferInterval` as the player so automation feels like a second worker
 * rather than a different set of rules.
 */
export class Assistant extends Actor {
    private _ctx: FarmContext;
    private _timer = 0;

    constructor(scene: Scene, ctx: FarmContext, colors: typeof FARMER_COLORS, x: number, z: number) {
        super(scene, colors, { x, z, speed: ASSISTANT.speed, capacity: ASSISTANT.capacity });
        this._ctx = ctx;
    }

    /** Returns true once `transferInterval` has elapsed, resetting the timer. */
    protected tickTransfer(dt: number): boolean {
        this._timer += dt;
        if (this._timer < MACHINE.transferInterval) return false;
        this._timer = 0;
        return true;
    }

    protected get ctx(): FarmContext { return this._ctx; }
}

/** Harvests carrots and feeds the juicer. */
export class FarmerAssistant extends Assistant {
    private _phase: FarmerPhase = 'to-field';
    private _target: { x: number; z: number } | null = null;

    constructor(scene: Scene, ctx: FarmContext) {
        super(scene, ctx, FARMER_COLORS, STATIONS.juicerIn.x + 3, STATIONS.juicerIn.z);
    }

    update(dt: number): void {
        switch (this._phase) {
            case 'to-field': {
                if (!this._target || !this.ctx.field.nearestReady(this._target.x, this._target.z)) {
                    this._target = this.ctx.field.nearestReady(this.x, this.z);
                }
                if (!this._target) {
                    // Nothing ripe — idle at the field edge rather than jittering.
                    this.moveToward(this.ctx.field.minX - 1.5, (this.ctx.field.minZ + this.ctx.field.maxZ) / 2, 1.2);
                    break;
                }
                if (this.moveToward(this._target.x, this._target.z, 1.4)) this._phase = 'harvesting';
                break;
            }
            case 'harvesting': {
                this.setMove(0, 0);
                if (this.stack.isFull) { this._phase = 'to-juicer'; break; }
                if (this.tickTransfer(dt)) {
                    if (this.ctx.field.harvestNearest(this.x, this.z, 2.6) && this.stack.accepts('carrot')) {
                        this.stack.push('carrot');
                    } else {
                        // Patch exhausted: either move on, or go deliver what we have.
                        this._target = null;
                        this._phase = this.stack.isEmpty ? 'to-field' : 'to-juicer';
                    }
                }
                break;
            }
            case 'to-juicer': {
                if (this.moveToward(STATIONS.juicerIn.x, STATIONS.juicerIn.z, 1.2)) this._phase = 'unloading';
                break;
            }
            case 'unloading': {
                this.setMove(0, 0);
                if (this.stack.isEmpty) { this._target = null; this._phase = 'to-field'; break; }
                if (this.tickTransfer(dt)) {
                    // Racks full — wait here holding the load rather than binning it.
                    if (this.ctx.production.acceptCarrot()) this.stack.pop();
                }
                break;
            }
        }
        super.update(dt);
    }
}

/** Carries bottles to the shop, sells them, and collects the payout. */
export class SellerAssistant extends Assistant {
    private _phase: SellerPhase = 'to-rack';

    constructor(scene: Scene, ctx: FarmContext) {
        super(scene, ctx, SELLER_COLORS, STATIONS.rackPickup.x, STATIONS.rackPickup.z + 3);
    }

    update(dt: number): void {
        switch (this._phase) {
            case 'to-rack': {
                if (this.moveToward(STATIONS.rackPickup.x, STATIONS.rackPickup.z, 1.2)) this._phase = 'loading';
                break;
            }
            case 'loading': {
                this.setMove(0, 0);
                if (this.stack.isFull) { this._phase = 'to-shop'; break; }
                if (this.tickTransfer(dt)) {
                    if (this.ctx.production.rackCount > 0 && this.stack.accepts('bottle')) {
                        if (this.ctx.production.takeBottle()) this.stack.push('bottle');
                    } else if (!this.stack.isEmpty) {
                        this._phase = 'to-shop';
                    } else if (this.ctx.cash.count > 0) {
                        // Nothing to carry — go tidy up loose cash instead of idling.
                        this._phase = 'to-cash';
                    }
                }
                break;
            }
            case 'to-shop': {
                if (this.moveToward(STATIONS.shopSell.x, STATIONS.shopSell.z, 1.2)) this._phase = 'selling';
                break;
            }
            case 'selling': {
                this.setMove(0, 0);
                if (this.stack.isEmpty) { this._phase = 'to-cash'; break; }
                if (this.tickTransfer(dt)) {
                    // If the shop somehow isn't open yet, wait here holding the
                    // load rather than dumping it — the sale resolves itself the
                    // moment the stall finishes rising.
                    if (this.ctx.shop.sellBottle()) this.stack.pop();
                }
                break;
            }
            case 'to-cash': {
                if (this.ctx.cash.count === 0) { this._phase = 'to-rack'; break; }
                if (this.moveToward(STATIONS.shopPayout.x, STATIONS.shopPayout.z, 1.0)) this._phase = 'collecting';
                break;
            }
            case 'collecting': {
                this.setMove(0, 0);
                if (this.tickTransfer(dt)) {
                    const value = this.ctx.cash.collectNearest(this.x, this.z, 3.4);
                    if (value > 0) this.ctx.creditMoney(value);
                    else this._phase = 'to-rack';
                }
                break;
            }
        }
        super.update(dt);
    }
}
