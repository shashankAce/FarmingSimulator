/**
 * World layout and gameplay tuning.
 *
 * Coordinate system: THREE world units on the XZ plane, +Y up.
 * +X runs "east" (the carrot field), +Z runs "south" (toward the camera).
 * The player is confined to the fenced rectangle described by `YARD`.
 */

import { display } from 'noonengine';
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
 * The game's one typeface, loaded from `res/fonts` before the scene runs.
 *
 * `FONT_FAMILY` is the name it is registered under, not a file path — it goes
 * to `Label.fontFamily` for the 2D HUD and to a canvas `font` string for the
 * digits painted on the ground pads. `FONT_SRC` must load through `AssetCache`,
 * never a CSS `@font-face`: a single-file playable rewrites `res/` paths to
 * `data:` URIs and only `AssetCache` resolves them at runtime.
 */
export const FONT_FAMILY = 'Cherry Bomb One';

/**
 * Size of a HUD pill, in design pixels. Shared by the money counter and the
 * DROP button so the two corners of the screen agree — they read as a pair, and
 * two sets of numbers drifted apart the moment one was tuned.
 */
export const PILL = { w: 140, h: 48, stroke: 4 };

/**
 * HUD sizing. Everything is authored at desktop size and multiplied by
 * `hudScale()`.
 *
 * MULTIPLIED, not applied as a node scale: a `Label` bakes its text to a bitmap
 * at whatever `fontSize` it was given, so scaling the node afterwards resamples
 * that bitmap and the text goes soft. The same goes for `Graphics`.
 *
 * The design resolution is FIXED_HEIGHT, so a design pixel is already the same
 * fraction of screen height everywhere — this is not about pixel density. It is
 * about width: a phone's aspect crops the design box hard, and panels sized for
 * a desktop's width eat most of what is left.
 */
export const HUD = { mobileScale: 0.75 };

/**
 * Virtual joystick, in design pixels.
 *
 * `radius` is the stick's full travel, so it is a FEEL setting as much as a
 * size one: it sets how far the thumb has to move for full tilt, and the
 * reading is `distance / radius`. A larger ring is gentler and needs more room;
 * a smaller one is twitchier.
 *
 * Deliberately not run through `hudScale()` like the panels are. Those shrink
 * on a phone to win back screen width; a touch control shrinking on the only
 * device that uses it is the wrong trade.
 */
export const JOYSTICK = { radius: 60, knob: 20 };

/** `HUD.mobileScale` on a phone, 1 on desktop and tablet. */
export function hudScale(): number {
    return display.isMobile() ? HUD.mobileScale : 1;
}
export const FONT_SRC = 'res/fonts/CherryBombOne-Regular.ttf';

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
    cols: 4,
    rows: 5,
    plotW: 2.9,
    plotD: 2.9,
    gap: 0.35,
    /** Carrots per plot, laid out as a small grid inside the plot. */
    carrotCols: 3,
    carrotRows: 4,
    /** Seconds before a harvested carrot grows back. */
    regrowTime: 15,
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

/** Footprint of one floor trigger, as full extents (not half-extents). */
export interface PadSize {
    w: number;
    d: number;
}

/**
 * ─── ZONE SIZES ──────────────────────────────────────────────────────────────
 * Every floor trigger's footprint, in one block. "Make the pads bigger" is one
 * intent, and it used to be four edits in four unrelated sections of this file.
 *
 * `w` is the world-X extent and `d` the world-Z extent. `Zone` is axis-aligned
 * and does NOT rotate with whatever it belongs to, so for the west-fence stalls
 * `shop.w` is the depth in from the counter and `shop.d` is the span along the
 * fence — not the other way round.
 *
 * One knock-on worth knowing before tuning these: the pictogram is scaled to
 * `min(w, d)`, so a pad made narrow shrinks its icon even if it grows deeper.
 * The progress fill always rises up the screen along `d`, whatever the shape.
 */
