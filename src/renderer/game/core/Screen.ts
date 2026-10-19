import { Container } from '../../engine/components/Container';
import { renderTree } from '../../engine/components/renderTree';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { MountContext } from '../../engine/components/MountContext';
import type { ThemeName } from '../../engine/theme/tokens';

export interface ScreenOptions {
	/**
	 * The screen's root. A stack with `fill` on both axes is the viewport's
	 * size from the frame's layout (R8.21) and lays its children out on every
	 * resize with no screen code. Default: a plain container the screen
	 * places by hand from `onMount` and `onResized`.
	 */
	root?: Container;
	/**
	 * The theme the screen's tree resolves tokens against, set on its root
	 * and inherited down. Default: the base theme, `dark` (UI Art Direction,
	 * open question 1: per-screen selection).
	 */
	theme?: ThemeName;
}

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
	 * @param options.root The screen's own root; a fill root stack is sized by the frame (R8.21)
	 */
	constructor(id: string, { root, theme }: ScreenOptions = {}) {
		this.id = id;
		// Zero-sized until mount: the default container is sized from the
		// viewport by `mount` and `resize`, so anything placed from its size is
		// placed in onMount and onResized; a fill root stack is sized by the
		// frame's layout instead. Nothing in a screen reads the window.
		this.rootLayer = root ?? new Container({ id });
		if (theme) this.rootLayer.theme = theme;
	}

	/**
	 * The screen's root layer, for the dev tree snapshot.
	 */
	public get root(): Container {
		return this.rootLayer;
	}

	/** The theme the screen's tree resolves against: its root's. */
	public get theme(): ThemeName {
		return this.rootLayer.effectiveTheme;
	}

	/** A root stack with `fill` on both axes: the frame sizes it from the viewport, never the screen. */
	private get rootFillsViewport(): boolean {
		return this.rootLayer.widthMode === 'fill' && this.rootLayer.heightMode === 'fill';
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
		if (!this.rootFillsViewport) {
			const { width, height } = context.viewport.logical;
			this.rootLayer.setSize(width, height);
		}
		this.rootLayer.mount(context);

		// Neither a throw nor an async onMount's rejection is caught here: both
		// reach the page's error overlay (DDB-538) rather than leaving a
		// half-built screen up with only a console line to say so.
		void this.onMount(data);
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
	 * The viewport changed (R7.11). The application shell is the one owner and
	 * calls this through `ScreenManager.resize`, at the top of the frame the new
	 * size takes effect in; a screen no longer listens to the window itself.
	 */
	public resize(width: number, height: number): void {
		// A fill root was re-laid out by the frame already (R8.21); a size set
		// here would fix it at this one.
		if (!this.rootFillsViewport) this.rootLayer.setSize(width, height);

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
