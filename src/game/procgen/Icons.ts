import * as THREE from 'three';
import { FONT_FAMILY } from '../Config.ts';
import { C } from '../Palette.ts';
import { FARMER_COLORS, SELLER_COLORS, type CharacterColors } from './Character.ts';

/**
 * Flat pictograms that lie on the ground markers.
 *
 * Extruded 2D shapes with unlit materials, the same approach as the navigation
 * arrows: an icon is interface, and a lit one would dim and brighten as the
 * player walks around it. Each builder returns a group lying in the XZ plane,
 * centred on its own origin and roughly one world unit across.
 */

export type IconKind = 'carrot' | 'bottle' | 'money' | 'farmhand' | 'shopkeeper' | 'shop';

/**
 * The staff glyphs are drawn a shade smaller than the rest.
 *
 * `Zone` scales every icon to `min(w, d) * 0.62`, which suits a carrot or a
 * banknote but crowds the 1.7 hire pad once a whole bust is in it — the ears
 * and the hem end up against the outline bars. Applied to the group, so it
 * holds at any pad size.
 */
const BUST_SCALE = 0.7;

/**
 * Extrusion depth. These are decals painted on the ground, not objects sitting
 * on it, so they get just enough thickness to keep their faces off the pad and
 * out of a z-fight — any more and the side walls show as a lip at this camera
 * angle.
 */
const THICKNESS = 0.012;
/** One stacking step between overlapping pieces of the same icon. */
const LAYER = 0.003;

const STRAW = 0xf2c94c;
const STRAW_DARK = 0xd9a935;
const AWNING = 0xe4574f;
const AWNING_TRIM = 0xf7efe0;

function poly(points: Array<[number, number]>): THREE.Shape {
    const s = new THREE.Shape();
    s.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
    s.closePath();
    return s;
}

function disc(r: number): THREE.Shape {
    const s = new THREE.Shape();
    s.absarc(0, 0, r, 0, Math.PI * 2, false);
    return s;
}

function roundRect(w: number, h: number, r: number): THREE.Shape {
    const s = new THREE.Shape();
    const x = w / 2, y = h / 2;
    s.moveTo(-x + r, -y);
    s.lineTo(x - r, -y);
    s.quadraticCurveTo(x, -y, x, -y + r);
    s.lineTo(x, y - r);
    s.quadraticCurveTo(x, y, x - r, y);
    s.lineTo(-x + r, y);
    s.quadraticCurveTo(-x, y, -x, y - r);
    s.lineTo(-x, -y + r);
    s.quadraticCurveTo(-x, -y, -x + r, -y);
    return s;
}

/**
 * Extrudes a shape and lays it flat, facing up.
 *
 * Lit (not `MeshBasicMaterial`) so the icon can RECEIVE shadows — a character
 * standing on a pad has to cast onto its markings, or they read as hovering
 * above the ground rather than painted on it. Safe to light here, unlike the
 * navigation arrows: these lie flat with their faces pointing at the sky, so
 * they never fall into shadow just from turning.
 *
 * `y` is a within-icon stacking offset only, kept tiny — the pad positions the
 * whole group, and adding a second full offset here is what lifted them off
 * the ground in the first place.
 */
function flat(shape: THREE.Shape, color: number, y: number): THREE.Mesh {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: THICKNESS, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        color, emissive: color, emissiveIntensity: 0.35,
    }));
    m.position.y = y;
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
}

/**
 * Moves a flattened piece around in icon space, where +y is *up on screen*.
 *
 * `flat()` maps the shape's +y onto -z, and `ExtrudeGeometry` centres nothing,
 * so a sub-shape is either drawn at its final coordinates (fine for a one-off
 * outline) or built at the origin and placed here — which is the only option
 * for the reusable rounded rect, and the only way to rotate one.
 */
function put(mesh: THREE.Mesh, x: number, y: number, rot = 0): THREE.Mesh {
    mesh.position.x = x;
    mesh.position.z = -y;
    mesh.rotation.y = rot;
    return mesh;
}

