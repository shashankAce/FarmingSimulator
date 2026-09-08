import * as THREE from 'three';
import { DEBUG, Input, Node, Scene, display, inputListener } from 'noonengine';
import { AmbientLight3D, Camera3D, DirectionalLight3D, HemisphereLight3D } from 'noonengine/3d';

import {
    BLOCKERS, CAMERA, ECONOMY, GRAPHICS, HARVEST, HIRE, MACHINE, MACHINE_UPGRADE, OVERVIEW, PLAYER,
    STATIONS, YARD, ZONE, farmhandPads, validateLayout,
} from './Config.ts';
import { SKY } from './Palette.ts';
import { GameState, type Objective } from './GameState.ts';

import { at, rot } from './procgen/Primitives.ts';
import { mergeStatic } from './world/MergeStatic.ts';
import type { IconKind } from './procgen/Icons.ts';

import { buildEnvironment } from './world/Environment.ts';
import { CARROT_PICK_Y, CarrotField } from './world/CarrotField.ts';
import { Zone } from './world/Zones.ts';
import { debugBounds, debugRadius, obstacles } from './world/Obstacles.ts';
import { makeDropIndicator, makeGroundArrow, updateDropIndicator } from './world/Indicators.ts';

import { Production } from './stations/Production.ts';
import { ShopRow, type ShopStand } from './stations/Shop.ts';
import { CashField } from './stations/Cash.ts';

import { Player } from './entities/Player.ts';
import { FarmerAssistant, SellerAssistant, type FarmContext } from './entities/Assistant.ts';

import { Hud } from './ui/Hud.ts';
import { Stats3D } from './debug/Stats3D.ts';
import { Joystick } from './ui/Joystick.ts';
// Camera pan: built and tested, decided against for the game. Kept whole in
// `ui/CameraPan.ts` — the wiring below is commented rather than deleted so it
// can be put back by uncommenting, not rewritten. See also `PAN` in Config.
// import { CameraPan } from './ui/CameraPan.ts';
import { DropButton } from './ui/DropButton.ts';

/** A purchasable pad: hiring staff, or a machine tier. */

