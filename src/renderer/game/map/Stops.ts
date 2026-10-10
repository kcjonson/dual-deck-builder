import { Rng } from '../core/Rng';
import { BIOMES, Biome } from './Biome';
import type { MapParams } from './MapParams';
import { POI_RESOURCES, PoiResource, STRONGHOLD_TYPE } from './PoiData';
import type { PoiLayer } from './Pois';
import { ROAD_CLASSES, RoadClass, RoadNetwork } from './RoadNetwork';
import { Leg, Route, legPoints, routesTo } from './RouteTree';
import { CompiledStopTables, NO_TERRITORY, STOP_TUNING, StopTuning, StopType, isCalm, isFight, stopTablesFor } from './StopData';
import type { Terrain } from './Terrain';

/**
 * Stage 9 of area map generation, stops (Area Map Generation, 9. Stops), on
 * the `stops` stream: stops on the legs of the route tree and nowhere else.
 * Each leg gets a count from its road by class, spread evenly along it by
 * arc length with jitter, clear of its ends and of junctions, and a type
 * drawn from the stop tables by the class and biome where it stands, its
 * leg's tier, and territory. Types are drawn leg by leg from the compound
 * out, carrying the stops behind each leg, so no route ever has three fights
 * or checkpoints in a row. Then the Find: driver floor and rates, and the
 * daylight check (guarantee 10), which thins a POI's quickest route until an
 * estimated run fits in daylight.
 *
 * Tier and territory are stand-ins until stage 8 (DDB-292): a leg's tier is
 * the lowest of the POIs whose routes use it, by the POI layer's ring + 1,
 * and every stop is on no one's ground. A stop's contents aren't rolled
 * here: `rollStop` rolls them when the run reveals it. The decision record
 * is docs/AI_TECHNICAL_DECISIONS/stops-and-routes.md.
 */

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const ceil = Math.ceil;
const round = Math.round;

/** POIs in tiers up to this have to be reachable and left in daylight (guarantee 10). */
export const DAYLIGHT_TIERS = 3;
/** A stronghold's tier, and any leg's before a POI's route claims it. */
const STRONGHOLD_TIER = 5;
/** Passes of the daylight check at most, each over every POI it covers. */
const DAYLIGHT_PASSES = 4;

export interface Stop {
	/** Its place in the layer's `stops`: stable for a given map, and what its contents' stream is keyed by. */
	readonly id: number;
	readonly leg: number;
	/** World units along its leg from the leg's inner end. */
	readonly along: number;
	/** `along` as a share of its leg's length, 0 at the inner end to 1 at the outer. */
	readonly at: number;
	readonly x: number;
	readonly y: number;
	/** Fixed with the map. */
	readonly type: StopType;
	/** A fight's danger, 1 to 3, fixed with the map; 0 for any other stop. */
	readonly skulls: number;
	/** What its type was drawn by: the class and the biome where it stands. */
	readonly roadClass: RoadClass;
	readonly biome: Biome;
}

/** What a leg is made of, for the stops and the route descriptors. */
export interface LegProfile {
	/** Its stops' ids, in driving order. */
	readonly stops: readonly number[];
	/** A stand-in until stage 8: the lowest tier of the POIs whose routes use it. */
	readonly tier: number;
	/** No one's until stage 8. */
	readonly territory: string;
	/** World units of each class along it... */
	readonly classLengths: { readonly [Name in RoadClass]: number };
	/** ...and of each biome, sampled every `biomeStep`. */
	readonly biomeLengths: { readonly [Name in Biome]: number };
	/** The highway with the most length on it, by its index (`RoadStretch.highway`), which numbers a highway route's name; -1 with none. */
	readonly highway: number;
	/** The point halfway along it. */
	readonly midX: number;
	readonly midY: number;
}

