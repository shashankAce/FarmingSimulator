/**
 * World layout and gameplay tuning.
 *
 * Coordinate system: THREE world units on the XZ plane, +Y up.
 * +X runs "east" (the carrot field), +Z runs "south" (toward the camera).
 * The player is confined to the fenced rectangle described by `YARD`.
 */

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/** The fenced play area the player can walk in. */
export const YARD = {
    minX: -26,
    maxX: 28,
    minZ: -20,
    maxZ: 22,
};

/** Grass extends well past the fence so the outer village sits on green, not void. */
export const GROUND_SIZE = 180;

/** The carrot field: a grid of raised soil plots on the east side. */
export const FIELD = {
    originX: 6,
    originZ: -16,
    cols: 7,
    rows: 9,
    plotW: 2.9,
    plotD: 2.9,
    gap: 0.35,
    /** Carrots per plot, laid out as a small grid inside the plot. */
    carrotCols: 3,
    carrotRows: 4,
    /** Seconds before a harvested carrot grows back. */
    regrowTime: 9,
};

/** Where each station sits. `r` is the trigger radius / half-extent of its floor marker. */
export const STATIONS = {
    /** Starting cash on the ground — the first thing the player ever picks up. */
    startCash: { x: -6, z: 13, w: 4.4, d: 3.0 },
    /** Drop carrots here to feed the juicer. */
    juicerIn: { x: -6.5, z: 2.2, w: 3.6, d: 3.0 },
    /** The machine body itself (not walkable). */
    juicer: { x: -6.5, z: -1.4 },
    /** Conveyor runs from the juicer westward to the racks. */
    conveyor: { x0: -9.6, x1: -16.4, z: -1.4 },
    /** Pick finished bottles up here. */
    rackPickup: { x: -18.6, z: 1.4, w: 3.4, d: 3.2 },
    /** Bottle racks stand just behind the pickup pad. */
    racks: { x: -18.6, z: -1.4 },
    /**
     * The juice stand sits ON the southern fence line (YARD.maxZ = 22): the
     * counter faces +Z out over the fence, customers queue outside it, and the
     * player serves from behind. Keep these three in sync if the stall moves.
     */
    shop: { x: -17, z: 20.2 },
    /** Player stands here, behind the counter, to serve the queue. */
    shopSell: { x: -17, z: 17.9, w: 4.8, d: 3.0 },
    /** Earned cash drops beside the stand and must be collected on foot. */
    shopPayout: { x: -11.6, z: 17.9, w: 3.4, d: 3.0 },
    /** Upgrade pads. */
    hireFarmer: { x: 1.6, z: -9.0, w: 3.4, d: 3.4 },
    hireSeller: { x: -23.0, z: 5.0, w: 3.4, d: 3.4 },
};

/**
 * The customer queue outside the stand. Shoppers walk in from `spawn`, take the
 * first free slot, and shuffle forward as those ahead are served.
 */
export const QUEUE = {
    x: -17,
    z0: 23.4,
    /**
     * The line runs diagonally *along* the fence rather than straight back from
     * the counter. Straight back puts every shopper's back to the camera, which
     * turns them into featureless blobs; angled, they read in three-quarter view.
     */
    dx: 1.85,
    dz: 0.55,
    slots: 4,
    /** Shoppers walk in from the east... */
    spawnX: 1,
    spawnZ: 27.0,
    /** ...and leave to the west once served, so the two flows never cross. */
    exitX: -32,
    exitZ: 26.5,
    speed: 3.4,
    /** Bottles a single shopper asks for. */
    minOrder: 2,
    maxOrder: 5,
    /** Seconds before a freed slot is refilled by a new arrival. */
    respawnDelay: 1.1,
};

export const PLAYER = {
    startX: -6,
    startZ: 18,
    speed: 9.5,
    turnSpeed: 14,
    radius: 0.7,
    /** How many items the carry stack can hold. */
    capacity: 12,
};

export const ASSISTANT = {
    speed: 6.4,
    capacity: 6,
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
    /** Bottles the racks can hold before the juicer stalls. */
    rackCapacity: 24,
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
