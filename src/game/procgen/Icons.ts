import * as THREE from 'three';
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
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
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
        g.add(put(flat(roundRect(0.12, earH, 0.06), col.fur, base + 0.004),
            side * earX, 0.14 + earH / 2, side * -0.34));
    }
    g.add(put(flat(roundRect(0.46, 0.4, 0.17), col.fur, base + 0.008), 0, 0.04));
    // A muzzle and two eyes. Tiny, but without them the head is just a blob —
    // this is the difference between "a worker" and "a rounded rectangle".
    g.add(put(flat(roundRect(0.17, 0.11, 0.055), col.snout, base + 0.012), 0, -0.05));
    for (const side of [-1, 1]) {
        g.add(put(flat(roundRect(0.075, 0.095, 0.037), C.EYE, base + 0.016),
            side * 0.105, 0.06));
    }
}

export function makeFlatIcon(kind: IconKind): THREE.Group {
    const g = new THREE.Group();
    // Sub-millimetre stacking only; the pad supplies the real height.
    const base = 0.004;

    switch (kind) {
        case 'carrot': {
            // Tapered root with a leafy crown, matching the crop's real silhouette.
            g.add(flat(poly([[-0.26, 0.1], [0.26, 0.1], [0.05, -0.46], [-0.05, -0.46]]), C.CARROT, base));
            g.add(flat(poly([[-0.3, 0.12], [0.3, 0.12], [0.18, 0.46], [0, 0.24], [-0.18, 0.46]]), C.LEAF, base + 0.008));
            break;
        }
        case 'bottle': {
            g.add(flat(roundRect(0.44, 0.56, 0.1), C.JUICE, base));
            g.add(put(flat(roundRect(0.18, 0.24, 0.05), C.JUICE, base), 0, 0.38));
            g.add(put(flat(roundRect(0.2, 0.12, 0.04), C.BOTTLE_CAP, base + 0.008), 0, 0.5));
            break;
        }
        case 'money': {
            g.add(flat(roundRect(0.78, 0.46, 0.08), C.MONEY, base));
            g.add(flat(roundRect(0.24, 0.24, 0.06), C.MONEY_PAPER, base + 0.008));
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
            g.add(put(flat(roundRect(0.84, 0.15, 0.045), STRAW, base + 0.024), 0, 0.23));
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
            g.add(put(flat(roundRect(0.86, 0.075, 0.037), AWNING_TRIM, base + 0.024), 0, 0.395));
            g.scale.setScalar(BUST_SCALE);
            break;
        }
        case 'shop': {
            // Awning over a counter.
            g.add(flat(poly([[-0.42, 0.06], [0.42, 0.06], [0.3, 0.4], [-0.3, 0.4]]), AWNING, base + 0.008));
            g.add(put(flat(roundRect(0.66, 0.3, 0.05), C.WOOD_PALE, base), 0, -0.2));
            break;
        }
    }

    return g;
}
