import type { ConsoleMessage, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { BASE_URL } from '../../../playwright.config';

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
 *    Layer and Panel scale their scissor rectangles by it.
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
 *    means `window.__perf.snapshot()` fails on every clocked page. Nothing the
 *    phase 0 goldens capture reads `Date` (the only wall-clock reader is the
 *    frame timer's own snapshot timestamp), so the freeze costs nothing today.
 *    The clock becomes necessary the moment a spec wants a state behind a
 *    timer, PlayerHandLayer's 300 ms discard being the first; whoever needs it
 *    has to deal with that `performance` collision first. DDB-61's FrameTimer
 *    does take an injected clock, but neither entry point passes one - both
 *    call `new FrameTimer()` - so there is no route from a running page to a
 *    fixed-step render clock today regardless.
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

/** Changing this reshuffles every deck and invalidates every golden. */
const RANDOM_SEED = 0x5eed1e57;

/**
 * The dev surface as this harness uses it. Members are required here, unlike
 * the engine's own optional declarations: nothing below runs before the page
 * has been observed to install them, so "absent" is a failure with a name
 * rather than a case every call site has to re-handle. `Partial<DevSurface>`
 * is what the waits are written against.
 */
interface DevSurface {
	__ui: { tree(): unknown; lint(): { count: number } };
	__app: {
		navigate(screen: string): boolean;
		pause(): void;
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
 * resolved, no data fetch is outstanding, the frame loop has advanced, and two
 * consecutive frames serialize to the same tree.
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
 */
export async function settle(page: Page): Promise<void> {
	await page.waitForFunction(() => {
		const scope = window as Partial<DevSurface>;
		return typeof scope.__ui?.tree === 'function'
			&& typeof scope.__app?.status === 'function'
			&& typeof scope.__perf?.snapshot === 'function';
	});

	await page.evaluate(() => document.fonts.ready.then(() => undefined));

	await page.waitForFunction(
		() => (window as unknown as DevSurface).__app.status().assetsReady === true,
	);

	const before = await frameCount(page);
	await page.waitForFunction(
		(minimum: number) => (window as unknown as DevSurface).__perf.snapshot().liveness.frameCount > minimum,
		before + 2,
	);

	await page.waitForFunction(async () => {
		const scope = window as unknown as DevSurface;
		const first = JSON.stringify(scope.__ui.tree());
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
		return JSON.stringify(scope.__ui.tree()) === first;
	});
}

async function frameCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as unknown as DevSurface).__perf.snapshot().liveness.frameCount);
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
export async function openScreen(page: Page, screen: string): Promise<void> {
	// Absolute, not baseURL-relative: an Electron page has no browser context
	// and therefore no baseURL, and both projects have to reach the same server.
	await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
	await freezeApplication(page);

	const navigated = await page.evaluate(
		(name: string) => (window as unknown as DevSurface).__app.navigate(name),
		screen,
	);
	expect(navigated, `window.__app.navigate('${screen}') should be accepted`).toBe(true);

	await settle(page);

	const status = await page.evaluate(() => (window as unknown as DevSurface).__app.status());
	expect(status.screen).toBe(screen);
	expect(status.paused).toBe(true);
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
 * Assert the run was clean. There is no allow-list: the one scenario that
 * emits a known error, DDB-103's per-frame buffer overflow on the
 * primitive-shapes scene, is `test.fixme` and never reaches this call, so an
 * allowance would be dead code whose only effect is to make the next error
 * easy to normalise. It returns with the DDB-103 fix if that scene still needs
 * one afterwards.
 */
export function expectCleanConsole(log: ConsoleLog): void {
	expect(log.errors, `console errors:\n${log.errors.join('\n')}`).toEqual([]);
}

/** The golden name, derived one way only so a spec cannot invent a second. */
export function goldenName(kind: 'screen' | 'scene', name: string): string {
	return `${kind}-${name}.png`;
}

/** The tree behind a red diff, attached to the report. */
export async function attachTree(page: Page, testInfo: TestInfo): Promise<void> {
	const tree = await page.evaluate(() => JSON.stringify((window as unknown as DevSurface).__ui.tree(), null, '\t'));
	await testInfo.attach('tree.json', { body: tree, contentType: 'application/json' });
}
