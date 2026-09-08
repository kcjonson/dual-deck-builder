import type { Layer } from '../components/Layer';
import type { SnapshotDocument, SnapshotViewport } from './treeSnapshot';
import { treeSnapshot } from './treeSnapshot';

/**
 * Installs the development-only `window.__ui` surface (R13.2, R15.37).
 *
 * Everything here is behind `if (__DEV_TOOLS__)`, which webpack's DefinePlugin
 * folds to `false` in a production build so the whole module drops out.
 *
 * `window.__ui.tree()` reads the live tree; it never mutates it, so no layout
 * pass is forced. Text sizes come from Layer.layout(), which the frame loop
 * never calls (Text.render only reads width and height, for alignment), so a
 * rendered frame is not sufficient: a Text that nothing sized explicitly and
 * that no screen ran layout over reports w = h = 0.
 */

export interface DebugRootSource {
	/** Active screen root plus any visible overlay. Nothing closed or hidden. */
	roots(): Layer[];
	/** Logical viewport in CSS pixels (R7.1). */
	viewport(): SnapshotViewport;
}

interface UiDebugApi {
	tree(): SnapshotDocument;
}

interface DebugWindow extends Window {
	__ui?: UiDebugApi;
}

export function installDebugHooks(source: DebugRootSource): void {
	if (!__DEV_TOOLS__) return;
	if (typeof window === 'undefined') return;

	const debugWindow = window as DebugWindow;
	const api: UiDebugApi = {
		tree: () => treeSnapshot(source.roots(), source.viewport()),
	};

	debugWindow.__ui = { ...debugWindow.__ui, ...api };
}
