import type { Clock } from '../animation/Clock';
import { DrawApi, NullBackend } from '../draw';
import { MountContext, ViewportSource, createMountContext } from './MountContext';
import { InjectionResult, InjectionTarget, injectInput } from '../debug/inputInjection';

export interface TestContextOptions {
	/** Defaults to a null-backend draw API, so the whole walk runs with no GL (R14.1). */
	draw?: DrawApi;
	/** Defaults to the harness's fixed 1440 by 882 viewport (R13.37). */
	viewport?: ViewportSource;
	/** A clock the test holds, to freeze or inspect (R13.37). */
	clock?: Clock;
}

/** A mount context for tests, built through the same factory the pages use. */
export function createTestContext({ draw, viewport, clock }: TestContextOptions = {}): MountContext {
	return createMountContext({
		draw: draw ?? new DrawApi({ backend: new NullBackend(), development: false }),
		viewport: viewport ?? { logical: { width: 1440, height: 882 } },
		clock,
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
