import { GlobalEvents, Graphics, Label, Node, Scene, display } from 'noonengine';
import { FONT_FAMILY, PILL } from '../Config.ts';
import { C } from '../Palette.ts';
import type { GameState, Objective } from '../GameState.ts';

/** Palette entries are numbers; `Graphics` wants CSS. */
const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** Pixels per icon unit when rebuilding the `money` pad glyph in the pill. */
const GLYPH_UNIT = 48;

/** Stock panel: three stacked stats in the top-left corner. */
const STOCK = { w: 196, h: 108, pad: 18, line: 32 };
/** Margin from the visible rect's corners, shared by both panels. */
const MARGIN = 22;

const OBJECTIVE_TEXT: Record<Objective, string> = {
    'collect-start-cash': 'Grab the cash!',
    'harvest-carrots': 'Harvest some carrots',
    'deliver-carrots': 'Tip the carrots into the juicer',
    'collect-bottles': 'Grab a rack of juice',
    'sell-bottles': 'Sell the juice at your shop',
    'collect-earnings': 'Collect your earnings',
    // Reads for the first stand as well as the later ones — the scripted
    // opening now always routes through this step.
    'unlock-shop': 'Open a juice stand',
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
    private _stockLabels: Label[] = [];
    private _toastLabel: Label;
    private _toastNode: Node;
    private _toastTimer = 0;

    private _pill: Node;
    private _objWrap: Node;
    private _stockPill: Node;
    /** Baseline Y of the toast, recomputed on resize; the rise animation offsets from it. */
    private _toastBaseY = 0;

    constructor(scene: Scene, state: GameState) {
        // ── Money pill, pinned to the top-right ──
        const pill = new Node();
        this._pill = pill;
        const pillGfx = pill.addComponent(Graphics);
        pillGfx.setLineWidth(PILL.stroke);
        pillGfx.drawRoundedRectangle(PILL.w, PILL.h, PILL.h / 2, '#5a3a22', '#c9a15e');
        pill.zIndex = 1000;
        scene.addChild(pill);

        pill.addChild(Hud._moneyGlyph(-40));

        const moneyNode = new Node(24, 0);
        this._moneyLabel = moneyNode.addComponent(Label);
        this._moneyLabel.text = '0';
        this._moneyLabel.fontFamily = FONT_FAMILY;
        this._moneyLabel.fontSize = 30;
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
            lbl.fontFamily = FONT_FAMILY;
            lbl.fontSize = 30;
            lbl.fontWeight = 800;
            lbl.color = color;
            lbl.textAlign = 'center';
        }

        // ── Stock panel, top-left: three stats stacked, not one long line ──
        const stockPill = new Node();
        this._stockPill = stockPill;
        const stockGfx = stockPill.addComponent(Graphics);
        stockGfx.setLineWidth(PILL.stroke);
        stockGfx.drawRoundedRectangle(STOCK.w, STOCK.h, 20, '#5a3a22', '#c9a15e');
        stockPill.zIndex = 999;
        scene.addChild(stockPill);

        for (let i = 0; i < 3; i++) {
            // Anchor each line's LEFT edge, not its centre — a left-aligned
            // label still straddles its own position otherwise, so the three
            // would step in and out as their values changed width.
            const line = new Node(-STOCK.w / 2 + STOCK.pad, (1 - i) * STOCK.line);
            line.anchorX = 0;
            const label = line.addComponent(Label);
            label.text = '';
            label.fontFamily = FONT_FAMILY;
            label.fontSize = 24;
            label.fontWeight = 700;
            label.color = '#ffffff';
            label.textAlign = 'left';
            // Counters change every frame they tick — bake synchronously.
            label.dynamic = true;
            this._stockLabels.push(label);
            stockPill.addChild(line);
        }

        // ── Toast ──
        this._toastNode = new Node();
        this._toastNode.zIndex = 1001;
        this._toastLabel = this._toastNode.addComponent(Label);
        this._toastLabel.text = '';
        this._toastLabel.fontFamily = FONT_FAMILY;
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
     * The banknote from `makeFlatIcon('money')`, rebuilt in 2D at the icon's own
     * proportions, so the counter in the corner and the pad the cash sits on are
     * showing the same object. The pad icon's coin is left off: it sits off to
     * one side, which pushes the note off-centre in a pill this size.
     *
     * One node per layer, because a `Graphics` component stores a single shape —
     * the note is four stacked rectangles and the coin two circles. `zIndex` is
     * set explicitly rather than trusting child order, since the whole point is
     * that the smaller layers land on top of the larger ones.
     */
    private static _moneyGlyph(x: number): Node {
        const glyph = new Node(x, 0);
        let depth = 0;

        const add = (dx: number, dy: number, draw: (g: Graphics) => void): void => {
            const node = new Node(dx * GLYPH_UNIT, dy * GLYPH_UNIT);
            draw(node.addComponent(Graphics));
            node.zIndex = depth++;
            glyph.addChild(node);
        };
        const plate = (w: number, h: number, r: number, fill: number): void =>
            add(0, 0, g => g.drawRoundedRectangle(
                w * GLYPH_UNIT, h * GLYPH_UNIT, r * GLYPH_UNIT, css(fill), null));
        const disc = (r: number, fill: number, dx = 0, dy = 0): void =>
            add(dx, dy, g => g.drawCircle(r * GLYPH_UNIT, css(fill), null));

        plate(0.82, 0.46, 0.08, C.MONEY);
        plate(0.7, 0.34, 0.05, C.MONEY_DARK);
        plate(0.64, 0.28, 0.04, C.MONEY);
        disc(0.1, C.MONEY_PAPER);
        return glyph;
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

        // Same right margin the wider pill had.
        this._pill.setPosition({ x: right - PILL.w / 2 - MARGIN, y: top - PILL.h / 2 - MARGIN });
        this._objWrap.setPosition({ x: centerX, y: top - 150 });
        this._stockPill.setPosition({
            x: left + STOCK.w / 2 + MARGIN,
            y: top - STOCK.h / 2 - MARGIN,
        });

        this._toastBaseY = r.y + r.height * 0.62;
        this._toastNode.setPosition({ x: centerX, y: this._toastBaseY });
    }

    /** Refreshes the per-frame readouts. */
    update(dt: number, state: GameState, rackCount: number, rackCapacity: number): void {
        this._stockLabels[0].text = `Hopper ${state.carrotsQueued}`;
        this._stockLabels[1].text = `Racks ${rackCount}/${rackCapacity}`;
        this._stockLabels[2].text = `Sold ${state.totalSold}`;

        // The objective line is a tutorial aid like the two navigation cues, and
        // retires with them: past the first full cycle it is derived fresh every
        // frame from whatever the game most wants next, so it flickers between
        // errands rather than instructing.
        this._objWrap.active = !state.tutorialDone;

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
