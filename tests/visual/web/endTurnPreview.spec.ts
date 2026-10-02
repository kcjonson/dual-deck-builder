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
 * The combat screen's end-turn preview (DDB-139, Battle Screen Design
 * section 6): the pointer on End Turn, each raider intent drawing its line
 * to the vehicle it will hit, and the incoming total on that vehicle.
 * Captured and linted at both gate sizes.
 *
 * The page is paused to open; the pointer move runs the game for a frame so
 * the dispatcher hovers End Turn, then it pauses again. The opening YOUR
 * TURN banner is left to run out first so it isn't in the picture.
 */

interface PreviewSurface extends DevSurface {
	__app: DevSurface['__app'] & { resume(): void };
	__dev: { input(...commands: string[]): { ok: boolean } };
}

async function pointAtEndTurn(page: Page): Promise<void> {
	const outcome = await page.evaluate(async () => {
		interface Node {
			id: string | null;
			visible: boolean;
			screenBounds: { x: number; y: number; w: number; h: number };
			state?: { hovered?: boolean };
			parts?: Node[];
			children: Node[];
		}
		const scope = window as unknown as PreviewSurface;
		const find = (nodes: Node[], id: string): Node | null => {
			for (const node of nodes) {
				if (node.id === id) return node;
				const found = find([...(node.parts ?? []), ...node.children], id);
				if (found) return found;
			}
			return null;
		};
		const roots = (): Node[] => (scope.__ui.tree() as unknown as { roots: Node[] }).roots;
		const nextFrame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));

		scope.__app.resume();
		const bannerUp = (): boolean => find(roots(), 'combat_turn_banner')?.visible ?? false;
		for (let frames = 0; bannerUp() && frames < 600; frames++) await nextFrame();
		if (bannerUp()) {
			scope.__app.pause();
			return 'the opening banner never went';
		}
		const button = find(roots(), 'end_turn_button');
		if (!button) {
			scope.__app.pause();
			return 'no end_turn_button in the tree';
		}
		const { x, y, w, h } = button.screenBounds;
		if (!scope.__dev.input(`move,${Math.round(x + w / 2)},${Math.round(y + h / 2)}`).ok) {
			scope.__app.pause();
			return 'the move was refused';
		}
		for (let frames = 0; frames < 30; frames++) {
			await nextFrame();
			if (find(roots(), 'end_turn_button')?.state?.hovered) {
				scope.__app.pause();
				return null;
			}
		}
		scope.__app.pause();
		return 'End Turn never took the hover';
	});
	expect(outcome).toBeNull();
}

const SIZES: readonly { name: string; viewport: Viewport }[] = [
	{ name: 'combatScreen-endTurnPreview', viewport: FIXED_VIEWPORT },
	{ name: `combatScreen-endTurnPreview-${SHORT_VIEWPORT.width}x${SHORT_VIEWPORT.height}`, viewport: SHORT_VIEWPORT },
];

test.describe('combat screen end-turn preview', () => {
	for (const { name, viewport } of SIZES) {
		test(name, async ({ page }, testInfo) => {
			const log = captureConsole(page);
			await page.setViewportSize(viewport);
			await prepare(page);
			await openScreen(page, 'combatScreen', { viewport });

			await pointAtEndTurn(page);
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
