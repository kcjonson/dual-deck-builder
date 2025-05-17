import { Renderer } from './renderer/engine/rendering/Renderer';
import { Shader } from './renderer/engine/rendering/Shader';
import { Game } from './renderer/game/Game';
import vertexShaderSource from './assets/shaders/vertex.glsl';
import fragmentShaderSource from './assets/shaders/fragment.glsl';

/**
 * Main entry point for the application
 */
class Application {
  private renderer!: Renderer;
  private game!: Game;
  private lastTime: number = 0;

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

      // Create the WebGL renderer
      this.renderer = new Renderer('game-canvas');
      
      // Create default shader
      const shader = new Shader(
        this.renderer.getContext(),
        vertexShaderSource,
        fragmentShaderSource
      );
      this.renderer.useShader(shader);
      
      // Create and initialize the game
      this.game = new Game(this.renderer);
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
   * Main game loop
   */
  private loop = (): void => {
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = currentTime;
    
    // Update game state
    this.game.update(deltaTime);
    
    // Clear the screen
    this.renderer.clear();
    
    // Render the game
    this.game.render();
    
    // Queue the next frame
    requestAnimationFrame(this.loop);
  }
}

// Create and initialize the application
const app = new Application();
app.init().catch(error => {
  console.error('Application failed to start:', error);
});
