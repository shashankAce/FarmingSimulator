// ─────────────────────────────────────────────────────────────────────────────
// DROPPED FEATURE — drag-to-look camera panning.
//
// Built, tried, and decided against: the game keeps its fixed follow camera.
// Commented out rather than deleted, so it can be brought back rather than
// rewritten. To restore, all four of these:
//
//   1. uncomment this file
//   2. uncomment the `PAN` block in `Config.ts`
//   3. uncomment the wiring in `FarmScene` (import, field, construction,
//      `_pan.update`, and the target/lerp lines in `_updateCamera`)
//   4. uncomment the button guard and `active` getter in `ui/Joystick.ts`,
//      without which a right-drag steers as well as pans
//
// `visibleBounds()` in Config would also want `PAN.maxRadius` added back to
// it — a pannable camera reaches further, so more of the village needs
// decorating. See the note there.
// ─────────────────────────────────────────────────────────────────────────────

// import { Input, PointerInputEvent, inputListener } from 'noonengine';
// import { PAN } from '../Config.ts';
//
// /**
//  * Drag-to-look: slides the view off the player and eases it back when let go.
//  *
//  * ── How it shares the screen with the joystick ──
//  *
//  * The stick is "drag anywhere to steer" — it claims the FIRST pointer down,
//  * wherever it lands, without hit-testing (see `Joystick`). Panning therefore
//  * takes what the stick leaves: a SECOND finger while the first is steering, or
//  * a right/middle-button drag on a desktop, where the stick is not the way you
//  * walk anyway. That split is why the stick had to be taught to ignore
//  * non-primary buttons — otherwise a right-drag planted a stick under the cursor
//  * as well as panning.
//  *
//  * It reads the pointer stream off `inputListener` for the same reason the stick
//  * does: a screen-sized interactive node would win every hit test and swallow
//  * input meant for the pads and buttons underneath it.
//  *
//  * ── Held, then released ──
//  *
//  * The offset holds while the finger is down — including while the other one is
//  * steering, which is the whole point on a phone — then lingers briefly and
//  * eases home. Walking cuts the linger short: if the player is driving somewhere
//  * the camera's job is to be over them, not where they last looked.
//  */
// export class CameraPan {
//     /** Offset of the view from the player, in world XZ. Read by the camera. */
//     x = 0;
//     z = 0;
//
//     private _pointerId: number | null = null;
//     /** Seconds left before the view starts easing back. */
//     private _linger = 0;
//     private _steering: () => boolean;
//     private _blocked: (x: number, y: number) => boolean;
//
//     /**
//      * @param steering whether the stick currently owns a pointer — a second
//      *   finger is only a pan gesture while it does.
//      * @param blocked screen points belonging to a button, left alone for the
//      *   same reason the stick leaves them alone.
//      */
//     constructor(steering: () => boolean, blocked: (x: number, y: number) => boolean = () => false) {
//         this._steering = steering;
//         this._blocked = blocked;
//         inputListener.on(Input.POINTER_DOWN, this._onDown);
//         inputListener.on(Input.POINTER_MOVE, this._onMove);
//         inputListener.on(Input.POINTER_UP, this._onUp);
//         inputListener.on(Input.POINTER_CANCEL, this._onUp);
//     }
//
//     dispose(): void {
//         inputListener.off(Input.POINTER_DOWN, this._onDown);
//         inputListener.off(Input.POINTER_MOVE, this._onMove);
//         inputListener.off(Input.POINTER_UP, this._onUp);
//         inputListener.off(Input.POINTER_CANCEL, this._onUp);
//     }
//
//     /** True while the view is being dragged — the camera stops following. */
//     get active(): boolean { return this._pointerId !== null; }
//
//     /** Eases the view home once nothing is holding it out. */
//     update(dt: number): void {
//         if (this._pointerId !== null) return;
//         // Under way somewhere: come back now rather than after the linger.
//         if (this._steering()) this._linger = 0;
//         if (this._linger > 0) { this._linger = Math.max(0, this._linger - dt); return; }
//
//         const k = Math.min(1, PAN.returnLerp * dt);
//         this.x -= this.x * k;
//         this.z -= this.z * k;
//         // Snapped once it is close enough to stop the follow being fought by an
//         // offset that only ever approaches zero.
//         if (Math.abs(this.x) < 0.002 && Math.abs(this.z) < 0.002) { this.x = 0; this.z = 0; }
//     }
//
//     private _onDown = (e: PointerInputEvent): void => {
//         if (this._pointerId !== null) return;
//         if (this._blocked(e.x, e.y)) return;
//         // A primary-button press with nothing being steered is the stick's.
//         if (e.button === 0 && !this._steering()) return;
//         this._pointerId = e.pointer.id;
//         this._linger = 0;
//     };
//
//     private _onMove = (e: PointerInputEvent): void => {
//         if (this._pointerId === null || e.pointer.id !== this._pointerId) return;
//
//         // The world follows the finger, as a map does: drag right and the
//         // ground slides right, which means the camera goes LEFT. Screen-up is
//         // world -Z here (`y` is up-positive, and `Player` maps it to -Z), so an
//         // upward drag walks the camera the other way, +Z.
//         this.x -= e.deltaX * PAN.worldPerPixel;
//         this.z += e.deltaY * PAN.worldPerPixel;
//
//         // Kept on a leash: the point of the view is the player, and a drag that
//         // could run off across the village makes them findable only by luck.
//         const d = Math.hypot(this.x, this.z);
//         if (d > PAN.maxRadius) {
//             const s = PAN.maxRadius / d;
//             this.x *= s;
//             this.z *= s;
//         }
//     };
//
//     private _onUp = (e: PointerInputEvent): void => {
//         if (this._pointerId === null || e.pointer.id !== this._pointerId) return;
//         this._pointerId = null;
//         this._linger = PAN.linger;
//     };
// }
//
