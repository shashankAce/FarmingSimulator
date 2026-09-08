import { Scene } from 'noonengine';
import { CARRY, PLAYER } from '../Config.ts';
import { PLAYER_COLORS, giveSickle } from '../procgen/Character.ts';
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
            capacity: CARRY.playerCrates,
        });

        // The sickle rides on the right arm's pivot, so it moves with the walk
        // cycle and with the harvest spin for free.
        giveSickle(this.rig);
    }

    updateWithInput(dt: number, joy: Joystick): void {
        // Screen-up maps to world -Z: the camera looks down the +Z axis toward
        // the origin, so pushing the stick away from you walks "into" the scene.
        this.setMove(joy.x, -joy.y);
        this.update(dt);
    }
}
