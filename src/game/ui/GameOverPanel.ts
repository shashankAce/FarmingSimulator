import { Button, ColorRect, GlobalEvents, Graphics, Label, Node, Scene, display } from 'noonengine';
import { FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH, PILL, hudScale } from '../Config.ts';

/**
 * The end-of-run card: won or lost, what the run came to, and a way back in.
 *
 * Built with the same pieces as the rest of the HUD — a `Graphics` rounded rect
 * per panel, `Label`s baked at `hudScale()`-multiplied sizes, and a `Button`
 * with `Transition.SCALE` — so it reads as part of the same interface rather
 * than as a dialog dropped on top of it. `ui/DropButton.ts` is the reference for
 * every one of those conventions.
 *
 * Built ONCE, in the scene's `onLoad`, and parked offscreen until it is needed.
 * A `Label` bakes its text to a bitmap the moment the text is assigned, so
 * constructing this at the moment the clock runs out would hitch the very frame
 * the player is watching for the result.
 */
export class GameOverPanel {
    private _node: Node;
    private _title: Label;
    private _summary: Label;
    private _button: Button;
    private _shade: Node;
    private _visible = false;
    private _x = 0;
    private _y = 0;
    private readonly _s: number;

    /**
     * Panel geometry, in design pixels before `hudScale()`.
     *
     * Measured OFF `GAME_WIDTH` rather than authored as a round number: the
     * design box is 390 wide, so a card sized by eye at "460, that looks like a
     * dialog" was wider than the entire screen and hung off both edges with its
     * text clipped at both ends. The margin is what is left of the width.
     */
    private static readonly PANEL = { w: GAME_WIDTH - 56, h: 250, radius: 30 };
    private static readonly BUTTON = { w: GAME_WIDTH - 140, h: 70, y: -72 };
    /** Inset the text keeps from the card's edges, for `Overflow.SHRINK`. */
    private static readonly TEXT_PAD = 22;

    constructor(scene: Scene, onPlayAgain: () => void) {
        this._s = hudScale();
        const px = (v: number): number => Math.round(v * this._s);

        this._node = new Node();
        // Above every other HUD layer, including the toast at 1001 — nothing
        // should be able to draw over the result.
        this._node.zIndex = 2000;
        scene.addChild(this._node);

        // Backdrop: a `ColorRect`, which fills its node's box, so covering a
        // resized screen is two number assignments in `_layout` rather than a
        // re-drawn `Graphics` shape. (`Graphics` is for anything with corners,
        // strokes or curves — see skills/rendering/color-rect.md.)
        this._shade = new Node();
        const shade = this._shade.addComponent(ColorRect);
        shade.color = 'rgba(18, 10, 4, 0.62)';
        this._shade.zIndex = 0;
        this._node.addChild(this._shade);

        const { PANEL, BUTTON } = GameOverPanel;

        const card = new Node();
        const cardGfx = card.addComponent(Graphics);
        cardGfx.setLineWidth(px(PILL.stroke * 1.5));
        cardGfx.drawRoundedRectangle(
            px(PANEL.w), px(PANEL.h), px(PANEL.radius), '#5a3a22', '#c9a15e');
        card.zIndex = 1;
        this._node.addChild(card);

        // Both text lines are `Overflow.SHRINK` inside the card's width: the
        // summary is assembled from live numbers ("2 stalls open, 78s to
        // spare"), so its length is not known when the size is chosen, and a
        // line that overflows the card is worse than one baked a point smaller.
        const textW = px(PANEL.w - GameOverPanel.TEXT_PAD * 2);

        const titleNode = new Node(0, px(66));
        titleNode.width = textW;
        titleNode.height = px(62);
        this._title = titleNode.addComponent(Label);
        this._title.text = '';
        this._title.fontFamily = FONT_FAMILY;
        this._title.fontSize = px(52);
        this._title.fontWeight = 800;
        this._title.color = '#ffe9a8';
        this._title.textAlign = 'center';
        this._title.overflow = Label.Overflow.SHRINK;
        card.addChild(titleNode);

        const summaryNode = new Node(0, px(10));
        summaryNode.width = textW;
        summaryNode.height = px(30);
        this._summary = summaryNode.addComponent(Label);
        this._summary.text = '';
        this._summary.fontFamily = FONT_FAMILY;
        this._summary.fontSize = px(24);
        this._summary.fontWeight = 700;
        this._summary.color = '#ffffff';
        this._summary.textAlign = 'center';
        this._summary.overflow = Label.Overflow.SHRINK;
        card.addChild(summaryNode);

        const btnNode = new Node(0, px(BUTTON.y));
        const btnGfx = btnNode.addComponent(Graphics);
        btnGfx.setLineWidth(px(PILL.stroke));
        btnGfx.drawRoundedRectangle(
            px(BUTTON.w), px(BUTTON.h), px(BUTTON.h / 2), '#8a5433', '#f2c94c');

        const btnLabelNode = new Node(0, 0);
        const btnLabel = btnLabelNode.addComponent(Label);
        btnLabel.text = 'PLAY AGAIN';
        btnLabel.fontFamily = FONT_FAMILY;
        btnLabel.fontSize = px(30);
        btnLabel.fontWeight = 800;
        btnLabel.color = '#ffffff';
        btnLabel.textAlign = 'center';
        btnNode.addChild(btnLabelNode);

        this._button = btnNode.addComponent(Button);
        this._button.transition = Button.Transition.SCALE;
        this._button.pressedScale = 0.92;
        this._button.onClick(() => onPlayAgain(), this);
        card.addChild(btnNode);

        this._layout();
        display.emitter.on(GlobalEvents.RESIZE, this._layout, this);
        this._apply();
    }

    dispose(): void {
        display.emitter.off(GlobalEvents.RESIZE, this._layout, this);
    }

    get visible(): boolean { return this._visible; }

    /**
     * Any point at all, while the card is up.
     *
     * `Joystick` claims pointer-down globally without hit-testing (that is why
     * `DropButton.hits` exists), so without this, tapping PLAY AGAIN would also
     * plant a thumbstick under the finger. The whole screen is behind the
     * backdrop at this point and none of it should be steering anything, so the
     * exclusion is the screen rather than the button's rectangle.
     */
    hits(_x: number, _y: number): boolean {
        return this._visible;
    }

    show(win: boolean, summary: string): void {
        this._title.text = win ? 'YOU WIN!' : "TIME'S UP!";
        this._title.color = win ? '#ffe9a8' : '#ffb9a8';
        this._summary.text = summary;
        this._visible = true;
        this._apply();
    }

    private _layout(): void {
        const r = display.getVisibleRect();
        this._x = r.x + r.width / 2;
        this._y = r.y + r.height / 2;
        // A shade node centred on the card has to reach the far corners from
        // there, hence the doubling — cheaper than tracking the offset.
        this._shade.width = r.width * 2;
        this._shade.height = r.height * 2;
        this._apply();
    }

    /**
     * Parked offscreen rather than deactivated or faded, the same way the DROP
     * button hides — an opacity change cascades through the subtree, and this
     * one has a card, two labels and a button under it.
     */
    private _apply(): void {
        this._button.interactable = this._visible;
        this._node.setPosition(this._visible
            ? { x: this._x, y: this._y }
            : { x: -GAME_WIDTH * 3, y: -GAME_HEIGHT * 3 });
    }
}
