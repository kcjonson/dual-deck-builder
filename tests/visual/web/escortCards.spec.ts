import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { SHORT_VIEWPORT } from '../../../playwright.config';
import {
	attachTree,
	captureConsole,
	expectCleanConsole,
	expectGolden,
	expectTextSnapshot,
	openScene,
	prepare,
} from '../support/harness';
import type { DevSurface } from '../support/harness';

/**
 * The escort card's gallery scenes (DDB-313): the golden, the text record,
 * and R13.29's lint gate at both gate sizes, as `gallery.spec.ts` and
 * `lint.spec.ts` hold every other card scene (`lintShort`).
 *
 * Their own list for now, rather than lines in `support/scenarios.ts`, which
 * another branch has open; folding them into `SCENE_SCENARIOS` later moves
 * nothing, since the golden and text record names are the same either way
 * (`goldenName`). Chromium only until then: the electron project reads that
 * list, so these scenes get its goldens when they join it.
 */
const ESCORT_SCENES = ['escort-cards', 'escort-detail', 'escort-detail-pinned'] as const;

/** R13.29's gate for the scene on screen, after the liveness check `lint.spec.ts` makes. */
async function expectCleanLint(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	const lint = await page.evaluate(() => (window as unknown as DevSurface).__ui.lint());
	if (lint.count > 0) {
		await testInfo.attach('lint.json', { body: JSON.stringify(lint, null, '\t'), contentType: 'application/json' });
	}
	// Liveness first: a clean count over an empty tree means nothing (lint.spec.ts)
	const measured = lint.rules.find((rule) => rule.rule === 'outside-viewport');
	expect(measured?.evaluated ?? 0, `scene "${name}" linted an empty tree`).toBeGreaterThan(2);
	expect(lint.count, `scene "${name}" must lint clean (R13.29): ${JSON.stringify(lint.violations.slice(0, 5))}`).toBe(0);
}

test.describe('escort card scenes', () => {
	for (const scene of ESCORT_SCENES) {
		test(scene, async ({ page }, testInfo) => {
			const log = captureConsole(page);
			await prepare(page);
			await openScene(page, scene);

			await expectTextSnapshot(page, 'scene', scene);
			await expectGolden(page, testInfo, 'scene', scene);
			await expectCleanLint(page, testInfo, scene);

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});

		const short = `${scene}-${SHORT_VIEWPORT.width}x${SHORT_VIEWPORT.height}`;
		test(`${short} lint`, async ({ page }, testInfo) => {
			await page.setViewportSize(SHORT_VIEWPORT);
			await prepare(page);
			await openScene(page, scene, SHORT_VIEWPORT);
			await expectCleanLint(page, testInfo, short);
		});
	}
});
