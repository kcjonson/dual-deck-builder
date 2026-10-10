import type { Card } from '../mechanics/Card';
import { RaiderId, raiderVehicle } from '../mechanics/Raiders';
import { RoadLane, RoadRow, openingSlots } from '../mechanics/Road';
import { PLAYER_DRIVEN_VEHICLES, Team, TeamType } from '../mechanics/Team';

/**
 * Stand-in raider encounters for the MVP supply run (DDB-454): a small fixed
 * table a fight stop's skulls pick from, until stops roll their encounters
 * from the area map's tables. The raiders are the shared profiles
 * (mechanics/Raiders.ts), the combat screen's own among them. Decision
 * records: docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md, and
 * raider-tuning.md for the table and the placement.
 */

export const ENCOUNTER_IDS = ['scavengers', 'spike_raider', 'road_gang'] as const;
export type EncounterId = (typeof ENCOUNTER_IDS)[number];

/** Danger, as the route screen's skulls count it (Game Flow 3.4). */
export type Skulls = 1 | 2 | 3;

export interface Encounter {
	readonly id: EncounterId;
	readonly name: string;
	readonly skulls: Skulls;
	readonly raiders: readonly RaiderId[];
}

export const ENCOUNTERS: Readonly<Record<EncounterId, Encounter>> = Object.freeze({
	scavengers: { id: 'scavengers', name: 'Scavengers', skulls: 1, raiders: ['rust_buggy'] },
	spike_raider: { id: 'spike_raider', name: 'Spike raider', skulls: 2, raiders: ['spike_buggy'] },
	road_gang: { id: 'road_gang', name: 'Road gang', skulls: 3, raiders: ['rust_buggy', 'rust_buggy'] },
});

/** The encounter a fight of this many skulls rolls: one each, until stops roll from the area map's tables. */
export function encounterFor(skulls: Skulls): EncounterId {
	const encounter = ENCOUNTER_IDS.find(id => ENCOUNTERS[id].skulls === skulls);
	if (!encounter) throw new RangeError(`No encounter has ${skulls} skulls`);
	return encounter;
}

/** The row each seat's vehicle opens in, Driver 1's first: the player's opening fill, which places driven vehicles before escorts. */
const SEAT_ROWS: readonly RoadRow[] = openingSlots(TeamType.PLAYER).slice(0, PLAYER_DRIVEN_VEHICLES).map(({ row }) => row);

/**
 * The encounter's raiders as an enemy team, each with a fresh copy of its
 * deck from `cards`, sized up against the crew in `crewStructure`. A lone
 * raider opens on the inside lane across from the vehicle with the most
 * structure, the first seat's on a tie, where a ram from either side
 * reaches; a gang, or a lone raider with no crew given (the combat screen's
 * skirmish), fills the formation's opening order. Against one seat every
 * raider refills to its solo adrenaline. Throws as `raiderVehicle` does for
 * a card the map doesn't hold.
 */
export function encounterTeam({ encounter, cards, crewStructure = [] }: {
	encounter: EncounterId;
	cards: ReadonlyMap<string, Card>;
	/** Structure each seat's vehicle opens the fight with, Driver 1's first */
	crewStructure?: readonly number[];
}): Team {
	const solo = crewStructure.length === 1;
	const raiders = ENCOUNTERS[encounter].raiders.map(raider => raiderVehicle({ raider, cards, solo }));
	if (raiders.length === 1 && crewStructure.length > 0) {
		const toughest = crewStructure.indexOf(Math.max(...crewStructure));
		raiders[0].slot = { lane: RoadLane.ENEMY_INSIDE, row: SEAT_ROWS[toughest] };
	}
	return new Team({ type: TeamType.ENEMY, vehicles: raiders });
}
