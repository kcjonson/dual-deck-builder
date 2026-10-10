import { describeValue } from '../core/Json';
import { ReaderRangeError, ReaderTypeError, readArray, readFields, readInteger, readOneOf, readText } from '../core/JsonReader';
import type { Convoy } from '../mechanics/Convoy';
import { MAX_CONVOY_ESCORTS } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import type { Resources } from './Campaign';
import { CardCounts, readCardCounts } from './CardCounts';
import { RunRoute, readRunRoute, routeStops } from './SupplyRoutes';

/**
 * A supply run on the road, as the campaign holds and saves it (DDB-454).
 * Decision record: docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md.
 */

/**
 * Where the run stands at its stop: driving to it (or home, once every stop
 * is behind it), or there with a won fight's reward to pick. A fight under
 * way isn't saved: a load finds the run driving to that stop, and the fight
 * replays from its seed.
 */
export const RUN_PHASES = ['driving', 'reward'] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/**
 * The run's own state beside its run decks. The seats are the run decks'
 * drivers and the run's id is the campaign's `currentRun`, so neither is
 * kept twice; `runParty` (SupplyRun.ts) puts the party back together.
 */
export interface SupplyRun {
	/** As rolled when the run set off; a load never rolls it again. */
	readonly route: RunRoute;
	/** The stop the run is driving to or at, counted from 0 along `routeStops`; their count once it's heading home. */
	readonly stop: number;
	readonly phase: RunPhase;
	/** The convoy's escorts still with the run, in roster order. */
	readonly escorts: readonly Vehicle[];
	/** What the run has picked up so far, which reaches the stores only if it gets home. */
	readonly cargo: Readonly<Resources>;
	/** Cards won so far, bound for the locker. */
	readonly cargoCards: CardCounts;
}

/** A supply run as a save holds it, its escorts by their `escort-<n>`. */
export interface SupplyRunJson {
	route: RunRoute;
	stop: number;
	phase: RunPhase;
	escorts: string[];
	cargo: Resources;
	cargoCards: Record<string, number>;
}

/** The campaign's own reader for the stores, handed in so this module needn't import the campaign. */
export type CargoReader = (value: unknown, path: string) => Readonly<Resources>;

const FIELDS = ['route', 'stop', 'phase', 'escorts', 'cargo', 'cargoCards'] as const;

/**
 * A supply run checked whole and frozen: a route, a stop from 0 to its
 * stop count, a reward only at a fight, at most `MAX_CONVOY_ESCORTS` of the
 * convoy's escorts, each once, and cargo the stores and the locker could
 * count.
 */
export function readSupplyRun(value: unknown, path: string, { convoy, readCargo }: { convoy: Convoy; readCargo: CargoReader }): SupplyRun {
	const fields = readFields(value, path, FIELDS);
	const escorts = Array.from(readArray(fields.escorts, `${path}.escorts`), (escort, index) => {
		if (!(escort instanceof Vehicle)) throw new ReaderTypeError(`${path}.escorts[${index}] must be a Vehicle, got ${describeValue(escort)}`);
		return escort;
	});
	return checkedRun({ fields, escorts, path, convoy, readCargo });
}

/** A save's supply run, its escorts found in the convoy by id. */
export function readSupplyRunJson(value: unknown, path: string, { convoy, readCargo }: { convoy: Convoy; readCargo: CargoReader }): SupplyRun {
	const fields = readFields(value, path, FIELDS);
	const escorts = Array.from(readArray(fields.escorts, `${path}.escorts`), (id, index) => {
		const at = `${path}.escorts[${index}]`;
		const escortId = readText(id, at);
		const escort = convoy.escorts.find(held => held.convoyId === escortId);
		if (escort === undefined) throw new ReaderRangeError(`${at} ${describeValue(escortId)} isn't an escort in the convoy`);
		return escort;
	});
	return checkedRun({ fields, escorts, path, convoy, readCargo });
}

export function supplyRunToJson(run: SupplyRun): SupplyRunJson {
	return {
		route: run.route,
		stop: run.stop,
		phase: run.phase,
		escorts: run.escorts.map(escort => escort.convoyId as string),
		cargo: run.cargo,
		cargoCards: run.cargoCards,
	};
}

/** What the run relies on that changes outside the campaign's checks: its escorts still in the convoy. */
export function readSupplyRunTies({ run, convoy, path }: { run: SupplyRun; convoy: Convoy; path: string }): void {
	run.escorts.forEach((escort, index) => {
		if (!convoy.escorts.includes(escort)) throw new ReaderRangeError(`${path}.escorts[${index}] ${escort.name} (${escort.convoyId}) isn't in the convoy any more`);
	});
}

function checkedRun({ fields, escorts, path, convoy, readCargo }: {
	fields: Record<(typeof FIELDS)[number], unknown>;
	escorts: readonly Vehicle[];
	path: string;
	convoy: Convoy;
	readCargo: CargoReader;
}): SupplyRun {
	const route = readRunRoute(fields.route, `${path}.route`);
	const stops = routeStops(route);
	const stop = readInteger(fields.stop, `${path}.stop`, { min: 0, max: stops.length, maxLabel: `the route's ${stops.length} stops` });
	const phase = readOneOf(fields.phase, `${path}.phase`, RUN_PHASES);
	if (phase === 'reward' && stops[stop]?.kind !== 'fight') {
		throw new ReaderRangeError(`${path}.phase is reward, and stop ${stop} isn't a fight`);
	}
	if (escorts.length > MAX_CONVOY_ESCORTS) throw new ReaderRangeError(`${path}.escorts holds ${escorts.length}; a run takes ${MAX_CONVOY_ESCORTS} at most`);
	return Object.freeze({
		route,
		stop,
		phase,
		escorts: inRosterOrder({ escorts, convoy, path }),
		cargo: readCargo(fields.cargo, `${path}.cargo`),
		cargoCards: readCardCounts(fields.cargoCards, `${path}.cargoCards`),
	});
}

/** The escorts, each the convoy's and listed once, in the convoy's roster order. */
function inRosterOrder({ escorts, convoy, path }: { escorts: readonly Vehicle[]; convoy: Convoy; path: string }): readonly Vehicle[] {
	escorts.forEach((escort, index) => {
		if (!convoy.escorts.includes(escort)) throw new ReaderRangeError(`${path}.escorts[${index}] ${escort.name} isn't in the convoy`);
		if (escorts.indexOf(escort) !== index) throw new ReaderRangeError(`${path}.escorts[${index}] ${escort.name} (${escort.convoyId}) is listed twice`);
	});
	return Object.freeze(convoy.escorts.filter(escort => escorts.includes(escort)));
}
