import { expect, test } from '@playwright/test';
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
 * The area map view's gallery scenes (DDB-298): the golden, the text record,
 * and R13.29's lint gate, as `gallery.spec.ts` and `lint.spec.ts` hold every
 * other scene.
 *
 * Their own list for now, rather than lines in `support/scenarios.ts`, which
 * another branch has open; folding them into `SCENE_SCENARIOS` later moves
 * nothing, since the golden and text record names are the same either way
 * (`goldenName`). Chromium only until then: the electron project reads that
 * list, so these scenes get its goldens when they join it.
 */
const AREA_MAP_SCENES = ['area-map', 'area-map-fog'] as const;

test.describe('area map scenes', () => {
	for (const scene of AREA_MAP_SCENES) {
		test(scene, async ({ page }, testInfo) => {
			const log = captureConsole(page);
			await prepare(page);
			await openScene(page, scene);

			await expectTextSnapshot(page, 'scene', scene);
			await expectGolden(page, testInfo, 'scene', scene);

			const lint = await page.evaluate(() => (window as unknown as DevSurface).__ui.lint());
			if (lint.count > 0) {
				await testInfo.attach('lint.json', { body: JSON.stringify(lint, null, '\t'), contentType: 'application/json' });
			}
			// Liveness first: a clean count over an empty tree means nothing (lint.spec.ts)
			const measured = lint.rules.find((rule) => rule.rule === 'outside-viewport');
			expect(measured?.evaluated ?? 0, `scene "${scene}" linted an empty tree`).toBeGreaterThan(2);
			expect(lint.count, `scene "${scene}" must lint clean (R13.29): ${JSON.stringify(lint.violations.slice(0, 5))}`).toBe(0);

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});
	}
});
