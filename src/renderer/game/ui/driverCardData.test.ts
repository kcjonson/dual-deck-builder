import { DriverRecord } from '../campaign/DriverRecord';
import { DRIVER_CONFIGS } from '../mechanics/Driver';
import { driverCardData, driverDeckSize, startingDriverDeck } from './driverCardData';

describe('driverCardData', () => {
	it('builds a fresh driver of an archetype from its config', () => {
		expect(driverCardData({ archetype: 'road_warrior' })).toEqual({
			name: 'THE ROAD WARRIOR',
			specialty: 'DEFENSIVE TANK',
			hitpoints: 40,
			maxHitpoints: 40,
			handLimit: DRIVER_CONFIGS.road_warrior.handLimit,
			deck: { ramming_speed: 5, armor_plating: 3, repair_kit: 2, nitro_boost: 2 },
			vehicle: 'Apocalypse Rig',
			skills: DRIVER_CONFIGS.road_warrior.skills,
		});
	});

	it('takes what a campaign record keeps of its own over the config', () => {
		const data = driverCardData({ archetype: 'interceptor', name: 'Interceptor 2', hitpoints: 12, handLimit: 8, deck: { headshot: 4 }, note: 'Found day 3' });
		expect(data).toMatchObject({ name: 'Interceptor 2', specialty: 'AGILE STRIKER', hitpoints: 12, maxHitpoints: 25, handLimit: 8, deck: { headshot: 4 }, note: 'Found day 3' });
	});

	it('maps a campaign driver record onto the card, its deck passing straight through', () => {
		const record = new DriverRecord({ id: 'driver-5', archetype: 'mechanic', name: 'Mechanic 2', hitpoints: 12 });
		const data = driverCardData({
			archetype: record.archetype,
			name: record.name,
			hitpoints: record.hitpoints,
			maxHitpoints: record.maxHitpoints,
			handLimit: record.handLimit,
			deck: record.defaultDeck,
		});
		expect(data).toMatchObject({ name: 'Mechanic 2', specialty: 'SUPPORT SPECIALIST', hitpoints: 12, maxHitpoints: 30, handLimit: 7, vehicle: 'Mobile Workshop' });
		expect(data.deck).toBe(record.defaultDeck);
		expect(driverDeckSize(data.deck)).toBe(record.deckSize);
	});

	it('starts at full HP against an overridden maximum, and leaves the note out when there is none', () => {
		const data = driverCardData({ archetype: 'mechanic', maxHitpoints: 36 });
		expect([data.hitpoints, data.maxHitpoints]).toEqual([36, 36]);
		expect('note' in data).toBe(false);
	});

	it('copies the config\'s skills rather than sharing them', () => {
		expect(driverCardData({ archetype: 'raider' }).skills).not.toBe(DRIVER_CONFIGS.raider.skills);
	});

	it('counts a deck\'s cards', () => {
		expect(driverDeckSize({})).toBe(0);
		expect(driverDeckSize(startingDriverDeck('interceptor'))).toBe(11);
		expect(driverDeckSize({ ram: 2, headshot: 3 })).toBe(5);
	});

	it('turns a starting deck into counts by type, frozen', () => {
		const deck = startingDriverDeck('mechanic');
		expect(deck).toEqual({ emp_blast: 1, repair_kit: 3, nitro_boost: 2, armor_plating: 2 });
		expect(Object.isFrozen(deck)).toBe(true);
	});
});
