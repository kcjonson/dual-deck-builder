import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { layoutLint } from '../../../src/renderer/engine/debug/layoutLint';
import type { LintDocument } from '../../../src/renderer/engine/debug/layoutLint';
import { RoadSlot, slotRange } from '../../../src/renderer/game/mechanics/Road';
import { FIXED_VIEWPORT, SHORT_VIEWPORT } from '../../../playwright.config';
import type { Viewport } from '../../../playwright.config';
import {
	captureConsole,
	expectCleanConsole,
	expectGolden,
	expectTextSnapshot,
	openScene,
	prepare,
	settle,
} from '../support/harness';
import type { DevSurface } from '../support/harness';
import { battleFit, tokenSlot } from '../support/battleFit';
import type { FitDocument, FitNode } from '../support/battleFit';

/**
 * The battle screen's fit suite (DDB-141): the mock's six scenarios
 * (`src/gallery/scenes/battleFitScenarios.ts`) on the real screen, at the
 * mock's six viewports plus the short gate size, in the five states its fit
 * matrix checks: planning, the detail view of the hand's leftmost and
 * rightmost cards, a card mid-drag over a raider, and the end-turn preview.
 * Every one must lint clean and pass the mock's fit check (`battleFit`).
 *
 * Software GL draws a 1920x1080 frame in well over 100 ms, so the suite is
 * written in frames. One page load per scenario: the screen resizes in place,
 * as it does in the game, so the seven sizes are seven resizes of one fight.
 * Each state is a single burst of injected input (putting the last state
 * away first) and a few frames, the tree is read once, and the engine's
 * layout lint runs on that same tree here rather than serialising it again
 * in the page. The opening YOUR TURN banner runs out once, before the first
 * size. The detail views are pinned with a secondary click, which shows
 * the hover's view without waiting out the tooltip delay.
 *
 * Goldens are the typical scene's planning state at the fixed viewport and
 * at 21:9, where the road's art bleeds past the 1600 column; everything else
 * is assertions only, to keep the suite cheap.
 */

const SCENARIOS = ['typical', 'opening', 'convoy', 'fullroad', 'passenger', 'bighands'] as const;
type Scenario = typeof SCENARIOS[number];

const VIEWPORTS: readonly Viewport[] = [
	{ width: 1920, height: 1080 },
	FIXED_VIEWPORT,
	{ width: 1280, height: 800 },
	{ width: 1280, height: 720 },
	{ width: 2560, height: 1080 },
	{ width: 1024, height: 768 },
	// Not one of the mock's six: the short gate size every screen is linted at
	SHORT_VIEWPORT,
];

const STATES = ['planning', 'inspect-left', 'inspect-right', 'targeting', 'end-turn-preview'] as const;
type State = typeof STATES[number];

/** The typical scene's goldens: planning, before any input, at these sizes. */
const GOLDEN_VIEWPORTS: readonly Viewport[] = [FIXED_VIEWPORT, { width: 2560, height: 1080 }];

/** Headshot reaches two, as the mock's targeting state drags it. */
const HEADSHOT_REACH = 2;

/**
 * Cases that fail a real check today, each with the bug filed under DDB-127,
 * keyed `scenario WxH state`. A listed case that starts passing fails the
 * suite, so the entry goes when the bug is fixed.
 */
const EXPECTED_FAILURES: Readonly<Record<string, string>> = {};

const size = ({ width, height }: Viewport): string => `${width}x${height}`;

interface DriveSurface extends DevSurface {
	__app: DevSurface['__app'] & { resume(): void };
	__dev: { input(...commands: string[]): { ok: boolean; error?: string } };
}

/**
 * Runs the game for `frames` frames with `commands` queued for the first,
 * then pauses and runs every animation to its end. Input is dropped while
 * paused, so every state is entered this way. Pausing also cancels a press
 * or a drag in progress, so `hold` leaves the game running for one that
 * has to stay held. Returns why the input was refused, or null.
 */
