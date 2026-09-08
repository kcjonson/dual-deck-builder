import { Renderer } from './renderer/engine/rendering/Renderer';
import { Shader } from './renderer/engine/rendering/Shader';
import { Game } from './renderer/game/Game';
import { RendererContext } from './renderer/engine/rendering/RendererContext';
import { InputSystem } from './renderer/engine/input/InputSystem';
import { PerformanceMonitor } from './renderer/engine/rendering/PerformanceMonitor';
import vertexShaderSource from './assets/shaders/vertex.glsl';
import fragmentShaderSource from './assets/shaders/fragment.glsl';

/**
 * Main entry point for the application
 */
class Application {
	private renderer!: Renderer;
	private game!: Game;
	private performanceMonitor!: PerformanceMonitor;
	private lastTime = 0;

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

			// Initialize performance monitoring
			this.performanceMonitor = new PerformanceMonitor();

			// Create the WebGL renderer
			this.renderer = new Renderer('game-canvas', this.performanceMonitor);

			// Set up the global renderer context
			RendererContext.getInstance().setRenderer(this.renderer);

			// Initialize the input system with the canvas
			const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
			InputSystem.getInstance().setup(canvas);

			// Create default shader
			const shader = new Shader(
				this.renderer.getContext(),
				vertexShaderSource,
				fragmentShaderSource,
			);
			this.renderer.useShader(shader);

			// Create and initialize the game
			this.game = new Game(this.renderer, this.performanceMonitor);
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
				installInputHooks(canvas);
			}

			// Start the main loop
			this.lastTime = performance.now();
			this.loop();

			console.log('Initialization complete!');
		} catch (error) {
			console.error('Failed to initialize application:', error);
		}
	}

	/**
	 * Unmount resources before app shutdown
	 */
	public unmount(): void {
		// Unmount the input system to remove event listeners
		InputSystem.getInstance().unmount();

		// Additional unmount as needed
		console.log('Application resources unmounted');
	}

	/**
	 * Main game loop
	 */
	private loop = (): void => {
		// Start performance tracking for this frame
		this.performanceMonitor.beginFrame();
		
		const currentTime = performance.now();
		const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
		this.lastTime = currentTime;

		// Update game state. R13.32's pause branch is inside Game.update rather
		// than here, so a paused page keeps clearing and rendering and a capture
		// still gets a frame; lastTime advances on paused frames too, so resume
		// hands update a normal delta instead of the whole pause.
		this.game.update(deltaTime);

		// Clear the screen
		this.renderer.clear();

		// Render the game
		this.game.render();
		
		// End performance tracking for this frame
		this.performanceMonitor.endFrame();
		
		// Queue the next frame
		requestAnimationFrame(this.loop);
	};
}

// Create and initialize the application
const app = new Application();
app.init().catch((error) => {
	console.error('Application failed to start:', error);
});
