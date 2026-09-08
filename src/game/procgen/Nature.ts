import * as THREE from 'three';
import { C } from '../Palette.ts';
import { at, blob, box, cyl, group, hexTile, pickOf, rangeOf, rot, scl, sphere } from './Primitives.ts';

/**
 * Trees, bushes, rocks and paving. Everything takes an `rng` so a whole village
 * can be laid out deterministically from one seed.
 */

const LEAF_COLORS = [C.LEAF, C.LEAF_DARK, C.LEAF_LIGHT] as const;

/**
 * A stacked-blob tree. The reference art uses two or three overlapping rounded
 * masses rather than one cone, which is what stops it reading as a Christmas tree.
 */
export function makeTree(rng: () => number, opts: { flowering?: boolean } = {}): THREE.Group {
    const h = rangeOf(rng, 1.1, 1.9);
    const trunk = at(cyl(0.22, 0.34, h, 6, C.TRUNK), 0, h / 2, 0);

    const g = group(trunk);
    const base = pickOf(rng, LEAF_COLORS);
    const blobs = 2 + Math.floor(rng() * 2);
    let y = h + 0.5;
    for (let i = 0; i < blobs; i++) {
        const r = rangeOf(rng, 1.35, 1.75) * (1 - i * 0.17);
        const b = at(blob(r, i === 0 ? base : pickOf(rng, LEAF_COLORS)), rangeOf(rng, -0.25, 0.25), y, rangeOf(rng, -0.25, 0.25));
        scl(b, 1, rangeOf(rng, 0.72, 0.92), 1);
        rot(b, 0, rng() * Math.PI, 0);
        g.add(b);
        y += r * 0.72;
    }

    if (opts.flowering) {
        for (let i = 0; i < 7; i++) {
            const a = rng() * Math.PI * 2;
            const r = rangeOf(rng, 1.0, 1.5);
            g.add(at(sphere(0.16, rng() < 0.5 ? C.FLOWER_PINK : C.FLOWER_WHITE, 6),
                Math.cos(a) * r, h + rangeOf(rng, 0.6, 1.9), Math.sin(a) * r));
        }
    }
    return g;
}

/** Low rounded shrub, often with a couple of blossoms — the reference dots these along the path. */
export function makeBush(rng: () => number): THREE.Group {
    const g = new THREE.Group();
    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
        const r = rangeOf(rng, 0.55, 0.85);
        const b = at(blob(r, pickOf(rng, LEAF_COLORS)), rangeOf(rng, -0.4, 0.4), r * 0.7, rangeOf(rng, -0.4, 0.4));
        scl(b, 1, 0.8, 1);
        g.add(b);
    }
    for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        g.add(at(sphere(0.11, rng() < 0.6 ? C.FLOWER_PINK : C.FLOWER_WHITE, 6),
            Math.cos(a) * 0.5, rangeOf(rng, 0.5, 0.95), Math.sin(a) * 0.5));
    }
    return g;
}

/** A single daisy — scattered over the grass to break up the flat green. */
export function makeFlower(rng: () => number): THREE.Group {
    const petal = sphere(0.1, rng() < 0.5 ? C.FLOWER_WHITE : C.FLOWER_PINK, 6);
    return group(at(scl(petal, 1, 0.5, 1), 0, 0.08, 0));
}

export function makeRock(rng: () => number): THREE.Mesh {
    const r = rangeOf(rng, 0.35, 0.7);
    const m = blob(r, rng() < 0.5 ? C.STONE : C.STONE_DARK);
    scl(m, 1, rangeOf(rng, 0.55, 0.8), 1);
    rot(m, rng(), rng() * Math.PI, rng() * 0.3);
    m.position.y = r * 0.3;
    return m;
}

/**
 * A cobbled walkway laid along a polyline of XZ waypoints — hexagonal slabs
 * jittered off the centreline, exactly the paving that borders the reference farm.
 */
export function makeCobblePath(
    rng: () => number,
    waypoints: Array<[number, number]>,
    width = 2.2,
): THREE.Group {
    const g = new THREE.Group();
    const step = 0.78;
    for (let i = 0; i < waypoints.length - 1; i++) {
        const [x0, z0] = waypoints[i];
        const [x1, z1] = waypoints[i + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        const ux = dx / len, uz = dz / len;
        // Perpendicular, for spreading slabs across the path width.
        const px = -uz, pz = ux;
        const steps = Math.max(1, Math.round(len / step));
        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            const cx = x0 + dx * t, cz = z0 + dz * t;
            const lanes = Math.max(2, Math.round(width / 0.8));
            for (let l = 0; l < lanes; l++) {
                const off = (l / (lanes - 1) - 0.5) * width + rangeOf(rng, -0.12, 0.12);
                const jx = rangeOf(rng, -0.1, 0.1), jz = rangeOf(rng, -0.1, 0.1);
                // Radius quantised to three sizes rather than left a free
                // float: `hexTile` caches geometry by its dimensions, so a
                // random radius per slab meant every slab on every path built
                // and kept a geometry of its own, and the cache never hit.
                const r = 0.4 + Math.floor(rng() * 3) * 0.04;
                const tile = hexTile(r, 0.18, rng() < 0.5 ? C.PATH_STONE : C.PATH_STONE_ALT);
                // Slabs overlap by design, and every one used to sit at exactly
                // 0.055 — so where two crossed, their top faces were coplanar,
                // the depth buffer had no way to pick a winner, and the pair
                // flickered as the camera moved. A hair of vertical spread
                // settles it and is invisible at this scale.
                at(tile, cx + px * off + jx, 0.055 + rng() * 0.012, cz + pz * off + jz);
                rot(tile, 0, rng() * Math.PI, 0);
                g.add(tile);
            }
        }
    }
    return g;
}

/** A tuft of grass blades — cheap vertical interest on an otherwise flat plane. */
export function makeGrassTuft(rng: () => number): THREE.Group {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
        const h = rangeOf(rng, 0.25, 0.45);
        const blade = at(box(0.07, h, 0.07, C.LEAF_DARK), rangeOf(rng, -0.15, 0.15), h / 2, rangeOf(rng, -0.15, 0.15));
        rot(blade, rangeOf(rng, -0.3, 0.3), rng() * Math.PI, rangeOf(rng, -0.3, 0.3));
        g.add(blade);
    }
    return g;
}
