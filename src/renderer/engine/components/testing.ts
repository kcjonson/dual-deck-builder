import type { Clock } from '../animation/Clock';
import { DrawApi, NullBackend } from '../draw';
import { ClipRect, Rect, transformedBounds } from '../draw/geometry';
import type { Component } from './Component';
import { MountContext, MountContextOptions, ViewportSource, createMountContext } from './MountContext';
import { InjectionResult, InjectionTarget, injectInput } from '../debug/inputInjection';

export interface TestContextOptions {
	/** Defaults to a null-backend draw API, so the whole walk runs with no GL (R14.1). */
	draw?: DrawApi;
	/** Defaults to the harness's fixed 1440 by 882 viewport (R13.37). */
	viewport?: ViewportSource;
	/** A clock the test holds, to freeze or inspect (R13.37). */
	clock?: Clock;
	/** Hears the dispatcher's resolved cursor, as a page's canvas would. */
	onCursorChange?: MountContextOptions['onCursorChange'];
}

/** A mount context for tests, built through the same factory the pages use. */
export function createTestContext({ draw, viewport, clock, onCursorChange }: TestContextOptions = {}): MountContext {
	return createMountContext({
		draw: draw ?? new DrawApi({ backend: new NullBackend(), development: false }),
		viewport: viewport ?? { logical: { width: 1440, height: 882 } },
		clock,
		onCursorChange,
	});
}

/**
 * R13.35's injection followed by the next frame's input phase, so a test sees
 * the effect at once. The events still travel the adapter and the queue
 * (R9.25); only the wait for a frame is skipped.
 */
export function injectNow(target: InjectionTarget, commands: string[]): InjectionResult {
	const result = injectInput(target, commands);
	target.dispatcher.dispatchPending();
	return result;
}

/** `rect`, in `component`'s content box, on screen: the bounds of its transformed corners, so a rotation or a scale counts. */
export function rectOnScreen(component: Component, rect: Rect): ClipRect {
	return transformedBounds(component.screenMatrix, rect);
}

/** What `component` draws now (its `revealInk`, or its box where that has no bound) on screen. */
export function inkOnScreen(component: Component): ClipRect {
	return rectOnScreen(component, component.revealInk ?? { x: 0, y: 0, width: component.width, height: component.height });
}

/** `component`'s clip on screen. */
export function clipOnScreen(component: Component): ClipRect {
	return rectOnScreen(component, component.clipRect);
}

/** Expects `inner` inside `outer` on `axis` (or both), to a millionth of a pixel. */
export function expectWithin(inner: ClipRect, outer: ClipRect, axis: 'x' | 'y' | 'both' = 'both'): void {
	if (axis !== 'x') {
		expect(inner.minY).toBeGreaterThanOrEqual(outer.minY - 1e-6);
		expect(inner.maxY).toBeLessThanOrEqual(outer.maxY + 1e-6);
	}
	if (axis !== 'y') {
		expect(inner.minX).toBeGreaterThanOrEqual(outer.minX - 1e-6);
		expect(inner.maxX).toBeLessThanOrEqual(outer.maxX + 1e-6);
	}
}
