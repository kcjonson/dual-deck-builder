import { Container } from '../../engine/components/Container';
import { renderTree } from '../../engine/components/renderTree';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { MountContext } from '../../engine/components/MountContext';

/**
 * Base class for game screens
 */
export abstract class Screen {
	protected id: string;
	protected rootLayer: Container;
	protected isActive = false;
	private mountContext: MountContext | null = null;

	/**
	 * Create a new screen
	 * @param id Screen identifier
	 */
	constructor(id: string) {
		this.id = id;
		// Zero-sized until mount sizes it from the viewport (R8.21): nothing
		// in a screen reads the window, and anything placed from the root's
		// size is placed in onMount and onResized.
		this.rootLayer = new Container({ id });
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
	public get root(): Container {
		return this.rootLayer;
	}

	/**
	 * The services this screen was mounted with. Only valid between `mount`
	 * and `unmount`, which is when every hook runs.
	 */
	protected get context(): MountContext {
		if (!this.mountContext) throw new Error(`Screen ${this.id} is not mounted`);
		return this.mountContext;
	}

	/**
	 * Mount the screen: size and mount its root with the context, then run
	 * `onMount`, so everything it builds is mounted as it is added (R8.15).
	 * @param context The mount context every component in the screen receives
	 * @param data Optional data to pass to the screen
	 */
	public mount(context: MountContext, data?: unknown): void {
		this.mountContext = context;
		this.isActive = true;
		const { width, height } = context.viewport.logical;
		this.rootLayer.setSize(width, height);
		this.rootLayer.mount(context);

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

		// Releases every registration in the tree (R8.22).
		this.rootLayer.unmount();
		this.mountContext = null;
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

		// Components are updated by the frame, on request (R8.17).
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
	public render(draw: DrawApi): void {
		if (!this.isActive) return;

		renderTree(this.rootLayer, draw);

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
