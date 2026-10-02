/**
 * @jest-environment jsdom
 */
import cardsFile from '../../data/cards.json';
import { CombatScreen, DOCK_DROP, ENEMY_TURN_LEAD_IN } from './CombatScreen';
import { CardLoader } from '../../core/CardLoader';
import { DriverLoader } from '../../core/DriverLoader';
import { createTestContext } from '../../../engine/components/testing';
import { Clock } from '../../../engine/animation/Clock';
import { advance, click, pointer, send } from '../../../engine/services/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { treeSnapshot, SnapshotNode } from '../../../engine/debug/treeSnapshot';
import { layoutLint } from '../../../engine/debug/layoutLint';
import { tokens } from '../../../engine/theme/tokens';
import { TURN_BANNER_LIFETIME } from './TurnBanner';
import { EnemyIntent } from '../../ui/IntentPill';
import { incomingDamage, incomingLabel } from './EndTurnPreview';

/**
 * DDB-139: the end-turn preview from End Turn's hover or keyboard focus,
 * and the enemy turn's presentation: the dock dropped and greyed as a
 * declared park, and the acting raider's glow.
 */

jest.mock('../../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const context = createTestContext({
	viewport: { get logical() { return { width: window.innerWidth, height: window.innerHeight }; } },
	clock: new Clock(),
});
const originalFetch = global.fetch;

function flushPromises(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

async function startCombat(): Promise<CombatScreen> {
	const combat = new CombatScreen();
	combat.mount(context);
	await flushPromises();
	await flushPromises();
	context.frame.layout();
	// The opening banner goes, so nothing holds the enemy turn's start back
	advance(context, TURN_BANNER_LIFETIME + 16);
	return combat;
}

function finishEnemyTurn(combat: CombatScreen): void {
	for (let frames = 0; combat['battle']?.enemyTurnInProgress && frames < 2000; frames++) advance(context, 16);
	expect(combat['battle']?.enemyTurnInProgress).toBe(false);
}

function endTurnCentre(combat: CombatScreen): { x: number; y: number } {
	const { x, y, width, height } = combat['endTurnColumn'].endTurn.screenBounds;
	return { x: x + width / 2, y: y + height / 2 };
}

function hasPark(node: SnapshotNode): boolean {
	return node.parked !== undefined || [...(node.parts ?? []), ...node.children].some(hasPark);
}

beforeAll(async () => {
	jest.spyOn(console, 'log').mockImplementation(() => undefined);
	global.fetch = jest.fn().mockResolvedValue({ ok: true, statusText: 'OK', json: async () => cardsFile }) as unknown as typeof fetch;
	await CardLoader.getInstance().loadCards();
	await DriverLoader.getInstance().loadDrivers();
	Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
	Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 720 });
});

afterEach(() => {
	context.animator.reducedMotion = false;
	send(context, [pointer('move', 1, 1)]);
});

afterAll(() => {
	global.fetch = originalFetch;
	jest.restoreAllMocks();
});

describe('incoming damage', () => {
	const hit = (value: number | undefined, targetIds: string[], hits = 1): EnemyIntent =>
		({ type: 'attack', value, hits, valueText: value === undefined ? '?' : undefined, description: 'Ram', targetIds });

	it('adds up every attack per vehicle, an area hit on each, a multi-hit every hit', () => {
		const totals = incomingDamage([
			[hit(8, ['rig']), { type: 'debuff', description: 'Oil', targetIds: ['bike'] }],
			[hit(6, ['rig', 'bike'], 3)],
		]);
		expect(totals.get('rig')).toEqual({ damage: 26, hidden: false });
		expect(totals.get('bike')).toEqual({ damage: 18, hidden: false });
	});

	it('marks a total a hidden attack adds to, and prints it as more than it says', () => {
		const totals = incomingDamage([[hit(8, ['rig']), hit(undefined, ['rig', 'bike'])]]);
		expect(incomingLabel(totals.get('rig') ?? { damage: 0, hidden: false })).toBe('-8+?');
		expect(incomingLabel(totals.get('bike') ?? { damage: 0, hidden: false })).toBe('-?');
		expect(incomingLabel({ damage: 0, hidden: false })).toBeNull();
	});
});

