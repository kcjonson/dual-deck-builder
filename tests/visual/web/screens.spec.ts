import { expect, test } from '@playwright/test';
import { SCREEN_SCENARIOS } from '../support/scenarios';
import {
	attachTree,
	captureConsole,
	expectCleanConsole,
	goldenName,
	openScreen,
	prepare,
} from '../support/harness';

/**
 * One screenshot spec per game screen (R14.5).
 *
 * Each is a whole run of its own: a fresh page, the seeded random installed
 * before the first script executes, a pause, one navigation, and a capture.
 * There is no pinned clock; `prepare()` seeds random and nothing else, and
 * `harness.ts` records why the Clock API is deliberately unused. Sharing a
 * page between screens would make every golden depend on which golden ran
 * before it, which is the shape flakiness arrives in.
 */
test.describe('game screens', () => {
	for (const scenario of SCREEN_SCENARIOS) {
		test(scenario.screen, async ({ page }, testInfo) => {
			if (scenario.blockedBy) test.fixme(true, scenario.blockedBy);

			const log = captureConsole(page);
			await prepare(page);
			await openScreen(page, scenario.screen);

			await expect(page).toHaveScreenshot(goldenName('screen', scenario.screen));

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});
	}
});