/** The stage's product: plain data, which crosses the worker boundary by structured clone. */
export interface StopLayer {
	/** By leg, each leg's in driving order. */
	readonly stops: readonly Stop[];
	/** By leg id, one for each of the POI layer's legs. */
	readonly legs: readonly LegProfile[];
	/** The seed every stop's contents fork from, by its id and roll count (`rollStop`). */
	readonly contentSeed: number;
	/** How many stops the daylight check took off routes that ran past dark. */
	readonly thinned: number;
	/**
	 * What the stage couldn't keep, which no rerun of it could: a tier 1 to 3
	 * POI whose quickest route runs past dark with no stops at all (the tiers'
	 * to fix, DDB-292), or a Find: driver floor with no leg in its tiers.
	 */
	readonly failures: readonly string[];
}

/** What the stage reads from the land. */
export type StopGround = Pick<Terrain, 'biome'>;

export interface StopOptions {
	readonly network: RoadNetwork;
	readonly layer: PoiLayer;
	readonly ground: StopGround;
	/** Validated. */
	readonly params: Pick<MapParams, 'stopDensity' | 'dangerCurve' | 'driverFinds' | 'daylightHours' | 'stopTables'>;
	/** The stage's stream; each part forks its own from it by name. */
	readonly rng: Rng;
	/** The shipped tuning when left out. */
	readonly tuning?: StopTuning;
	/** The params' stop tables, or the shipped ones, when left out. */
	readonly tables?: CompiledStopTables;
}

/** Stops on every leg the POIs' routes use. */
export function placeStops(options: StopOptions): StopLayer {
	return new StopPlacer(options).place();
}

/** A stop while the stage works on it. */
interface Placed {
	along: number;
	x: number;
	y: number;
	type: StopType;
	skulls: number;
	roadClass: RoadClass;
	biome: Biome;
}

/** A route with the POI it goes to, as the daylight check and the rules walk it. */
interface PoiRoute {
	readonly poi: number;
	readonly route: Route;
}

/** One run of the stage; `place` runs it. */
class StopPlacer {
	private readonly network: RoadNetwork;
	private readonly layer: PoiLayer;
	private readonly ground: StopGround;
	private readonly params: StopOptions['params'];
	private readonly rng: Rng;
	private readonly tuning: StopTuning;
	private readonly tables: CompiledStopTables;
	/** Each POI's routes, quickest first. */
	private readonly routes: readonly (readonly Route[])[];
	/** Each leg's routes, by POI. */
	private readonly routesOn: PoiRoute[][];
	private readonly tiers: Int32Array;
	/** Each node's roads, which say where roads meet. */
	private readonly degrees: Int32Array;
	/** Each leg's junctions, as world units along it. */
	private readonly joins: number[][];
	/** Each leg's stops, in driving order. */
	private readonly placed: Placed[][];
	private readonly profiles: Omit<LegProfile, 'stops'>[] = [];
	private readonly failures: string[] = [];
	private thinned = 0;

	constructor({ network, layer, ground, params, rng, tuning = STOP_TUNING, tables = stopTablesFor(params.stopTables) }: StopOptions) {
		this.network = network;
		this.layer = layer;
		this.ground = ground;
		this.params = params;
		this.rng = rng;
		this.tuning = tuning;
		this.tables = tables;
		this.routes = layer.pois.map((poi) => routesTo(layer, poi));
		this.routesOn = layer.legs.map(() => []);
		this.tiers = new Int32Array(layer.legs.length).fill(STRONGHOLD_TIER);
		this.routes.forEach((routes, poi) => {
			const { tier } = layer.pois[poi];
			for (const route of routes) {
				for (const leg of route.legs) {
					this.routesOn[leg].push({ poi, route });
					if (tier < this.tiers[leg]) this.tiers[leg] = tier;
				}
			}
		});
		this.placed = layer.legs.map(() => []);
		this.degrees = nodeDegrees(network);
		this.joins = layer.legs.map((leg) => junctionsAlong({ network, leg, degrees: this.degrees }));
	}