export const ZONE = {
    /** Starting cash on the ground — the first thing the player picks up. */
    startCash: { w: 4.4, d: 3.0 } as PadSize,
    /** Tip carrots into the juicer. */
    juicerIn: { w: 3.8, d: 3.0 } as PadSize,
    /** Lift a filled rack off the stand. */
    rackPickup: { w: 3.8, d: 3.0 } as PadSize,
    /** Serving pad at a stall, and its construction plot before that. */
    shop: { w: 1.7, d: 3.0 } as PadSize,
    /** Hire and upgrade pads. Deliberately small: they sit among the stations. */
    hire: { w: 1.7, d: 2 } as PadSize,
    /** Sweep the takings off a stall's counter. */
    collect: { w: 1.7, d: 1.2 } as PadSize,
};

/**
 * ─── PRODUCTION LINE ─────────────────────────────────────────────────────────
 * The juicer, its conveyor and the rack stand are ONE machine. `PLANT.origin`
 * places the whole line and every part is measured from it, so relocating the
 * plant is a single edit — previously it meant keeping six coordinates in
 * STATIONS in sync by hand.
 *
 * Offsets are along -X (the line runs from the juicer westward to the racks)
 * and +Z (`padOffset` puts the interaction pads in front of the machinery, on
 * the side the player approaches from).
 */
export const PLANT = {
    /** Move THIS to move the juicer, belt, racks and all their pads together. */
    origin: { x: -5.5, z: -8 },
    /** Belt head and tail, as offsets along the line from the juicer. */
    beltStart: -3.2,
    beltEnd: -7.6,
    /** Rack stand, same axis. */
    rackStand: -9.9,
    /** How far in front of the machinery the interaction pads sit. */
    padOffset: 3.5,
    /** Speed-upgrade pad, relative to the origin. */
    upgradePad: { dx: -4.1, dz: 3.6 },
};

/**
 * Interaction pads and the fixed machinery between them.
 *
 * Pad entries carry their own HUD presentation (`icon`, `showProgress`) so a
 * station is one config object rather than a position here and an icon wired up
 * somewhere else. Entries without `w`/`d` are machine anchors, not pads.
 *
 * Everything belonging to the production line is derived from `PLANT` — edit
 * that, not these.
 */
export const STATIONS = {
    /** Starting cash on the ground — the first thing the player ever picks up. */
    startCash: { x: -8, z: 12, ...ZONE.startCash, icon: 'money' as IconKind },
    /** The machine body itself (not walkable). */
    juicer: { x: PLANT.origin.x, z: PLANT.origin.z },
    /** Drop carrots here to feed the juicer. */
    juicerIn: {
        x: PLANT.origin.x, z: PLANT.origin.z + PLANT.padOffset,
        ...ZONE.juicerIn, icon: 'carrot' as IconKind, showProgress: true,
    },
    /** Conveyor runs from the juicer westward to the rack stand. */
    conveyor: {
        x0: PLANT.origin.x + PLANT.beltStart,
        x1: PLANT.origin.x + PLANT.beltEnd,
        z: PLANT.origin.z,
    },
    /** The rack stand sits just behind the pickup pad. */
    racks: { x: PLANT.origin.x + PLANT.rackStand, z: PLANT.origin.z },
    /** Lift a filled rack off the stand here. */
    rackPickup: {
        x: PLANT.origin.x + PLANT.rackStand, z: PLANT.origin.z + PLANT.padOffset,
        ...ZONE.rackPickup, icon: 'bottle' as IconKind, showProgress: true,
    },
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
    rackStand: { w: 2.8, d: 1.15 },
    /**
     * Reserved. Nothing places a signpost right now — prices are written on the
     * grass beside their pad instead — but `makeSignpost()` is still available,
     * and if it comes back this is the POST footprint, not the board. The board
     * hangs overhead and you walk under it; its full width would wall off the
     * approach to whatever the sign advertises.
     */
    signpost: { w: 0.36, d: 0.36 },
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
    { side: 'west', along: 9.5, cost: 60 },      // opens with the starting cash
    { side: 'west', along: -1.0, cost: 450 },
    { side: 'south', along: -15, cost: 1400 },
];

