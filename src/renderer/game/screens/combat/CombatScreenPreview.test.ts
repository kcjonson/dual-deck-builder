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
	it('drops the dock 60 and greys it on the animator, parked only while it is down', async () => {
		const combat = await startCombat();
		const dock = combat['dock'];
		const scrim = combat['dockScrim'];
		expect(dock.parkOffset).toBeNull();
		expect(scrim.visible).toBe(false);

		combat['endPlayerTurn']();
		advance(context, 16);
		expect(dock.parkOffset?.y).toBeGreaterThan(0);
		expect(dock.parkOffset?.y).toBeLessThan(DOCK_DROP);
		advance(context, tokens.motion.dur);
		expect(dock.parkOffset).toEqual({ x: 0, y: DOCK_DROP });
		expect(scrim.parkOffset).toEqual({ x: 0, y: DOCK_DROP });
		expect(scrim.visible).toBe(true);
		expect(scrim.opacity).toBe(1);
		expect(dock.effectivelyEnabled).toBe(false);

		finishEnemyTurn(combat);
		advance(context, tokens.motion.dur + 16);
		expect(dock.parkOffset).toBeNull();
		expect(scrim.visible).toBe(false);
		combat.unmount();
	});

	it('snaps the dock down and back under reduced motion', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		combat['endPlayerTurn']();
		expect(combat['dock'].parkOffset).toEqual({ x: 0, y: DOCK_DROP });
		finishEnemyTurn(combat);
		expect(combat['dock'].parkOffset).toBeNull();
		combat.unmount();
	});

	it('lints the dropped dock where it rests, and the landed one with no park at all', async () => {
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
			.filter((violation) => violation.rule === 'outside-viewport' && /combat_dock/.test(violation.path));
		expect(reported.length).toBeGreaterThan(0);

		finishEnemyTurn(combat);
		context.frame.layout();
		expect(hasPark(treeSnapshot([combat['rootLayer']], viewport).roots[0])).toBe(false);
		expect(dockViolations()).toEqual([]);
		combat.unmount();
	});

	it('takes no input while dropped', async () => {
		context.animator.reducedMotion = true;
		const combat = await startCombat();
		const [driver] = combat['playerDrivers'];
		combat['endPlayerTurn']();
		const layer = combat['handLayer'];
		const card = layer.handCards.map(handCard => layer.getCardElementByCard(handCard)).find(element => element !== null);
		const before = [...driver.hand];
		if (card) {
			const { x, y, width } = card.screenBounds;
			click(context, x + width / 2, y + 10);
		}
		expect(combat['combatModel'].selectedCard).toBeNull();
		expect(driver.hand).toEqual(before);
		combat.unmount();
	});

	it('glows the acting raider while its action is on screen, and no one after', async () => {
		const combat = await startCombat();
		const [raider] = combat['enemyTeam']?.vehicles ?? [];
		const view = combat['road'].vehicleView(raider.id);
		expect(view?.acting).toBe(false);
		combat['endPlayerTurn']();
		advance(context, ENEMY_TURN_LEAD_IN + 32);
		if (combat['actingRaider']) expect(combat['road'].vehicleView(combat['actingRaider'].id)?.acting).toBe(true);
		finishEnemyTurn(combat);
		expect(combat['road'].vehicleView(raider.id)?.acting ?? false).toBe(false);
		combat.unmount();
	});
});
