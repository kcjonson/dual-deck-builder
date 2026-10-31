import { FACTIONS, Factions, POI_TUNING, PoiTuning, STRONGHOLD_TYPE } from './PoiData';
import type { PoiLayer } from './Pois';
import { Places, SETTLEMENT_SPACING } from './Places';
import { RouteMap, compass } from './RouteDescriptors';

/**
 * POI names (Area Map Generation, Labels): a POI takes the name of a town or
 * village near it and its type's label, "Elk Creek Clinic"; one with no town
 * or village within `PLACE_REACH` of the map's radius keeps its type and its
 * bearing from the compound, "Clinic, north-east"; a stronghold is its
 * faction's, "Mire-Crawlers stronghold". Worked out from the POI and places
 * layers alone, which a load makes again from the seed, so nothing about the
 * names is saved and they take no draws. The decision record is
 * docs/AI_TECHNICAL_DECISIONS/stops-and-routes.md, POI names.
 */

/** How far a place lends a POI its name, as a share of the map's radius: a town's spacing. */
export const PLACE_REACH = SETTLEMENT_SPACING.town;

export interface PoiNameOptions {
	/** The towns and villages POIs are named after; every POI keeps its type and bearing without them. */
	readonly places?: Pick<Places, 'towns' | 'villages'> | null;
	/** World units: the map's radius, which sets the reach. */
	readonly radius?: number;
	readonly tuning?: PoiTuning;
	readonly factions?: Factions;
}

/**
 * Every POI's name, in the layer's order, no two alike. The nearest pairs
 * of POI and place within reach are named first, so where two clinics are
 * near Elk Creek the nearer is Elk Creek Clinic and the other takes the
 * next place in its reach that has none; one whose places in reach all
 * have one is numbered after the nearest, nearest first, "Elk Creek Clinic
 * 2". Any other name another POI already took gets a number too. A reach
 * of 0, with no radius given, lends no place's name.
 */
export function poiNames(layer: Pick<PoiLayer, 'pois' | 'strongholds'>, { places = null, radius = 0, tuning = POI_TUNING, factions = FACTIONS }: PoiNameOptions = {}): string[] {
	const named = places ? [...places.towns, ...places.villages] : [];
	const reach = PLACE_REACH * radius;
	const reachSquared = reach * reach;
	const label = (type: string) => tuning.types[type]?.label ?? type;
	const pairs: { poi: number; place: number; distance: number }[] = [];
	if (reach > 0) {
		layer.pois.forEach(({ type, site }, poi) => {
			if (type === STRONGHOLD_TYPE) return;
			named.forEach(({ x, y }, place) => {
				const dx = x - site.x;
				const dy = y - site.y;
				const distance = dx * dx + dy * dy;
				if (distance <= reachSquared) pairs.push({ poi, place, distance });
			});
		});
	}
	pairs.sort((a, b) => a.distance - b.distance || a.poi - b.poi || a.place - b.place);

	const taken = new Set<string>();
	const unique = (base: string) => {
		let name = base;
		for (let number = 2; taken.has(name); number += 1) name = `${base} ${number}`;
		taken.add(name);
		return name;
	};
	const placeName = (poi: number, place: number) => `${named[place].name} ${titleCase(label(layer.pois[poi].type))}`;
	const names: (string | null)[] = layer.pois.map(() => null);
	for (const { poi, place } of pairs) {
		if (names[poi] !== null || taken.has(placeName(poi, place))) continue;
		names[poi] = unique(placeName(poi, place));
	}
	// A POI's first pair left is its nearest place, so the numbers go nearest first.
	for (const { poi, place } of pairs) if (names[poi] === null) names[poi] = unique(placeName(poi, place));
	return layer.pois.map(({ type, site }, poi) => {
		const name = names[poi];
		if (name !== null) return name;
		const stronghold = type === STRONGHOLD_TYPE ? layer.strongholds.find((held) => held.poi === poi) : undefined;
		if (stronghold) return unique(`${factions[stronghold.faction]?.label ?? stronghold.faction} stronghold`);
		return unique(`${label(type)}, ${compass(site.x, site.y)}`);
	});
}

const mapNames = new WeakMap<RouteMap, readonly string[]>();

/** A map's POI names from its own places and radius, worked out once a map, so every screen and the run's routes name a POI alike. */
export function mapPoiNames(map: RouteMap): readonly string[] {
	let names = mapNames.get(map);
	if (!names) {
		names = Object.freeze(poiNames(map.products.pois, { places: map.products.places ?? null, radius: map.params.radius }));
		mapNames.set(map, names);
	}
	return names;
}

/** "Salvage yard" as part of a name: "Salvage Yard". */
function titleCase(label: string): string {
	return label.replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}