/**
 * Head, ears and shoulders of one hire, in that hire's own colours.
 *
 * Both staff pads draw the character you are actually buying instead of an
 * abstract "+", so the bunny who walks off the pad is the one pictured on it
 * and the two hires are told apart by fur and outfit before the price label is
 * read at all. `earX`/`earH` set how far the ears clear the headwear stacked
 * above them — a straw hat and an awning need very different room.
 *
 * The bust grows UPWARD from a fixed -0.46 chin-to-hem: the pad's progress bar
 * owns the near edge, and anything below that line slides under it. There is
 * spare room the other way, so tall headwear is free.
 */
function addBust(g: THREE.Group, col: CharacterColors, base: number,
                 earX: number, earH: number): void {
    // Shoulders first: the head is drawn over their top edge, so the bust reads
    // as one body rather than a head parked above a trapezoid.
    g.add(flat(poly([[-0.36, -0.46], [0.36, -0.46], [0.26, -0.12], [-0.26, -0.12]]),
        col.outfit, base));
    // Ears rise from inside the skull so their roots are never a visible seam.
    for (const side of [-1, 1]) {
        g.add(put(flat(roundRect(0.12, earH, 0.06), col.fur, base + 1 * LAYER),
            side * earX, 0.14 + earH / 2, side * -0.34));
    }
    g.add(put(flat(roundRect(0.46, 0.4, 0.17), col.fur, base + 2 * LAYER), 0, 0.04));
    // A muzzle and two eyes. Tiny, but without them the head is just a blob —
    // this is the difference between "a worker" and "a rounded rectangle".
    g.add(put(flat(roundRect(0.17, 0.11, 0.055), col.snout, base + 3 * LAYER), 0, -0.05));
    for (const side of [-1, 1]) {
        g.add(put(flat(roundRect(0.075, 0.095, 0.037), C.EYE, base + 4 * LAYER),
            side * 0.105, 0.06));
    }
}

