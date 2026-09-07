import * as THREE from 'three';
import { C } from '../Palette.ts';
import { at, box, plane } from '../procgen/Primitives.ts';

/**
 * A rectangular floor trigger with the white-outlined ground marker used
 * throughout the reference art. Zones are the game's only interaction verb:
 * stand inside one and something happens, on a fixed tick.
 */
export class Zone {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly halfW: number;
    readonly halfD: number;
    readonly marker: THREE.Group;

    /** Set by the scene each frame; drives the marker's pulse and any HUD prompt. */
    occupied = false;

    private _fill: THREE.Mesh;
    private _t = 0;
    private _enabled = true;

    constructor(name: string, x: number, z: number, w: number, d: number, tint: number = C.MARKER) {
        this.name = name;
        this.x = x;
        this.z = z;
        this.halfW = w / 2;
        this.halfD = d / 2;

        const g = new THREE.Group();

        // Translucent fill, lifted just off the ground to avoid z-fighting.
        this._fill = plane(w, d, tint, { opacity: 0.26, flat: false });
        this._fill.receiveShadow = false;
        this._fill.castShadow = false;
        at(this._fill, 0, 0.04, 0);
        g.add(this._fill);

        // Four bars forming the outline.
        const t = 0.16;
        const edges: Array<[number, number, number, number]> = [
            [w + t, t, 0, d / 2],
            [w + t, t, 0, -d / 2],
            [t, d + t, w / 2, 0],
            [t, d + t, -w / 2, 0],
        ];
        for (const [ew, ed, ex, ez] of edges) {
            const bar = box(ew, 0.06, ed, C.MARKER, { flat: false });
            bar.castShadow = false;
            bar.receiveShadow = false;
            g.add(at(bar, ex, 0.06, ez));
        }

        at(g, x, 0, z);
        this.marker = g;
    }

    /** Axis-aligned containment test in world XZ. */
    contains(px: number, pz: number): boolean {
        return this._enabled
            && Math.abs(px - this.x) <= this.halfW
            && Math.abs(pz - this.z) <= this.halfD;
    }

    /** Distance from a point to the zone centre, for "nearest objective" pointing. */
    distanceTo(px: number, pz: number): number {
        return Math.hypot(px - this.x, pz - this.z);
    }

    setEnabled(on: boolean): void {
        this._enabled = on;
        this.marker.visible = on;
    }

    get enabled(): boolean { return this._enabled; }

    /** Gentle breathing pulse, stronger while the player is standing in it. */
    update(dt: number): void {
        if (!this._enabled) return;
        this._t += dt;
        const amp = this.occupied ? 0.16 : 0.06;
        const s = 1 + Math.sin(this._t * (this.occupied ? 6 : 2.2)) * amp;
        this._fill.scale.set(s, 1, s);
        (this._fill.material as THREE.MeshLambertMaterial).opacity =
            this.occupied ? 0.42 : 0.24;
    }
}
