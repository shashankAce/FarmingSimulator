import * as THREE from 'three';
import { Node, Scene } from 'noonengine';
import { InstancedMesh3D } from 'noonengine/3d';
import { FIELD } from '../Config.ts';
import { C } from '../Palette.ts';
import { at, box, makeRng, rangeOf } from '../procgen/Primitives.ts';
import { carrotLeafGeometry, carrotMaterial, carrotRootGeometry, leafMaterial } from '../procgen/Machines.ts';

interface CarrotSlot {
    x: number;
    z: number;
    /** 0 = harvested, 1 = ready to pick. Anything between is regrowing. */
    growth: number;
    /** Seconds left before regrowth starts. */
    cooldown: number;
    /** Slight per-carrot yaw so the rows don't look stamped. */
    yaw: number;
}

/**
 * The carrot field: a grid of raised soil plots, each holding a small grid of
 * carrots.
 *
 * The plots are static meshes, but the carrots are two `InstancedMesh3D`s (root
 * and leaves) rather than ~750 individual meshes — the whole field is two draw
 * calls, and harvesting is a matrix write rather than a scene-graph edit.
 */
export class CarrotField {
    /** Static geometry (soil beds); the caller adds this to the THREE scene. */
    readonly ground = new THREE.Group();

    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;

    private _slots: CarrotSlot[] = [];
    private _roots!: InstancedMesh3D;
    private _leaves!: InstancedMesh3D;
    private _dirty = true;
    private _m = new THREE.Matrix4();
    private _q = new THREE.Quaternion();
    private _v = new THREE.Vector3();
    private _s = new THREE.Vector3();

    /** Top surface of a plot — carrots sit on this. */
    private static readonly PLOT_TOP = 0.34;

    constructor(scene: Scene) {
        const rng = makeRng(0x1337);
        const { originX, originZ, cols, rows, plotW, plotD, gap, carrotCols, carrotRows } = FIELD;
        const strideX = plotW + gap;
        const strideZ = plotD + gap;

        this.minX = originX - plotW / 2 - gap;
        this.maxX = originX + (cols - 1) * strideX + plotW / 2 + gap;
        this.minZ = originZ - plotD / 2 - gap;
        this.maxZ = originZ + (rows - 1) * strideZ + plotD / 2 + gap;

        // One dark tilled base under everything, so the gaps between plots read
        // as soil paths rather than grass.
        this.ground.add(at(
            box(this.maxX - this.minX, 0.18, this.maxZ - this.minZ, C.SOIL),
            (this.minX + this.maxX) / 2, 0.09, (this.minZ + this.maxZ) / 2,
        ));

        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const px = originX + c * strideX;
                const pz = originZ + r * strideZ;

                this.ground.add(at(box(plotW, 0.3, plotD, C.SOIL_LIGHT), px, 0.19, pz));
                this.ground.add(at(box(plotW * 0.9, 0.06, plotD * 0.9, C.SOIL), px, CarrotField.PLOT_TOP, pz));

                for (let cc = 0; cc < carrotCols; cc++) {
                    for (let cr = 0; cr < carrotRows; cr++) {
                        this._slots.push({
                            x: px + (cc - (carrotCols - 1) / 2) * (plotW * 0.62 / Math.max(1, carrotCols - 1) * 2) * 0.5,
                            z: pz + (cr - (carrotRows - 1) / 2) * (plotD * 0.66 / Math.max(1, carrotRows - 1) * 2) * 0.5,
                            growth: 1,
                            cooldown: 0,
                            yaw: rangeOf(rng, 0, Math.PI * 2),
                        });
                    }
                }
            }
        }

        this.ground.traverse(o => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });

        this._buildInstances(scene);
    }

    get total(): number { return this._slots.length; }

    get readyCount(): number {
        let n = 0;
        for (const s of this._slots) if (s.growth >= 1) n++;
        return n;
    }

    /** True when the given world point is inside the tilled area. */
    contains(x: number, z: number): boolean {
        return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
    }

    /**
     * Pulls the nearest ready carrot within `radius` of (x, z).
     * Returns true if one was harvested.
     */
    harvestNearest(x: number, z: number, radius: number): boolean {
        let best = -1;
        let bestD = radius * radius;
        for (let i = 0; i < this._slots.length; i++) {
            const s = this._slots[i];
            if (s.growth < 1) continue;
            const dx = s.x - x, dz = s.z - z;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = i; }
        }
        if (best < 0) return false;
        const slot = this._slots[best];
        slot.growth = 0;
        slot.cooldown = FIELD.regrowTime;
        this._dirty = true;
        return true;
    }

    /** World position of the nearest ready carrot, for steering assistants. */
    nearestReady(x: number, z: number): { x: number; z: number } | null {
        let best: CarrotSlot | null = null;
        let bestD = Infinity;
        for (const s of this._slots) {
            if (s.growth < 1) continue;
            const d = (s.x - x) ** 2 + (s.z - z) ** 2;
            if (d < bestD) { bestD = d; best = s; }
        }
        return best ? { x: best.x, z: best.z } : null;
    }

    update(dt: number): void {
        for (const s of this._slots) {
            if (s.growth >= 1) continue;
            if (s.cooldown > 0) {
                s.cooldown -= dt;
                continue;
            }
            // Sprout back up over ~1.2s once the cooldown expires.
            s.growth = Math.min(1, s.growth + dt / 1.2);
            this._dirty = true;
        }
        if (this._dirty) {
            this._writeMatrices();
            this._dirty = false;
        }
    }

    private _buildInstances(scene: Scene): void {
        const n = this._slots.length;

        const rootNode = new Node();
        this._roots = rootNode.addComponent(InstancedMesh3D);
        this._roots.geometry = carrotRootGeometry();
        this._roots.material = carrotMaterial();
        this._roots.count = n;
        scene.addChild(rootNode);

        const leafNode = new Node();
        this._leaves = leafNode.addComponent(InstancedMesh3D);
        this._leaves.geometry = carrotLeafGeometry();
        this._leaves.material = leafMaterial();
        this._leaves.count = n;
        scene.addChild(leafNode);

        for (const m of [this._roots.object3D, this._leaves.object3D]) {
            m.castShadow = true;
            m.receiveShadow = false;
            // Hundreds of tiny instances spread over a big area — culling the
            // whole batch by a stale bounding sphere would pop the field out.
            m.frustumCulled = false;
        }

        this._writeMatrices();
    }

    private _writeMatrices(): void {
        const rootMesh = this._roots.object3D as THREE.InstancedMesh;
        const leafMesh = this._leaves.object3D as THREE.InstancedMesh;
        if (!rootMesh || !leafMesh) return;

        for (let i = 0; i < this._slots.length; i++) {
            const s = this._slots[i];
            const g = s.growth;
            this._q.setFromAxisAngle(UP, s.yaw);
            this._s.set(g, g, g);
            this._v.set(s.x, CarrotField.PLOT_TOP + 0.03, s.z);
            this._m.compose(this._v, this._q, this._s);
            rootMesh.setMatrixAt(i, this._m);
            leafMesh.setMatrixAt(i, this._m);
        }
        rootMesh.instanceMatrix.needsUpdate = true;
        leafMesh.instanceMatrix.needsUpdate = true;
    }
}

const UP = new THREE.Vector3(0, 1, 0);
