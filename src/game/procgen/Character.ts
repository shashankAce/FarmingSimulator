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
     * Where carried crates are parented — on the character's BACK, so a tall
     * stack rides behind them instead of covering the body from this camera.
     */
    holdAnchor: THREE.Object3D;
    /** Phase accumulator owned by `animateCharacter`. */
    phase: number;
    /**
     * Harvest swing. `sweepTo` is the offset the blade is travelling toward, in
     * radians either side of the character's facing; `sweepAt` is where it has
     * got to. Held as an OFFSET rather than an absolute heading so the caller
     * still owns which way the character faces.
     */
    sweepTo: number;
    sweepAt: number;
    /** Seconds of swinging left before the arms drop and the blade recentres. */
    sweepHold: number;
    /**
     * Where the current swing started from as a fraction of `swingArc`, and
     * seconds into it. Kept as a fraction so `swingAngle` can work in one
     * normalised space and be scaled to the arc once, at the end.
     */
    swingFrom: number;
    swingT: number;
    /** Half-width of the arc this swing covers, in radians. */
    swingArc: number;
    /**
     * How strongly the swing pose owns the arms, 0..1. Eased rather than
     * switched, or the arms snap in and out of the walk cycle mid-stride.
     */
    sweepBlend: number;
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

/**
 * Where carried crates hang off the character, in root space.
 *
 * `HOLD_Z` is negative — the load sits BEHIND the body. Crates stack upward
 * from here, so `HOLD_Y` is the height the bottom of the pile rests at: high
 * enough to read as being on the back rather than dragged along the ground.
 */
const HOLD_Y = 0.62;
const HOLD_Z = -0.62;

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
        // 'YXZ', so `rotation.y` swings an already-raised arm HORIZONTALLY
        // about the shoulder — the motion a swing is made of. Under the default
        // 'XYZ' the Y term is applied to an arm still hanging straight down,
        // where a rotation about its own axis does nothing visible. Poses that
        // leave `y` at 0 (the walk cycle, the carry pose) are unaffected: with
        // no Y term the two orders are the same matrix.
        arm.rotation.order = 'YXZ';
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

    // ── Hold anchor: on the BACK, not out in front ──
    // Behind the torso (its back surface sits at about z = -0.48) and up at
    // shoulder height, so the pile rides the back like a load strapped on
    // rather than floating past the snout and hiding the character.
    const holdAnchor = new THREE.Object3D();
    at(holdAnchor, 0, HOLD_Y, HOLD_Z);
    root.add(holdAnchor);

    root.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = false; } });

    // Scaled at the root, so every part, the tool on the arm and the carry
    // anchor all move together. Anything parented in later that must NOT grow
    // with the character has to divide this back out.
    root.scale.setScalar(CHARACTER.scale);

    return {
        root, body, head, armL, armR, legL, legR, earL, earR, holdAnchor,
        phase: 0, sweepTo: 0, sweepAt: 0, sweepHold: 0,
        swingFrom: 0, swingT: 0, swingArc: 0, sweepBlend: 0,
    };
}

/**
 * Drives the walk cycle. `speed01` is normalised movement speed (0 = idle,
 * 1 = full tilt); at 0 the rig settles into a gentle idle breath instead.
 *
 * While `carrying`, the arms are locked back onto the load on the character's
 * back instead of counter-swinging — the legs and body keep their full cycle,
 * which is what sells the weight.
 */
/** How quickly the blade unwinds back to centre once cutting stops. */
const SWEEP_RATE = 9;

/**
 * ── The harvest swing ──
 *
 * One cut is a timeline, not a pose: the blade winds BACK past where it
 * started, whips through the arc, and overshoots slightly before settling.
 * `SWING_DUR` is kept under `HARVEST.interval` so a swing always finishes
 * before the next one is asked for.
 */
const SWING_DUR = 0.46;
/**
 * Fraction of the swing spent lifting back to the ready side.
 *
 * Over half, so the lift is the SLOW half and the cut the fast one. Every chop
 * goes the same way round — out to the ready side, then across — because a
 * blade that cut on the way out and again on the way back read as two
 * different motions alternating rather than one repeated swing.
 */
