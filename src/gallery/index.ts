import { Renderer } from '../renderer/engine/rendering/Renderer';
import { Shader } from '../renderer/engine/rendering/Shader';
import { RendererContext } from '../renderer/engine/rendering/RendererContext';
import { InputSystem } from '../renderer/engine/input/InputSystem';
import { FrameTimer } from '../renderer/engine/rendering/FrameTimer';
import { installDebugHooks, installAppHooks, installInputHooks, installPerfHooks } from '../renderer/engine/debug/hooks';
import { gallerySceneRegistry } from './registry';
import { SceneHost } from './SceneHost';
import vertexShaderSource from '../assets/shaders/vertex.glsl';
import fragmentShaderSource from '../assets/shaders/fragment.glsl';

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
 * RendererContext singleton, the same InputSystem setup, the same shader, and
 * a frame loop with the same shape. A gallery that renders through a different
 * path would prove things about the gallery rather than about the game.
 */
class GalleryApplication {
	private renderer!: Renderer;
	private frameTimer!: FrameTimer;
	private host!: SceneHost;

	public init(): void {
		try {
			this.frameTimer = new FrameTimer();
			this.renderer = new Renderer('game-canvas', this.frameTimer);
			RendererContext.getInstance().setRenderer(this.renderer);

			const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
			InputSystem.getInstance().setup(canvas);

			const shader = new Shader(this.renderer.getContext(), vertexShaderSource, fragmentShaderSource);
			this.renderer.useShader(shader);

			this.host = new SceneHost({
				scenes: gallerySceneRegistry,
				viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
			});

			this.mountFromLocation();
			this.installHooks(canvas);

			window.addEventListener('resize', () => this.host.resize());

			this.loop();
		} catch (error) {
			console.error('Gallery failed to start:', error);
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
			viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
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
			status: () => this.host.status(),
		});

		// R13.35, on the same canvas the InputSystem listens to. The gallery
		// gets it for the same reason it gets the tree and the lint: a scripted
		// run drives a scene the way it drives a screen.
		installInputHooks(canvas);

		// R13.11's scene name is the gallery's own, which is the grouping key a
		// per-scene capture (R13.38) writes into perf-results.
		installPerfHooks({
			snapshot: () => this.frameTimer.snapshot({ scene: this.host.sceneName }),
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

		this.frameTimer.beginSection('update');
		this.host.update(deltaTime);
		this.frameTimer.endSection('update');

		this.frameTimer.beginSection('render');
		this.renderer.clear();
		this.renderer.beginTextBatch();
		this.host.render();
		this.frameTimer.endSection('render');

		this.frameTimer.beginSection('flush');
		// Inside the flush section, not at the end of render: disabling the
		// scissor flushes whatever text is pending, and that is a flush.
		if (this.renderer.isScissorEnabled()) {
			this.renderer.disableScissor();
		}
		this.renderer.flushTextBatch();
		this.renderer.endTextBatch();
		this.frameTimer.endSection('flush');

		this.frameTimer.endFrame();

		requestAnimationFrame(this.loop);
	};
}

const gallery = new GalleryApplication();

if (document.readyState === 'loading') {
	window.addEventListener('DOMContentLoaded', () => gallery.init());
} else {
	gallery.init();
}
