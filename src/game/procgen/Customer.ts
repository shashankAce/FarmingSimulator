import * as THREE from 'three';
import { at, blob, box, cone, pickOf, rangeOf, rot, scl, sphere } from './Primitives.ts';

/**
 * The rounded, penguin-ish shoppers that queue at the juice stand.
 *
 * Deliberately a different silhouette from the farmer rig in `Character.ts` —
 * squat and armless-looking — so a glance at the queue never reads as "another
 * worker". Same idea though: primitives plus a couple of pivots to animate.
 */

export interface CustomerRig {
    root: THREE.Group;
    /** Bobs while walking and hops when an order is filled. */
    body: THREE.Group;
    flipperL: THREE.Group;
    flipperR: THREE.Group;
    phase: number;
}

const COATS = [0x3b3a44, 0x4a3b33, 0x2f3b52, 0x53414f, 0x37474a] as const;
const BELLIES = [0xf5f0e6, 0xf0e6d8, 0xfaf4e8] as const;

export function makeCustomer(rng: () => number): CustomerRig {
    const coat = pickOf(rng, COATS);
    const belly = pickOf(rng, BELLIES);
    const beak = 0xe8a13c;

    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    // ── Torso: one big rounded mass, head included — that's the whole read ──
    const torso = at(blob(0.62, coat, 1), 0, 0.66, 0);
    scl(torso, 1, 1.16, 0.95);
    body.add(torso);

    // Belly patch, pushed forward so it doesn't z-fight the torso.
    const bellyPatch = at(sphere(0.44, belly, 10), 0, 0.58, 0.28);
    scl(bellyPatch, 0.92, 1.12, 0.6);
    body.add(bellyPatch);

    // ── Face: two white patches with dark eyes, and a stubby beak ──
    for (const x of [-0.2, 0.2]) {
        const patch = at(sphere(0.19, belly, 8), x, 1.02, 0.4);
        scl(patch, 1, 1.15, 0.55);
        body.add(patch);
        body.add(at(sphere(0.085, 0x241f1c, 8), x, 1.04, 0.52));
    }
    const nose = at(cone(0.13, 0.24, 6, beak), 0, 0.86, 0.5);
    rot(nose, Math.PI / 2, 0, 0);
    body.add(nose);

    // ── Flippers: flattened blobs on pivots at the shoulder ──
    const flipperL = new THREE.Group();
    const flipperR = new THREE.Group();
    at(flipperL, -0.6, 0.72, 0);
    at(flipperR, 0.6, 0.72, 0);
    for (const [f, sign] of [[flipperL, -1], [flipperR, 1]] as const) {
        const fin = at(sphere(0.22, coat, 8), 0, -0.18, 0);
        scl(fin, 0.36, 1.25, 0.75);
        rot(fin, 0, 0, sign * 0.2);
        f.add(fin);
        body.add(f);
    }

    // ── Feet ──
    for (const x of [-0.22, 0.22]) {
        const foot = at(box(0.22, 0.1, 0.34, beak), x, 0.05, 0.12);
        body.add(foot);
    }

    // A little size variety so the queue isn't a row of clones.
    scl(root, rangeOf(rng, 1.12, 1.34));
    root.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = false; } });

    return { root, body, flipperL, flipperR, phase: rng() * Math.PI * 2 };
}

/** Waddle while moving, idle sway while queuing. */
export function animateCustomer(rig: CustomerRig, dt: number, speed01: number): void {
    rig.phase += dt * (2.4 + speed01 * 7);
    const s = Math.min(1, speed01);
    const swing = Math.sin(rig.phase);

    rig.body.position.y = Math.abs(swing) * 0.09 * s;
    // Penguins rock side to side rather than swinging legs.
    rig.body.rotation.z = swing * (0.06 + 0.1 * s);
    rig.flipperL.rotation.x = swing * 0.5 * s;
    rig.flipperR.rotation.x = -swing * 0.5 * s;
}

/** A short delighted hop, played when an order is completed. */
export function hopCustomer(rig: CustomerRig, t01: number): void {
    rig.body.position.y = Math.sin(t01 * Math.PI) * 0.45;
    rig.flipperL.rotation.z = -Math.sin(t01 * Math.PI) * 1.1;
    rig.flipperR.rotation.z = Math.sin(t01 * Math.PI) * 1.1;
}