	public place(): StopLayer {
		const tails: StopType[][] = [];
		this.layer.legs.forEach((leg, id) => {
			const stream = this.rng.fork('leg', id);
			const line = legPoints(this.network, leg);
			this.profiles.push(this.profile(id, line));
			this.placeOnLeg(id, line, stream, leg.parent < 0 ? [] : tails[leg.parent]);
			tails.push(lastTwo(leg.parent < 0 ? [] : tails[leg.parent], this.placed[id]));
		});
		this.findDrivers();
		this.daylight();
		const stops: Stop[] = [];
		const legs: LegProfile[] = this.profiles.map((profile, leg) => {
			const ids: number[] = [];
			const length = this.layer.legs[leg].length;
			for (const { along, x, y, type, skulls, roadClass, biome } of this.placed[leg]) {
				ids.push(stops.length);
				stops.push({ id: stops.length, leg, along, at: length > 0 ? along / length : 0, x, y, type, skulls, roadClass, biome });
			}
			return { ...profile, stops: ids };
		});
		return { stops, legs, contentSeed: this.rng.fork('contents').seed, thinned: this.thinned, failures: this.failures };
	}

	/** A leg's classes and biomes by length, its main highway, and its middle. */
	private profile(id: number, line: readonly number[]): Omit<LegProfile, 'stops'> {
		const leg = this.layer.legs[id];
		const classLengths = Object.fromEntries(ROAD_CLASSES.map((roadClass) => [roadClass, 0])) as Record<RoadClass, number>;
		const highways = new Map<number, number>();
		for (const { stretch, length } of leg.pieces) {
			const { roadClass, highway } = this.network.stretches[stretch];
			classLengths[roadClass] += length;
			if (roadClass === 'highway' && highway !== undefined) highways.set(highway, (highways.get(highway) ?? 0) + length);
		}
		let highway = -1;
		let most = 0;
		for (const [index, length] of highways) {
			if (length > most || (length === most && index < highway)) {
				highway = index;
				most = length;
			}
		}
		const biomeLengths = Object.fromEntries(BIOMES.map((biome) => [biome, 0])) as Record<Biome, number>;
		const samples = leg.length > 0 ? ceil(leg.length / this.tuning.biomeStep) : 0;
		const distances: number[] = [];
		for (let sample = 0; sample < samples; sample += 1) distances.push((sample + 0.5) * leg.length / samples);
		const points = pointsAlong(line, distances);
		for (let sample = 0; sample < samples; sample += 1) biomeLengths[this.ground.biome(points[2 * sample], points[2 * sample + 1])] += leg.length / samples;
		const [midX, midY] = pointsAlong(line, [leg.length / 2]);
		return { tier: this.tiers[id], territory: NO_TERRITORY, classLengths, biomeLengths, highway, midX, midY };
	}

	/**
	 * A leg's stops: its count, its length by class over the class's spacing
	 * times stopDensity, rounded up or down by a draw so the map's count is
	 * what its road earns; then each in a slot of its own along the leg, clear
	 * of the ends and of junctions and `minGap` past the one before, at the
	 * nearest point to where its draw puts it, or dropped where the slot has no
	 * such point; then each one's type, carrying on from the stops behind the
	 * leg so no route has three fights or checkpoints in a row. One draw for
	 * the count, and three a stop, kept or dropped.
	 */
	private placeOnLeg(id: number, line: readonly number[], stream: Rng, behind: readonly StopType[]): void {
		const leg = this.layer.legs[id];
		const { spacing, clearance, minGap, jitter } = this.tuning;
		const { classLengths, tier, territory } = this.profiles[id];
		const length = leg.length;
		const ends = clearance.ends < 0.25 * length ? clearance.ends : 0.25 * length;
		const usable = length - 2 * ends;
		const most = usable > 0 ? floor(usable / minGap) : 0;
		let expected = 0;
		for (const roadClass of ROAD_CLASSES) expected += classLengths[roadClass] / spacing[roadClass];
		const drawn = floor(expected * this.params.stopDensity + stream.float());
		const count = drawn < most ? drawn : most;
		if (count === 0) return;
		const joins = this.joins[id];
		const slot = usable / count;
		const alongs: number[] = [];
		const draws: { type: number; skulls: number }[] = [];
		for (let index = 0; index < count; index += 1) {
			const start = ends + index * slot;
			const target = start + (0.5 + (stream.float() - 0.5) * jitter) * slot;
			const draw = { type: stream.float(), skulls: stream.float() };
			// A slot is at least minGap wide, so the one before always leaves this one room.
			const from = alongs.length > 0 && alongs[alongs.length - 1] + minGap > start ? alongs[alongs.length - 1] + minGap : start;
			const along = nearestClear({ target, from, to: start + slot, joins, clear: clearance.junctions });
			if (along === null) continue;
			alongs.push(along);
			draws.push(draw);
		}
		if (alongs.length === 0) return;
		const points = pointsAlong(line, alongs);
		const tail = [...behind];
		alongs.forEach((along, index) => {
			const x = points[2 * index];
			const y = points[2 * index + 1];
			const roadClass = this.classAt(id, along);
			const biome = this.ground.biome(x, y);
			const calmOnly = tail.length === 2 && !isCalm(tail[0]) && !isCalm(tail[1]);
			const type = this.tables.draw({ row: this.tables.rowOf({ roadClass, biome, tier, territory }), draw: draws[index].type, calmOnly });
			tail.push(type);
			if (tail.length > 2) tail.shift();
			this.placed[id].push({ along, x, y, type, skulls: this.skulls(type, tier, draws[index].skulls), roadClass, biome });
		});
	}

