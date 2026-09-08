import * as THREE from 'three';
import { CHARACTER } from '../Config.ts';
import { C } from '../Palette.ts';
import { at, box, cyl, group, rot, scl, sphere } from './Primitives.ts';

/**
 * The procedural bunny farmer from the reference art, plus a tiny animation rig.
 *
 * Everything is primitives — there is no skinned mesh and no imported model, so
 * "animation" here means rotating a handful of `Object3D` pivots each frame.
 * The same builder produces the player and the hired assistants; only the
 * colours differ.
 */

export interface CharacterRig {
    /** Top-level object — move and yaw THIS to drive the character around. */
    root: THREE.Group;
    /** Bobs vertically while walking. */
    body: THREE.Group;
    head: THREE.Group;
    armL: THREE.Group;
    armR: THREE.Group;
    legL: THREE.Group;
    legR: THREE.Group;
    earL: THREE.Group;
    earR: THREE.Group;
    /**
     * Where carried crates are parented — out in front at waist height, so they
     * read as being held on the forearms rather than balanced on the head.
     */
    holdAnchor: THREE.Object3D;
    /** Phase accumulator owned by `animateCharacter`. */
    phase: number;
    /**
     * Harvest sweep. `sweepTo` is the offset the blade is travelling toward, in
     * radians either side of the character's facing; `sweepAt` is where it has
     * got to. Held as an OFFSET rather than an absolute heading so the caller
     * still owns which way the character faces.
     */
    sweepTo: number;
    sweepAt: number;
    /** Seconds of sweeping left before the arms drop and the blade recentres. */
    sweepHold: number;
}

export interface CharacterColors {
    fur: number;
    furDark: number;
    snout: number;
    outfit: number;
    outfitDark: number;
}

/**
 * Leg geometry, and the body height that follows from it.
 *
 * `BODY_Y` is derived rather than chosen: hips minus the leg and the foot puts
 * the soles on the ground, less a hair so they settle into the grass instead of
 * skimming it. Lengthening `LEG_LEN` therefore raises the whole character
 * rather than driving its feet through the floor.
 */
const HIP_Y = 0.3;
const LEG_LEN = 0.48;
const FOOT_DROP = 0.17 * 0.65;
const BODY_Y = LEG_LEN + FOOT_DROP - HIP_Y - 0.03;

export const PLAYER_COLORS: CharacterColors = {
    fur: C.FUR, furDark: C.FUR_DARK, snout: C.SNOUT,
    outfit: C.OVERALL, outfitDark: C.OVERALL_DARK,
};

export const FARMER_COLORS: CharacterColors = {
    fur: C.SKIN_ASSIST, furDark: 0xa8c46a, snout: 0xe4f0b8,
    outfit: 0xd8853a, outfitDark: 0xb96a28,
};

export const SELLER_COLORS: CharacterColors = {
    fur: 0xb9a6e8, furDark: 0x9b86cc, snout: 0xdcd2f4,
    outfit: 0x3fa88f, outfitDark: 0x2f8571,
};

