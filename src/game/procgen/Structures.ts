import * as THREE from 'three';
import { C } from '../Palette.ts';
import { at, box, cyl, gableRoof, group, mat, pickOf, rangeOf, rot, sphere } from './Primitives.ts';

/**
 * Village architecture and set dressing: cottages, the fence that rings the
 * farm, and the loose props (carts, barrels, cattle, fountain, lamps) that sit
 * outside the boundary in the reference art.
 */

const ROOFS = [C.ROOF_BROWN, C.ROOF_BLUE, C.ROOF_PURPLE, C.ROOF_TEAL] as const;
const WALLS = [C.WALL_CREAM, C.WALL_WHITE] as const;

/**
 * A cottage: rendered walls, a gabled roof with overhang, a door and windows on
 * the +Z face, and a chimney. Roof ridge runs along X so the gable ends face
 * the camera the way they do in the reference.
 */
export function makeHouse(rng: () => number): THREE.Group {
    const w = rangeOf(rng, 4.0, 5.6);
    const d = rangeOf(rng, 3.6, 4.8);
    const h = rangeOf(rng, 2.6, 3.4);
    const wall = pickOf(rng, WALLS);
    const roofColor = pickOf(rng, ROOFS);

    const g = new THREE.Group();
    g.add(at(box(w, h, d, wall), 0, h / 2, 0));

    // Ridge along X: build the prism with its ridge on Z, then yaw it a quarter turn.
    const roof = gableRoof(d + 0.7, rangeOf(rng, 1.3, 1.9), w + 0.7, roofColor);
    at(rot(roof, 0, Math.PI / 2, 0), 0, h, 0);
    g.add(roof);

    // Door on the +Z face, pushed just proud of the wall to avoid z-fighting.
    const doorH = 1.5;
    g.add(at(box(0.95, doorH, 0.14, C.DOOR), rangeOf(rng, -0.6, 0.6), doorH / 2, d / 2 + 0.02));

    // Windows.
    const wins = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < wins; i++) {
        const wx = (i - (wins - 1) / 2) * 1.6 + (rng() < 0.5 ? -1.4 : 1.4);
        g.add(at(box(0.72, 0.72, 0.12, C.ROOF_BLUE), wx, h * 0.62, d / 2 + 0.02));
        g.add(at(box(0.86, 0.86, 0.08, C.WOOD), wx, h * 0.62, d / 2 + 0.0));
    }

    // Chimney.
    const cx = w * rangeOf(rng, 0.2, 0.34) * (rng() < 0.5 ? -1 : 1);
    g.add(at(box(0.5, 1.5, 0.5, C.STONE), cx, h + 0.9, rangeOf(rng, -0.6, 0.6)));

    return g;
}

/**
 * A fence run from (x0,z0) to (x1,z1): evenly spaced posts with two horizontal
 * rails between them. Returns one group; the caller places it in world space.
 */
export function makeFenceRun(x0: number, z0: number, x1: number, z1: number, spacing = 2.4): THREE.Group {
    const g = new THREE.Group();
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const segments = Math.max(1, Math.round(len / spacing));
    const segLen = len / segments;

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        g.add(at(box(0.3, 1.5, 0.3, C.WOOD_DARK), x0 + dx * t, 0.75, z0 + dz * t));
    }
    // Rails: one group per segment, oriented along the run.
    for (let i = 0; i < segments; i++) {
        const t = (i + 0.5) / segments;
        const cx = x0 + dx * t, cz = z0 + dz * t;
        for (const y of [0.55, 1.12]) {
            const rail = at(box(0.16, 0.22, segLen, C.WOOD), cx, y, cz);
            rot(rail, 0, yaw, 0);
            g.add(rail);
        }
    }
    return g;
}

/** Rectangular fence ring with an optional gap (a gate) on one side. */
export function makeFenceRect(
    minX: number, maxX: number, minZ: number, maxZ: number,
): THREE.Group {
    return group(
        makeFenceRun(minX, minZ, maxX, minZ),
        makeFenceRun(maxX, minZ, maxX, maxZ),
        makeFenceRun(maxX, maxZ, minX, maxZ),
        makeFenceRun(minX, maxZ, minX, minZ),
    );
}