	private classAt(id: number, along: number): RoadClass {
		let passed = 0;
		const { pieces } = this.layer.legs[id];
		for (const { stretch, length } of pieces) {
			passed += length;
			if (along <= passed) return this.network.stretches[stretch].roadClass;
		}
		return this.network.stretches[pieces[pieces.length - 1].stretch].roadClass;
	}

	/** A fight's skulls: 1 at tier 1, rising by the step a tier times dangerCurve, rounded by a draw, a warband's raised; 0 for anything else. */
	private skulls(type: StopType, tier: number, draw: number): number {
		if (!isFight(type)) return 0;
		const { step, warband } = this.tuning.skulls;
		const level = floor(1 + (tier - 1) * step * this.params.dangerCurve + draw) + (type === 'warband' ? warband : 0);
		return level < 1 ? 1 : level > 3 ? 3 : level;
	}

	/**
	 * Find: driver stops: in every tier, at least its rate of the tier's stops,
	 * rounded down; and across the floor's tiers, at least driverFinds, adding
	 * stops where the legs there hold too few to turn. Each is a stop turned
	 * into a Find: driver, a calm one first and on a leg with none yet, by
	 * draws on the `finds` fork. Turning a stop calm never breaks the
	 * per-route rules, and neither does adding one.
	 */
	private findDrivers(): void {
		const stream = this.rng.fork('finds');
		const { floorTiers, rates } = this.tuning.driverFinds;
		for (let tier = 1; tier <= rates.length; tier += 1) {
			const stops = this.stopsIn((legTier) => legTier === tier);
			const want = floor(rates[tier - 1] * stops.length);
			this.turnToFinds({ stops, need: want - countFinds(stops), stream });
		}
		if (this.layer.legs.length === 0) return;
		const inFloor = (legTier: number) => legTier <= floorTiers;
		let need = this.params.driverFinds - countFinds(this.stopsIn(inFloor));
		need -= this.turnToFinds({ stops: this.stopsIn(inFloor), need, stream });
		for (; need > 0; need -= 1) {
			if (!this.addFind(inFloor)) {
				this.failures.push(`no leg in tiers 1 to ${floorTiers} has room for ${need} more Find: driver stops (driverFinds ${this.params.driverFinds})`);
				return;
			}
		}
	}

	private stopsIn(tierHolds: (tier: number) => boolean): { leg: number; stop: Placed }[] {
		const stops: { leg: number; stop: Placed }[] = [];
		this.placed.forEach((placed, leg) => {
			if (tierHolds(this.tiers[leg])) for (const stop of placed) stops.push({ leg, stop });
		});
		return stops;
	}