export function makeFlatIcon(kind: IconKind): THREE.Group {
    const g = new THREE.Group();
    // Sub-millimetre stacking only; the pad supplies the real height.
    const base = LAYER;

    switch (kind) {
        case 'carrot': {
            // Tapered root with a leafy crown, matching the crop's real silhouette.
            g.add(flat(poly([[-0.26, 0.1], [0.26, 0.1], [0.05, -0.46], [-0.05, -0.46]]), C.CARROT, base));
            g.add(flat(poly([[-0.3, 0.12], [0.3, 0.12], [0.18, 0.46], [0, 0.24], [-0.18, 0.46]]), C.LEAF, base + 2 * LAYER));
            break;
        }
        case 'bottle': {
            // A side elevation of `makeBottle`, at that model's own proportions
            // scaled to one unit tall. The old glyph was a plain orange body
            // with a straight orange neck: it had neither the pale glass collar
            // nor the taper, so the icon and the thing it stands for did not
            // look like the same bottle.
            g.add(put(flat(roundRect(0.42, 0.57, 0.09), C.JUICE, base), 0, -0.214));
            g.add(put(flat(roundRect(0.44, 0.13, 0.05), C.GLASS, base + LAYER), 0, 0.121));
            // Tapered neck, drawn where it actually sits: rising out of the
            // collar, which stays visible as a lip either side of it.
            g.add(flat(poly([
                [-0.17, 0.158], [0.17, 0.158], [0.11, 0.406], [-0.11, 0.406],
            ]), C.GLASS, base + 2 * LAYER));
            g.add(put(flat(roundRect(0.25, 0.11, 0.04), C.BOTTLE_CAP, base + 3 * LAYER), 0, 0.444));
            break;
        }
        case 'money': {
            // A banknote with a coin resting on it. The old glyph was one green
            // rectangle with a pale square in the middle, which at pad size read
            // as a button rather than as money — the note needs its printed
            // border, and the coin is what makes the subject unmistakable.
            const note: Array<[number, number]> = [[-0.06, 0.06]];
            g.add(put(flat(roundRect(0.82, 0.46, 0.08), C.MONEY, base), ...note[0]));
            g.add(put(flat(roundRect(0.7, 0.34, 0.05), C.MONEY_DARK, base + LAYER), ...note[0]));
            g.add(put(flat(roundRect(0.64, 0.28, 0.04), C.MONEY, base + 2 * LAYER), ...note[0]));
            g.add(put(flat(disc(0.1), C.MONEY_PAPER, base + 3 * LAYER), ...note[0]));
            g.add(put(flat(disc(0.2), STRAW_DARK, base + 4 * LAYER), 0.28, -0.18));
            g.add(put(flat(disc(0.145), STRAW, base + 5 * LAYER), 0.28, -0.18));
            break;
        }
        case 'farmhand': {
            // A bunny in a straw sun hat. The ears sit wide enough to flank the
            // crown, which is what keeps the silhouette reading as a rabbit
            // rather than as a mushroom.
            addBust(g, FARMER_COLORS, base, 0.25, 0.42);
            g.add(put(flat(roundRect(0.36, 0.2, 0.09), STRAW_DARK, base + 0.02), 0, 0.35));
            // Squarer corners than the crown: at full radius the brim turns into
            // a lozenge floating over the head instead of a flat hat.
            g.add(put(flat(roundRect(0.84, 0.15, 0.045), STRAW, base + 6 * LAYER), 0, 0.23));
            g.scale.setScalar(BUST_SCALE);
            break;
        }
        case 'shopkeeper': {
            // The same bunny under a stall awning, in the seller's colours — the
            // awning is the shop pad's own glyph, so the pair read as a set.
            addBust(g, SELLER_COLORS, base, 0.19, 0.26);
            // Kept narrower than the shoulders below it — a canopy spanning the
            // full pad reads as a separate object parked above the bunny.
            g.add(flat(poly([[-0.4, 0.4], [0.4, 0.4], [0.3, 0.55], [-0.3, 0.55]]),
                AWNING, base + 0.02));
            g.add(put(flat(roundRect(0.86, 0.075, 0.037), AWNING_TRIM, base + 6 * LAYER), 0, 0.395));
            g.scale.setScalar(BUST_SCALE);
            break;
        }
        case 'shop': {
            // Awning over a counter.
            g.add(flat(poly([[-0.42, 0.06], [0.42, 0.06], [0.3, 0.4], [-0.3, 0.4]]), AWNING, base + 2 * LAYER));
            g.add(put(flat(roundRect(0.66, 0.3, 0.05), C.WOOD_PALE, base), 0, -0.2));
            break;
        }
    }

    return g;
}

/**
 * Digits painted flat on the ground pads, in the game's own typeface.
 *
 * Not extruded outlines like the pictograms above: that needs a font parser,
 * and neither route works here — three's `FontLoader` wants a typeface.json
 * rather than the .ttf this game ships, and `TTFLoader` would have to fetch
 * `res/` directly, which a single-file playable cannot resolve (see Rule 0).
 * The ten digits are therefore drawn ONCE into an offscreen canvas, and every
 * digit on every pad is a quad picking its own cell out of that one texture.
 * Nothing is uploaded again afterwards, however fast a price counts down.
 *
 * The canvas is generated in memory, so it is not a `res/` asset and does not
 * go near `AssetCache`; the FONT it is drawn with does, and is awaited before
 * the scene is built (see `src/index.ts`). Build this any earlier and the
 * browser bakes its fallback face into the atlas permanently.
 */
const ATLAS_CELL = 128;
const ATLAS_HEIGHT = 160;

let digitAtlas: THREE.CanvasTexture | null = null;

