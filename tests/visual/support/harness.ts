import { readFile, writeFile } from 'node:fs/promises';
import type { ConsoleMessage, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { BASE_URL, FIXED_VIEWPORT, GOLDEN_CLUSTER, VISUAL_THRESHOLD } from '../../../playwright.config';
import type { Viewport } from '../../../playwright.config';
import type { LintResult } from '../../../src/renderer/engine/debug/layoutLint';
import { compareClusters, diffImage } from './diffClusters';
import type { DiffReport } from './diffClusters';

/**
 * R13.37's deterministic capture controls, in one place so both projects get
 * all of them and nobody has to remember the list.
 *
 * The five controls and what each one kills:
 *
 * 1. Fixed viewport (`FIXED_VIEWPORT` in playwright.config.ts, applied by the
 *    chromium project's `use` and by the electron spec's `setContentSize`)
 *    - kills the layout difference between one runner's window and another's.
 *    Every screen and every section lays out from a width, so this is upstream
 *    of everything else here.
 * 2. Fixed device pixel ratio (`deviceScaleFactor: 1`) - kills glyph raster
 *    and backing-store differences. FontAtlas scales its 2D context by
 *    devicePixelRatio, Renderer.resize sizes the drawing buffer by it, and
 *    Container and Panel scale their scissor rectangles by it.
 * 3. A time freeze, through the engine's own pause seam (`freezeApplication`)
 *    - kills animation phase. R13.37 asks for a time freeze *or* a fixed-step
 *    hook; `window.__app.pause()` (R13.32) is the freeze, and it is the right
 *    one here because it stops `update` while rendering continues, so the
 *    splash screen stops counting down towards its navigate while the canvas
 *    keeps presenting the frame the screenshot needs.
 *
 *    Playwright's Clock API is deliberately not used, and this is the one
 *    place the harness departs from the letter of a rule. It departs from two:
 *    R15.36 names the Clock API, and R14.5 asks for a fixed-step injected
 *    render clock, which a pause is not either. R13.37 is the rule that allows
 *    what is done instead, since it asks for a time freeze *or* a fixed-step
 *    hook, and this is the freeze. Two reasons for taking that option.
 *    `clock.pauseAt` also stops `requestAnimationFrame`, which stops the frame
 *    loop, so the harness would be photographing a page that is no longer
 *    drawing. And any clock call at all, `setFixedTime` included, replaces the
 *    page's `performance` object with a plain stand-in whose
 *    `measureUserAgentSpecificMemory` is `() => {}`; the dev server sets the
 *    cross-origin isolation headers, so `FrameTimer.requestMemorySample` takes
 *    the live branch, calls that stub, and throws on `undefined.then` - which
 *    means `window.__perf.snapshot()` fails on every clocked page.
 *
 *    The engine's own clock is what makes the freeze sufficient (DDB-74). UI
 *    code takes time only from the mount context's `clock` and `animator`
 *    (lint forbids platform timers there), and the clock advances only in the
 *    update phase the pause skips, so a paused page has no UI timer running
 *    at all. What pausing alone would leave is a tween frozen on the frame it
 *    started; `settle` runs every tween to its end through
 *    `__app.settleAnimations()`, so a capture shows where an animation lands,
 *    which does not depend on how many frames the page drew first.
 * 4. Seeded random (`seedRandom`) - kills draw order and model identity. See
 *    the note on that function.
 * 5. Wait-for-assets gate (`settle`) - kills the half-loaded frame. Two
 *    separate checks that prove different things. `assetsReady` on
 *    `window.__app.status()` is the one that waits for `cards.json`, and it
 *    reads fetch state rather than drawing: it is false while CardLoader has a
 *    request outstanding. The two-frame tree comparison proves only that the
 *    tree stopped changing, which an unstarted fetch satisfies exactly as well
 *    as a finished one, so it catches settling layout and not late data.
 */

/**
 * How long `settle` waits for the layout and the tree to hold still. Well
 * under the 60 s test timeout, so a page that never settles fails with the
 * sizes it was stuck at rather than as an anonymous timeout.
 */
const SETTLE_TIMEOUT_MS = 15_000;

/** Changing this reshuffles every deck and invalidates every golden. */
const RANDOM_SEED = 0x5eed1e57;

/**
 * The part of `window.__ui.tree()` the harness reads. Stated here rather than
 * imported from `treeSnapshot.ts`, which would pull the engine, and its build
 * globals, into the test project's typecheck.
 */
interface TreeSnapshot {
	viewport: { width: number; height: number };
	roots: { bounds: { x: number; y: number; w: number; h: number } }[];
}

/**
 * The dev surface as this harness uses it. Members are required here, unlike
 * the engine's own optional declarations: nothing below runs before the page
 * has been observed to install them, so "absent" is a failure with a name
 * rather than a case every call site has to re-handle. `Partial<DevSurface>`
 * is what the waits are written against.
 */
export interface DevSurface {
	__ui: { tree(): TreeSnapshot; lint(): LintResult };
	__app: {
		navigate(screen: string, data?: unknown): boolean;
		pause(): void;
		settleAnimations(): number;
		status(): {
			screen?: string;
			scene?: string;
			resolution?: string;
			paused?: boolean;
			assetsReady?: boolean;
		};
	};
	__perf: { snapshot(): { liveness: { frameCount: number } } };
}

/**
 * Replace `Math.random` with a seeded mulberry32 before any application script
 * runs (R13.37's seeded random source).
 *
 * Done from the harness rather than through an engine hook on purpose. Four
 * call sites consume randomness - `Deck.shuffle`, `Model`'s id generation,
 * `RandomAI`, `AIEvaluator` - and threading an injected source through all of
 * them is a refactor of game code that phase 0 is not allowed to make, while
 * an `addInitScript` covers every one of them, plus any added later, and
 * cannot leak into a shipped build because it lives in the test process.
 *
 * What it changes today: measurably nothing, and that is worth writing down
 * rather than glossing. Running the combat golden under a different seed, and
 * again with the seeding removed entirely, produced byte-identical captures.
 * `Deck.shuffle` has exactly one caller, `Driver.reshuffleDiscardIntoDeck`,
 * which fires only when a deck runs dry, so the opening hand is dealt in deck
 * order and a mounted screen consumes no randomness that reaches a pixel.
 * `Model.__id` is random but is only ever a map key.
 *
 * Why it is here anyway: the states phase 0 does not capture are the ones that
 * do vary. Playing a card and capturing what follows is the case where 72 of
 * the combat screen's 355 lint rows differed run to run, and that state
 * becomes goldenable the moment someone wants it, without a second look at
 * this question. It is a precondition, installed before it is needed, which is
 * the cheap order to do it in.
 */
async function seedRandom(page: Page, seed: number = RANDOM_SEED): Promise<void> {
	await page.addInitScript((value: number) => {
		let state = value >>> 0;
		Math.random = () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}, seed);
}

/** Everything that has to be in place before the first navigation. */
export async function prepare(page: Page): Promise<void> {
	await seedRandom(page);
}

export interface ConsoleLog {
	messages: string[];
	errors: string[];
}

/**
 * Capture the console (R15.36). A missing GL context is not an exception here:
 * `Renderer` throws, `src/index.ts` catches, and the page renders black, which
 * is indistinguishable from a legitimately dark golden. The console is the
 * only place that failure is visible, so every spec asserts on it.
 */
export function captureConsole(page: Page): ConsoleLog {
	const log: ConsoleLog = { messages: [], errors: [] };
	page.on('console', (message: ConsoleMessage) => {
		const text = `${message.type()}: ${message.text()}`;
		log.messages.push(text);
		if (message.type() === 'error') log.errors.push(text);
	});
	page.on('pageerror', (error: Error) => {
		log.errors.push(`pageerror: ${error.message}`);
	});
	return log;
}

/**
 * Freeze the application through R13.32's pause hook: update stops, rendering
 * continues. Called before navigating to the screen under test so the splash
 * screen's countdown never runs and cannot navigate out from under the shot.
 */
export async function freezeApplication(page: Page): Promise<void> {
	await page.waitForFunction(() => typeof (window as Partial<DevSurface>).__app?.pause === 'function');
	await page.evaluate(() => {
		(window as unknown as DevSurface).__app.pause();
	});
}

/**
 * The wait-for-assets gate. Returns once the dev hooks exist, web fonts have
 * resolved, no data fetch is outstanding, every tween has run to its end, the
 * layout has settled at the fixed viewport, and two frames later the layout
 * still holds, nothing new has animated, and the tree serializes the same.
 *
 * The `assetsReady` wait is the one that does the job the gate is named for.
 * The tree comparison cannot stand in for it: a screen whose `cards.json` has
 * not resolved serializes identically frame after frame, so "the tree stopped
 * changing" is true of the pre-data frame too, and a mint run would commit
 * that as the golden. Reproduced with a delayed route on `cards.json` before
 * this wait existed: the gate returned against a 1,786-character tree where
 * the loaded one is 89,108.
 *
 * `assetsReady === true` is required explicitly rather than tested for
 * falsiness, so a page that never installed the field fails the gate instead
 * of passing it by omission.
 *
 * The layout half is DDB-201's, and it names the sizes a capture depends on
 * rather than inferring them from a still tree. A resize reaches a screen in
 * three steps: the window changes (and screens still read `innerWidth` when
 * they build), the `ResizeObserver` measures the canvas box into a pending
 * viewport, and the next frame commits it, resizing the backing store and
 * calling `Screen.resize`, which on driver selection tears the whole screen
 * down and rebuilds it. A capture between the first step and the last is a
 * screen laid out for a size the golden is not at. So the gate requires all of
 * them to agree with `FIXED_VIEWPORT` at once: the window, the canvas's CSS
 * box, its backing store, and the committed viewport, read from the tree
 * snapshot (which is `CanvasViewport.logical`). Checking the CSS box directly
 * is stronger than asking the engine whether a measurement is pending, since
 * it also covers a resize the observer has not reported yet.
 *
 * Agreement is then held across at least two frames, counted on the frame
 * timer rather than assumed from `requestAnimationFrame`, so any screen that
 * heard a commit has rebuilt and drawn, and the tree (viewport included) must
 * serialize the same for all of those frames; any disagreement or change
 * starts the count again.
 */
export async function settle(page: Page, size: Viewport = FIXED_VIEWPORT): Promise<void> {
	await page.waitForFunction(() => {
		const scope = window as Partial<DevSurface>;
		return typeof scope.__ui?.tree === 'function'
			&& typeof scope.__app?.status === 'function'
			&& typeof scope.__app?.settleAnimations === 'function'
			&& typeof scope.__perf?.snapshot === 'function';
	});

	await page.evaluate(() => document.fonts.ready.then(() => undefined));

	await page.waitForFunction(
		() => (window as unknown as DevSurface).__app.status().assetsReady === true,
	);

	// One evaluate that polls in the page, not a `waitForFunction`: that
	// takes an async predicate's Promise as its truthy answer and returns on
	// the first poll, which is how the two-frame tree comparison this replaces
	// passed on every capture without comparing anything (DDB-201).
	const outcome = await page.evaluate(async ({ size, timeout }) => {
		const scope = window as unknown as DevSurface;
		const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
		const agrees = (): boolean => {
			if (!canvas) return false;
			const ratio = window.devicePixelRatio;
			const { viewport } = scope.__ui.tree();
			return window.innerWidth === size.width && window.innerHeight === size.height
				&& canvas.clientWidth === size.width && canvas.clientHeight === size.height
				&& canvas.width === Math.round(size.width * ratio) && canvas.height === Math.round(size.height * ratio)
				&& viewport.width === size.width && viewport.height === size.height;
		};
		const frames = (): number => scope.__perf.snapshot().liveness.frameCount;
		// Raced against a timer so the deadline still fires if frames stop,
		// which is the case it most needs to report.
		const nextFrame = (): Promise<void> => new Promise((resolve) => {
			const timer = setTimeout(resolve, Math.max(0, deadline - performance.now()));
			requestAnimationFrame(() => {
				clearTimeout(timer);
				resolve();
			});
		});

		const deadline = performance.now() + timeout;
		let held = null as { tree: string; since: number } | null;
		while (performance.now() < deadline) {
			// Paused, nothing ticks the animator, so each pass runs whatever
			// the last frame started to its end; a pass that had to finish
			// something starts the count again.
			if (scope.__app.settleAnimations() > 0) held = null;
			if (agrees()) {
				const tree = JSON.stringify(scope.__ui.tree());
				if (held?.tree !== tree) held = { tree, since: frames() };
				else if (frames() >= held.since + 2) return null;
			} else {
				held = null;
			}
			await nextFrame();
		}
		return {
			window: [window.innerWidth, window.innerHeight],
			canvasBox: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
			backingStore: canvas ? [canvas.width, canvas.height] : null,
			viewport: scope.__ui.tree().viewport,
			layoutAgreed: held !== null,
		};
	}, { size, timeout: SETTLE_TIMEOUT_MS });

	if (outcome) {
		throw new Error(
			`The layout did not settle at ${size.width}x${size.height} `
				+ `within ${SETTLE_TIMEOUT_MS} ms: ${JSON.stringify(outcome)}`,
		);
	}
}

export interface OpenScreenOptions {
	/** What `navigate` hands the screen, as the game would pass it. */
	data?: unknown;
	/**
	 * The window the page is already at, when it is not `FIXED_VIEWPORT`. The
	 * spec sizes it (`page.setViewportSize`, or the Electron window's content
	 * size); this is what the settle and the root check hold it to.
	 */
	viewport?: Viewport;
}

/**
 * Drive the game page to one screen, paused, settled and verified.
 *
 * The navigation path is pinned to exactly one `navigate` from the boot screen
 * (DDB-106: driver selection issues 49 GPU draws on its first mount and 33 on
 * every one after, so "how did we get here" is part of what the golden shows).
 * The screen name is read back rather than assumed, because `navigate` returns
 * false for an unknown name and a golden of the splash screen filed under
 * another screen's name is worse than a failure.
 */
export async function openScreen(page: Page, screen: string, { data, viewport = FIXED_VIEWPORT }: OpenScreenOptions = {}): Promise<void> {
	// Absolute, not baseURL-relative: an Electron page has no browser context
	// and therefore no baseURL, and both projects have to reach the same server.
	await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
	await freezeApplication(page);

	const navigated = await page.evaluate(
		([name, payload]: [string, unknown]) => (window as unknown as DevSurface).__app.navigate(name, payload),
		[screen, data] as [string, unknown],
	);
	expect(navigated, `window.__app.navigate('${screen}') should be accepted`).toBe(true);

	await settle(page, viewport);

	const status = await page.evaluate(() => (window as unknown as DevSurface).__app.status());
	expect(status.screen).toBe(screen);
	expect(status.paused).toBe(true);

	// Every screen's root layer is the viewport, and `Screen.resize` is what
	// keeps it so; a root at any other size is a screen that built before the
	// last commit and never heard it (DDB-201).
	const root = await page.evaluate(() => (window as unknown as DevSurface).__ui.tree().roots[0]?.bounds);
	expect(root, `${screen}'s root layer should fill the viewport`).toEqual({ x: 0, y: 0, w: viewport.width, h: viewport.height });
}

/**
 * Open one gallery scene, paused, settled and verified.
 *
 * `resolution` is checked, not just the name: an unknown `?scene=` mounts the
 * default rather than nothing, which is exactly the substitution that would
 * otherwise produce a plausible screenshot of the wrong scene under a stale
 * golden's filename.
 */
export async function openScene(page: Page, scene: string): Promise<void> {
	await page.goto(`${BASE_URL}/gallery.html?scene=${encodeURIComponent(scene)}`, { waitUntil: 'domcontentloaded' });
	await freezeApplication(page);
	await settle(page);

	const status = await page.evaluate(() => (window as unknown as DevSurface).__app.status());
	expect(status.scene).toBe(scene);
	expect(status.resolution).toBe('requested');
	expect(status.paused).toBe(true);
}

/**
 * Assert the run was clean. There is no allow-list: a scenario with a known
 * error is `blockedBy`, so `test.fixme`, and never reaches this call. An
 * allowance would be dead code whose only effect is to make the next error
 * easy to normalise.
 */
export function expectCleanConsole(log: ConsoleLog): void {
	expect(log.errors, `console errors:\n${log.errors.join('\n')}`).toEqual([]);
}

/** The golden name, derived one way only so a spec cannot invent a second. */
export function goldenName(kind: 'screen' | 'scene', name: string): string {
	return `${kind}-${name}.png`;
}

/** The text snapshot's name beside the golden's, so the pair is one scenario's. */
export function textSnapshotName(kind: 'screen' | 'scene', name: string): string {
	return `${kind}-${name}-text.json`;
}

/**
 * Every string on screen, checked against its committed record (DDB-206).
 *
 * The cluster rule cannot see punctuation: `.` to `,` and `:` to `;` at body
 * sizes differ by a few pixels that pixelmatch classes as anti-aliasing, so
 * they come back as zero differing pixels (the mutation table in
 * docs/AI_TECHNICAL_DECISIONS/visual-golden-harness.md). The tree snapshot
 * holds every Text node's string, every text field's value (masked for a
 * password) or, while it is empty, its placeholder, and the strings a
 * component draws itself (`labels`, joined with ` | `), so the strings are
 * asserted directly: one line per text with its path, its content, and its
 * rounded screen rect.
 *
 * The record keeps every string that is visible and not faded out through the
 * whole ancestor chain, and not clipped or scrolled wholly out of the
 * viewport. Those cuts drop text the scenario never draws, which the
 * developer screen's scrolled-out sections are most of. Occlusion is not
 * tested: a string painted over by an opaque sibling or a modal is still
 * recorded, so changing it fails the scenario though its picture is the
 * same. That is deliberate: a covered string is still one the product
 * shows once whatever covers it goes away, and the tree has no opacity-aware
 * occlusion test to make the cut honestly.
 *
 * The record lives beside the PNG under `__screenshots__`, named by the same
 * template, so it is minted by the same dispatch and the provenance job holds
 * it to the same rule: a pull request never carries a hand-written one.
 */
export async function expectTextSnapshot(page: Page, kind: 'screen' | 'scene', name: string): Promise<void> {
	const lines = await page.evaluate(() => {
		interface Rect { x: number; y: number; w: number; h: number }
		interface Node {
			id: string | null;
			type: string;
			visible: boolean;
			opacity?: number;
			screenBounds: Rect;
			clip?: Rect;
			text?: { content: string };
			/** A text field's value, masked for a password, and its placeholder. */
			value?: string;
			placeholder?: string;
			/** Strings a component draws itself (a select's label, a menu's rows). */
			labels?: string[];
			parts?: Node[];
			children: Node[];
		}
		const document = (window as unknown as { __ui: { tree(): { viewport: { width: number; height: number }; roots: Node[] } } }).__ui.tree();
		const viewport: Rect = { x: 0, y: 0, w: document.viewport.width, h: document.viewport.height };
		const round = (value: number): number => Math.round(value * 100) / 100;
		const meets = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
		const out: string[] = [];

		// The layout lint's path rule (R13.28): ids when present, Type[index]
		// otherwise, parts and children numbered as one list.
		const walk = (nodes: Node[], parentPath: string): void => {
			const ids = new Map<string, number>();
			for (const node of nodes) if (node.id) ids.set(node.id, (ids.get(node.id) ?? 0) + 1);
			nodes.forEach((node, index) => {
				if (!node.visible || node.opacity === 0) return;
				const segment = node.id ? ((ids.get(node.id) ?? 0) > 1 ? `${node.id}[${index}]` : node.id) : `${node.type}[${index}]`;
				const path = parentPath ? `${parentPath}/${segment}` : segment;
				const box = node.screenBounds;
				// A text field draws its value (or its placeholder) itself, with no Text node.
				const shown = node.text?.content ?? (node.value ? node.value : node.placeholder) ?? node.labels?.join(' | ');
				if (shown && meets(box, node.clip ?? viewport) && meets(box, viewport)) {
					out.push(JSON.stringify({
						path,
						text: shown,
						rect: [round(box.x), round(box.y), round(box.w), round(box.h)],
					}));
				}
				walk([...(node.parts ?? []), ...node.children], path);
			});
		};
		walk(document.roots, '');
		return out;
	});

	expect(lines.length, `${kind} "${name}" shows no text at all, so its text record would check nothing`).toBeGreaterThan(0);
	// Soft, and taken before the golden, so a change both checks see reports
	// both: the string that changed here and the picture below.
	expect.soft(`[\n${lines.join(',\n')}\n]\n`).toMatchSnapshot(textSnapshotName(kind, name));
}

/** The tree behind a red diff, attached to the report. */
export async function attachTree(page: Page, testInfo: TestInfo): Promise<void> {
	const tree = await page.evaluate(() => JSON.stringify((window as unknown as DevSurface).__ui.tree(), null, '\t'));
	await testInfo.attach('tree.json', { body: tree, contentType: 'application/json' });
}

/**
 * Compare the page against its golden: Playwright's area budget first, then
 * the cluster rule (DDB-197), which fails a capture whose differing pixels
 * include one dense region larger than `GOLDEN_CLUSTER.maxClusterPixels` even
 * when the total is under `maxDiffPixels`. See `diffClusters.ts` for why.
 *
 * The cluster report is taken whether or not the area check passed and written
 * to the test's output directory as `golden-diff.json` (uploaded with the
 * report on CI), so every run records how far each capture was from its golden
 * on both measures. That file is the cross-runner variance measurement the
 * budgets are justified against, taken on every run rather than once.
 *
 * The comparison runs against a second capture, which is the same frame:
 * the page is paused and settled, and consecutive captures are bit-exact.
 *
 * On a mint, a golden the cluster rule rejects is rewritten here, because
 * `--update-snapshots=changed` only rewrites what `toHaveScreenshot` itself
 * rejected, and a golden this rule fails would otherwise survive the mint that
 * was run to replace it. `all` has already rewritten it and compares clean.
 */
export async function expectGolden(page: Page, testInfo: TestInfo, kind: 'screen' | 'scene', name: string): Promise<void> {
	const file = goldenName(kind, name);
	const areaFailure = await expect(page).toHaveScreenshot(file).then(() => null, (error: unknown) => error);

	const goldenPath = testInfo.snapshotPath(file, { kind: 'screenshot' });
	const expected = await readFile(goldenPath).catch(() => null);
	if (!expected) throw areaFailure ?? new Error(`${goldenPath} is missing after toHaveScreenshot`);

	const actual = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
	let report: DiffReport;
	try {
		report = compareClusters({ expected, actual, threshold: VISUAL_THRESHOLD, joinRadius: GOLDEN_CLUSTER.joinRadius });
	} catch (error) {
		// A size mismatch throws here, and Playwright has already failed the
		// same capture with the better message.
		throw areaFailure ?? error;
	}
	await writeFile(testInfo.outputPath('golden-diff.json'), JSON.stringify({ golden: file, ...report }, null, '\t'));
	// Kept whenever anything differs, passing or not, so a nonzero report on
	// a green run can be looked at rather than only counted.
	if (report.differing > 0) await writeFile(testInfo.outputPath(file.replace(/\.png$/, '-actual.png')), actual);
	testInfo.annotations.push({ type: 'golden-diff', description: describeDiff(report) });

	if (areaFailure) throw areaFailure;

	const largest = report.largest;
	if (!largest || largest.size <= GOLDEN_CLUSTER.maxClusterPixels) return;

	const updateMode = testInfo.config.updateSnapshots;
	if (updateMode === 'changed' || updateMode === 'all') {
		await writeFile(goldenPath, actual);
		testInfo.annotations.push({ type: 'golden-rewritten', description: `cluster rule: ${describeDiff(report)}` });
		return;
	}

	await testInfo.attach(file.replace(/\.png$/, '-actual.png'), { body: actual, contentType: 'image/png' });
	await testInfo.attach(file.replace(/\.png$/, '-diff.png'), {
		body: diffImage({ expected, actual, threshold: VISUAL_THRESHOLD }),
		contentType: 'image/png',
	});
	const { x, y, w, h } = largest.bounds;
	throw new Error(
		`${file}: ${largest.size} differing pixels form one region at x ${x}, y ${y}, ${w}x${h}, `
			+ `over the cluster budget of ${GOLDEN_CLUSTER.maxClusterPixels} `
			+ `(${report.differing} differing in total, under the area budget). `
			+ 'A dense change this size is content, not noise: a changed number or glyph, a moved or missing element.',
	);
}

function describeDiff(report: DiffReport): string {
	return `${report.differing} px differ in ${report.clusters} clusters, largest ${report.largest?.size ?? 0} px`;
}