	/** Turns up to `need` of these stops into Find: driver, returning how many it turned. */
	private turnToFinds({ stops, need, stream }: { stops: { leg: number; stop: Placed }[]; need: number; stream: Rng }): number {
		let turned = 0;
		for (; turned < need; turned += 1) {
			const withFind = new Set(stops.filter(({ stop }) => stop.type === 'findDriver').map(({ leg }) => leg));
			let best: { leg: number; stop: Placed }[] = [];
			let bestRank = Infinity;
			for (const candidate of stops) {
				if (candidate.stop.type === 'findDriver') continue;
				const rank = TURN_ORDER[candidate.stop.type] + (withFind.has(candidate.leg) ? TURN_GROUPS : 0);
				if (rank < bestRank) {
					best = [];
					bestRank = rank;
				}
				if (rank === bestRank) best.push(candidate);
			}
			if (best.length === 0) break;
			const { stop } = best[stream.int(0, best.length - 1)];
			stop.type = 'findDriver';
			stop.skulls = 0;
		}
		return turned;
	}

	/**
	 * Adds a Find: driver stop on a leg in these tiers, but those in `avoid`:
	 * in the gap between stops (or a stop and the clearance at a leg's end)
	 * where it can stand furthest from both sides, clear of junctions, as near
	 * the gap's middle as junctions let it. False when no gap has room.
	 */
	private addFind(tierHolds: (tier: number) => boolean, avoid: ReadonlySet<number> = new Set()): boolean {
		const { clearance } = this.tuning;
		let bestLeg = -1;
		let bestAlong = 0;
		let widest = 0;
		this.layer.legs.forEach(({ length }, leg) => {
			if (!tierHolds(this.tiers[leg]) || length <= 0 || avoid.has(leg)) return;
			const ends = clearance.ends < 0.25 * length ? clearance.ends : 0.25 * length;
			const marks = [ends, ...this.placed[leg].map(({ along }) => along), length - ends];
			for (let index = 1; index < marks.length; index += 1) {
				// Strictly between two stops, so the leg's stops stay in order; up to the end's clearance itself.
				const from = index === 1 ? marks[0] : marks[index - 1] + GAP_EDGE;
				const to = index === marks.length - 1 ? marks[index] : marks[index] - GAP_EDGE;
				if (!(from <= to)) continue;
				const along = nearestClear({ target: (marks[index - 1] + marks[index]) / 2, from, to, joins: this.joins[leg], clear: clearance.junctions });
				if (along === null) continue;
				const room = along - marks[index - 1] < marks[index] - along ? along - marks[index - 1] : marks[index] - along;
				if (room > widest || bestLeg < 0) {
					widest = room;
					bestLeg = leg;
					bestAlong = along;
				}
			}
		});
		if (bestLeg < 0) return false;
		const [x, y] = pointsAlong(legPoints(this.network, this.layer.legs[bestLeg]), [bestAlong]);
		const stop: Placed = { along: bestAlong, x, y, type: 'findDriver', skulls: 0, roadClass: this.classAt(bestLeg, bestAlong), biome: this.ground.biome(x, y) };
		const stops = this.placed[bestLeg];
		const at = stops.findIndex(({ along }) => along > bestAlong);
		stops.splice(at < 0 ? stops.length : at, 0, stop);
		return true;
	}

