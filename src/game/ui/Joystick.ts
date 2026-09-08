import { Graphics, Input, Node, PointerInputEvent, Scene, inputListener } from 'noonengine';
import { GAME_HEIGHT, GAME_WIDTH } from '../Config.ts';

/**
 * Floating virtual joystick plus WASD/arrow-key fallback.
 *
 * Registration goes on the `inputListener` singleton rather than on a
 * full-screen node: a screen-sized interactive node would win every hit test
 * and swallow input meant for anything else, which `skills/input/input.md`
 * calls out explicitly. Global listeners skip hit-testing entirely, which is
 * exactly what a "drag anywhere to steer" control wants.
 */
export class Joystick {
    /** Normalised stick output. `y` is screen-up positive (engine convention). */
    x = 0;
    y = 0;

    private _base: Node;
    private _knob: Node;
    private _active = false;
    private _pointerId: number | null = null;
    private _originX = 0;
    private _originY = 0;

    private static readonly RADIUS = 96;
    private static readonly KNOB = 46;

    /**
     * Screen points to leave alone. Because the stick claims pointer-down
     * globally without hit-testing, an on-screen button would otherwise plant a
     * stick under the finger that pressed it — the node's own handler fires,
     * but so does this one.
     */
    private _blocked: (x: number, y: number) => boolean = () => false;

    constructor(scene: Scene, blocked?: (x: number, y: number) => boolean) {
        if (blocked) this._blocked = blocked;

        this._base = new Node(0, 0);
        const baseG = this._base.addComponent(Graphics);
        baseG.setLineWidth(6);
        baseG.drawCircle(Joystick.RADIUS, 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.55)');
        this._base.zIndex = 900;
        scene.addChild(this._base);

        this._knob = new Node(0, 0);
        const knobG = this._knob.addComponent(Graphics);
        knobG.setLineWidth(4);
        knobG.drawCircle(Joystick.KNOB, 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0.9)');
        this._knob.zIndex = 901;
        scene.addChild(this._knob);

        this._setVisible(false);

        inputListener.on(Input.POINTER_DOWN, this._onDown);
        inputListener.on(Input.POINTER_MOVE, this._onMove);
        inputListener.on(Input.POINTER_UP, this._onUp);
        inputListener.on(Input.POINTER_CANCEL, this._onUp);
    }

    dispose(): void {
        inputListener.off(Input.POINTER_DOWN, this._onDown);
        inputListener.off(Input.POINTER_MOVE, this._onMove);
        inputListener.off(Input.POINTER_UP, this._onUp);
        inputListener.off(Input.POINTER_CANCEL, this._onUp);
    }

    /** Folds the keyboard fallback in, so callers only read `x`/`y`. */
    update(): void {
        if (this._active) return;

        let kx = 0, ky = 0;
        if (inputListener.isKeyDown('KeyA') || inputListener.isKeyDown('ArrowLeft')) kx -= 1;
        if (inputListener.isKeyDown('KeyD') || inputListener.isKeyDown('ArrowRight')) kx += 1;
        if (inputListener.isKeyDown('KeyW') || inputListener.isKeyDown('ArrowUp')) ky += 1;
        if (inputListener.isKeyDown('KeyS') || inputListener.isKeyDown('ArrowDown')) ky -= 1;

        const mag = Math.hypot(kx, ky);
        if (mag > 0) { this.x = kx / mag; this.y = ky / mag; }
        else { this.x = 0; this.y = 0; }
    }

    private _onDown = (e: PointerInputEvent): void => {
        if (this._active) return;
        if (this._blocked(e.x, e.y)) return;
        this._active = true;
        this._pointerId = e.pointer.id;
        this._originX = e.x;
        this._originY = e.y;
        this._base.setPosition({ x: e.x, y: e.y });
        this._knob.setPosition({ x: e.x, y: e.y });
        this._setVisible(true);
    };

    private _onMove = (e: PointerInputEvent): void => {
        if (!this._active) return;
        if (this._pointerId !== null && e.pointer.id !== this._pointerId) return;

        const dx = e.x - this._originX;
        const dy = e.y - this._originY;
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(dist, Joystick.RADIUS);

        if (dist > 0.001) {
            this.x = (dx / dist) * (clamped / Joystick.RADIUS);
            this.y = (dy / dist) * (clamped / Joystick.RADIUS);
            this._knob.setPosition({
                x: this._originX + (dx / dist) * clamped,
                y: this._originY + (dy / dist) * clamped,
            });
        }
    };

    private _onUp = (e: PointerInputEvent): void => {
        if (!this._active) return;
        if (this._pointerId !== null && e.pointer.id !== this._pointerId) return;
        this._active = false;
        this._pointerId = null;
        this.x = 0;
        this.y = 0;
        this._setVisible(false);
    };

    private _setVisible(on: boolean): void {
        // Move offscreen rather than toggling opacity — an opacity change
        // cascades through the subtree (see skills/core/performance.md).
        if (!on) {
            this._base.setPosition({ x: -GAME_WIDTH, y: -GAME_HEIGHT });
            this._knob.setPosition({ x: -GAME_WIDTH, y: -GAME_HEIGHT });
        }
    }
}