/** Stall geometry shared by every entry in `SHOPS`. */
export const SHOP = {
    /** How far inside the fence the stall body sits. */
    inset: 2.0,
    /** From the stall origin to the player's serving pad, further inward. */
    sellDistance: 1.0,
    /**
     * Where stock crates sit, in stall-local units: along the counter, then
     * outward, at `counterTop`. ON the counter rather than on the grass beside
     * it — a stall's stock reads as merchandise when it is behind the counter
     * and as litter when it is next to it.
     *
     * These mirror the counter built by `makeShop()`: its top surface is at
     * 1.33 and its usable depth is centred on 1.15. `stockAlong` keeps clear of
     * the display bottles and jug dressing the left-hand end.
     */
    stockAlong: 1.2,
    stockOut: 1.05,
    counterTop: 1.33,
    /** Hire pad, on the stall's other flank. */
    hireAlong: 6.0,
    hireInward: -1,
    /**
     * Takings pad. Money is swept HERE, not at the serving pad, so clearing a
     * blocked counter costs a walk rather than happening for free under the
     * player's feet. Sits on the flank opposite the hire pad.
     */
    collectAlong: 4.0,
    collectInward: -1,
    /**
     * Construction-plot deck, in stall-local units. `offset` pushes it toward
     * the customer side so it clears the serving pad behind it.
     */
    frame: { w: 5.0, d: 2.0, offset: 1.05 },
    /**
     * Takings waiting on the collect pad; sales stall once every slot is used.
     * They fill a `tillCols` x `tillRows` grid centred on the pad and then keep
     * stacking in layers on top of it, so `tillSlots` is two full grids' worth.
     */
    tillSlots: 18,
    tillCols: 2,
    tillRows: 3,
    /**
     * Gap between neighbouring bundles of takings, both ways. Spacing is
     * derived from the bundle plus this, not from the pad — sized off the pad,
     * the columns spread to fill it and the pile stopped reading as a pile.
     */
    tillGap: 0.05,
    /** Height of one full grid, i.e. how far the next layer sits above it. */
    tillLayer: 0.16,
    /** Crates that can be set down at one stall. */
    stockCrates: 6,
    /** From the stall origin out to the counter face. */
    counterOffset: 1.7,
    /**
     * Turn applied to a stall's pads ON TOP of the stall's own yaw, in DEGREES
     * (like `CAMERA.fov`; `resolveShop` hands the callers radians).
     *
     * `ZONE` sizes are authored with `w` across the counter and `d` along it,
     * while a stall's local X runs ALONG its counter — the two conventions are
     * a quarter-turn apart, and this is what reconciles them. Without it the
     * pads turn with the stall but land side-on to it: a 1.7-wide strip in
     * front of a 5.0-wide counter.
     */
    padYawDeg: 90,
};

const DEG_TO_RAD = Math.PI / 180;

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
    /** Where carried crates are stacked, on the counter top. */
    stockPad: { x: number; z: number };
    /**
     * Heading every pad of this stall is laid at, in radians — the stall's own
     * yaw plus `SHOP.padYawDeg`. Derived once here so the zone markings, the
     * cash grid on the takings pad and the stacks themselves cannot drift apart.
     */
    padYaw: number;
    /** Pad for hiring this stall's shopkeeper, on its other flank. */
    hirePad: { x: number; z: number };
    /** Where takings are swept off the counter. */
    collectPad: { x: number; z: number };
    /** The point shoppers turn to face. */
    counter: { x: number; z: number };
    queue: {
        slot0: { x: number; z: number };
        step: { x: number; z: number };
        spawn: { x: number; z: number };
        exit: { x: number; z: number };
    };
    /** Unit vector along this stall's fence — handy for placing things beside it. */
    alongDir: { x: number; z: number };
    /** Unit vector pointing out across the fence, away from the yard. */
    outDir: { x: number; z: number };
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
        padYaw: v.yaw + SHOP.padYawDeg * DEG_TO_RAD,
        sellPad: off(stall, 0, -SHOP.sellDistance),
        stockPad: off(stall, SHOP.stockAlong, SHOP.stockOut),
        hirePad: off(stall, SHOP.hireAlong, -SHOP.hireInward),
        collectPad: off(stall, SHOP.collectAlong, -SHOP.collectInward),
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
        alongDir: { x: v.along.x, z: v.along.z },
        outDir: { x: v.out.x, z: v.out.z },
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