/** Builds one character. Scale is roughly 1.9 world units tall including ears. */
export function makeCharacter(col: CharacterColors): CharacterRig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    // ── Torso: a squashed sphere, with dungarees over the lower half ──
    const torso = at(sphere(0.52, col.fur, 10), 0, 0.72, 0);
    scl(torso, 1, 1.15, 0.92);
    body.add(torso);

    const overalls = at(cyl(0.46, 0.52, 0.62, 10, col.outfit), 0, 0.52, 0);
    body.add(overalls);
    // Straps.
    for (const x of [-0.22, 0.22]) {
        body.add(at(box(0.12, 0.46, 0.1, col.outfit), x, 0.95, 0.4));
    }
    body.add(at(box(0.42, 0.3, 0.1, col.outfitDark), 0, 0.9, 0.44));

    // ── Head ──
    const head = new THREE.Group();
    at(head, 0, 1.32, 0);
    body.add(head);

    const skull = sphere(0.46, col.fur, 12);
    scl(skull, 1, 0.94, 0.94);
    head.add(skull);

    // Snout, nose, buck teeth.
    const snout = at(sphere(0.26, col.snout, 10), 0, -0.08, 0.36);
    scl(snout, 1.2, 0.85, 0.9);
    head.add(snout);
    head.add(at(sphere(0.09, C.EYE, 6), 0, 0.02, 0.58));
    head.add(at(box(0.16, 0.16, 0.06, 0xffffff), 0, -0.2, 0.52));

    // Eyes.
    for (const x of [-0.19, 0.19]) {
        head.add(at(sphere(0.075, C.EYE, 8), x, 0.12, 0.4));
    }

    // Cheeks.
    for (const x of [-0.32, 0.32]) {
        head.add(at(scl(sphere(0.1, col.furDark, 6), 1, 0.7, 0.6), x, -0.06, 0.3));
    }

    // ── Ears: pivot at the base so they can flop ──
    const earL = new THREE.Group();
    const earR = new THREE.Group();
    at(earL, -0.16, 0.36, 0);
    at(earR, 0.16, 0.36, 0);
    for (const [ear, sign] of [[earL, -1], [earR, 1]] as const) {
        const outer = at(scl(sphere(0.15, col.fur, 8), 0.62, 2.5, 0.5), 0, 0.36, 0);
        const inner = at(scl(sphere(0.15, col.snout, 8), 0.4, 2.2, 0.3), 0, 0.36, 0.05);
        ear.add(outer, inner);
        rot(ear, -0.1, 0, sign * 0.18);
        head.add(ear);
    }

    // ── Arms: pivot at the shoulder ──
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    at(armL, -0.52, 0.86, 0);
    at(armR, 0.52, 0.86, 0);
    for (const arm of [armL, armR]) {
        const upper = at(cyl(0.13, 0.12, 0.42, 6, col.fur), 0, -0.21, 0);
        const paw = at(sphere(0.15, col.fur, 8), 0, -0.46, 0);
        arm.add(upper, paw);
        body.add(arm);
    }

    // ── Legs: pivot at the hip ──
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    at(legL, -0.21, HIP_Y, 0);
    at(legR, 0.21, HIP_Y, 0);
    for (const leg of [legL, legR]) {
        leg.add(at(cyl(0.15, 0.135, LEG_LEN, 6, col.outfitDark), 0, -LEG_LEN / 2, 0));
        // Foot, pushed forward so the silhouette reads even from directly above.
        leg.add(at(scl(sphere(0.17, col.furDark, 8), 1, 0.65, 1.5), 0, -LEG_LEN, 0.08));
        body.add(leg);
    }
    body.position.y = BODY_Y;

    // ── Hold anchor ──
    const holdAnchor = new THREE.Object3D();
    at(holdAnchor, 0, 0.34, 0.98);
    root.add(holdAnchor);

    root.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = false; } });

    // Scaled at the root, so every part, the tool on the arm and the carry
    // anchor all move together. Anything parented in later that must NOT grow
    // with the character has to divide this back out.
    root.scale.setScalar(CHARACTER.scale);

    return { root, body, head, armL, armR, legL, legR, earL, earR, holdAnchor, phase: 0, sweepTo: 0, sweepAt: 0, sweepHold: 0 };
}

/**
 * Drives the walk cycle. `speed01` is normalised movement speed (0 = idle,
 * 1 = full tilt); at 0 the rig settles into a gentle idle breath instead.
 *
 * While `carrying`, the arms are locked out in front holding a crate instead of
 * counter-swinging — the legs and body keep their full cycle, which is what
 * sells the weight.
 */
/** How quickly the blade travels between the ends of its arc. */
const SWEEP_RATE = 9;

