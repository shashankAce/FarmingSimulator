import * as THREE from 'three';
import { DEBUG, Label, Node, Scene, display } from 'noonengine';
import { AmbientLight3D, Camera3D, DirectionalLight3D, HemisphereLight3D } from 'noonengine/3d';

import { CAMERA, ECONOMY, FIELD, MACHINE, PLAYER, STATIONS } from './Config.ts';
import { SKY } from './Palette.ts';
import { GameState, type Objective } from './GameState.ts';

import { at, rot } from './procgen/Primitives.ts';
import { makeSignpost } from './procgen/Structures.ts';

import { buildEnvironment } from './world/Environment.ts';
import { CarrotField } from './world/CarrotField.ts';
import { Zone } from './world/Zones.ts';
import { makeDropIndicator, makeGroundArrow, updateDropIndicator } from './world/Indicators.ts';

import { Production } from './stations/Production.ts';
import { Shop } from './stations/Shop.ts';
import { CashField } from './stations/Cash.ts';

import { Player } from './entities/Player.ts';
import { FarmerAssistant, SellerAssistant, type FarmContext } from './entities/Assistant.ts';

import { Hud } from './ui/Hud.ts';
import { Joystick } from './ui/Joystick.ts';

/**
 * The whole game.
 *
 * One `Scene` holds the 3D world and the 2D HUD together — the engine renders
 * the Three.js pass under the 2D pass, so no second scene or camera is needed.
 * Everything is built in `onLoad()` rather than the constructor, because
 * `runScene()` only creates `sceneSystem3D` after the constructor has returned
 * (see `skills/3d/three-integration.md`).
 */
export class FarmScene extends Scene {
    private _state = new GameState();

    private _player!: Player;
    private _field!: CarrotField;
    private _production!: Production;
    private _shop!: Shop;
    private _cash!: CashField;
    private _hud!: Hud;
    private _joystick!: Joystick;

    private _camera!: Camera3D;
    private _sun!: DirectionalLight3D;
    /** Flat arrow on the grass beside the player, pointing the way to walk. */
    private _groundArrow!: THREE.Group;
    /** Chunky arrow hanging over the destination itself. */
    private _dropIndicator!: THREE.Group;
    private _elapsed = 0;

    private _zones: Record<string, Zone> = {};
    private _farmer: FarmerAssistant | null = null;
    private _seller: SellerAssistant | null = null;

    /** Fixed-interval accumulator shared by every "stand here to transfer" action. */
    private _transferTimer = 0;

    /** World-space hire prompts, projected onto the 2D layer each frame. */
    private _hireLabels: Array<{ label: Label; node: Node; world: THREE.Vector3; key: 'farmer' | 'seller' }> = [];

    onLoad(): void {
        const sys = this.sceneSystem3D;

        sys.scene.background = new THREE.Color(SKY);
        // Fog only bites well past the fence, so it softens the horizon without
        // touching anything the player interacts with.
        sys.scene.fog = new THREE.Fog(SKY, 70, 165);

        sys.onRendererReady = (renderer) => {
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft is deprecated in three 0.185
        };

        this._buildCamera();
        this._buildLights();

        sys.scene.add(buildEnvironment());

        this._field = new CarrotField(this);
        sys.scene.add(this._field.ground);

        this._cash = new CashField();
        sys.scene.add(this._cash.group);

        this._production = new Production(this._state);
        sys.scene.add(this._production.group);

        this._shop = new Shop(this._state, this._cash, this);
        sys.scene.add(this._shop.group);

        this._buildZones();
        this._buildSignposts();

        // The starting stake, lying in its marked rectangle.
        this._cash.scatter(
            STATIONS.startCash.x, STATIONS.startCash.z,
            STATIONS.startCash.w, STATIONS.startCash.d,
            ECONOMY.startCash, 6,
        );

        this._player = new Player(this);

        this._groundArrow = makeGroundArrow();
        this._dropIndicator = makeDropIndicator();
        sys.scene.add(this._groundArrow, this._dropIndicator);

        this._joystick = new Joystick(this);
        this._hud = new Hud(this, this._state);

        this._state.toast('Collect the cash!');

        if (DEBUG) {
            // Dev handle for driving the game from a console or a browser test —
            // stripped from production builds along with everything else DEBUG-gated.
            (globalThis as Record<string, unknown>).__farm = {
                state: this._state,
                player: this._player,
                display,
                field: this._field,
                production: this._production,
                shop: this._shop,
                cash: this._cash,
                /** Drops the player at a world position without animating there. */
                teleport: (x: number, z: number) => { this._player.x = x; this._player.z = z; },
            };
        }
    }