async function drive(page: Page, commands: readonly string[], frames: number, hold = false): Promise<string | null> {
	return page.evaluate(async ({ commands, frames, hold }) => {
		const scope = window as unknown as DriveSurface;
		const nextFrame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(resolve));
		scope.__app.resume();
		try {
			if (commands.length > 0) {
				const sent = scope.__dev.input(...commands);
				if (!sent.ok) return `input refused: ${sent.error ?? commands.join(' ')}`;
			}
			for (let frame = 0; frame < frames; frame++) await nextFrame();
		} finally {
			if (!hold) scope.__app.pause();
		}
		// Whatever the last frames started runs to its end, and a frame lays
		// out where it landed
		for (let pass = 0; pass < 10 && scope.__app.settleAnimations() > 0; pass++) await nextFrame();
		return null;
	}, { commands, frames, hold });
}

/** The tree, as one string across the protocol: far quicker than Playwright's value serialiser on a few thousand nodes. */
async function snapshot(page: Page): Promise<FitDocument> {
	return JSON.parse(await page.evaluate(() => JSON.stringify((window as unknown as DevSurface).__ui.tree()))) as FitDocument;
}

function walk(document: FitDocument, visit: (node: FitNode, parentIds: readonly string[]) => void): void {
	const go = (nodes: FitNode[], parentIds: string[]): void => {
		for (const node of nodes) {
			if (!node.visible || node.opacity === 0) continue;
			visit(node, parentIds);
			go([...(node.parts ?? []), ...node.children], node.id ? [...parentIds, node.id] : parentIds);
		}
	};
	go(document.roots, []);
}

function nodes(document: FitDocument, keep: (node: FitNode, parentIds: readonly string[]) => boolean): FitNode[] {
	const out: FitNode[] = [];
	walk(document, (node, parentIds) => {
		if (keep(node, parentIds)) out.push(node);
	});
	return out;
}

function strings(node: FitNode): string[] {
	return [node.text?.content ?? '', ...(node.labels ?? []), ...[...(node.parts ?? []), ...node.children].flatMap(strings)].filter(Boolean);
}

const point = (x: number, y: number): string => `${Math.round(x)},${Math.round(y)}`;

/**
 * Where each state's input goes, worked out once per size from the screen
 * at rest: the hands' edge cards, Headshot, the raider it's aimed at, and
 * End Turn.
 */
interface Targets {
	rest: string;
	leftCard: string | null;
	rightCard: string | null;
	headshot: string | null;
	raider: string | null;
	endTurn: string | null;
}

function targetsOf(document: FitDocument, viewport: Viewport): Targets {
	const handCards = (hand: string): FitNode[] => nodes(document, (node, parents) => node.type === 'Card' && parents.includes(hand))
		.sort((a, b) => a.screenBounds.x - b.screenBounds.x);
	const left = handCards('driver1_hand')[0];
	const right = handCards('driver2_hand').at(-1);
	const headshot = handCards('driver2_hand').find((card) => card.id?.endsWith('_headshot'));
	// Fanned cards overlap to the right, so each shows its left strip; the last is whole
	const strip = (card: FitNode | undefined): string | null => card
		? point(card.screenBounds.x + Math.min(24, card.screenBounds.w / 4), card.screenBounds.y + card.screenBounds.h * 0.6)
		: null;
	const centre = (node: FitNode | undefined, across = 0.5): string | null => node
		? point(node.screenBounds.x + node.screenBounds.w * across, node.screenBounds.y + node.screenBounds.h / 2)
		: null;

	// The raider nearest the Interceptor, in reach if any is, from the slots the token ids name
	const tokens = nodes(document, (node) => node.type === 'Vehicle');
	const bike = tokens.find((token) => token.id?.startsWith('player_') && strings(token).some((text) => text.startsWith('Lightning Bike')));
	const from = bike ? tokenSlot(bike) : null;
	const raiders = tokens
		.filter((token) => token.id?.startsWith('enemy_') && !strings(token).includes('WRECKED'))
		.map((token) => ({ token, range: from ? slotRange(from, tokenSlot(token) as RoadSlot) : 0 }))
		.sort((a, b) => a.range - b.range);
	const aimed = raiders.find((entry) => entry.range <= HEADSHOT_REACH) ?? raiders[0];

	return {
		// Over the stage's own background, left of the road's row gutter: nothing there answers the pointer
		rest: point(2, viewport.height / 2),
		leftCard: strip(left),
		rightCard: centre(right, 0.6),
		headshot: strip(headshot),
		raider: centre(aimed?.token, 0.6),
		endTurn: centre(nodes(document, (node) => node.id === 'end_turn_button')[0]),
	};
}