/**
 * ─── HIRING & UPGRADES ───────────────────────────────────────────────────────
 * One farmhand and one shopkeeper may be hired per shop, so the workforce
 * scales with the business rather than being capped at one of each.
 *
 * Shopkeeper pads ride along with their stall (`ShopPlacement.hirePad`) and only
 * appear once it is open — hiring staff for a shop that does not exist reads as
 * a bug. Farmhand pads sit along the near edge of the field, clear of the
 * tilled area itself.
 */
export const HIRE = {
    /** Escalating price per additional hire, indexed by how many you already have. */
    farmhandCosts: [250, 700, 1500],
    shopkeeperCosts: [600, 1400, 2800],
};

/** Farmhand pads, laid out along the field's near edge. */
export function farmhandPads(): Array<{ x: number; z: number }> {
    const f = fieldBounds();
    const z = f.maxZ + 2.2;
    const span = f.maxX - f.minX;
    return [0.22, 0.5, 0.78].map(t => ({ x: f.minX + span * t, z }));
}

/**
 * Juicer speed upgrade. `processTime[level]` is the seconds per bottle; buying
 * level N costs `costs[N - 1]`. Kept as a table rather than a formula so the
 * curve can be tuned by eye.
 */
export const MACHINE_UPGRADE = {
    /** Derived from PLANT so it travels with the machine it upgrades. */
    pad: {
        x: PLANT.origin.x + PLANT.upgradePad.dx,
        z: PLANT.origin.z + PLANT.upgradePad.dz,
    },
    processTime: [0.75, 0.52, 0.36, 0.24],
    costs: [400, 1100, 2600],
};

export const PLAYER = {
    startX: -12,
    startZ: 4,
    speed: 9.5,
    turnSpeed: 14,
    radius: 0.7,
};

export const ASSISTANT = {
    speed: 6.4,
};

/**
 * ─── CARRYING CAPACITY ───────────────────────────────────────────────────────
 * How much a character can hold, in one block, because it is TWO numbers
 * multiplied and tuning one without seeing the other is how you end up
 * surprised: `crates` is how many baskets or racks stack in the arms, and the
 * grid below is how many items fit inside one of them.
 *
 *     carrots per trip = playerCrates * basket.cols * basket.rows
 *     bottles per trip = playerCrates * rack.cols   * rack.rows
 *
 * Both halves have a visible side effect, so neither is a free dial:
 *
 * - `crates` grows the stack held out in front. It is already scaled down
 *   (`Containers.CRATE_SCALE`) because a full-size stack hides the character
 *   from this camera, so much past 3 or 4 is a tower with a bunny under it.
 * - the grids BUILD the crate mesh — a rack draws one divider per column — so
 *   widening one packs the same-sized crate tighter rather than enlarging it.
 *
 * `rack` reaches beyond the arms: it is also the unit the production stand and
 * every shop's stock are measured in, so raising it moves the economy too.
 */
export const CARRY = {
    /** Crates in the arms. Assistants carry a lighter load than the player. */
    playerCrates: 6,
    assistantCrates: 2,
    /** Carrots in a basket. */
    basket: { cols: 3, rows: 2 },
    /** Bottles in a rack. */
    rack: { cols: 3, rows: 2 },
    /**
     * Vertical gap between stacked crates, in crate-local units — ONE number
     * for the pile in a character's arms and the pile on a stall's counter, so
     * the two can never drift apart.
     *
     * It has to clear the contents standing out of the crate below, not just
     * that crate's rim: a rack of bottles reaches 0.77 of a crate, so below
     * that the bottles poke up through the floor of the crate above. The slack
     * over 0.77 is the visible air between them.
     */
    pitch: { bottle: 0.86, carrot: 0.78 },
};