	/**
	 * Guarantee 10: every POI in tiers 1 to 3 has a route whose estimated run
	 * (out with its stops, the objective, and home) fits in daylightHours.
	 * Where none does, its quickest route sheds stops, on legs fewer routes
	 * share first, then the costliest in hours, the furthest out first, never a
	 * Find: driver and never one whose going breaks a route's rules, until it
	 * fits. A POI whose quickest route runs past dark with no stops at all is
	 * a failure no thinning can mend.
	 */
	private daylight(): void {
		const { daylightHours } = this.params;
		const unmendable = new Set<number>();
		// A Find: driver moved off one route lands on another leg, which can tip that leg's routes past dark; a pass or two more settles them.
		for (let pass = 0, changed = true; changed && pass < DAYLIGHT_PASSES; pass += 1) {
			changed = false;
			this.layer.pois.forEach((poi, index) => {
				if (poi.tier > DAYLIGHT_TIERS || unmendable.has(index)) return;
				const routes = this.routes[index];
				if (routes.length === 0 || routes.some((route) => this.estimate(index, route) <= daylightHours)) return;
				const [quickest] = routes;
				const bare = 2 * quickest.hours + this.objectiveHours(index);
				if (bare > daylightHours) {
					unmendable.add(index);
					this.failures.push(`poi ${index} (tier ${poi.tier}): its quickest route takes ${bare.toFixed(2)} hours with no stops, past daylightHours ${daylightHours}`);
					return;
				}
				changed = true;
				while (this.estimate(index, quickest) > daylightHours) {
					if (!this.thin(quickest)) {
						unmendable.add(index);
						this.failures.push(`poi ${index} (tier ${poi.tier}): no stop on its quickest route can go without breaking a route's rules or the Find: driver floor`);
						return;
					}
				}
			});
		}
	}

	/**
	 * Takes the best stop to lose off a route, false when none can go: on
	 * legs fewer routes share first, then the costliest, the furthest out
	 * first, and a Find: driver last. A fight or checkpoint can always go;
	 * any other stop only where every route through its leg keeps the rules
	 * without it. A Find: driver the floor or its tier's rate still needs
	 * moves to the widest gap on a leg of its tiers off this route.
	 */
	private thin(route: Route): boolean {
		const { types } = this.tuning;
		const candidates: { leg: number; index: number; rank: number[] }[] = [];
		route.legs.forEach((leg, place) => {
			this.placed[leg].forEach((stop, index) => {
				candidates.push({ leg, index, rank: [stop.type === 'findDriver' ? 1 : 0, this.routesOn[leg].length, -types[stop.type].hours, -place, -stop.along] });
			});
		});
		candidates.sort((a, b) => (before(a.rank, b.rank) ? -1 : before(b.rank, a.rank) ? 1 : 0));
		const onRoute = new Set(route.legs);
		for (const { leg, index } of candidates) {
			const stop = this.placed[leg][index];
			if (isCalm(stop.type) && !this.canLose(leg, index)) continue;
			this.placed[leg].splice(index, 1);
			if (stop.type === 'findDriver' && !this.findsHold(this.tiers[leg])) {
				const tier = this.tiers[leg];
				const { floorTiers } = this.tuning.driverFinds;
				const sameTiers = tier <= floorTiers ? (legTier: number) => legTier <= floorTiers : (legTier: number) => legTier === tier;
				if (!this.addFind(sameTiers, onRoute)) {
					this.placed[leg].splice(index, 0, stop);
					continue;
				}
			}
			this.thinned += 1;
			return true;
		}
		return false;
	}

	/** Whether the Find: driver floor holds, and the rate for this tier. */
	private findsHold(tier: number): boolean {
		const { floorTiers, rates } = this.tuning.driverFinds;
		const inTier = this.stopsIn((legTier) => legTier === tier);
		if (countFinds(inTier) < floor(rates[tier - 1] * inTier.length)) return false;
		return tier > floorTiers || countFinds(this.stopsIn((legTier) => legTier <= floorTiers)) >= this.params.driverFinds;
	}

	/** Whether every route through a leg still keeps the rules without one of its stops. */
	private canLose(leg: number, index: number): boolean {
		const lost = this.placed[leg][index];
		return this.routesOn[leg].every(({ route }) => {
			const types: StopType[] = [];
			for (const on of route.legs) for (const stop of this.placed[on]) if (stop !== lost) types.push(stop.type);
			return keepsRules(types);
		});
	}

	/** An estimated run along a route: out with its stops, the objective, and home. */
	private estimate(poi: number, route: Route): number {
		let stops = 0;
		for (const leg of route.legs) for (const { type } of this.placed[leg]) stops += this.tuning.types[type].hours;
		return 2 * route.hours + stops + this.objectiveHours(poi);
	}

