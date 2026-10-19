import { expect, test } from '@playwright/test';
import { captureConsole, expectCleanConsole, waitClean } from '../support/app';

/** Splash fade and hold (SplashScreen.ts) plus a margin, so the main menu mounts and draws too. */
const PAST_SPLASH_MS = 5_000;

/**
 * The bundle playtesters get. Production has no dev hooks, so readiness is
 * what `src/index.ts` reports: the font atlas mark and the init log line.
 */
test('the production bundle boots past the splash with a clean console', async ({ page }) => {
	const log = captureConsole(page);
	await page.goto('/', { waitUntil: 'domcontentloaded' });

	await waitClean(log, async () => log.messages.some((message) => message.includes('Initialization complete!')), 'the app did not finish initializing');
	await waitClean(log, () => page.evaluate(() => performance.getEntriesByName('font-atlases-ready').length > 0), 'the font atlases did not load');

	await page.waitForTimeout(PAST_SPLASH_MS);
	expectCleanConsole(log);

	const canvas = await page.evaluate(() => {
		const element = document.getElementById('game-canvas') as HTMLCanvasElement | null;
		return element ? { width: element.width, height: element.height } : null;
	});
	expect(canvas, 'the game canvas is missing').not.toBeNull();
	expect(canvas?.width, 'the game canvas has no backing store').toBeGreaterThan(0);
});
