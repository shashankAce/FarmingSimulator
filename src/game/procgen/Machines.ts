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
    //
    // The tilt goes on a HOLDER and the spin on the wheel itself, and they
    // cannot share a node. Euler order 'XYZ' applies Z before Y, so tilting
    // with `rotation.z` and then spinning with `rotation.y` turns the disc
    // about the machine's vertical axis rather than its own axle — the wheel
    // swept through its own body instead of rotating. A tilt on X would have
    // been safe, since 'XYZ' applies that one after the spin; Z is not.
    const hub = at(rot(new THREE.Group(), 0, 0, Math.PI / 2), 1.75, 1.5, 0);
    const wheel = cyl(0.75, 0.75, 0.18, 8, C.METAL_DARK);
    hub.add(wheel);
    g.add(hub);
    for (let i = 0; i < 4; i++) {
        // Spokes ride the wheel, so they turn with it. Long in Z and fanned
        // about the wheel's own axis, which is its local Y.
        const spoke = box(0.1, 0.1, 1.35, C.METAL);
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
 * A belt running along -X from `x0` to `x1` at height `BELT_Y`. The cleats are
 * returned so they can be scrolled while the belt is carrying bottles.
 */
export const BELT_Y = 1.15;

/** Top face of the belt slab — where cargo sits and the cleats stand proud. */
const BELT_TOP = BELT_Y + 0.07;

export function makeConveyor(x0: number, x1: number): { group: THREE.Group; treads: THREE.Mesh[] } {
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

    // Housings over both ends. Bottles are spawned inside the head cover and
    // retired inside the tail one, so the player never sees one blink into
    // existence on bare belt.
    //
    // Built as walls with the BELT-FACING side left open, rather than as one
    // solid block. Each housing is pushed outward from its end of the belt, so
    // the belt lies along local -`dir` and that is the face that has to be a
    // mouth: as a closed box, bottles emerged through a wall and were swallowed
    // by one. A header across the top of the opening keeps it reading as a
    // doorway instead of a missing panel, and clears the cargo easily — the
    // gap runs from the wall feet up to `BELT_Y + 0.745`.
    const wall = 0.16;
    for (const [x, dir] of [[x0, 1], [x1, -1]] as Array<[number, number]>) {
        const cover = new THREE.Group();
        const midY = BELT_Y + 0.72;
        // Back, i.e. the outward face, and the two flanks.
        cover.add(at(box(wall, 1.15, 1.9, C.METAL_DARK), dir * (0.75 - wall / 2), midY, 0));
        for (const z of [-1, 1]) {
            cover.add(at(box(1.5, 1.15, wall, C.METAL_DARK), 0, midY, z * (0.95 - wall / 2)));
        }
        // Header over the mouth. Its underside is the top of the opening.
        cover.add(at(box(wall, 0.55, 1.9, C.METAL_DARK), -dir * (0.75 - wall / 2), BELT_Y + 1.02, 0));
        // Wooden cap. Sits low enough to overlap the wall tops, which is what
        // closes the roof — there is no separate one.
        cover.add(at(box(1.62, 0.16, 2.0, C.WOOD), 0, BELT_Y + 1.32, 0));
        at(cover, x + dir * 0.35, 0, 0);
        g.add(cover);
    }

    // Cleats running across the belt, scrolled by `Production` while it works.
    //
    // These replace rollers that used to be modelled ON TOP of the belt line —
    // 0.16 radius at BELT_Y + 0.11, so they stood 0.2 proud of a surface that
    // tops out at BELT_TOP. A roller belongs UNDER a belt driving it, and one
    // above it read as the belt running beneath its own drum. Cleats say
    // "this surface is travelling" more directly than a spinning drum anyway,
    // and they carry the eye in the direction of travel.
    //
    // Lighter than the belt rather than darker: a recessed-looking groove is
    // what was asked for, but a dark line on a dark slab does not read at this
    // distance, and the point of them is to be seen moving.
    const treads: THREE.Mesh[] = [];
    const count = Math.max(4, Math.round(len / 0.9));
    for (let i = 0; i < count; i++) {
        const x = x0 + (x1 - x0) * (i / count);
        // Sunk a hair into the slab so there is no gap under it, and shallow
        // enough that a bottle standing on the belt is not perched on stilts.
        const cleat = at(box(0.12, 0.04, 1.34, C.METAL), x, BELT_TOP + 0.01, 0);
        treads.push(cleat);
        g.add(cleat);
    }
    return { group: g, treads };
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
    // Wide at the crown, tapering to the tip (see carrotRootGeometry).
    const body = at(cyl(0.17, 0.02, 0.62, 7, C.CARROT), 0, 0.31, 0);
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
        // Top face built as the same note the 'money' pad icon draws: green
        // body, a darker ring inset in it, the field again in the body green,
        // and a paper medallion. Same proportions as the icon, scaled to this
        // bundle, so the cash on the ground and the glyph on the pad pointing
        // at it are recognisably the same object.
        at(box(0.72, 0.14, 0.42, C.MONEY), 0, 0.07, 0),
        at(box(0.62, 0.02, 0.32, C.MONEY_DARK), 0, 0.15, 0),
        at(box(0.56, 0.02, 0.26, C.MONEY), 0, 0.17, 0),
        at(cyl(0.1, 0.1, 0.02, 14, C.MONEY_PAPER), 0, 0.19, 0),
        // One paper band round the short way. Taller and deeper than the bundle
        // on purpose: it has to stand proud on the top and both sides, or it
        // reads as a stripe painted on rather than a strap holding it together.
        // Kept narrow so the medallion still shows either side of it, and the
        // whole stack under 0.21 tall so that at the 0.75 scale the till uses, a
        // second layer still clears SHOP.tillLayer.
        at(box(0.13, 0.21, 0.44, C.MONEY_PAPER), 0, 0.105, 0),
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
    // Widest at the crown where the leaves sprout, tapering to a point that
    // buries itself in the soil — a carrot, not an ice-cream cone.
    const g = new THREE.CylinderGeometry(0.2, 0.02, 0.54, 7);
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
