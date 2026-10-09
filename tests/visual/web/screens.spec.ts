import { test } from '@playwright/test';
import { SCREEN_SCENARIOS } from '../support/scenarios';
import {
	attachTree,
	captureConsole,
	expectCleanConsole,
	expectGolden,
	expectTextSnapshot,
	openScreen,
	prepare,
} from '../support/harness';

/**
 * One screenshot spec per game screen (R14.5), at the fixed viewport and at
 * the short one (`SCREEN_SCENARIOS`).
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
		test(scenario.name, async ({ page }, testInfo) => {
			if (scenario.blockedBy) test.fixme(true, scenario.blockedBy);

			const log = captureConsole(page);
			if (scenario.viewport) await page.setViewportSize(scenario.viewport);
			await prepare(page);
			await openScreen(page, scenario.screen, { data: scenario.data, viewport: scenario.viewport, storage: scenario.storage });

			await expectTextSnapshot(page, 'screen', scenario.name);
			await expectGolden(page, testInfo, 'screen', scenario.name);

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});
	}
});
