import * as THREE from 'three';
import { GROUND_SIZE, YARD } from '../Config.ts';
import { C } from '../Palette.ts';
import { at, box, disc, makeRng, plane, rangeOf, rot, scl } from '../procgen/Primitives.ts';
import { makeBush, makeCobblePath, makeFlower, makeGrassTuft, makeRock, makeTree } from '../procgen/Nature.ts';
import {
    makeBarrel, makeCart, makeCow, makeCrate, makeFenceRect, makeFountain, makeLampPost,
} from '../procgen/Structures.ts';
import { makeHouse } from '../procgen/Structures.ts';

/**
 * Assembles everything the player can see but never interacts with: the grass,
 * the cobbled ring road, the fence that bounds play, and the village of
 * cottages, trees, carts and cattle beyond it.
 *
 * All of it is static, so it goes into the THREE scene as raw meshes — the
 * pattern `skills/3d/three-integration.md` prescribes for geometry with no
 * lifecycle to manage.
 */
export function buildEnvironment(seed = 0xC0FFEE): THREE.Group {
    const rng = makeRng(seed);
    const world = new THREE.Group();

    // ── Grass ────────────────────────────────────────────────────────────────
    const grass = plane(GROUND_SIZE, GROUND_SIZE, C.GRASS, { flat: false });
    grass.receiveShadow = true;
    grass.castShadow = false;
    world.add(grass);

    // Broad tonal patches break up the flat green without needing a texture.
    // Discs, not rectangles: a hard-edged square of darker grass reads as a
    // rendering bug rather than as ground variation.
    for (let i = 0; i < 30; i++) {
        const patch = disc(rangeOf(rng, 2.5, 6.0), C.GRASS_DARK, 12, { flat: false });
        patch.receiveShadow = false;
        patch.castShadow = false;
        at(patch, rangeOf(rng, -70, 70), 0.015, rangeOf(rng, -70, 70));
        scl(patch, 1, 1, rangeOf(rng, 0.65, 1.35));
        rot(patch, 0, rng() * Math.PI, 0);
        world.add(patch);
    }

    // ── Cobbled ring road, just outside the fence ────────────────────────────
    const pad = 4.2;
    const ring: Array<[number, number]> = [
        [YARD.minX - pad, YARD.minZ - pad],
        [YARD.maxX + pad, YARD.minZ - pad],
        [YARD.maxX + pad, YARD.maxZ + pad],
        [YARD.minX - pad, YARD.maxZ + pad],
        [YARD.minX - pad, YARD.minZ - pad],
    ];
    const road = makeCobblePath(rng, ring, 2.6);
    road.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.receiveShadow = true; o.castShadow = false; } });
    world.add(road);

    // ── Fence around the playable yard ───────────────────────────────────────
    const fence = makeFenceRect(YARD.minX, YARD.maxX, YARD.minZ, YARD.maxZ);
    fence.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    world.add(fence);

    // ── Village: cottages along the north and west approaches ────────────────
    const houseSpots: Array<[number, number, number]> = [
        [YARD.minX - 12, YARD.minZ - 9, 0.2],
        [YARD.minX - 3, YARD.minZ - 12, -0.1],
        [YARD.minX + 9, YARD.minZ - 13, 0.05],
        [YARD.minX + 21, YARD.minZ - 11, -0.25],
        [YARD.minX - 15, YARD.minZ + 6, 1.4],
        [YARD.minX - 17, YARD.minZ + 18, 1.5],
        [YARD.minX - 14, YARD.maxZ + 2, 1.7],
        [YARD.maxX + 13, YARD.minZ - 4, -1.5],
        [YARD.maxX + 15, YARD.minZ + 12, -1.6],
    ];
    for (const [x, z, yaw] of houseSpots) {
        const h = makeHouse(rng);
        at(rot(h, 0, yaw, 0), x, 0, z);
        h.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        world.add(h);
    }

    // ── Fountain and lamps on the village green ──────────────────────────────
    const fountain = makeFountain();
    at(fountain, YARD.minX - 9, 0, YARD.minZ - 1);
    fountain.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    world.add(fountain);

    for (const [x, z] of [
        [YARD.minX - pad - 1.6, YARD.minZ + 4],
        [YARD.minX - pad - 1.6, YARD.minZ + 22],
        [YARD.minX + 6, YARD.minZ - pad - 1.6],
        [YARD.maxX - 8, YARD.minZ - pad - 1.6],
        [YARD.maxX + pad + 1.6, YARD.maxZ - 10],
    ] as Array<[number, number]>) {
        const lamp = makeLampPost();
        at(lamp, x, 0, z);
        lamp.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        world.add(lamp);
    }

    // ── A parked cart and some clutter ───────────────────────────────────────
    const cart = makeCart();
    at(rot(cart, 0, 0.6, 0), YARD.minX - 7, 0, YARD.minZ - 8);
    cart.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    world.add(cart);

    for (let i = 0; i < 7; i++) {
        const [x, z] = sampleOutside(rng, 6, 20);
        const prop = rng() < 0.5 ? makeBarrel() : makeCrate(rangeOf(rng, 0.7, 1.05));
        at(rot(prop, 0, rng() * Math.PI, 0), x, 0, z);
        prop.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        world.add(prop);
    }

    // ── Cattle grazing in the west pasture ───────────────────────────────────
    for (let i = 0; i < 5; i++) {
        const cow = makeCow(rng);
        at(cow, YARD.minX - rangeOf(rng, 14, 26), 0, YARD.maxZ - rangeOf(rng, -6, 16));
        cow.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        world.add(cow);
    }

    // ── Trees, bushes, rocks and flowers scattered outside the fence ─────────
    for (let i = 0; i < 46; i++) {
        const [x, z] = sampleOutside(rng, 5, 46);
        const tree = makeTree(rng, { flowering: rng() < 0.25 });
        at(rot(scl(tree, rangeOf(rng, 0.8, 1.25)), 0, rng() * Math.PI, 0), x, 0, z);
        tree.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        world.add(tree);
    }

    for (let i = 0; i < 40; i++) {
        const [x, z] = sampleOutside(rng, 2, 40);
        const bush = makeBush(rng);
        at(bush, x, 0, z);
        bush.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        world.add(bush);
    }

    for (let i = 0; i < 18; i++) {
        const [x, z] = sampleOutside(rng, 2, 44);
        world.add(at(makeRock(rng), x, 0, z));
    }

    // Flowers and tufts are allowed inside the yard too — they're flat decals
    // in practice and never block the player.
    for (let i = 0; i < 130; i++) {
        const x = rangeOf(rng, -75, 75);
        const z = rangeOf(rng, -75, 75);
        const d = rng() < 0.55 ? makeFlower(rng) : makeGrassTuft(rng);
        at(d, x, 0, z);
        world.add(d);
    }

    return world;
}

