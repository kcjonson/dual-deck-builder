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

			// Start the main loop
			this.lastTime = performance.now();
			this.loop();

			console.log('Initialization complete!');
		} catch (error) {
			console.error('Failed to initialize application:', error);
		}
	}

	/**
	 * Clean up resources before app shutdown
	 */
	public cleanup(): void {
		// Clean up the input system to remove event listeners
		InputSystem.getInstance().cleanup();

		// Additional cleanup as needed
		console.log('Application resources cleaned up');
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

		// Update game state
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
