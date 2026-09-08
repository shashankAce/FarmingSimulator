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
function bucketKeyAt(
    mesh: THREE.Mesh, mat: THREE.Material, tile: number, at: THREE.Matrix4,
): string {
    const tx = Math.floor(at.elements[12] / tile);
    const tz = Math.floor(at.elements[14] / tile);
    const attrs = Object.keys(mesh.geometry.attributes).sort().join(',');
    const indexed = mesh.geometry.index ? 'i' : 'n';
    return `${mat.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${tx},${tz}|${attrs}|${indexed}`;
}

function bucketKey(mesh: THREE.Mesh, mat: THREE.Material, tile: number): string {
    return bucketKeyAt(mesh, mat, tile, mesh.matrixWorld);
}

/** Re-parents `obj` into `out` with its world transform baked into it. */
function carryOver(obj: THREE.Object3D, out: THREE.Group): void {
    obj.matrix.copy(obj.matrixWorld);
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    out.add(obj);
}

/**
 * Merges a group's CURRENT contents in place, leaving the group itself alone.
 *
 * The variant the stations need. `mergeStatic` returns a replacement group,
 * which is fine for scenery nobody keeps a handle on — but a station's group
 * receives racks, crates and customers at runtime, and a stall's group is shown,
 * hidden and raised as it is built. Swapping either for a merged copy would
 * send every later child into an orphan, or lose the animation's handle.
 *
 * So this collapses what is in the group AT THE MOMENT IT IS CALLED — the
 * static shell, built in the constructor — and parents the result to the same
 * group. Everything added afterwards is untouched, and the group keeps its
 * identity, transform and visibility.
 *
 * Geometry is baked into the group's LOCAL space, not the world's, so the group
 * can still be moved, rotated or raised afterwards and its merged shell moves
 * with it.
 *
 * `skip` names objects that must survive as themselves — anything animated,
 * toggled, or held in a field. They and their descendants are left exactly
 * where they are. Getting this list wrong is the one way to break a station:
 * merge away the belt's treads and they stop scrolling, with no error.
 *
 * `tile` defaults to no tiling at all: a station is one small object, always
 * near the player when it matters, so splitting it for culling buys nothing.
 */
export function mergeStaticInPlace(
    group: THREE.Object3D,
    opts: { tile?: number; skip?: Iterable<THREE.Object3D> } = {},
): void {
    const tile = opts.tile ?? Infinity;
    const skip = new Set<THREE.Object3D>(opts.skip ?? []);
    group.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();

    const buckets = new Map<string, THREE.Mesh[]>();
    const guard = new THREE.Matrix4();

    group.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Skipped, or inside something skipped.
        for (let a: THREE.Object3D | null = mesh; a; a = a.parent) {
            if (skip.has(a)) return;
            if (a === group) break;
        }
        if (Array.isArray(mesh.material) || !mesh.geometry
            || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return;

        guard.multiplyMatrices(toLocal, mesh.matrixWorld);
        const key = bucketKeyAt(mesh, mesh.material as THREE.Material, tile, guard);
        const list = buckets.get(key);
        if (list) list.push(mesh);
        else buckets.set(key, [mesh]);
    });

    for (const bucket of buckets.values()) {
        if (bucket.length === 1) continue;
        const first = bucket[0];
        const baked = bucket.map(m => m.geometry.clone()
            .applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, m.matrixWorld)));
        const merged = mergeGeometries(baked);
        for (const g of baked) g.dispose();
        if (!merged) continue;

        for (const m of bucket) m.parent?.remove(m);
        const mesh = new THREE.Mesh(merged, first.material);
        mesh.castShadow = first.castShadow;
        mesh.receiveShadow = first.receiveShadow;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
    }

    // Sub-groups emptied by the merge would otherwise stay in the tree, each
    // still costing a matrix update every frame for nothing.
    const empty: THREE.Object3D[] = [];
    group.traverse(o => {
        if (o !== group && o.children.length === 0 && !(o as THREE.Mesh).isMesh && !skip.has(o)) {
            empty.push(o);
        }
    });
    for (const o of empty) o.parent?.remove(o);
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
