import { describe, expect, it } from '@jest/globals';
import { battleFit, tokenSlot } from './battleFit';
import type { FitDocument, FitNode } from './battleFit';
import { computeCombatStage, computeRoadLayout, roadSlotRect, DOCK_HEIGHT, TOP_BAR_HEIGHT } from '../../../src/renderer/game/screens/combat/CombatLayout';
import { RoadLane, RoadRow } from '../../../src/renderer/game/mechanics/Road';

/**
 * The fit check's rules, each made to fire on a hand-built tree: a clean
 * battle screen in the suite proves nothing unless each check can fail.
 * Trees are built at a stage scale, since the tolerances are in stage pixels
 * and the fan bug the suite found only showed at x1.5.
 */

const ROAD = { w: 1280, h: 456 };
const layout = computeRoadLayout({ width: ROAD.w, height: ROAD.h });

interface Rect { x: number; y: number; w: number; h: number }

const scaled = (rect: Rect, k: number): Rect => ({ x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k });

/** A node whose screen box is its box at stage scale `k`, the stage at the viewport's origin. */
function node(partial: Partial<FitNode> & { type: string }, k = 1): FitNode {
	const bounds = partial.bounds ?? { x: 0, y: 0, w: 10, h: 10 };
	return { id: null, visible: true, bounds, screenBounds: partial.screenBounds ?? scaled(bounds, k), children: [], ...partial };
}

/** A token in `lane`/`row` for `side`, centred in its slot at x1. */
function token(side: 'player' | 'enemy', lane: RoadLane, row: RoadRow, k = 1, height = 117): FitNode {
	const slot = roadSlotRect(layout, { lane, row });
	const bounds = { x: slot.x + (slot.width - 196) / 2, y: slot.y + (slot.height - height) / 2, w: 196, h: height };
	return node({ id: `${side}_vehicle_${lane}_${row}`, type: 'Vehicle', bounds }, k);
}

function screen(children: FitNode[], extra: FitNode[] = [], { road = ROAD, k = 1 }: { road?: { w: number; h: number }; k?: number } = {}): FitDocument {
	const roadView = node({ id: 'combat_road_view', type: 'RoadView', bounds: { x: 0, y: 0, ...road }, children }, k);
	return {
		viewport: { width: 1280 * k, height: 720 * k },
		roots: [node({ id: 'combatScreen', type: 'Container', bounds: { x: 0, y: 0, w: 1280, h: 720 }, children: [roadView, ...extra] }, k)],
	};
}

const checks = (document: FitDocument): string[] => battleFit(document).map((finding) => finding.check);

/** A hand of `count` cards under `hand`, as the dock nests them. */
function hand(id: string, count: number): FitNode {
	const cards = Array.from({ length: count }, (_unused, index) => node({ id: `hand_card_${index}`, type: 'Card', bounds: { x: 20 + index * 60, y: 500, w: 128, h: 180 } }));
	return node({ id, type: 'Container', bounds: { x: 0, y: 490, w: 600, h: 200 }, children: [node({ type: 'Stack', bounds: { x: 0, y: 490, w: 600, h: 200 }, children: cards })] });
}

