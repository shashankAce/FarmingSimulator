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

    /** Set once the starting cash has been picked up. */
    shopBuilt = false;
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
     * Objectives the player has actually finished (moved on FROM), not merely
     * been shown. The ground arrow is a tutorial aid, so it retires once the
     * core loop below has been completed once.
     */
    private _done = new Set<Objective>();

    private static readonly TUTORIAL: readonly Objective[] = [
        'collect-start-cash', 'harvest-carrots', 'deliver-carrots',
        'collect-bottles', 'sell-bottles', 'collect-earnings',
    ];

    get tutorialDone(): boolean {
        return GameState.TUTORIAL.every(step => this._done.has(step));
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
        // Moving off an objective is what counts as having done it.
        this._done.add(this.objective);
        this.objective = next;
        this.events.dispatchEvent('objective', { objective: next });
    }

    toast(text: string): void {
        this.events.dispatchEvent('toast', { text });
    }
}