describe('CombatScreen end-turn preview', () => {
	it('shows each intent\'s line and your incoming totals while the pointer is on End Turn', async () => {
		const combat = await startCombat();
		const preview = combat['intentPreview'];
		expect(preview.showing).toBe(false);

		const at = endTurnCentre(combat);
		send(context, [pointer('move', at.x, at.y)]);
		expect(preview.showing).toBe(true);

		// The totals are the planned attacks on each of your vehicles
		const intents = combat['battle']?.getAllIntents() ?? new Map();
		const expected = new Map<string, number>();
		for (const plan of intents.values()) {
			for (const intent of plan) {
				if (intent.type !== 'attack' || intent.amount === null || typeof intent.target !== 'string' || intent.target === 'both') continue;
				expected.set(intent.target, (expected.get(intent.target) ?? 0) + intent.amount * intent.hits);
			}
		}
		for (const [vehicleId, damage] of expected) expect(preview.incoming.get(vehicleId)).toBe(`-${damage}`);

		const { api, backend } = createMeasuringDrawApi();
		api.beginFrame({ viewport: { width: 1280, height: 720 } });
		preview.render(api);
		api.endFrame();
		const targeted = [...intents.values()].flat().filter((intent) => intent.target !== null).length;
		expect(targeted).toBeGreaterThan(0);
		expect(backend.commands.filter((command) => command.kind === 'line').length).toBeGreaterThan(targeted);
		expect(backend.commands.filter((command) => command.kind === 'circle')).toHaveLength(targeted);

		send(context, [pointer('move', 1, 1)]);
		expect(preview.showing).toBe(false);
		combat.unmount();
	});

	it('shows from End Turn\'s keyboard focus too, the keyboard\'s way to read the plan', async () => {
		const combat = await startCombat();
		const button = combat['endTurnColumn'].endTurn;
		button.setFocusState(true, true);
		expect(combat['intentPreview'].showing).toBe(true);
		button.setFocusState(true, false);
		expect(combat['intentPreview'].showing).toBe(false);
		combat.unmount();
	});

	it('draws nothing while the raiders act', async () => {
		const combat = await startCombat();
		const at = endTurnCentre(combat);
		combat['endPlayerTurn']();
		send(context, [pointer('move', at.x, at.y)]);
		expect(combat['intentPreview'].showing).toBe(false);
		combat.unmount();
	});
});

