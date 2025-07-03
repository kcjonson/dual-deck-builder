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
	
	// Resize handler reference for cleanup
	private resizeHandler: (() => void) | null = null;

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

		// Don't add resize listener in constructor - let mount/unmount handle it
	}

	/**
	 * Get the screen's identifier
	 */
	public getId(): string {
		return this.id;
	}

	/**
	 * Mount the screen (make it active)
	 * @param data Optional data to pass to the screen
	 */
	public mount(data?: unknown): void {
		this.isActive = true;
		
		// Create and add resize listener
		this.resizeHandler = this.handleResize.bind(this);
		window.addEventListener('resize', this.resizeHandler);
		
		// Call onMount - handle both sync and async versions
		try {
			const mountResult = this.onMount(data);
			// Check if it's a promise
			if (mountResult && typeof mountResult === 'object' && 'then' in mountResult) {
				(mountResult as Promise<void>).catch(err => {
					console.error(`Error in onMount for screen ${this.id}:`, err);
				});
			}
		} catch (err) {
			console.error(`Error in onMount for screen ${this.id}:`, err);
		}
	}

	/**
	 * Unmount the screen (make it inactive)
	 */
	public unmount(): void {
		this.isActive = false;
		
		// Remove resize listener
		if (this.resizeHandler) {
			window.removeEventListener('resize', this.resizeHandler);
			this.resizeHandler = null;
		}
		
		this.onUnmount();
		
		// Don't cleanup here - screens can manage their own cleanup if needed
		// This allows screens to persist their UI between mount/unmount cycles
	}

	/**
	 * Check if the screen is currently active
	 */
	public isScreenActive(): boolean {
		return this.isActive;
	}
	
	/**
	 * Handle external resize events
	 * @param width New window width
	 * @param height New window height
	 */
	public resize(width: number, height: number): void {
		// Update the root layer size
		this.rootLayer.setSize(width, height);
		
		// Call the screen-specific resize handler
		this.onResized();
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
	 * Hook called when the screen is mounted
	 * Override in subclasses to handle mount logic
	 * @param data Optional data passed when mounting the screen
	 */
	protected onMount(_data?: unknown): void | Promise<void> {
		// Override in subclasses
	}

	/**
	 * Hook called when the screen is unmounted
	 * Override in subclasses to handle unmount logic
	 */
	protected onUnmount(): void {
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
