import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { BASE_URL, FIXED_VIEWPORT, SWIFTSHADER_ARGS } from '../../../playwright.config';
import type { Viewport } from '../../../playwright.config';
import { SCENE_SCENARIOS, SCREEN_SCENARIOS } from '../support/scenarios';
import {
	attachTree,
	captureConsole,
	expectCleanConsole,
	expectGolden,
	openScene,
	openScreen,
	prepare,
} from '../support/harness';

/**
 * The same captures in the shell the game actually ships in.
 *
 * R15.33 keeps baselines per backend, and this is the second backend: a
 * different Chromium from the one Playwright bundles, a different compositor,
 * and the platform the shipped build runs on. The scenario list, the
 * determinism controls and the console gate are the browser project's, imported
 * rather than restated, so the two projects cannot come to disagree about what
 * "the combat screen" means.
 *
 * The renderer is the same webpack dev server the chromium project uses.
 * `build:electron` forces NODE_ENV=production, which drops __DEV_TOOLS__ and
 * the gallery entry, so a packaged renderer has neither the scenes nor the
 * hooks; an unpackaged Electron loads the dev server instead, which is the
 * build that has both. Only main and preload are built here, into
 * `.playwright-build/electron/` rather than `dist/`, because a parallel session
 * may be writing `dist/` for its own reasons.
 */

const MAIN_ENTRY = resolve(__dirname, '../../../.playwright-build/electron/main.js');

test.describe('electron shell', () => {
	let application: ElectronApplication;
	let page: Page;

	test.beforeEach(async () => {
		expect(
			existsSync(MAIN_ENTRY),
			`${MAIN_ENTRY} is missing; run "npm run build:harness:electron" first`,
		).toBe(true);

		application = await electron.launch({
			// R15.33, the same three switches the chromium project passes and
			// for the same reason: the Electron launcher is named in the rule
			// explicitly, and a version that still has the automatic fallback
			// today will not have it after its next Chromium bump.
			args: [
				MAIN_ENTRY,
				...SWIFTSHADER_ARGS,
				// R13.37's fixed device pixel ratio, which a browser context
				// gets from `deviceScaleFactor` and a window does not: Electron
				// inherits the desktop's display scaling, and this machine's
				// 1.25 made `setContentSize(1440, 882)` land on 883 logical
				// pixels because the DIP-to-physical rounding does not divide.
				'--force-device-scale-factor=1',
				// Electron, not Chromium: Playwright's own browser runs
				// unsandboxed under `playwright install --with-deps`, but the
				// Electron launcher brings its own setuid-free sandbox, and
				// Ubuntu 24.04 restricts unprivileged user namespaces by
				// default, so an Electron main process that keeps the sandbox
				// fails to spawn a renderer on the runner. It has no effect on
				// what is drawn.
				'--no-sandbox',
			],
			env: { ...process.env, DDB_RENDERER_URL: BASE_URL },
		});

		page = await application.firstWindow();

		// R13.37's fixed viewport for a window rather than a browser context:
		// `setContentSize` sizes the web contents, so the frame, the menu bar
		// and the platform's title-bar height stay out of the number.
		await sizeWindow(FIXED_VIEWPORT);

		// The window boots the app on its own before any test navigates, and
		// that boot decodes the font atlases. Navigating while a decode is in
		// flight makes Chromium reject it ("The source image cannot be
		// decoded."), and the dying page's console.error lands on this same
		// Page, inside the test's console gate (DDB-187). Letting the boot
		// finish first removes the race; asserting the outcome keeps a real
		// load failure on the boot page loud instead of unobserved.
		const bootFonts = await page.waitForFunction(() => {
			const [failed] = performance.getEntriesByName('font-atlases-failed') as PerformanceMark[];
			if (failed) return `failed: ${(failed.detail as { message: string }).message}`;
			return performance.getEntriesByName('font-atlases-ready').length > 0 ? 'ready' : false;
		});
		expect(await bootFonts.jsonValue(), 'the boot page should load its font atlases').toBe('ready');
	});

	/** The window's content area, which is the page's viewport, and a wait until the page sees it. */
	async function sizeWindow(size: Viewport): Promise<void> {
		await application.evaluate(async ({ BrowserWindow }, target) => {
			const [window] = BrowserWindow.getAllWindows();
			window.setContentSize(target.width, target.height);
		}, size);
		await page.waitForFunction(
			(target) => window.innerWidth === target.width && window.innerHeight === target.height,
			size,
		);
	}

	test.afterEach(async () => {
		await application?.close();
	});

	for (const scenario of SCREEN_SCENARIOS) {
		test(`screen ${scenario.name}`, async ({}, testInfo) => {
			if (scenario.blockedBy) test.fixme(true, scenario.blockedBy);

			const log = captureConsole(page);
			if (scenario.viewport) await sizeWindow(scenario.viewport);
			await prepare(page);
			await openScreen(page, scenario.screen, { data: scenario.data, viewport: scenario.viewport });

			await expectGolden(page, testInfo, 'screen', scenario.name);

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});
	}

	for (const scenario of SCENE_SCENARIOS) {
		test(`scene ${scenario.scene}`, async ({}, testInfo) => {
			if (scenario.blockedBy) test.fixme(true, scenario.blockedBy);

			const log = captureConsole(page);
			await prepare(page);
			await openScene(page, scenario.scene);

			await expectGolden(page, testInfo, 'scene', scenario.scene);

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});
	}
});
