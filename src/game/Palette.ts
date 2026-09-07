/**
 * Flat low-poly colour palette, sampled from the reference art (`farming.png`).
 *
 * Everything in this game is generated procedurally from THREE primitives, so
 * these constants are the *only* place art direction lives — there are no
 * textures and no `res/` image assets to keep in sync.
 */
export const C = {
    // ── Ground ──
    GRASS: 0x7ec13c,
    GRASS_DARK: 0x76b937,
    SOIL: 0x5d3b2b,
    SOIL_LIGHT: 0x744a35,
    PATH_STONE: 0x8d8992,
    PATH_STONE_ALT: 0x9d99a2,

    // ── Wood ──
    WOOD_DARK: 0x6b3f28,
    WOOD: 0x8a5433,
    WOOD_LIGHT: 0xc08a4e,
    WOOD_PALE: 0xd8a869,

    // ── Stone / metal ──
    STONE: 0x7c7883,
    STONE_DARK: 0x5d5a64,
    METAL: 0x9aa0aa,
    METAL_DARK: 0x5a5f68,

    // ── Buildings ──
    WALL_CREAM: 0xe8d5b0,
    WALL_WHITE: 0xf2e8d5,
    ROOF_BROWN: 0x8a4b2a,
    ROOF_BLUE: 0x4a6fa5,
    ROOF_PURPLE: 0x8f6aa8,
    ROOF_TEAL: 0x3f8f86,
    DOOR: 0x5a3520,

    // ── Nature ──
    LEAF: 0x5fa832,
    LEAF_DARK: 0x4b8c28,
    LEAF_LIGHT: 0x86c94a,
    TRUNK: 0x7a4c2e,
    FLOWER_PINK: 0xf58fb4,
    FLOWER_WHITE: 0xfdfbf0,
    WATER: 0x4aa3d8,

    // ── Produce / product ──
    CARROT: 0xf08a2a,
    CARROT_DARK: 0xd8701c,
    JUICE: 0xf59322,
    GLASS: 0xcfe8dc,
    BOTTLE_CAP: 0xe0952e,

    // ── Livestock ──
    COW_BODY: 0xf5f0e6,
    COW_SPOT: 0x4a3b33,
    COW_SNOUT: 0xf0b6b0,

    // ── Character ──
    FUR: 0xf2a5b8,
    FUR_DARK: 0xdd8aa0,
    SNOUT: 0xfad3dc,
    EYE: 0x2a1f1c,
    OVERALL: 0x4d7fc4,
    OVERALL_DARK: 0x3c66a3,
    SKIN_ASSIST: 0xc9e08a,

    // ── Money / UI ──
    MONEY: 0x66c65a,
    MONEY_DARK: 0x3f9e40,
    MONEY_PAPER: 0xf4f7e8,
    MARKER: 0xffffff,
    ARROW: 0x4fc3f7,
} as const;

/** Sky / fog tint — matches the bright open-air feel of the reference. */
export const SKY = 0x9fdcf0;