/** A wooden hand cart with two spoked wheels — parked outside the fence. */
export function makeCart(): THREE.Group {
    const g = new THREE.Group();
    g.add(at(box(2.6, 0.24, 1.6, C.WOOD_LIGHT), 0, 0.9, 0));
    // Side and end boards.
    g.add(at(box(2.6, 0.7, 0.14, C.WOOD), 0, 1.25, 0.75));
    g.add(at(box(2.6, 0.7, 0.14, C.WOOD), 0, 1.25, -0.75));
    g.add(at(box(0.14, 0.7, 1.6, C.WOOD), -1.28, 1.25, 0));

    for (const z of [-0.9, 0.9]) {
        const wheel = at(cyl(0.62, 0.62, 0.2, 10, C.WOOD_DARK), 0.5, 0.62, z);
        rot(wheel, Math.PI / 2, 0, 0);
        g.add(wheel);
        const hub = at(cyl(0.16, 0.16, 0.26, 6, C.WOOD_PALE), 0.5, 0.62, z);
        rot(hub, Math.PI / 2, 0, 0);
        g.add(hub);
    }
    // Shafts.
    for (const z of [-0.5, 0.5]) {
        const shaft = at(box(1.7, 0.14, 0.14, C.WOOD), -2.0, 0.78, z);
        rot(shaft, 0, 0, 0.12);
        g.add(shaft);
    }
    return g;
}

/** Stone fountain with a still water disc and a central spout. */
export function makeFountain(): THREE.Group {
    const g = new THREE.Group();
    g.add(at(cyl(2.1, 2.3, 0.6, 12, C.STONE), 0, 0.3, 0));
    g.add(at(cyl(1.85, 1.85, 0.14, 12, C.WATER), 0, 0.62, 0));
    g.add(at(cyl(0.34, 0.46, 1.1, 8, C.STONE_DARK), 0, 1.05, 0));
    g.add(at(cyl(0.72, 0.2, 0.24, 10, C.STONE), 0, 1.68, 0));
    g.add(at(sphere(0.22, C.WATER, 8), 0, 1.92, 0));
    return g;
}

/** Wrought-iron lamp post. */
export function makeLampPost(): THREE.Group {
    const g = new THREE.Group();
    g.add(at(cyl(0.26, 0.36, 0.3, 8, C.STONE_DARK), 0, 0.15, 0));
    g.add(at(cyl(0.1, 0.13, 3.0, 6, C.METAL_DARK), 0, 1.5, 0));
    g.add(at(cyl(0.34, 0.2, 0.55, 4, C.METAL_DARK), 0, 3.15, 0));
    g.add(at(box(0.34, 0.34, 0.34, 0xffe9a8, { emissive: 0x6b5a20 }), 0, 2.85, 0));
    g.add(at(cyl(0, 0.28, 0.3, 4, C.METAL_DARK), 0, 3.5, 0));
    return g;
}

/** Banded wooden barrel. */
export function makeBarrel(): THREE.Group {
    const g = new THREE.Group();
    g.add(at(cyl(0.5, 0.5, 1.1, 10, C.WOOD), 0, 0.55, 0));
    g.add(at(cyl(0.53, 0.53, 0.13, 10, C.METAL_DARK), 0, 0.28, 0));
    g.add(at(cyl(0.53, 0.53, 0.13, 10, C.METAL_DARK), 0, 0.84, 0));
    g.add(at(cyl(0.46, 0.46, 0.06, 10, C.WOOD_PALE), 0, 1.11, 0));
    return g;
}

/** Slatted wooden crate. */
export function makeCrate(size = 0.9): THREE.Group {
    const g = new THREE.Group();
    g.add(at(box(size, size, size, C.WOOD_LIGHT), 0, size / 2, 0));
    const t = size * 0.1;
    for (const y of [size * 0.16, size * 0.84]) {
        g.add(at(box(size * 1.04, t, size * 1.04, C.WOOD), 0, y, 0));
    }
    return g;
}

