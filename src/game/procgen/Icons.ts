import * as THREE from 'three';
import { C } from '../Palette.ts';

/**
 * Flat pictograms that lie on the ground markers.
 *
 * Extruded 2D shapes with unlit materials, the same approach as the navigation
 * arrows: an icon is interface, and a lit one would dim and brighten as the
 * player walks around it. Each builder returns a group lying in the XZ plane,
 * centred on its own origin and roughly one world unit across.
 */

export type IconKind = 'carrot' | 'bottle' | 'money' | 'hire' | 'shop';

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

/** Extrudes a shape and lays it flat, facing up. */
function flat(shape: THREE.Shape, color: number, y: number): THREE.Mesh {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    m.position.y = y;
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
}

export function makeFlatIcon(kind: IconKind): THREE.Group {
    const g = new THREE.Group();
    const base = 0.09;

    switch (kind) {
        case 'carrot': {
            // Tapered root with a leafy crown, matching the crop's real silhouette.
            g.add(flat(poly([[-0.26, 0.1], [0.26, 0.1], [0.05, -0.46], [-0.05, -0.46]]), C.CARROT, base));
            g.add(flat(poly([[-0.3, 0.12], [0.3, 0.12], [0.18, 0.46], [0, 0.24], [-0.18, 0.46]]), C.LEAF, base + 0.01));
            break;
        }
        case 'bottle': {
            g.add(flat(roundRect(0.44, 0.56, 0.1), C.JUICE, base));
            g.add(flat(roundRect(0.18, 0.24, 0.05), C.JUICE, base));
            g.add(flat(roundRect(0.2, 0.12, 0.04), C.BOTTLE_CAP, base + 0.01));
            break;
        }
        case 'money': {
            g.add(flat(roundRect(0.78, 0.46, 0.08), C.MONEY, base));
            g.add(flat(roundRect(0.24, 0.24, 0.06), C.MONEY_PAPER, base + 0.01));
            break;
        }
        case 'hire': {
            // A plus sign — "add a worker".
            g.add(flat(roundRect(0.62, 0.2, 0.06), 0xffffff, base));
            g.add(flat(roundRect(0.2, 0.62, 0.06), 0xffffff, base + 0.005));
            break;
        }
        case 'shop': {
            // Awning over a counter.
            g.add(flat(poly([[-0.42, 0.06], [0.42, 0.06], [0.3, 0.4], [-0.3, 0.4]]), 0xe4574f, base + 0.01));
            g.add(flat(roundRect(0.66, 0.3, 0.05), C.WOOD_PALE, base));
            break;
        }
    }

    // Nudge the sub-shapes into place — ExtrudeGeometry centres nothing for us.
    if (kind === 'bottle') {
        g.children[1].position.z = -0.38;
        g.children[2].position.z = -0.5;
    }
    if (kind === 'shop') g.children[1].position.z = 0.2;

    return g;
}
