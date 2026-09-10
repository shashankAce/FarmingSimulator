import { GlobalEvents, Graphics, Label, Node, Scene, display } from 'noonengine';
import { FONT_FAMILY, PILL, RUN, hudScale } from '../Config.ts';
import { C } from '../Palette.ts';
import type { GameState, Objective } from '../GameState.ts';

/** Palette entries are numbers; `Graphics` wants CSS. */
const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** Pixels per icon unit when rebuilding the `money` pad glyph in the pill. */
const GLYPH_UNIT = 48;

/** Margin from the visible rect's corners, shared by both pills. */
const MARGIN = 22;

/** Colour of the countdown, and what it turns under `RUN.warnAt`. */
const TIME_OK = '#ffffff';
const TIME_LOW = '#ff6b5e';

/**
 * Cash, shortened past four digits — `12.3K` rather than `12340`.
 *
 * The pill is sized for four digits and the run is short enough that a good one
 * blows through them; a fifth digit either overflowed the pill or forced it
 * wider than the DROP button it is meant to pair with.
 *
 * Truncated, not rounded: `toFixed(1)` turns 999,950 into `1000.0K`, which is
 * both wrong-looking and wider than the case it exists to prevent.
 */
const formatMoney = (n: number): string => {
    const v = Math.floor(n);
    if (v < 10_000) return String(v);
    for (const [unit, div] of [['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
        if (v >= div) return `${Math.floor(v / (div / 10)) / 10}${unit}`;
    }
    return String(v);
};

/** `90` → `1:30`. Rounds UP, so the clock only shows 0:00 when time is out. */
const formatTime = (seconds: number): string => {
    const t = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

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
    private _timeLabel: Label;
    private _objectiveLabel: Label;
    private _objectiveShadow: Label;
    private _toastLabel: Label;
    private _toastNode: Node;
    private _toastTimer = 0;

    /** Device size factor, applied to every authored dimension below. */
    private _s = 1;
    private _pill: Node;
    private _objWrap: Node;
    private _timePill: Node;
    /** Baseline Y of the toast, recomputed on resize; the rise animation offsets from it. */
    private _toastBaseY = 0;
    /** Set once the run is decided — see `endRun`. */
    private _runOver = false;

    constructor(scene: Scene, state: GameState) {
        this._s = hudScale();
        // Rounded, because a Label baked at a fractional size lands between
        // pixels and blurs exactly like a scaled node would.
        const px = (v: number): number => Math.round(v * this._s);

        // ── Money pill, pinned to the top-right ──
        const pill = new Node();
        this._pill = pill;
        const pillGfx = pill.addComponent(Graphics);
        pillGfx.setLineWidth(px(PILL.stroke));
        pillGfx.drawRoundedRectangle(px(PILL.w), px(PILL.h), px(PILL.h / 2), '#5a3a22', '#c9a15e');
        pill.zIndex = 1000;
        scene.addChild(pill);

        pill.addChild(Hud._moneyGlyph(px(-40), px(GLYPH_UNIT)));

        const moneyNode = new Node(px(24), 0);
        this._moneyLabel = moneyNode.addComponent(Label);
        this._moneyLabel.text = '0';
        this._moneyLabel.fontFamily = FONT_FAMILY;
        this._moneyLabel.fontSize = px(30);
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
        const shadowNode = new Node(px(3), px(-4));
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
            lbl.fontSize = px(30);
            lbl.fontWeight = 800;
            lbl.color = color;
            lbl.textAlign = 'center';
        }

        // ── Countdown pill, top-left ──
        //
        // Where the hopper/racks/sold readout used to be. Those three numbers
        // were reference material for an open-ended idle game; in a ninety
        // second dash the only number that changes the player's next decision
        // is how long is left, and it earns the corner outright.
        //
        // Deliberately the SAME pill as the money counter, mirrored across the
        // top of the screen: the two things the run is scored on, one either
        // side. The stock panel was a different width, height and corner radius.
        const timePill = new Node();
        this._timePill = timePill;
        const timeGfx = timePill.addComponent(Graphics);
        timeGfx.setLineWidth(px(PILL.stroke));
        timeGfx.drawRoundedRectangle(px(PILL.w), px(PILL.h), px(PILL.h / 2), '#5a3a22', '#c9a15e');
        timePill.zIndex = 999;
        scene.addChild(timePill);

        const timeNode = new Node(0, 0);
        this._timeLabel = timeNode.addComponent(Label);
        this._timeLabel.text = formatTime(RUN.duration);
        this._timeLabel.fontFamily = FONT_FAMILY;
        this._timeLabel.fontSize = px(30);
        this._timeLabel.fontWeight = 800;
        this._timeLabel.color = TIME_OK;
        this._timeLabel.textAlign = 'center';
        // Ticks every second — bake synchronously, like the money counter.
        this._timeLabel.dynamic = true;
        timePill.addChild(timeNode);

        // ── Toast ──
        this._toastNode = new Node();
        this._toastNode.zIndex = 1001;
        this._toastLabel = this._toastNode.addComponent(Label);
        this._toastLabel.text = '';
        this._toastLabel.fontFamily = FONT_FAMILY;
        this._toastLabel.fontSize = px(44);
        this._toastLabel.fontWeight = 800;
        this._toastLabel.color = '#ffe9a8';
        this._toastLabel.textAlign = 'center';
        scene.addChild(this._toastNode);

        // ── Wire up state signals ──
        state.events.on('money', (e: { money: number }) => {
            this._moneyLabel.text = formatMoney(e.money);
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

        this._moneyLabel.text = formatMoney(state.money);

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
    private static _moneyGlyph(x: number, unit: number): Node {
        const glyph = new Node(x, 0);
        let depth = 0;

        const add = (dx: number, dy: number, draw: (g: Graphics) => void): void => {
            const node = new Node(dx * unit, dy * unit);
            draw(node.addComponent(Graphics));
            node.zIndex = depth++;
            glyph.addChild(node);
        };
        const plate = (w: number, h: number, r: number, fill: number): void =>
            add(0, 0, g => g.drawRoundedRectangle(
                w * unit, h * unit, r * unit, css(fill), null));
        const disc = (r: number, fill: number, dx = 0, dy = 0): void =>
            add(dx, dy, g => g.drawCircle(r * unit, css(fill), null));

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
        const s = this._s;
        this._pill.setPosition({
            x: right - (PILL.w / 2 + MARGIN) * s,
            y: top - (PILL.h / 2 + MARGIN) * s,
        });
        this._objWrap.setPosition({ x: centerX, y: top - 200 * s });
        // Mirrors the money pill across the top edge.
        this._timePill.setPosition({
            x: left + (PILL.w / 2 + MARGIN) * s,
            y: top - (PILL.h / 2 + MARGIN) * s,
        });

        this._toastBaseY = r.y + r.height * 0.62;
        this._toastNode.setPosition({ x: centerX, y: this._toastBaseY });
    }

    /**
     * Retires the tutorial objective line for good.
     *
     * The line is an instruction for a run in progress, and the result card
     * covers the middle of the screen — leaving "Grab the cash!" hanging over
     * YOU WIN! reads as the game still asking for something.
     */
    endRun(): void {
        this._runOver = true;
    }

    /**
     * Shows the time left on the clock.
     *
     * Written every frame without a guard: `Label.text` short-circuits when the
     * string is unchanged, so the bitmap is only ever rebaked on the second.
     */
    setTime(secondsLeft: number): void {
        this._timeLabel.text = formatTime(secondsLeft);
        this._timeLabel.color = secondsLeft <= RUN.warnAt ? TIME_LOW : TIME_OK;
    }

    /** Refreshes the per-frame readouts. */
    update(dt: number, state: GameState): void {
        // The objective line is a tutorial aid like the two navigation cues, and
        // retires with them: past the first full cycle it is derived fresh every
        // frame from whatever the game most wants next, so it flickers between
        // errands rather than instructing.
        this._objWrap.active = !state.tutorialDone && !this._runOver;

        if (this._toastTimer > 0) {
            this._toastTimer -= dt;
            // Rise and shrink away rather than fading — an opacity change would
            // cascade through the node's subtree every frame.
            const k = Math.max(0, this._toastTimer / 2.4);
            this._toastNode.y = this._toastBaseY + (1 - k) * 90 * this._s;
            const s = 0.6 + k * 0.4;
            this._toastNode.setScale(s, s);
            if (this._toastTimer <= 0) this._toastLabel.text = '';
        }
    }
}
