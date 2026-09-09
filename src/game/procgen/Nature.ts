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
    stoneR = 0.42,
    spacing = 1.86,
): THREE.Group {
    const g = new THREE.Group();
    const step = stoneR * spacing;
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
            // Lanes follow the stone size too, so a wider stone does not simply
            // overlap its neighbour across the road.
            const lanes = Math.max(2, Math.round(width / (step * 1.03)));
            for (let l = 0; l < lanes; l++) {
                const off = (l / (lanes - 1) - 0.5) * width + rangeOf(rng, -0.12, 0.12) * stoneR / 0.42;
                const j = 0.1 * stoneR / 0.42;
                const jx = rangeOf(rng, -j, j), jz = rangeOf(rng, -j, j);
                // Radius quantised to three sizes rather than left a free
                // float: `hexTile` caches geometry by its dimensions, so a
                // random radius per slab meant every slab on every path built
                // and kept a geometry of its own, and the cache never hit.
                // Quantised in PROPORTION to the configured radius, so the
                // cache still hits at any size.
                const r = stoneR * (0.95 + Math.floor(rng() * 3) * 0.1);
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

/**
 * Repeats of the stone pattern along one texture tile.
 *
 * The tile's WORLD length is derived from this and the stone spacing rather
 * than fixed, so a stone is always the same number of pixels across whatever
 * size it is set to, and a repeat always holds the same number of stones.
 */
const BAKED_CELLS = 7;
/** Canvas length along the road, in pixels. */
const BAKED_SIZE = 512;

/** `0xrrggbb` to a CSS colour, for canvas drawing. */
const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** Multiplies a palette colour, for the darker rim standing in for a stone's sides. */
function shade(hex: number, k: number): string {
    const r = Math.round(((hex >> 16) & 255) * k);
    const g = Math.round(((hex >> 8) & 255) * k);
    const b = Math.round((hex & 255) * k);
    return `rgb(${r},${g},${b})`;
}

/**
 * Paints the cobbled road as a strip that repeats ALONG its length.
 *
 * ── Why a strip and not a world-aligned field ──
 *
 * The road is laid in lanes ACROSS its width — three of them at this stone
 * size, the same count and the same offsets the geometry version uses. A
 * world-aligned texture cannot do that: the road runs along X on two sides of
 * the ring and along Z on the other two, so a fixed grid crosses it at a
 * different place on every side, giving three stones here and four there with
 * half-stones at the edges. Running the texture ALONG the road instead makes
 * the lane count exact everywhere.
 *
 * The cost is that the texture's orientation rotates a quarter turn between
 * sides, so nothing DIRECTIONAL can be baked into it — no fixed light, no fixed
 * camera. Hence the rim below is radial: a stone reads as having sides without
 * claiming which way they face. That is also why this cannot come out looking
 * inverted, however the corners fall.
 *
 * Seamless along its length by drawing every stone three times, offset by ±one
 * tile in x. Across the width it does not repeat, so `wrapT` clamps.
 *
 * Generated in memory rather than loaded, which is what keeps it legal for a
 * single-file playable build — see the asset rule in AI_WORKFLOW.md.
 */
export function makeCobbleTexture(
    rng: () => number, width = 2.6, stoneR = 0.42, spacing = 1.86,
): { tex: THREE.CanvasTexture; tileWorld: number; bandWidth: number } {
    const step = stoneR * spacing;
    const tileWorld = BAKED_CELLS * step;
    const px = BAKED_SIZE / tileWorld;
    // A stone radius of margin each side, so the outermost lane sits WHOLE
    // inside the band. Without it the band's edge cut every edge stone in half,
    // which is the cropped look — where the geometry road simply lets them
    // overhang onto the grass.
    const bandWidth = width + 2 * stoneR;

    const w = BAKED_SIZE;
    const h = Math.max(8, Math.round(bandWidth * px));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;

    // The GROUND colour, not earth: the geometry road is loose slabs on the
    // lawn, so its gaps show grass. Soil here put a brown road under every
    // stone. Beyond the outermost lane this is all that shows, which is what
    // gives the band the same ragged edge the slabs had.
    ctx.fillStyle = css(C.GRASS);
    ctx.fillRect(0, 0, w, h);

    const hex = (cx: number, cy: number, r: number, fill: string, spin: number) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = spin + (i / 6) * Math.PI * 2;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
    };

    /**
     * One stone: a darker ring standing in for its sides, then its top face in
     * the palette colour, unmodified.
     *
     * The top face is left alone deliberately. A geometry stone's top has the
     * same upward normal this band does, so the sun lights both identically —
     * anything painted over it puts the baked road off the palette. What was
     * missing is the SIDES, which face outward, catch less of a 58-degree sun
     * and so read darker; a ring of the stone's own colour at 72% is that,
     * without needing to know which way the light comes from.
     */
    const stone = (cx: number, cy: number, r: number, colour: number, spin: number) => {
        hex(cx, cy, r, shade(colour, 0.72), spin);
        hex(cx, cy, r * 0.82, css(colour), spin);
    };

    // Lanes across the road, and their offsets, exactly as `makeCobblePath`
    // computes them — the two roads have to agree on this or the swap is
    // visible.
    const lanes = Math.max(2, Math.round(width / (step * 1.03)));
    const cells = Math.round(tileWorld / step);
    const jitter = 0.1 * (stoneR / 0.42) * px;

    for (let c = 0; c < cells; c++) {
        for (let l = 0; l < lanes; l++) {
            const off = (l / (lanes - 1) - 0.5) * width + rangeOf(rng, -0.12, 0.12) * (stoneR / 0.42);
            const cx = (c + 0.5) * (w / cells) + rangeOf(rng, -jitter, jitter);
            const cy = h / 2 + off * px;
            const r = stoneR * px * rangeOf(rng, 0.92, 1.06);
            const colour = rng() < 0.5 ? C.PATH_STONE : C.PATH_STONE_ALT;
            const spin = rng() * Math.PI;
            // Wrapped along the length only.
            for (const ox of [-w, 0, w]) {
                if (cx + ox < -r || cx + ox > w + r) continue;
                stone(cx + ox, cy, r, colour, spin);
            }
        }
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    // Cobbles seen at a shallow angle down the road smear badly on the default
    // setting; clamped to whatever the device supports.
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, tileWorld, bandWidth };
}

/**
 * The ring road as one textured band instead of hundreds of stone meshes.
 *
 * Built as the area BETWEEN two rectangles, mitred at the corners, which comes
 * to four trapezoids — eight triangles and one draw call for the whole road.
 * The mitre is what avoids overlapping quads at the corners, where two coplanar
 * layers of road would z-fight.
 *
 * `u` runs along the band so the pattern repeats down the road, `v` across it
 * so the lanes line up with the road on all four sides. `u` takes a jump at
 * each corner, which cobbles hide — and unlike a world-aligned mapping, the
 * lanes are right everywhere.
 *
 * `bandWidth` is the texture's full width including its grass margin, so pass
 * the one `makeCobbleTexture` returns rather than the road width.
 */
export function makeCobbleRing(
    minX: number, maxX: number, minZ: number, maxZ: number,
    bandWidth: number, tex: THREE.CanvasTexture, tileWorld: number,
): THREE.Mesh {
    const h = bandWidth / 2;
    const outer: Array<[number, number]> = [
        [minX - h, minZ - h], [maxX + h, minZ - h], [maxX + h, maxZ + h], [minX - h, maxZ + h],
    ];
    const inner: Array<[number, number]> = [
        [minX + h, minZ + h], [maxX - h, minZ + h], [maxX - h, maxZ - h], [minX + h, maxZ - h],
    ];

    const pos: number[] = [];
    const uv: number[] = [];
    const norm: number[] = [];
    const idx: number[] = [];
    let run = 0;

    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const [ox0, oz0] = outer[i], [ox1, oz1] = outer[j];
        const [ix0, iz0] = inner[i], [ix1, iz1] = inner[j];
        // Along the OUTER edge, which is the longer of the two — measuring the
        // inner one would stretch the pattern round the corners.
        const len = Math.hypot(ox1 - ox0, oz1 - oz0);
        const u0 = run / tileWorld;
        const u1 = (run + len) / tileWorld;
        run += len;

        const base = pos.length / 3;
        // outer start, outer end, inner end, inner start
        pos.push(ox0, 0, oz0, ox1, 0, oz1, ix1, 0, iz1, ix0, 0, iz0);
        uv.push(u0, 1, u1, 1, u1, 0, u0, 0);
        for (let k = 0; k < 4; k++) norm.push(0, 1, 0);
        idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    // Just clear of the grass, as the stones were, so the two are never
    // coplanar and cannot flicker against each other.
    mesh.position.y = 0.02;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
}
