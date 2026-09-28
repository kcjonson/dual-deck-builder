import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
	DevSurface,
	captureConsole,
	expectCleanConsole,
	goldenName,
	openScreen,
	prepare,
	settle,
} from '../support/harness';

/**
 * R15.5 end to end: lose the WebGL2 context, check the frame loop stopped and
 * the page says why, restore it, and check the rebuilt backend draws the
 * combat screen's committed golden. That golden is shared with
 * `screens.spec.ts` on purpose: a restore that recreated one resource short
 * (the atlas texture, the uniform ring, the vertex array) shows up as a diff
 * against the picture the page drew before it lost anything.
 *
 * `WEBGL_lose_context` is the conformance suite's way to simulate the loss;
 * `getContext('webgl2')` on a canvas that already has one returns that one.
 * The extension object is kept on the page between the two calls because a
 * lost context returns null from `getExtension`.
 */

type LoseContextScope = Window & { __loseContext?: WEBGL_lose_context };

async function loseContext(page: Page): Promise<void> {
	await page.evaluate(() => {
		const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
		const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
		if (!extension) throw new Error('WEBGL_lose_context is not available');
		(window as LoseContextScope).__loseContext = extension;
		extension.loseContext();
	});
}

async function restoreContext(page: Page): Promise<void> {
	await page.evaluate(() => {
		const extension = (window as LoseContextScope).__loseContext;
		if (!extension) throw new Error('restoreContext before loseContext');
		extension.restoreContext();
	});
}

async function frameCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as unknown as DevSurface).__perf.snapshot().liveness.frameCount);
}

test('context loss stops the loop and a restore redraws the same frame', async ({ page }) => {
	const log = captureConsole(page);
	await prepare(page);
	await openScreen(page, 'combatScreen');

	await loseContext(page);
	// The loss event is asynchronous; the status line is how the page says it
	// landed, and from then on no frame starts.
	await expect(page.locator('#gpu-status')).toBeVisible();
	const stopped = await frameCount(page);
	await page.waitForTimeout(250);
	expect(await frameCount(page), 'the frame loop should be cancelled while the context is lost').toBe(stopped);

	await restoreContext(page);
	await expect(page.locator('#gpu-status')).toHaveCount(0);
	await settle(page);

	await expect(page).toHaveScreenshot(goldenName('screen', 'combatScreen'));
	expectCleanConsole(log);
});
