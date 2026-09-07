import * as THREE from 'three';

/** Height the debug boxes are drawn at — colliders themselves are 2D. */
const DEBUG_H = 1.8;

interface Box {
    x: number;
    z: number;
    halfW: number;
    halfD: number;
    /** Disabled boxes are skipped by `resolve()` and hidden from the debug view. */
    on: boolean;
}

/**
 * Solid footprints that characters cannot walk through.
 *
 * Everything is an axis-aligned rectangle in world XZ. That's sufficient here
 * because every placeable in the yard is either already axis-aligned or yawed
 * by a multiple of a quarter turn — `resolveShop()` swaps a stall's extents for
 * its fence, so the box stays axis-aligned whichever side it sits on. Rotated
 * hulls would need real OBB separation for no visible gain.
 *
 * Only things inside the fence are registered. The village, trees and cattle
 * are all beyond `YARD`, which the player is clamped to anyway.
 */
export class ObstacleField {
    private _boxes: Box[] = [];

    /**
     * Adds a footprint centred on (x, z). `w`/`d` are full extents.
     * Returns a handle for `update()` — a shop's footprint changes shape when
     * the construction plot becomes a counter.
     */
    add(x: number, z: number, w: number, d: number): number {
        return this._boxes.push({ x, z, halfW: w / 2, halfD: d / 2, on: true }) - 1;
    }

    /**
     * Switches a footprint on or off.
     *
     * Any model whose visibility toggles MUST toggle its box too — an invisible
     * wall you keep walking into is the worst kind of collider bug, and the one
     * hidden signposts used to cause.
     */
    setEnabled(id: number, on: boolean): void {
        const b = this._boxes[id];
        if (b) b.on = on;
    }

    /** Reshapes a previously added footprint in place. */
    update(id: number, x: number, z: number, w: number, d: number): void {
        const b = this._boxes[id];
        if (!b) return;
        b.x = x; b.z = z; b.halfW = w / 2; b.halfD = d / 2;
    }

    /** Adds a footprint spanning a segment along X (a conveyor, a fence run). */
    addSpan(x0: number, x1: number, z: number, d: number): number {
        return this.add((x0 + x1) / 2, z, Math.abs(x1 - x0), d);
    }

    get count(): number { return this._boxes.length; }

    /**
     * Pushes a circle of `radius` out of anything it overlaps, along whichever
     * axis it is least deeply embedded in — the cheap separation that makes
     * sliding along a wall feel right instead of sticking.
     *
     * Runs twice so a character wedged into a corner is resolved against both
     * faces rather than being shoved back into the other one.
     */
    resolve(x: number, z: number, radius: number): { x: number; z: number } {
        let px = x;
        let pz = z;

        for (let pass = 0; pass < 2; pass++) {
            let moved = false;

            for (const b of this._boxes) {
                if (!b.on) continue;
                const dx = px - b.x;
                const dz = pz - b.z;
                const overlapX = b.halfW + radius - Math.abs(dx);
                if (overlapX <= 0) continue;
                const overlapZ = b.halfD + radius - Math.abs(dz);
                if (overlapZ <= 0) continue;

                if (overlapX < overlapZ) {
                    px += dx >= 0 ? overlapX : -overlapX;
                } else {
                    pz += dz >= 0 ? overlapZ : -overlapZ;
                }
                moved = true;
            }

            if (!moved) break;
        }

        return { x: px, z: pz };
    }

    /** True if a point is inside any footprint — used when placing things. */
    contains(x: number, z: number): boolean {
        for (const b of this._boxes) {
            if (!b.on) continue;
            if (Math.abs(x - b.x) <= b.halfW && Math.abs(z - b.z) <= b.halfD) return true;
        }
        return false;
    }

    /**
     * Overlay of every footprint. DEBUG only.
     *
     * Drawn with `depthTest: false` and a high render order so the boxes show
     * *through* the machines they wrap — a collider you can only see when
     * nothing is in front of it is no use for spotting one that's mis-sized.
     */
    debugGroup(): THREE.Group {
        const g = new THREE.Group();

        const fill = new THREE.MeshBasicMaterial({
            color: 0xff2266, transparent: true, opacity: 0.16,
            depthTest: false, depthWrite: false,
        });
        const edge = new THREE.LineBasicMaterial({ color: 0xff5588, depthTest: false });

        for (const b of this._boxes) {
            if (!b.on) continue;
            const geo = new THREE.BoxGeometry(b.halfW * 2, DEBUG_H, b.halfD * 2);

            const solid = new THREE.Mesh(geo, fill);
            solid.position.set(b.x, DEBUG_H / 2, b.z);
            solid.renderOrder = 999;
            g.add(solid);

            const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge);
            wire.position.copy(solid.position);
            wire.renderOrder = 1000;
            g.add(wire);
        }

        g.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
        return g;
    }

}

/**
 * Outline of a rectangle on the ground, for showing the yard clamp line.
 * `inset` is the character radius the clamp already accounts for.
 */
export function debugBounds(
    minX: number, maxX: number, minZ: number, maxZ: number, inset: number, color = 0x33ddff,
): THREE.LineSegments {
    const y = 0.12;
    const x0 = minX + inset, x1 = maxX - inset, z0 = minZ + inset, z1 = maxZ - inset;
    const pts = [
        x0, y, z0, x1, y, z0,
        x1, y, z0, x1, y, z1,
        x1, y, z1, x0, y, z1,
        x0, y, z1, x0, y, z0,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.renderOrder = 1000;
    return line;
}

/** A ring showing one character's collision radius, moved each frame. */
export function debugRadius(radius: number, color = 0xffdd33): THREE.Line {
    const pts: number[] = [];
    const seg = 24;
    for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pts.push(Math.cos(a) * radius, 0.14, Math.sin(a) * radius);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.renderOrder = 1001;
    return line;
}

/** The single field every actor collides against. */
export const obstacles = new ObstacleField();
