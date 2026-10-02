import { describe, expect, it } from '@jest/globals';
import { battleFit, tokenSlot } from './battleFit';
import type { FitDocument, FitNode } from './battleFit';
import { computeRoadLayout, roadSlotRect } from '../../../src/renderer/game/screens/combat/CombatLayout';
import { RoadLane, RoadRow } from '../../../src/renderer/game/mechanics/Road';

/**
 * The fit check's rules, each made to fire on a hand-built tree: a clean
 * battle screen in the suite proves nothing unless each check can fail.
 */

const ROAD = { w: 1280, h: 456 };
const layout = computeRoadLayout({ width: ROAD.w, height: ROAD.h });

function node(partial: Partial<FitNode> & { type: string }): FitNode {
	const bounds = partial.bounds ?? { x: 0, y: 0, w: 10, h: 10 };
	return { id: null, visible: true, bounds, screenBounds: partial.screenBounds ?? bounds, children: [], ...partial };
}

/** A token in `lane`/`row` for `side`, centred in its slot at x1, the road at the viewport's origin. */
function token(side: 'player' | 'enemy', lane: RoadLane, row: RoadRow, height = 117): FitNode {
	const slot = roadSlotRect(layout, { lane, row });
	const bounds = { x: slot.x + (slot.width - 196) / 2, y: slot.y + (slot.height - height) / 2, w: 196, h: height };
	return node({ id: `${side}_vehicle_${lane}_${row}`, type: 'Vehicle', bounds, screenBounds: { ...bounds } });
}

function screen(children: FitNode[], extra: FitNode[] = [], road = ROAD): FitDocument {
	const roadView = node({ id: 'combat_road_view', type: 'RoadView', bounds: { x: 0, y: 0, ...road }, children });
	return { viewport: { width: 1280, height: 720 }, roots: [node({ id: 'combatScreen', type: 'Container', bounds: { x: 0, y: 0, w: 1280, h: 720 }, children: [roadView, ...extra] })] };
}

const checks = (document: FitDocument): string[] => battleFit(document).map((finding) => finding.check);

describe('battleFit', () => {
	it('passes a legal road', () => {
		expect(battleFit(screen([
			token('player', RoadLane.PLAYER_INSIDE, RoadRow.CENTER),
			token('player', RoadLane.ENEMY_SHOULDER, RoadRow.AHEAD),
			token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.CENTER),
			token('enemy', RoadLane.PLAYER_SHOULDER, RoadRow.BEHIND),
		]))).toEqual([]);
	});

	it('fails a token on its own shoulder', () => {
		expect(checks(screen([token('player', RoadLane.PLAYER_SHOULDER, RoadRow.AHEAD)]))).toEqual(['slot']);
		expect(checks(screen([token('enemy', RoadLane.ENEMY_SHOULDER, RoadRow.AHEAD)]))).toEqual(['slot']);
	});

	it('fails two tokens in one slot, and one drawn outside the slot its id names', () => {
		expect(checks(screen([token('player', RoadLane.PLAYER_INSIDE, RoadRow.CENTER), token('player', RoadLane.PLAYER_INSIDE, RoadRow.CENTER)]))).toContain('slot');
		const stray = token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.CENTER);
		stray.bounds = { ...stray.bounds, y: stray.bounds.y + layout.slotHeight };
		stray.screenBounds = { ...stray.bounds };
		expect(checks(screen([stray]))).toEqual(['slot']);
	});

	it('fails a slot too small for a token at x1, by the road\'s own uncapped scale', () => {
		const short = { w: 1280, h: 300 };
		const small = computeRoadLayout({ width: short.w, height: short.h });
		const slot = roadSlotRect(small, { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER });
		const bounds = { x: slot.x, y: slot.y, w: 196, h: 117 };
		const squeezed = node({ id: 'player_vehicle_player_inside_center', type: 'Vehicle', bounds, screenBounds: { ...bounds } });
		expect(checks(screen([squeezed], [], short))).toContain('token-scale');
	});

	it('fails overlapping tokens of different owners, and lets a token\'s own pills off', () => {
		const a = token('enemy', RoadLane.ENEMY_INSIDE, RoadRow.CENTER);
		const pill = node({ type: 'IntentPill', bounds: { x: 0, y: 0, w: 30, h: 20 }, screenBounds: { x: a.bounds.x + 10, y: a.bounds.y, w: 30, h: 20 } });
		a.children = [pill];
		expect(checks(screen([a]))).toEqual([]);
		const b = token('enemy', RoadLane.ENEMY_OUTSIDE, RoadRow.CENTER);
		b.screenBounds = { ...a.screenBounds, x: a.screenBounds.x + 40 };
		expect(checks(screen([a, b]))).toContain('collision');
	});

	it('fails a card reaching under End Turn', () => {
		const button = node({ id: 'end_turn_button', type: 'Button', bounds: { x: 1116, y: 540, w: 148, h: 64 } });
		const card = node({ id: 'hand_card_9', type: 'Card', bounds: { x: 1000, y: 530, w: 128, h: 180 } });
		expect(checks(screen([], [button, card]))).toEqual(['collision']);
	});

	it('fails a card or the detail view off the frame', () => {
		expect(checks(screen([], [node({ type: 'Card', bounds: { x: 1200, y: 600, w: 128, h: 180 } })]))).toEqual(['offscreen']);
		expect(checks(screen([], [node({ id: 'card_detail_inspect_view', type: 'CardDetailView', bounds: { x: -20, y: 300, w: 300, h: 400 } })]))).toEqual(['offscreen']);
	});

	it('fails text taller than its box, wrapped or not, but not an ellipsis', () => {
		const tall = node({ type: 'Text', bounds: { x: 0, y: 0, w: 100, h: 34 }, text: { content: 'three lines', measured: { w: 90, h: 51 }, wrap: 'word', overflow: 'clip' } });
		expect(checks(screen([], [tall]))).toEqual(['overflow']);
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
