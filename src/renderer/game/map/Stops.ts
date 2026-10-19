import { Rng } from '../core/Rng';
import { BIOMES, Biome } from './Biome';
import type { MapParams } from './MapParams';
import { POI_RESOURCES, PoiResource, STRONGHOLD_TYPE } from './PoiData';
import type { PoiLayer } from './Pois';
import { ROAD_CLASSES, RoadClass, RoadNetwork } from './RoadNetwork';
import { Route, legPoints, routesTo } from './RouteTree';
import { CompiledStopTables, NO_TERRITORY, STOP_TUNING, StopTuning, StopType, TierBand, isCalm, isFight, stopTablesFor } from './StopData';
import { DAYLIGHT_TIERS, bandFor, junctionsAlong, legEnds, legOwners, legRoom, legSpan, nearestClear, nodeDegrees, ownRoadNeed, packAlong, runHours } from './StopRoom';
import type { Terrain } from './Terrain';

/**
 * Stage 9 of area map generation, stops (Area Map Generation, 9. Stops), on
 * the `stops` stream: stops on the legs of the route tree and nowhere else.
 * Each route's stops come to its destination tier's band and its fights to
 * the band's fights, allocated over the route tree parents first, since a
 * leg's stops are on every route through it. A leg starts from what its road
 * earns and is clamped by the tightest route through it and lifted by the
 * loosest; each route's need, its fight floor and half its band's minimum,
 * goes on its own road (legs no other POI's routes use), which the POI stage
 * left room for. Fights are allocated the same way, then each leg's stops
 * are ordered so no route has three fights in a row, spread along the leg by
 * arc length with jitter, clear of its ends and junctions, and typed from
 * the stop tables: ambush or warband for a fight, a calm type for the rest.
 * Each route's own last leg also carries up to two dormant calm stops for
 * later game stages. Then the Find: driver floor and rates, and the daylight
 * check (guarantee 10), which thins a POI's quickest route until an
 * estimated run fits in daylight, never below a route's fight floor.
 *
 * Tier and territory are stand-ins until stage 8 (DDB-292): a leg's tier is
 * the lowest of the POIs whose routes use it, by the POI layer's stand-in,
 * and every stop is on no one's ground. A stop's contents aren't rolled
 * here: `rollStop` rolls them when the run reveals it. The decision record
 * is docs/AI_TECHNICAL_DECISIONS/stops-and-routes.md.
 */

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const ceil = Math.ceil;
const round = Math.round;
const abs = Math.abs;

/** A stronghold's tier, and any leg's before a POI's route claims it. */
const STRONGHOLD_TIER = 5;
/** Passes of the daylight check at most, each over every POI it covers. */
const DAYLIGHT_PASSES = 4;
/** Halvings the search for a leg's gap takes between `tightGap` and `minGap`. */
const GAP_STEPS = 16;
/** Past this many stops on a leg, its fights are ordered by a pattern rather than every arrangement tried. */
const ARRANGE_LIMIT = 12;

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
	/** The game stage it's on the road from: 0 for a stop that always is, or a dormant calm extra's stage (Runs and Encounters, Game stage). */
	readonly stage: number;
}

