import * as THREE from 'three';

/**
 * Low-level builders shared by every procedural asset in `procgen/`.
 *
 * Materials and geometries are cached and shared across meshes on purpose: the
 * whole static world is added to the THREE scene as raw `THREE.Mesh` objects
 * (the pattern `skills/3d/three-integration.md` prescribes for never-toggled
 * geometry), so nothing here is ever owned — and therefore disposed — by a
 * `Mesh3D` wrapper. Do NOT hand one of these shared instances to a `Mesh3D`;
 * that component disposes its geometry AND material in `onDestroy()`, which
 * would pull the rug out from under every other mesh sharing them.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic RNG
// ─────────────────────────────────────────────────────────────────────────────

/** mulberry32 — small, fast, and seeded so the village lays out identically every reload. */
export function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function rangeOf(rng: () => number, min: number, max: number): number {
    return min + rng() * (max - min);
}

export function pickOf<T>(rng: () => number, arr: readonly T[]): T {
    return arr[Math.floor(rng() * arr.length) % arr.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// Material / geometry caches
// ─────────────────────────────────────────────────────────────────────────────

const matCache = new Map<string, THREE.MeshLambertMaterial>();

/**
 * Shared flat-shaded Lambert material. Lambert (diffuse only) is the right fit
 * for this art style — the chunky look comes from flat shading plus a strong
 * hemisphere/directional pair, not from specular response.
 */
export function mat(color: number, opts: { flat?: boolean; opacity?: number; emissive?: number } = {}): THREE.MeshLambertMaterial {
    const flat = opts.flat !== false;
    const key = `${color}|${flat}|${opts.opacity ?? 1}|${opts.emissive ?? 0}`;
    let m = matCache.get(key);
    if (!m) {
        m = new THREE.MeshLambertMaterial({
            color,
            flatShading: flat,
            emissive: opts.emissive ?? 0x000000,
            transparent: (opts.opacity ?? 1) < 1,
            opacity: opts.opacity ?? 1,
        });
        matCache.set(key, m);
    }
    return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function cachedGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = geoCache.get(key);
    if (!g) { g = build(); geoCache.set(key, g); }
    return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mesh builders
// ─────────────────────────────────────────────────────────────────────────────

/** Axis-aligned box centred on its own origin. */
export function box(w: number, h: number, d: number, color: number, opts?: Parameters<typeof mat>[1]): THREE.Mesh {
    const g = cachedGeo(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
    return shade(new THREE.Mesh(g, mat(color, opts)));
}

/** Upright cylinder. `seg` low (5-8) keeps the faceted low-poly read. */
export function cyl(rTop: number, rBot: number, h: number, seg: number, color: number, opts?: Parameters<typeof mat>[1]): THREE.Mesh {
    const g = cachedGeo(`cyl|${rTop}|${rBot}|${h}|${seg}`, () => new THREE.CylinderGeometry(rTop, rBot, h, seg));
    return shade(new THREE.Mesh(g, mat(color, opts)));
}

/** Cone — a cylinder with a zero-radius top. */
export function cone(r: number, h: number, seg: number, color: number, opts?: Parameters<typeof mat>[1]): THREE.Mesh {
    return cyl(0, r, h, seg, color, opts);
}

export function sphere(r: number, color: number, seg = 10, opts?: Parameters<typeof mat>[1]): THREE.Mesh {
    const g = cachedGeo(`sph|${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)));
    return shade(new THREE.Mesh(g, mat(color, opts)));
}

/** Faceted blob — an icosahedron, the cheapest convincing foliage/bush mass. */
export function blob(r: number, color: number, detail = 0, opts?: Parameters<typeof mat>[1]): THREE.Mesh {
    const g = cachedGeo(`ico|${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
    return shade(new THREE.Mesh(g, mat(color, opts)));
}

/** Flat hexagonal paving slab, lying in the XZ plane. */
export function hexTile(r: number, h: number, color: number): THREE.Mesh {
    const g = cachedGeo(`hex|${r}|${h}`, () => new THREE.CylinderGeometry(r, r, h, 6));
    return shade(new THREE.Mesh(g, mat(color)));
}

/** Flat many-sided disc lying in the XZ plane — a soft-edged ground decal. */
export function disc(r: number, color: number, seg = 12, opts?: Parameters<typeof mat>[1]): THREE.Mesh {
    const g = cachedGeo(`disc|${r}|${seg}`, () => {
        const c = new THREE.CircleGeometry(r, seg);
        c.rotateX(-Math.PI / 2);
        return c;
    });
    return shade(new THREE.Mesh(g, mat(color, opts)));
}

/** Horizontal plane facing +Y, sitting at the origin. */
export function plane(w: number, d: number, color: number, opts?: Parameters<typeof mat>[1]): THREE.Mesh {
    const g = cachedGeo(`pln|${w}|${d}`, () => {
        const p = new THREE.PlaneGeometry(w, d);
        p.rotateX(-Math.PI / 2);
        return p;
    });
    return shade(new THREE.Mesh(g, mat(color, opts)));
}

/**
 * Gabled roof — a triangular prism, ridge running along Z, sitting on Y=0.
 * Hand-built because THREE has no prism primitive and a 3-sided cylinder
 * gives the wrong cross-section.
 */
export function gableRoof(w: number, h: number, d: number, color: number): THREE.Mesh {
    const g = cachedGeo(`gable|${w}|${h}|${d}`, () => {
        const x = w / 2, z = d / 2;
        const A: V = [-x, 0, z], B: V = [x, 0, z], Cv: V = [0, h, z];
        const D: V = [-x, 0, -z], E: V = [x, 0, -z], F: V = [0, h, -z];
        const tris: V[][] = [
            [A, B, Cv],          // front gable
            [D, F, E],           // back gable
            [A, Cv, F], [A, F, D],  // left slope
            [B, F, Cv], [B, E, F],  // right slope
            [A, D, E], [A, E, B],   // underside
        ];
        const pos: number[] = [];
        for (const t of tris) for (const v of t) pos.push(v[0], v[1], v[2]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        return geo;
    });
    return shade(new THREE.Mesh(g, mat(color)));
}

type V = [number, number, number];

// ─────────────────────────────────────────────────────────────────────────────
// Transform helpers — every builder returns the object it was given, so calls chain
// ─────────────────────────────────────────────────────────────────────────────

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
    o.position.set(x, y, z);
    return o;
}

export function rot<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
    o.rotation.set(x, y, z);
    return o;
}

export function scl<T extends THREE.Object3D>(o: T, x: number, y = x, z = x): T {
    o.scale.set(x, y, z);
    return o;
}

/** Enable shadow casting/receiving on a mesh and everything under it. */
export function shade<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
    o.traverse(c => {
        if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; }
    });
    return o;
}

/** Collect children into a group in one expression. */
export function group(...children: THREE.Object3D[]): THREE.Group {
    const g = new THREE.Group();
    for (const c of children) g.add(c);
    return g;
}

/** Recursively dispose the geometries a group owns exclusively (used for pooled props). */
export function disposeTree(o: THREE.Object3D): void {
    o.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && !geoCacheHas(m.geometry)) m.geometry.dispose();
    });
}

function geoCacheHas(g: THREE.BufferGeometry): boolean {
    for (const v of geoCache.values()) if (v === g) return true;
    return false;
}
