import * as THREE from 'three';
import { C } from '../Palette.ts';
import { at, plane } from '../procgen/Primitives.ts';
import { FlatNumber, makeFlatIcon, type IconKind } from '../procgen/Icons.ts';

/** Colour the outline and fill snap to while somebody is standing on the pad. */
const HIGHLIGHT = 0xffd83d;
const IDLE = 0xffffff;
/**
 * Fill of a pad switched to `setSolid` — an open shop, which has no icon left
 * to show. Black rather than a tint so it reads as a hole in the grass.
 */
const SOLID = 0x000000;
/**
 * The progress fill. Deliberately a blue-leaning emerald: the obvious "green"
 * for a fill bar lands right on top of the grass it is drawn over (`C.GRASS` is
 * a yellow-green) and the bar disappears into the lawn.
 */
const PROGRESS = 0x14c274;
/** Money readout, dark on a pale pad and pale on a solid one. */
const AMOUNT_ON_LIGHT = 0x2f2418;
const AMOUNT_ON_SOLID = 0xf4f7e8;

// Prebuilt, because `update()` runs for every pad every frame and building
// Colors there churns two allocations per zone per frame for nothing.
const C_IDLE = new THREE.Color(IDLE);
const C_HIGHLIGHT = new THREE.Color(HIGHLIGHT);
const C_SOLID = new THREE.Color(SOLID);
const C_SCRATCH = new THREE.Color();

export interface ZoneOptions {
    /** Pictogram laid flat on the pad saying what happens here. */
    icon?: IconKind;
    /** Tint of the translucent floor fill. */
    tint?: number;
    /** Fill the pad from one side to the other with `setProgress`. */
    showProgress?: boolean;
    /** Reserve a flat money readout, driven by `setAmount`. */
    showAmount?: boolean;
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
    private _progressSpan = 0;
    private _progress = 0;
    private _icon: THREE.Group | null = null;
    private _amount: FlatNumber | null = null;
    private _amountZ = 0;
    private _solid = false;
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
        // anything else:  fill .03 < progress .04 < edges .05 < icon/amount .09,
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

        // The fill sweeps the whole pad rather than sitting in a thin bar on its
        // near edge, so a pad that is filling is legible from across the yard.
        //
        // It ALWAYS rises from the bottom of the screen, never along the pad's
        // longer axis: `CAMERA.offsetX` is 0 so the view never yaws, which fixes
        // screen-up at world -Z for the whole game. Choosing the axis from the
        // pad's shape instead means authoring a pad wider than it is deep
        // silently turns its fill sideways.
        if (opts.showProgress) {
            this._progressSpan = d;

            const barGeo = new THREE.PlaneGeometry(w, 1);
            barGeo.rotateX(-Math.PI / 2);
            // Pivot on the near (screen-bottom) edge and extend backwards, so
            // scaling Z grows up the screen.
            barGeo.translate(0, 0, -0.5);
            this._progressBar = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({
                color: PROGRESS, transparent: true, opacity: 0.72,
            }));
            this._progressBar.castShadow = false;
            this._progressBar.receiveShadow = false;
            this._progressBar.visible = false;
            at(this._progressBar, 0, 0.04, d / 2);
            g.add(this._progressBar);
        }

        if (opts.icon) {
            const icon = makeFlatIcon(opts.icon);
            // Shifted up-screen when a readout shares the pad, so the two do
            // not stack on top of each other in the middle.
            at(icon, 0, 0.09, opts.showAmount ? -d * 0.17 : 0);
            // multiply, not set: a glyph may carry its own intrinsic scale (the
            // staff busts are drawn smaller than the produce icons), and
            // setScalar here would silently throw that away.
            icon.scale.multiplyScalar(Math.min(w, d) * 0.62);
            this._icon = icon;
            g.add(icon);
        }

        if (opts.showAmount) {
            this._amount = new FlatNumber(4, w * 0.5, AMOUNT_ON_LIGHT);
            // Below the icon when they share the pad; `setIconVisible(false)`
            // hands the middle back, so an open shop's takings sit centred
            // rather than parked low where the awning used to be.
            this._amountZ = opts.icon ? d * 0.26 : 0;
            at(this._amount.group, 0, 0.09, this._amountZ);
            g.add(this._amount.group);
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

    /** 0..1 fill, rising up the pad. Ignored without `showProgress`. */
    setProgress(p: number): void {
        this._progress = Math.max(0, Math.min(1, p));
    }

    /** Money shown flat in the middle of the pad. `null` hides it. */
    setAmount(value: number | null): void {
        this._amount?.setValue(value);
    }

    /** Hides the pictogram, recentring the readout into the space it leaves. */
    setIconVisible(on: boolean): void {
        if (!this._icon) return;
        if (this._icon.visible === on) return;
        this._icon.visible = on;
        if (this._amount) this._amount.group.position.z = on ? this._amountZ : 0;
    }

    /**
     * Switches the floor fill to translucent black — how a shop pad reads once
     * it is open and its icon has been taken away. The readout flips to a pale
     * ink at the same time, since dark-on-dark would vanish.
     */
    setSolid(on: boolean): void {
        if (this._solid === on) return;
        this._solid = on;
        this._amount?.setColor(on ? AMOUNT_ON_SOLID : AMOUNT_ON_LIGHT);
    }

    update(dt: number): void {
        if (!this._enabled) return;

        // Ease between idle white and the highlight rather than snapping, so a
        // pad clipped in and out of doesn't strobe.
        const target = this.occupied ? 1 : 0;
        this._glow += (target - this._glow) * Math.min(1, dt * 10);

        const color = C_SCRATCH.copy(C_IDLE).lerp(C_HIGHLIGHT, this._glow);
        for (const m of this._edgeMats) m.color.copy(color);
        // The outline still lights up on a solid pad; only the floor stays dark,
        // otherwise an open shop gives no feedback for standing on it.
        this._fillMat.color.copy(this._solid ? C_SOLID : color);
        this._fillMat.opacity = this._solid
            ? 0.4 + this._glow * 0.16
            : 0.22 + this._glow * 0.3;

        if (this._progressBar) {
            this._progressBar.visible = this._progress > 0.001;
            this._progressBar.scale.z = Math.max(0.001, this._progressSpan * this._progress);
        }
    }
}