describe('battleFit', () => {
	it('passes a legal road: flankers each in a row the other team holds', () => {
		expect(battleFit(screen([
			token('player', RoadLane.PLAYER_INSIDE, RoadRow.BEHIND),
			token('player', RoadLane.ENEMY_SHOULDER, RoadRow.AHEAD),
			token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.AHEAD),
			token('enemy', RoadLane.PLAYER_SHOULDER, RoadRow.BEHIND),
		]))).toEqual([]);
	});

	it('fails a token on its own shoulder', () => {
		expect(battleFit(screen([token('player', RoadLane.PLAYER_SHOULDER, RoadRow.AHEAD), token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.AHEAD)])).map((finding) => finding.detail))
			.toEqual([expect.stringContaining("can't use player_shoulder")]);
		expect(battleFit(screen([token('enemy', RoadLane.ENEMY_SHOULDER, RoadRow.AHEAD), token('player', RoadLane.PLAYER_INSIDE, RoadRow.AHEAD)])).map((finding) => finding.detail))
			.toEqual([expect.stringContaining("can't use enemy_shoulder")]);
	});

	it('fails a flanker in a row the other team\'s formation has nobody in', () => {
		const findings = battleFit(screen([
			token('player', RoadLane.ENEMY_SHOULDER, RoadRow.AHEAD),
			token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.CENTER),
			// A flanker in the row doesn't count: only the formation lanes do
			token('enemy', RoadLane.PLAYER_SHOULDER, RoadRow.AHEAD),
			token('player', RoadLane.PLAYER_INSIDE, RoadRow.CENTER),
		]));
		expect(findings.map((finding) => finding.detail)).toEqual([
			expect.stringContaining('player_vehicle_enemy_shoulder_ahead flanks an empty row'),
			expect.stringContaining('enemy_vehicle_player_shoulder_ahead flanks an empty row'),
		]);
	});

	it('fails two tokens in one slot, one drawn outside the slot its id names, and one whose id names no slot', () => {
		// Stacked in one slot they also collide
		expect(battleFit(screen([token('player', RoadLane.PLAYER_INSIDE, RoadRow.CENTER), token('player', RoadLane.PLAYER_INSIDE, RoadRow.CENTER)])).map((finding) => finding.detail))
			.toContainEqual(expect.stringContaining('shares player_inside center'));
		const stray = token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.CENTER);
		stray.bounds = { ...stray.bounds, y: stray.bounds.y + layout.slotHeight };
		stray.screenBounds = { ...stray.bounds };
		expect(checks(screen([stray]))).toEqual(['slot']);
		const unnamed = token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.CENTER);
		unnamed.id = 'enemy_vehicle_somewhere';
		expect(battleFit(screen([unnamed]))[0].detail).toContain("doesn't name a slot");
	});

	it('fails a slot too small for a token at x1, by the road\'s own uncapped scale', () => {
		const short = { w: 1280, h: 300 };
		const small = computeRoadLayout({ width: short.w, height: short.h });
		const slot = roadSlotRect(small, { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER });
		const squeezed = node({ id: 'player_vehicle_player_inside_center', type: 'Vehicle', bounds: { x: slot.x, y: slot.y, w: 196, h: 117 } });
		expect(checks(screen([squeezed], [], { road: short }))).toContain('token-scale');
	});

	it('fails a hand over the cap of seven', () => {
		expect(checks(screen([], [hand('driver1_hand', 7), hand('driver2_hand', 7)]))).toEqual([]);
		expect(battleFit(screen([], [hand('driver1_hand', 7), hand('driver2_hand', 8)]))).toEqual([{ check: 'hand-cap', detail: 'driver2_hand holds 8, over the cap of 7' }]);
	});

	describe.each([1, 1.5])('at stage scale %s', (k) => {
		it('lets a token\'s own pills and range chip off, and fails another owner\'s by more than two stage pixels', () => {
			const a = token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.CENTER, k);
			const pill = node({ type: 'IntentPill', bounds: { x: a.bounds.x + 10, y: a.bounds.y, w: 30, h: 20 } }, k);
			const chip = node({ type: 'RangeChip', bounds: { x: a.bounds.x, y: a.bounds.y + 2, w: 30, h: 17 } }, k);
			a.children = [pill, chip];
			expect(checks(screen([a], [], { k }))).toEqual([]);
			// The next slot's chip, reaching back over this token's plate by 3 stage pixels each way
			const b = token('enemy', RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER, k);
			const reach = node({ type: 'RangeChip', bounds: { x: a.bounds.x + a.bounds.w - 3, y: a.bounds.y + 40, w: 30, h: 17 } }, k);
			b.children = [reach];
			expect(checks(screen([a, b], [], { k }))).toEqual(['collision']);
			// Two stage pixels is the tolerance
			reach.bounds = { ...reach.bounds, x: a.bounds.x + a.bounds.w - 2 };
			reach.screenBounds = scaled(reach.bounds, k);
			expect(checks(screen([a, b], [], { k }))).toEqual([]);
		});

		it('fails a lane head over a row label, but not two lane heads', () => {
			const head = (lane: string, x: number): FitNode => node({ id: `combat_road_view_head_${lane}`, type: 'Text', bounds: { x, y: 0, w: 220, h: 26 } }, k);
			const label = node({ id: 'combat_road_view_row_ahead', type: 'Text', bounds: { x: 10, y: 10, w: 20, h: 60 } }, k);
			expect(checks(screen([head('a', 0), head('b', 200)], [], { k }))).toEqual([]);
			expect(checks(screen([head('a', 0), label], [], { k }))).toEqual(['collision']);
		});

		it('fails a card reaching under End Turn', () => {
			const button = node({ id: 'end_turn_button', type: 'Button', bounds: { x: 1116, y: 540, w: 148, h: 64 } }, k);
			const card = node({ id: 'hand_card_9', type: 'Card', bounds: { x: 1000, y: 530, w: 128, h: 180 } }, k);
			expect(checks(screen([], [button, card], { k }))).toEqual(['collision']);
		});

		it.each(['driver2_tab', 'end_turn_button', 'card_detail_inspect_view', 'card_detail_inspect_keywords'])('fails %s more than a stage pixel off the frame', (id) => {
			const inside = node({ id, type: 'Container', bounds: { x: 1280 - 200 + 1, y: 300, w: 200, h: 100 } }, k);
			expect(checks(screen([], [inside], { k }))).toEqual([]);
			const outside = node({ id, type: 'Container', bounds: { x: 1280 - 200 + 2, y: 300, w: 200, h: 100 } }, k);
			expect(checks(screen([], [outside], { k }))).toEqual(['offscreen']);
		});
	});

	it('fails a card off the frame', () => {
		expect(checks(screen([], [node({ type: 'Card', bounds: { x: 1200, y: 600, w: 128, h: 180 } })]))).toEqual(['offscreen']);
	});

	it('fails text past its box either way, wrapped or not, but not an ellipsis', () => {
		const tall = node({ type: 'Text', bounds: { x: 0, y: 0, w: 100, h: 34 }, text: { content: 'three lines', measured: { w: 90, h: 51 }, wrap: 'word', overflow: 'clip' } });
		expect(checks(screen([], [tall]))).toEqual(['overflow']);
		// A word longer than the wrap width gets a line to itself and runs out the side
		const wide = node({ type: 'Text', bounds: { x: 0, y: 0, w: 100, h: 34 }, text: { content: 'Deal 8. Unstoppablejuggernautram.', measured: { w: 131, h: 34 }, wrap: 'word', overflow: 'visible' } });
		expect(checks(screen([], [wide]))).toEqual(['overflow']);
		const cut = node({ type: 'Text', bounds: { x: 0, y: 0, w: 100, h: 17 }, text: { content: 'a long name', measured: { w: 140, h: 17 }, wrap: 'none', overflow: 'ellipsis' } });
		expect(checks(screen([], [cut]))).toEqual([]);
	});

	it('fails a keyword text\'s word past its block', () => {
		const word = node({ type: 'Text', bounds: { x: 0, y: 51, w: 30, h: 17 }, text: { content: 'Evade.', measured: { w: 30, h: 17 }, wrap: 'none' } });
		const block = node({ type: 'KeywordText', bounds: { x: 0, y: 0, w: 114, h: 51 }, parts: [word] });
		expect(checks(screen([], [block]))).toEqual(['overflow']);
	});

	it('fails a parked subtree', () => {
		expect(checks(screen([], [node({ type: 'Container', parked: { x: 0, y: 40 } })]))).toEqual(['parked']);
	});

	it('reads a token\'s side and slot from its id', () => {
		expect(tokenSlot(token('player', RoadLane.ENEMY_SHOULDER, RoadRow.BEHIND))).toEqual({ side: 'player', lane: RoadLane.ENEMY_SHOULDER, row: RoadRow.BEHIND });
		expect(tokenSlot(node({ id: 'card', type: 'Vehicle' }))).toBeNull();
	});
});

/**
 * Why the suite measures 1920x1080 and not 1280x720 as well: the stage is
 * `max(0.8, min(W / 1280, H / 720))`, so both lay out the same 1280x720
 * logical canvas, the larger at x1.5, where the lint's half-pixel tolerance
 * is tighter.
 */
describe('1280x720 and 1920x1080', () => {
	it('lay out one stage and one road', () => {
		const small = computeCombatStage({ width: 1280, height: 720 });
		const large = computeCombatStage({ width: 1920, height: 1080 });
		expect([large.width, large.height]).toEqual([small.width, small.height]);
		expect(large.scale).toBe(1.5);
		const band = (stage: { width: number; height: number }) => computeRoadLayout({ width: stage.width, height: stage.height - TOP_BAR_HEIGHT - DOCK_HEIGHT });
		expect(band(large)).toEqual(band(small));
	});
});