	private objectiveHours(poi: number): number {
		const { objectiveHours } = this.tuning;
		return this.layer.pois[poi].type === STRONGHOLD_TYPE ? objectiveHours.stronghold : objectiveHours.poi;
	}
}

/** Which stops turn into a Find: driver first: events, then hazards, garages, checkpoints, other finds, and fights last. */
const TURN_ORDER: { readonly [Type in StopType]: number } = {
	wreck: 0,
	distress: 0,
	hazard: 1,
	garage: 2,
	checkpoint: 3,
	findSettlers: 4,
	findVehicle: 4,
	findCards: 4,
	findSupplies: 4,
	ambush: 5,
	warband: 5,
	findDriver: 6,
};
const TURN_GROUPS = 7;

/**
 * Whether a route's stops keep the per-route rules: no more than two fights
 * in a row, and a non-fight (neither a fight nor a checkpoint) in any three.
 * The second holds wherever the first does not fail on a checkpoint, so
 * checking it covers both; `checkStopLayer` reports them apart.
 */
export function keepsRules(types: readonly StopType[]): boolean {
	for (let index = 2; index < types.length; index += 1) {
		if (!isCalm(types[index]) && !isCalm(types[index - 1]) && !isCalm(types[index - 2])) return false;
	}
	return true;
}

function lastTwo(behind: readonly StopType[], placed: readonly Placed[]): StopType[] {
	const types = [...behind, ...placed.map(({ type }) => type)];
	return types.slice(types.length - 2 < 0 ? 0 : types.length - 2);
}

function countFinds(stops: readonly { stop: Placed }[]): number {
	return stops.filter(({ stop }) => stop.type === 'findDriver').length;
}

/** Lexical order on equal-length ranks: true when `a` comes first. */
function before(a: readonly number[], b: readonly number[]): boolean {
	for (let index = 0; index < a.length; index += 1) {
		if (a[index] !== b[index]) return a[index] < b[index];
	}
	return false;
}

/** World units a Find: driver added for the floor keeps from the stops either side of it, at the least. */
const GAP_EDGE = 1;
/** Slack for a junction's clearance, which `join + clear` can miss by a rounding. */
const CLEAR_SLACK = 1e-9;

/**
 * The point of [from, to] nearest `target` that keeps `clear` from every
 * junction, the lower of two as near; null when there's none. The nearest
 * such point is the target itself, an end of the range, or a junction's
 * clearance either side, so those are all it tries.
 */
export function nearestClear({ target, from, to, joins, clear }: { target: number; from: number; to: number; joins: readonly number[]; clear: number }): number | null {
	const clears = (along: number) => along >= from && along <= to && joins.every((join) => (along - join) * (along - join) >= (clear - CLEAR_SLACK) * (clear - CLEAR_SLACK));
	const aim = target < from ? from : target > to ? to : target;
	let best: number | null = null;
	let bestOff = Infinity;
	for (const along of [aim, from, to, ...joins.flatMap((join) => [join - clear, join + clear])]) {
		if (!clears(along)) continue;
		const off = along < aim ? aim - along : along - aim;
		if (off < bestOff || (off === bestOff && best !== null && along < best)) {
			best = along;
			bestOff = off;
		}
	}
	return best;
}

/** How many roads meet at each node: a stretch from a node to itself is no road. */
export function nodeDegrees({ nodes, stretches }: RoadNetwork): Int32Array {
	const degrees = new Int32Array(nodes.length);
	for (const { from, to } of stretches) {
		if (from === to) continue;
		degrees[from] += 1;
		degrees[to] += 1;
	}
	return degrees;
}

/**
 * World units along a leg of each junction partway along it: a node between
 * two of its pieces where three or more roads meet. A node where a leg only
 * changes stretch, at a class change or a roadside point, isn't one.
 */
export function junctionsAlong({ network, leg, degrees }: { network: RoadNetwork; leg: Pick<Leg, 'pieces'>; degrees: Int32Array }): number[] {
	const joins: number[] = [];
	let along = 0;
	const { pieces } = leg;
	for (let piece = 0; piece + 1 < pieces.length; piece += 1) {
		along += pieces[piece].length;
		const { from, to } = network.stretches[pieces[piece].stretch];
		if (degrees[pieces[piece].forward ? to : from] >= 3) joins.push(along);
	}
	return joins;
}

