import { expect, test } from '@playwright/test';
import type { LintRect, LintResult, LintViolation } from '../../../src/renderer/engine/debug/layoutLint';
import { SCREEN_SCENARIOS, SIZED_SCENE_SCENARIOS } from '../support/scenarios';
import { attachTree, openScene, openScreen, prepare, settle } from '../support/harness';
import { FIXED_VIEWPORT, SHORT_VIEWPORT } from '../../../playwright.config';
import type { DevSurface } from '../support/harness';

/**
 * R13.29's merge gate: `window.__ui.lint().count === 0` on every gallery scene.
 *
 * The gate is the gallery's, per the implementation spec's ground rules, and
 * every game screen's at both the fixed and the short viewport, which is
 * every screen scenario the screenshot spec captures (DDB-91).
 *
 * Why this is a separate spec rather than an assertion bolted onto
 * `gallery.spec.ts`: a lint failure and a pixel failure want different
 * verdicts. A screenshot diff says "something moved, look at the picture"; a
 * lint count says "these two nodes overlap, here are their paths". Sharing a
 * test would report both as one red and would make a lint regression wait on a
 * baseline that may not exist for the platform in front of you.
 *
 * How it reaches CI without a workflow change: `playwright.config.ts` sets
 * `testDir: './tests/visual'` and gives the chromium project
 * `testMatch: /web\/.*\.spec\.ts$/`, so this file is discovered by path alone.
 * The Screenshots job in `.github/workflows/visual.yml` runs
 * `xvfb-run -a npx playwright test` with no filter and no spec list, so it
 * picks these up the moment the file exists.
 *
 * Chromium only, and that is not an oversight. The electron project exists
 * because R15.33 keeps baselines per backend: a different Chromium, a
 * different compositor and software-rendered pixels that genuinely differ.
 * None of that reaches the lint. `layoutLint` is a pure function over the
 * snapshot document, the snapshot is layout numbers in logical pixels, and
 * both projects load the same bundle from the same dev server, so an electron
 * copy of these tests would recompute an identical result for the cost of an
 * Electron launch per scene. It earns its place the day layout starts reading
 * something backend-shaped.
 */

/**
 * Every scene, with `blockedBy` deliberately ignored.
 *
 * A block is about a scene's *screenshot*: a golden that would make a wrong
 * drawing the definition of correct. The boxes `treeSnapshot` reports are the
 * boxes the scene laid out, whatever the GPU then drew, so skipping a blocked
 * scene here would drop it out of R13.29's gate for a reason that does not
 * apply to what this spec measures, and leave it ungated right while someone
 * is fixing it.
 *
 * There is no console assertion below for the same reason. That gate belongs
 * to the screenshot specs, which already run every one of these scenes;
 * repeating it here would only force the same `blockedBy` skip back in
 * through the side door. A page that failed to boot cannot pass silently
 * either, but `openScene` is not what stops it: it waits on `__app.status()`
 * and never reads the tree, so an empty snapshot reaches the lint and comes
 * back clean. The `MIN_NODES` assertion below is what catches that, and it is
 * there because the empty case was demonstrated rather than imagined.
 */
const LINT_SCENARIOS = SIZED_SCENE_SCENARIOS;


/**
 * The floor a scene's measured node count has to clear for its clean lint to
 * mean anything.
 *
 * Two, not the real per-scene counts. A tight bound would be a second
 * baseline to re-approve on every scene edit, and this is guarding against a
 * broken snapshot rather than tracking scene content: the failure it exists
 * for returns zero nodes. Two is the host's root and the scene's container,
 * so clearing it means some of the scene's own content reached the snapshot.
 * The draw-fixture scenes are the smallest at four since a Panel stopped
 * reporting a background and a content layer as parts (DDB-73); the other
 * counts are in `perf-results/phase0-gallery-lint.json`.
 */
const MIN_NODES = 2;

/** How many violations the failure message spells out before it defers to the attachment. */
const MESSAGE_LIMIT = 20;

function formatRect(rect: LintRect): string {
	const round = (value: number): number => Math.round(value * 100) / 100;
	return `${round(rect.x)},${round(rect.y)} ${round(rect.w)}x${round(rect.h)}`;
}

/**
 * One violation, readable without the attachment. Pairwise rules carry a
 * second path and R13.28 omits `otherPath` rather than nulling it on the
 * single-node rules, so its presence is what decides the two-line form.
 */
function formatViolation(violation: LintViolation): string {
	const bucket = violation.bucket ? ` [${violation.bucket}]` : '';
	const head = `${violation.rule}${bucket}: ${violation.path} (${formatRect(violation.bounds)})`;
	if (violation.otherPath === undefined) return head;
	const other = violation.otherBounds ? ` (${formatRect(violation.otherBounds)})` : '';
	return `${head}\n\t\tagainst ${violation.otherPath}${other}`;
}

