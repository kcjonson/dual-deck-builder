import type { DrawApi } from '../draw/DrawApi';
import { InputSystem } from '../input/InputSystem';
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
 * already unregisters it from `input` and `frame`.
 *
 * Services arrive with the tasks that build them, as fields added here:
 * `clock` and `animator` (DDB-74), the dispatcher that replaces `input`
 * (DDB-75), `focus` (DDB-76), `drag` (DDB-77), and `popups`, `tooltips`,
 * `placement`, `overlays`, `clipboard` and `assets` (DDB-78).
 */
export interface MountContext {
	/** Chapter 2's draw API: drawing and `measureText`. */
	readonly draw: DrawApi;
	/** Pointer and key registration until the dispatcher replaces it (DDB-75). */
	readonly input: InputSystem;
	readonly viewport: ViewportSource;
	/** Update requests and layout invalidation for the frame (R8.16 to R8.18). */
	readonly frame: UiFrame;
}

export interface MountContextOptions {
	draw: DrawApi;
	viewport: ViewportSource;
}

/**
 * The one way to build a context, for the two pages and for tests alike: the
 * input system lays out on demand before every hit test (R8.16).
 */
export function createMountContext({ draw, viewport }: MountContextOptions): MountContext {
	const frame = new UiFrame();
	const input = new InputSystem({ beforeHitTest: () => frame.layout() });
	return { draw, input, viewport, frame };
}
