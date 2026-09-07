import * as THREE from 'three';
import { Graphics, Label, Node, Scene, display } from 'noonengine';
import { QUEUE } from '../Config.ts';
import { animateCustomer, hopCustomer, makeCustomer, type CustomerRig } from '../procgen/Customer.ts';
import { makeRng } from '../procgen/Primitives.ts';

type Phase = 'walking-in' | 'waiting' | 'celebrating' | 'leaving';

/**
 * Where one stand's line stands, in world XZ. Every stall owns its own layout
 * so several shops can trade side by side without their queues interleaving.
 */
export interface QueueLayout {
    /** The point shoppers turn to face. */
    counter: { x: number; z: number };
    /** Position of the shopper being served. */
    slot0: { x: number; z: number };
    /** Offset from each slot to the next, further back in the line. */
    step: { x: number; z: number };
    slots: number;
    spawn: { x: number; z: number };
    exit: { x: number; z: number };
}

/** The 2D order bubble floating over one shopper's head. */
interface Bubble {
    root: Node;
    label: Label;
}

interface Customer {
    rig: CustomerRig;
    x: number;
    z: number;
    yaw: number;
    /** Bottles still owed on this order. */
    wants: number;
    ordered: number;
    phase: Phase;
    celebrate: number;
    speed01: number;
    bubble: Bubble;
}

/**
 * The line of shoppers waiting at the juice stand.
 *
 * Selling is no longer "stand in a zone and money appears" — bottles go to the
 * shopper at the head of the queue, and only a *completed* order pays out. The
 * queue is kept topped up so the player is never blocked waiting for demand.
 *
 * Order bubbles are 2D `Label`/`Graphics` nodes projected with
 * `sceneSystem3D.worldToDesign()` rather than in-world geometry: text stays
 * crisp at any distance and the bubble never gets buried behind the awning.
 */
export class CustomerQueue {
    readonly group = new THREE.Group();

    private _scene: Scene;
    private _onPay: (value: number) => void;
    private _layout: QueueLayout;
    private _rng: () => number;

    /** Index in this array IS the queue slot — index 0 is being served. */
    private _line: Customer[] = [];
    private _leaving: Customer[] = [];
    private _rigPool: CustomerRig[] = [];
    private _bubblePool: Bubble[] = [];
    private _respawn = 0;
    private _active = false;

    constructor(scene: Scene, layout: QueueLayout, onPay: (value: number) => void, seed = 0x5EED) {
        this._scene = scene;
        this._layout = layout;
        this._onPay = onPay;
        this._rng = makeRng(seed);
    }

    /**
     * Shoppers only exist once the stand is open. Enabling lets the respawn
     * timer fill the line, so they trickle in and queue up rather than popping
     * into existence all at once.
     */
    setActive(on: boolean): void {
        this._active = on;
    }

    /** Bottles the shopper at the counter still wants, or 0 if nobody's there. */
    get frontWants(): number {
        const f = this._line[0];
        return f && f.phase === 'waiting' ? f.wants : 0;
    }

    /**
     * Orders that have been fully served but whose payout hasn't landed yet
     * (the shopper is still doing their happy hop). The till has to reserve
     * room for these or a burst of completions overflows it.
     */
    get pendingPayouts(): number {
        return this._line.filter(c => c.phase === 'celebrating').length;
    }

    get waitingCount(): number {
        return this._line.filter(c => c.phase === 'waiting').length;
    }

    /**
     * Hands one bottle to the shopper at the counter.
     * Returns false when nobody is ready to receive one, which is what stops the
     * player (or the seller assistant) from dumping stock into thin air.
     */
    serve(): boolean {
        const front = this._line[0];
        if (!front || front.phase !== 'waiting' || front.wants <= 0) return false;

        front.wants--;
        this._refreshBubble(front);

        if (front.wants === 0) {
            front.phase = 'celebrating';
            front.celebrate = 0;
            front.bubble.root.setPosition({ x: -9999, y: -9999 });
        }
        return true;
    }

    update(dt: number): void {
        if (!this._active) return;
        this._updateLine(dt);
        this._updateLeaving(dt);

        // Keep the queue topped up so demand never blocks the loop.
        if (this._line.length < this._layout.slots) {
            this._respawn -= dt;
            if (this._respawn <= 0) {
                this._spawn();
                this._respawn = QUEUE.respawnDelay;
            }
        }
    }

    /** Projects each order bubble onto the 2D layer. Call once per frame. */
    updateBubbles(sys: { worldToDesign(p: { x: number; y: number; z: number }, d: typeof display): { x: number; y: number } | null }): void {
        for (const c of this._line) {
            if (c.phase !== 'waiting') {
                c.bubble.root.setPosition({ x: -9999, y: -9999 });
                continue;
            }
            // Well clear of the shopper's head — at this camera distance a bubble
            // any lower simply covers the character it belongs to.
            const p = sys.worldToDesign({ x: c.x, y: 3.7, z: c.z }, display);
            if (!p) {
                c.bubble.root.setPosition({ x: -9999, y: -9999 });
                continue;
            }
            c.bubble.root.setPosition({ x: p.x, y: p.y });
        }
        for (const c of this._leaving) c.bubble.root.setPosition({ x: -9999, y: -9999 });
    }

    // ─────────────────────────────────────────────────────────────────────────

    private _slotPos(index: number): { x: number; z: number } {
        const l = this._layout;
        return {
            x: l.slot0.x + index * l.step.x,
            z: l.slot0.z + index * l.step.z,
        };
    }

