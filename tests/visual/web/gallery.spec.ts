import { test } from '@playwright/test';
import { SIZED_SCENE_SCENARIOS } from '../support/scenarios';
import {
	attachTree,
	captureConsole,
	expectCleanConsole,
	expectGolden,
	expectTextSnapshot,
	openScene,
	prepare,
} from '../support/harness';

/**
 * One screenshot spec per gallery scene (R14.5, and R13.31 in part: the
 * scenes are the developer sections plus the chapter 3, 4 and 5 fixtures, and
 * the component catalog's scenes arrive with it in phase 5).
 */
test.describe('gallery scenes', () => {
	for (const scenario of SIZED_SCENE_SCENARIOS) {
		test(scenario.name, async ({ page }, testInfo) => {
			if (scenario.blockedBy) test.fixme(true, scenario.blockedBy);

			const log = captureConsole(page);
			if (scenario.viewport) await page.setViewportSize(scenario.viewport);
			await prepare(page);
			await openScene(page, scenario.scene, scenario.viewport);

			await expectTextSnapshot(page, 'scene', scenario.name);
			await expectGolden(page, testInfo, 'scene', scenario.name);

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});
	}
});
