import { Container } from '../renderer/engine/components/Container';
import { renderTree } from '../renderer/engine/components/renderTree';
import type { DrawApi } from '../renderer/engine/draw/DrawApi';
import type { MountContext } from '../renderer/engine/components/MountContext';
import type { SnapshotViewport } from '../renderer/engine/debug/treeSnapshot';
import type { GalleryScene } from './registry';
import type { SceneResolution } from './sceneSelection';
import { resolveScene } from './sceneSelection';

/**
 * Mounts one gallery scene at a time (R13.30) and owns the R13.32 control
 * state: pause, resume, reload, switch.
 *
 * Nothing here touches the DOM. The mount context carries the viewport and
 * the scene list is an argument, so the mount/unmount discipline this class
 * exists to enforce is exercised by unit tests with no canvas and no GL
 * (R13.4, R14.1). The bootstrap in index.ts supplies the window, the frame
 * loop, and the renderer.
 *
 * The root layer holds the mounted scene and nothing else: no menu, no scene
 * picker, no title bar. R13.30 wants a scripted capture to start on the scene
 * under test "with no navigation chrome in the picture", and chrome you have
 * to hide is chrome that shows up in a golden the first time someone forgets.
 */

export interface SceneHostOptions {
	scenes: readonly GalleryScene[];
	/** The host's root mounts with it; its viewport is read fresh on every mount (R7.1). */
	context: MountContext;
	/** Gap between the viewport edge and the scene, in logical pixels. */
	margin?: number;
}

/**
 * How the mounted scene was chosen. `unknown` means the URL asked for a name
 * that is not in the registry and the host mounted the default instead, which
 * is the one outcome a screenshot harness must never capture silently.
 */
export type SceneResolutionStatus = 'requested' | 'default' | 'unknown';

export interface SceneHostStatus {
	scene: string | null;
	/** The name that was asked for, null when nothing asked for one. */
	requested: string | null;
	/** Null until something is mounted. */
	resolution: SceneResolutionStatus | null;
	scenes: string[];
	paused: boolean;
	/** Frames the host has updated and rendered since construction. */
	updates: number;
	renders: number;
	/** The mounted scene's own extent, known only after it was constructed. */
	content: { width: number; height: number } | null;
	viewport: SnapshotViewport;
}

const DEFAULT_MARGIN = 40;

export class SceneHost {
	private readonly scenes: readonly GalleryScene[];
	private readonly context: MountContext;
	private readonly margin: number;
	private readonly rootLayer: Container;
	private mounted: GalleryScene | null = null;
	private mountedRoot: Container | null = null;
	private requestedName: string | null = null;
	private resolutionStatus: SceneResolutionStatus | null = null;
	/** The viewport the mounted scene was built for; resize compares against it. */
	private mountedWidth = 0;
	private mountedHeight = 0;
	private isPaused = false;
	private updates = 0;
	private renders = 0;

	constructor({ scenes, context, margin = DEFAULT_MARGIN }: SceneHostOptions) {
		this.scenes = scenes;
		this.context = context;
		this.margin = margin;

		const { width, height } = this.readViewport();
		this.rootLayer = new Container({ id: 'gallery_root', x: 0, y: 0, width, height });
		this.rootLayer.mount(context);
	}

	private readViewport(): SnapshotViewport {
		const { width, height } = this.context.viewport.logical;
		return { width, height };
	}

	/**
	 * The roots R13.33 hands to the tree snapshot and the layout lint: the
	 * viewport-sized container, with the scene beneath it, then whatever the
	 * scene opened through the overlay service (R8.21). The
	 * serializer walks `debugChildren` rather than `getChildren`, which is what
	 * makes a Panel scene report its background and content layer instead of
	 * the content layer's children one level too shallow.
	 */
	public roots(): Container[] {
		return [this.rootLayer, ...this.context.overlays.roots];
	}

	public get root(): Container {
		return this.rootLayer;
	}

	public get sceneName(): string | null {
		return this.mounted ? this.mounted.name : null;
	}

	public get names(): string[] {
		return this.scenes.map((scene) => scene.name);
	}

	public get paused(): boolean {
		return this.isPaused;
	}

	/**
	 * R13.32's pause skips input and update while rendering continues, and
	 * R13.35 leans on it: injected input must be ignored while paused. The
	 * dispatcher's flag drops input at its queue, so nothing pressed or typed
	 * while paused is dispatched on resume either.
	 */
	public set paused(value: boolean) {
		const resuming = this.isPaused && !value;
		this.isPaused = value;
		this.context.dispatcher.paused = value;
		if (resuming) this.resize();
	}

	/**
	 * Mount a scene by name, replacing whatever is mounted. A direct call got
	 * exactly the scene it asked for, so the outcome status() reports is
	 * `requested`; only mountFromSearch can produce the other two.
	 * @returns false when no entry carries that name; the caller reports it.
	 */
	public mount(name: string): boolean {
		return this.mountResolved(name, name, 'requested');
	}

	/**
	 * Mount whatever a gallery URL asks for (R13.30), recording how the choice
	 * was made.
	 *
	 * An unknown `?scene=` name mounts the default rather than nothing: a blank
	 * canvas is the one outcome a screenshot harness cannot tell apart from a
	 * GL failure. But a substitution that only reached the console would let a
	 * stale golden name produce a plausible screenshot of the wrong scene, so
	 * the outcome lands in status().resolution too and a capture can refuse to
	 * proceed on anything but `requested`.
	 *
	 * @returns the raw resolution, so the caller can report `empty` and
	 * `unknown` on the console in its own words.
	 */
	public mountFromSearch(search: string): SceneResolution {
		const resolution = resolveScene(search, this.names);

		switch (resolution.status) {
			case 'empty':
				break;
			case 'unknown':
				this.mountResolved(this.names[0], resolution.requested, 'unknown');
				break;
			case 'default':
				this.mountResolved(resolution.name, null, 'default');
				break;
			default:
				this.mountResolved(resolution.name, resolution.name, 'requested');
		}

		return resolution;
	}