const LIFT_FRAC = 0.55;
/** How far past the ready side the lift carries, as a fraction of the half-arc. */
const COCK_OVER = 1.06;
/**
 * Seconds from asking for a swing to the blade crossing the middle of its arc —
 * the moment the crop should come out of the ground.
 *
 * Derived from the timeline rather than picked, so retiming the swing cannot
 * leave the harvest landing at the wrong moment. The extra fraction over
 * `LIFT_FRAC` is because the cut still has to travel from the ready side to
 * centre after the lift ends.
 */
export const SWING_CUT_DELAY = SWING_DUR * (LIFT_FRAC + 0.06);
/**
 * How the blade's travel is DIVIDED UP. The character's own turn and a twist of
 * the torso carry most of it and the shoulder swings through the rest, so the
 * blade covers its arc by being swung rather than by the character spinning on
 * the spot with a stiff arm — which is what the old single `root.rotation.y`
 * did.
 */
const ROOT_SHARE = 0.5;
const TWIST_SHARE = 0.2;
/**
 * Blade-arm shoulder pitch: out and low on the ready side, reaching across
 * through the cut. Both shallow, which is what keeps the sickle down near the
 * carrots — pitched further forward the arm rises and the blade sweeps the air
 * above them.
 */
const LIFT_PITCH = -0.8;
const CUT_PITCH = -1.2;
/**
 * Shoulder abduction, held for the whole swing — it is what keeps both arms
 * clear of the body.
 */
const ABDUCT = 0.3;
/**
 * Horizontal shoulder swing, and the limits it is clamped to.
 *
 * `ARM_IN` is small on purpose, and is the reason this is three constants
 * rather than one amplitude: swung inward much past it the paw crosses in
 * front of the chest and the arm and sickle vanish into the torso. Outward has
 * nothing to hit, so it gets the wider half of the range. Both limits were
 * checked against the torso ellipsoid and the overalls at every point of the
 * swing — the old pose sat half a unit INSIDE the torso, because a
 * `rotation.z` swing travels through the body's own mid-plane.
 */
const ARM_LEAD = 0.46;
const ARM_IN = 0.22;
const ARM_OUT = 0.62;
/** Lean into the cut, and the forward dip through it. */
const SWING_LEAN = 0.07;
const SWING_DIP = 0.1;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The cut's own easing: leaves fast, overshoots a little and settles, rather
 * than arriving and stopping dead. That overshoot is the follow-through.
 */
const cutEase = (q: number) => 1 + 1.7 * Math.pow(q - 1, 3) + 0.7 * Math.pow(q - 1, 2);

/** The lift: slow in, slow out. Gentler than the cut, so it reads as a reset. */
const liftEase = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);

/**
 * How far through the swing the blade is, as a fraction of the half-arc: +1 is
 * the ready side it cuts FROM, -1 the far side it finishes on.
 *
 * `from` is where the blade actually was when this swing started, so the lift
 * picks up from wherever the last cut left it — or from centre, the first time.
 */
function swingAngle(t: number, from: number): number {
    const p = Math.min(1, t / SWING_DUR);
    if (p < LIFT_FRAC) return from + (COCK_OVER - from) * liftEase(p / LIFT_FRAC);
    return COCK_OVER + (-1 - COCK_OVER) * cutEase((p - LIFT_FRAC) / (1 - LIFT_FRAC));
}

/**
 * How cocked the blade arm is: 1 fully back on the ready side, 0 swung right
 * through the cut. Slightly negative on the follow-through.
 *
 * One curve for the whole arm — pitch and horizontal swing both run off it —
 * and it ends each swing at 0 where the next one's lift begins, so consecutive
 * chops join up instead of snapping at the seam. A cut is asked for every
 * `HARVEST.interval`, so that seam is crossed constantly.
 */
function swingCocked(t: number): number {
    const p = Math.min(1, t / SWING_DUR);
    if (p < LIFT_FRAC) return liftEase(p / LIFT_FRAC);
    return 1 - cutEase((p - LIFT_FRAC) / (1 - LIFT_FRAC));
}

/** Eases one arm from wherever the walk cycle just put it toward a pose. */
function blendArm(arm: THREE.Group, x: number, y: number, z: number, w: number): void {
    arm.rotation.set(
        arm.rotation.x + (x - arm.rotation.x) * w,
        arm.rotation.y + (y - arm.rotation.y) * w,
        arm.rotation.z + (z - arm.rotation.z) * w,
    );
}

