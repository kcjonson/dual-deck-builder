import { Animator } from '../animation/Animator';
import { Clock } from '../animation/Clock';
import type { DrawApi } from '../draw/DrawApi';
import { Dispatcher } from '../input/Dispatcher';
import type { DragService } from '../input/DragService';
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
 * Services arrive with the tasks that build them, as fields added here:
 * `focus` (DDB-76), and `popups`, `tooltips`, `placement`, `overlays`,
 * `clipboard` and `assets` (DDB-78).
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
	/** R9.12's drag and drop: `start` from a `pointerdown`, and `isDragging` for tooltips (R9.12e). */
	readonly drag: DragService;
}

export interface MountContextOptions {
	draw: DrawApi;
	viewport: ViewportSource;
	/** A test's own clock, to hold or freeze; otherwise a fresh one (R13.37). */
	clock?: Clock;
}

/**
 * The one way to build a context, for the two pages and for tests alike: the
 * frame advances the clock and ticks the animator at the start of its update
 * phase, and the dispatcher lays out on demand before every hit test and
 * times gestures on the same clock (R8.16, R8.28). Reduced motion starts
 * off; the platform shell follows the system preference
 * (`followReducedMotion`).
 */
export function createMountContext({ draw, viewport, clock = new Clock() }: MountContextOptions): MountContext {
	const animator = new Animator({ clock });
	const frame = new UiFrame({ clock, animator });
	const dispatcher = new Dispatcher({ frame, clock, pixelRatio: () => draw.devicePixelScale });
	return { draw, dispatcher, viewport, frame, clock, animator, drag: dispatcher.drag };
}