/** A grazing cow — boxy body, patch spots, stubby legs. */
export function makeCow(rng: () => number): THREE.Group {
    const g = new THREE.Group();
    g.add(at(box(2.0, 1.05, 1.0, C.COW_BODY), 0, 1.05, 0));

    // Irregular patches on the flanks and back.
    for (let i = 0; i < 4; i++) {
        const s = rangeOf(rng, 0.3, 0.55);
        const spot = at(box(s, s, 1.04, C.COW_SPOT), rangeOf(rng, -0.7, 0.7), rangeOf(rng, 0.8, 1.3), 0);
        g.add(spot);
    }

    // Head, snout, ears, horns.
    const head = at(box(0.75, 0.7, 0.66, C.COW_BODY), 1.15, 1.35, 0);
    g.add(head);
    g.add(at(box(0.42, 0.36, 0.3, C.COW_SNOUT), 1.5, 1.2, 0));
    for (const z of [-0.42, 0.42]) {
        g.add(at(box(0.24, 0.16, 0.16, C.COW_BODY), 1.05, 1.6, z));
        g.add(at(cyl(0.05, 0.09, 0.24, 5, C.WOOD_PALE), 1.25, 1.78, z * 0.5));
    }

    for (const x of [-0.65, 0.65]) {
        for (const z of [-0.34, 0.34]) {
            g.add(at(box(0.24, 0.55, 0.24, C.COW_SPOT), x, 0.27, z));
        }
    }
    // Tail.
    g.add(at(box(0.1, 0.7, 0.1, C.COW_BODY), -1.0, 1.1, 0));

    rot(g, 0, rng() * Math.PI * 2, 0);
    return g;
}

/**
 * The juice stand. Built at the origin facing **+Z**, the side the customers
 * queue on; the back is open so the player walks in behind to serve.
 *
 * Deliberately roofless. An awning looks right in elevation but from this
 * game's steep top-down camera it just becomes a lid hiding the entire counter —
 * the reference stall is open for exactly that reason.
 */
export function makeShop(): { group: THREE.Group; cashSlots: THREE.Vector3[] } {
    const g = new THREE.Group();

    // Counter body, with a painted front panel facing the queue.
    g.add(at(box(5.0, 1.15, 1.0, C.WOOD_LIGHT), 0, 0.58, 1.15));
    g.add(at(box(5.3, 0.18, 1.3, C.WOOD_PALE), 0, 1.24, 1.15));
    g.add(at(box(5.04, 0.66, 0.1, 0xe4574f), 0, 0.52, 1.68));
    g.add(at(box(5.04, 0.16, 0.11, C.WALL_WHITE), 0, 0.82, 1.69));

    // Striped cloth draped over the counter top.
    for (let i = 0; i < 7; i++) {
        const w = 5.0 / 7;
        if (i % 2 === 0) continue;
        g.add(at(box(w, 0.06, 1.3, 0xe4574f), (i - 3) * w, 1.34, 1.15));
    }

    // Standing sign at one end, angled toward the queue.
    const sign = new THREE.Group();
    sign.add(at(box(0.18, 1.9, 0.18, C.WOOD_DARK), 0, 0.95, 0));
    sign.add(at(box(1.5, 0.85, 0.14, C.WOOD_PALE), 0, 2.05, 0));
    sign.add(at(box(0.3, 0.46, 0.1, C.JUICE), -0.35, 2.0, 0.1));
    sign.add(at(box(0.14, 0.18, 0.1, C.GLASS), -0.35, 2.32, 0.1));
    sign.add(at(box(0.66, 0.14, 0.1, 0xe4574f), 0.3, 2.14, 0.1));
    sign.add(at(box(0.66, 0.14, 0.1, 0xe4574f), 0.3, 1.9, 0.1));
    at(rot(sign, 0, -0.35, 0), 2.9, 0, 0.9);
    g.add(sign);

    // ── Dressing, kept to the left end ──
    // Only two display bottles: the rest of the counter is working surface for
    // takings, which have to physically fit somewhere the player can sweep up.
    g.add(at(makeDisplayBottle(), -0.95, 1.33, 0.95));
    g.add(at(makeDisplayBottle(), -0.35, 1.33, 0.95));
    g.add(at(cyl(0.36, 0.3, 0.55, 8, C.JUICE), -1.6, 1.6, 1.15));
    g.add(at(cyl(0.4, 0.4, 0.2, 8, C.WOOD), -2.15, 1.42, 1.35));
    for (let i = 0; i < 3; i++) {
        const carrot = at(cyl(0.09, 0.02, 0.42, 6, C.CARROT), -2.15 + (i - 1) * 0.16, 1.62, 1.35);
        rot(carrot, Math.PI + 0.35, 0, (i - 1) * 0.3);
        g.add(carrot);
    }

    // ── Till slots: where completed orders stack up as cash ──
    const cashSlots: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
        cashSlots.push(new THREE.Vector3(0.55 + i * 0.62, 1.36, 1.1));
    }

    return { group: g, cashSlots };
}

/**
 * Triangular bunting, strung along a fence run of `length` centred on the
 * origin — the party dressing the reference hangs beside the stand.
 */
