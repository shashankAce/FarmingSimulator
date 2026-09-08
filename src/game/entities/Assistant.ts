import * as THREE from 'three';
import { Scene } from 'noonengine';
import { ASSISTANT, CARRY, HARVEST, MACHINE, STATIONS } from '../Config.ts';
import { FARMER_COLORS, SELLER_COLORS, giveKukri } from '../procgen/Character.ts';
import { Actor } from './Actor.ts';
import { CARROT_PICK_Y, type CarrotField } from '../world/CarrotField.ts';
import type { Production } from '../stations/Production.ts';
import type { ShopRow } from '../stations/Shop.ts';
import type { CashField } from '../stations/Cash.ts';

/** Everything an assistant needs to run the loop without knowing about the scene. */
export interface FarmContext {
    field: CarrotField;
    production: Production;
    /** Every stand; the seller picks whichever open one is nearest. */
    shops: ShopRow;
    cash: CashField;
    /** Credits money directly — used when a seller collects a payout stack. */
    creditMoney(amount: number): void;
}

type FarmerPhase = 'to-field' | 'harvesting' | 'to-juicer' | 'unloading';
type SellerPhase = 'to-rack' | 'loading' | 'to-shop' | 'selling'
    | 'to-till' | 'sweeping' | 'to-cash' | 'collecting';

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
        super(scene, colors, { x, z, speed: ASSISTANT.speed, capacity: CARRY.assistantCrates });
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
        // Farmhands cut too, so they carry the same blade the player does.
        giveKukri(this.rig);
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
                // Full — but stay put until the last cut has actually gone in.
                // Walking off mid-intake strings the carrots out behind them,
                // since each one sets off from the ground it grew in.
                if (!this.load.accepts('carrot')) {
                    if (!this.midHarvest) this._phase = 'to-juicer';
                    break;
                }

                // Its own clock, not the shared transfer tick: one sweep of the
                // blade takes `HARVEST.interval` and takes everything it reaches.
                this.harvestTimer = Math.max(0, this.harvestTimer - dt);
                if (this.harvestTimer > 0) break;
                this.harvestTimer = HARVEST.interval;

                const room = this.load.roomFor('carrot');
                // Looked up now, taken when the blade lands — see `Actor.sweep`.
                const ripe = this.ctx.field.ripeInArc(
                    this.x, this.z, HARVEST.radius, this.yaw,
                    (HARVEST.arcDeg * Math.PI) / 360, room);
                if (ripe.length === 0) {
                    // Patch exhausted: either move on, or go deliver what we
                    // have — once whatever is still in the air has landed.
                    // The blade's clock is put back to zero so the wait is
                    // re-checked next frame rather than on the next swing,
                    // which would idle here for up to `HARVEST.interval`
                    // after the last carrot went in.
                    if (this.midHarvest) { this.harvestTimer = 0; break; }
                    this._target = null;
                    this._phase = this.load.isEmpty ? 'to-field' : 'to-juicer';
                    break;
                }
                this.sweep(() => {
                    this.ctx.field.cutAt(ripe).forEach((spot, i) => {
                        this.load.push('carrot', new THREE.Vector3(spot.x, CARROT_PICK_Y, spot.z),
                            HARVEST.settle + i * HARVEST.stagger);
                    });
                });
                break;
            }
            case 'to-juicer': {
                if (this.moveToward(STATIONS.juicerIn.x, STATIONS.juicerIn.z, 1.2)) this._phase = 'unloading';
                break;
            }
            case 'unloading': {
                this.setMove(0, 0);
                if (this.load.isEmpty) { this._target = null; this._phase = 'to-field'; break; }
                if (this.tickTransfer(dt)) {
                    // Stand full — wait here holding the load rather than binning it.
                    if (this.ctx.production.acceptCarrot()) this.load.pop();
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
    /** The stall this one was hired at; it works that counter and no other. */
    private _homeIndex: number;

    constructor(scene: Scene, ctx: FarmContext, homeIndex: number) {
        super(scene, ctx, SELLER_COLORS, STATIONS.rackPickup.x, STATIONS.rackPickup.z + 3);
        this._homeIndex = homeIndex;
    }

    /** Its own stall while that is open, otherwise whichever open one is nearest. */
    private get _stand() {
        const home = this.ctx.shops.stands[this._homeIndex];
        return home?.isOpen ? home : this.ctx.shops.nearestOpen(this.x, this.z);
    }

    update(dt: number): void {
        switch (this._phase) {
            case 'to-rack': {
                if (this.moveToward(STATIONS.rackPickup.x, STATIONS.rackPickup.z, 1.2)) this._phase = 'loading';
                break;
            }
            case 'loading': {
                this.setMove(0, 0);
                if (!this.load.canAdopt('bottle')) { this._phase = 'to-shop'; break; }
                if (this.tickTransfer(dt)) {
                    if (this.ctx.production.readyRackCount > 0) {
                        // Whole racks are the unit of transport now.
                        const bottles = this.ctx.production.takeRack();
                        if (bottles > 0) this.load.adoptFilled('bottle', bottles);
                    } else if (!this.load.isEmpty) {
                        this._phase = 'to-shop';
                    } else if (this.ctx.cash.count > 0) {
                        // Nothing to carry — go tidy up loose cash instead of idling.
                        this._phase = 'to-cash';
                    }
                }
                break;
            }
            case 'to-shop': {
                const stand = this._stand;
                if (!stand) { this.setMove(0, 0); break; }   // nothing open yet — hold the load
                if (this.moveToward(stand.sellPad.x, stand.sellPad.z, 1.2)) this._phase = 'selling';
                break;
            }
            case 'selling': {
                this.setMove(0, 0);
                const stand = this.ctx.shops.standAt(this.x, this.z);
                // Two ways this ends, and BOTH have to lead to the takings pad.
                // Sweeping is no longer part of serving, so a counter that fills
                // mid-shift can no longer clear itself: without the `blocked`
                // test the seller stands at a jammed stall forever, unable to
                // sell and with no reason to leave.
                const blocked = !!stand && stand.hasTakings && !stand.tillHasRoom;
                const finished = this.load.isEmpty && (!stand || !stand.hasStock);
                if (blocked || finished) {
                    this._phase = 'to-till';
                    break;
                }
                if (this.tickTransfer(dt)) {
                    this.ctx.shops.serveTick(this.x, this.z, this.load,
                        value => this.ctx.creditMoney(value));
                }
                break;
            }
            case 'to-till': {
                // Bank the counter before wandering off; leaving it covered is
                // what jams the stall for everyone else.
                const stand = this._stand;
                if (!stand || !stand.hasTakings) { this._phase = 'to-cash'; break; }
                const pad = stand.place.collectPad;
                if (this.moveToward(pad.x, pad.z, 1.2)) this._phase = 'sweeping';
                break;
            }
            case 'sweeping': {
                this.setMove(0, 0);
                if (!this.tickTransfer(dt)) break;

                if (this.ctx.shops.collectTick(this.x, this.z, v => this.ctx.creditMoney(v))) break;

                // Counter clear. If it was only the till that stopped the shift,
                // go straight back and finish selling rather than walking the
                // whole loop for stock that is already on the ground.
                const stand = this._stand;
                if (!this.load.isEmpty || (stand && stand.hasStock)) this._phase = 'to-shop';
                else if (this.ctx.production.readyRackCount > 0) this._phase = 'to-rack';
                else this._phase = 'to-cash';
                break;
            }
            case 'to-cash': {
                const pile = this.ctx.cash.nearestPile(this.x, this.z);
                if (!pile) { this._phase = 'to-rack'; break; }
                if (this.moveToward(pile.x, pile.z, 1.0)) this._phase = 'collecting';
                break;
            }
            case 'collecting': {
                this.setMove(0, 0);
                if (this.tickTransfer(dt)) {
                    const value = this.ctx.cash.collectNearest(this.x, this.z, 2.6);
                    if (value > 0) this.ctx.creditMoney(value);
                    else this._phase = this.ctx.cash.count > 0 ? 'to-cash' : 'to-rack';
                }
                break;
            }
        }
        super.update(dt);
    }
}