/**
 * Starts one chop of the blade: lift out to the ready side, cut across.
 *
 * Always the same way round rather than alternating ends of the arc — the
 * character is turning through the same arc either way, and one repeated
 * motion reads as a swing where a to-and-fro read as two.
 *
 * `hold` wants to outlast the gap between cuts, so the arms only drop once
 * harvesting actually stops.
 */
export function startSwing(rig: CharacterRig, halfArc: number, hold: number): void {
    rig.swingFrom = halfArc > 0 ? clamp(rig.sweepAt / halfArc, -1.2, 1.2) : 0;
    rig.swingArc = halfArc;
    rig.sweepTo = -halfArc;
    rig.swingT = 0;
    rig.sweepHold = hold;
}

export function animateCharacter(rig: CharacterRig, dt: number, speed01: number, carrying = false): void {
    rig.phase += dt * (4.0 + speed01 * 9.0);
    const s = Math.min(1, speed01);
    const swing = Math.sin(rig.phase);

    // Legs alternate; arms counter-swing unless they're busy holding something.
    rig.legL.rotation.x = swing * 0.85 * s;
    rig.legR.rotation.x = -swing * 0.85 * s;
    if (carrying) {
        // Swung back and tucked in, as if gripping the load behind them —
        // reaching forward would leave both paws out over nothing now that the
        // crates sit on the back.
        rig.armL.rotation.set(0.62, 0, -0.22);
        rig.armR.rotation.set(0.62, 0, 0.22);
    } else {
        rig.armL.rotation.set(-swing * 0.7 * s, 0, 0);
        rig.armR.rotation.set(swing * 0.7 * s, 0, 0);
    }

    // Harvest swing: advance the timeline, then take over the arms. Applied
    // AFTER the walk cycle has set them so it wins either way, and added ON TOP
    // of the facing the caller wrote to `root` this frame.
    if (rig.sweepHold > 0) {
        rig.sweepHold = Math.max(0, rig.sweepHold - dt);
        rig.swingT += dt;
        rig.sweepAt = swingAngle(rig.swingT, rig.swingFrom) * rig.swingArc;
    } else {
        // Nothing has asked for another cut: unwind to centre.
        rig.sweepAt -= rig.sweepAt * Math.min(1, dt * SWEEP_RATE);
    }
    rig.sweepBlend += ((rig.sweepHold > 0 ? 1 : 0) - rig.sweepBlend) * Math.min(1, dt * 9);
    const cut = rig.sweepBlend;

    rig.root.rotation.y += rig.sweepAt * ROOT_SHARE;
    rig.body.rotation.y = rig.sweepAt * TWIST_SHARE * cut;

    if (cut > 0.001) {
        const cocked = swingCocked(rig.swingT);
        // The shoulder swings WITH the blade, so the arm adds to the turn
        // instead of cancelling it: out to the ready side on the lift, then
        // across. Clamped only to catch the follow-through's overshoot.
        const lead = clamp(-ARM_IN + (ARM_OUT + ARM_IN) * cocked, -ARM_IN, ARM_OUT);
        blendArm(rig.armR, CUT_PITCH + (LIFT_PITCH - CUT_PITCH) * cocked, lead, ABDUCT, cut);
        // The free arm counters, at less than half the swing, for balance.
        blendArm(rig.armL, -0.5 - 0.14 * (1 - cocked), -lead * 0.4, -ABDUCT + 0.02, cut);
    }

    // Body bob is double-frequency (one hop per step, not per stride), on top
    // of the resting height the legs put it at.
    rig.body.position.y = BODY_Y + Math.abs(Math.sin(rig.phase)) * 0.11 * s;
    rig.body.rotation.z = swing * 0.05 * s;

    // Leans toward whichever side the blade is on and dips forward as the cut
    // comes through. Added AFTER the walk lean rather than before it — the old
    // code set this above and had it overwritten one line later, so the swing
    // never actually leaned at all.
    if (cut > 0.001) {
        const side = clamp(rig.sweepAt / (rig.swingArc || 1), -1, 1);
        rig.body.rotation.z -= SWING_LEAN * side * cut;
        rig.body.rotation.x = SWING_DIP * (1 - swingCocked(rig.swingT)) * cut;
    } else {
        rig.body.rotation.x = 0;
    }

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
    rig.armR.add(at(rot(scl(makeSickle(), 0.9), 0, Math.PI, 0), 0.04, -0.78, 0.06));
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
