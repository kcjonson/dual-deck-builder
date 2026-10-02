import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
	attachTree,
	captureConsole,
	expectCleanConsole,
	expectGolden,
	expectTextSnapshot,
	openScreen,
	prepare,
	settle,
} from '../support/harness';
import type { DevSurface } from '../support/harness';
import { FIXED_VIEWPORT, SHORT_VIEWPORT } from '../../../playwright.config';
import type { Viewport } from '../../../playwright.config';

/**
 * The combat screen mid enemy turn (DDB-112, DDB-139): END TURN pressed and
 * the first raider acting, with the ENEMY TURN banner across the road and
 * only the road, the dock dropped 60 and greyed under it and End Turn
 * saying WAIT, the acting raider glowing, and its hit's number up.
 * Captured and linted at both gate sizes; the dock is a declared park, so
 * the lint checks it where it rests.
 *
 * Under reduced motion, which is what makes the moment hold still: the
 * banner stays at full opacity for its whole time instead of fading as the
 * first action lands, the dock snaps down, and the number holds where it
 * pops. The page is paused to open, so the press runs the game for the
 * frames it takes: resume, let the opening YOUR TURN banner run out, click
 * END TURN through `__dev.input`, and pause again on the first frame a hit
 * number is up. That is 900 ms of frame time after ENEMY TURN shows, with
 * the banner up until 1100, and a frame advances at most 250 ms (R13.9).
 */

interface TurnSurface extends DevSurface {
	__app: DevSurface['__app'] & { resume(): void };
	__dev: { input(...commands: string[]): { ok: boolean } };
}

async function pressEndTurn(page: Page): Promise<void> {
	const outcome = await page.evaluate(async () => {
		interface Node {
			id: string | null;
			visible: boolean;
			screenBounds: { x: number; y: number; w: number; h: number };
			text?: { content: string };
			parts?: Node[];
			children: Node[];
		}
		const scope = window as unknown as TurnSurface;
		const find = (nodes: Node[], id: string): Node | null => {
			for (const node of nodes) {
				if (node.id === id) return node;
				const found = find([...(node.parts ?? []), ...node.children], id);
				if (found) return found;
			}
			return null;
		};
		const says = (node: Node, text: string): boolean =>
			node.text?.content === text || [...(node.parts ?? []), ...node.children].some((child) => says(child, text));
		const button = (): Node | null => find((scope.__ui.tree() as unknown as { roots: Node[] }).roots, 'end_turn_button');

		const before = button();
		if (!before) return 'no end_turn_button in the tree';
		const { x, y, w, h } = before.screenBounds;
		const nextFrame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));
		scope.__app.resume();
		// The opening YOUR TURN banner runs out first, so ENEMY TURN starts
		// the frame END TURN is pressed rather than waiting on its exit
		const bannerUp = (): boolean => {
			const banner = find((scope.__ui.tree() as unknown as { roots: Node[] }).roots, 'combat_turn_banner');
			return banner?.visible ?? false;
		};
		for (let frames = 0; bannerUp() && frames < 600; frames++) await nextFrame();
		if (bannerUp()) {
			scope.__app.pause();
			return 'the opening banner never went';
		}
		if (!scope.__dev.input(`click,${Math.round(x + w / 2)},${Math.round(y + h / 2)}`).ok) return 'the click was refused';
		let waited = false;
		for (let frames = 0; frames < 30 && !waited; frames++) {
			await nextFrame();
			const now = button();
			waited = now !== null && says(now, 'WAIT');
		}
		if (!waited) {
			scope.__app.pause();
			return 'End Turn never said WAIT';
		}
		// The first raider's action: its hit (or miss) number is up
		const hitUp = (): boolean => JSON.stringify(scope.__ui.tree()).includes('"combat_float_');
		for (let frames = 0; frames < 600; frames++) {
			await nextFrame();
			if (hitUp()) {
				scope.__app.pause();
				return bannerUp() ? null : 'the banner was gone when the first raider acted';
			}
		}
		scope.__app.pause();
		return 'no raider acted';
	});
	expect(outcome).toBeNull();
}

const SIZES: readonly { name: string; viewport: Viewport }[] = [
	{ name: 'combatScreen-enemyTurn', viewport: FIXED_VIEWPORT },
	{ name: `combatScreen-enemyTurn-${SHORT_VIEWPORT.width}x${SHORT_VIEWPORT.height}`, viewport: SHORT_VIEWPORT },
];

test.describe('combat screen mid enemy turn, the first raider acting', () => {
	for (const { name, viewport } of SIZES) {
		test(name, async ({ page }, testInfo) => {
			const log = captureConsole(page);
			await page.setViewportSize(viewport);
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await prepare(page);
			await openScreen(page, 'combatScreen', { viewport });

			await pressEndTurn(page);
			await settle(page, viewport);

			const lint = await page.evaluate(() => (window as unknown as DevSurface).__ui.lint());
			if (lint.count > 0) await testInfo.attach('lint.json', { body: JSON.stringify(lint, null, '\t'), contentType: 'application/json' });
			const found = lint.violations.slice(0, 10).map((violation) => `\t${violation.rule}: ${violation.path}${violation.otherPath ? ` against ${violation.otherPath}` : ''}`);
			expect(lint.count, [`${name} must lint clean (R13.29)`, ...found].join('\n')).toBe(0);

			await expectTextSnapshot(page, 'screen', name);
			await expectGolden(page, testInfo, 'screen', name);

			await attachTree(page, testInfo);
			expectCleanConsole(log);
		});
	}
});
