import * as THREE from 'three';
import { GROUND_SIZE, VILLAGE, YARD } from '../Config.ts';
import { C } from '../Palette.ts';
import { at, disc, makeRng, plane, rangeOf, rot, scl } from '../procgen/Primitives.ts';
import { makeBush, makeCobblePath, makeFlower, makeGrassTuft, makeRock, makeTree } from '../procgen/Nature.ts';
import {
    makeBarrel, makeCart, makeCow, makeCrate, makeFenceRect, makeFountain, makeHouse, makeLampPost,
} from '../procgen/Structures.ts';

/**
 * Assembles everything the player can see but never interacts with: the grass,
 * the cobbled ring road, the fence that bounds play, and the village of
 * cottages, trees, carts and cattle beyond it.
 *
 * All of it is static, so it goes into the THREE scene as raw meshes — the
 * pattern `skills/3d/three-integration.md` prescribes for geometry with no
 * lifecycle to manage.
 */
export function buildEnvironment(seed = VILLAGE.seed): THREE.Group {
    const rng = makeRng(seed);
    const world = new THREE.Group();
    const V = VILLAGE;

    const solid = (o: THREE.Object3D) => {
        o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        world.add(o);
    };

    // ── Grass ────────────────────────────────────────────────────────────────
    const grass = plane(GROUND_SIZE, GROUND_SIZE, C.GRASS, { flat: false });
    grass.receiveShadow = true;
    grass.castShadow = false;
    world.add(grass);

    // Broad tonal patches break up the flat green without needing a texture.
    // Discs, not rectangles: a hard-edged square of darker grass reads as a
    // rendering bug rather than as ground variation.
    for (let i = 0; i < V.grassPatches.count; i++) {
        const patch = disc(rangeOf(rng, V.grassPatches.minR, V.grassPatches.maxR), C.GRASS_DARK, 12, { flat: false });
        // Must receive: these sit ABOVE the ground plane, so without this they
        // punch un-shadowed holes through anything cast onto the grass.
        patch.receiveShadow = true;
        patch.castShadow = false;
        const sp = V.grassPatches.spread;
        at(patch, rangeOf(rng, -sp, sp), 0.015, rangeOf(rng, -sp, sp));
        scl(patch, 1, 1, rangeOf(rng, 0.65, 1.35));
        rot(patch, 0, rng() * Math.PI, 0);
        world.add(patch);
    }

    // ── Cobbled ring road, just outside the fence ────────────────────────────
    const pad = V.pathPadding;
    const ring: Array<[number, number]> = [
        [YARD.minX - pad, YARD.minZ - pad],
        [YARD.maxX + pad, YARD.minZ - pad],
        [YARD.maxX + pad, YARD.maxZ + pad],
        [YARD.minX - pad, YARD.maxZ + pad],
        [YARD.minX - pad, YARD.minZ - pad],
    ];
    const road = makeCobblePath(rng, ring, V.pathWidth);
    road.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.receiveShadow = true; o.castShadow = false; } });
    world.add(road);

    // ── Fence around the playable yard ───────────────────────────────────────
    solid(makeFenceRect(YARD.minX, YARD.maxX, YARD.minZ, YARD.maxZ));

    // ── Placed landmarks ─────────────────────────────────────────────────────
    for (const spot of V.houses) {
        solid(at(rot(makeHouse(rng), 0, spot.yaw, 0), spot.x, 0, spot.z));
    }

    solid(at(makeFountain(), V.fountain.x, 0, V.fountain.z));
    solid(at(rot(makeCart(), 0, V.cart.yaw, 0), V.cart.x, 0, V.cart.z));

    for (const spot of V.lamps) {
        const lamp = makeLampPost();
        at(lamp, spot.x, 0, spot.z);
        lamp.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        world.add(lamp);
    }

    // ── Loose clutter ────────────────────────────────────────────────────────
    for (let i = 0; i < V.scatter.props.count; i++) {
        const [x, z] = sampleOutside(rng, V.scatter.props.minPad, V.scatter.props.maxPad);
        const prop = rng() < 0.5 ? makeBarrel() : makeCrate(rangeOf(rng, 0.7, 1.05));
        solid(at(rot(prop, 0, rng() * Math.PI, 0), x, 0, z));
    }

    // ── Cattle grazing in the west pasture ───────────────────────────────────
    for (let i = 0; i < V.cattle.count; i++) {
        solid(at(makeCow(rng),
            YARD.minX - rangeOf(rng, V.cattle.minOut, V.cattle.maxOut), 0,
            YARD.maxZ - rangeOf(rng, V.cattle.zFrom, V.cattle.zTo)));
    }

    // ── Trees, bushes, rocks and flowers scattered outside the fence ─────────
    for (let i = 0; i < V.scatter.trees.count; i++) {
        const [x, z] = sampleOutside(rng, V.scatter.trees.minPad, V.scatter.trees.maxPad);
        const tree = makeTree(rng, { flowering: rng() < V.scatter.trees.floweringChance });
        solid(at(rot(scl(tree, rangeOf(rng, 0.8, 1.25)), 0, rng() * Math.PI, 0), x, 0, z));
    }

    for (let i = 0; i < V.scatter.bushes.count; i++) {
        const [x, z] = sampleOutside(rng, V.scatter.bushes.minPad, V.scatter.bushes.maxPad);
        solid(at(makeBush(rng), x, 0, z));
    }

    for (let i = 0; i < V.scatter.rocks.count; i++) {
        const [x, z] = sampleOutside(rng, V.scatter.rocks.minPad, V.scatter.rocks.maxPad);
        world.add(at(makeRock(rng), x, 0, z));
    }

    // Flowers and tufts are allowed inside the yard too — they're flat decals
    // in practice and never block the player.
    const gc = V.scatter.groundCover;
    for (let i = 0; i < gc.count; i++) {
        const d = rng() < 0.55 ? makeFlower(rng) : makeGrassTuft(rng);
        at(d, rangeOf(rng, -gc.spread, gc.spread), 0, rangeOf(rng, -gc.spread, gc.spread));
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
