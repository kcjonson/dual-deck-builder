import { Layer } from '../renderer/engine/components/Layer';
import { InputSystem } from '../renderer/engine/input/InputSystem';
import type { SnapshotViewport } from '../renderer/engine/debug/treeSnapshot';
import type { GalleryScene } from './registry';
import type { SceneResolution } from './sceneSelection';
import { resolveScene } from './sceneSelection';

/**
 * Mounts one gallery scene at a time (R13.30) and owns the R13.32 control
 * state: pause, resume, reload, switch.
 *
 * Nothing here touches the DOM. The viewport arrives as a supplier and the
 * scene list as an argument, so the mount/unmount discipline this class exists
 * to enforce is exercised by unit tests with no canvas and no GL (R13.4,
 * R14.1). The bootstrap in index.ts supplies the window, the frame loop, and
 * the renderer.
 *
 * The root layer holds the mounted scene and nothing else: no menu, no scene
 * picker, no title bar. R13.30 wants a scripted capture to start on the scene
 * under test "with no navigation chrome in the picture", and chrome you have
 * to hide is chrome that shows up in a golden the first time someone forgets.
 */

export interface SceneHostOptions {
	scenes: readonly GalleryScene[];
	/** Logical viewport in CSS pixels, read fresh on every mount (R7.1). */
	viewport: () => SnapshotViewport;
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
	private readonly readViewport: () => SnapshotViewport;
	private readonly margin: number;
	private readonly rootLayer: Layer;
	private mounted: GalleryScene | null = null;
	private mountedRoot: Layer | null = null;
	private requestedName: string | null = null;
	private resolutionStatus: SceneResolutionStatus | null = null;
	/** The viewport the mounted scene was built for; resize compares against it. */
	private mountedWidth = 0;
	private mountedHeight = 0;
	private isPaused = false;
	private updates = 0;
	private renders = 0;

	constructor({ scenes, viewport, margin = DEFAULT_MARGIN }: SceneHostOptions) {
		this.scenes = scenes;
		this.readViewport = viewport;
		this.margin = margin;

		const { width, height } = viewport();
		this.rootLayer = new Layer({ id: 'gallery_root', x: 0, y: 0, width, height });
	}

	/**
	 * The roots R13.33 hands to the tree snapshot and the layout lint. One
	 * root, the viewport-sized container, with the scene beneath it. The
	 * serializer walks `debugChildren` rather than `getChildren`, which is what
	 * makes a Panel scene report its background and content layer instead of
	 * the content layer's children one level too shallow.
	 */
	public roots(): Layer[] {
		return [this.rootLayer];
	}

	public get root(): Layer {
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
	 * R13.35 leans on it: injected input must be ignored while paused. This
	 * engine dispatches input straight from DOM listeners rather than from the
	 * frame loop, so stopping the loop's update alone would leave clicks and
	 * keystrokes landing on components; the InputSystem flag is the half that
	 * makes the promise true.
	 */
	public set paused(value: boolean) {
		const resuming = this.isPaused && !value;
		this.isPaused = value;
		InputSystem.getInstance().paused = value;
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
	 * keydown handler with the InputSystem singleton from its constructor, so
	 * a switch that merely dropped the reference would leave every scene ever
	 * mounted hit-tested on every mouse move. removeChild unmounts the subtree
	 * it detaches, and Component.unmount unregisters, so the maps stay flat
	 * across switches. Focus is the one pointer that is not per-component
	 * bookkeeping: unregisterComponent clears it only for the component it is
	 * handed, and only if that component still holds it.
	 */
	public unmount(): void {
		if (!this.mountedRoot) return;

		InputSystem.setFocus(null);
		this.rootLayer.removeChild(this.mountedRoot);
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
		this.rootLayer.update(deltaTime);
	}

	public render(): void {
		this.renders++;
		this.rootLayer.render();
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