export const ECONOMY = {
    /** Cash sitting on the ground at the start of the run. */
    startCash: 60,
    /**
     * Stacks it is split across, laid out as a grid on the `startCash` pad. A
     * square count (4, 9) gives a square block; anything else fills the last
     * row short.
     */
    startCashPiles: 6,
    /** One carrot becomes one bottle of juice. */
    bottleValue: 14,
    farmerCost: 250,
    sellerCost: 600,
};

export const MACHINE = {
    /** Starting seconds per bottle. The speed upgrade overwrites this at runtime
     *  — see `MACHINE_UPGRADE.processTime`. */
    processTime: 0.75,
    /**
     * Carrots the hopper holds. Intake closes here, and the juicer pad's fill
     * bar reads against this same number, so a full bar means a shut intake
     * rather than a bar that has simply run out of room to grow.
     */
    hopperCapacity: 8,
    /** How long a bottle takes to ride the belt end to end. */
    beltTime: 2.4,
    /**
     * Minimum world-space gap between bottles queued on the belt. This is the
     * belt's OWN capacity — bottles back up behind a full rack stand instead of
     * the juicer stalling, so a jam is something you can see.
     */
    beltGap: 0.32,
    /** Seconds between one item transferring during a pickup/dropoff. */
    transferInterval: 0.11,
    /** Rack positions along the production stand. */
    rackStandSlots: 3,
    /**
     * Crates that may stack at ONE stand position. Raising this is the storage
     * upgrade — total bottle capacity is
     * `rackStandSlots * rackStackLimit * RACK_CAPACITY`.
     */
    rackStackLimit: 1,
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

    for (const [i, pad] of farmhandPads().entries()) {
        if (!inside(pad.x, pad.z)) warn(`farmhandPads()[${i}] is outside YARD.`);
        const f = fieldBounds();
        if (pad.x > f.minX && pad.x < f.maxX && pad.z > f.minZ && pad.z < f.maxZ) {
            warn(`farmhandPads()[${i}] sits on top of the tilled field.`);
        }
    }
    if (!inside(MACHINE_UPGRADE.pad.x, MACHINE_UPGRADE.pad.z)) {
        warn('MACHINE_UPGRADE.pad is outside YARD.');
    }

    // The production line moves as one, so check both of its ends.
    for (const [name, pt] of [
        ['juicer', STATIONS.juicer],
        ['rack stand', STATIONS.racks],
        ['belt tail', { x: STATIONS.conveyor.x1, z: STATIONS.conveyor.z }],
    ] as Array<[string, { x: number; z: number }]>) {
        if (pt.x < YARD.minX + 3 || pt.x > YARD.maxX - 3
            || pt.z < YARD.minZ + 3 || pt.z > YARD.maxZ - 3) {
            warn(`PLANT places the ${name} too close to the fence — move PLANT.origin.`);
        }
    }

    SHOPS.forEach((cfg, i) => {
        const p = resolveShop(cfg);
        if (!inside(p.sellPad.x, p.sellPad.z)) {
            warn(`SHOPS[${i}] serving pad is outside YARD — raise SHOP.inset or move it along the fence.`);
        }
        if (!inside(p.hirePad.x, p.hirePad.z)) warn(`SHOPS[${i}] hire pad is outside YARD.`);
        if (!inside(p.collectPad.x, p.collectPad.z)) warn(`SHOPS[${i}] takings pad is outside YARD.`);
        // Neighbours on the same fence need room for their queues.
        SHOPS.forEach((other, j) => {
            if (j <= i || other.side !== cfg.side) return;
            if (Math.abs(other.along - cfg.along) < QUEUE.alongStep * QUEUE.slots) {
                warn(`SHOPS[${i}] and SHOPS[${j}] are on the same fence and their queues will overlap.`);
            }
        });
    });
}
