import * as THREE from 'three';
import { C } from '../Palette.ts';
import { at, plane } from '../procgen/Primitives.ts';
import { makeFlatIcon, type IconKind } from '../procgen/Icons.ts';

/** Colour the outline and fill snap to while somebody is standing on the pad. */
const HIGHLIGHT = 0xffd83d;
const IDLE = 0xffffff;

export interface ZoneOptions {
    /** Pictogram laid flat on the pad saying what happens here. */
    icon?: IconKind;
    /** Tint of the translucent floor fill. */
    tint?: number;
    /** Show a progress bar along the pad's near edge. */
    showProgress?: boolean;
}

/**
 * A rectangular floor trigger with the outlined ground marker used throughout
 * the reference art. Zones are the game's only interaction verb: stand inside
 * one and something happens.
 *
 * Occupancy is signalled by the marker turning **bright yellow**, not by
 * scaling. A pulsing pad reads as decoration and, worse, the size change makes
 * the trigger boundary look like it's moving when it isn't.
 */
export class Zone {
    readonly name: string;
    readonly x: number;
    readonly z: number;
    readonly halfW: number;
    readonly halfD: number;
    readonly marker: THREE.Group;

    /** Set by the scene each frame; drives the highlight. */
    occupied = false;

    private _fill: THREE.Mesh;
    private _fillMat: THREE.MeshLambertMaterial;
    private _edgeMats: THREE.MeshBasicMaterial[] = [];
    private _progressBar: THREE.Mesh | null = null;
    private _progressWidth = 0;
    private _progress = 0;
    private _glow = 0;
    private _enabled = true;

    constructor(name: string, x: number, z: number, w: number, d: number, opts: ZoneOptions = {}) {
        this.name = name;
        this.x = x;
        this.z = z;
        this.halfW = w / 2;
        this.halfD = d / 2;

        const g = new THREE.Group();

        // Ground decals share one explicit Y ordering so nothing fights or hides
        // anything else:  fill .03 < edges .05 < progress .06/.07 < icon .09,
        // with the travel arrow above all of it at .14 (see Indicators.ts).
        this._fill = plane(w, d, opts.tint ?? IDLE, { opacity: 0.26, flat: false });
        this._fillMat = this._fill.material as THREE.MeshLambertMaterial;
        // Per-zone material: these are tinted individually, so the shared cache
        // in Primitives would have every pad light up at once.
        this._fillMat = this._fillMat.clone();
        this._fill.material = this._fillMat;
        // Lit + shadow-receiving: the character's shadow has to fall ON the pad,
        // otherwise standing on one looks like hovering over it.
        this._fill.receiveShadow = true;
        this._fill.castShadow = false;
        at(this._fill, 0, 0.03, 0);
        g.add(this._fill);

        // Four bars forming the outline. Unlit, so the highlight colour is exact.
        const t = 0.16;
        const edges: Array<[number, number, number, number]> = [
            [w + t, t, 0, d / 2],
            [w + t, t, 0, -d / 2],
            [t, d + t, w / 2, 0],
            [t, d + t, -w / 2, 0],
        ];
        for (const [ew, ed, ex, ez] of edges) {
            const mat = new THREE.MeshBasicMaterial({ color: IDLE });
            const bar = new THREE.Mesh(new THREE.BoxGeometry(ew, 0.07, ed), mat);
            bar.castShadow = false;
            bar.receiveShadow = false;
            this._edgeMats.push(mat);
            g.add(at(bar, ex, 0.05, ez));
        }

        if (opts.icon) {
            const icon = makeFlatIcon(opts.icon);
            // Sits slightly back so the progress bar has the near edge to itself.
            at(icon, 0, 0.09, opts.showProgress ? -0.18 : 0);
            icon.scale.setScalar(Math.min(w, d) * 0.62);
            g.add(icon);
        }

        if (opts.showProgress) {
            this._progressWidth = w * 0.76;
            const trackMesh = plane(this._progressWidth, 0.26, 0x2f2418, { flat: false, opacity: 0.55 });
            trackMesh.material = (trackMesh.material as THREE.MeshLambertMaterial).clone();
            trackMesh.castShadow = false;
            trackMesh.receiveShadow = false;
            at(trackMesh, 0, 0.06, d / 2 - 0.42);
            g.add(trackMesh);

            const barGeo = new THREE.PlaneGeometry(1, 0.2);
            barGeo.rotateX(-Math.PI / 2);
            // Shift the pivot to the left edge so scaling X fills rightward.
            barGeo.translate(0.5, 0, 0);
            this._progressBar = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: HIGHLIGHT }));
            this._progressBar.castShadow = false;
            this._progressBar.receiveShadow = false;
            at(this._progressBar, -this._progressWidth / 2, 0.07, d / 2 - 0.42);
            this._progressBar.scale.x = 0.001;
            g.add(this._progressBar);
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

    distanceTo(px: number, pz: number): number {
        return Math.hypot(px - this.x, pz - this.z);
    }

    setEnabled(on: boolean): void {
        this._enabled = on;
        this.marker.visible = on;
    }

    get enabled(): boolean { return this._enabled; }

    /** 0..1 fill shown along the pad's near edge. Ignored without `showProgress`. */
    setProgress(p: number): void {
        this._progress = Math.max(0, Math.min(1, p));
    }

    update(dt: number): void {
        if (!this._enabled) return;

        // Ease between idle white and the highlight rather than snapping, so a
        // pad clipped in and out of doesn't strobe.
        const target = this.occupied ? 1 : 0;
        this._glow += (target - this._glow) * Math.min(1, dt * 10);

        const color = new THREE.Color(IDLE).lerp(new THREE.Color(HIGHLIGHT), this._glow);
        for (const m of this._edgeMats) m.color.copy(color);
        this._fillMat.color.copy(color);
        this._fillMat.opacity = 0.22 + this._glow * 0.3;

        if (this._progressBar) {
            const w = this._progressWidth * this._progress;
            this._progressBar.visible = this._progress > 0.001;
            this._progressBar.scale.x = Math.max(0.001, w);
        }
    }
}
