import { DrawApi } from '../renderer/engine/draw';
import { Renderer, showStatusLine } from '../renderer/engine/rendering/Renderer';
import { createDrawApi } from '../renderer/engine/rendering/WebGL2Backend';
import { FrameLoop } from '../renderer/engine/rendering/FrameLoop';
import { MountContext, createMountContext } from '../renderer/engine/components/MountContext';
import { ReducedMotion } from '../renderer/engine/rendering/reducedMotion';
import { FrameTimer } from '../renderer/engine/rendering/FrameTimer';
import { PointerAdapter } from '../renderer/engine/input/PointerAdapter';
import { GpuTimer, createGpuTimer } from '../renderer/engine/rendering/GpuTimer';
import { createDevToolsTracks } from '../renderer/engine/debug/devtoolsTracks';
import { createHitchObserver } from '../renderer/engine/debug/hitchObserver';
import { FontAtlasError } from '../renderer/engine/text/FontAtlas';
import { fontLoadFailureMessage, loadFontAtlases, loadImageElement } from '../renderer/engine/text/loadFontAtlases';
import { installDebugHooks, installAppHooks, installInputHooks, installPerfHooks } from '../renderer/engine/debug/hooks';
import { CardLoader } from '../renderer/game/core/CardLoader';
import { gallerySceneRegistry } from './registry';
import { SceneHost } from './SceneHost';
import { detectClipboard } from '../renderer/engine/services/ClipboardService';
import { imageUrlLoader } from '../renderer/engine/services/AssetService';

/**
 * The scene gallery (R13.30 to R13.33): a second application over the same
 * engine that mounts exactly one scene, chosen by `?scene=`, so a scripted run
 * or a screenshot starts on the scene under test.
 *
 * This is a separate webpack entry emitted in development builds only. Because
 * `npm run build:web` forces NODE_ENV=production, and both deploy workflows
 * call it, the gallery is absent from every deployed artifact without a second
 * gate, which is R15.37's development-builds-only half; the rule's four globals
 * are a separate matter and all four now exist (`__ui`, `__app`, `__dev`,
 * `__perf`). The consequence for phase 0's Playwright work is that the harness
 * has to run against a development build.
 *
 * The bootstrap mirrors src/index.ts deliberately: the same renderer, the same
 * mount context factory, the same input setup, the same backend, and
 * a frame loop with the same shape. A gallery that renders through a different
 * path would prove things about the gallery rather than about the game.
 */
class GalleryApplication {
	private renderer!: Renderer;
	private draw!: DrawApi;
	private frameTimer!: FrameTimer;
	private gpuTimer!: GpuTimer;
	private host!: SceneHost;
	private frameLoop!: FrameLoop;
	private context!: MountContext;

	public async init(): Promise<void> {
		try {
			const fontAtlases = loadFontAtlases({ loadImage: loadImageElement });
			// Handled here too, so a renderer that throws before the await
			// below does not leave the load's rejection unhandled.
			fontAtlases.catch(() => undefined);
			// The gallery is a development-only bundle, so the DevTools track and
			// the hitch observer (R15.29) and the GPU timer (R13.16) need no
			// build-time gate here.
			this.frameTimer = new FrameTimer({ tracks: createDevToolsTracks(), hitches: createHitchObserver() });
			this.renderer = new Renderer('game-canvas');
			this.gpuTimer = createGpuTimer(this.renderer);

			// Line for line what src/index.ts does, through the same factories.
			this.draw = createDrawApi({
				renderer: this.renderer,
				frameTimer: this.frameTimer,
				gpuTimer: this.gpuTimer,
				fontAtlases: await fontAtlases,
			});
			const canvas = this.renderer.canvas;
			this.context = createMountContext({
				draw: this.draw,
				viewport: this.renderer.viewport,
				clipboard: detectClipboard(window),
				assetLoader: imageUrlLoader(),
				onCursorChange: (cursor) => {
					canvas.style.cursor = cursor;
				},
			});
			new ReducedMotion({ animator: this.context.animator });
			new PointerAdapter({ dispatcher: this.context.dispatcher }).attach(canvas);

			this.host = new SceneHost({
				scenes: gallerySceneRegistry,
				context: this.context,
			});

			this.mountFromLocation();
			this.installHooks(canvas);

			// R7.11: the viewport owner, not the window, says when the size changed.
			this.renderer.viewport.onChange(() => {
				this.context.frame.viewportChanged();
				this.host.resize();
			});

			this.frameLoop = new FrameLoop({ tick: this.loop });
			// A resize measured after this update's rAF runs its frame before paint.
			this.renderer.viewport.onPending = () => this.frameLoop.runNow();
			this.renderer.addContextListener({
				lost: () => this.frameLoop.stop(),
				restored: () => this.frameLoop.start(),
			});
			this.frameLoop.start();
		} catch (error) {
			console.error('Gallery failed to start:', error);
			if (error instanceof FontAtlasError) showStatusLine(fontLoadFailureMessage(error));
		}
	}