/** The points at increasing distances along a polyline, flat x0, y0, x1, y1, ..., in one walk; its end past its length. */
export function pointsAlong(points: readonly number[], distances: readonly number[]): number[] {
	const out: number[] = [];
	let index = 0;
	let travelled = 0;
	let segment = points.length >= 4 ? segmentLength(points, 0) : 0;
	for (const distance of distances) {
		while (index + 3 < points.length && travelled + segment < distance) {
			travelled += segment;
			index += 2;
			segment = index + 3 < points.length ? segmentLength(points, index) : 0;
		}
		if (index + 3 >= points.length || segment === 0) {
			out.push(points[points.length - 2], points[points.length - 1]);
			continue;
		}
		const share = (distance - travelled) / segment;
		out.push(points[index] + (points[index + 2] - points[index]) * share, points[index + 1] + (points[index + 3] - points[index + 1]) * share);
	}
	return out;
}

function segmentLength(points: readonly number[], index: number): number {
	const dx = points[index + 2] - points[index];
	const dy = points[index + 3] - points[index + 1];
	return sqrt(dx * dx + dy * dy);
}

/** What a stop holds, rolled when the run reveals it and kept by the save once it is (DDB-402). Plain JSON. */
export interface StopContents {
	readonly stop: number;
	/** How many times it's been rolled before: 0 the first time, up one each time a cleared leg's stops come back. */
	readonly roll: number;
	readonly type: StopType;
	/** Hours it takes: its type's, or a hazard's own, rolled. */
	readonly hours: number;
	/**
	 * The seed of the stream the run draws the rest from (a fight's raiders,
	 * a found driver, an event's outcome), so everything about the stop is
	 * fixed by its id and roll.
	 */
	readonly seed: number;
	/** A hazard's kind. */
	readonly hazard?: string;
	/** A Find: supplies stop's haul. */
	readonly supplies?: { readonly resource: PoiResource; readonly amount: number };
}

/** A map with its stops, as `rollStop` reads it: a generation's products, or anything holding the same layer. */
export interface MapWithStops {
	readonly products: { readonly stops: StopLayer };
}

/**
 * A stop's contents: from the stream `stop:<id>` at the roll count, forked
 * from the layer's content seed, so the same stop and roll always give the
 * same contents, and nothing else on the map moves them. Each field draws
 * on a fork of its own. Throws on a stop the map doesn't have, or a roll
 * that isn't a count.
 */
export function rollStop(map: MapWithStops, stopId: number, roll: number, tuning: StopTuning = STOP_TUNING): StopContents {
	const { stops, contentSeed } = map.products.stops;
	if (!Number.isInteger(stopId) || stopId < 0 || stopId >= stops.length) throw new RangeError(`rollStop: the map has no stop ${stopId}; it has ${stops.length}`);
	if (!Number.isInteger(roll) || roll < 0) throw new RangeError(`rollStop: roll must be a count from 0, got ${roll}`);
	const { type } = stops[stopId];
	const stream = new Rng({ seed: contentSeed }).fork(`stop:${stopId}`, roll);
	const base = { stop: stopId, roll, type, seed: stream.fork('run').seed };
	const { hazards, hazardHours, supplies } = tuning.contents;
	if (type === 'hazard') {
		const steps = round((hazardHours.max - hazardHours.min) / hazardHours.step);
		return { ...base, hours: hazardHours.min + stream.fork('hours').int(0, steps) * hazardHours.step, hazard: stream.fork('hazard').pick(hazards) };
	}
	const hours = tuning.types[type].hours;
	if (type === 'findSupplies') {
		const resource = stream.fork('resource').pick(POI_RESOURCES);
		const { min, max } = supplies[resource];
		return { ...base, hours, supplies: { resource, amount: stream.fork('amount').int(min, max) } };
	}
	return { ...base, hours };
}
