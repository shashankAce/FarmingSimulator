import * as THREE from 'three';
import { CARRY } from '../Config.ts';
import { C } from '../Palette.ts';
import { at, box, rot } from './Primitives.ts';

/**
 * The two things a character actually carries: a slatted rack of juice bottles
 * and an open basket of carrots.
 *
 * Goods are never carried loose any more — they travel by the crate-load, which
 * is why both builders return the world-local `slots` their contents sit in.
 * The only structural difference is the rack's vertical divider columns; the
 * basket is deliberately left open (see `makeCarrotBasket`).
 */

/**
 * One display scale for every crate, wherever it sits — carried, on the
 * production stand, or set down at a shop. It is the carried size, because
 * that's the one tuned against the character; anything else made the same
 * object appear to change size as it moved between stations.
 */
export const CRATE_SCALE = 0.58;
/** Contents scale, relative to the crate they sit in. */
export const CONTENT_SCALE = { bottle: 0.78, carrot: 0.86 };
/** Vertical pitch when crates are stacked, in crate-local units. See `CARRY.pitch`. */
export const CRATE_PITCH = CARRY.pitch;
/** World scale of a loose bottle, matched to one sitting in a crate. */
export const LOOSE_BOTTLE_SCALE = CRATE_SCALE * CONTENT_SCALE.bottle;

// Sourced from `CARRY` so the whole of a character's capacity is tunable from
// one place. These stay exported because they also shape the crate meshes below.
export const RACK_COLS = CARRY.rack.cols;
export const RACK_ROWS = CARRY.rack.rows;
export const RACK_CAPACITY = RACK_COLS * RACK_ROWS;

export const BASKET_COLS = CARRY.basket.cols;
export const BASKET_ROWS = CARRY.basket.rows;
export const BASKET_CAPACITY = BASKET_COLS * BASKET_ROWS;

const W = 1.25;
const D = 0.9;

/** Shared crate shell: base slab, corner posts and side rails. */
function crateShell(height: number, postColor: number, railColor: number): THREE.Group {
    const g = new THREE.Group();

    g.add(at(box(W, 0.12, D, C.WOOD_LIGHT), 0, 0.06, 0));
    g.add(at(box(W + 0.1, 0.07, D + 0.1, C.WOOD), 0, 0.015, 0));

    for (const x of [-W / 2 + 0.07, W / 2 - 0.07]) {
        for (const z of [-D / 2 + 0.07, D / 2 - 0.07]) {
            g.add(at(box(0.13, height, 0.13, postColor), x, height / 2, z));
        }
    }

    // Two rails per side — the slatted look from the reference crate.
    for (const y of [height * 0.42, height * 0.86]) {
        g.add(at(box(W, 0.11, 0.09, railColor), 0, y, D / 2 - 0.02));
        g.add(at(box(W, 0.11, 0.09, railColor), 0, y, -D / 2 + 0.02));
        g.add(at(box(0.09, 0.11, D, railColor), W / 2 - 0.02, y, 0));
        g.add(at(box(0.09, 0.11, D, railColor), -W / 2 + 0.02, y, 0));
    }

    return g;
}

/**
 * Contents sit at the centre of each cell of a cols x rows grid. The X spacing
 * matches the rack's divider pitch exactly, so bottles land in the gaps between
 * columns rather than straddling them.
 */
function gridSlots(cols: number, rows: number, y: number): THREE.Vector3[] {
    const spanX = W - 0.16;
    const spanZ = D - 0.22;
    const slots: THREE.Vector3[] = [];
    // Front row first, so a partly filled crate fills from the visible side.
    for (let r = rows - 1; r >= 0; r--) {
        for (let c = 0; c < cols; c++) {
            slots.push(new THREE.Vector3(
                ((c + 0.5) / cols - 0.5) * spanX,
                y,
                ((r + 0.5) / rows - 0.5) * spanZ,
            ));
        }
    }
    return slots;
}

/**
 * A bottle rack: crate shell plus vertical divider columns between the slots,
 * so the bottles read as racked rather than tipped in loose.
 */
export function makeBottleRack(): { group: THREE.Group; slots: THREE.Vector3[] } {
    // Deliberately shallow. A full-height crate swallows the bottles entirely —
    // the point of racking them is that the juice stays visible.
    const height = 0.38;
    const g = crateShell(height, C.WOOD_DARK, C.WOOD_PALE);

    // Divider columns — the detail that makes this a rack and not a basket.
    for (let c = 0; c <= RACK_COLS; c++) {
        const x = (c / RACK_COLS - 0.5) * (W - 0.16);
        g.add(at(box(0.07, height * 1.15, D - 0.14, C.WOOD_PALE), x, height * 0.58, 0));
    }

    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { group: g, slots: gridSlots(RACK_COLS, RACK_ROWS, 0.14) };
}

/**
 * A carrot basket. Same crate shell as the rack but with **no divider columns**
 * — carrots are tipped in loose, so anything inside would just clip through them.
 */
export function makeCarrotBasket(): { group: THREE.Group; slots: THREE.Vector3[] } {
    // Same reasoning as the rack: low enough that the carrots show over the rim.
    const height = 0.44;
    const g = crateShell(height, C.WOOD, C.WOOD_LIGHT);

    // A woven-looking inner liner, purely so the open interior isn't a void.
    g.add(at(box(W - 0.18, 0.06, D - 0.18, C.WOOD_PALE), 0, 0.13, 0));

    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { group: g, slots: gridSlots(BASKET_COLS, BASKET_ROWS, 0.16) };
}

/** Bottle rack standing at the production station, angled for display. */
export function makeRackStandFrame(): THREE.Group {
    const g = new THREE.Group();
    // A trestle the finished racks sit on, matching the reference's low bench.
    // Sized against CRATE_SCALE — a full-width bench dwarfs the crates on it.
    g.add(at(box(2.7, 0.14, 1.05, C.WOOD_LIGHT), 0, 0.86, 0));
    for (const x of [-1.05, 1.05]) {
        for (const z of [-0.38, 0.38]) {
            g.add(at(rot(box(0.15, 0.9, 0.15, C.WOOD_DARK), 0, 0, z * 0.12), x, 0.45, z));
        }
    }
    g.add(at(box(2.5, 0.1, 0.1, C.WOOD), 0, 0.42, 0));
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
}