/**
 * Puts away whatever the last state opened, as a mouse player would: lets go
 * of a drag over the stage (which puts the card back), unpins a detail view
 * with a second secondary click on its card, and rests the pointer.
 */
function putAway(targets: Targets, pinnedAt: string | null): string[] {
	return [`up,${targets.rest}`, ...(pinnedAt ? [`click,${pinnedAt},2`] : []), `move,${targets.rest}`];
}

/**
 * The input that enters `state` from rest, in bursts a few frames apart,
 * and what the tree has to show once it has. A drag needs its own: the
 * press has to lift the card before the move onto a raider can aim it.
 */
function entry(state: State, targets: Targets): { bursts: string[][]; hold?: boolean; shows: (document: FitDocument) => boolean } | string {
	const has = (id: string) => (document: FitDocument): boolean => nodes(document, (node) => node.id === id).length > 0;
	switch (state) {
		case 'planning':
			return { bursts: [], shows: () => true };
		case 'inspect-left':
		case 'inspect-right': {
			const card = state === 'inspect-left' ? targets.leftCard : targets.rightCard;
			if (!card) return 'no card at that end of the hands';
			return { bursts: [[`move,${card}`, `click,${card},2`]], shows: has('card_detail') };
		}
		case 'targeting': {
			if (!targets.headshot || !targets.raider) return 'no Headshot, or no raider to aim it at';
			const [x, y] = targets.headshot.split(',').map(Number);
			return {
				bursts: [
					[`move,${targets.headshot}`, `down,${targets.headshot}`],
					[`move,${point(x + 6, y - 30)}`, `move,${point(x + 12, y - 60)}`],
					[`move,${targets.raider}`],
				],
				hold: true,
				shows: has('combat_hit_check'),
			};
		}
		default:
			if (!targets.endTurn) return 'no End Turn';
			return {
				bursts: [[`move,${targets.endTurn}`]],
				shows: (document) => nodes(document, (node) => node.id === 'end_turn_button' && node.state?.hovered === true).length > 0,
			};
	}
}

interface CaseResult {
	key: string;
	problems: string[];
}

function measure(document: FitDocument, key: string): CaseResult {
	const lint = layoutLint(document as unknown as LintDocument);
	const problems = [
		...lint.violations.map((violation) => `lint ${violation.rule}: ${violation.path}${violation.otherPath ? ` against ${violation.otherPath}` : ''}`),
		...battleFit(document).map((finding) => `${finding.check}: ${finding.detail}`),
	];
	const measured = lint.rules.find((rule) => rule.rule === 'outside-viewport')?.evaluated ?? 0;
	if (measured <= 2) problems.push('lint measured an empty tree');
	return { key, problems };
}

/** Frames a state gets to arrive, then a few more at a time until it has, up to a limit. */
const ENTRY_FRAMES = 1;
const MORE_FRAMES = 2;
const ENTRY_TRIES = 6;

