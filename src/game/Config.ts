/**
 * World layout and gameplay tuning.
 *
 * Coordinate system: THREE world units on the XZ plane, +Y up.
 * +X runs "east" (the carrot field), +Z runs "south" (toward the camera).
 * The player is confined to the fenced rectangle described by `YARD`.
 */

import type { IconKind } from './procgen/Icons.ts';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/**
 * ─── BOUNDARY ────────────────────────────────────────────────────────────────
 * The fenced play area, in world units. This single rect drives everything
 * about the perimeter: the fence runs on it, the player is clamped inside it,
 * the cobbled ring road is laid just outside it, and the village is scattered
 * beyond that. Widen or move it and all of those follow.
 *
 * Shops attach to its edges by name (see `SHOPS`), so changing these numbers
 * carries the stalls and their queues along with the fence.
 */
export const YARD = {
    minX: -23,
    maxX: 20,
    minZ: -16,
    maxZ: 18,
};

export const yardWidth = (): number => YARD.maxX - YARD.minX;
export const yardDepth = (): number => YARD.maxZ - YARD.minZ;
export const yardCenter = (): { x: number; z: number } => ({
    x: (YARD.minX + YARD.maxX) / 2,
    z: (YARD.minZ + YARD.maxZ) / 2,
});

/** Grass extends well past the fence so the outer village sits on green, not void. */
export const GROUND_SIZE = 180;

/**
 * ─── AGRICULTURAL LAND ───────────────────────────────────────────────────────
 * The carrot field: a `cols` x `rows` grid of raised soil plots.
 *
 * `originX`/`originZ` is the centre of the FIRST plot (the -X/-Z corner); the
 * grid grows toward +X/+Z from there. Plot pitch is `plotW + gap` by
 * `plotD + gap`, so the whole worked area is
 *   width  = cols * plotW + (cols - 1) * gap  (+ a `gap` border either side)
 *   depth  = rows * plotD + (rows - 1) * gap
 * Use `fieldBounds()` rather than recomputing that anywhere.
 *
 * Nothing else is pinned to the field, so it can be moved, resized or reshaped
 * freely — just keep it inside `YARD` (`validateLayout()` warns if it isn't).
 */
export const FIELD = {
    originX: 1.5,
    originZ: -12,
    cols: 6,
    rows: 8,
    plotW: 2.9,
    plotD: 2.9,
    gap: 0.35,
    /** Carrots per plot, laid out as a small grid inside the plot. */
    carrotCols: 3,
    carrotRows: 4,
    /** Seconds before a harvested carrot grows back. */
    regrowTime: 9,
};

/** Outer extent of the tilled area, including the soil border around the plots. */
export function fieldBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const strideX = FIELD.plotW + FIELD.gap;
    const strideZ = FIELD.plotD + FIELD.gap;
    return {
        minX: FIELD.originX - FIELD.plotW / 2 - FIELD.gap,
        maxX: FIELD.originX + (FIELD.cols - 1) * strideX + FIELD.plotW / 2 + FIELD.gap,
        minZ: FIELD.originZ - FIELD.plotD / 2 - FIELD.gap,
        maxZ: FIELD.originZ + (FIELD.rows - 1) * strideZ + FIELD.plotD / 2 + FIELD.gap,
    };
}

/** Where each station sits. `r` is the trigger radius / half-extent of its floor marker. */
/**
 * Interaction pads and the fixed machinery between them.
 *
 * Pad entries carry their own HUD presentation (`icon`, `showProgress`) so a
 * station is one config object rather than a position here and an icon wired up
 * somewhere else. Entries without `w`/`d` are machine anchors, not pads.
 */
