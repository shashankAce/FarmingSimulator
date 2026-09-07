import { EventDispatcher } from 'noonengine';
import { ECONOMY } from './Config.ts';

/** Progression gates, in the order the player unlocks them. */
export type Objective =
    | 'collect-start-cash'
    | 'harvest-carrots'
    | 'deliver-carrots'
    | 'collect-bottles'
    | 'sell-bottles'
    | 'collect-earnings'
    | 'unlock-shop'
    | 'expand';

/**
 * Central mutable game state plus the event bus everything else listens on.
 *
 * Keeping this separate from the scene means the HUD, the stations and the
 * assistants all react to the same signals instead of reaching into each other.
 */
export class GameState {
    readonly events = new EventDispatcher();

    private _money = 0;

    /** Set once the starting cash has been picked up. */
    shopBuilt = false;
    farmerHired = false;
    sellerHired = false;

    /** Carrots waiting in the juicer's hopper. */
    carrotsQueued = 0;
    /** Finished bottles sitting in the racks. */
    bottlesStocked = 0;
    /** Cash piles dropped beside the shop, waiting to be walked over. */
    pendingPayout = 0;

    /** Progress toward each upgrade, paid gradually while standing on its pad. */
    farmerPaid = 0;
    sellerPaid = 0;

    /** Lifetime counters, for the HUD. */
    totalHarvested = 0;
    totalSold = 0;

    objective: Objective = 'collect-start-cash';

    get money(): number { return this._money; }

    addMoney(amount: number): void {
        this._money += amount;
        this.events.dispatchEvent('money', { money: this._money, delta: amount });
    }

    /** Spends if affordable; returns whether the purchase went through. */
    trySpend(amount: number): boolean {
        if (this._money < amount) return false;
        this._money -= amount;
        this.events.dispatchEvent('money', { money: this._money, delta: -amount });
        return true;
    }

    setObjective(next: Objective): void {
        if (this.objective === next) return;
        this.objective = next;
        this.events.dispatchEvent('objective', { objective: next });
    }

    toast(text: string): void {
        this.events.dispatchEvent('toast', { text });
    }

    /** Cost of the next upgrade the player hasn't bought, or null when fully upgraded. */
    nextUpgradeCost(): number | null {
        if (!this.farmerHired) return ECONOMY.farmerCost;
        if (!this.sellerHired) return ECONOMY.sellerCost;
        return null;
    }
}