export function animateCharacter(rig: CharacterRig, dt: number, speed01: number, carrying = false): void {
    rig.phase += dt * (4.0 + speed01 * 9.0);
    const s = Math.min(1, speed01);
    const swing = Math.sin(rig.phase);

    // Legs alternate; arms counter-swing unless they're busy holding something.
    rig.legL.rotation.x = swing * 0.85 * s;
    rig.legR.rotation.x = -swing * 0.85 * s;
    if (carrying) {
        // Reach forward and slightly inward, so both paws meet under the crate.
        rig.armL.rotation.set(-1.32, 0, 0.3);
        rig.armR.rotation.set(-1.32, 0, -0.3);
    } else {
        rig.armL.rotation.set(-swing * 0.7 * s, 0, 0);
        rig.armR.rotation.set(swing * 0.7 * s, 0, 0);
    }

    // Harvest sweep: the blade travels from one end of its arc to the other and
    // back again, rather than the character spinning on the spot. Applied AFTER
    // the walk cycle has set the arms so it wins either way, and added ON TOP of
    // the facing the caller wrote to `root` this frame.
    if (rig.sweepHold > 0) {
        rig.sweepHold = Math.max(0, rig.sweepHold - dt);
        // Nothing has asked for another sweep: come back to centre and stop.
        if (rig.sweepHold === 0) rig.sweepTo = 0;
    }
    rig.sweepAt += (rig.sweepTo - rig.sweepAt) * Math.min(1, dt * SWEEP_RATE);

    if (Math.abs(rig.sweepAt) > 0.002) {
        rig.root.rotation.y += rig.sweepAt;
        // Blade arm out and low, the other tucked in for balance. Leaning into
        // the direction of travel sells the swing more than the turn alone.
        rig.armR.rotation.set(-0.3, 0, -1.2);
        rig.armL.rotation.set(-0.15, 0, 0.55);
        rig.body.rotation.z = 0.07;
    }

    // Body bob is double-frequency (one hop per step, not per stride), on top
    // of the resting height the legs put it at.
    rig.body.position.y = BODY_Y + Math.abs(Math.sin(rig.phase)) * 0.11 * s;
    rig.body.rotation.z = swing * 0.05 * s;

    // Ears lag behind the bob — the detail that sells the whole thing.
    const flop = Math.sin(rig.phase - 0.9) * (0.12 + 0.22 * s);
    rig.earL.rotation.x = -0.1 + flop;
    rig.earR.rotation.x = -0.1 + flop * 0.85;

    // Idle: slow breathing when standing still.
    if (s < 0.02) {
        const breathe = Math.sin(rig.phase * 0.5) * 0.02;
        rig.body.scale.set(1 + breathe, 1 - breathe, 1 + breathe);
    } else {
        rig.body.scale.set(1, 1, 1);
    }
}

/** A shovel the idle player holds, matching the reference character's prop. */
/**
 * Puts a sickle in a character's right paw.
 *
 * Shared rather than repeated at each call site: the player and the farmhand
 * hold the same tool the same way, and two copies of the mount drifted apart
 * the moment either was adjusted.
 *
 * Turned a half-turn about the GRIP's own axis, which is the tool's local Y, so
 * the hook curls in toward the body instead of away from it.
 */
export function giveSickle(rig: CharacterRig): void {
    rig.armR.add(at(rot(scl(makeSickle(), 0.9), 0, -2, 0), 0.04, -0.78, 0.06));
}

export function makeSickle(): THREE.Group {
    // Grip runs UP from the blade, so the paw holds the handle and the hook
    // hangs below it, ready to sweep the ground.
    const g = group(
        at(cyl(0.055, 0.062, 0.3, 6, C.WOOD), 0, 0.19, 0),
        at(cyl(0.07, 0.07, 0.07, 6, C.METAL_DARK), 0, 0.02, 0),
    );

    // The hook. Segments swept round an arc in the XY plane — the plane the
    // handle is in — because there is no torus primitive here and a handful of
    // facets reads as a curve at this size.
    //
    // The arc leaves the handle TANGENTIALLY and curls away from it, so the
    // handle sits outside the crescent at one end of it. Curving straight out
    // sideways instead wrapped the hook back around the grip, which put the
    // handle inside its own blade — a hook, but not a sickle.
    const R = 0.32;
    const N = 9;
    const SWEEP = 3.4;
    const cx = R;
    const cy = -0.04;
    for (let i = 0; i < N; i++) {
        const th = Math.PI + (i / (N - 1)) * SWEEP;
        const taper = 1 - (i / (N - 1)) * 0.55;
        // Long enough to overlap its neighbour: each has to cover at least the
        // arc step, R * SWEEP / (N - 1).
        const seg = box(0.16, 0.09 * taper, 0.032, C.METAL);
        at(seg, cx + Math.cos(th) * R, cy + Math.sin(th) * R, 0);
        seg.rotation.z = th + Math.PI / 2;
        g.add(seg);
    }
    return g;
}