export const STATIONS = {
    /** Starting cash on the ground — the first thing the player ever picks up. */
    startCash: { x: -8, z: 12, w: 4.4, d: 3.0, icon: 'money' as IconKind },
    /** Drop carrots here to feed the juicer. */
    juicerIn: { x: -4.5, z: 3.5, w: 3.8, d: 3.0, icon: 'carrot' as IconKind, showProgress: true },
    /** The machine body itself (not walkable). */
    juicer: { x: -4.5, z: 0 },
    /** Conveyor runs from the juicer westward to the rack stand. */
    conveyor: { x0: -7.7, x1: -12.1, z: 0 },
    /** Lift a filled rack off the stand here. */
    rackPickup: { x: -14.4, z: 3.5, w: 3.8, d: 3.0, icon: 'bottle' as IconKind, showProgress: true },
    /** The rack stand sits just behind the pickup pad. */
    racks: { x: -14.4, z: 0 },
    /** Upgrade pads. */
    hireFarmer: { x: 0.5, z: -11.5, w: 3.4, d: 3.4, icon: 'hire' as IconKind, showProgress: true },
    hireSeller: { x: -14.4, z: -5.5, w: 3.4, d: 3.4, icon: 'hire' as IconKind, showProgress: true },
};

/**
 * Solid footprints inside the fence, as full extents centred on the machine
 * they belong to. Anything listed here blocks characters; anything omitted is
 * walked straight through. Stall counters are derived per-shop instead — see
 * `ShopPlacement.counterBox`.
 */
export const BLOCKERS = {
    juicer: { w: 4.7, d: 4.1 },
    /** Depth only; the span comes from `STATIONS.conveyor`. */
    conveyorDepth: 1.5,
    rackStand: { w: 3.6, d: 1.4 },
    /** Signposts are thin but solid — you should not walk through the billboard. */
    signpost: { w: 2.5, d: 0.5 },
};

/**
 * ─── SHOPS ───────────────────────────────────────────────────────────────────
 * Each stall attaches to one edge of `YARD` and slides along it. Everything
 * else — which way the counter faces, where the player stands to serve, where
 * the queue forms, which way shoppers walk in and out — is derived from
 * `side` + `along` by `resolveShop()`, so placing a stall is two numbers.
 *
 *   side  : which fence the stall backs onto ('north' = -Z, 'south' = +Z,
 *           'west' = -X, 'east' = +X). The counter always faces outward and
 *           the queue always forms on the far side of the fence.
 *   along : position ALONG that fence — a Z coordinate for west/east stalls,
 *           an X coordinate for north/south ones.
 *   cost  : 0 opens for free with the starting cash; anything else is paid off
 *           by standing on that stall's own pad.
 *   inset : optional override for how far inside the fence the stall sits.
 *
 * Spread them over different sides freely. Each needs roughly 6 units of fence
 * to itself so neighbouring queues don't overlap.
 */
export type BoundarySide = 'north' | 'south' | 'east' | 'west';

export interface ShopConfig {
    side: BoundarySide;
    along: number;
    cost: number;
    inset?: number;
}

export const SHOPS: ReadonlyArray<ShopConfig> = [
    { side: 'west', along: 9.5, cost: 0 },      // opens with the starting cash
    { side: 'west', along: 1.0, cost: 450 },
    { side: 'west', along: -7.5, cost: 1400 },
];

/** Stall geometry shared by every entry in `SHOPS`. */
export const SHOP = {
    /** How far inside the fence the stall body sits. */
    inset: 2.0,
    /** From the stall origin to the player's serving pad, further inward. */
    sellDistance: 1.5,
    /** Where dropped crates land, relative to the stall: along the fence, then inward. */
    dropAlong: -3.0,
    dropInward: 0.6,
    /**
     * Construction-plot deck, in stall-local units. `offset` pushes it toward
     * the customer side so it clears the serving pad behind it.
     */
    frame: { w: 5.0, d: 2.0, offset: 1.05 },
    /** Completed orders stack up here; sales stall once it's full. */
    tillSlots: 4,
    /** Crates that can be set down at one stall. */
    stockCrates: 3,
    /** From the stall origin out to the counter face. */
    counterOffset: 1.7,
    /** Size of the serving / construction pad. */
    padW: 3.8,
    padD: 3.0,
};

interface SideVectors {
    /** Unit vector pointing out of the yard across this fence. */
    out: { x: number; z: number };
    /** Unit vector running along this fence — the direction the queue extends. */
    along: { x: number; z: number };
    /** Stall yaw. `makeShop()` is authored facing +Z; this turns it outward. */
    yaw: number;
}

