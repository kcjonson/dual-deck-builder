import { describeValue } from '../core/Json';
import { ReaderRangeError, readArray, readOneOf } from '../core/JsonReader';

/**
 * The compound's buildings (Compound and Supply Runs, Buildings), in the
 * order the compound numbers them on its plate. A starting set, not final.
 */
export const BUILDING_IDS = ['bunkhouse', 'radio_mast', 'infirmary', 'map_room', 'garage', 'stores'] as const;

export type BuildingId = (typeof BUILDING_IDS)[number];

/** The buildings standing, read from a save or the starting values: known ids, each once, in `BUILDING_IDS` order. Comes back frozen. */
export function readBuildings(value: unknown, path: string): readonly BuildingId[] {
	const ids = Array.from(readArray(value, path), (id, index) => readOneOf(id, `${path}[${index}]`, BUILDING_IDS));
	ids.forEach((id, index) => {
		if (ids.indexOf(id) !== index) throw new ReaderRangeError(`${path}[${index}] ${describeValue(id)} is already standing`);
	});
	return Object.freeze(BUILDING_IDS.filter((id) => ids.includes(id)));
}