/** What a leg is made of, for the stops and the route descriptors. */
export interface LegProfile {
	/** Its stops' ids from game stage 0, in driving order. */
	readonly stops: readonly number[];
	/** Its dormant calm extras' ids, in driving order: only a route's own last leg has any, each on from its `stage`. */
	readonly extras: readonly number[];
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
	/** By leg, each leg's in driving order, its extras among them. */
	readonly stops: readonly Stop[];
	/** By leg id, one for each of the POI layer's legs. */
	readonly legs: readonly LegProfile[];
	/** The seed every stop's contents fork from, by its id and roll count (`rollStop`). */
	readonly contentSeed: number;
	/** How many stops the daylight check took off routes that ran past dark. */
	readonly thinned: number;
	/**
	 * What the stage couldn't keep and only reports: a route outside its band
	 * or short of half its band's minimum on its own road, a tier 1 to 3 POI
	 * whose quickest route runs past dark with no stops at all (the tiers' to
	 * fix, DDB-292), or a Find: driver floor with no leg in its tiers. A
	 * route under its fight floor is never here: that fails the stage.
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
	stage: number;
}

/** A route through a leg: the POI it goes to, the route, and the leg's place along it. */
interface PoiRoute {
	readonly poi: number;
	readonly route: Route;
	readonly place: number;
}

/** A leg's draws, taken before the allocation so its order never moves them. */
interface LegDraws {
	readonly stream: Rng;
	readonly count: number;
	readonly fights: number;
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
	/** Each leg's POI where it's one POI's own road, else `NO_OWNER` or `SHARED`. */
	private readonly owners: Int32Array;
	/** Each POI's band, by its tier, and what its routes' own road has to hold. */
	private readonly bands: readonly TierBand[];
	private readonly needs: readonly number[];
	/** Each node's roads, which say where roads meet. */
	private readonly degrees: Int32Array;
	/** Each leg's junctions, as world units along it. */
	private readonly joins: number[][];
	/** Each leg's room at the tight gap. */
	private readonly rooms: Int32Array;
	/** Each leg's stops, extras among them, in driving order. */
	private readonly placed: Placed[][];
	private readonly profiles: Omit<LegProfile, 'stops' | 'extras'>[] = [];
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
				route.legs.forEach((leg, place) => {
					this.routesOn[leg].push({ poi, route, place });
					if (tier < this.tiers[leg]) this.tiers[leg] = tier;
				});
			}
		});
		this.owners = legOwners(layer.legs.length, this.routes);
		this.bands = layer.pois.map(({ tier }) => bandFor(tier, tuning));
		this.needs = layer.pois.map(({ tier }) => ownRoadNeed(tier, tuning));
		this.placed = layer.legs.map(() => []);
		this.degrees = nodeDegrees(network);
		this.joins = layer.legs.map((leg) => junctionsAlong({ network, leg, degrees: this.degrees }));
		this.rooms = Int32Array.from(layer.legs, (leg, id) => legRoom({ length: leg.length, joins: this.joins[id], gap: tuning.tightGap, tuning }));
	}

	public place(): StopLayer {
		const draws: LegDraws[] = this.layer.legs.map((_leg, id) => {
			const stream = this.rng.fork('leg', id);
			return { stream, count: stream.float(), fights: stream.float() };
		});
		const lines = this.layer.legs.map((leg) => legPoints(this.network, leg));
		lines.forEach((line, id) => this.profiles.push(this.profile(id, line)));
		const counts = this.allocateCounts(draws);
		const extras = this.allocateExtras(counts);
		const fights = this.allocateFights(counts, draws);
		const tails: StopType[][] = [];
		this.layer.legs.forEach((leg, id) => {
			const behind = leg.parent < 0 ? [] : tails[leg.parent];
			this.placeOnLeg({ id, line: lines[id], stream: draws[id].stream, behind, count: counts[id], fights: fights[id], extras: extras[id] });
			tails.push(lastTwo(behind, this.placed[id].filter(({ stage }) => stage === 0)));
		});
		this.findDrivers();
		this.daylight();
		this.topUp();
		this.keepRates(this.rng.fork('rates'));
		this.reportShortfalls();
		const stops: Stop[] = [];
		const legs: LegProfile[] = this.profiles.map((profile, leg) => {
			const ids: number[] = [];
			const extraIds: number[] = [];
			const length = this.layer.legs[leg].length;
			for (const { along, x, y, type, skulls, roadClass, biome, stage } of this.placed[leg]) {
				(stage === 0 ? ids : extraIds).push(stops.length);
				stops.push({ id: stops.length, leg, along, at: length > 0 ? along / length : 0, x, y, type, skulls, roadClass, biome, stage });
			}
			return { ...profile, stops: ids, extras: extraIds };
		});
		return { stops, legs, contentSeed: this.rng.fork('contents').seed, thinned: this.thinned, failures: this.failures };
	}

	/** A leg's classes and biomes by length, its main highway, and its middle. */
	private profile(id: number, line: readonly number[]): Omit<LegProfile, 'stops' | 'extras'> {
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
	 * Each leg's stops, parents first. A leg starts from what its road earns:
	 * its length by class over the class's spacing, times stopDensity,
	 * rounded up or down by its draw. That's clamped from above by its room at
	 * the tight gap and by the tightest route through it, which keeps back
	 * the stops its own road still has to hold, and from below by the loosest
	 * route's band minimum, less the room past this leg, and on a route's own
	 * road by its need, less the own road past it. Where the two cross, the
	 * upper bound wins and the route falls short of its band, which the
	 * shortfalls report.
	 */
	private allocateCounts(draws: readonly LegDraws[]): number[] {
		const { spacing } = this.tuning;
		const legs = this.layer.legs;
		const counts = new Array<number>(legs.length).fill(0);
		const behind = new Array<number>(legs.length).fill(0);
		legs.forEach((leg, id) => {
			behind[id] = leg.parent < 0 ? 0 : behind[leg.parent] + counts[leg.parent];
			const { classLengths } = this.profiles[id];
			let expected = 0;
			for (const roadClass of ROAD_CLASSES) expected += classLengths[roadClass] / spacing[roadClass];
			const earned = floor(expected * this.params.stopDensity + draws[id].count);
			let upper = this.rooms[id];
			let lower = 0;
			for (const { poi, route, place } of this.routesOn[id]) {
				const { stops } = this.bands[poi];
				let roomAfter = 0;
				let ownRoomAfter = 0;
				let ownBehind = 0;
				for (let at = place + 1; at < route.legs.length; at += 1) {
					roomAfter += this.rooms[route.legs[at]];
					if (this.owners[route.legs[at]] === poi) ownRoomAfter += this.rooms[route.legs[at]];
				}
				for (let at = 0; at < place; at += 1) if (this.owners[route.legs[at]] === poi) ownBehind += counts[route.legs[at]];
				const ownLeft = this.needs[poi] > ownBehind ? this.needs[poi] - ownBehind : 0;
				const most = stops.max - behind[id] - (this.owners[id] === poi ? 0 : ownLeft < ownRoomAfter ? ownLeft : ownRoomAfter);
				if (most < upper) upper = most;
				const least = stops.min - behind[id] - roomAfter;
				if (least > lower) lower = least;
				if (this.owners[id] === poi && ownLeft - ownRoomAfter > lower) lower = ownLeft - ownRoomAfter;
			}
			if (upper < 0) upper = 0;
			counts[id] = lower > upper ? upper : earned < lower ? lower : earned > upper ? upper : earned;
		});
		return counts;
	}

	/** Each route's dormant calm extras: up to one a game stage in the tuning's `extras`, on its own last leg where the leg has room past its stops. */
	private allocateExtras(counts: readonly number[]): number[] {
		const extras = new Array<number>(counts.length).fill(0);
		this.layer.pois.forEach(({ arrivals }) => {
			for (const { leg } of arrivals) {
				const room = this.rooms[leg] - counts[leg];
				extras[leg] = room < this.tuning.extras.length ? (room > 0 ? room : 0) : this.tuning.extras.length;
			}
		});
		return extras;
	}

	/**
	 * Each leg's fights, the same way as its stops: what the leg earns, its
	 * stops times the share of fights in its routes' bands (the least of the
	 * routes through it), rounded by its draw, clamped from above by the
	 * tightest route's fight ceiling, keeping back its floor for its own
	 * road, and from below on a route's own road by the floor it still needs.
	 * A leg no POI owns keeps a calm stop, so a route's floor fights can follow
	 * it without three in a row.
	 */
	private allocateFights(counts: readonly number[], draws: readonly LegDraws[]): number[] {
		const legs = this.layer.legs;
		const fights = new Array<number>(legs.length).fill(0);
		const behind = new Array<number>(legs.length).fill(0);
		legs.forEach((leg, id) => {
			behind[id] = leg.parent < 0 ? 0 : behind[leg.parent] + fights[leg.parent];
			const count = counts[id];
			if (count === 0) return;
			const shared = this.routesOn[id].some(({ poi }) => this.owners[id] !== poi);
			let upper = shared ? count - 1 : count - floor(count / 3);
			let lower = 0;
			let share = 1;
			for (const { poi, route, place } of this.routesOn[id]) {
				const { stops, fights: band } = this.bands[poi];
				const routeShare = (band.min + band.max) / (stops.min + stops.max);
				if (routeShare < share) share = routeShare;
				let ownStopsAfter = 0;
				let ownBehind = 0;
				for (let at = place + 1; at < route.legs.length; at += 1) if (this.owners[route.legs[at]] === poi) ownStopsAfter += fightRoom(counts[route.legs[at]]);
				for (let at = 0; at < place; at += 1) if (this.owners[route.legs[at]] === poi) ownBehind += fights[route.legs[at]];
				const floorLeft = band.min > ownBehind ? band.min - ownBehind : 0;
				const own = this.owners[id] === poi;
				const most = band.max - behind[id] - (own ? 0 : floorLeft < ownStopsAfter ? floorLeft : ownStopsAfter);
				if (most < upper) upper = most;
				if (own && floorLeft - ownStopsAfter > lower) lower = floorLeft - ownStopsAfter;
			}
			if (upper < 0) upper = 0;
			const earned = floor(count * share + draws[id].fights);
			fights[id] = lower > upper ? upper : earned < lower ? lower : earned > upper ? upper : earned;
		});
		return fights;
	}

	/**
	 * A leg's stops: which are fights (`arrange`), where they stand, each in
	 * a slot of its own along the leg, clear of the ends and junctions and a
	 * gap apart, the widest gap from `minGap` down to `tightGap` the leg has
	 * room for, at the nearest point to where its draw puts it, or packed
	 * from the inner end where a slot has no such point; then each one's
	 * type. Its extras take slots spread among the rest. Three draws a stop.
	 */
	private placeOnLeg({ id, line, stream, behind, count, fights, extras }: {
		id: number; line: readonly number[]; stream: Rng; behind: readonly StopType[]; count: number; fights: number; extras: number;
	}): void {
		const total = count + extras;
		if (total === 0) return;
		const leg = this.layer.legs[id];
		const { clearance, jitter } = this.tuning;
		const { tier, territory } = this.profiles[id];
		const length = leg.length;
		const gap = this.gapFor(id, total);
		const ends = legEnds(length, this.tuning);
		const slot = (length - 2 * ends) / total;
		const joins = this.joins[id];
		const draws: { target: number; type: number; skulls: number }[] = [];
		for (let index = 0; index < total; index += 1) draws.push({ target: stream.float(), type: stream.float(), skulls: stream.float() });
		let alongs: number[] = [];
		for (let index = 0; index < total; index += 1) {
			const start = ends + index * slot;
			const target = start + (0.5 + (draws[index].target - 0.5) * jitter) * slot;
			const from = alongs.length > 0 && alongs[alongs.length - 1] + gap > start ? alongs[alongs.length - 1] + gap : start;
			const along = nearestClear({ target, from, to: start + slot, joins, clear: clearance.junctions });
			if (along === null) break;
			alongs.push(along);
		}
		if (alongs.length < total) alongs = packAlong({ ...legSpan(length, gap, this.tuning), gap, joins, clear: clearance.junctions, limit: total });
		const extraSlots = new Set<number>();
		for (let extra = 0; extra < extras; extra += 1) extraSlots.add(floor((extra + 1) * total / (extras + 1)));
		const pattern = arrange({ behind, count, fights, shared: this.routesOn[id].some(({ poi }) => this.owners[id] !== poi) });
		const points = pointsAlong(line, alongs);
		let active = 0;
		let extra = 0;
		alongs.forEach((along, index) => {
			const x = points[2 * index];
			const y = points[2 * index + 1];
			const roadClass = this.classAt(id, along);
			const biome = this.ground.biome(x, y);
			const isExtra = extraSlots.has(index);
			const fight = !isExtra && pattern[active];
			const type = this.tables.draw({ row: this.tables.rowOf({ roadClass, biome, tier, territory }), draw: draws[index].type, fight });
			const stage = isExtra ? this.tuning.extras[extra] : 0;
			if (isExtra) extra += 1;
			else active += 1;
			this.placed[id].push({ along, x, y, type, skulls: this.skulls(type, tier, draws[index].skulls), roadClass, biome, stage });
		});
	}

	/** The widest gap from `minGap` down to `tightGap` at which a leg has room for this many stops. */
	private gapFor(id: number, count: number): number {
		const { minGap, tightGap } = this.tuning;
		const { length } = this.layer.legs[id];
		const fits = (gap: number) => legRoom({ length, joins: this.joins[id], gap, tuning: this.tuning }) >= count;
		if (fits(minGap)) return minGap;
		let low = tightGap;
		let high = minGap;
		for (let step = 0; step < GAP_STEPS; step += 1) {
			const middle = (low + high) / 2;
			if (fits(middle)) low = middle;
			else high = middle;
		}
		return low;
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
	 * stops where the legs there hold too few calm stops to turn. Each is a
	 * calm stop turned into a Find: driver, on a leg with none yet first, by
	 * draws on the `finds` fork; never a fight, nor a dormant extra. Turning a
	 * calm stop never breaks the per-route rules, and neither does adding one.
	 */
	private findDrivers(): void {
		const stream = this.rng.fork('finds');
		const { floorTiers } = this.tuning.driverFinds;
		this.keepRates(stream);
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

	/** Turns calm stops into Find: driver until every tier holds its rate, again after the top-up adds stops. */
	private keepRates(stream: Rng): void {
		const { rates } = this.tuning.driverFinds;
		for (let tier = 1; tier <= rates.length; tier += 1) {
			const stops = this.stopsIn((legTier) => legTier === tier);
			const want = floor(rates[tier - 1] * stops.length);
			this.turnToFinds({ stops, need: want - countFinds(stops), stream });
		}
	}

	/** The stops on the road from game stage 0 on legs of these tiers. */
	private stopsIn(tierHolds: (tier: number) => boolean): { leg: number; stop: Placed }[] {
		const stops: { leg: number; stop: Placed }[] = [];
		this.placed.forEach((placed, leg) => {
			if (tierHolds(this.tiers[leg])) for (const stop of placed) if (stop.stage === 0) stops.push({ leg, stop });
		});
		return stops;
	}

	/** Turns up to `need` of these stops' calm ones into Find: driver, returning how many it turned. */
	private turnToFinds({ stops, need, stream }: { stops: { leg: number; stop: Placed }[]; need: number; stream: Rng }): number {
		let turned = 0;
		for (; turned < need; turned += 1) {
			const withFind = new Set(stops.filter(({ stop }) => stop.type === 'findDriver').map(({ leg }) => leg));
			let best: { leg: number; stop: Placed }[] = [];
			let bestRank = Infinity;
			for (const candidate of stops) {
				if (candidate.stop.type === 'findDriver' || !isCalm(candidate.stop.type)) continue;
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
	 * Adds a Find: driver stop on a leg in these tiers that `allowed` lets it
	 * onto, where every route through the leg is under its band's most stops:
	 * in the gap between stops (or a stop and the clearance at a leg's end)
	 * where it can stand furthest from both sides, at least `tightGap` from a
	 * stop, clear of junctions, as near the gap's middle as junctions let it.
	 * False when no gap has room.
	 */
	private addFind(tierHolds: (tier: number) => boolean, allowed: (leg: number) => boolean = () => true): boolean {
		const gap = this.widestGap((leg) => tierHolds(this.tiers[leg]) && allowed(leg));
		if (!gap) return false;
		this.insert(gap.leg, gap.along, () => 'findDriver');
		return true;
	}

	/** The gap where a stop added on a leg `allowed` lets it onto, under every route's band there, stands furthest from both sides, at least `tightGap` from a stop and clear of junctions; null with none. */
	private widestGap(allowed: (leg: number) => boolean): { leg: number; along: number } | null {
		const { clearance, tightGap } = this.tuning;
		let bestLeg = -1;
		let bestAlong = 0;
		let widest = 0;
		this.layer.legs.forEach(({ length }, leg) => {
			if (length <= 0 || !allowed(leg) || !this.underBands(leg)) return;
			const ends = legEnds(length, this.tuning);
			const marks = [ends, ...this.placed[leg].map(({ along }) => along), length - ends];
			for (let index = 1; index < marks.length; index += 1) {
				const from = index === 1 ? marks[0] : marks[index - 1] + tightGap;
				const to = index === marks.length - 1 ? marks[index] : marks[index] - tightGap;
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
		return bestLeg < 0 ? null : { leg: bestLeg, along: bestAlong };
	}

	/** A stop from game stage 0 added at a point along a leg, its type picked by the class and biome there. */
	private insert(leg: number, along: number, pick: (where: { roadClass: RoadClass; biome: Biome }) => StopType): Placed {
		const [x, y] = pointsAlong(legPoints(this.network, this.layer.legs[leg]), [along]);
		const roadClass = this.classAt(leg, along);
		const biome = this.ground.biome(x, y);
		const stop: Placed = { along, x, y, type: pick({ roadClass, biome }), skulls: 0, roadClass, biome, stage: 0 };
		const stops = this.placed[leg];
		const at = stops.findIndex((other) => other.along > along);
		stops.splice(at < 0 ? stops.length : at, 0, stop);
		return stop;
	}

	/**
	 * A route the daylight check left under its band's minimum, most often
	 * by thinning road it shares, takes calm stops back on its own road, by
	 * draws on the `fill` fork, where its own legs have room and the stop
	 * tips no POI home by dark past it. Where they have no room, a dormant
	 * extra there turns on from the start instead, the latest first, which
	 * the daylight check already counted. A calm stop added breaks no rule.
	 */
	private topUp(): void {
		const stream = this.rng.fork('fill');
		this.routes.forEach((routes, poi) => {
			const { min } = this.bands[poi].stops;
			for (const route of routes) {
				const own = new Set(route.legs.filter((leg) => this.owners[leg] === poi));
				while (this.activeOn(route).length < min) {
					const draw = stream.float();
					const gap = this.widestGap((leg) => own.has(leg));
					if (!gap) {
						const extra = this.latestExtra(own);
						if (!extra) break;
						extra.stage = 0;
						continue;
					}
					const { tier, territory } = this.profiles[gap.leg];
					const type = this.tables.draw({ row: this.tables.rowOf({ ...this.whereAt(gap.leg, gap.along), tier, territory }), draw, fight: false });
					if (!this.roomFor(gap.leg, this.tuning.types[type].hours)) break;
					this.insert(gap.leg, gap.along, () => type);
				}
			}
		});
	}

	/** The dormant extra on these legs that turns on latest, the furthest out on a tie. */
	private latestExtra(legs: ReadonlySet<number>): Placed | null {
		let latest: Placed | null = null;
		for (const leg of legs) for (const stop of this.placed[leg]) if (stop.stage > 0 && (latest === null || stop.stage >= latest.stage)) latest = stop;
		return latest;
	}

	/** The class and biome at a point along a leg. */
	private whereAt(leg: number, along: number): { roadClass: RoadClass; biome: Biome } {
		const [x, y] = pointsAlong(legPoints(this.network, this.layer.legs[leg]), [along]);
		return { roadClass: this.classAt(leg, along), biome: this.ground.biome(x, y) };
	}

	/** Whether every route through a leg holds fewer stops from game stage 0 than its band's most. */
	private underBands(leg: number): boolean {
		return this.routesOn[leg].every(({ poi, route }) => this.activeOn(route).length < this.bands[poi].stops.max);
	}

	/** A route's stops from game stage 0, in driving order. */
	private activeOn(route: Route): StopType[] {
		const types: StopType[] = [];
		for (const leg of route.legs) for (const { type, stage } of this.placed[leg]) if (stage === 0) types.push(type);
		return types;
	}

	/**
	 * Guarantee 10: every POI in tiers 1 to 3 has a route whose estimated run
	 * (out with its stops, every extra on, the objective, and home) fits in
	 * daylightHours. Where none does, its quickest route sheds stops until it
	 * fits (`thin`). A POI whose quickest route runs past dark with no stops
	 * at all is a failure no thinning can mend; one that can't get home in
	 * daylight without going under a fight floor stays past dark, which the
	 * checks fail.
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
				const bare = runHours({ routeHours: poi.arrivals[0].hours, stopHours: 0, objectiveHours: this.objectiveHours(index) });
				if (bare > daylightHours) {
					unmendable.add(index);
					this.failures.push(`poi ${index} (tier ${poi.tier}): its quickest route takes ${bare.toFixed(2)} hours with no stops, past daylightHours ${daylightHours}`);
					return;
				}
				changed = true;
				while (this.estimate(index, quickest) > daylightHours) {
					if (!this.thin(quickest)) {
						unmendable.add(index);
						return;
					}
				}
			});
		}
	}

	/**
	 * Takes the best stop to lose off a route, false when none can go: its
	 * extras first, then its calm stops, then a Find: driver, then a fight
	 * above every route's floor; within each, one whose going leaves every
	 * route through its leg in its band first, then on legs fewer routes
	 * share, then the costliest, the furthest out first. A calm stop goes only
	 * where every route through its leg keeps the rules without it, and a
	 * fight only where every route through its leg keeps its floor, on its
	 * own road too. A Find: driver the floor or its tier's rate still needs
	 * moves to the widest gap on a leg of its tiers off this route, and only
	 * onto a leg where its half hour tips no POI that's home by dark past it,
	 * so two POIs can't hand one find back and forth.
	 */
	private thin(route: Route): boolean {
		const { types } = this.tuning;
		const candidates: { leg: number; index: number; rank: number[] }[] = [];
		route.legs.forEach((leg, place) => {
			this.placed[leg].forEach((stop, index) => {
				const order = stop.stage > 0 ? 0 : isFight(stop.type) ? 3 : stop.type === 'findDriver' ? 2 : 1;
				const underBand = stop.stage === 0 && this.routesOn[leg].some(({ poi, route: through }) => this.activeOn(through).length <= this.bands[poi].stops.min) ? 1 : 0;
				candidates.push({ leg, index, rank: [order, underBand, this.routesOn[leg].length, -types[stop.type].hours, -place, -stop.along] });
			});
		});
		candidates.sort((a, b) => (before(a.rank, b.rank) ? -1 : before(b.rank, a.rank) ? 1 : 0));
		const onRoute = new Set(route.legs);
		for (const { leg, index } of candidates) {
			const stop = this.placed[leg][index];
			if (stop.stage === 0 && isFight(stop.type) && !this.keepsFloors(leg)) continue;
			if (stop.stage === 0 && isCalm(stop.type) && !this.canLose(leg, index)) continue;
			this.placed[leg].splice(index, 1);
			if (stop.stage === 0 && stop.type === 'findDriver' && !this.findsHold(this.tiers[leg])) {
				const tier = this.tiers[leg];
				const { floorTiers } = this.tuning.driverFinds;
				const sameTiers = tier <= floorTiers ? (legTier: number) => legTier <= floorTiers : (legTier: number) => legTier === tier;
				const hours = this.tuning.types.findDriver.hours;
				if (!this.addFind(sameTiers, (other) => !onRoute.has(other) && this.roomFor(other, hours))) {
					this.placed[leg].splice(index, 0, stop);
					continue;
				}
			}
			this.thinned += 1;
			return true;
		}
		return false;
	}

	/** Whether every route through a leg keeps its fight floor, on its own road too, with one fight fewer on the leg. */
	private keepsFloors(leg: number): boolean {
		return this.routesOn[leg].every(({ poi, route }) => {
			let fights = 0;
			let own = 0;
			for (const on of route.legs) {
				for (const { type, stage } of this.placed[on]) {
					if (stage > 0 || !isFight(type)) continue;
					fights += 1;
					if (this.owners[on] === poi) own += 1;
				}
			}
			const { min } = this.bands[poi].fights;
			return fights - 1 >= min && (this.owners[leg] === poi ? own - 1 : own) >= min;
		});
	}

	/**
	 * Whether a leg can take `extra` hours of stops without tipping past dark
	 * any POI in tiers 1 to 3 whose routes use it and that's home by dark now.
	 */
	private roomFor(leg: number, extra: number): boolean {
		const { daylightHours } = this.params;
		const pois = new Set(this.routesOn[leg].map(({ poi }) => poi));
		for (const poi of pois) {
			if (this.layer.pois[poi].tier > DAYLIGHT_TIERS) continue;
			const estimates = this.routes[poi].map((route) => ({ hours: this.estimate(poi, route), through: route.legs.includes(leg) }));
			if (!estimates.some(({ hours }) => hours <= daylightHours)) continue;
			if (!estimates.some(({ hours, through }) => hours + (through ? extra : 0) <= daylightHours)) return false;
		}
		return true;
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
			for (const on of route.legs) for (const stop of this.placed[on]) if (stop !== lost && stop.stage === 0) types.push(stop.type);
			return keepsRules(types);
		});
	}

	/** An estimated run along a route, every extra on: out with its stops, the objective, and home. */
	private estimate(poi: number, route: Route): number {
		let stops = 0;
		for (const leg of route.legs) for (const { type } of this.placed[leg]) stops += this.tuning.types[type].hours;
		// The arrival's hours, which the POI stage tiers by, rather than the legs' summed in another order.
		const { hours } = this.layer.pois[poi].arrivals[this.routes[poi].indexOf(route)];
		return runHours({ routeHours: hours, stopHours: stops, objectiveHours: this.objectiveHours(poi) });
	}

	private objectiveHours(poi: number): number {
		const { objectiveHours } = this.tuning;
		return this.layer.pois[poi].type === STRONGHOLD_TYPE ? objectiveHours.stronghold : objectiveHours.poi;
	}

	/** What the band's soft rules missed, into the failures: a route outside its band, or short of half its minimum on its own road. */
	private reportShortfalls(): void {
		this.routes.forEach((routes, poi) => {
			const { stops } = this.bands[poi];
			const half = ceil(stops.min / 2);
			routes.forEach((route, place) => {
				const count = this.activeOn(route).length;
				if (count < stops.min || count > stops.max) this.failures.push(`poi ${poi} route ${place}: ${count} stops, outside its band of ${stops.min} to ${stops.max}`);
				let own = 0;
				for (const leg of route.legs) if (this.owners[leg] === poi) for (const { stage } of this.placed[leg]) if (stage === 0) own += 1;
				if (own < half) this.failures.push(`poi ${poi} route ${place}: ${own} stops on its own road, under half its band's ${stops.min}`);
			});
		});
	}
}

/** Which calm stops turn into a Find: driver first: events, then hazards and garages, then other finds. */
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

/** How many fights a run of stops can hold with a non-fight in every three. */
function fightRoom(count: number): number {
	return count - floor(count / 3);
}

/**
 * Which of a leg's stops are fights, in driving order: `fights` of `count`,
 * keeping the per-route rules after the two stops behind the leg, ending on
 * as few fights as it can so the legs past it have room, then spread as
 * evenly as it can, the earliest arrangement on a tie. A leg no POI owns
 * ends on a calm stop wherever it has one. With no arrangement that keeps
 * the rules it takes one fight fewer.
 */
export function arrange({ behind, count, fights, shared }: { behind: readonly StopType[]; count: number; fights: number; shared: boolean }): boolean[] {
	for (let want = fights < count ? fights : count; want >= 0; want -= 1) {
		const best = count > ARRANGE_LIMIT ? spreadPattern(count, want) : bestPattern({ behind, count, fights: want, shared });
		if (best && keepsRules([...behind, ...best.map((fight) => (fight ? 'ambush' : 'wreck') as StopType)])) return best;
	}
	return new Array<boolean>(count).fill(false);
}

function bestPattern({ behind, count, fights, shared }: { behind: readonly StopType[]; count: number; fights: number; shared: boolean }): boolean[] | null {
	let best: boolean[] | null = null;
	let bestScore: number[] = [];
	const pattern = new Array<boolean>(count).fill(false);
	const tail = behind.map(isCalm);
	const visit = (at: number, left: number): void => {
		if (left > count - at) return;
		if (at === count) {
			if (left > 0) return;
			const calm = [...tail, ...pattern.map((fight) => !fight)];
			for (let index = 2; index < calm.length; index += 1) if (!calm[index] && !calm[index - 1] && !calm[index - 2]) return;
			let trailing = 0;
			for (let index = count - 1; index >= 0 && pattern[index]; index -= 1) trailing += 1;
			let spread = 0;
			let seen = 0;
			pattern.forEach((fight, index) => {
				if (!fight) return;
				spread += abs(index - ((seen + 0.5) * count / fights - 0.5));
				seen += 1;
			});
			const score = [shared && count > fights && pattern[count - 1] ? 1 : 0, trailing, spread];
			if (best === null || before(score, bestScore)) {
				best = [...pattern];
				bestScore = score;
			}
			return;
		}
		if (left > 0) {
			pattern[at] = true;
			visit(at + 1, left - 1);
			pattern[at] = false;
		}
		visit(at + 1, left);
	};
	visit(0, fights);
	return best;
}

/** Fights spread evenly through a long leg, the last stop calm. */
function spreadPattern(count: number, fights: number): boolean[] {
	const pattern = new Array<boolean>(count).fill(false);
	for (let fight = 0; fight < fights; fight += 1) pattern[floor(fight * count / fights)] = true;
	return pattern;
}

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