	private mountResolved(name: string, requested: string | null, resolution: SceneResolutionStatus): boolean {
		const scene = this.scenes.find((entry) => entry.name === name);
		if (!scene) return false;

		this.unmount();

		const viewport = this.readViewport();
		this.rootLayer.setSize(viewport.width, viewport.height);

		const sceneRoot = scene.factory({
			x: this.margin,
			y: this.margin,
			width: Math.max(0, viewport.width - this.margin * 2),
		});
		this.rootLayer.addChild(sceneRoot);

		// The scene's height exists only from here on: the section computes it
		// from its content and calls setSize on the last line of its
		// constructor. Anything that needs the extent (status().content, and
		// through it a capture that sizes the window to the scene) reads it
		// after the factory returns, never from the registry entry.

		// Text carries no size until layout() runs: Text.layout estimates an
		// extent from fontSize only when width and height are still 0, and the
		// frame loop never calls it. DeveloperScreen does the same thing in
		// onResized. Without it every Text in the scene reports w = h = 0 to
		// the snapshot and the lint's zero-or-negative-size rule fires on all
		// of them.
		this.rootLayer.layout();

		this.mounted = scene;
		this.mountedRoot = sceneRoot;
		this.requestedName = requested;
		this.resolutionStatus = resolution;
		this.mountedWidth = viewport.width;
		this.mountedHeight = viewport.height;
		return true;
	}

	/**
	 * Unmount the current scene.
	 *
	 * A scene switch is a teardown path the developer screen never exercises:
	 * it builds its sections once and lives until the screen does. Two of the
	 * sections construct Inputs, and an Input registers a mouse-down and a
	 * keydown handler with the input system on mount, so a switch that merely
	 * dropped the reference would leave every scene ever mounted hit-tested on
	 * every mouse move. removeChild unmounts the subtree it detaches, and the
	 * base class unregisters on unmount, so the maps stay flat across
	 * switches. Focus is blurred first rather than dropped by the unmount, so
	 * a focused input hears its `blur` and stops its caret (R9.21 drops focus
	 * on unmount without callbacks).
	 */
	public unmount(): void {
		if (!this.mountedRoot) return;

		this.context.focus.blur();
		this.rootLayer.removeChild(this.mountedRoot);
		// R8.22: whatever the scene opened above itself goes with it.
		this.context.popups.close();
		this.context.overlays.closeAll();
		this.mountedRoot = null;
		this.mounted = null;
		this.requestedName = null;
		this.resolutionStatus = null;
	}

	/**
	 * Re-enter the current scene, discarding whatever state it accumulated.
	 * How the scene was chosen is not state the scene accumulated, so it
	 * survives: a reload of a substituted scene is still a substitution.
	 */
	public reload(): boolean {
		return this.mounted
			? this.mountResolved(this.mounted.name, this.requestedName, this.resolutionStatus ?? 'requested')
			: false;
	}

	/**
	 * Re-enter on a genuine resize. A section lays itself out from the width it
	 * was constructed with and has no reflow path, so re-entering is the only
	 * way the scene matches the new window; the alternative is a scene that
	 * keeps the old width and quietly disagrees with the viewport the snapshot
	 * reports.
	 *
	 * Re-entering is destructive, though: every component in the scene is a new
	 * instance afterwards, so a harness holding a reference or a hit-tested
	 * coordinate is holding something detached. Two guards follow from that.
	 * A resize event that reports the size the scene was already built for
	 * does nothing at all, because the browser fires resize for zoom, for a
	 * devicePixelRatio change, and on some platforms for a window move. And a
	 * real resize while paused is deferred, not applied: pause exists so a
	 * capture can read the tree and inject input against a still scene
	 * (R13.32, R13.35), and swapping every instance underneath it would break
	 * exactly the promise pause makes. Resume applies whatever the window did
	 * meanwhile.
	 */
	public resize(): void {
		const { width, height } = this.readViewport();

		this.context.overlays.resize();
		if (!this.mounted) {
			this.rootLayer.setSize(width, height);
			return;
		}

		if (width === this.mountedWidth && height === this.mountedHeight) return;
		if (this.isPaused) return;

		this.reload();
	}

	public update(deltaTime: number): void {
		if (this.isPaused) return;
		this.updates++;
		this.context.frame.update(deltaTime);
	}

	/** R8.16's layout phase. Not gated by pause: a resize while paused still reflows. */
	public layout(): void {
		this.context.frame.layout();
	}

	public render(draw: DrawApi): void {
		this.renders++;
		renderTree(this.rootLayer, draw);
		this.context.overlays.render(draw);
	}

	/**
	 * Machine-readable control state (R13.3). `updates` and `renders` are what
	 * makes pause checkable from outside the process rather than by eye: while
	 * paused one of them keeps climbing and the other does not.
	 */
	public status(): SceneHostStatus {
		return {
			scene: this.sceneName,
			requested: this.requestedName,
			resolution: this.resolutionStatus,
			scenes: this.names,
			paused: this.isPaused,
			updates: this.updates,
			renders: this.renders,
			content: this.mountedRoot
				? { width: this.mountedRoot.getWidth(), height: this.mountedRoot.getHeight() }
				: null,
			viewport: this.readViewport(),
		};
	}
}
