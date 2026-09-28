import { Layer } from '../../engine/components/Layer';

/**
 * Base class for game screens
 */
export abstract class Screen {
	protected id: string;
	protected rootLayer: Layer;
	protected isActive = false;

	/**
	 * Create a new screen
	 * @param id Screen identifier
	 */
	constructor(id: string) {
		this.id = id;
		this.rootLayer = new Layer({
			id,
			x: 0,
			y: 0,
			width: window.innerWidth,
			height: window.innerHeight,
		});
	}

	/**
	 * Get the screen's identifier
	 */
	public getId(): string {
		return this.id;
	}

	/**
	 * The screen's root layer, for the dev tree snapshot.
	 */
	public get root(): Layer {
		return this.rootLayer;
	}

	/**
	 * Mount the screen (make it active)
	 * @param data Optional data to pass to the screen
	 */
	public mount(data?: unknown): void {
		this.isActive = true;

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

		this.onUnmount();
		
		// Unmount all child components to prevent input system leaks
		this.rootLayer.unmount();
	}

	/**
	 * Check if the screen is currently active
	 */
	public isScreenActive(): boolean {
		return this.isActive;
	}
	
	/**
	 * The viewport changed (R7.11). The application shell is the one owner and
	 * calls this through `ScreenManager.resize`, at the top of the frame the new
	 * size takes effect in; a screen no longer listens to the window itself.
	 */
	public resize(width: number, height: number): void {
		this.rootLayer.setSize(width, height);

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