export function makeBunting(length: number, count = 12): THREE.Group {
    const g = new THREE.Group();
    const colors = [0xe4574f, 0x4a9fd8, 0xf0c04a, 0xf5f0e6, 0x5fa832];
    for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const flag = new THREE.Mesh(
            new THREE.ConeGeometry(0.16, 0.42, 3),
            mat(colors[i % colors.length]),
        );
        // Cone points +Y by default; flip it so the tip hangs downward.
        at(rot(flag, Math.PI, 0, 0), (t - 0.5) * length, 1.35 - Math.sin(t * Math.PI) * 0.12, 0);
        flag.castShadow = false;
        g.add(flag);
    }
    return g;
}

function makeDisplayBottle(): THREE.Group {
    return group(
        at(cyl(0.14, 0.14, 0.34, 8, C.JUICE), 0, 0.17, 0),
        at(cyl(0.07, 0.07, 0.14, 6, C.GLASS), 0, 0.41, 0),
        at(cyl(0.09, 0.09, 0.06, 6, C.BOTTLE_CAP), 0, 0.5, 0),
    );
}

/**
 * Scaffolding marking the shop's footprint before it's built. It needs a deck
 * and visible uprights — bare rails read as floating geometry once the camera
 * is close enough to see them properly.
 */
export function makeConstructionFrame(): THREE.Group {
    // Authored in LOCAL space facing +Z, exactly like `makeShop()`. `ShopStand`
    // yaws the whole group to face outward from whichever fence it sits on, so
    // size it in these axes and the rotation takes care of itself:
    //
    //   box(w, h, d)  ->  w = X = WIDTH,  h = Y = HEIGHT,  d = Z = DEPTH
    //
    //   X  width   runs ALONG the fence      (-X and +X are the stall's two ends)
    //   Y  height  up
    //   Z  depth   runs ACROSS the fence     (+Z = customer side, -Z = player side)
    //
    // Keep the deck's X close to the finished stall's 5.0 counter width, or the
    // plot appears to grow or shrink the moment it converts.
    const g = new THREE.Group();

    // Timber deck, so the frame is clearly standing on something.
    g.add(at(box(5.0, 0.22, 3.4, C.WOOD_LIGHT), 0, 0.11, 0.05));
    g.add(at(box(5.2, 0.14, 3.6, C.WOOD_DARK), 0, 0.03, 0.05));

    // Kept low on purpose: a locked plot reads as *less* than a finished stall,
    // so the scaffolding must not out-tower the counter that replaces it.
    for (const x of [-2.2, 2.2]) {
        for (const z of [-1.4, 1.5]) {
            g.add(at(box(0.3, 1.35, 0.3, C.WOOD_DARK), x, 0.68, z));
        }
    }
    for (const y of [0.58, 1.2]) {
        for (const z of [-1.4, 1.5]) {
            g.add(at(box(4.6, 0.16, 0.16, C.WOOD), 0, y, z));
        }
        g.add(at(box(0.16, 0.16, 3.0, C.WOOD), -2.2, y, 0.05));
        g.add(at(box(0.16, 0.16, 3.0, C.WOOD), 2.2, y, 0.05));
    }

    // Diagonal braces on the front face — the detail that says "under construction".
    for (const dir of [-1, 1]) {
        const brace = at(box(2.2, 0.15, 0.15, C.WOOD_PALE), dir * 1.15, 0.9, 1.5);
        rot(brace, 0, 0, dir * 0.42);
        g.add(brace);
    }

    // A couple of crates and a barrel left on site.
    g.add(at(makeCrate(0.8), -1.4, 0.22, 0.4));
    g.add(at(makeBarrel(), 1.5, 0.22, 0.2));

    return g;
}

/**
 * A hiring signpost that stands beside an upgrade pad. The cost text itself is
 * a 2D `Label` projected with `sceneSystem3D.worldToDesign()` — crisper than
 * anything we could bake into geometry, and always readable through props.
 */
export function makeSignpost(): THREE.Group {
    const g = new THREE.Group();
    g.add(at(box(0.24, 2.2, 0.24, C.WOOD_DARK), 0, 1.1, 0));
    g.add(at(box(2.4, 1.3, 0.16, C.WOOD_PALE), 0, 2.35, 0));
    g.add(at(box(2.6, 0.16, 0.2, C.WOOD), 0, 3.05, 0));
    g.add(at(box(2.6, 0.16, 0.2, C.WOOD), 0, 1.65, 0));
    return g;
}
