import { Card, CardEffect } from '../../mechanics/Card';
import { Driver, DriverRole } from '../../mechanics/Driver';
import { createTestDriver } from '../../ai/__tests__/test-helpers';
import { buildPlayerHandView } from './PlayerHandView';

const card = (name: string, effects: CardEffect[], cost = 1): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost,
	targetType: 'enemy_single',
	effects,
	tags: []
});

const farShot = () => card('Far Shot', [{ type: 'damage', value: 4, range: 2 }]);
const armorUp = () => card('Armor Up', [{ type: 'gain_armor', value: 3, target: 'self' }]);

describe('buildPlayerHandView', () => {
	let first: Driver;
	let second: Driver;

	beforeEach(() => {
		first = createTestDriver('First');
		second = createTestDriver('Second');
	});

	test('shows both hands when one driver rides as a passenger', () => {
		first.set({ hand: [farShot(), armorUp()], role: DriverRole.PASSENGER });
		second.set({ hand: [farShot()] });

		const view = buildPlayerHandView([first, second]);

		expect(view.cards).toEqual([...first.hand, ...second.hand]);
		expect(view.cards.map(c => view.seatOf.get(c.id))).toEqual([1, 1, 2]);
		expect(view.labels.get(1)).toBe('Driver 1 (passenger)');
		expect(view.labels.get(2)).toBe('Driver 2');
	});

	test("a passenger's attack cards are shown but unplayable", () => {
		const [shot, armor] = [farShot(), armorUp()];
		first.set({ hand: [shot, armor], role: DriverRole.PASSENGER });

		const view = buildPlayerHandView([first, second]);

		expect(view.playable.has(shot.id)).toBe(false);
		expect(view.playable.has(armor.id)).toBe(true);
	});

	test('each card is checked against its own driver\'s adrenaline', () => {
		const [cheap, dear] = [armorUp(), card('Big Armor', [{ type: 'gain_armor', value: 9 }], 4)];
		first.set({ hand: [cheap], adrenaline: 1 });
		second.set({ hand: [dear], adrenaline: 3 });

		const view = buildPlayerHandView([first, second]);

		expect(view.playable.has(cheap.id)).toBe(true);
		expect(view.playable.has(dear.id)).toBe(false);
	});

	test('a dead driver has no hand to show, and the other keeps their seat', () => {
		first.set({ hand: [armorUp()], hitpoints: 0 });
		second.set({ hand: [armorUp()] });

		const view = buildPlayerHandView([first, second]);

		expect(view.cards).toEqual(second.hand);
		expect(view.seatOf.get(second.hand[0].id)).toBe(2);
	});
});
