import { DrawApi, NullBackend } from '../draw';
import { MountContext, ViewportSource, createMountContext } from './MountContext';

export interface TestContextOptions {
	/** Defaults to a null-backend draw API, so the whole walk runs with no GL (R14.1). */
	draw?: DrawApi;
	/** Defaults to the harness's fixed 1440 by 882 viewport (R13.37). */
	viewport?: ViewportSource;
}

/** A mount context for tests, built through the same factory the pages use. */
export function createTestContext({ draw, viewport }: TestContextOptions = {}): MountContext {
	return createMountContext({
		draw: draw ?? new DrawApi({ backend: new NullBackend(), development: false }),
		viewport: viewport ?? { logical: { width: 1440, height: 882 } },
	});
}
