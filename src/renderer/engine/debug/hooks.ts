import type { Layer } from '../components/Layer';
import type { SnapshotDocument, SnapshotViewport } from './treeSnapshot';
import { treeSnapshot } from './treeSnapshot';
import type { LintOptions, LintResult } from './layoutLint';
import { layoutLint } from './layoutLint';

/**
 * Installs the development-only `window.__ui` surface (R13.2, R15.37).
 *
 * R15.37 names four such globals. Two exist: `__ui` here and `__app` below.
 * `__dev` (input injection) and `__perf` (frame timing) do not.
 *
 * Everything here is behind `if (__DEV_TOOLS__)`, which webpack's DefinePlugin
 * folds to `false` in a production build so the whole module drops out.
 *
 * `window.__ui.tree()` reads the live tree; it never mutates it, so no layout
 * pass is forced. Text sizes come from Layer.layout(), which the frame loop
 * never calls (Text.render only reads width and height, for alignment), so a
 * rendered frame is not sufficient: a Text that nothing sized explicitly and
 * that no screen ran layout over reports w = h = 0.
 *
 * `window.__ui.lint()` runs R13.25's seven rules over that same document. It is
 * the identical pure function the unit tests call, per R13.4. Three of the
 * seven cannot fire against today's snapshot (text-overflow wants
 * `text.measured`, unreachable-interactive and target-size want `focusable` or
 * `pointerEvents`); they report `dormant: true` in `rules[]` rather than a
 * silent pass. Expect a large `count` on the game screens: R13.25.1 exempts a
 * pair on differing zIndex or layer and the snapshot emits neither, so nothing
 * is exempted. R13.29's `count: 0` gate is the gallery's first, per the
 * implementation spec's ground rules.
 */

export interface DebugRootSource {
	/** Active screen root plus any visible overlay. Nothing closed or hidden. */
	roots(): Layer[];
	/** Logical viewport in CSS pixels (R7.1). */
	viewport(): SnapshotViewport;
}

interface UiDebugApi {
	tree(): SnapshotDocument;
	lint(options?: LintOptions): LintResult;
}

/**
 * R13.32's control hooks. Every member is optional because the two entry
 * points expose different halves of it: the gallery drives scenes, the game
 * app navigates screens, and both install into the same `window.__app` so a
 * harness reads one surface (R15.37).
 *
 * There is no `vsync` member. R13.32 asks for it "where applicable" and the
 * chapter 13 mapping table answers the browser column with an Electron launch
 * flag (`--disable-frame-rate-limit --disable-gpu-vsync`), not an in-page
 * call. A hook that could not turn vsync off would be a lie in the API shape.
 */
export interface AppControlApi {
	/** Gallery: mount a scene by name. False when no such scene. */
	scene?(name: string): boolean;
	/** Gallery: re-enter the mounted scene. */
	reload?(): boolean;
	/** Game app: navigate to a screen by name. False when no such screen. */
	navigate?(screenName: string): boolean;
	/** Game app: the screens navigate accepts. */
	screens?(): string[];
	pause?(): void;
	resume?(): void;
	/** Machine-readable control state, including the pause evidence counters. */
	status?(): unknown;
}

interface DebugWindow extends Window {
	__ui?: UiDebugApi;
	__app?: AppControlApi;
}

export function installDebugHooks(source: DebugRootSource): void {
	if (!__DEV_TOOLS__) return;
	if (typeof window === 'undefined') return;

	const debugWindow = window as DebugWindow;
	const api: UiDebugApi = {
		tree: () => treeSnapshot(source.roots(), source.viewport()),
		lint: (options?: LintOptions) => layoutLint(treeSnapshot(source.roots(), source.viewport()), options),
	};

	debugWindow.__ui = { ...debugWindow.__ui, ...api };
}

/**
 * Installs the development-only `window.__app` control surface (R13.32).
 * Merges, so an entry point can add its half without erasing the other's.
 */
export function installAppHooks(api: AppControlApi): void {
	if (!__DEV_TOOLS__) return;
	if (typeof window === 'undefined') return;

	const debugWindow = window as DebugWindow;
	debugWindow.__app = { ...debugWindow.__app, ...api };
}
