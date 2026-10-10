import type { Card } from '../mechanics/Card';
import { RaiderId, raiderVehicle } from '../mechanics/Raiders';
import { Team, TeamType } from '../mechanics/Team';

/**
 * Stand-in raider encounters for the MVP supply run (DDB-454): a small fixed
 * table a fight stop's skulls pick from, until stops roll their encounters
 * from the area map's tables. The raiders are the shared profiles
 * (mechanics/Raiders.ts), the combat screen's own among them. Decision
 * record: docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md.
 */

export const ENCOUNTER_IDS = ['scavengers', 'road_gang', 'spike_pack'] as const;
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
	road_gang: { id: 'road_gang', name: 'Road gang', skulls: 2, raiders: ['rust_buggy', 'rust_buggy'] },
	spike_pack: { id: 'spike_pack', name: 'Spike pack', skulls: 3, raiders: ['rust_buggy', 'spike_buggy'] },
});

/** The encounter a fight of this many skulls rolls: one each, until stops roll from the area map's tables. */
export function encounterFor(skulls: Skulls): EncounterId {
	const encounter = ENCOUNTER_IDS.find(id => ENCOUNTERS[id].skulls === skulls);
	if (!encounter) throw new RangeError(`No encounter has ${skulls} skulls`);
	return encounter;
}

/**
 * The encounter's raiders as an enemy team, each with a fresh copy of its
 * deck from `cards`, placed in the formation's opening order. Throws as
 * `raiderVehicle` does for a card the map doesn't hold.
 */
export function encounterTeam({ encounter, cards }: { encounter: EncounterId; cards: ReadonlyMap<string, Card> }): Team {
	return new Team({ type: TeamType.ENEMY, vehicles: ENCOUNTERS[encounter].raiders.map(raider => raiderVehicle({ raider, cards })) });
}