describe('CombatScreen enemy turn presentation', () => {
	it('drops the hands 60 and greys them on the animator, parked only while down, with End Turn and the dock in place', async () => {
		const combat = await startCombat();
		const hands = combat['handLayer'];
		const scrim = combat['dockScrim'];
		const endTurn = combat['endTurnColumn'].endTurn;
		const dockAt = combat['dock'].screenBounds.y;
		const endTurnAt = endTurn.screenBounds.y;
		const handsAt = hands.screenBounds.y;
		expect(hands.parkOffset).toBeNull();
		expect(scrim.visible).toBe(false);

		combat['endPlayerTurn']();
		advance(context, 16);
		expect(hands.parkOffset?.y).toBeGreaterThan(0);
		expect(hands.parkOffset?.y).toBeLessThan(DOCK_DROP);
		advance(context, tokens.motion.dur);
		expect(hands.parkOffset).toEqual({ x: 0, y: DOCK_DROP });
		expect(scrim.parkOffset).toEqual({ x: 0, y: DOCK_DROP });
		expect(scrim.visible).toBe(true);
		expect(scrim.opacity).toBe(1);
		// The scrim covers the hands, not End Turn
		expect(scrim.screenBounds).toEqual(hands.screenBounds);
		expect(scrim.screenBounds.x + scrim.screenBounds.width).toBeLessThanOrEqual(endTurn.screenBounds.x);
		expect(hands.screenBounds.y).toBeCloseTo(handsAt + DOCK_DROP, 6);
		expect(combat['dock'].screenBounds.y).toBe(dockAt);
		expect(endTurn.screenBounds.y).toBe(endTurnAt);
		expect(endTurn.label).toBe('WAIT');
		expect(combat['dock'].effectivelyEnabled).toBe(false);

		finishEnemyTurn(combat);
		advance(context, tokens.motion.dur + 16);
		expect(hands.parkOffset).toBeNull();
		expect(scrim.visible).toBe(false);
		combat.unmount();
	});

	it('snaps the hands down and back under reduced motion', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		combat['endPlayerTurn']();
		expect(combat['handLayer'].parkOffset).toEqual({ x: 0, y: DOCK_DROP });
		finishEnemyTurn(combat);
		expect(combat['handLayer'].parkOffset).toBeNull();
		combat.unmount();
	});

	it('lints the dropped hands where they rest, and the landed ones with no park at all', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		const viewport = { width: 1280, height: 720 };
		// The placement rules; this context measures no text, so the text and size rules don't apply here
		const placement = new Set(['sibling-overlap', 'child-outside-parent', 'outside-viewport']);
		const dockViolations = (): string[] => layoutLint(treeSnapshot([combat['rootLayer']], viewport)).violations
			.filter((violation) => placement.has(violation.rule) && /combat_dock/.test(violation.path))
			.map((violation) => `${violation.rule}: ${violation.path}`);
		expect(dockViolations()).toEqual([]);

		combat['endPlayerTurn']();
		context.frame.layout();
		const dropped = treeSnapshot([combat['rootLayer']], viewport);
		expect(hasPark(dropped.roots[0])).toBe(true);
		expect(dockViolations()).toEqual([]);

		// Without the declaration the same drop would be reported
		const undeclared = (node: SnapshotNode): SnapshotNode => ({ ...node, parked: undefined, parts: node.parts?.map(undeclared), children: node.children.map(undeclared) });
		const reported = layoutLint({ ...dropped, roots: dropped.roots.map(undeclared) }).violations
			.filter((violation) => violation.rule === 'child-outside-parent' && /combat_dock/.test(violation.path));
		expect(reported.length).toBeGreaterThan(0);

		finishEnemyTurn(combat);
		context.frame.layout();
		expect(hasPark(treeSnapshot([combat['rootLayer']], viewport).roots[0])).toBe(false);
		expect(dockViolations()).toEqual([]);
		combat.unmount();
	});

	it('takes no input while dropped: a tab\'s piles and End Turn do nothing', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		const layer = combat['handLayer'];
		const opened = jest.fn();
		layer.onOpenPiles = opened;
		combat['endPlayerTurn']();
		context.frame.layout();
		const pacer = combat['enemyTurnPacer'];
		const start = jest.spyOn(pacer as NonNullable<typeof pacer>, 'start');

		const piles = layer.pilesOf(1).screenBounds;
		click(context, piles.x + piles.width / 2, piles.y + piles.height / 2);
		expect(opened).not.toHaveBeenCalled();

		const endTurn = combat['endTurnColumn'].endTurn.screenBounds;
		click(context, endTurn.x + endTurn.width / 2, endTurn.y + endTurn.height / 2);
		expect(start).not.toHaveBeenCalled();
		expect(combat['battle']?.enemyTurnInProgress).toBe(true);

		// The same click on the tab reaches it once the hands are back
		finishEnemyTurn(combat);
		context.frame.layout();
		const back = layer.pilesOf(1).screenBounds;
		click(context, back.x + back.width / 2, back.y + back.height / 2);
		expect(opened).toHaveBeenCalledTimes(1);
		combat.unmount();
	});

	it('glows the acting raider while its action is on screen, and no one after', async () => {
		const combat = await startCombat();
		const [raider] = combat['enemyTeam']?.vehicles ?? [];
		const view = combat['road'].vehicleView(raider.id);
		expect(view?.acting).toBe(false);
		combat['endPlayerTurn']();
		advance(context, ENEMY_TURN_LEAD_IN + 32);
		const acting = combat['actingRaider'];
		expect(acting).not.toBeNull();
		expect(combat['road'].vehicleView(acting?.id ?? '')?.acting).toBe(true);
		finishEnemyTurn(combat);
		expect(combat['road'].vehicleView(raider.id)?.acting ?? false).toBe(false);
		combat.unmount();
	});

	it('starts a hit\'s number under the banner when the banner is across its plate', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		combat['endPlayerTurn']();
		advance(context, ENEMY_TURN_LEAD_IN + 32);
		const banner = combat['turnBanner'];
		expect(banner.visible).toBe(true);
		const band = banner.screenBounds;
		const numbers = combat['fx'].floatingNumbers;
		expect(numbers.length).toBeGreaterThan(0);
		for (const number of numbers) expect(number.screenBounds.y).toBeGreaterThanOrEqual(band.y + band.height - 0.5);
		combat.unmount();
	});
});

describe('CombatScreen log drawer and the preview', () => {
	it('draws the open log over the preview: same layer, ordered by zIndex', async () => {
		const combat = await startCombat();
		const preview = combat['intentPreview'];
		const log = combat['combatLogLayer'];
		expect(preview.parent).toBe(log.parent);
		expect(preview.layer).toBe(log.layer);
		expect(preview.zIndex).toBeLessThan(log.zIndex);
		combat['toggleCombatLog']();
		const at = endTurnCentre(combat);
		send(context, [pointer('move', at.x, at.y)]);
		expect(preview.showing).toBe(true);
		const snapshot = treeSnapshot([combat['rootLayer']], { width: 1280, height: 720 });
		const find = (node: SnapshotNode, id: string): SnapshotNode | null =>
			node.id === id ? node : [...(node.parts ?? []), ...node.children].reduce<SnapshotNode | null>((found, child) => found ?? find(child, id), null);
		const previewNode = find(snapshot.roots[0], 'combat_end_turn_preview');
		const logNode = find(snapshot.roots[0], 'combat_log');
		expect(previewNode?.layer).toBe(logNode?.layer);
		expect(previewNode?.zIndex ?? 0).toBeLessThan(logNode?.zIndex ?? 0);
		combat.unmount();
	});
});
