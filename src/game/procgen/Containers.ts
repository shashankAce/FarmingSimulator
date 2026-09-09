import * as THREE from 'three';
import { CARRY, GRAPHICS } from '../Config.ts';
import { C } from '../Palette.ts';
import { mergeStaticInPlace } from '../world/MergeStatic.ts';
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
 * Display scale of a crate, wherever it sits — carried, on the production
 * stand, or set down at a shop. It is the carried size, because that's the one
 * tuned against the character; anything else makes the same object appear to
 * change size as it moves between stations, so every site that draws a crate
 * has to use the entry for what it holds.
 *
 * One entry per kind rather than one number for both. A basket is sized around
 * a whole carrot lying down and comes out big; a rack of bottles at the same
 * scale read small beside it, so bottles and their crate are drawn half again
 * as large. The bottles inside follow for free — they are children of the rack
 * and scaled relative to it — and so do loose ones, via
 * `LOOSE_BOTTLE_SCALE` below.
 */
const CRATE_BASE = 0.58;
export const CRATE_SCALE = { carrot: CRATE_BASE, bottle: CRATE_BASE * 1.5 };
/**
 * Contents scale, relative to the crate they sit in.
 *
 * `carrot` is derived rather than chosen: at exactly `1 / CRATE_SCALE.carrot` a
 * carried carrot renders at its true world size, so the one in the basket is
 * the one that came out of the ground. The basket below is sized around that,
 * not the other way about — shrinking the carrot to fit a small basket is what
 * made picking one visibly halve it.
 */
export const CONTENT_SCALE = { bottle: 0.78, carrot: 1 / CRATE_SCALE.carrot };
/** Vertical pitch when crates are stacked, in crate-local units. See `CARRY.pitch`. */
export const CRATE_PITCH = CARRY.pitch;
/** World scale of a loose bottle, matched to one sitting in a crate. */
export const LOOSE_BOTTLE_SCALE = CRATE_SCALE.bottle * CONTENT_SCALE.bottle;
/**
 * The same for a carrot growing in the ground. Without it the field grew them
 * at full size while a basket showed them at 0.5, so picking one visibly
 * halved it.
 */
export const LOOSE_CARROT_SCALE = CRATE_SCALE.carrot * CONTENT_SCALE.carrot;

// Sourced from `CARRY` so the whole of a character's capacity is tunable from
// one place. These stay exported because they also shape the crate meshes below.
export const RACK_COLS = CARRY.rack.cols;
export const RACK_ROWS = CARRY.rack.rows;
export const RACK_CAPACITY = RACK_COLS * RACK_ROWS;

export const BASKET_COLS = CARRY.basket.cols;
export const BASKET_ROWS = CARRY.basket.rows;
export const BASKET_CAPACITY = BASKET_COLS * BASKET_ROWS;

/** A carrot in world units, leaves included — see `Machines.CARROT`. */
const CARROT_GIRTH = 0.4;
const CARROT_LENGTH = 0.81;

/** Rack footprint, in crate-local units. */
const W = 1.25;
const D = 0.9;

/** A carrot lying on its side, in crate-local units. */
export const LAID_CARROT_LEN = CARROT_LENGTH * CONTENT_SCALE.carrot;
export const LAID_CARROT_GIRTH = CARROT_GIRTH * CONTENT_SCALE.carrot;

/**
 * Basket footprint, DERIVED from what it has to hold rather than guessed.
 *
 * Carrots are carried at full size (see `CONTENT_SCALE`) and lie on their
 * sides, so a cell has to take a whole carrot lengthways — leaves and all,
 * which is nearly twice the root on its own. Columns run along the length and
 * rows across the girth, which is why `CARRY.basket` is 2 x 3 rather than
 * 3 x 2: three lengthways would need a basket over two units wide.
 */
const BW = BASKET_COLS * LAID_CARROT_LEN + 0.16;
const BD = BASKET_ROWS * LAID_CARROT_GIRTH + 0.22;

/**
 * Front-to-back depth of each container, in crate-local units.
 *
 * Exported because a character carries these on their BACK, and how far back
 * one has to sit to clear the body is its own half-depth — a basket is derived
 * from a carrot lying lengthways and is two and a half times as deep as a rack,
 * so one shared offset either buries the basket in the torso or leaves the rack
 * hanging in mid-air. Keyed by item like `CRATE_PITCH`, for the same reason.
 */