async function runSize(page: Page, scenario: Scenario, viewport: Viewport): Promise<CaseResult[]> {
	await page.setViewportSize(viewport);
	await settle(page, viewport);
	const targets = targetsOf(await snapshot(page), viewport);
	const results: CaseResult[] = [];
	let pinnedAt: string | null = null;
	for (const state of STATES) {
		const key = `${scenario} ${size(viewport)} ${state}`;
		const plan = entry(state, targets);
		if (typeof plan === 'string') {
			results.push({ key, problems: [`could not enter ${state}: ${plan}`] });
			continue;
		}
		const [first, ...rest] = plan.bursts;
		// Planning is the screen at rest, where the last size left it
		let refused = first ? await drive(page, [...putAway(targets, pinnedAt), ...first], ENTRY_FRAMES, plan.hold) : null;
		for (const burst of rest) refused ??= await drive(page, burst, ENTRY_FRAMES, plan.hold);
		pinnedAt = state === 'inspect-left' ? targets.leftCard : state === 'inspect-right' ? targets.rightCard : null;
		let document = await snapshot(page);
		for (let tries = 0; !refused && !plan.shows(document) && tries < ENTRY_TRIES; tries++) {
			await drive(page, [], MORE_FRAMES, plan.hold);
			document = await snapshot(page);
		}
		if (refused || !plan.shows(document)) {
			results.push({ key, problems: [`could not enter ${state}: ${refused ?? 'it never showed'}`] });
			continue;
		}
		const result = measure(document, key);
		// Only the inspect states show a detail view; one anywhere else was left open
		const details = nodes(document, (node) => node.id === 'card_detail').length;
		if (details !== (state.startsWith('inspect') ? 1 : 0)) result.problems.push(`${details} detail views showing`);
		results.push(result);
	}
	await drive(page, putAway(targets, pinnedAt), 1);
	return results;
}

/** The typical scene at rest, at each golden size, before any input has reached it. */
async function captureGoldens(page: Page, testInfo: TestInfo, scenario: Scenario): Promise<void> {
	for (const viewport of GOLDEN_VIEWPORTS) {
		await page.setViewportSize(viewport);
		await settle(page, viewport);
		const name = viewport === FIXED_VIEWPORT ? `battle-${scenario}` : `battle-${scenario}-${size(viewport)}`;
		await expectTextSnapshot(page, 'scene', name);
		await expectGolden(page, testInfo, 'scene', name);
	}
}

test.describe('battle screen fit', () => {
	for (const scenario of SCENARIOS) {
		test(`battle-${scenario}`, async ({ page }, testInfo) => {
			// Seven sizes, five states each, on software GL
			test.setTimeout(300_000);
			const log = captureConsole(page);
			const first = scenario === 'typical' ? GOLDEN_VIEWPORTS[0] : VIEWPORTS[0];
			await page.setViewportSize(first);
			await prepare(page);
			await openScene(page, `battle-${scenario}`, first);

			// The opening banner runs out on the frame clock
			for (let tries = 0; tries < 40; tries++) {
				if (nodes(await snapshot(page), (node) => node.id === 'combat_turn_banner').length === 0) break;
				await drive(page, [], 5);
			}
			expect(nodes(await snapshot(page), (node) => node.id === 'combat_turn_banner'), 'the opening banner should leave').toEqual([]);

			if (scenario === 'typical') await captureGoldens(page, testInfo, scenario);

			const results: CaseResult[] = [];
			for (const viewport of VIEWPORTS) results.push(...await runSize(page, scenario, viewport));

			await testInfo.attach('fit.json', { body: JSON.stringify(results, null, '\t'), contentType: 'application/json' });
			const failing = results.filter((result) => result.problems.length > 0);
			const unexpected = failing.filter((result) => !EXPECTED_FAILURES[result.key]);
			const fixed = results.filter((result) => result.problems.length === 0 && EXPECTED_FAILURES[result.key]);
			for (const result of failing.filter((entry) => EXPECTED_FAILURES[entry.key])) {
				testInfo.annotations.push({ type: 'expected failure', description: `${result.key} (${EXPECTED_FAILURES[result.key]}): ${result.problems[0]}` });
			}
			const report = unexpected.map((result) => [`${result.key}:`, ...result.problems.slice(0, 12).map((problem) => `\t${problem}`)].join('\n'));
			expect(unexpected.length, `cases that don't fit:\n${report.join('\n')}`).toBe(0);
			expect(fixed.map((result) => `${result.key} passes now; remove it from EXPECTED_FAILURES (${EXPECTED_FAILURES[result.key]})`)).toEqual([]);
			expectCleanConsole(log);
		});
	}
});
