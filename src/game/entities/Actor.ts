import * as THREE from 'three';
import { Node, Scene } from 'noonengine';
import { Group3D } from 'noonengine/3d';
import { animateCharacter, CharacterColors, CharacterRig, makeCharacter } from '../procgen/Character.ts';
import { CarryLoad } from '../world/CarryLoad.ts';
import { clampToYard } from '../world/Environment.ts';
import { obstacles } from '../world/Obstacles.ts';
import { HARVEST, PLAYER } from '../Config.ts';

/**
 * A walking character with a carry stack — the shared base for the player and
 * the hired assistants.
 *
 * The rig hangs off a `Group3D` wrapper rather than being added to the THREE
 * scene directly: actors are the game's dynamic, destroyable objects, which is
 * exactly the case `skills/3d/three-integration.md` says the wrapper components
 * exist for. Static scenery skips the wrapper; this doesn't.
 */
export class Actor {
    readonly rig: CharacterRig;
    readonly load: CarryLoad;
    readonly node: Node;

    x: number;
    z: number;
    yaw = 0;
    speed: number;

    /**
     * Swings the blade to the other end of its arc.
     *
     * Alternating rather than repeating, so successive calls read as one blade
     * going to and fro. The hold is generous enough to outlast the gap between
     * sweeps, so the arms only drop once harvesting actually stops.
     */
    sweep(): void {
        const half = (HARVEST.arcDeg * Math.PI) / 360;
        this.rig.sweepTo = this.rig.sweepTo > 0 ? -half : half;
        this.rig.sweepHold = HARVEST.interval * 1.6;
    }

    /**
     * Seconds until this character may cut again. Harvesting runs on its own
     * clock rather than the shared transfer tick: one sweep of a blade takes
     * `HARVEST.interval`, and everything it reaches comes out on that swing.
     */
    harvestTimer = 0;

    /** Desired movement direction this frame, in world XZ. Not normalised by the caller. */
    protected _dirX = 0;
    protected _dirZ = 0;
    /** Smoothed 0..1 speed, drives the walk cycle. */
    protected _speed01 = 0;

    constructor(scene: Scene, colors: CharacterColors, opts: { x: number; z: number; speed: number; capacity: number }) {
        this.rig = makeCharacter(colors);
        this.x = opts.x;
        this.z = opts.z;
        this.speed = opts.speed;

        this.node = new Node();
        const group = this.node.addComponent(Group3D);
        scene.addChild(this.node);
        group.object3D.add(this.rig.root);

        this.rig.root.position.set(this.x, 0, this.z);
        this.load = new CarryLoad(this.rig.holdAnchor, opts.capacity);
    }

    /** Sets this frame's movement intent. Any magnitude; it gets normalised. */
    setMove(dx: number, dz: number): void {
        this._dirX = dx;
        this._dirZ = dz;
    }

    /**
     * Steers toward a world point. Returns true once within `tolerance`,
     * at which point movement intent is cleared.
     */
    moveToward(tx: number, tz: number, tolerance = 1.0): boolean {
        const dx = tx - this.x;
        const dz = tz - this.z;
        const d = Math.hypot(dx, dz);
        if (d <= tolerance) {
            this.setMove(0, 0);
            return true;
        }
        this.setMove(dx / d, dz / d);
        return false;
    }

    get position(): THREE.Vector3 { return this.rig.root.position; }

    update(dt: number): void {
        const mag = Math.hypot(this._dirX, this._dirZ);
        if (mag > 0.001) {
            const nx = this._dirX / mag;
            const nz = this._dirZ / mag;
            const step = this.speed * Math.min(1, mag) * dt;
            // Fence first, then solids — so being pushed out of a machine can
            // never shove a character through the boundary.
            const bounded = clampToYard(this.x + nx * step, this.z + nz * step, PLAYER.radius);
            const clear = obstacles.resolve(bounded.x, bounded.z, PLAYER.radius);
            const settled = clampToYard(clear.x, clear.z, PLAYER.radius);
            this.x = settled.x;
            this.z = settled.z;

            // Face travel direction, taking the shortest way round.
            const target = Math.atan2(nx, nz);
            let delta = target - this.yaw;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            this.yaw += delta * Math.min(1, PLAYER.turnSpeed * dt);
        }

        const targetSpeed01 = Math.min(1, mag);
        this._speed01 += (targetSpeed01 - this._speed01) * Math.min(1, dt * 12);

        this.rig.root.position.set(this.x, 0, this.z);
        this.rig.root.rotation.y = this.yaw;

        animateCharacter(this.rig, dt, this._speed01, this.load.isCarrying);
        this.load.update(dt);
    }

    /** Removes the actor from the scene (used if an upgrade is ever refunded). */
    destroy(): void {
        this.load.clear();
        this.node.removeFromParent(true);
    }
}
