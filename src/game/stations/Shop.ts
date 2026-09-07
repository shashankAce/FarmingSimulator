import * as THREE from 'three';
import { Scene } from 'noonengine';
import { ECONOMY, STATIONS, YARD } from '../Config.ts';
import { at, rot } from '../procgen/Primitives.ts';
import { makeBunting, makeConstructionFrame, makeShop } from '../procgen/Structures.ts';
import { CashField } from './Cash.ts';
import { CustomerQueue } from './CustomerQueue.ts';
import type { GameState } from '../GameState.ts';

/**
 * The juice stand on the southern fence line.
 *
 * It doesn't exist at the start of a run — the plot holds scaffolding until the
 * player picks up the starting cash, at which point the stall rises into place
 * and shoppers begin arriving on the far side of the fence.
 *
 * Selling goes through the queue: a bottle is handed to whoever is at the
 * counter, and only a *completed* order pays out, as cash dropped on the payout
 * pad. Nothing is credited automatically.
 */
export class Shop {
    readonly group = new THREE.Group();
    /** Payout stacks land here and must be collected on foot. */
    readonly cash: CashField;
    readonly queue: CustomerQueue;

    private _state: GameState;
    private _frame: THREE.Group;
    private _stall: THREE.Group;
    private _raise = 0;          // 0 = underground, 1 = fully built
    private _building = false;

    constructor(state: GameState, cash: CashField, scene: Scene) {
        this._state = state;
        this.cash = cash;

        this._frame = makeConstructionFrame();
        at(this._frame, STATIONS.shop.x, 0, STATIONS.shop.z);
        this.group.add(this._frame);

        // The stall is authored facing +Z, which is already the customer side —
        // no rotation needed now that it sits on the boundary.
        this._stall = makeShop();
        at(this._stall, STATIONS.shop.x, 0, STATIONS.shop.z);
        this._stall.visible = false;
        this.group.add(this._stall);

        this.group.traverse(o => {
            if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });

        this.queue = new CustomerQueue(scene, bottles => this._payOut(bottles));
        this.group.add(this.queue.group);
    }

    get isBuilt(): boolean { return this._state.shopBuilt && this._raise >= 1; }

    /** Bottles the shopper at the counter still wants — drives the HUD prompt. */
    get frontWants(): number { return this.queue.frontWants; }

    /** Kicks off the build animation. Idempotent. */
    build(): void {
        if (this._building || this._state.shopBuilt) return;
        this._building = true;
        this._state.shopBuilt = true;
        this._stall.visible = true;
        this._frame.visible = false;

        // Bunting along the fence beside the stand, and the first shoppers.
        const flags = makeBunting(14, 16);
        at(flags, STATIONS.shop.x, 0, YARD.maxZ);
        this.group.add(flags);

        this.queue.setActive(true);
        this._state.toast('Juice stand open!');
    }

    /**
     * Hands one bottle over the counter. Fails when the stand isn't built or
     * nobody is waiting — which is what keeps stock from vanishing into nothing.
     */
    sellBottle(): boolean {
        if (!this.isBuilt) return false;
        if (!this.queue.serve()) return false;
        this._state.totalSold++;
        return true;
    }

    update(dt: number): void {
        this.queue.update(dt);

        if (this._building) {
            this._raise = Math.min(1, this._raise + dt * 1.1);
            // Ease-out-back rise: the stall overshoots slightly then settles.
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
    }

    /** Projects the order bubbles onto the 2D layer. */
    updateBubbles(sys: Parameters<CustomerQueue['updateBubbles']>[0]): void {
        this.queue.updateBubbles(sys);
    }

    /** A finished order pays out as cash tossed onto the payout pad. */
    private _payOut(bottles: number): void {
        const value = bottles * ECONOMY.bottleValue;
        this._state.pendingPayout += value;
        this.cash.drop(
            STATIONS.shopPayout.x + (Math.random() - 0.5) * STATIONS.shopPayout.w * 0.7,
            STATIONS.shopPayout.z + (Math.random() - 0.5) * STATIONS.shopPayout.d * 0.7,
            value,
            STATIONS.shop.x, 2.6, STATIONS.shop.z,
        );
    }
}