const SIDE: Record<BoundarySide, SideVectors> = {
    west: { out: { x: -1, z: 0 }, along: { x: 0, z: 1 }, yaw: -Math.PI / 2 },
    east: { out: { x: 1, z: 0 }, along: { x: 0, z: -1 }, yaw: Math.PI / 2 },
    north: { out: { x: 0, z: -1 }, along: { x: -1, z: 0 }, yaw: Math.PI },
    south: { out: { x: 0, z: 1 }, along: { x: 1, z: 0 }, yaw: 0 },
};

export interface ShopPlacement {
    stall: { x: number; z: number };
    yaw: number;
    /** Where the player stands to build, then to serve. */
    sellPad: { x: number; z: number };
    /** Where carried crates are set down beside the stall. */
    dropPad: { x: number; z: number };
    /** The point shoppers turn to face. */
    counter: { x: number; z: number };
    queue: {
        slot0: { x: number; z: number };
        step: { x: number; z: number };
        spawn: { x: number; z: number };
        exit: { x: number; z: number };
    };
    /** Bunting runs along the fence, so it needs the fence's own heading. */
    bunting: { x: number; z: number; yaw: number };
    /** World-space footprint of the counter, for collision once open. */
    counterBox: { x: number; z: number; w: number; d: number };
    /** World-space footprint of the construction deck, for collision while locked. */
    frameBox: { x: number; z: number; w: number; d: number };
}

/** Turns a `ShopConfig` into every world position that stall needs. */
export function resolveShop(cfg: ShopConfig): ShopPlacement {
    const v = SIDE[cfg.side];
    const inset = cfg.inset ?? SHOP.inset;

    // The point on the fence this stall is centred on.
    const fence = cfg.side === 'west' ? { x: YARD.minX, z: cfg.along }
        : cfg.side === 'east' ? { x: YARD.maxX, z: cfg.along }
        : cfg.side === 'north' ? { x: cfg.along, z: YARD.minZ }
        : { x: cfg.along, z: YARD.maxZ };

    /** Offsets a point by `alongBy` down the fence and `outBy` across it. */
    const off = (base: { x: number; z: number }, alongBy: number, outBy: number) => ({
        x: base.x + v.along.x * alongBy + v.out.x * outBy,
        z: base.z + v.along.z * alongBy + v.out.z * outBy,
    });

    const stall = off(fence, 0, -inset);
    const slot0 = off(fence, 0, QUEUE.standoff);

    return {
        stall,
        yaw: v.yaw,
        sellPad: off(stall, 0, -SHOP.sellDistance),
        dropPad: off(stall, SHOP.dropAlong, -SHOP.dropInward),
        counter: off(stall, 0, SHOP.counterOffset),
        queue: {
            slot0,
            step: {
                x: v.along.x * QUEUE.alongStep + v.out.x * QUEUE.outwardDrift,
                z: v.along.z * QUEUE.alongStep + v.out.z * QUEUE.outwardDrift,
            },
            spawn: off(slot0, QUEUE.spawnAhead, QUEUE.spawnOut),
            exit: off(slot0, -QUEUE.exitBehind, QUEUE.spawnOut),
        },
        bunting: {
            x: fence.x,
            z: fence.z,
            // Bunting is authored along X; west/east fences run along Z.
            yaw: cfg.side === 'west' || cfg.side === 'east' ? Math.PI / 2 : 0,
        },
        // The counter is 5.0 along the fence by 1.0 across it, centred 1.15
        // outward of the stall origin. Sides are axis-aligned, so projecting the
        // local extents onto the world axes gives an exact AABB.
        counterBox: {
            ...off(stall, 0, 1.15),
            w: Math.abs(v.along.x) * 5.2 + Math.abs(v.out.x) * 1.2,
            d: Math.abs(v.along.z) * 5.2 + Math.abs(v.out.z) * 1.2,
        },
        // The locked plot is a different shape in a different place from the
        // counter that replaces it, so it needs its own box rather than reusing
        // the counter's — which is what left closed shops blocking thin air.
        frameBox: {
            ...off(stall, 0, SHOP.frame.offset),
            w: Math.abs(v.along.x) * (SHOP.frame.w + 0.2) + Math.abs(v.out.x) * SHOP.frame.d,
            d: Math.abs(v.along.z) * (SHOP.frame.w + 0.2) + Math.abs(v.out.z) * SHOP.frame.d,
        },
    };
}

