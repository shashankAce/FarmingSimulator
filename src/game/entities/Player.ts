import { Scene } from 'noonengine';
import { PLAYER } from '../Config.ts';
import { PLAYER_COLORS, makeShovel } from '../procgen/Character.ts';
import { at, rot, scl } from '../procgen/Primitives.ts';
import { Actor } from './Actor.ts';
import type { Joystick } from '../ui/Joystick.ts';

/**
 * The player character. Movement is pure input — every interaction in the game
 * is triggered by *standing somewhere*, so there is no action button to handle.
 */
export class Player extends Actor {
    constructor(scene: Scene) {
        super(scene, PLAYER_COLORS, {
            x: PLAYER.startX,
            z: PLAYER.startZ,
            speed: PLAYER.speed,
            capacity: PLAYER.capacity,
        });

        // The shovel rides on the right arm's pivot, so it swings with the walk
        // cycle for free. Only the player carries one — it's what distinguishes
        // them from the hired hands at a glance.
        const shovel = scl(makeShovel(), 0.85);
        at(rot(shovel, -0.55, 0, 0.4), 0.06, -0.72, 0.24);
        this.rig.armR.add(shovel);
    }

    updateWithInput(dt: number, joy: Joystick): void {
        // Screen-up maps to world -Z: the camera looks down the +Z axis toward
        // the origin, so pushing the stick away from you walks "into" the scene.
        this.setMove(joy.x, -joy.y);
        this.update(dt);
    }
}