/**
 * The whole failure, in the assertion message rather than only in an
 * attachment. Someone reading a red CI log should be able to name the two
 * overlapping nodes from the log alone; opening the HTML report is for the
 * hundred-violation case the cap defers.
 */
function formatResult(subject: string, result: LintResult): string {
	const shown = result.violations.slice(0, MESSAGE_LIMIT).map(formatViolation);
	const hidden = result.violations.length - shown.length;
	const perRule = result.rules
		.filter((rule) => rule.violations > 0)
		.map((rule) => `${rule.rule} ${rule.violations}`)
		.join(', ');
	const lines = [
		`${subject} must lint clean (R13.29), found ${result.count}: ${perRule}`,
		...shown.map((line) => `\t${line}`),
	];
	if (hidden > 0) lines.push(`\t... and ${hidden} more; see the attached lint.json`);
	return lines.join('\n');
}

test.describe('gallery layout lint', () => {
	for (const scenario of LINT_SCENARIOS) {
		test(scenario.name, async ({ page }, testInfo) => {
			if (scenario.viewport) await page.setViewportSize(scenario.viewport);
			await prepare(page);
			await openScene(page, scenario.scene, scenario.viewport);

			const result = await page.evaluate(
				() => (window as unknown as DevSurface).__ui.lint(),
			);

			// Attached before the assertion, not after it: an expect that fails
			// throws, and an attachment on the far side of it never runs. Only
			// on red, because a clean run's tree is 26 identical files nobody
			// opens.
			if (result.count > 0) {
				await testInfo.attach('lint.json', {
					body: JSON.stringify(result, null, '\t'),
					contentType: 'application/json',
				});
				await attachTree(page, testInfo);
			}

			// Liveness before the verdict, because `count === 0` is satisfied by
			// measuring nothing. Proven, not theorised: making `treeSnapshot`
			// return `{roots: []}` left all eight scenes green, and nothing else
			// on this path notices, since `openScene` waits on `__app.status()`
			// and never reads the tree. `outside-viewport` is the probe because
			// it is the one rule that tests every visible candidate exactly
			// once, so its `evaluated` is the node count of the scene.
			const measured = result.rules.find((rule) => rule.rule === 'outside-viewport');
			expect(
				measured?.evaluated ?? 0,
				`gallery scene "${scenario.scene}" linted an empty tree, so its clean result means ` +
					`nothing. Either the scene failed to mount or treeSnapshot stopped emitting nodes.`,
			).toBeGreaterThan(MIN_NODES);

			expect(result.count, formatResult(`gallery scene "${scenario.scene}"`, result)).toBe(0);
		});
	}
});

test.describe('screen layout lint', () => {
	for (const scenario of SCREEN_SCENARIOS) {
		const screen = scenario.name;
		test(screen, async ({ page }, testInfo) => {
			if (scenario.viewport) await page.setViewportSize(scenario.viewport);
			await prepare(page);
			await openScreen(page, scenario.screen, { data: scenario.data, viewport: scenario.viewport });

			const result = await page.evaluate(
				() => (window as unknown as DevSurface).__ui.lint(),
			);
			if (result.count > 0) {
				await testInfo.attach('lint.json', {
					body: JSON.stringify(result, null, '\t'),
					contentType: 'application/json',
				});
				await attachTree(page, testInfo);
			}

			// As above: a clean count over an empty tree means nothing.
			const measured = result.rules.find((rule) => rule.rule === 'outside-viewport');
			expect(measured?.evaluated ?? 0, `screen "${screen}" linted an empty tree`).toBeGreaterThan(MIN_NODES);
			expect(result.count, formatResult(`screen "${screen}"`, result)).toBe(0);
		});
	}
});

/**
 * The developer screen builds its sections once and reflows them through
 * layout (DDB-235); before that, mounting wide and shrinking the window took
 * it from 0 to 133. Mounted at one gate size and resized live to the other
 * and back, it has to stay clean at each.
 */
test('developer screen layout lint across a live resize', async ({ page }, testInfo) => {
	await page.setViewportSize(FIXED_VIEWPORT);
	await prepare(page);
	await openScreen(page, 'developerScreen');

	for (const size of [SHORT_VIEWPORT, FIXED_VIEWPORT]) {
		await page.setViewportSize(size);
		await settle(page, size);
		const result = await page.evaluate(() => (window as unknown as DevSurface).__ui.lint());
		if (result.count > 0) {
			await testInfo.attach(`lint-${size.width}x${size.height}.json`, {
				body: JSON.stringify(result, null, '\t'),
				contentType: 'application/json',
			});
		}
		const measured = result.rules.find((rule) => rule.rule === 'outside-viewport');
		expect(measured?.evaluated ?? 0, 'the developer screen linted an empty tree').toBeGreaterThan(MIN_NODES);
		expect(result.count, formatResult(`developer screen resized to ${size.width}x${size.height}`, result)).toBe(0);
	}
});
