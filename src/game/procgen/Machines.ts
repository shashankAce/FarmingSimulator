import * as THREE from 'three';
import { C } from '../Palette.ts';
import { at, box, cyl, group, rot, scl, sphere } from './Primitives.ts';

/**
 * The production chain's hardware — juicer, conveyor, bottle racks — plus the
 * small carryable items (carrot, bottle, cash stack) the player moves between them.
 *
 * The carryables are built fresh per instance rather than shared, because they
 * get pooled, re-parented and individually animated.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The juicer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A squat brick boiler with a wooden intake funnel and a juice spout, matching
 * the rounded machine in the reference. Faces +Z. Returns the group plus the
 * moving parts the runtime animates.
 */
export function makeJuicer(): { group: THREE.Group; wheel: THREE.Mesh; funnel: THREE.Group } {
    const g = new THREE.Group();

    // Stone plinth.
    g.add(at(box(4.6, 0.45, 4.0, C.STONE), 0, 0.22, 0));
    g.add(at(box(4.9, 0.2, 4.3, C.STONE_DARK), 0, 0.08, 0));

    // Main body — an 8-sided drum reads as the reference's rounded brick mass.
    g.add(at(cyl(1.55, 1.75, 2.5, 8, 0x7d4034), 0, 1.7, 0));
    g.add(at(cyl(1.62, 1.62, 0.22, 8, C.METAL_DARK), 0, 1.1, 0));
    g.add(at(cyl(1.5, 1.5, 0.22, 8, C.METAL_DARK), 0, 2.6, 0));
    // Domed cap.
    const dome = at(sphere(1.5, 0x8a4a3c, 8), 0, 2.85, 0);
    scl(dome, 1, 0.55, 1);
    g.add(dome);

    // Firebox opening on the front face.
    const port = at(cyl(0.62, 0.62, 0.3, 8, 0x2a1a16), 0, 1.35, 1.62);
    rot(port, Math.PI / 2, 0, 0);
    g.add(port);
    const portRim = at(cyl(0.76, 0.76, 0.16, 8, C.METAL_DARK), 0, 1.35, 1.58);
    rot(portRim, Math.PI / 2, 0, 0);
    g.add(portRim);

    // Wooden intake funnel on top — where carrots go in.
    const funnel = new THREE.Group();
    funnel.add(at(cyl(0.95, 0.5, 0.85, 8, C.WOOD_LIGHT), 0, 0.42, 0));
    funnel.add(at(cyl(1.02, 1.02, 0.14, 8, C.JUICE), 0, 0.85, 0));
    at(funnel, 0, 3.15, 0);
    g.add(funnel);

    // Juice spout pouring toward the belt (-X).
    g.add(at(cyl(0.2, 0.2, 1.5, 6, C.METAL_DARK), -1.7, 1.55, 0), );
    const spout = at(cyl(0.16, 0.22, 0.6, 6, C.METAL), -2.45, 1.25, 0);
    rot(spout, 0, 0, 0.35);
    g.add(spout);

    // Flywheel on the side — spun while the machine is working.
    const wheel = at(cyl(0.75, 0.75, 0.18, 8, C.METAL_DARK), 1.75, 1.5, 0.0);
    rot(wheel, 0, 0, Math.PI / 2);
    g.add(wheel);
    for (let i = 0; i < 4; i++) {
        const spoke = box(0.1, 0.1, 1.35, C.METAL);
        rot(spoke, 0, 0, 0);
        spoke.rotation.y = (i / 4) * Math.PI;
        wheel.add(spoke);
    }

    // Chimney.
    g.add(at(cyl(0.28, 0.34, 1.2, 6, C.METAL_DARK), 1.0, 3.6, -0.7));

    return { group: g, wheel, funnel };
}

// ─────────────────────────────────────────────────────────────────────────────
// The conveyor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A belt running along -X from `x0` to `x1` at height `BELT_Y`. Rollers are
 * returned so they can be spun while the belt is carrying bottles.
 */
export const BELT_Y = 1.15;