export const CRATE_DEPTH = { carrot: BD, bottle: D };

/** Shared crate shell: base slab, corner posts and side rails. */
function crateShell(
    w: number, d: number, height: number, postColor: number, railColor: number,
): THREE.Group {
    const g = new THREE.Group();

    g.add(at(box(w, 0.12, d, C.WOOD_LIGHT), 0, 0.06, 0));
    g.add(at(box(w + 0.1, 0.07, d + 0.1, C.WOOD), 0, 0.015, 0));

    for (const x of [-w / 2 + 0.07, w / 2 - 0.07]) {
        for (const z of [-d / 2 + 0.07, d / 2 - 0.07]) {
            g.add(at(box(0.13, height, 0.13, postColor), x, height / 2, z));
        }
    }

    // Two rails per side — the slatted look from the reference crate.
    for (const y of [height * 0.42, height * 0.86]) {
        g.add(at(box(w, 0.11, 0.09, railColor), 0, y, d / 2 - 0.02));
        g.add(at(box(w, 0.11, 0.09, railColor), 0, y, -d / 2 + 0.02));
        g.add(at(box(0.09, 0.11, d, railColor), w / 2 - 0.02, y, 0));
        g.add(at(box(0.09, 0.11, d, railColor), -w / 2 + 0.02, y, 0));
    }

    return g;
}

/**
 * Contents sit at the centre of each cell of a cols x rows grid. The X spacing
 * matches the rack's divider pitch exactly, so bottles land in the gaps between
 * columns rather than straddling them.
 */
function gridSlots(
    cols: number, rows: number, y: number, w = W, d = D,
): THREE.Vector3[] {
    const spanX = w - 0.16;
    const spanZ = d - 0.22;
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
    const g = crateShell(W, D, height, C.WOOD_DARK, C.WOOD_PALE);

    // Divider columns — the detail that makes this a rack and not a basket.
    for (let c = 0; c <= RACK_COLS; c++) {
        const x = (c / RACK_COLS - 0.5) * (W - 0.16);
        g.add(at(box(0.07, height * 1.15, D - 0.14, C.WOOD_PALE), x, height * 0.58, 0));
    }

    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // The shell's rails/posts/dividers never move relative to each other and
    // racks are pooled, so this merge is paid once per pooled instance and
    // reused for the life of the run — same reasoning as `makeCashStack`.
    if (GRAPHICS.mergeStatic) mergeStaticInPlace(g);
    return { group: g, slots: gridSlots(RACK_COLS, RACK_ROWS, 0.14) };
}

/**
 * A carrot basket. Same crate shell as the rack but with **no divider columns**
 * — carrots are tipped in loose, so anything inside would just clip through them.
 */
export function makeCarrotBasket(): { group: THREE.Group; slots: THREE.Vector3[] } {
    // Deeper than the rack, so a carrot lying in it is held rather than
    // balanced on top — but still low enough that the load shows over the rim.
    const height = 0.62;
    const g = crateShell(BW, BD, height, C.WOOD, C.WOOD_LIGHT);

    // A woven-looking inner liner, purely so the open interior isn't a void.
    g.add(at(box(BW - 0.18, 0.06, BD - 0.18, C.WOOD_PALE), 0, 0.13, 0));

    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // Pooled and never internally animated, like the rack shell above.
    if (GRAPHICS.mergeStatic) mergeStaticInPlace(g);
    // Slot height is the floor plus the carrot's own half-girth: they lie on
    // their sides, so this is where their centre line has to be for them to
    // rest ON the floor rather than sink through it.
    return {
        group: g,
        slots: gridSlots(BASKET_COLS, BASKET_ROWS, 0.12 + LAID_CARROT_GIRTH / 2, BW, BD),
    };
}

/** Bottle rack standing at the production station, angled for display. */
export function makeRackStandFrame(): THREE.Group {
    const g = new THREE.Group();
    // A trestle the finished racks sit on, matching the reference's low bench.
    // Sized against CRATE_SCALE.bottle — a full-width bench dwarfs the crates
    // on it, and it is bottle racks that stand here.
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
