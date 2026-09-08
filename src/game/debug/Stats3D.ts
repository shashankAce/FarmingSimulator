import * as THREE from 'three';
import { DEBUG, PerfStats } from 'noonengine';

/**
 * The slice of a renderer this panel reads.
 *
 * Structural rather than `THREE.WebGLRenderer`, because the engine's
 * `onRendererReady` hands over `WebGLRenderer | WebGPURenderer` and both report
 * these. `programs` is optional: only the WebGL backend compiles them.
 */
interface StatsRenderer {
    info: {
        render: { calls: number; triangles: number };
        memory: { geometries: number; textures: number };
        programs?: { length: number } | null;
    };
}

/** Seconds between refreshes. Frames are counted every one; only the text waits. */
const REFRESH = 0.25;

/** Compact large counts — 38200 triangles is noise, 38.2k is a number. */
function short(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
}

/**
 * Top-left readout of what the 3D pass actually costs.
 *
 * The engine's own `showStats` box (bottom-left, `#fps`) reports the 2D
 * pipeline: `PerfStats.drawCalls` counts batches the 2D backends issue, which
 * is everything EXCEPT the Three.js pass — and this game is almost entirely
 * that pass, so that box reads near-zero no matter what the scene costs. These
 * numbers come from `renderer.info` instead, which is Three.js's own count.
 *
 * DOM rather than engine `Label`s, deliberately, for two reasons that both
 * matter for a panel you optimise against: an in-canvas overlay would add its
 * own draw calls to the very counter it reports, and a `Label` re-bakes a text
 * bitmap every time its text changes — a per-frame cost attributable to the
 * measuring, not the game. This costs the render pipeline nothing.
 *
 * Self-gates on `DEBUG`, like `initScreenLogger`, so the call sites can stay in
 * shipped code: in a production build the whole body drops out.
 */
export class Stats3D {
    private _el: HTMLDivElement | null = null;
    private _renderer: StatsRenderer;
    private _scene: THREE.Scene;

    /** Accumulated over the current refresh window. */
    private _elapsed = 0;
    private _frames = 0;
    /** Worst single frame in the window — an average hides exactly the hitches. */
    private _worst = 0;

    constructor(renderer: StatsRenderer, scene: THREE.Scene) {
        this._renderer = renderer;
        this._scene = scene;
        if (!DEBUG) return;

        const el = document.createElement('div');
        el.id = 'stats3d';
        // `pointer-events: none` so it can never eat a tap meant for the
        // joystick underneath it; `white-space: pre` so the lines stay aligned
        // without a table.
        el.style.cssText = [
            'position:fixed', 'left:8px', 'top:8px', 'z-index:10000',
            'padding:6px 9px', 'border-radius:5px',
            'background:rgba(0,0,0,0.62)', 'color:#c8f5d0',
            'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
            'white-space:pre', 'pointer-events:none', 'user-select:none',
        ].join(';');
        document.body.appendChild(el);
        this._el = el;
    }

    /** Shows/hides the panel. Wired to a key, so it can be got out of the way. */
    toggle(): void {
        if (this._el) this._el.style.display = this._el.style.display === 'none' ? 'block' : 'none';
    }

    /** Call once per frame with the REAL frame delta, not a clamped step. */
    update(dt: number): void {
        if (!this._el) return;

        this._elapsed += dt;
        this._frames++;
        this._worst = Math.max(this._worst, dt);
        if (this._elapsed < REFRESH) return;

        const fps = this._frames / this._elapsed;
        const avgMs = (this._elapsed / this._frames) * 1000;

        // `renderer.info.render` is reset at the top of each `render()` call, and
        // this runs during scene update — so these are last frame's numbers, not
        // a partial count of the frame in progress.
        const info = this._renderer.info;
        let objects = 0;
        let meshes = 0;
        this._scene.traverse(o => {
            objects++;
            if ((o as THREE.Mesh).isMesh) meshes++;
        });

        this._el.textContent = [
            `fps  ${fps.toFixed(0).padStart(3)}   ${avgMs.toFixed(1)}ms  peak ${(this._worst * 1000).toFixed(1)}ms`,
            `3D   ${String(info.render.calls).padStart(3)} calls  ${short(info.render.triangles)} tris`,
            `mem  ${info.memory.geometries} geom  ${info.memory.textures} tex  ${info.programs?.length ?? 0} prog`,
            `tree ${short(objects)} objects  ${short(meshes)} meshes`,
            `2D   ${String(PerfStats.drawCalls).padStart(3)} calls`,
        ].join('\n');

        this._elapsed = 0;
        this._frames = 0;
        this._worst = 0;
    }

    /** Takes the panel back out of the page. */
    destroy(): void {
        this._el?.remove();
        this._el = null;
    }
}
