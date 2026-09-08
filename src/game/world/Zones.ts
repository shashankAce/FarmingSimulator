import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { C } from '../Palette.ts';
import { at, plane, rot } from '../procgen/Primitives.ts';
import { FlatNumber, makeFlatIcon, makeWorldText, type IconKind } from '../procgen/Icons.ts';

/** Colour the outline and fill snap to while somebody is standing on the pad. */
const HIGHLIGHT = 0xffd83d;
const IDLE = 0xffffff;
/**
 * Fill of a pad switched to `setSolid` — an open shop, which has no icon left
 * to show. Black rather than a tint so it reads as a hole in the grass.
 */
const SOLID = 0x000000;
/**
 * Fill and outline of a pad the player cannot yet afford. Grey and inert: it
 * still shows what it is and what it costs, but standing on it does nothing and
 * it does not light up, so there is no invitation to sink money into a purchase
 * that cannot complete.
 */
const LOCKED = C.STONE;
/**
 * The progress fill. Deliberately a blue-leaning emerald: the obvious "green"
 * for a fill bar lands right on top of the grass it is drawn over (`C.GRASS` is
 * a yellow-green) and the bar disappears into the lawn.
 */
const PROGRESS = 0x14c274;
/**
 * Half the readout's own height plus a little air — the minimum gap it keeps
 * from the icon above it and from the pad's own edge.
 */
const AMOUNT_CLEARANCE = 0.3;
/** Where the readout sits by default, as a fraction of the pad's depth. */
const AMOUNT_Z = 0.26;
/**
 * How far up-screen a pictogram is lifted when a readout shares its pad, as a
 * fraction of pad depth. Override per pad with `ZoneOptions.iconZ`.
 */
const ICON_LIFT = 0.17;
/**
 * A notice shown over the pad — "MAXED" and the like. Red rather than the
 * pad's own yellow highlight: yellow on a pale marking over grass is exactly
 * the contrast this needs to not have.
 */
const NOTICE = 0xe4574f;
/**
 * How high the notice floats, and how far it bobs. Well clear of a full pile of
 * takings, whose top layer reaches roughly 0.32 — a notice buried under the
 * cash it is complaining about would be no use at all.
 */
const NOTICE_Y = 1.5;
const NOTICE_BOB = 0.12;

/** Money readout. One colour on every pad, pale or solid. */
const AMOUNT = 0xffffff;
/**
 * Share of the pad's width the readout may use. Was half, which left a 1.7-wide
 * pad showing its price at a third of the height it had room for.
 */
const AMOUNT_FIT = 0.86;
/** Readout on a pad that cannot be afforded yet. */
const AMOUNT_LOCKED = 0x9a96a0;
/** How far the pictogram is washed toward `LOCKED` while the pad is locked. */
const LOCKED_WASH = 0.8;

