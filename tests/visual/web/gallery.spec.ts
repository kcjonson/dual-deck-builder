import { expect, test } from '@playwright/test';
import { SCENE_SCENARIOS } from '../support/scenarios';
import {
	attachTree,
	captureConsole,
	expectCleanConsole,
	goldenName,
	openScene,
	prepare,
} from '../support/harness';

/**
 * One screenshot spec per gallery scene (R14.5, R13.31 as far as phase 0 goes:
 * the scene set is the eight developer sections, not the full fixture list,
 * because the component catalog does not exist until phase 4).
 */
test.describe('gallery scenes', () => {
	for (const scenario of SCENE_SCENARIOS) {
		test(scenario.scene, async ({ page }, testInfo) => {
			if (scenario.blockedBy) test.fixme(true, scenario.blockedBy);

			const log = captureConsole(page);
			await prepare(page);
			await openScene(page, scenario.scene);

			await expect(page).toHaveScreenshot(goldenName('scene', scenario.scene));

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});
	}
});
