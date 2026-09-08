import * as THREE from 'three';
import { C } from '../Palette.ts';
import { at, rot } from '../procgen/Primitives.ts';

/**
 * The two navigation cues from the reference art:
 *
 *  - a flat arrow lying on the grass **beside the character**, pointing the way
 *    to walk (`makeGroundArrow`), and
 *  - a chunky arrow hanging **above the destination** itself
 *    (`makeDropIndicator`).
 *
 * Both are extruded 2D shapes with a slightly larger dark copy behind them, which
 * is how the reference gets its cartoon outline without a shader or a texture.
 */

/**
 * Size of the travel arrow lying beside the player, roughly its length in world
 * units. It shares the grass with 1.7-wide pads and a character under two units
 * tall, so it has to stay well under either to read as a hint rather than as
 * scenery.
 */
const GROUND_ARROW = 1.05;
/** The coloured face as a fraction of the outline behind it — the rim width. */
const ARROW_FACE = 0.877;

/** Arrow outline, pointing +Y in shape space, centred on its own origin. */
function arrowShape(scale: number): THREE.Shape {
    const s = new THREE.Shape();
    const p: Array<[number, number]> = [
        [-0.26, -0.62], [0.26, -0.62], [0.26, -0.06],
        [0.62, -0.06], [0, 0.66], [-0.62, -0.06], [-0.26, -0.06],
    ];
    s.moveTo(p[0][0] * scale, p[0][1] * scale);
    for (let i = 1; i < p.length; i++) s.lineTo(p[i][0] * scale, p[i][1] * scale);
    s.closePath();
    return s;
}

/**
 * `lit` decides which material the arrow gets, and the two cases are genuinely
 * different. The hanging marker must be UNLIT: it stands on edge, so a lit one
 * leaves the faces pointing away from the sun almost black and its brightness
 * would swing as the player moves. The ground arrow lies flat facing the sky,
 * so lighting it costs nothing and lets it receive the character's shadow.
 */
function extrudedArrow(scale: number, depth: number, color: number, lit = false): THREE.Mesh {
    const geo = new THREE.ExtrudeGeometry(arrowShape(scale), { depth, bevelEnabled: false });
    geo.center();
    const material = lit
        ? new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3 })
        : new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = false;
    mesh.receiveShadow = lit;
    return mesh;
}

/**
 * The travel arrow: lies flat on the ground and points along +Z before the
 * holder is yawed. The caller sets `holder.rotation.y` to aim it.
 */
export function makeGroundArrow(): THREE.Group {
    const holder = new THREE.Group();

    const outline = extrudedArrow(GROUND_ARROW, 0.16, 0x1d6b82, true);
    const face = extrudedArrow(GROUND_ARROW * ARROW_FACE, 0.16, C.ARROW, true);

    // Extrude builds the shape in XY pointing +Y; lay it into the XZ plane so it
    // reads as painted on the grass, then aim it down +Z.
    for (const m of [outline, face]) rot(m, Math.PI / 2, 0, 0);
    // Above every pad decal (fill .03, edges .05, progress .07, icon ~.10), so
    // the travel arrow is never buried under a marker it happens to cross.
    at(outline, 0, 0.16, 0);
    at(face, 0, 0.18, 0);

    holder.add(outline, face);
    return holder;
}

/**
 * The destination marker: a downward arrow that floats over the thing the
 * player is being sent to. Bobbing is driven by `updateDropIndicator`.
 */
export function makeDropIndicator(): THREE.Group {
    const holder = new THREE.Group();

    const outline = extrudedArrow(1.55, 0.34, 0x1d6b82);
    const face = extrudedArrow(1.34, 0.36, C.ARROW);

    // Point the arrow at the ground (-Y) and tip it toward the camera slightly,
    // so it reads as a solid block rather than a flat sliver from this angle.
    for (const m of [outline, face]) rot(m, 0, 0, Math.PI);
    at(outline, 0, 0, -0.02);
    at(face, 0, 0, 0.01);

    const tilt = new THREE.Group();
    tilt.add(outline, face);
    rot(tilt, -0.42, 0, 0);
    holder.add(tilt);

    return holder;
}

/** Per-frame bob for a drop indicator placed at `(x, baseY, z)`. */
export function updateDropIndicator(node: THREE.Group, t: number, baseY: number): void {
    node.position.y = baseY + Math.sin(t * 3.2) * 0.22;
}