/**
 * The customer queue outside a stand. Shoppers walk in from `spawn`, take the
 * first free slot, and shuffle forward as those ahead are served.
 *
 * All distances are relative to the stall's own fence, not to world axes, so
 * these numbers hold however a stall is placed (see `resolveShop`).
 */
export const QUEUE = {
    /** Shoppers per stand. */
    slots: 3,
    /** Spacing between shoppers, measured along the fence. */
    alongStep: 1.8,
    /**
     * How much each shopper further back also drifts away from the fence.
     * A dead-straight line puts every back to the camera and they read as
     * featureless blobs; fanned out, you see them in three-quarter view.
     */
    outwardDrift: 0.55,
    /** How far outside the fence the shopper being served stands. */
    standoff: 1.7,
    /** Where arrivals appear and departures head, relative to the front slot. */
    spawnAhead: 11,
    exitBehind: 9,
    spawnOut: 4.5,
    speed: 3.4,
    /** Bottles a single shopper asks for. */
    minOrder: 2,
    maxOrder: 4,
    /** Seconds before a freed slot is refilled by a new arrival. */
    respawnDelay: 1.1,
};

/**
 * ─── VILLAGE ─────────────────────────────────────────────────────────────────
 * Everything outside the fence. Positions are written as offsets from `YARD`'s
 * edges rather than as bare world coordinates, so moving or resizing the
 * boundary carries the whole village with it.
 *
 * `buildEnvironment()` reads this and nothing else — it holds no positions of
 * its own. Scatter counts drive the seeded random fill; the explicit arrays are
 * the placed landmarks.
 */
export const VILLAGE = {
    /** Seed for every scattered position. Change it to reroll the whole village. */
    seed: 0xC0FFEE,
    /** Gap between the fence and the cobbled ring road. */
    pathPadding: 4.2,
    pathWidth: 2.6,

    houses: [
        { x: YARD.minX - 12, z: YARD.minZ - 9, yaw: 0.2 },
        { x: YARD.minX - 3, z: YARD.minZ - 12, yaw: -0.1 },
        { x: YARD.minX + 9, z: YARD.minZ - 13, yaw: 0.05 },
        { x: YARD.minX + 21, z: YARD.minZ - 11, yaw: -0.25 },
        { x: YARD.minX - 15, z: YARD.minZ + 6, yaw: 1.4 },
        { x: YARD.minX - 17, z: YARD.minZ + 18, yaw: 1.5 },
        { x: YARD.minX - 14, z: YARD.maxZ + 2, yaw: 1.7 },
        { x: YARD.maxX + 13, z: YARD.minZ - 4, yaw: -1.5 },
        { x: YARD.maxX + 15, z: YARD.minZ + 12, yaw: -1.6 },
    ],

    lamps: [
        { x: YARD.minX - 5.8, z: YARD.minZ + 4 },
        { x: YARD.minX - 5.8, z: YARD.minZ + 22 },
        { x: YARD.minX + 6, z: YARD.minZ - 5.8 },
        { x: YARD.maxX - 8, z: YARD.minZ - 5.8 },
        { x: YARD.maxX + 5.8, z: YARD.maxZ - 10 },
    ],

    fountain: { x: YARD.minX - 9, z: YARD.minZ - 1 },
    cart: { x: YARD.minX - 7, z: YARD.minZ - 8, yaw: 0.6 },

    /** Cattle graze in the western pasture. */
    cattle: { count: 5, minOut: 14, maxOut: 26, zFrom: -6, zTo: 16 },

    /** Seeded scatter: how many, and how far outside the fence they may land. */
    scatter: {
        trees: { count: 46, minPad: 5, maxPad: 46, floweringChance: 0.25 },
        bushes: { count: 40, minPad: 2, maxPad: 40 },
        rocks: { count: 18, minPad: 2, maxPad: 44 },
        props: { count: 7, minPad: 6, maxPad: 20 },
        /** Flowers and tufts are flat, so they are allowed inside the fence too. */
        groundCover: { count: 130, spread: 75 },
    },

    /** Broad tonal discs that break up the flat green. */
    grassPatches: { count: 30, minR: 2.5, maxR: 6.0, spread: 70 },
};

