import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collapses a tree of never-moving meshes into a handful of merged ones.
 *
 * Why this exists: `procgen/Primitives.ts` shares geometries and materials
 * across every mesh that asks for the same ones, which saves memory and program
 * switches — but Three issues ONE DRAW CALL PER MESH regardless of what it
 * shares. A village of 46 trees, 40 bushes and 130 flowers is therefore several
 * hundred draw calls of scenery that never moves, and each one costs JS-side
 * work (cull test, matrix upload, uniform and state setting) before the GL call
 * it makes. That JS is what a CPU throttle multiplies, and what a low-end
 * phone's weaker single core struggles with.
 *
 * Merging bakes each mesh's world transform into a copy of its geometry and
 * concatenates the copies, so one mesh draws what hundreds used to.
 *
 * ── Why in TILES rather than one mesh per material ──
 *
 * A single merged mesh spanning the whole village has a bounding sphere that
 * spans the whole village, so it is never frustum-culled: this camera sees a
 * fraction of the world, and one big merge would draw all of it, all the time.
 * Bucketing by a coarse XZ grid keeps culling working — off-screen tiles cost
 * nothing — at the price of one call per material per VISIBLE tile. Bigger
 * tiles mean fewer calls and more off-screen geometry drawn; `GRAPHICS.mergeTile`
 * is the dial.
 *
 * ── What it will not touch ──
 *
 * Anything that moves, is added or removed at runtime, or has its material
 * swapped. Merging is one-way: the result has no per-object identity left, so
 * only pass in scenery that is built once and then forgotten. Non-mesh objects
 * and meshes it cannot merge safely are carried over unchanged, with their
 * world transform baked, so the result always renders the same as the input.
 */

/**
 * Which meshes may be merged together.
 *
 * Material and the two shadow flags because those are what a draw call carries;
 * the tile for culling; and the attribute signature because `mergeGeometries`
 * requires every input to have the same attributes and the same indexed-ness,
 * and returns null (after logging) if they do not.
 */
function bucketKey(mesh: THREE.Mesh, mat: THREE.Material, tile: number): string {
    const p = mesh.matrixWorld;
    const tx = Math.floor(p.elements[12] / tile);
    const tz = Math.floor(p.elements[14] / tile);
    const attrs = Object.keys(mesh.geometry.attributes).sort().join(',');
    const indexed = mesh.geometry.index ? 'i' : 'n';
    return `${mat.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${tx},${tz}|${attrs}|${indexed}`;
}

/** Re-parents `obj` into `out` with its world transform baked into it. */
function carryOver(obj: THREE.Object3D, out: THREE.Group): void {
    obj.matrix.copy(obj.matrixWorld);
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    out.add(obj);
}

export function mergeStatic(root: THREE.Object3D, tile: number): THREE.Group {
    const out = new THREE.Group();
    out.name = root.name;
    root.updateMatrixWorld(true);

    const buckets = new Map<string, THREE.Mesh[]>();
    const keep: THREE.Object3D[] = [];

    // Collected in one pass and acted on afterwards: re-parenting mid-traverse
    // mutates the tree being walked.
    root.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        // A multi-material mesh is several draw calls with geometry groups to
        // match; an instanced or batched mesh is already one call for many.
        // Neither is worth the special case here.
        if (Array.isArray(mesh.material) || !mesh.geometry
            || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
            keep.push(mesh);
            return;
        }
        const key = bucketKey(mesh, mesh.material as THREE.Material, tile);
        const list = buckets.get(key);
        if (list) list.push(mesh);
        else buckets.set(key, [mesh]);
    });

    for (const group of buckets.values()) {
        const first = group[0];
        // Nothing to gain from merging a bucket of one, and doing it would copy
        // a shared geometry for no reason.
        if (group.length === 1) { keep.push(first); continue; }

        // Cloned before baking: these geometries come out of the cache in
        // `Primitives.ts` and are shared with the rest of the game, so applying
        // a transform to the original would move everything else using it.
        const baked = group.map(m => m.geometry.clone().applyMatrix4(m.matrixWorld));
        const merged = mergeGeometries(baked);
        for (const g of baked) g.dispose();
        // `mergeGeometries` logs its own reason and returns null on mismatched
        // attributes. Keeping the originals is always correct, just slower.
        if (!merged) { keep.push(...group); continue; }

        const mesh = new THREE.Mesh(merged, first.material);
        mesh.castShadow = first.castShadow;
        mesh.receiveShadow = first.receiveShadow;
        // Baked into the vertices, so the mesh sits at the origin and its
        // matrix never needs recomputing.
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        out.add(mesh);
    }

    // Never disposed, only dropped: the cache in `Primitives.ts` hands the same
    // geometry to meshes all over the game, and this one is not its owner.
    for (const obj of keep) carryOver(obj, out);
    return out;
}