    update(dt: number): void {
        // Guard against a very large first frame (tab restore, slow first paint)
        // driving every timer at once.
        const step = Math.min(dt, 1 / 20);

        this._joystick.update();
        this._player.updateWithInput(step, this._joystick);

        this._transferTimer += step;
        const canTransfer = this._transferTimer >= MACHINE.transferInterval;
        if (canTransfer) this._transferTimer = 0;

        this._updateZones(step);
        this._handlePlayerActions(step, canTransfer);
        this._collectCashUnderfoot();

        this._field.update(step);
        this._production.update(step);
        this._shop.update(step);
        this._cash.update(step);

        this._farmer?.update(step);
        this._seller?.update(step);

        this._refreshObjective();
        this._updateIndicators(step);
        this._updateCamera(step);
        this._updateHireLabels();
        this._shop.updateBubbles(this.sceneSystem3D);

        this._hud.update(step, this._state, this._production.rackCount, this._production.rackCapacity);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Construction
    // ─────────────────────────────────────────────────────────────────────────

    private _buildCamera(): void {
        const node = new Node();
        this._camera = node.addComponent(Camera3D);
        this._camera.fov = CAMERA.fov;
        this._camera.near = 1;
        this._camera.far = 260;
        // Position/lookAt only exist once the node is in the tree — addChild first.
        this.addChild(node);
        this._camera.position.set(
            PLAYER.startX + CAMERA.offsetX,
            CAMERA.offsetY,
            PLAYER.startZ + CAMERA.offsetZ,
        );
        this._camera.lookAt(PLAYER.startX, 0, PLAYER.startZ);
    }

    private _buildLights(): void {
        const ambNode = new Node();
        const amb = ambNode.addComponent(AmbientLight3D);
        amb.color = 0xffffff;
        amb.intensity = 0.55;
        this.addChild(ambNode);

        const hemiNode = new Node();
        const hemi = hemiNode.addComponent(HemisphereLight3D);
        hemi.skyColor = 0xbfe8ff;
        hemi.groundColor = 0x6a9a3a;
        hemi.intensity = 1.5;
        this.addChild(hemiNode);

        const sunNode = new Node();
        this._sun = sunNode.addComponent(DirectionalLight3D);
        this._sun.color = 0xfff3d6;
        this._sun.intensity = 2.1;
        this.addChild(sunNode);
        this._sun.position.set(PLAYER.startX + 18, 34, PLAYER.startZ + 12);

        // Shadow config isn't schema-exposed — reach the raw THREE.Light.
        const light = this._sun.light;
        light.castShadow = true;
        light.shadow.mapSize.set(2048, 2048);
        const cam = light.shadow.camera as THREE.OrthographicCamera;
        cam.left = -34; cam.right = 34;
        cam.top = 34; cam.bottom = -34;
        cam.near = 1; cam.far = 110;
        cam.updateProjectionMatrix();
        // Slope-scaled bias: without it, the flat ground plane self-shadows in bands.
        light.shadow.bias = -0.0008;
        light.shadow.normalBias = 0.04;
    }

    private _buildZones(): void {
        const sys = this.sceneSystem3D;
        const add = (key: string, cfg: { x: number; z: number; w: number; d: number }, tint?: number) => {
            const z = new Zone(key, cfg.x, cfg.z, cfg.w, cfg.d, tint);
            this._zones[key] = z;
            sys.scene.add(z.marker);
            return z;
        };

        add('startCash', STATIONS.startCash);
        add('juicerIn', STATIONS.juicerIn);
        add('rackPickup', STATIONS.rackPickup);
        add('shopSell', STATIONS.shopSell);
        add('shopPayout', STATIONS.shopPayout);
        add('hireFarmer', STATIONS.hireFarmer);
        add('hireSeller', STATIONS.hireSeller);

        // The shop's zones only mean anything once the stall exists.
        this._zones.shopSell.setEnabled(false);
        this._zones.shopPayout.setEnabled(false);
    }

    private _buildSignposts(): void {
        const sys = this.sceneSystem3D;
        for (const [key, cfg] of [
            ['farmer', STATIONS.hireFarmer],
            ['seller', STATIONS.hireSeller],
        ] as Array<['farmer' | 'seller', typeof STATIONS.hireFarmer]>) {
            const post = makeSignpost();
            at(rot(post, 0, Math.PI, 0), cfg.x, 0, cfg.z - cfg.d / 2 - 0.9);
            post.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
            sys.scene.add(post);

            const node = new Node();
            const label = node.addComponent(Label);
            label.fontSize = 30;
            label.fontWeight = 800;
            label.color = '#ffffff';
            label.textAlign = 'center';
            label.dynamic = true;
            node.zIndex = 998;
            this.addChild(node);

            this._hireLabels.push({
                label, node, key,
                world: new THREE.Vector3(cfg.x, 3.4, cfg.z - cfg.d / 2 - 0.9),
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Per-frame logic
    // ─────────────────────────────────────────────────────────────────────────

    private _updateZones(dt: number): void {
        const { x, z } = this._player;
        for (const key of Object.keys(this._zones)) {
            const zone = this._zones[key];
            zone.occupied = zone.contains(x, z);
            zone.update(dt);
        }
    }

    private _handlePlayerActions(dt: number, canTransfer: boolean): void {
        const p = this._player;

        // ── Harvest: standing anywhere on the tilled field pulls carrots ──
        if (canTransfer && this._field.contains(p.x, p.z) && p.stack.accepts('carrot')) {
            if (this._field.harvestNearest(p.x, p.z, 2.6)) {
                p.stack.push('carrot');
                this._state.totalHarvested++;
            }
        }

        // ── Tip carrots into the juicer ──
        if (canTransfer && this._zones.juicerIn.occupied && p.stack.kind === 'carrot') {
            if (this._production.acceptCarrot()) p.stack.pop();
        }

        // ── Take bottles off the rack ──
        if (canTransfer && this._zones.rackPickup.occupied && p.stack.accepts('bottle')) {
            if (this._production.takeBottle()) p.stack.push('bottle');
        }

        // ── Sell at the shop ──
        if (canTransfer && this._zones.shopSell.occupied && p.stack.kind === 'bottle') {
            if (this._shop.sellBottle()) p.stack.pop();
        }

        // ── Upgrade pads: pay them off by standing there ──
        this._tickUpgrade(dt, 'hireFarmer', 'farmerPaid', ECONOMY.farmerCost, () => {
            this._state.farmerHired = true;
            this._farmer = new FarmerAssistant(this, this._context());
            this._state.toast('Farmhand hired!');
            this._zones.hireFarmer.setEnabled(false);
        });
        this._tickUpgrade(dt, 'hireSeller', 'sellerPaid', ECONOMY.sellerCost, () => {
            this._state.sellerHired = true;
            this._seller = new SellerAssistant(this, this._context());
            this._state.toast('Shopkeeper hired!');
            this._zones.hireSeller.setEnabled(false);
        });
    }

    /**
     * Drains money into an upgrade while the player stands on its pad — the
     * classic idle-game payment ramp, rather than a single instant purchase.
     */
    private _tickUpgrade(
        dt: number,
        zoneKey: string,
        progressKey: 'farmerPaid' | 'sellerPaid',
        cost: number,
        onComplete: () => void,
    ): void {
        const zone = this._zones[zoneKey];
        if (!zone.enabled || !zone.occupied) return;
        if (this._state[progressKey] >= cost) return;

        const rate = Math.max(40, cost / 3);   // fully paid in about three seconds
        const want = Math.min(rate * dt, cost - this._state[progressKey]);
        const afford = Math.min(want, this._state.money);
        if (afford <= 0) return;

        this._state.trySpend(afford);
        this._state[progressKey] += afford;

        if (this._state[progressKey] >= cost) onComplete();
    }

    /** Walking near a cash stack picks it up — no zone needed. */
    private _collectCashUnderfoot(): void {
        const value = this._cash.collectNearest(this._player.x, this._player.z, 1.9);
        if (value <= 0) return;

        this._state.addMoney(value);

        // The very first pickup is what funds the shop.
        if (!this._state.shopBuilt && this._cash.count === 0) {
            this._shop.build();
            this._zones.startCash.setEnabled(false);
            this._zones.shopSell.setEnabled(true);
            this._zones.shopPayout.setEnabled(true);
        }
    }

    private _context(): FarmContext {
        return {
            field: this._field,
            production: this._production,
            shop: this._shop,
            cash: this._cash,
            creditMoney: (amount: number) => this._state.addMoney(amount),
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Objective tracking and presentation
    // ─────────────────────────────────────────────────────────────────────────

    /** Derives the current objective from state, rather than tracking it imperatively. */
    private _refreshObjective(): void {
        const p = this._player;
        let next: Objective;

        if (!this._state.shopBuilt) next = 'collect-start-cash';
        else if (p.stack.kind === 'bottle') next = 'sell-bottles';
        else if (p.stack.kind === 'carrot') next = 'deliver-carrots';
        else if (this._cash.count > 0) next = 'collect-earnings';
        else if (this._production.rackCount > 0) next = 'collect-bottles';
        else {
            const cost = this._state.nextUpgradeCost();
            next = cost !== null && this._state.money >= cost ? 'expand' : 'harvest-carrots';
        }

        this._state.setObjective(next);
    }

    /**
     * World point the navigation cues aim at. `y` is where the hanging marker
     * sits above it — pads want it low, the machinery wants it clear of the roof.
     */
    private _objectiveTarget(): { x: number; z: number; y: number } {
        const pad = (s: { x: number; z: number }, y = 2.3) => ({ x: s.x, z: s.z, y });

        switch (this._state.objective) {
            case 'collect-start-cash': return pad(STATIONS.startCash, 2.1);
            case 'deliver-carrots': return pad(STATIONS.juicerIn, 2.4);
            case 'collect-bottles': return pad(STATIONS.rackPickup, 2.4);
            case 'sell-bottles': return pad(STATIONS.shopSell, 2.4);
            case 'collect-earnings': return pad(STATIONS.shopPayout, 2.1);
            case 'expand':
                return pad(this._state.farmerHired ? STATIONS.hireSeller : STATIONS.hireFarmer, 2.6);
            case 'harvest-carrots':
            default: {
                // Aim at a ripe carrot so the arrow points into the field, but keep
                // the hanging marker on the field centre — chasing the nearest
                // carrot every frame would make it jitter.
                const ready = this._field.nearestReady(this._player.x, this._player.z);
                const cx = (this._field.minX + this._field.maxX) / 2;
                const cz = (this._field.minZ + this._field.maxZ) / 2;
                return { x: ready?.x ?? cx, z: ready?.z ?? cz, y: 2.0 };
            }
        }
    }

    /**
     * Drives both navigation cues: the flat arrow painted on the grass just
     * ahead of the player, and the marker hanging over the destination. Both
     * switch off once you're basically standing on the objective, so they stop
     * spinning around underfoot.
     */
    private _updateIndicators(dt: number): void {
        this._elapsed += dt;

        const t = this._objectiveTarget();
        const p = this._player;
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        const dist = Math.hypot(dx, dz);
        const near = dist <= 2.6;

        this._groundArrow.visible = !near;
        this._dropIndicator.visible = !near;
        if (near) return;

        const yaw = Math.atan2(dx, dz);

        // Sits a step in front of the player, in the direction of travel.
        this._groundArrow.position.set(
            p.x + Math.sin(yaw) * 1.7,
            0,
            p.z + Math.cos(yaw) * 1.7,
        );
        this._groundArrow.rotation.y = yaw;

        // Deliberately NOT yawed toward the target: the camera's heading is
        // fixed, so any yaw here just turns the arrow's lit face away and leaves
        // the viewer looking at its dark outline.
        this._dropIndicator.position.set(t.x, 0, t.z);
        updateDropIndicator(this._dropIndicator, this._elapsed, t.y);
    }

    private _updateCamera(dt: number): void {
        const p = this._player;
        const cam = this._camera;
        if (!cam.position) return;

        const targetX = p.x + CAMERA.offsetX;
        const targetY = CAMERA.offsetY;
        const targetZ = p.z + CAMERA.offsetZ;
        const k = Math.min(1, CAMERA.lerp * dt);

        cam.position.set(
            cam.position.x + (targetX - cam.position.x) * k,
            cam.position.y + (targetY - cam.position.y) * k,
            cam.position.z + (targetZ - cam.position.z) * k,
        );
        cam.lookAt(cam.position.x - CAMERA.offsetX, 0, cam.position.z - CAMERA.offsetZ);

        // Keep the shadow frustum centred on the player so the 2048² map stays tight.
        this._sun.position.set(p.x + 18, 34, p.z + 12);
        this._sun.target.position.set(p.x, 0, p.z);
        this._sun.target.updateMatrixWorld();
    }

    private _updateHireLabels(): void {
        for (const entry of this._hireLabels) {
            const hired = entry.key === 'farmer' ? this._state.farmerHired : this._state.sellerHired;
            const cost = entry.key === 'farmer' ? ECONOMY.farmerCost : ECONOMY.sellerCost;
            const paid = entry.key === 'farmer' ? this._state.farmerPaid : this._state.sellerPaid;

            if (hired) {
                entry.node.setPosition({ x: -9999, y: -9999 });
                continue;
            }

            const screen = this.sceneSystem3D.worldToDesign(entry.world, display);
            if (!screen) {
                entry.node.setPosition({ x: -9999, y: -9999 });
                continue;
            }

            const remaining = Math.max(0, Math.ceil(cost - paid));
            entry.label.text = `${entry.key === 'farmer' ? 'HIRE FARMHAND' : 'HIRE SHOPKEEPER'}\n$${remaining}`;
            entry.node.setPosition({ x: screen.x, y: screen.y });
        }
    }
}