interface UpgradeSlot {
    zone: Zone;
    /** Money sunk into the current purchase. Reset after each one completes. */
    paid: number;
    title: () => string;
    /** Price of the next purchase, or null when this slot is exhausted. */
    cost: () => number | null;
    /** Whether the pad should exist at all right now. */
    available: () => boolean;
    onComplete: () => void;
}

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
    private _shops!: ShopRow;
    private _cash!: CashField;
    private _hud!: Hud;
    private _joystick!: Joystick;
    // private _pan!: CameraPan;
    private _dropButton!: DropButton;

    private _camera!: Camera3D;
    private _sun!: DirectionalLight3D;
    private _groundArrow!: THREE.Group;
    private _dropIndicator!: THREE.Group;
    private _elapsed = 0;

    private _zones: Record<string, Zone> = {};
    /** One serving/construction pad per stand, indexed to match `ShopRow.stands`. */
    private _shopZones: Zone[] = [];
    /** Takings pad per stand, same indexing. Hidden until the stall opens. */
    private _collectZones: Zone[] = [];
    private _farmhands: FarmerAssistant[] = [];
    private _shopkeepers: SellerAssistant[] = [];
    /** Hire and upgrade pads, all driven through one payment path. */
    private _slots: UpgradeSlot[] = [];

    private _transferTimer = 0;
    /**
     * Fractional part of a payment ramp, held between frames so the charge can
     * be whole units without making the rate frame-dependent. Capped at one
     * second's worth and shared across pads — the player only ever stands on
     * one, and a sub-unit carry-over between them is beneath notice.
     */
    private _payAccrued = 0;
    /** Whole-world plan view, DEBUG only. Toggled with V. */
    private _overview = false;
    /** 3D render stats, DEBUG only. Toggled with P. */
    private _stats3D: Stats3D | null = null;
    /** Collider overlay, DEBUG only. Toggled with C. */
    private _colliderView: THREE.Group | null = null;
    private _playerRing: THREE.Line | null = null;

    onLoad(): void {
        const sys = this.sceneSystem3D;

        sys.scene.background = new THREE.Color(SKY);
        sys.scene.fog = new THREE.Fog(SKY, 70, 165);

        sys.onRendererReady = (renderer) => {
            renderer.shadowMap.enabled = GRAPHICS.shadows;
            renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft is deprecated in three 0.185
            // The renderer is created lazily on the first 3D frame, so this is
            // the only place its `info` can be got hold of.
            this._stats3D = new Stats3D(renderer, sys.scene);
        };

        this._buildCamera();
        this._buildLights();

        // Named for the census in `debug/Stats3D.ts` — an unnamed group shows up
        // there as "Group", which tells you nothing about what is costing what.
        const env = buildEnvironment();
        env.name = 'environment';
        // The village is the bulk of the draw calls in the game and none of it
        // ever moves, which is exactly what `mergeStatic` is for.
        sys.scene.add(GRAPHICS.mergeStatic ? mergeStatic(env, GRAPHICS.mergeTile) : env);

        this._field = new CarrotField(this);
        this._field.ground.name = 'field';
        // The beds are static too — only the carrots in them change, and those
        // are two instanced meshes the merge leaves alone.
        sys.scene.add(GRAPHICS.mergeStatic
            ? mergeStatic(this._field.ground, GRAPHICS.mergeTile)
            : this._field.ground);

        this._cash = new CashField();
        this._cash.group.name = 'cash';
        sys.scene.add(this._cash.group);

        this._production = new Production(this._state);
        this._production.group.name = 'production';
        sys.scene.add(this._production.group);

        this._shops = new ShopRow(this, this._state, this._cash);
        this._shops.group.name = 'shops';
        sys.scene.add(this._shops.group);

        this._buildObstacles();
        this._buildZones();
        this._buildUpgradePads();

        this._cash.grid(
            STATIONS.startCash.x, STATIONS.startCash.z,
            STATIONS.startCash.w, STATIONS.startCash.d,
            ECONOMY.startCash, ECONOMY.startCashPiles,
        );

        this._player = new Player(this);

        this._groundArrow = makeGroundArrow();
        this._dropIndicator = makeDropIndicator();
        sys.scene.add(this._groundArrow, this._dropIndicator);

        // Built before the stick so the stick can be told to ignore its taps.
        this._dropButton = new DropButton(this, () => this._dropCarriedLoad());
        this._joystick = new Joystick(this, (x, y) => this._dropButton.hits(x, y));
        // Given the same button exclusion as the stick, so a second finger
        // reaching for "put it down" does not drag the view as well.
        // this._pan = new CameraPan(
        //     () => this._joystick.active, (x, y) => this._dropButton.hits(x, y));
        this._hud = new Hud(this, this._state);

        this._state.toast('Collect the cash!');

        if (DEBUG) {
            validateLayout();
            this._buildColliderView();
            (globalThis as Record<string, unknown>).__farm = {
                state: this._state,
                player: this._player,
                display,
                scene3D: sys.scene,
                __slots: () => this._slots.map(v => ({ title: v.title(), pos: { x: v.zone.x, z: v.zone.z }, avail: v.available(), cost: v.cost(), paid: Math.round(v.paid), enabled: v.zone.enabled })),
                __machinePad: MACHINE_UPGRADE.pad,
                __stations: STATIONS,
                field: this._field,
                production: this._production,
                shops: this._shops,
                cash: this._cash,
                teleport: (x: number, z: number) => { this._player.x = x; this._player.z = z; },
                toggleColliders: () => this._toggleColliders(),
                toggleStats: () => this._stats3D?.toggle(),
                census: () => this._stats3D?.census(),
                overview: () => this._toggleOverview(),
            };
        }
    }

    update(dt: number): void {
        const step = Math.min(dt, 1 / 20);
        // The RAW delta, not `step`: a clamped one would report a steady 20fps
        // as the floor however badly the game was actually hitching.
        this._stats3D?.update(dt);
        // Phase markers, DEBUG only and no-ops without the panel. Each `mark`
        // charges the time since the previous one to that label, so the labels
        // add up to the game's own share of the frame.
        this._stats3D?.frame();

        this._joystick.update();
        this._dropButton.update();
        this._dropButton.setVisible(!this._player.load.isEmpty);
        this._player.updateWithInput(step, this._joystick);
        this._stats3D?.mark('player');

        this._transferTimer += step;
        const canTransfer = this._transferTimer >= MACHINE.transferInterval;
        if (canTransfer) this._transferTimer = 0;

        this._updateZones(step);
        this._stats3D?.mark('zones');
        this._handlePlayerActions(step, canTransfer);
        this._collectCashUnderfoot();
        this._stats3D?.mark('actions');

        this._field.update(step);
        this._stats3D?.mark('field');
        this._production.update(step);
        this._stats3D?.mark('prod');
        this._shops.update(step);
        this._stats3D?.mark('shops');
        this._cash.update(step);
        this._stats3D?.mark('cash');

        for (const a of this._farmhands) a.update(step);
        for (const a of this._shopkeepers) a.update(step);
        this._stats3D?.mark('staff');

        this._refreshObjective();
        this._updateIndicators(step);
        // this._pan.update(step);
        this._updateCamera(step);
        this._shops.updateBubbles(this.sceneSystem3D);
        this._stats3D?.mark('camera+ui');

        if (this._playerRing) this._playerRing.position.set(this._player.x, 0, this._player.z);

        this._hud.update(step, this._state, this._production.rackCount, this._production.rackCapacity);
        this._stats3D?.mark('hud');
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

        const light = this._sun.light;
        // Left off rather than configured-then-disabled: with `castShadow`
        // false, Three never allocates the depth map at all.
        light.castShadow = GRAPHICS.shadows;
        if (!GRAPHICS.shadows) return;

        light.shadow.mapSize.set(GRAPHICS.shadowMapSize, GRAPHICS.shadowMapSize);
        const cam = light.shadow.camera as THREE.OrthographicCamera;
        cam.left = -34; cam.right = 34;
        cam.top = 34; cam.bottom = -34;
        cam.near = 1; cam.far = 110;
        cam.updateProjectionMatrix();
        light.shadow.bias = -0.0008;
        light.shadow.normalBias = 0.04;
    }

    /**
     * Collider overlay: every solid footprint, the yard clamp line, and the
     * player's own collision radius. Hidden until toggled with C.
     *
     * Built AFTER `_buildObstacles()`, since `debugGroup()` snapshots whatever
     * boxes are registered at the moment it's called.
     */
    private _buildColliderView(): void {
        inputListener.on(Input.KEY_DOWN, (e: { code: string }) => {
            if (e.code === 'KeyC') this._toggleColliders();
            if (e.code === 'KeyP') this._stats3D?.toggle();
            if (e.code === 'KeyO') this._stats3D?.census();
            if (e.code === 'KeyV') this._toggleOverview();
        });
    }

    /**
     * Rebuilt on every switch-on rather than snapshotted once, because
     * footprints change shape at runtime (a locked plot becomes a counter).
     * A stale overlay is worse than none — it lies about where the walls are.
     */
    /**
     * Pulls the camera up to a plan view of the whole world, and back.
     *
     * The follow is skipped entirely while it is on, so the player can still be
     * driven around underneath it. Panning keeps working, which is how you
     * shift the overview off centre.
     */
    private _toggleOverview(): void {
        this._overview = !this._overview;
        // eslint-disable-next-line no-console
        console.log(this._overview
            ? `overview on — camera at y=${OVERVIEW.height}. O for the item census, V to go back.`
            : 'overview off');
    }

    private _toggleColliders(): void {
        if (this._colliderView) {
            this.sceneSystem3D.scene.remove(this._colliderView);
            this._colliderView = null;
            this._playerRing = null;
            this._state.toast('Colliders OFF');
            return;
        }

        const view = obstacles.debugGroup();
        view.add(debugBounds(YARD.minX, YARD.maxX, YARD.minZ, YARD.maxZ, PLAYER.radius));
        this._playerRing = debugRadius(PLAYER.radius);
        view.add(this._playerRing);

        this._colliderView = view;
        this.sceneSystem3D.scene.add(view);
        this._state.toast('Colliders ON');
    }

    /**
     * Registers the solid footprints inside the fence. Only fixed machinery and
     * stall counters block — dropped crates and racks are transient, and the
     * village is beyond the boundary the player is already clamped to.
     */
    private _buildObstacles(): void {
        obstacles.add(STATIONS.juicer.x, STATIONS.juicer.z, BLOCKERS.juicer.w, BLOCKERS.juicer.d);
        obstacles.addSpan(
            STATIONS.conveyor.x0, STATIONS.conveyor.x1, STATIONS.conveyor.z,
            BLOCKERS.conveyorDepth,
        );
        obstacles.add(STATIONS.racks.x, STATIONS.racks.z, BLOCKERS.rackStand.w, BLOCKERS.rackStand.d);

        // Stalls register (and later reshape) their own footprint — see ShopStand.
    }

    private _buildZones(): void {
        const sys = this.sceneSystem3D;
        const add = (key: string, cfg: { x: number; z: number; w: number; d: number },
                     opts: ConstructorParameters<typeof Zone>[5]) => {
            const z = new Zone(key, cfg.x, cfg.z, cfg.w, cfg.d, opts);
            this._zones[key] = z;
            sys.scene.add(z.marker);
            return z;
        };

        // Presentation travels with the pad — see STATIONS in Config.
        for (const key of ['startCash', 'juicerIn', 'rackPickup'] as const) {
            const cfg = STATIONS[key];
            add(key, cfg, { icon: cfg.icon, showProgress: 'showProgress' in cfg && cfg.showProgress });
        }

        // One pad per stand: construction site while locked, serving pad once open.
        for (const stand of this._shops.stands) {
            // `place.padYaw` is the stall's own yaw plus the quarter-turn that
            // reconciles the pad's authoring convention with it — see Config.
            const zone = new Zone(
                `shop${stand.index}`, stand.sellPad.x, stand.sellPad.z, ZONE.shop.w, ZONE.shop.d,
                { icon: 'shop', showProgress: true, showAmount: true, yaw: stand.place.padYaw },
            );
            this._shopZones.push(zone);
            sys.scene.add(zone.marker);

            // Takings pad beside it. Only exists once the stall does — a pad for
            // banking money from a building site reads as a bug.
            const till = new Zone(
                `till${stand.index}`, stand.place.collectPad.x, stand.place.collectPad.z,
                ZONE.collect.w, ZONE.collect.d,
                // Icon only. The cash physically stacked on this pad already
                // says how much is waiting and how full it is, so a fill bar
                // and a total would be the same fact told three times.
                { icon: 'money', yaw: stand.place.padYaw, notice: 'MAXED' },
            );
            till.setEnabled(false);
            this._collectZones.push(till);
            sys.scene.add(till.marker);
        }
    }

    /**
     * Builds every hire and upgrade pad. All three kinds — farmhands, per-stall
     * shopkeepers, and the juicer speed tiers — go through the same `UpgradeSlot`
     * shape, so payment, the fill bar and the price label are written once.
     *
     * Repeatable slots (staff, machine tiers) just report the next `cost()` and
     * reset `paid` on each purchase.
     */
    private _buildUpgradePads(): void {
        const sys = this.sceneSystem3D;

        /**
         * The price is painted flat INSIDE the pad, as extruded digits rather
         * than screen text. A 2D label — whether over the pad or on a signpost
         * beside it — keeps a constant screen size as the pad recedes and never
         * settles into the scene; a signpost also merged with the stall and sat
         * on somebody's walking line. `makeSignpost()` is kept in `procgen/`.
         *
         * The slot's `title()` no longer appears anywhere: the icon says which
         * hire this is, so spelling it out again was noise on the grass.
         */
        const makeSlot = (
            pos: { x: number; z: number },
            icon: IconKind,
            slot: Omit<UpgradeSlot, 'zone' | 'paid'>,
            // A stall's slot turns with that stall; the free-standing ones — the
            // farmhand pads and the juicer tier — sit on open grass with nothing
            // to align to, so they keep world axes.
            yaw = 0,
        ): UpgradeSlot => {
            const zone = new Zone(`slot${this._slots.length}`, pos.x, pos.z,
                ZONE.hire.w, ZONE.hire.d, { icon, showProgress: true, showAmount: true, yaw });
            sys.scene.add(zone.marker);

            const full: UpgradeSlot = { ...slot, zone, paid: 0 };
            this._slots.push(full);
            return full;
        };

        // ── Farmhands, along the near edge of the field ──
        farmhandPads().forEach((pos, i) => {
            makeSlot(pos, 'farmhand', {
                title: () => 'HIRE FARMHAND',
                // Slot i unlocks once you have i staff, so they're bought in order.
                available: () => this._state.farmhands === i && i < this._shops.stands.length,
                cost: () => HIRE.farmhandCosts[i] ?? null,
                onComplete: () => {
                    this._state.farmhands++;
                    this._farmhands.push(new FarmerAssistant(this, this._context()));
                    this._state.toast('Farmhand hired!');
                },
            });
        });

        // ── Shopkeepers, one per stall, on the stall's spare flank ──
        this._shops.stands.forEach((stand, i) => {
            makeSlot(stand.place.hirePad, 'shopkeeper', {
                title: () => 'HIRE SHOPKEEPER',
                // Only once that stall exists — hiring staff for a building site
                // reads as a bug.
                available: () => stand.isOpen && this._state.shopkeepers === i,
                cost: () => HIRE.shopkeeperCosts[i] ?? null,
                onComplete: () => {
                    this._state.shopkeepers++;
                    this._shopkeepers.push(new SellerAssistant(this, this._context(), i));
                    this._state.toast('Shopkeeper hired!');
                },
            }, stand.place.padYaw);
        });

        // ── Juicer speed, repeatable through the tier table ──
        makeSlot(MACHINE_UPGRADE.pad, 'shop', {
            title: () => 'FASTER JUICER',
            available: () => this._state.machineLevel < MACHINE_UPGRADE.costs.length,
            cost: () => MACHINE_UPGRADE.costs[this._state.machineLevel] ?? null,
            onComplete: () => {
                this._state.machineLevel++;
                this._production.processTime =
                    MACHINE_UPGRADE.processTime[this._state.machineLevel];
                this._state.toast('Juicer upgraded!');
            },
        });
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

        // Fill bars: each pad shows the thing it's actually gating.
        this._zones.juicerIn.setProgress(
            Math.min(1, this._state.carrotsQueued / MACHINE.hopperCapacity));
        this._zones.rackPickup.setProgress(
            this._production.rackCapacity > 0 ? this._production.rackCount / this._production.rackCapacity : 0);
        for (const slot of this._slots) {
            const on = slot.available();
            if (slot.zone.enabled !== on) slot.zone.setEnabled(on);
            const cost = slot.cost();
            slot.zone.occupied = on && slot.zone.contains(x, z);
            slot.zone.setProgress(cost === null || cost <= 0 ? 1 : slot.paid / cost);
            slot.zone.setAmount(cost === null ? null : Math.max(0, Math.ceil(cost - slot.paid)));
            slot.zone.setLocked(cost !== null && this._state.money < cost - slot.paid);
            slot.zone.update(dt);
        }

        for (let i = 0; i < this._shopZones.length; i++) {
            const zone = this._shopZones[i];
            const stand = this._shops.stands[i];
            zone.occupied = zone.contains(x, z);

            // A locked plot is a price tag: the icon and the remaining cost,
            // and nothing in the bar. The bar belongs to stock, and a stall
            // that does not exist has none — which is also what used to make
            // the first stall read as permanently full, since its cost is 0 and
            // "nothing left to pay" came out of the old bar as 100%.
            zone.setIconVisible(!stand.isOpen);
            zone.setSolid(stand.isOpen);
            if (stand.isOpen) {
                zone.setLocked(false);        // nothing left to buy here
                zone.setProgress(stand.stockFullness);
                // Money reads on the takings pad now, not here.
                zone.setAmount(null);
            } else {
                zone.setProgress(0);
                zone.setAmount(Math.max(0, Math.ceil(stand.cost - stand.paid)));
                zone.setLocked(this._state.money < stand.cost - stand.paid);
            }
            zone.update(dt);

            const till = this._collectZones[i];
            if (till.enabled !== stand.isOpen) till.setEnabled(stand.isOpen);
            if (!stand.isOpen) continue;
            till.occupied = till.contains(x, z);
            // Nowhere left to pay out: the stall has stopped selling until this
            // is cleared, which is worth saying out loud.
            till.setNotice(stand.tillFull);
            till.update(dt);
        }

        // Standing at a stall — either side of it — puts the kukri away. Serving
        // and sweeping the takings are counter work, not field work.
        this._player.stowTool =
            this._shopZones.some(z => z.occupied) || this._collectZones.some(t => t.occupied);
    }

    private _handlePlayerActions(dt: number, canTransfer: boolean): void {
        const p = this._player;

        // ── Harvest into a basket ──
        p.harvestTimer = Math.max(0, p.harvestTimer - dt);
        if (this._field.contains(p.x, p.z) && p.load.accepts('carrot') && p.harvestTimer === 0) {
            p.harvestTimer = HARVEST.interval;
            this._reap(p);
        }

        // ── Tip carrots into the juicer ──
        if (canTransfer && this._zones.juicerIn.occupied && p.load.kind === 'carrot') {
            if (this._production.acceptCarrot()) p.load.pop();
        }

        // ── Lift a filled rack off the stand ──
        if (canTransfer && this._zones.rackPickup.occupied && p.load.canAdopt('bottle')) {
            const bottles = this._production.takeRack();
            if (bottles > 0) p.load.adoptFilled('bottle', bottles);
        }

        // ── Shop pads: pay one off, or work the counter at one that's open ──
        for (let i = 0; i < this._shopZones.length; i++) {
            const zone = this._shopZones[i];
            if (!zone.occupied) continue;
            const stand = this._shops.stands[i];

            if (!stand.isOpen && !stand.isBuilding) {
                this._payOff(dt, stand.cost, stand.paid, paid => { stand.paid = paid; }, () => {
                    stand.build();
                    this._state.toast('New juice stand open!');
                });
                continue;
            }
            // Set down a crate, or serve — see ShopStand.serveTick. Sweeping the
            // takings is a separate pad, handled below.
            if (canTransfer) {
                stand.serveTick(p.load, value => this._state.addMoney(value));
            }
        }

        // ── Takings pads: bank one stack of counter cash per tick ──
        if (canTransfer) {
            for (let i = 0; i < this._collectZones.length; i++) {
                const till = this._collectZones[i];
                if (!till.enabled || !till.occupied) continue;
                if (this._shops.stands[i].collectTick(v => this._state.addMoney(v))) {
                    // Counted here and not in ShopStand, so a hired shopkeeper
                    // doing the rounds never retires the player's own tutorial.
                    this._state.takingsBanked++;
                }
            }
        }

        // ── Hire and upgrade pads ──
        for (const slot of this._slots) {
            if (!slot.zone.occupied || !slot.available()) continue;
            const cost = slot.cost();
            if (cost === null) continue;
            this._payOff(dt, cost, slot.paid, paid => { slot.paid = paid; }, () => {
                slot.paid = 0;              // repeatable: reset for the next tier
                slot.onComplete();
            });
        }
    }

    /**
     * Drains money into a purchase while the player stands on its pad — the
     * classic idle-game payment ramp, rather than a single instant transaction.
     */
    private _payOff(
        dt: number,
        cost: number,
        paid: number,
        store: (paid: number) => void,
        onComplete: () => void,
    ): void {
        const remaining = cost - paid;
        if (remaining <= 0) return;
        // All or nothing. A pad the player cannot cover is locked and grey, so
        // money is never sunk into a purchase that cannot finish — walking over
        // a pad you cannot afford used to quietly empty the wallet into it.
        // Checked BEFORE any time is banked, or standing on a locked pad accrues
        // credit that clears in one frame the moment the money arrives.
        if (Math.floor(this._state.money) < remaining) return;

        const rate = Math.max(60, cost / 3);   // fully paid in about three seconds
        // `dt` buys frame-rate independence, and that is all it is for. The
        // charge itself is whole units: the accumulator converts a per-second
        // rate into them, so 30Hz and 144Hz drain a pad at the same speed while
        // `paid`, `cost` and the wallet all stay integers and the completion
        // test below stays exact. Charging `rate * dt` directly is what left a
        // 60-unit purchase sitting at 59.99999999999999 forever.
        this._payAccrued = Math.min(this._payAccrued + rate * dt, rate);

        const units = Math.min(Math.floor(this._payAccrued), remaining);
        if (units <= 0) return;
        this._payAccrued -= units;

        this._state.trySpend(units);
        const next = paid + units;
        store(next);
        if (next >= cost) onComplete();
    }

    /**
     * One swing of a blade: everything ripe in the wedge in front of `who`
     * comes out at once and streams into their basket.
     *
     * Capped by what the basket can still take, so a wide sweep never cuts
     * carrots that would have nowhere to go.
     */
    private _reap(who: Player | FarmerAssistant): void {
        const room = who.load.roomFor('carrot');
        if (room <= 0) return;

        // Looked up now so the swing only happens over standing crop, but taken
        // later — `sweep` holds the cut back until the blade reaches the ground.
        const ripe = this._field.ripeInArc(
            who.x, who.z, HARVEST.radius, who.yaw, (HARVEST.arcDeg * Math.PI) / 360, room);
        if (ripe.length === 0) return;

        who.sweep(() => {
            const cut = this._field.cutAt(ripe);
            cut.forEach((spot, i) => {
                who.load.push('carrot', new THREE.Vector3(spot.x, CARROT_PICK_Y, spot.z),
                    HARVEST.settle + i * HARVEST.stagger);
            });
            this._state.totalHarvested += cut.length;
        });
    }

    /**
     * Puts the carried load on the ground — or rather, gives it up.
     *
     * The escape hatch for the one state the game cannot otherwise leave: a
     * load is one kind at a time, so somebody holding carrots with a full
     * hopper and a full rack stand can neither tip them nor lift a rack, and
     * lifting a rack is what clears the jam. Carrots regrow, so losing a
     * handful costs time rather than progress.
     */
    private _dropCarriedLoad(): void {
        const load = this._player.load;
        if (load.isEmpty) return;
        const kind = load.kind;
        load.clear();
        this._state.toast(kind === 'carrot' ? 'Carrots dropped' : 'Crate dropped');
    }

    /** Walking near a cash stack picks it up — no zone needed. */
    private _collectCashUnderfoot(): void {
        const value = this._cash.collectNearest(this._player.x, this._player.z, 1.9);
        if (value <= 0) return;

        this._state.addMoney(value);

        // Clearing the stake retires its pad. It does NOT open the first stall:
        // that stall has a price like every other one, and is paid for by
        // standing on its plot. Opening it here handed the player a shop they
        // never bought and skipped the step that teaches how the others work.
        if (this._cash.count === 0) this._zones.startCash.setEnabled(false);
    }

    private _context(): FarmContext {
        return {
            field: this._field,
            production: this._production,
            shops: this._shops,
            cash: this._cash,
            creditMoney: (amount: number) => this._state.addMoney(amount),
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Objective tracking and presentation
    // ─────────────────────────────────────────────────────────────────────────

    /** The cheapest available pad the player can afford right now, if any. */
    private _affordableSlot(): UpgradeSlot | null {
        let best: UpgradeSlot | null = null;
        for (const slot of this._slots) {
            if (!slot.available()) continue;
            const cost = slot.cost();
            if (cost === null || this._state.money < cost) continue;
            if (!best || cost < best.cost()!) best = slot;
        }
        return best;
    }

    /**
     * The scripted opening, in order.
     *
     * Until it is finished the objective walks this list and nothing else. The
     * derived version below aims at whatever the game most wants NEXT, which is
     * right for a player who knows the loop and wrong for one being taught it:
     * standing at a stall setting a crate down, it swung to the rack stand the
     * moment the juicer filled one, then to the takings pad the moment a shopper
     * paid — pulling the arrow off the very thing the player was doing.
     */
    private static readonly TUTORIAL: ReadonlyArray<Objective> = [
        'collect-start-cash', 'unlock-shop', 'harvest-carrots', 'deliver-carrots',
        'collect-bottles', 'sell-bottles', 'collect-earnings',
    ];

    /** Whether a scripted step is finished, so the script can move on. */
    private _tutorialSatisfied(step: Objective): boolean {
        const load = this._player.load;
        switch (step) {
            case 'collect-start-cash': return this._cash.count === 0;
            case 'unlock-shop': return this._shops.anyOpen;
            case 'harvest-carrots': return load.kind === 'carrot';
            // Both of these mean "the load is down". Each is only ever reached
            // with something in hand, so an empty load is the step completing
            // rather than the step never having started.
            case 'deliver-carrots': return load.isEmpty;
            case 'sell-bottles': return load.isEmpty;
            case 'collect-bottles': return load.kind === 'bottle';
            case 'collect-earnings': return this._state.takingsBanked > 0;
            default: return true;
        }
    }

    private _refreshObjective(): void {
        if (!this._state.tutorialDone) {
            const script = FarmScene.TUTORIAL;
            while (this._state.tutorialStep < script.length
                && this._tutorialSatisfied(script[this._state.tutorialStep])) {
                this._state.tutorialStep++;
            }
            const step = script[this._state.tutorialStep];
            if (step) {
                this._state.setObjective(step);
                return;
            }
        }
        this._state.setObjective(this._derivedObjective());
    }

    /** What the game most wants next, for a player who already knows the loop. */
    private _derivedObjective(): Objective {
        const p = this._player;
        let next: Objective;

        if (!this._shops.anyOpen) {
            // The opening sequence is two beats, not one: lift the stake off the
            // grass, then go and pay it into the first plot.
            next = this._cash.count > 0 ? 'collect-start-cash' : 'unlock-shop';
        } else if (p.load.kind === 'bottle') next = 'sell-bottles';
        else if (p.load.kind === 'carrot') next = 'deliver-carrots';
        else if (this._cash.count > 0 || this._shops.tillTotal > 0) next = 'collect-earnings';
        else if (this._production.readyRackCount > 0) next = 'collect-bottles';
        else {
            const stand = this._shops.nextLocked();
            const slot = this._affordableSlot();
            if (stand && this._state.money >= stand.cost) next = 'unlock-shop';
            else if (slot) next = 'expand';
            else next = 'harvest-carrots';
        }

        return next;
    }

    /**
     * World point the navigation cues aim at. `y` is where the hanging marker
     * sits above it.
     */
    private _objectiveTarget(): { x: number; z: number; y: number } {
        const p = this._player;
        const pad = (s: { x: number; z: number }, y = 2.3) => ({ x: s.x, z: s.z, y });

        switch (this._state.objective) {
            case 'collect-start-cash': return pad(STATIONS.startCash, 2.1);
            case 'deliver-carrots': return pad(STATIONS.juicerIn, 2.4);
            case 'collect-bottles': return pad(STATIONS.rackPickup, 2.4);
            case 'sell-bottles': {
                const stand = this._shops.nearestOpen(p.x, p.z);
                return pad(stand ? stand.sellPad : STATIONS.rackPickup, 2.4);
            }
            case 'collect-earnings': {
                // Takings pile up on the counters; loose ground cash is only the
                // opening stake, so prefer whichever is actually waiting. Falls
                // back to an open stall's takings pad rather than to the empty
                // stake pad: during the script this step is reached the instant
                // a crate goes down, often before a shopper has finished paying.
                const stand = this._shops.nearestWithTakings(p.x, p.z)
                    ?? this._shops.nearestOpen(p.x, p.z);
                if (stand) return pad(stand.place.collectPad, 2.4);
                const pile = this._cash.nearestPile(p.x, p.z);
                return pad(pile ?? STATIONS.startCash, 2.1);
            }
            case 'unlock-shop': {
                // The stall mid-build wins over the next one to buy. Paying for
                // a plot starts a raise animation that takes about a second,
                // during which the stall is `isBuilding` but not yet `isOpen` —
                // so the objective was still 'unlock-shop' while `nextLocked()`
                // had already moved on, and the marker jumped to the NEXT stall
                // for that second before snapping away to the field.
                const stand = this._shops.building() ?? this._shops.nextLocked();
                return pad(stand ? stand.sellPad : STATIONS.startCash, 2.6);
            }
            case 'expand': {
                const slot = this._affordableSlot();
                return pad(slot ? { x: slot.zone.x, z: slot.zone.z } : STATIONS.juicerIn, 2.4);
            }
            case 'harvest-carrots':
            default: {
                // Aim at a ripe carrot so the arrow points into the field, but keep
                // the hanging marker on the field centre — chasing the nearest
                // carrot every frame would make it jitter.
                const ready = this._field.nearestReady(p.x, p.z);
                const cx = (this._field.minX + this._field.maxX) / 2;
                const cz = (this._field.minZ + this._field.maxZ) / 2;
                return { x: ready?.x ?? cx, z: ready?.z ?? cz, y: 2.0 };
            }
        }
    }

    /**
     * Drives both navigation cues: the flat arrow painted on the grass just
     * ahead of the player, and the marker hanging over the destination.
     *
     * Both are TUTORIAL aids and both retire together, once the player has been
     * through the loop once. Keeping the hanging marker afterwards looked
     * harmless and was not: past the scripted opening the objective is derived
     * fresh each frame from whatever the game most wants next, so the marker
     * swung between the rack stand and a takings pad while the player was busy
     * elsewhere — the same jitter the arrow was fixed for, minus the arrow.
     *
     * The ground arrow additionally stays down while the player is out in the
     * crop rows, where it would be scribbling over the carrots on every
     * objective change.
     */
    private _updateIndicators(dt: number): void {
        this._elapsed += dt;

        const t = this._objectiveTarget();
        const p = this._player;
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        const dist = Math.hypot(dx, dz);
        const near = dist <= 2.6;

        this._dropIndicator.visible = !near && !this._state.tutorialDone;

        const guiding = !near
            && !this._state.tutorialDone
            && !this._field.contains(p.x, p.z);
        this._groundArrow.visible = guiding;

        if (near) return;

        const yaw = Math.atan2(dx, dz);
        if (guiding) {
            this._groundArrow.position.set(p.x + Math.sin(yaw) * 1.7, 0, p.z + Math.cos(yaw) * 1.7);
            this._groundArrow.rotation.y = yaw;
        }

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

        // Looking at the whole world instead of at the player: fixed over the
        // village, follow skipped.
        const overX = OVERVIEW.center.x;
        const overZ = OVERVIEW.center.z;

        // With the pan wired in, its offset was added to each of these — it
        // rode on top of the follow target so the view slid off the player
        // without changing where it points:
        //     const targetX = ... + this._pan.x;
        //     const targetZ = ... + this._pan.z;
        // and the lerp went to 1 while dragging (`this._pan.active`), because
        // at the follow rate a drag feels like it is going through treacle.
        const targetX = this._overview ? overX : p.x + CAMERA.offsetX;
        const targetY = this._overview ? OVERVIEW.height : CAMERA.offsetY;
        const targetZ = this._overview ? overZ + OVERVIEW.tiltBack : p.z + CAMERA.offsetZ;
        const k = Math.min(1, CAMERA.lerp * dt);

        cam.position.set(
            cam.position.x + (targetX - cam.position.x) * k,
            cam.position.y + (targetY - cam.position.y) * k,
            cam.position.z + (targetZ - cam.position.z) * k,
        );
        if (this._overview) cam.lookAt(overX, 0, overZ);
        else cam.lookAt(cam.position.x - CAMERA.offsetX, 0, cam.position.z - CAMERA.offsetZ);

        // Keep the shadow frustum centred on the player so the map stays tight.
        // Pointless work with no shadow to fit, and the sun is directional, so
        // where it sits makes no difference to the lighting itself.
        if (GRAPHICS.shadows) {
            this._sun.position.set(p.x + 18, 34, p.z + 12);
            this._sun.target.position.set(p.x, 0, p.z);
            this._sun.target.updateMatrixWorld();
        }
    }

}
