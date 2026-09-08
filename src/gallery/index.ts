import { Renderer } from '../renderer/engine/rendering/Renderer';
import { Shader } from '../renderer/engine/rendering/Shader';
import { RendererContext } from '../renderer/engine/rendering/RendererContext';
import { InputSystem } from '../renderer/engine/input/InputSystem';
import { PerformanceMonitor } from '../renderer/engine/rendering/PerformanceMonitor';
import { installDebugHooks, installAppHooks } from '../renderer/engine/debug/hooks';
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
 * are a separate matter and only two of them exist. The consequence for phase
 * 0's Playwright work is that the harness has to run against a development
 * build.
 *
 * The bootstrap mirrors src/index.ts deliberately: the same renderer, the same
 * RendererContext singleton, the same InputSystem setup, the same shader, and
 * a frame loop with the same shape. A gallery that renders through a different
 * path would prove things about the gallery rather than about the game.
 */
class GalleryApplication {
	private renderer!: Renderer;
	private performanceMonitor!: PerformanceMonitor;
	private host!: SceneHost;
	private lastTime = 0;

	public init(): void {
		try {
			this.performanceMonitor = new PerformanceMonitor();
			this.renderer = new Renderer('game-canvas', this.performanceMonitor);
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
			this.installHooks();

			window.addEventListener('resize', () => this.host.resize());

			this.lastTime = performance.now();
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

	private installHooks(): void {
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
	}

	/**
	 * Same shape as the game loop. The paused branch is inside the host rather
	 * than here so that rendering, and only rendering, keeps running: a paused
	 * gallery still presents the frame a screenshot needs. lastTime advances on
	 * every frame including paused ones, so resuming after a long pause hands
	 * update a normal delta rather than the whole pause.
	 */
	private loop = (): void => {
		this.performanceMonitor.beginFrame();

		const currentTime = performance.now();
		const deltaTime = (currentTime - this.lastTime) / 1000;
		this.lastTime = currentTime;

		this.host.update(deltaTime);

		this.renderer.clear();
		this.renderer.beginTextBatch();
		this.host.render();
		if (this.renderer.isScissorEnabled()) {
			this.renderer.disableScissor();
		}
		this.renderer.flushTextBatch();
		this.renderer.endTextBatch();

		this.performanceMonitor.endFrame();

		requestAnimationFrame(this.loop);
	};
}

const gallery = new GalleryApplication();

if (document.readyState === 'loading') {
	window.addEventListener('DOMContentLoaded', () => gallery.init());
} else {
	gallery.init();
}
