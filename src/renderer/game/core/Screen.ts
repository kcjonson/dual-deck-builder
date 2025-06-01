import { Layer } from '../../engine/components/Layer';
import { Renderer } from '../../engine/rendering/Renderer';

/**
 * Base class for game screens
 */
export abstract class Screen {
	protected id: string;
	protected renderer: Renderer;
	protected rootLayer: Layer;
	protected isActive = false;

	/**
	 * Create a new screen
	 * @param id Screen identifier
	 * @param renderer WebGL renderer
	 */
	constructor(id: string, renderer: Renderer) {
		this.id = id;
		this.renderer = renderer;
		this.rootLayer = new Layer({
			x: 0,
			y: 0,
			width: window.innerWidth,
			height: window.innerHeight,
		});

		// Listen for resize events
		window.addEventListener('resize', () => this.handleResize());
	}

	/**
	 * Get the screen's identifier
	 */
	public getId(): string {
		return this.id;
	}

	/**
	 * Handle screen activation
	 */
	public activate(): void {
		this.isActive = true;
		this.onActivate();
	}

	/**
	 * Handle screen deactivation
	 */
	public deactivate(): void {
		this.isActive = false;
		this.onDeactivate();
	}

	/**
	 * Check if the screen is currently active
	 */
	public isScreenActive(): boolean {
		return this.isActive;
	}

	/**
	 * Handle window resize events
	 */
	private handleResize(): void {
		// Update the root layer size
		this.rootLayer.setSize(window.innerWidth, window.innerHeight);

		// Call the screen-specific resize handler
		this.onResized();
	}

	/**
	 * Hook called when the screen is activated
	 * Override in subclasses to handle activation logic
	 */
	protected onActivate(): void {
		// Override in subclasses
	}

	/**
	 * Hook called when the screen is deactivated
	 * Override in subclasses to handle deactivation logic
	 */
	protected onDeactivate(): void {
		// Override in subclasses
	}

	/**
	 * Hook called when the window is resized
	 * Override in subclasses to handle resize logic
	 */
	protected onResized(): void {
		// Override in subclasses
	}

	/**
	 * Update the screen
	 * @param dt Time elapsed since last frame in seconds
	 */
	public update(dt: number): void {
		if (!this.isActive) return;

		// Update the root layer (which updates all children)
		this.rootLayer.update(dt);

		// Call the screen-specific update handler
		this.onUpdate(dt);
	}

	/**
	 * Hook called every frame to update the screen
	 * Override in subclasses to handle screen-specific update logic
	 * @param _dt Time elapsed since last frame in seconds
	 */
	protected onUpdate(_dt: number): void {
		// Override in subclasses
	}

	/**
	 * Render the screen
	 */
	public render(): void {
		if (!this.isActive) return;

		// Render the root layer (which renders all children)
		this.rootLayer.render();

		// Call the screen-specific render handler
		this.onRender();
	}

	/**
	 * Hook called every frame to render the screen
	 * Override in subclasses to handle screen-specific render logic
	 */
	protected onRender(): void {
		// Override in subclasses
	}
}
