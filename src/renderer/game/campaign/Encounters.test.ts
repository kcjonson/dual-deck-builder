import { createTestDriver, createTestVehicle } from '../ai/__tests__/test-helpers';
import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import { Battle } from '../mechanics/Battle';
import { Card, CardData } from '../mechanics/Card';
import { RAIDER_IDS, RAIDER_PROFILES, raiderVehicle } from '../mechanics/Raiders';
import { RoadLane, RoadRow, RoadSlot, slotRange } from '../mechanics/Road';
import { Team, TeamType } from '../mechanics/Team';
import type { Vehicle } from '../mechanics/Vehicle';
import { ENCOUNTERS, ENCOUNTER_IDS, EncounterId, encounterFor, encounterTeam } from './Encounters';

/** DDB-462: which raiders each skull count fields, where a lone one opens, and how they size up a lone driver. */

const CARDS: ReadonlyMap<string, Card> = new Map(
	(cardsFile as unknown as { cards: CardData[] }).cards.map(data => [data.type, new Card(data)])
);

/** The player's driven vehicles in seat order, each with this much structure */
function crew(structures: number[]): Vehicle[] {
	return structures.map((structure, seat) => {
		const vehicle = createTestVehicle(`Seat ${seat + 1}`, createTestDriver(`Driver ${seat + 1}`));
		vehicle.set({ maxStructure: Math.max(structure, 1), structure });
		return vehicle;
	});
}

function slotOf(vehicle: Vehicle): RoadSlot {
	if (!vehicle.slot) throw new Error(`${vehicle.name} isn't on the road`);
	return vehicle.slot;
}

/** The encounter against those vehicles, on the road: a started fight's placement */
function onTheRoad({ encounter, vehicles }: { encounter: EncounterId; vehicles: Vehicle[] }): Team {
	const enemyTeam = encounterTeam({ encounter, cards: CARDS, crewStructure: vehicles.map(vehicle => vehicle.structure) });
	new Battle({ playerTeam: new Team({ type: TeamType.PLAYER, vehicles }), enemyTeam, rng: new Rng({ seed: 462 }) }).start();
	return enemyTeam;
}

describe('the encounter table', () => {
	it('fields a Rust Buggy at one skull, a Spike Buggy at two, and two Rust Buggies at three', () => {
		expect([1, 2, 3].map(skulls => ENCOUNTERS[encounterFor(skulls as 1 | 2 | 3)].raiders))
			.toEqual([['rust_buggy'], ['spike_buggy'], ['rust_buggy', 'rust_buggy']]);
	});

	it('lists its encounters in skull order', () => {
		expect(ENCOUNTER_IDS.map(id => ENCOUNTERS[id].skulls)).toEqual([1, 2, 3]);
	});
});

describe('where a lone raider opens', () => {
	it.each([
		['the first seat when it has the most structure', [80, 50], RoadRow.CENTER, 0],
		['the second seat when it has the most', [50, 80], RoadRow.BEHIND, 1],
		['the first seat on a tie', [60, 60], RoadRow.CENTER, 0],
		['a lone driver', [25], RoadRow.CENTER, 0],
	])('pulls alongside %s, inside, within a ram of it', (_case, structures, row, toughest) => {
		for (const encounter of ['scavengers', 'spike_raider'] as const) {
			const vehicles = crew(structures);
			const [raider] = onTheRoad({ encounter, vehicles }).vehicles;
			expect(raider.slot).toEqual({ lane: RoadLane.ENEMY_INSIDE, row });
			expect(slotRange(slotOf(raider), slotOf(vehicles[toughest]))).toBe(1);
		}
	});

	it('reads the structure each seat carries in, not its maximum', () => {
		const vehicles = crew([80, 50]);
		vehicles[0].set({ structure: 20 });
		const [raider] = onTheRoad({ encounter: 'scavengers', vehicles }).vehicles;
		expect(raider.slot?.row).toBe(RoadRow.BEHIND);
	});

	it('fills the opening order with no crew to size up', () => {
		const [raider] = encounterTeam({ encounter: 'scavengers', cards: CARDS }).vehicles;
		expect(raider.slot).toBeNull();
	});

	it('leaves a gang to the opening order, one raider across each seat', () => {
		const vehicles = crew([50, 80]);
		const gang = onTheRoad({ encounter: 'road_gang', vehicles }).vehicles;
		expect(gang.map(raider => raider.slot)).toEqual([
			{ lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER },
			{ lane: RoadLane.ENEMY_INSIDE, row: RoadRow.BEHIND },
		]);
	});
});

describe('sizing up the crew', () => {
	it.each(ENCOUNTER_IDS)('refills %s to each raider\'s adrenaline against a pair, and its solo adrenaline against a lone driver', (encounter) => {
		const adrenaline = (crewStructure: number[]): number[] => encounterTeam({ encounter, cards: CARDS, crewStructure }).vehicles
			.map(raider => raider.driver?.maxAdrenaline ?? 0);
		const raiders = ENCOUNTERS[encounter].raiders;
		expect(adrenaline([50, 80])).toEqual(raiders.map(raider => RAIDER_PROFILES[raider].maxAdrenaline));
		expect(adrenaline([50])).toEqual(raiders.map(raider => RAIDER_PROFILES[raider].soloAdrenaline));
	});

	it.each(RAIDER_IDS)('starts %s\'s fight at the adrenaline it refills to', (raider) => {
		for (const solo of [false, true]) {
			const driver = raiderVehicle({ raider, cards: CARDS, solo }).driver;
			expect(driver?.adrenaline).toBe(driver?.maxAdrenaline);
		}
	});

	it.each(RAIDER_IDS)('gives %s less adrenaline against a lone driver than against a pair', (raider) => {
		expect(RAIDER_PROFILES[raider].soloAdrenaline).toBeLessThan(RAIDER_PROFILES[raider].maxAdrenaline);
	});
});