export function makeConveyor(x0: number, x1: number): { group: THREE.Group; rollers: THREE.Mesh[] } {
    const g = new THREE.Group();
    const len = Math.abs(x1 - x0);
    const cx = (x0 + x1) / 2;

    // Belt surface plus side rails.
    g.add(at(box(len, 0.14, 1.5, C.METAL_DARK), cx, BELT_Y, 0));
    g.add(at(box(len, 0.26, 0.16, C.WOOD), cx, BELT_Y + 0.12, 0.78));
    g.add(at(box(len, 0.26, 0.16, C.WOOD), cx, BELT_Y + 0.12, -0.78));

    // Legs.
    const legs = Math.max(2, Math.round(len / 2.6));
    for (let i = 0; i <= legs; i++) {
        const x = x0 + (x1 - x0) * (i / legs);
        for (const z of [-0.6, 0.6]) {
            g.add(at(box(0.2, BELT_Y, 0.2, C.WOOD_DARK), x, BELT_Y / 2, z));
        }
    }

    // Rollers poking above the belt line.
    const rollers: THREE.Mesh[] = [];
    const n = Math.max(3, Math.round(len / 1.1));
    for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * (i / n);
        const r = at(cyl(0.16, 0.16, 1.4, 8, C.METAL), x, BELT_Y + 0.11, 0);
        rot(r, Math.PI / 2, 0, 0);
        g.add(r);
        rollers.push(r);
    }
    return { group: g, rollers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bottle racks
// ─────────────────────────────────────────────────────────────────────────────

export const RACK_SHELVES = 3;
export const RACK_SLOTS_PER_SHELF = 8;

/**
 * A three-shelf wooden rack. `slotPositions` gives the local coordinates a
 * finished bottle should occupy, filled bottom shelf first, left to right.
 */
export function makeRack(): { group: THREE.Group; slots: THREE.Vector3[] } {
    const g = new THREE.Group();
    const w = 3.2, d = 1.0, h = 2.4;

    // Side panels and back.
    for (const x of [-w / 2, w / 2]) {
        g.add(at(box(0.16, h, d, C.WOOD_DARK), x, h / 2, 0));
    }
    g.add(at(box(w, h, 0.12, C.WOOD), 0, h / 2, -d / 2));

    const slots: THREE.Vector3[] = [];
    for (let s = 0; s < RACK_SHELVES; s++) {
        const y = 0.35 + s * (h - 0.5) / RACK_SHELVES;
        g.add(at(box(w, 0.12, d, C.WOOD_LIGHT), 0, y, 0));
        for (let i = 0; i < RACK_SLOTS_PER_SHELF; i++) {
            const half = RACK_SLOTS_PER_SHELF / 2;
            const x = ((i % half) - (half - 1) / 2) * (w / half * 0.92);
            const z = i < half ? 0.22 : -0.22;
            slots.push(new THREE.Vector3(x, y + 0.06, z));
        }
    }
    return { group: g, slots };
}

// ─────────────────────────────────────────────────────────────────────────────
// Carryables — built per instance
// ─────────────────────────────────────────────────────────────────────────────

/** A juice bottle: glass body with an orange fill line, neck and cap. */
export function makeBottle(): THREE.Group {
    const g = group(
        at(cyl(0.17, 0.17, 0.46, 8, C.JUICE), 0, 0.23, 0),
        at(cyl(0.175, 0.175, 0.1, 8, C.GLASS), 0, 0.5, 0),
        at(cyl(0.085, 0.14, 0.2, 6, C.GLASS), 0, 0.63, 0),
        at(cyl(0.1, 0.1, 0.09, 6, C.BOTTLE_CAP), 0, 0.76, 0),
    );
    g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; } });
    return g;
}

/** An empty bottle — same silhouette, no juice. Rides the belt before filling. */
export function makeEmptyBottle(): THREE.Group {
    const g = group(
        at(cyl(0.17, 0.17, 0.46, 8, C.GLASS, { opacity: 0.75 }), 0, 0.23, 0),
        at(cyl(0.085, 0.14, 0.2, 6, C.GLASS, { opacity: 0.75 }), 0, 0.63, 0),
    );
    return g;
}

/** A single carrot with its leafy top — the carryable version. */
export function makeCarrot(): THREE.Group {
    const body = at(rot(cyl(0.14, 0.02, 0.62, 6, C.CARROT), Math.PI, 0, 0), 0, 0.31, 0);
    const g = group(body);
    for (let i = 0; i < 3; i++) {
        const leaf = at(box(0.08, 0.3, 0.08, C.LEAF), 0, 0.74, 0);
        rot(leaf, 0.3 * Math.cos(i * 2.1), i * 2.1, 0.3 * Math.sin(i * 2.1));
        g.add(leaf);
    }
    g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; } });
    return g;
}

/** A banded stack of banknotes, as used for both the ground cash and shop payouts. */
export function makeCashStack(): THREE.Group {
    const g = group(
        at(box(0.72, 0.16, 0.42, C.MONEY), 0, 0.08, 0),
        at(box(0.74, 0.05, 0.44, C.MONEY_PAPER), 0, 0.17, 0),
        at(box(0.2, 0.2, 0.46, C.MONEY_DARK), 0, 0.1, 0),
    );
    g.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; } });
    return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Instanced field geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Geometry for the carrot tops growing in the field. These are drawn with
 * `InstancedMesh3D` — hundreds of them exist at once, so one draw call each for
 * root and leaves matters far more than per-carrot flexibility.
 */
export function carrotRootGeometry(): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(0.16, 0.03, 0.5, 6);
    g.rotateX(Math.PI);          // taper points down, into the soil
    g.translate(0, 0.16, 0);
    return g;
}

export function carrotLeafGeometry(): THREE.BufferGeometry {
    // Three splayed blades merged into a single buffer so one instance = one bush of leaves.
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
        const b = new THREE.BoxGeometry(0.09, 0.34, 0.09);
        b.translate(0, 0.17, 0);
        b.rotateZ(Math.cos(i * 2.1) * 0.42);
        b.rotateX(Math.sin(i * 2.1) * 0.42);
        b.translate(0, 0.4, 0);
        parts.push(b);
    }
    return mergeGeometries(parts);
}

/** Minimal position-only merge — enough for the flat-shaded leaf clusters above. */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const out: number[] = [];
    for (const g of list) {
        const nonIndexed = g.index ? g.toNonIndexed() : g;
        const pos = nonIndexed.getAttribute('position');
        for (let i = 0; i < pos.count; i++) out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (nonIndexed !== g) nonIndexed.dispose();
        g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    merged.computeVertexNormals();
    return merged;
}

/**
 * Dedicated (NOT cached/shared) materials for the field's instanced meshes.
 * `InstancedMesh3D` disposes its material in `onDestroy()`, so handing it one of
 * the shared instances from `Primitives.mat()` would break every other mesh
 * using that colour — see the note at the top of `Primitives.ts`.
 */
export const carrotMaterial = () => new THREE.MeshLambertMaterial({ color: C.CARROT, flatShading: true });
export const leafMaterial = () => new THREE.MeshLambertMaterial({ color: C.LEAF, flatShading: true });