	/**
	 * The host mounts what `?scene=` asks for, or the default when it asks for
	 * something unknown; the console is the human-facing half of that report
	 * and `window.__app.status().resolution` is the machine-readable half.
	 */
	private mountFromLocation(): void {
		const resolution = this.host.mountFromSearch(window.location.search);

		if (resolution.status === 'empty') {
			console.error('Gallery: the scene registry is empty');
		} else if (resolution.status === 'unknown') {
			console.error(
				`Gallery: unknown scene "${resolution.requested}", mounted "${this.host.sceneName}" instead. `
					+ `Known scenes: ${this.host.names.join(', ')}`,
			);
		}
	}

	private installHooks(canvas: HTMLCanvasElement): void {
		if (!__DEV_TOOLS__) return;

		// R13.33: the scene's roots reach the tree snapshot and the layout lint
		// through the same installer the game app uses, so window.__ui.tree()
		// and window.__ui.lint() mean the same thing on both pages.
		installDebugHooks({
			roots: () => this.host.roots(),
			viewport: () => ({ ...this.renderer.viewport.logical, ratio: this.renderer.viewport.state.ratio }),
		});

		installAppHooks({
			scene: (name: string) => this.host.mount(name),
			reload: () => this.host.reload(),
			pause: () => {
				this.host.paused = true;
			},
			resume: () => {
				this.host.paused = false;
			},
			settleAnimations: () => this.context.animator.settle(),
			// R14.5's readiness gate, the same field the game page reports.
			// No gallery scene fetches anything today, so this is constantly
			// true here; it is present because the harness reads one control
			// surface across both pages, and a field that is simply absent
			// would satisfy a gate exactly as well as a field that is true.
			status: () => ({ ...this.host.status(), assetsReady: !CardLoader.getInstance().loading }),
		});

		// R13.35, on the same canvas the pointer adapter listens to. The gallery
		// gets it for the same reason it gets the tree and the lint: a scripted
		// run drives a scene the way it drives a screen.
		installInputHooks({ canvas, dispatcher: this.context.dispatcher });

		// R13.11's scene name is the gallery's own, which is the grouping key a
		// per-scene capture (R13.38) writes into perf-results.
		installPerfHooks({
			snapshot: () => this.frameTimer.snapshot({
				scene: this.host.sceneName,
				device: this.renderer.device,
				// Null before the first frame: an unopened draw API's zeros
				// would read as a measured empty frame (R13.5).
				batcher: this.draw.frame > 0 ? this.draw.getStats() : null,
				gpu: this.gpuTimer.stats,
			}),
			gpuTimer: this.gpuTimer,
		});
	}

	/**
	 * Same shape as the game loop, and the same three disjoint sections (R13.7),
	 * so a frame time captured in the gallery means what one captured on the
	 * game page means. The paused branch is inside the host rather than here so
	 * that rendering, and only rendering, keeps running: a paused gallery still
	 * presents the frame a screenshot needs. The timer's frame start advances on
	 * every frame including paused ones, so resuming after a long pause hands
	 * update a normal delta rather than the whole pause, and the clamp of R13.9
	 * catches the case where it does not.
	 */
	private loop = (): void => {
		const deltaTime = this.frameTimer.beginFrame();

		// R8.16 and R9.2: the input queued since the last frame, first.
		this.frameTimer.beginSection('input');
		this.context.dispatcher.dispatchPending();
		this.frameTimer.endSection('input');

		this.frameTimer.beginSection('update');
		// R7.3, as on the game page: the resize lands at the top of the frame.
		this.renderer.viewport.commit();
		this.host.update(deltaTime);
		this.frameTimer.endSection('update');

		this.frameTimer.beginSection('layout');
		this.host.layout();
		this.frameTimer.endSection('layout');

		this.frameTimer.beginSection('render');
		// Clears the target too: the clear is the render pass's (R15.38).
		this.draw.beginFrame(this.renderer.viewport.frame);
		this.host.render(this.draw);
		this.frameTimer.endSection('render');

		this.frameTimer.beginSection('flush');
		// endFrame drains the frame's sort domain and the backend paints it, text
		// included. A clip change is not a barrier (R3.20), so this section is
		// the whole frame's submission.
		this.draw.endFrame();
		this.frameTimer.endSection('flush');

		this.frameTimer.endFrame();
	};
}

const gallery = new GalleryApplication();

if (document.readyState === 'loading') {
	window.addEventListener('DOMContentLoaded', () => gallery.init());
} else {
	gallery.init();
}