    /** Yaw that turns a shopper to face the counter from where they're standing. */
    private _facingCounter(x: number, z: number): number {
        return Math.atan2(this._layout.counter.x - x, this._layout.counter.z - z);
    }

    private _updateLine(dt: number): void {
        for (let i = 0; i < this._line.length; i++) {
            const c = this._line[i];

            if (c.phase === 'celebrating') {
                c.celebrate += dt;
                hopCustomer(c.rig, Math.min(1, c.celebrate / 0.55));
                if (c.celebrate >= 0.55) {
                    // Pay on the way out, then release the slot so the line moves up.
                    this._onPay(c.ordered);
                    c.phase = 'leaving';
                    c.rig.body.position.y = 0;
                    c.rig.flipperL.rotation.z = 0;
                    c.rig.flipperR.rotation.z = 0;
                    this._line.splice(i, 1);
                    this._leaving.push(c);
                    i--;
                }
                continue;
            }

            // Walk to whatever slot this customer currently occupies. Because the
            // array index *is* the slot, shuffling forward needs no extra state.
            const slot = this._slotPos(i);
            const arrived = this._step(c, slot.x, slot.z, dt, 0.12);
            if (arrived) {
                c.phase = 'waiting';
                c.yaw = this._approach(c.yaw, this._facingCounter(c.x, c.z), dt);
            }
            this._apply(c, dt);
        }
    }

    private _updateLeaving(dt: number): void {
        for (let i = this._leaving.length - 1; i >= 0; i--) {
            const c = this._leaving[i];
            const done = this._step(c, this._layout.exit.x, this._layout.exit.z, dt, 1.0);
            this._apply(c, dt);
            if (done) {
                this._leaving.splice(i, 1);
                this._recycle(c);
            }
        }
    }

    /** Moves a customer toward a point; returns true once within `tolerance`. */
    private _step(c: Customer, tx: number, tz: number, dt: number, tolerance: number): boolean {
        const dx = tx - c.x;
        const dz = tz - c.z;
        const d = Math.hypot(dx, dz);
        if (d <= tolerance) {
            c.speed01 += (0 - c.speed01) * Math.min(1, dt * 8);
            return true;
        }
        const step = Math.min(d, QUEUE.speed * dt);
        c.x += (dx / d) * step;
        c.z += (dz / d) * step;
        c.yaw = this._approach(c.yaw, Math.atan2(dx, dz), dt);
        c.speed01 += (1 - c.speed01) * Math.min(1, dt * 8);
        return false;
    }

    /** Shortest-path angle interpolation. */
    private _approach(current: number, target: number, dt: number): number {
        let delta = target - current;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        return current + delta * Math.min(1, 10 * dt);
    }

    private _apply(c: Customer, dt: number): void {
        c.rig.root.position.set(c.x, 0, c.z);
        c.rig.root.rotation.y = c.yaw;
        if (c.phase !== 'celebrating') animateCustomer(c.rig, dt, c.speed01);
    }

    private _spawn(): void {
        const rig = this._rigPool.pop() ?? makeCustomer(this._rng);
        rig.root.visible = true;
        this.group.add(rig.root);

        const ordered = QUEUE.minOrder
            + Math.floor(this._rng() * (QUEUE.maxOrder - QUEUE.minOrder + 1));

        const c: Customer = {
            rig,
            x: this._layout.spawn.x,
            z: this._layout.spawn.z,
            yaw: this._facingCounter(this._layout.spawn.x, this._layout.spawn.z),
            wants: ordered,
            ordered,
            phase: 'walking-in',
            celebrate: 0,
            speed01: 0,
            bubble: this._acquireBubble(),
        };
        c.rig.root.position.set(c.x, 0, c.z);
        c.rig.root.rotation.y = c.yaw;

        this._line.push(c);
        this._refreshBubble(c);
    }

    private _recycle(c: Customer): void {
        this.group.remove(c.rig.root);
        c.rig.root.visible = false;
        this._rigPool.push(c.rig);
        c.bubble.root.setPosition({ x: -9999, y: -9999 });
        this._bubblePool.push(c.bubble);
    }

    private _refreshBubble(c: Customer): void {
        c.bubble.label.text = `x${c.wants}`;
    }

    // ── Order bubble (2D) ────────────────────────────────────────────────────

    private _acquireBubble(): Bubble {
        const reused = this._bubblePool.pop();
        if (reused) return reused;

        const root = new Node();
        root.zIndex = 950;

        const bg = new Node();
        const gfx = bg.addComponent(Graphics);
        gfx.setLineWidth(5);
        gfx.drawRoundedRectangle(96, 56, 26, '#ffffff', '#3d2a1c');
        root.addChild(bg);

        // Little juice bottle glyph on the left.
        const icon = new Node(-24, -2);
        const iconGfx = icon.addComponent(Graphics);
        iconGfx.setLineWidth(3);
        iconGfx.drawRoundedRectangle(19, 27, 6, '#f59322', '#3d2a1c');
        root.addChild(icon);

        const cap = new Node(-24, 18);
        const capGfx = cap.addComponent(Graphics);
        capGfx.drawRoundedRectangle(9, 10, 3, '#e0952e', null);
        root.addChild(cap);

        const labelNode = new Node(15, 0);
        const label = labelNode.addComponent(Label);
        label.text = 'x0';
        label.fontSize = 31;
        label.fontWeight = 800;
        label.color = '#3d2a1c';
        label.textAlign = 'center';
        label.dynamic = true;
        root.addChild(labelNode);

        root.setPosition({ x: -9999, y: -9999 });
        this._scene.addChild(root);

        return { root, label };
    }
}