/**
 * Picks a point outside the fenced yard, between `minPad` and `maxPad` units
 * beyond it, so decoration never lands where the player walks.
 */
function sampleOutside(rng: () => number, minPad: number, maxPad: number): [number, number] {
    for (let attempt = 0; attempt < 24; attempt++) {
        const x = rangeOf(rng, YARD.minX - maxPad, YARD.maxX + maxPad);
        const z = rangeOf(rng, YARD.minZ - maxPad, YARD.maxZ + maxPad);
        const dx = Math.max(YARD.minX - x, 0, x - YARD.maxX);
        const dz = Math.max(YARD.minZ - z, 0, z - YARD.maxZ);
        const outside = Math.max(dx, dz);
        if (outside >= minPad) return [x, z];
    }
    // Fallback: hug the western edge rather than risk a prop inside the fence.
    return [YARD.minX - minPad - 2, rangeOf(rng, YARD.minZ, YARD.maxZ)];
}

/** Clamps a position to the fenced play area, leaving room for the character's body. */
export function clampToYard(x: number, z: number, radius: number): { x: number; z: number } {
    return {
        x: Math.min(YARD.maxX - radius, Math.max(YARD.minX + radius, x)),
        z: Math.min(YARD.maxZ - radius, Math.max(YARD.minZ + radius, z)),
    };
}
