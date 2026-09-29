import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BASE_URL } from '../../../playwright.config';
import { DevSurface, captureConsole, expectCleanConsole, freezeApplication, prepare } from '../support/harness';

/**
 * R6.4a's raster fallback against R5.20's texture budget on the combat screen.
 *
 * Under the stage scale at small windows every combat run under about 11
 * logical px goes to the raster path, at several device sizes at once. All
 * of them share one raster glyph page, so the frame is still one GPU draw
 * with no `textureSlotsExhausted` split; an atlas per size used to take the
 * frame to three draws at these sizes.
 */

interface Batcher {
	gpuDraws: number | null;
	textureBinds: number | null;
	splits: Record<string, number> | null;
}

async function combatAt(page: Page, width: number, height: number): Promise<Batcher> {
	await page.setViewportSize({ width, height });
	await prepare(page);
	await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
	await freezeApplication(page);
	expect(await page.evaluate(() => (window as unknown as DevSurface).__app.navigate('combatScreen'))).toBe(true);
	await page.waitForFunction(() => (window as unknown as DevSurface).__app.status().assetsReady === true);
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	// Enough frames for the viewport to commit, the screen to lay out at it,
	// and the prewarmed frame to rasterise its small text.
	return page.evaluate(async ({ width, height }) => {
		const scope = window as unknown as { __perf: { snapshot(): { batcher: Batcher | null } } };
		const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
		for (let waited = 0; waited < 600 && (canvas.clientWidth !== width || canvas.clientHeight !== height); waited++) await frame();
		for (let count = 0; count < 20; count++) await frame();
		const batcher = scope.__perf.snapshot().batcher;
		if (!batcher) throw new Error('no batcher counters in the perf snapshot');
		return { gpuDraws: batcher.gpuDraws, textureBinds: batcher.textureBinds, splits: batcher.splits };
	}, { width, height });
}

test.describe('small text on the combat screen (R6.4a, R5.20)', () => {
	for (const [width, height] of [[1000, 620], [800, 500]]) {
		test(`stays one GPU draw with no texture-slot split at ${width}x${height}`, async ({ page }) => {
			const log = captureConsole(page);
			const batcher = await combatAt(page, width, height);
			expect(batcher.gpuDraws).toBe(1);
			expect(batcher.splits?.textureSlotsExhausted ?? 0).toBe(0);
			// The raster page is the frame's one bound texture: the fallback engaged.
			expect(batcher.textureBinds).toBe(1);
			expectCleanConsole(log);
		});
	}
});
