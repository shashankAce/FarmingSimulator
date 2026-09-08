import { Button, GlobalEvents, Graphics, Label, Node, Scene, display, inputListener } from 'noonengine';
import { FONT_FAMILY } from '../Config.ts';


/**
 * "Put it down" control, bottom-right, shown only while the player is carrying.
 *
 * This exists to keep the game unstuck rather than as a convenience. A load is
 * one kind at a time, so a player holding carrots with a full hopper AND a full
 * rack stand could previously neither tip them in nor lift a rack — and lifting
 * a rack is the only thing that clears that jam. Without a way to set the load
 * down, capping the hopper at all would end the run.
 *
 * A rounded RECT rather than a circle on purpose: the joystick has to ignore
 * taps that land here (see `hits`), and a rect is the one shape whose own hit
 * test and that exclusion test agree exactly at the corners.
 */
export class DropButton {
    private _node: Node;
    private _button: Button;
    private _visible = false;
    private _x = 0;
    private _y = 0;
    private _onDrop: () => void;

    private static readonly W = 190;
    private static readonly H = 92;
    private static readonly STROKE = 6;
    /** Keyboard equivalent, for playing at a desk. */
    private static readonly KEY = 'KeyQ';

    private _keyWasDown = false;

    constructor(scene: Scene, onDrop: () => void) {
        this._onDrop = onDrop;

        this._node = new Node();
        const gfx = this._node.addComponent(Graphics);
        gfx.setLineWidth(DropButton.STROKE);
        gfx.drawRoundedRectangle(DropButton.W, DropButton.H, 26, '#8a5433', '#f2c94c');
        this._node.zIndex = 1000;

        const labelNode = new Node(0, 0);
        const label = labelNode.addComponent(Label);
        label.text = 'DROP';
        label.fontFamily = FONT_FAMILY;
        label.fontSize = 34;
        label.fontWeight = 800;
        label.color = '#ffffff';
        label.textAlign = 'center';
        this._node.addChild(labelNode);

        this._button = this._node.addComponent(Button);
        this._button.transition = Button.Transition.SCALE;
        this._button.pressedScale = 0.92;
        this._button.onClick(() => this._onDrop(), this);

        scene.addChild(this._node);

        this._layout();
        display.emitter.on(GlobalEvents.RESIZE, this._layout, this);

        this.setVisible(false);
    }

    dispose(): void {
        display.emitter.off(GlobalEvents.RESIZE, this._layout, this);
    }

    /**
     * Edge-detects the keyboard shortcut. Polled like the joystick's WASD
     * fallback rather than driven off a key event, so both controls read the
     * keyboard the same way.
     */
    update(): void {
        const down = inputListener.isKeyDown(DropButton.KEY);
        if (down && !this._keyWasDown && this._visible) this._onDrop();
        this._keyWasDown = down;
    }

    /**
     * True when a screen point lands on the button. The joystick listens to
     * pointer-down globally without hit-testing, so it has to be told to skip
     * these taps or pressing DROP also plants a stick under the finger.
     */
    hits(x: number, y: number): boolean {
        // Padded by the stroke, because `Graphics` grows `node.width/height` by
        // it — the button's own hit area is the one that has to be covered.
        const px = DropButton.W / 2 + DropButton.STROKE;
        const py = DropButton.H / 2 + DropButton.STROKE;
        return this._visible && Math.abs(x - this._x) <= px && Math.abs(y - this._y) <= py;
    }

    setVisible(on: boolean): void {
        if (this._visible === on) return;
        this._visible = on;
        this._button.interactable = on;
        // Parked offscreen rather than dimmed: an opacity change cascades
        // through the subtree every frame it animates.
        this._place();
    }

    private _layout(): void {
        const r = display.getVisibleRect();
        // Above the money pill's opposite corner, clear of the joystick's usual
        // half of the screen.
        this._x = r.x + r.width - DropButton.W / 2 - 40;
        this._y = r.y + DropButton.H / 2 + 56;
        this._place();
    }

    private _place(): void {
        this._node.setPosition(this._visible
            ? { x: this._x, y: this._y }
            : { x: -DropButton.W * 4, y: -DropButton.H * 4 });
    }
}
