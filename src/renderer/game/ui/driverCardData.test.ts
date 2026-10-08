import { startingDeckCounts, totalCards } from '../campaign/CardCounts';
import { DriverRecord } from '../campaign/DriverRecord';
import { DRIVER_CONFIGS, DriverArchetype } from '../mechanics/Driver';
import { DriverCardData, driverCardData, sameDriverCardData } from './driverCardData';

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
		expect(totalCards(data.deck)).toBe(record.deckSize);
	});

	it('starts at full HP against an overridden maximum, and leaves the note out when there is none, or it is empty', () => {
		const data = driverCardData({ archetype: 'mechanic', maxHitpoints: 36 });
		expect([data.hitpoints, data.maxHitpoints]).toEqual([36, 36]);
		expect('note' in data).toBe(false);
		expect('note' in driverCardData({ archetype: 'mechanic', note: '' })).toBe(false);
	});

	it('copies the config\'s skills rather than sharing them', () => {
		expect(driverCardData({ archetype: 'raider' }).skills).not.toBe(DRIVER_CONFIGS.raider.skills);
	});

	it('gives a fresh driver the campaign\'s own starting deck, the counts a new record gets', () => {
		for (const archetype of Object.keys(DRIVER_CONFIGS) as DriverArchetype[]) {
			const deck = driverCardData({ archetype }).deck;
			expect(deck).toEqual(startingDeckCounts(archetype));
			expect(deck).toEqual(new DriverRecord({ id: 'driver-1', archetype, name: archetype }).defaultDeck);
			expect(Object.isFrozen(deck)).toBe(true);
		}
	});
});

describe('sameDriverCardData', () => {
	it('matches data mapped afresh from the same driver, and nothing that would show differently', () => {
		const mapped = (): DriverCardData => driverCardData({ archetype: 'interceptor', hitpoints: 12, deck: { headshot: 4, flag_down: 2 }, note: 'Found day 3' });
		const data = mapped();
		expect(sameDriverCardData(data, mapped())).toBe(true);
		expect(sameDriverCardData(driverCardData({ archetype: 'mechanic' }), driverCardData({ archetype: 'mechanic', note: '' }))).toBe(true);
		const changes: Partial<DriverCardData>[] = [
			{ name: 'Interceptor 2' },
			{ specialty: 'SCOUT' },
			{ hitpoints: 11 },
			{ maxHitpoints: 26 },
			{ handLimit: 8 },
			{ vehicle: 'Dune Buggy' },
			{ note: 'Found day 4' },
			{ skills: { ...DRIVER_CONFIGS.interceptor.skills, evade: DRIVER_CONFIGS.interceptor.skills.evade + 1 } },
			{ deck: { headshot: 4, flag_down: 3 } },
			{ deck: { headshot: 4 } },
			{ deck: { headshot: 4, flag_down: 2, ram: 1 } },
		];
		for (const change of changes) expect([change, sameDriverCardData(data, { ...data, ...change })]).toEqual([change, false]);
	});
});
