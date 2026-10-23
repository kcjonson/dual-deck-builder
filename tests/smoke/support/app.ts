import type { ConsoleMessage, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { CAMPAIGN_KEY_PREFIX } from './campaignSaves';

/** How long a screen gets to mount and finish loading its data (a map regrows in the worker). */
const LOAD_TIMEOUT_MS = 30_000;

/** Frames a screen has to keep drawing after it loads, so a frame that throws on its first update is seen. */
const RUN_FRAMES = 30;

interface TreeNode {
	parts?: TreeNode[];
	children: TreeNode[];
}

/**
 * The dev hooks the screens project drives (src/renderer/engine/debug/hooks.ts),
 * declared here rather than imported so the engine and its build globals stay
 * out of the test typecheck.
 */
export interface DevSurface {
	__ui: { tree(): { roots: TreeNode[] } };
	__app: {
		navigate(screen: string, data?: unknown): boolean;
		status(): { screen?: string; assetsReady?: boolean };
	};
	__perf: { snapshot(): { liveness: { frameCount: number } } };
}

export interface ConsoleLog {
	messages: string[];
	errors: string[];
}

/**
 * Every console message and uncaught error on the page. A failed boot is not
 * an exception the test sees: `src/index.ts` catches it into console.error and
 * the error overlay (error-overlay.md), so the console is where it shows.
 */
export function captureConsole(page: Page): ConsoleLog {
	const log: ConsoleLog = { messages: [], errors: [] };
	page.on('console', (message: ConsoleMessage) => {
		const text = `${message.type()}: ${message.text()}`;
		log.messages.push(text);
		if (message.type() === 'error') log.errors.push(text);
	});
	page.on('pageerror', (error: Error) => {
		log.errors.push(`pageerror: ${error.stack ?? error.message}`);
	});
	return log;
}

/** No allow-list: an error the game logs is a failure until someone fixes it. */
export function expectCleanConsole(log: ConsoleLog): void {
	expect(log.errors, `console errors:\n${log.errors.join('\n')}`).toEqual([]);
}

/**
 * Polls `ready` until it holds, failing at once if the page logs an error
 * first, so a broken boot reports its error rather than a timeout.
 */
export async function waitClean(log: ConsoleLog, ready: () => Promise<boolean>, what: string, timeout = LOAD_TIMEOUT_MS): Promise<void> {
	const deadline = Date.now() + timeout;
	for (;;) {
		expectCleanConsole(log);
		if (await ready()) return;
		if (Date.now() > deadline) throw new Error(`${what} within ${timeout} ms`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

export interface ScreenCase {
	screen: string;
	/** Told apart from the screen's other cases in the test name. */
	variant?: string;
	/** What `navigate` hands the screen, as the game would pass it. */
	data?: unknown;
	/** Campaign saves in local storage when the screen mounts (campaignSaves.ts); none when left out. */
	storage?: Record<string, string>;
	/** The screen this one hands over to by itself, as the splash does to the main menu. */
	leadsTo?: string;
}

/**
 * Boot the dev build, put the case's saves in local storage, navigate once,
 * and hold the screen to four things: it mounted, it finished loading, it
 * kept drawing for `RUN_FRAMES` frames with updates running, and its layout
 * tree has content. A screen with `leadsTo` may have moved on to it by then.
 */
export async function openScreen(page: Page, log: ConsoleLog, { screen, data, storage = {}, leadsTo }: ScreenCase): Promise<void> {
	const expected = leadsTo ? [screen, leadsTo] : [screen];
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await waitClean(log, () => page.evaluate(() => typeof (window as Partial<DevSurface>).__app?.navigate === 'function'), 'the dev hooks did not install');

	// Before the navigate, since a screen reads the store as it mounts.
	await page.evaluate(([prefix, items]: [string, Record<string, string>]) => {
		const stale = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
			.filter((key): key is string => key !== null && key.startsWith(prefix));
		for (const key of stale) localStorage.removeItem(key);
		for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
	}, [CAMPAIGN_KEY_PREFIX, storage] as [string, Record<string, string>]);

	const navigated = await page.evaluate(
		([name, payload]: [string, unknown]) => (window as unknown as DevSurface).__app.navigate(name, payload),
		[screen, data] as [string, unknown],
	);
	expect(navigated, `window.__app.navigate('${screen}') should be accepted`).toBe(true);

	await waitClean(log, () => page.evaluate((names) => {
		const status = (window as unknown as DevSurface).__app.status();
		return names.includes(status.screen ?? '') && status.assetsReady === true;
	}, expected), `${screen} did not mount and finish loading`);

	const start = await frameCount(page);
	await waitClean(log, async () => await frameCount(page) >= start + RUN_FRAMES, `${screen} stopped drawing`);

	const status = await page.evaluate(() => (window as unknown as DevSurface).__app.status());
	expect(expected, `${screen} navigated to ${status.screen} on its own`).toContain(status.screen);

	const nodes = await page.evaluate(() => {
		const count = (list: TreeNode[]): number => list.reduce((sum, node) => sum + 1 + count([...(node.parts ?? []), ...node.children]), 0);
		return count((window as unknown as DevSurface).__ui.tree().roots);
	});
	// The root and the screen's container are two; anything past them is the screen's own content.
	expect(nodes, `${screen}'s layout tree is empty`).toBeGreaterThan(2);
}

function frameCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as unknown as DevSurface).__perf.snapshot().liveness.frameCount);
}