function digitTexture(): THREE.CanvasTexture {
    if (digitAtlas) return digitAtlas;

    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_CELL * 10;
    canvas.height = ATLAS_HEIGHT;

    const ctx = canvas.getContext('2d')!;
    // Drawn white so each readout's own material colour tints it — the same
    // atlas serves the dark digits on a pale pad and the pale ones on a solid.
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(ATLAS_HEIGHT * 0.76)}px "${FONT_FAMILY}"`;
    for (let d = 0; d < 10; d++) {
        ctx.fillText(String(d), ATLAS_CELL * (d + 0.5), ATLAS_HEIGHT * 0.54);
    }

    digitAtlas = new THREE.CanvasTexture(canvas);
    digitAtlas.colorSpace = THREE.SRGBColorSpace;
    digitAtlas.anisotropy = 4;
    return digitAtlas;
}

/** World height of one digit, and the cell width that follows from the atlas. */
const DIGIT_H = 0.86;
const DIGIT_W = DIGIT_H * (ATLAS_CELL / ATLAS_HEIGHT);
/** Advance between digits. Tighter than the cell, since the cell has side bearing. */
const DIGIT_PITCH = DIGIT_W * 0.82;

/**
 * A number lying flat on the ground, sized to fit a given width.
 *
 * Every cell is built once up front and then re-pointed at a different slice of
 * the atlas, so changing the value allocates nothing — these tick every frame
 * while a pad is being paid off.
 */
export class FlatNumber {
    readonly group = new THREE.Group();

    private _cells: THREE.Mesh[] = [];
    private _mat: THREE.MeshLambertMaterial;
    private _fitWidth: number;
    private _shown = -1;

    constructor(maxDigits: number, fitWidth: number, color: number) {
        this._fitWidth = fitWidth;
        this._mat = new THREE.MeshLambertMaterial({
            map: digitTexture(),
            transparent: true,
            // Cuts the glyph out rather than blending it, which keeps the edges
            // crisp and keeps these decals out of the transparent sort order.
            alphaTest: 0.35,
            color, emissive: color, emissiveIntensity: 0.35,
        });

        for (let i = 0; i < maxDigits; i++) {
            // Own geometry per cell: the UVs are what select the digit, so these
            // cannot share one.
            const geo = new THREE.PlaneGeometry(DIGIT_W, DIGIT_H);
            geo.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geo, this._mat);
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            mesh.visible = false;
            this._cells.push(mesh);
            this.group.add(mesh);
        }
        this.group.visible = false;
    }

    /** Repaints every digit — the readout has to stay legible on a dark pad. */
    setColor(color: number): void {
        this._mat.color.setHex(color);
        this._mat.emissive.setHex(color);
    }

    /** `null` hides the readout. Values are floored and clamped to the cell count. */
    setValue(value: number | null): void {
        if (value === null) {
            this.group.visible = false;
            this._shown = -1;
            return;
        }

        const max = 10 ** this._cells.length - 1;
        const n = Math.max(0, Math.min(max, Math.floor(value)));
        this.group.visible = true;
        if (n === this._shown) return;
        this._shown = n;

        const text = String(n);
        const used = text.length;
        for (let i = 0; i < this._cells.length; i++) {
            const cell = this._cells[i];
            cell.visible = i < used;
            if (i >= used) continue;
            // Centre the digits actually in use, so a number does not drift
            // sideways as it counts down through a digit.
            cell.position.x = (i - (used - 1) / 2) * DIGIT_PITCH;
            this._pointAt(cell, text.charCodeAt(i) - 48);
        }

        const width = used * DIGIT_PITCH - (DIGIT_PITCH - DIGIT_W);
        this.group.scale.setScalar(Math.min(1, this._fitWidth / width));
    }

    /** Slides this cell's UVs onto digit `d`'s column of the atlas. */
    private _pointAt(mesh: THREE.Mesh, d: number): void {
        const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
        const u0 = d / 10;
        const u1 = (d + 1) / 10;
        uv.setXY(0, u0, 1);
        uv.setXY(1, u1, 1);
        uv.setXY(2, u0, 0);
        uv.setXY(3, u1, 0);
        uv.needsUpdate = true;
    }
}
