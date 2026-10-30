import type * as Encounters from '../../../campaign/Encounters';
import type { Card } from '../../../mechanics/Card';
import { raiderVehicle } from '../../../mechanics/Raiders';
import { Team, TeamType } from '../../../mechanics/Team';

/**
 * The Encounters module with the skirmish's raiders cut to one Rust Buggy
 * and no waves, for screen tests that rig the dev fight's lone raider. Use
 * it from a test file's `jest.mock('../../campaign/Encounters', ...)`.
 */
export function loneRaiderEncounters(): typeof Encounters {
	const actual = jest.requireActual<typeof Encounters>('../../../campaign/Encounters');
	return {
		...actual,
		encounterForces: ({ cards }: { cards: ReadonlyMap<string, Card> }) => ({
			template: actual.ENCOUNTER_DATA.templates[0],
			team: new Team({ type: TeamType.ENEMY, vehicles: [raiderVehicle({ raider: 'rust_buggy', cards })] }),
		}),
	} as typeof Encounters;
}
