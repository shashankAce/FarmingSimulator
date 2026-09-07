import { GlobalEvents, Graphics, Label, Node, Scene, display } from 'noonengine';
import type { GameState, Objective } from '../GameState.ts';

const OBJECTIVE_TEXT: Record<Objective, string> = {
    'collect-start-cash': 'Grab the cash!',
    'harvest-carrots': 'Harvest some carrots',
    'deliver-carrots': 'Tip the carrots into the juicer',
    'collect-bottles': 'Grab bottles from the rack',
    'sell-bottles': 'Sell the juice at your shop',
    'collect-earnings': 'Collect your earnings',
    'expand': 'Hire a helper',
};

/**
 * The 2D overlay: money counter, objective line, stock readout and toasts.
 *
 * This is ordinary NoonEngine 2D content living in the same `Scene` as the 3D
 * world — the engine composites the Three.js pass underneath the 2D pass, so no
 * separate UI scene or camera is needed.
 */
export class Hud {
    private _moneyLabel: Label;
    private _objectiveLabel: Label;
    private _objectiveShadow: Label;
    private _stockLabel: Label;
    private _toastLabel: Label;
    private _toastNode: Node;
    private _toastTimer = 0;

    private _pill: Node;
    private _objWrap: Node;
    private _stockNode: Node;
    /** Baseline Y of the toast, recomputed on resize; the rise animation offsets from it. */
    private _toastBaseY = 0;

    constructor(scene: Scene, state: GameState) {
        // ── Money pill, pinned to the top-right ──
        const pill = new Node();
        this._pill = pill;
        const pillGfx = pill.addComponent(Graphics);
        pillGfx.setLineWidth(6);
        pillGfx.drawRoundedRectangle(210, 74, 37, '#5a3a22', '#c9a15e');
        pill.zIndex = 1000;
        scene.addChild(pill);

        // Banknote glyph inside the pill.
        const note = new Node(-60, 0);
        const noteGfx = note.addComponent(Graphics);
        noteGfx.setLineWidth(4);
        noteGfx.drawRoundedRectangle(54, 36, 8, '#66c65a', '#f4f7e8');
        pill.addChild(note);

        const moneyNode = new Node(24, 0);
        this._moneyLabel = moneyNode.addComponent(Label);
        this._moneyLabel.text = '0';
        this._moneyLabel.fontSize = 42;
        this._moneyLabel.fontWeight = 800;
        this._moneyLabel.color = '#ffffff';
        this._moneyLabel.textAlign = 'center';
        // Counters change every frame they tick — bake synchronously to avoid lag.
        this._moneyLabel.dynamic = true;
        pill.addChild(moneyNode);

        // ── Objective line, centred under the top edge ──
        const objWrap = new Node();
        this._objWrap = objWrap;
        objWrap.zIndex = 999;
        scene.addChild(objWrap);

        // Label has no stroke property, so the outlined look from the reference
        // is faked with a dark copy offset behind the light one.
        const shadowNode = new Node(3, -4);
        this._objectiveShadow = shadowNode.addComponent(Label);
        objWrap.addChild(shadowNode);

        const objNode = new Node(0, 0);
        this._objectiveLabel = objNode.addComponent(Label);
        objWrap.addChild(objNode);

        for (const [lbl, color] of [
            [this._objectiveShadow, '#4a2c15'],
            [this._objectiveLabel, '#ffffff'],
        ] as Array<[Label, string]>) {
            lbl.text = OBJECTIVE_TEXT[state.objective];
            lbl.fontSize = 30;
            lbl.fontWeight = 800;
            lbl.color = color;
            lbl.textAlign = 'center';
        }

        // ── Stock readout, bottom-left ──
        const stockNode = new Node();
        this._stockNode = stockNode;
        this._stockLabel = stockNode.addComponent(Label);
        this._stockLabel.text = '';
        this._stockLabel.fontSize = 24;
        this._stockLabel.fontWeight = 700;
        this._stockLabel.color = '#ffffff';
        this._stockLabel.textAlign = 'left';
        // Anchor the node's LEFT edge, not its centre — otherwise a left-aligned
        // label still straddles its position and runs off the visible rect.
        stockNode.anchorX = 0;
        this._stockLabel.dynamic = true;
        stockNode.zIndex = 999;
        scene.addChild(stockNode);

        // ── Toast ──
        this._toastNode = new Node();
        this._toastNode.zIndex = 1001;
        this._toastLabel = this._toastNode.addComponent(Label);
        this._toastLabel.text = '';
        this._toastLabel.fontSize = 44;
        this._toastLabel.fontWeight = 800;
        this._toastLabel.color = '#ffe9a8';
        this._toastLabel.textAlign = 'center';
        scene.addChild(this._toastNode);

        // ── Wire up state signals ──
        state.events.on('money', (e: { money: number }) => {
            this._moneyLabel.text = String(Math.floor(e.money));
        }, this);

        state.events.on('objective', (e: { objective: Objective }) => {
            const text = OBJECTIVE_TEXT[e.objective];
            this._objectiveLabel.text = text;
            this._objectiveShadow.text = text;
        }, this);

        state.events.on('toast', (e: { text: string }) => {
            this._toastLabel.text = e.text;
            this._toastTimer = 2.4;
            this._toastNode.setScale(1, 1);
        }, this);

        this._moneyLabel.text = String(state.money);

        this._layout();
        display.emitter.on(GlobalEvents.RESIZE, this._layout, this);
    }

    /**
     * Positions the HUD inside the *visible* design rect rather than the full
     * design resolution. Under FIXED_HEIGHT the design box stays 720x1280, but a
     * narrow phone crops it horizontally — `getVisibleRect()` is what's actually
     * on screen, so anchoring to it keeps the corners reachable on every aspect.
     */
    private _layout(): void {
        const r = display.getVisibleRect();
        const left = r.x;
        const right = r.x + r.width;
        const top = r.y + r.height;
        const bottom = r.y;
        const centerX = r.x + r.width / 2;

        this._pill.setPosition({ x: right - 130, y: top - 60 });
        this._objWrap.setPosition({ x: centerX, y: top - 150 });
        // Sits clear of the engine's own dev FPS overlay in the bottom-left corner.
        this._stockNode.setPosition({ x: left + 24, y: bottom + 70 });

        this._toastBaseY = r.y + r.height * 0.62;
        this._toastNode.setPosition({ x: centerX, y: this._toastBaseY });
    }

    /** Refreshes the per-frame readouts. */
    update(dt: number, state: GameState, rackCount: number, rackCapacity: number): void {
        const carried = state.carrotsQueued;
        this._stockLabel.text =
            `Hopper ${carried}    Racks ${rackCount}/${rackCapacity}    Sold ${state.totalSold}`;

        if (this._toastTimer > 0) {
            this._toastTimer -= dt;
            // Rise and shrink away rather than fading — an opacity change would
            // cascade through the node's subtree every frame.
            const k = Math.max(0, this._toastTimer / 2.4);
            this._toastNode.y = this._toastBaseY + (1 - k) * 90;
            const s = 0.6 + k * 0.4;
            this._toastNode.setScale(s, s);
            if (this._toastTimer <= 0) this._toastLabel.text = '';
        }
    }
}