// Prebuilt, because `update()` runs for every pad every frame and building
// Colors there churns two allocations per zone per frame for nothing.
const C_IDLE = new THREE.Color(IDLE);
const C_HIGHLIGHT = new THREE.Color(HIGHLIGHT);
const C_SOLID = new THREE.Color(SOLID);
const C_LOCKED = new THREE.Color(LOCKED);
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
    /**
     * Where the pictogram sits inside the pad, in world units from its centre.
     * `iconZ` is negative up-screen. Both default to centred, except that a pad
     * with a readout lifts its icon by `ICON_LIFT` to make room — pass
     * `iconZ: 0` to keep a short glyph like the banknote dead centre anyway.
     */
    iconX?: number;
    iconZ?: number;
    /** Word floated over the pad, shown on demand with `setNotice`. */
    notice?: string;
    /**
     * Turns the whole marker — outline, fill, progress, icon and readout — as
     * one piece, the same `rot(g, 0, yaw, 0)` the stall itself gets, so a pad
     * belonging to a stall squares up with the counter it serves instead of
     * with the world axes. Defaults to 0, which is what a free-standing pad on
     * open grass wants.
     *
     * With a yaw, `w` and `d` are read in the pad's OWN frame: `w` runs along
     * its face and `d` is its depth. Pass the stall's `place.yaw`.
     */
    yaw?: number;
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
    /** One material for the whole border — every side shows the same colour. */
    private _edgeMat!: THREE.MeshBasicMaterial;
    private _progressBar: THREE.Mesh | null = null;
    private _progressSpan = 0;
    private _progress = 0;
    private _icon: THREE.Group | null = null;
    private _amount: FlatNumber | null = null;
    private _notice: THREE.Group | null = null;
    /** Pictogram materials and their real tints, so locking can wash them out. */
    private _iconMats: Array<{ m: THREE.MeshLambertMaterial; base: THREE.Color }> = [];
    private _noticeT = 0;
    private _amountZ = 0;
    private _solid = false;
    private _locked = false;
    private _glow = 0;
    private _enabled = true;
    /** Cached rotation, for the oriented containment test. */
    private _cos = 1;
    private _sin = 0;

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
        // One mesh for the whole border, not one per side.
        //
        // The four sides are always given the SAME colour (see `update`), so as
        // four meshes with four materials they were four draw calls and four
        // geometries doing one job — times every pad in the yard, which is the
        // largest single count of anything left in the scene.
        //
        // Merged by translating each side's box into place and concatenating,
        // which is the same trick `world/MergeStatic.ts` plays on the scenery.
        this._edgeMat = new THREE.MeshBasicMaterial({ color: IDLE });
        const sides = edges.map(([ew, ed, ex, ez]) =>
            new THREE.BoxGeometry(ew, 0.07, ed).translate(ex, 0.05, ez));
        const border = mergeGeometries(sides);
        if (border) {
            for (const side of sides) side.dispose();
            const bars = new THREE.Mesh(border, this._edgeMat);
            bars.castShadow = false;
            bars.receiveShadow = false;
            g.add(bars);
        } else {
            // Merge refused (it logs why): four meshes again, but still sharing
            // the one material, so the colour animation is unchanged either way.
            for (const side of sides) {
                const bar = new THREE.Mesh(side, this._edgeMat);
                bar.castShadow = false;
                bar.receiveShadow = false;
                g.add(bar);
            }
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
            at(icon, opts.iconX ?? 0, 0.09,
                opts.iconZ ?? (opts.showAmount ? -d * ICON_LIFT : 0));
            // multiply, not set: a glyph may carry its own intrinsic scale (the
            // staff busts are drawn smaller than the produce icons), and
            // setScalar here would silently throw that away.
            icon.scale.multiplyScalar(Math.min(w, d) * 0.62);
            this._icon = icon;
            icon.traverse(o => {
                const mesh = o as THREE.Mesh;
                if (!mesh.isMesh) return;
                const m = mesh.material as THREE.MeshLambertMaterial;
                this._iconMats.push({ m, base: m.color.clone() });
            });
            g.add(icon);
        }

        if (opts.showAmount) {
            this._amount = new FlatNumber(4, w * AMOUNT_FIT, AMOUNT);
            // Nominally a fixed fraction down the pad, but pushed further if the
            // icon actually reaches that far. Glyphs differ wildly in height —
            // the banknote is a third the depth of a bust, and a centred one
            // hangs lower than a lifted one — so the collision is MEASURED
            // rather than guessed at, then clamped inside the pad.
            //
            // Safe to measure here: `Box3.expandByObject` refreshes world
            // matrices as it walks down, and the marker group is still at the
            // origin, so the numbers come back in pad-local space.
            const clear = this._icon
                ? new THREE.Box3().setFromObject(this._icon).max.z + AMOUNT_CLEARANCE
                : 0;
            this._amountZ = Math.min(Math.max(clear, d * AMOUNT_Z), d / 2 - AMOUNT_CLEARANCE);
            at(this._amount.group, 0, 0.09, this._amountZ);
            g.add(this._amount.group);
        }

        const yaw = opts.yaw ?? 0;
        this._cos = Math.cos(yaw);
        this._sin = Math.sin(yaw);

        if (opts.notice) {
            const notice = makeWorldText(opts.notice, Math.min(w, d) * 0.4, NOTICE);
            // Counter-rotated out of the pad's own turn. Everything else on a
            // pad squares up with the counter it serves; a word squares up with
            // the reader.
            notice.rotation.y = -yaw;
            notice.visible = false;
            this._notice = notice;
            g.add(at(notice, 0, NOTICE_Y, 0));
        }
        // Rotate BEFORE positioning, and not a moment earlier: the readout
        // above measures the icon's bounds in this group's local frame, which a
        // rotation already applied would have thrown off.
        at(rot(g, 0, yaw, 0), x, 0, z);
        this.marker = g;
        // Named for the debug census: pads are added straight to the scene, so
        // without this a dozen of them show up as a dozen anonymous "Group"s.
        this.marker.name = `zone:${name}`;
    }

    /**
     * Containment test in the pad's own frame — the trigger has to turn with
     * the markings, or a rotated pad catches the player somewhere other than
     * where it is painted. Reduces to the axis-aligned test at yaw 0.
     */
    contains(px: number, pz: number): boolean {
        if (!this._enabled) return false;
        const dx = px - this.x;
        const dz = pz - this.z;
        const lx = this._cos * dx - this._sin * dz;
        const lz = this._sin * dx + this._cos * dz;
        return Math.abs(lx) <= this.halfW && Math.abs(lz) <= this.halfD;
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

    /** Shows or hides the word this pad was built with. */
    setNotice(on: boolean): void {
        if (this._notice) this._notice.visible = on;
    }

    /**
     * Greys the pad out and stops it lighting up. See `LOCKED`.
     *
     * Washes the pictogram and the price as well as the outline and floor.
     * Greying only the markings was not enough: the icon kept its full colours
     * and the price stayed white, which are the two brightest things on the
     * pad, so an unaffordable one still read as live from any distance and only
     * gave itself away up close by refusing to light up.
     */
    setLocked(on: boolean): void {
        if (this._locked === on) return;
        this._locked = on;

        for (const { m, base } of this._iconMats) {
            m.color.copy(base);
            if (on) m.color.lerp(C_LOCKED, LOCKED_WASH);
            m.emissive.copy(m.color);
        }
        this._amount?.setColor(on ? AMOUNT_LOCKED : AMOUNT);
    }

    /** True while the pad is showing as unaffordable. */
    get locked(): boolean { return this._locked; }

    /**
     * Switches the floor fill to translucent black — how a shop pad reads once
     * it is open and its icon has been taken away.
     */
    setSolid(on: boolean): void {
        this._solid = on;
    }

    update(dt: number): void {
        if (!this._enabled) return;

        // Ease between idle white and the highlight rather than snapping, so a
        // pad clipped in and out of doesn't strobe. A locked pad never lights
        // up — the glow is the thing that says "this is doing something".
        const target = this.occupied && !this._locked ? 1 : 0;
        this._glow += (target - this._glow) * Math.min(1, dt * 10);

        const color = C_SCRATCH.copy(this._locked ? C_LOCKED : C_IDLE)
            .lerp(C_HIGHLIGHT, this._glow);
        this._edgeMat.color.copy(color);
        // The outline still lights up on a solid pad; only the floor stays dark,
        // otherwise an open shop gives no feedback for standing on it.
        this._fillMat.color.copy(this._solid ? C_SOLID : color);
        this._fillMat.opacity = this._solid
            ? 0.4 + this._glow * 0.16
            : 0.22 + this._glow * 0.3;

        if (this._notice?.visible) {
            // Bobbing, like the destination marker — a floating sign that hangs
            // dead still reads as part of the scenery.
            this._noticeT += dt;
            this._notice.position.y = NOTICE_Y + Math.sin(this._noticeT * 3.2) * NOTICE_BOB;
        }

        if (this._progressBar) {
            this._progressBar.visible = this._progress > 0.001;
            this._progressBar.scale.z = Math.max(0.001, this._progressSpan * this._progress);
        }
    }
}
