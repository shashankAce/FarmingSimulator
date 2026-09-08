import { DEBUG, GameEngine, InspectorOverlay, RendererType, ResolutionPolicy, assetCache, createPlatform } from 'noonengine';
import { ThreeSceneSystem } from 'noonengine/3d';

import { FONT_FAMILY, FONT_SRC, GAME_HEIGHT, GAME_WIDTH } from './game/Config.ts';
import { FarmScene } from './game/FarmScene.ts';

/**
 * FarmingSimulator — bootstrap.
 *
 * Every art asset in this game is generated procedurally from THREE primitives
 * at runtime, so the only thing in `res/` to preload is the typeface. It is
 * awaited BEFORE `runScene`, not alongside it: labels bake their text to a
 * bitmap the moment they are built, and the pad digits are painted into a
 * canvas atlas during scene construction — either one built a frame early gets
 * the browser's fallback font baked in permanently.
 */

// Host-platform wrapper. Must be awaited BEFORE constructing GameEngine.
const platform = createPlatform();
await platform.initialize();

const engine = new GameEngine({
    renderType: RendererType.WEBGL,   // 3D requires WebGL2
    enable3D: true,
    sceneSystem3D: ThreeSceneSystem,
    showStats: DEBUG,
});

if (DEBUG) {
    // eslint-disable-next-line no-new
    new InspectorOverlay(engine);
}

// FIXED_HEIGHT: the design height always fits and the width crops or
// pillarboxes to suit the window. NO_BORDER was tried and is wrong here — it
// scales the design box to *cover*, which on a mismatched aspect zooms in hard
// enough that the player is looking at a few square metres of soil. The HUD
// anchors to `display.getVisibleRect()` rather than the raw design box, so it
// tracks whatever survives the crop either way.
engine.setDesignResolution(GAME_WIDTH, GAME_HEIGHT, ResolutionPolicy.FIXED_HEIGHT);

platform.reportProgress(0.2);
await assetCache.loadFont(FONT_SRC, FONT_FAMILY, 'gameFont');

platform.reportProgress(1);
engine.runScene(new FarmScene());
engine.start();

// The scene builds its whole world synchronously in onLoad(), so by the time
// runScene() returns the game is genuinely playable — the right moment to
// dismiss the host's loading screen.
platform.notifyReady();
