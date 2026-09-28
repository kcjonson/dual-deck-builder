import { Animator } from '../animation/Animator';
import { Clock } from '../animation/Clock';
import type { DrawApi } from '../draw/DrawApi';
import { Dispatcher } from '../input/Dispatcher';
import { AssetLoader, AssetService } from '../services/AssetService';
import { ClipboardBackend, ClipboardService } from '../services/ClipboardService';
import { OverlayService } from '../services/OverlayService';
import { PlacementService } from '../services/Placement';
import { PopupService } from '../services/PopupService';
import { TooltipService } from '../services/TooltipService';
import { UiFrame } from './UiFrame';

/** The logical viewport a root is sized from (R7.11, R8.21). `CanvasViewport` is one. */
export interface ViewportSource {
	readonly logical: { readonly width: number; readonly height: number };
}

/**
 * R1.6 and R8.28: the one object a component reaches services through. The
 * platform shell builds it and every root is mounted with it (R8.15); nothing
 * in the tree reads a global.
 *
 * Construction touches none of it (R8.14). A component gets the context in
 * `onMount` and releases what it registered in `onUnmount`; the base class
 * already releases what `dispatcher` and `frame` hold on it.
 *
 * Still to arrive, as fields added here by the tasks that build them:
 * `focus` (DDB-76) and `drag` (DDB-77).
 */
export interface MountContext {
	/** Chapter 2's draw API: drawing and `measureText`. */
	readonly draw: DrawApi;
	/** Chapter 9's dispatcher: the input queue, hit testing, hover, capture, hotkeys. */
	readonly dispatcher: Dispatcher;
	readonly viewport: ViewportSource;
	/** Update requests and layout invalidation for the frame (R8.16 to R8.18). */
	readonly frame: UiFrame;
	/** Frame time; the frame advances it, nothing reads a platform timer (R8.28). */
	readonly clock: Clock;
	/** Tweens over `clock`, ticked in the update phase (R8.28). */
	readonly animator: Animator;
	/** Anchor, flip, shift, and constrain inside the viewport (R12.30). */
	readonly placement: PlacementService;
	/** Roots above the scene's: dialogs, popovers, popups opened as roots, the tooltip (R8.21). */
	readonly overlays: OverlayService;
	/** The one open exclusive popup and its dismissal (R12.31). */
	readonly popups: PopupService;
	/** The `tooltip` property's hover and focus behaviour (R12.22). */
	readonly tooltips: TooltipService;
	readonly clipboard: ClipboardService;
	/** Images by key over the texture store (R12.32). */
	readonly assets: AssetService;
}

export interface MountContextOptions {
	draw: DrawApi;
	viewport: ViewportSource;
	/** A test's own clock, to hold or freeze; otherwise a fresh one (R13.37). */
	clock?: Clock;
	/** The platform's clipboard (`detectClipboard(window)`); text stays in the page without one. */
	clipboard?: ClipboardBackend;
	/** Decodes an image by key (`imageUrlLoader()` on the pages); without one every acquire fails. */
	assetLoader?: AssetLoader;
}

/**
 * The one way to build a context, for the two pages and for tests alike: the
 * frame advances the clock and ticks the animator at the start of its update
 * phase, and the dispatcher lays out on demand before every hit test and
 * times gestures on the same clock (R8.16, R8.28). Reduced motion starts
 * off; the platform shell follows the system preference
 * (`followReducedMotion`).
 *
 * The tooltip, popup, and overlay services observe the dispatcher in that
 * order: a press hides a tooltip even when a popup's close swallows it, and a
 * popup's Escape is taken before a dialog beneath it could be dismissed.
 */
export function createMountContext({ draw, viewport, clock = new Clock(), clipboard, assetLoader }: MountContextOptions): MountContext {
	const animator = new Animator({ clock });
	const frame = new UiFrame({ clock, animator });
	const dispatcher = new Dispatcher({ frame, clock, pixelRatio: () => draw.devicePixelScale });
	const placement = new PlacementService({ viewport });
	const overlays = new OverlayService({ viewport });
	const popups = new PopupService({ overlays, placement });
	const tooltips = new TooltipService({ overlays, placement, dispatcher, clock, animator, frame });
	const context: MountContext = {
		draw,
		dispatcher,
		viewport,
		frame,
		clock,
		animator,
		placement,
		overlays,
		popups,
		tooltips,
		clipboard: new ClipboardService({ backend: clipboard }),
		assets: new AssetService({ textures: draw, loader: assetLoader }),
	};
	overlays.bind(context);
	dispatcher.addObserver(tooltips);
	dispatcher.addObserver(popups);
	dispatcher.addObserver(overlays);
	return context;
}
