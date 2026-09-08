import { EventDispatcher } from 'noonengine';

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

    /** Staff on the payroll — one of each may be hired per shop. */
    farmhands = 0;
    shopkeepers = 0;
    /** Juicer speed tier; indexes `MACHINE_UPGRADE.processTime`. */
    machineLevel = 0;

    /** Carrots waiting in the juicer's hopper. */
    carrotsQueued = 0;
    /** Finished bottles sitting in the racks. */
    bottlesStocked = 0;
    /** Cash piles dropped beside the shop, waiting to be walked over. */
    pendingPayout = 0;

    /** Lifetime counters, for the HUD. */
    totalHarvested = 0;
    totalSold = 0;

    objective: Objective = 'collect-start-cash';

    /**
     * Times the player has swept a stall's counter. This is the last beat of
     * the loop and it implies every earlier one — there are no takings without
     * a sale, no sale without stock, and no stock without a carrot — so one is
     * proof of a full cycle.
     */
    takingsBanked = 0;

    /**
     * The ground arrow is a tutorial aid and retires after one full cycle.
     *
     * Derived from an action, deliberately, rather than from a checklist of
     * objectives the player was seen to LEAVE. That checklist never completed:
     * `collect-earnings` is skipped whenever the counter happens to be empty at
     * the moment the objective is recomputed — a shopper mid-celebration has
     * not paid yet — so the flow could run start to end with the arrow still on.
     */
    get tutorialDone(): boolean {
        return this.takingsBanked > 0;
    }

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
}
