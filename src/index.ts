import { Renderer, showStatusLine } from './renderer/engine/rendering/Renderer';
import { createDrawApi } from './renderer/engine/rendering/WebGL2Backend';
import { FrameLoop } from './renderer/engine/rendering/FrameLoop';
import { Game } from './renderer/game/Game';
import { MountContext, createMountContext } from './renderer/engine/components/MountContext';
import { FrameTimer } from './renderer/engine/rendering/FrameTimer';
import type { GpuTimer } from './renderer/engine/rendering/GpuTimer';
import { FontAtlasError } from './renderer/engine/text/FontAtlas';
import {
	LoadedFontAtlas,
	fontLoadFailureMessage,
	loadFontAtlases,
	loadImageElement,
} from './renderer/engine/text/loadFontAtlases';

/**
 * Main entry point for the application
 */
class Application {
	private renderer!: Renderer;
	private game!: Game;
	private frameTimer!: FrameTimer;
	private frameLoop!: FrameLoop;
	private context!: MountContext;

	/**
	 * Initialize the application
	 */
	public async init(): Promise<void> {
		console.log('Initializing Dual Deckbuilder...');

		try {
			// Hide the loading screen when fully loaded
			window.addEventListener('load', () => {
				const loadingElement = document.getElementById('loading');
				if (loadingElement) {
					loadingElement.style.display = 'none';
				}
			});

			// Decoded alongside the rest of startup, awaited before the draw
			// API exists: text before its atlas is an error (R2.18).
			const fontAtlases = this.loadFonts();

			// Frame timing, section timing and the per-frame draw counters (R13.7).
			// A development build mirrors the sections to a DevTools track
			// (R15.29); the require sits in a branch DefinePlugin folds away.
			this.frameTimer = new FrameTimer({
				tracks: __DEV_TOOLS__
					// eslint-disable-next-line @typescript-eslint/no-var-requires
					? (require('./renderer/engine/debug/devtoolsTracks') as typeof import('./renderer/engine/debug/devtoolsTracks')).createDevToolsTracks()
					: null,
			});

			// Create the WebGL renderer
			this.renderer = new Renderer('game-canvas');

			// R13.16's GPU timer. Development builds only: production issues no
			// query at all (R15.22).
			const gpuTimer: GpuTimer | null = __DEV_TOOLS__
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				? (require('./renderer/engine/rendering/GpuTimer') as typeof import('./renderer/engine/rendering/GpuTimer')).createGpuTimer(this.renderer)
				: null;

			// The seam. Built through the shared factory rather than spelled
			// here, so this page and the gallery cannot end up with differently
			// configured draw APIs over the same renderer.
			const draw = createDrawApi({
				renderer: this.renderer,
				frameTimer: this.frameTimer,
				gpuTimer,
				fontAtlases: await fontAtlases,
			});

			// R1.6: the one object every root is mounted with. Input listens on
			// the canvas the renderer draws to.
			this.context = createMountContext({ draw, viewport: this.renderer.viewport });
			const canvas = this.renderer.canvas;
			this.context.input.setup(canvas);

			// Create and initialize the game
			this.game = new Game({
				context: this.context,
				frameTimer: this.frameTimer,
				viewport: this.renderer.viewport,
				device: this.renderer.device,
				gpuTimer,
			});
			await this.game.init();

			if (__DEV_TOOLS__) {
				// Required, not imported, for the reason Game.ts states: with
				// tsconfig `module: commonjs` webpack cannot tree-shake an unused
				// ES import, but it does drop a require inside a branch
				// DefinePlugin has folded to false (R13.2).
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const { installInputHooks } = require('./renderer/engine/debug/hooks') as typeof import('./renderer/engine/debug/hooks');
				// R13.35, on the same canvas InputSystem.setup just registered
				// its listeners on, so injected events land on those listeners.
				installInputHooks({ canvas, input: this.context.input });
			}

			// Start the main loop. R15.5: it stops while the context is lost
			// and resumes once the backend has rebuilt on restore.
			this.frameLoop = new FrameLoop({ tick: this.loop });
			// A resize measured after this update's rAF runs its frame before paint.
			this.renderer.viewport.onPending = () => this.frameLoop.runNow();
			this.renderer.addContextListener({
				lost: () => this.frameLoop.stop(),
				restored: () => this.frameLoop.start(),
			});
			this.frameLoop.start();

			console.log('Initialization complete!');
		} catch (error) {
			console.error('Failed to initialize application:', error);
			if (error instanceof FontAtlasError) showStatusLine(fontLoadFailureMessage(error));
		}
	}

	/**
	 * Starts decoding the font atlases alongside the rest of startup. The two
	 * marks are the outcome as a packaged build reports it: the smoke test in
	 * scripts/smoke-electron-package.mjs waits on them to check the atlases
	 * load from file:// (R15.34), where a production bundle has no dev hooks.
	 */
	private loadFonts(): Promise<LoadedFontAtlas[]> {
		const loading = loadFontAtlases({ loadImage: loadImageElement });
		loading.then(
			(atlases) => {
				performance.mark('font-atlases-ready', { detail: { faces: atlases.map((loaded) => loaded.face) } });
			},
			(error: unknown) => {
				console.error('Font atlases failed to load:', error);
				performance.mark('font-atlases-failed', { detail: { message: String(error) } });
			},
		);
		return loading;
	}

	/**
	 * Unmount resources before app shutdown
	 */
	public unmount(): void {
		// Remove the input system's event listeners
		this.context?.input.detach();

		// Additional unmount as needed
		console.log('Application resources unmounted');
	}

	/**
	 * Main game loop.
	 *
	 * beginFrame closes the previous frame's record and hands back the delta,
	 * already clamped to 0.25 s (R13.9), so the timer owns both halves of the
	 * frame interval and neither loop can compute it differently.
	 *
	 * The four sections are disjoint and exhaustive of the application's own
	 * work (R13.7), in R8.16's order: update, layout, render, flush. The clear belongs inside render because it is a GL command
	 * for the frame being drawn; it is the backend's `beginFrame`, which
	 * `game.render` opens. Since DDB-55 phase 1 the render section is CPU
	 * work and flush is the frame's whole GL submission; before it, render
	 * held every shape's.
	 */
	private loop = (): void => {
		const deltaTime = this.frameTimer.beginFrame();

		// R13.32's pause branch is inside Game.update rather than here, so a
		// paused page keeps clearing and rendering and a capture still gets a
		// frame; the timer's frame start advances on paused frames too, so
		// resume hands update a normal delta instead of the whole pause.
		this.frameTimer.beginSection('update');
		// R7.3: a resize takes effect here, at the top of the frame, and the
		// screens hear about it before they update.
		this.renderer.viewport.commit();
		this.game.update(deltaTime);
		this.frameTimer.endSection('update');

		this.frameTimer.beginSection('layout');
		this.game.layout();
		this.frameTimer.endSection('layout');

		this.frameTimer.beginSection('render');
		this.game.render();
		this.frameTimer.endSection('render');

		this.frameTimer.beginSection('flush');
		this.game.flush();
		this.frameTimer.endSection('flush');

		this.frameTimer.endFrame();
	};
}

// Create and initialize the application
const app = new Application();
app.init().catch((error) => {
	console.error('Application failed to start:', error);
});
