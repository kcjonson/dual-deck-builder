import type { Rng } from '../core/Rng';

/**
 * Names for towns and villages: a first part and an ending, each picked
 * evenly, so "Ash" and "ford" make Ashford and "Cold" and " Springs" make
 * Cold Springs. 35 by 22 makes 770 names, far more than a map's 52 named
 * places at the most. Placeholder words until the atlas (Map 19) or a writer gives
 * regions their own.
 */
export const NAME_STARTS = [
	'Ash', 'Cold', 'Iron', 'Red', 'Stone', 'Black', 'Silver', 'Dust', 'Mill', 'Elk', 'Pine', 'Oak', 'Salt', 'Copper', 'Fox', 'Wolf', 'Cedar', 'Bright',
	'High', 'Fair', 'Sand', 'Granite', 'Clay', 'Crow', 'Marsh', 'Hart', 'Lyle', 'Bell', 'Kettle', 'Mason', 'Gail', 'Ennis', 'Corbin', 'Harlan', 'Tull',
] as const;
export const NAME_ENDINGS = [
	'ford', 'ton', 'field', 'ville', 'burg', 'wood', 'dale', ' Springs', ' Falls', ' Junction', ' Crossing', 'port', 'ridge', 'haven', 'mont', ' Creek',
	' Hollow', ' Gap', 'by', ' Mills', ' Center', 'boro',
] as const;

/** Draws a name takes before it settles for a numbered one. */
const NAME_DRAWS = 64;

/**
 * A source of names no two alike, drawing two picks a try from `rng`: a
 * first part no name has used yet while any is left, so a map's first 35
 * places don't share one, then any. Past `NAME_DRAWS` tries without a new
 * name, which only a map with hundreds of places could reach, it numbers the
 * last name drawn. Names in `taken`, already on the map, count as used,
 * and so do their first parts.
 */
export function placeNames(rng: Rng, { taken = [] }: { taken?: readonly string[] } = {}): () => string {
	const used = new Set<string>(taken);
	const startsUsed = new Set<string>(NAME_STARTS.filter((start) => taken.some((name) => name.startsWith(start))));
	return () => {
		const fresh = NAME_STARTS.filter((start) => !startsUsed.has(start));
		const starts = fresh.length > 0 ? fresh : NAME_STARTS;
		let name = '';
		let start = '';
		for (let draw = 0; draw < NAME_DRAWS; draw += 1) {
			start = rng.pick(starts);
			name = `${start}${rng.pick(NAME_ENDINGS)}`;
			if (!used.has(name)) break;
		}
		let numbered = name;
		for (let number = 2; used.has(numbered); number += 1) numbered = `${name} ${number}`;
		used.add(numbered);
		startsUsed.add(start);
		return numbered;
	};
}

/**
 * Roots for the land's features, rivers, lakes, ranges, and passes: "Mercer"
 * makes the Mercer River, Mercer Reservoir, or Mercer Pass. Placeholder
 * words, like the places'.
 */
export const FEATURE_ROOTS = [
	'Mercer', 'Corbin', 'Harlan', 'Tull', 'Ennis', 'Lyle', 'Gail', 'Mason', 'Kettle', 'Crow', 'Bitter', 'Sweetwater', 'Powder', 'Medicine',
	'Bear', 'Buffalo', 'Antelope', 'Wind', 'Smoke', 'Thunder', 'Lost', 'Muddy', 'Clearwater', 'Sulphur', 'Rattlesnake', 'Coyote', 'Badger',
	'Beaver', 'Otter', 'Cottonwood', 'Willow', 'Juniper', 'Sage', 'Granger', 'Pryor', 'Absalom', 'Dutchman', 'Owl', 'Hatchet', 'Raven',
] as const;

/**
 * A source of feature roots, no two alike while any is left, one draw a
 * root; past the list they come round again numbered, which only a map
 * with more than 40 named features reaches.
 */
export function featureRoots(rng: Rng): () => string {
	const left: string[] = [];
	let round = 0;
	return () => {
		if (left.length === 0) {
			left.push(...FEATURE_ROOTS);
			round += 1;
		}
		const root = left.splice(rng.int(0, left.length - 1), 1)[0];
		return round === 1 ? root : `${root} ${round}`;
	};
}