export const PLAYER = {
    startX: -8,
    startZ: 14,
    speed: 9.5,
    turnSpeed: 14,
    radius: 0.7,
    /** Crates stackable in the arms at once — NOT a count of individual items. */
    capacity: 2,
};

export const ASSISTANT = {
    speed: 6.4,
    /** Crates, not items — assistants carry a lighter load than the player. */
    capacity: 2,
};

export const ECONOMY = {
    /** Cash sitting on the ground at the start of the run. */
    startCash: 60,
    /** One carrot becomes one bottle of juice. */
    bottleValue: 14,
    farmerCost: 250,
    sellerCost: 600,
};

export const MACHINE = {
    /** Seconds the juicer takes to turn one carrot into one bottle. */
    processTime: 0.75,
    /** How long a bottle takes to ride the belt end to end. */
    beltTime: 3.2,
    /** Seconds between one item transferring during a pickup/dropoff. */
    transferInterval: 0.11,
};

/** Camera rig — a fixed offset that follows the player, giving the reference's ~50° tilt. */
export const CAMERA = {
    offsetX: 0,
    offsetY: 17,
    offsetZ: 14,
    // vFOV; the horizontal spread follows the design aspect
    // (hFOV = 2*atan(tan(vFOV/2) * GAME_WIDTH/GAME_HEIGHT)). At the landscape
    // 1280x720 this shows roughly 38 x 21 world units around the player —
    // enough to frame the juicer/belt/rack cluster in one shot.
    fov: 52,
    /** Higher = snappier follow. */
    lerp: 4.2,
};

/**
 * Dev-only sanity check on the layout constants above. Called from `FarmScene`
 * under `DEBUG`, so a bad edit surfaces as a console warning on the next reload
 * instead of as a station you can't reach or a field that hangs over the fence.
 */
export function validateLayout(): void {
    const warn = (msg: string) => console.warn(`[layout] ${msg}`);

    if (YARD.minX >= YARD.maxX || YARD.minZ >= YARD.maxZ) {
        warn('YARD is inverted or zero-sized.');
    }

    const f = fieldBounds();
    if (f.minX < YARD.minX || f.maxX > YARD.maxX || f.minZ < YARD.minZ || f.maxZ > YARD.maxZ) {
        warn(`FIELD (${f.minX.toFixed(1)}..${f.maxX.toFixed(1)} x ${f.minZ.toFixed(1)}..${f.maxZ.toFixed(1)}) `
            + 'extends outside YARD — carrots will grow through the fence.');
    }

    // Every pad the player has to stand on must actually be inside the fence,
    // allowing for their body radius.
    const r = PLAYER.radius;
    const inside = (x: number, z: number) =>
        x > YARD.minX + r && x < YARD.maxX - r && z > YARD.minZ + r && z < YARD.maxZ - r;

    for (const [name, pad] of Object.entries(STATIONS)) {
        if (!('w' in pad)) continue;
        if (!inside(pad.x, pad.z)) warn(`STATIONS.${name} pad is outside YARD.`);
    }

    SHOPS.forEach((cfg, i) => {
        const p = resolveShop(cfg);
        if (!inside(p.sellPad.x, p.sellPad.z)) {
            warn(`SHOPS[${i}] serving pad is outside YARD — raise SHOP.inset or move it along the fence.`);
        }
        // Neighbours on the same fence need room for their queues.
        SHOPS.forEach((other, j) => {
            if (j <= i || other.side !== cfg.side) return;
            if (Math.abs(other.along - cfg.along) < QUEUE.alongStep * QUEUE.slots) {
                warn(`SHOPS[${i}] and SHOPS[${j}] are on the same fence and their queues will overlap.`);
            }
        });
    });
}
