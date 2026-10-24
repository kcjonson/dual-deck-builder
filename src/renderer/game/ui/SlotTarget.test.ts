/**
 * @jest-environment jsdom
 */
import type { MountContext } from '../../engine/components/MountContext';
import { createTestContext } from '../../engine/components/testing';
import { pointer, send } from '../../engine/services/testing';
import { RoadLane, RoadRow, RoadSlot } from '../mechanics/Road';
import { CombatModel } from '../screens/combat/CombatModel';
import { RoadView } from '../screens/combat/RoadView';
import { SlotTarget } from './SlotTarget';
import { OWN_TARGETABLE, RAIDER_TARGETABLE } from './Vehicle';

/**
 * DDB-548: a slot a waiting card's move can go to, as the road shows it
 * and the combat model hears it.
 */

const OUTSIDE_CENTER: RoadSlot = { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.CENTER };
const INSIDE_AHEAD: RoadSlot = { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.AHEAD };
const THEIR_AHEAD: RoadSlot = { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.AHEAD };

function centre(target: SlotTarget): [number, number] {
	const { x, y, width, height } = target.screenBounds;
	return [x + width / 2, y + height / 2];
}

describe('SlotTarget on the road', () => {
	let context: MountContext;
	let model: CombatModel;
	let road: RoadView;

	beforeEach(() => {
		context = createTestContext();
		model = new CombatModel();
		road = new RoadView({ id: 'road', width: 1280, height: 456, combatData: model });
		road.mount(context);
		model.isTargeting = true;
		model.targetableSlots = [OUTSIDE_CENTER, INSIDE_AHEAD];
		road.showSlotTargets({ slots: model.targetableSlots, picked: null });
		context.frame.layout();
	});

	afterEach(() => {
		road.unmount();
	});

	it('sits inside its slot, dashed in the colour of the side whose formation it is in', () => {
		const target = road.slotTargetAt(OUTSIDE_CENTER) as SlotTarget;
		const cell = road.slotRect(OUTSIDE_CENTER);
		expect(target.x).toBeGreaterThan(cell.x);
		expect(target.x + target.width).toBeLessThan(cell.x + cell.width);
		expect(target.isSolid).toBe(false);
		expect(target.focusable).toBe(true);
		expect(target.resolvedColors.border).toEqual(OWN_TARGETABLE);

		road.showSlotTargets({ slots: [THEIR_AHEAD], picked: null });
		expect(road.slotTargetAt(THEIR_AHEAD)?.resolvedColors.border).toEqual(RAIDER_TARGETABLE);
		expect(road.slotTargetAt(OUTSIDE_CENTER)).toBeNull();
	});

	it('previews on hover and chooses on a click, through the model', () => {
		const target = road.slotTargetAt(INSIDE_AHEAD) as SlotTarget;
		const [x, y] = centre(target);
		send(context, [pointer('move', x, y)]);
		expect(model.focusedSlot).toEqual(INSIDE_AHEAD);
		expect(target.isSolid).toBe(true);
		expect(road.slotTargetAt(OUTSIDE_CENTER)?.isSolid).toBe(false);

		send(context, [pointer('down', x, y), pointer('up', x, y)]);
		expect(model.targetedSlot).toEqual(INSIDE_AHEAD);

		send(context, [pointer('move', 1, 1)]);
		expect(model.focusedSlot).toBeNull();
		expect(target.isSolid).toBe(false);
	});

	it('keeps the element of a target that stays, and swaps a legal slot for a chosen one', () => {
		const kept = road.slotTargetAt(OUTSIDE_CENTER);
		road.showSlotTargets({ slots: [OUTSIDE_CENTER], picked: INSIDE_AHEAD });
		expect(road.slotTargetAt(OUTSIDE_CENTER)).toBe(kept);
		const picked = road.slotTargetAt(INSIDE_AHEAD) as SlotTarget;
		expect(picked.picked).toBe(true);
		expect(picked.isSolid).toBe(true);
		expect(picked.focusable).toBe(false);
		expect(picked.pointerEvents).toBe('none');

		road.showSlotTargets({ slots: [], picked: null });
		expect(road.slotTargetViews).toHaveLength(0);
	});

	it('follows its slot when the road is resized', () => {
		road.setSize(1600, 600);
		context.frame.layout();
		const target = road.slotTargetAt(INSIDE_AHEAD) as SlotTarget;
		const cell = road.slotRect(INSIDE_AHEAD);
		expect(target.x).toBeGreaterThan(cell.x);
		expect(target.x + target.width).toBeLessThan(cell.x + cell.width);
		expect(target.y).toBeGreaterThan(cell.y);
		expect(target.y + target.height).toBeLessThan(cell.y + cell.height);
	});

	it('refuses to show targets without a model to tell', () => {
		const bare = new RoadView({ id: 'bare', width: 1280, height: 456 });
		expect(() => bare.showSlotTargets({ slots: [INSIDE_AHEAD], picked: null })).toThrow('combat model');
	});
});
