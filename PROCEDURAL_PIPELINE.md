# Procedural asset pipeline

This game ships **no art files**. Every mesh, colour and animation is generated
in code at startup from THREE primitives. `res/` contains nothing the game
loads, and `assetCache.preloadAssets()` is never called — the "loading stage" is
just `FarmScene.onLoad()` running synchronously.

That is a deliberate constraint, and it is why the production bundle is ~820 KB
(216 KB gzipped) with Three.js included and zero asset requests at runtime.

## Layers

```
Palette.ts          flat colour constants — the only place art direction lives
   ↓
procgen/Primitives  box / cyl / cone / sphere / blob / disc / hexTile / gableRoof
   ↓                + seeded RNG, shared material & geometry caches
procgen/Nature      trees, bushes, rocks, cobbled paths, grass tufts
procgen/Structures  cottages, fences, cart, fountain, lamps, barrels, cattle, shop
procgen/Machines    juicer, conveyor, racks, bottles, carrots, cash stacks
procgen/Character   the bunny farmer rig + its walk cycle
procgen/Customer    the shoppers who queue at the stand
   ↓
world/Environment   assembles the village from one seed
world/CarrotField   the field, as two InstancedMesh3D draw calls
world/Indicators    the two navigation cues (ground arrow, hanging marker)
```

Nothing above `Primitives` imports THREE for geometry construction — the
builders return `THREE.Group`/`THREE.Mesh` and the world layer only positions
them.

## Rules that keep this cheap

**Seed everything.** `makeRng(seed)` (mulberry32) drives every random placement,
so the village lays out identically on every reload. `buildEnvironment(seed)`
takes the seed as an argument — change it to reroll the whole village.

**Share geometries and materials, but only for static scenery.** `Primitives`
caches both by shape/colour key, so 46 trees reuse a handful of buffers. This is
safe *only* because static scenery is added to the THREE scene as raw meshes
(`sys.scene.add(...)`), the pattern `skills/3d/three-integration.md` prescribes
for geometry with no lifecycle.

> **Never hand a cached material or geometry to a `Mesh3D`/`InstancedMesh3D`.**
> Those wrappers dispose *both* in `onDestroy()`, which would break every other
> mesh sharing them. `Machines.carrotMaterial()`/`leafMaterial()` deliberately
> construct fresh materials for exactly this reason.

**UI-in-the-world is unlit.** The navigation arrows use `MeshBasicMaterial`,
not Lambert. They are interface, not scenery — a lit arrow goes nearly black on
the faces pointing away from the sun, and a cue whose brightness changes as you
turn is useless. For the same reason the hanging marker is never yawed: the
camera heading is fixed, so rotating it only turns its lit face away.

**Flat shading plus a hemisphere/directional pair is the whole art style.**
`MeshLambertMaterial({ flatShading: true })` with an ambient + hemisphere +
directional rig produces the chunky low-poly read. There are no textures, no
normal maps and no specular response to tune.

**Instance anything there are hundreds of.** The field is ~756 carrots and costs
two draw calls: one `InstancedMesh3D` for roots, one for leaf clusters.
Harvesting writes a zero-scale matrix rather than touching the scene graph, and
regrowth animates the scale back up.

**Pool anything that spawns repeatedly.** Carried items (`CarryStack`), belt and
rack bottles (`Production`) and cash stacks (`CashField`) all recycle their
groups instead of rebuilding them per transfer.

## Which components get a wrapper

| Content | How it's added | Why |
|---|---|---|
| Ground, village, fences, machines, racks | raw `sys.scene.add()` | never toggled or destroyed — a wrapper's lifecycle buys nothing |
| Player and assistants | `Group3D` wrapper on a `Node` | dynamic, destroyable, participates in the Node lifecycle |
| Carrot field | `InstancedMesh3D` | needs the component's buffer management |
| Camera and lights | `Camera3D` / `*Light3D` | the wrappers are how the scene system finds them |

## Adding a new prop

1. Add its colours to `Palette.ts`.
2. Write a `makeX(rng?)` builder in the matching `procgen/` module that returns a
   `THREE.Group` centred on its own origin, sitting on `y = 0`.
3. Place it from `world/Environment.ts` (scenery) or the relevant station class
   (interactive), and set `castShadow`/`receiveShadow` on its meshes.

Keep builders origin-centred and ground-aligned — every placement helper assumes
it.
