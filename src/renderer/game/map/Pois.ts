import type { Rng } from '../core/Rng';
import { BIOMES } from './Biome';
import { Vector, unitVector } from './Geometry';
import type { MapParams } from './MapParams';
import { FACTIONS, Factions, POI_TUNING, PoiResource, PoiTuning, STRONGHOLD_TYPE, SiteCondition } from './PoiData';
import type { RoadNetwork } from './RoadNetwork';
import { Arrival, Leg, MeetingPoint, RouteTree, buildLegs, pointAlong } from './RouteTree';
import { SegmentIndex } from './SegmentIndex';
import type { Terrain } from './Terrain';

/**
 * Stage 7 of area map generation, POIs and strongholds (Area Map Generation,
 * 7. POIs and strongholds), on the `pois` stream: POIs go where two or three
 * ways home meet. Strongholds first, one per sector in the outer band, each
 * on the meeting point that best suits a faction not yet seated; then POIs
 * ring by ring, the best meeting points by geography first, kept a spacing
 * apart. A POI's type comes from where it lands, except that the first ring
 * is typed to yield food, water, and fuel first. Then the route tree is cut
 * into legs for the routes the POIs have.
 *
 * Each site is on a meeting point no POI has taken, so there's at most one POI
 * on a stretch and none on a place routes pass through (guarantee 4), and
 * meeting points already split in time (guarantee 5). Every decision is
 * plain arithmetic, sectors included (see Geometry). The decision record is
 * docs/AI_TECHNICAL_DECISIONS/route-tree-and-pois.md.
 */

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const round = Math.round;

/** Directions around a stronghold's site its faction fit samples, besides the site itself. */
const FIT_DIRECTIONS = 6;
/** An owner no segment has, so a nearest-highway query skips nothing. */
const NO_OWNER = -2;
/** Tiers until stage 8 works them out from hours: a POI's ring plus one, and a stronghold always this. */
const STRONGHOLD_TIER = 5;

/** What the stage reads from the land, and from the places how ruined it is: 1 in a ruin, fading to 0 at twice its radius. */
export type PoiGround = Pick<Terrain, 'radius' | 'metro' | 'biome' | 'elevation' | 'moisture'> & { ruin(x: number, y: number): number };

/** Where a POI stands: partway along a meeting stretch, or on a three-way point's node. */
export interface PoiSite {
	readonly x: number;
	readonly y: number;
	/** The stretch it's partway along; -1 at a node. */
	readonly stretch: number;
	/** World units along that stretch from its `from` node; 0 at a node. */
	readonly along: number;
	/** The node, for a three-way point; -1 partway along a stretch. */
	readonly node: number;
}

export interface Poi {
	readonly site: PoiSite;
	/** Its routes' arrivals, quickest first, ties to the lower node: two, or three at a three-way point. */
	readonly arrivals: readonly Arrival[];
	/** A key of the tuning's `types`, which sets its yields, or `STRONGHOLD_TYPE`. */
	readonly type: string;
	/** Its ring from the metro's edge out, a stronghold's by where it stands. */
	readonly ring: number;
	/** A stand-in until tiers (stage 8): the ring plus one, and 5 for a stronghold. */
	readonly tier: number;
}

export interface Stronghold {
	/** Its POI, an index into the layer's `pois`. */
	readonly poi: number;
	/** The faction it seats, a key of `FACTIONS`. No two strongholds on a map seat the same one. */
	readonly faction: string;
	/** Its sector, counterclockwise from the one that starts at `sectorRotation`. */
	readonly sector: number;
}

export interface RingCount {
	/** What the ring aimed for: its base target times poiDensity, rounded. */
	readonly target: number;
	readonly placed: number;
}

/** The stage's product: plain data, which crosses the worker boundary by structured clone. */
export interface PoiLayer {
	/** Strongholds first, by sector, then POIs in the order they were placed, best score first. */
	readonly pois: readonly Poi[];
	readonly strongholds: readonly Stronghold[];
	/** Degrees counterclockwise from east where sector 0 starts; each sector spans 360 / strongholds after it. */
	readonly sectorRotation: number;
	/** The route tree pruned to the POIs' routes, cut into legs; `routesTo` lists a POI's. */
	readonly legs: readonly Leg[];
	readonly rings: readonly RingCount[];
	/**
	 * Hard guarantees the layer misses: a sector with no stronghold
	 * (guarantee 6), or a resource the first ring doesn't yield (guarantee
	 * 7). Empty when it misses none. A strict stage fails on any.
	 */
	readonly failures: readonly string[];
}

export interface PoiOptions {
	readonly network: RoadNetwork;
	readonly tree: RouteTree;
	readonly ground: PoiGround;
	/** Validated. */
	readonly params: Pick<MapParams, 'strongholds' | 'poiDensity'>;
	/** The stage's stream; each part forks its own from it by name. */
	readonly rng: Rng;
	/** The shipped tuning when left out. */
	readonly tuning?: PoiTuning;
	readonly factions?: Factions;
}

/** Strongholds, then POIs, then the legs for their routes. */
export function placePois(options: PoiOptions): PoiLayer {
	return new PoiPlacer(options).place();
}

/** Which sector (x, y) is in: sectors start at their boundary and run counterclockwise to the next. */
export class Sectors {
	/** Each boundary after the first, as a pseudo-angle from the first. */
	private readonly bounds: Float64Array;
	private readonly startX: number;
	private readonly startY: number;

	constructor({ rotation, count }: { rotation: number; count: number }) {
		const direction: Vector = { x: 0, y: 0 };
		unitVector(rotation, direction);
		this.startX = direction.x;
		this.startY = direction.y;
		this.bounds = new Float64Array(count - 1);
		for (let sector = 1; sector < count; sector += 1) {
			unitVector(rotation + sector * 360 / count, direction);
			this.bounds[sector - 1] = this.angle(direction.x, direction.y);
		}
	}

	public sectorOf(x: number, y: number): number {
		const angle = this.angle(x, y);
		let sector = 0;
		while (sector < this.bounds.length && this.bounds[sector] <= angle) sector += 1;
		return sector;
	}

	/**
	 * A pseudo-angle in [0, 4) counterclockwise from the first boundary: the
	 * diamond angle of (x, y) turned into the boundary's frame, which grows
	 * with the true angle and needs only adds and divides.
	 */
	private angle(x: number, y: number): number {
		const along = this.startX * x + this.startY * y;
		const across = this.startX * y - this.startY * x;
		if (across >= 0) return along >= 0 ? across / (along + across) : 1 - along / (across - along);
		return along < 0 ? 2 - across / (-along - across) : 3 + along / (along - across);
	}
}

/**
 * The sectors' rotation: `drawn`, then stepped by a sector's width over
 * `steps`, up to `steps` times, until every sector holds a site. When none
 * does, the drawn rotation, and `every` is false.
 */
export function stepSectors({ drawn, count, steps, sites }: {
	drawn: number;
	count: number;
	steps: number;
	sites: readonly { readonly x: number; readonly y: number }[];
}): { rotation: number; sectors: Sectors; every: boolean } {
	for (let step = 0; step < steps; step += 1) {
		const rotation = drawn + step * 360 / count / steps;
		const sectors = new Sectors({ rotation, count });
		const held = new Uint8Array(count);
		for (const { x, y } of sites) held[sectors.sectorOf(x, y)] = 1;
		if (held.every((holds) => holds === 1)) return { rotation, sectors, every: true };
	}
	return { rotation: drawn, sectors: new Sectors({ rotation: drawn, count }), every: false };
}

/** A placed site before its arrivals have legs. A stronghold's type is set when it's seated, a POI's is '' until `typePois`. */
interface Placement {
	readonly candidate: number;
	readonly type: string;
	readonly ring: number;
	/** A stronghold's faction and sector; '' and -1 for a POI. */
	readonly faction: string;
	readonly sector: number;
}

/** One run of the stage; `place` runs it. */
class PoiPlacer {
	private readonly network: RoadNetwork;
	private readonly tree: RouteTree;
	private readonly ground: PoiGround;
	private readonly params: PoiOptions['params'];
	private readonly rng: Rng;
	private readonly tuning: PoiTuning;
	private readonly factions: Factions;
	private readonly radius: number;
	private readonly highways: SegmentIndex;

	/** Candidate sites: every `step` along each meeting stretch inside its margins, and each three-way point. */
	private count = 0;
	private siteX = new Float64Array(0);
	private siteY = new Float64Array(0);
	private siteAlong = new Float64Array(0);
	private sitePoint = new Int32Array(0);
	private siteScore = new Float64Array(0);
	private siteRadius = new Float64Array(0);

	private readonly usedStretch: Uint8Array;
	private readonly placedX: number[] = [];
	private readonly placedY: number[] = [];
	private readonly placements: Placement[] = [];
	private readonly failures: string[] = [];
	private readonly direction: Vector = { x: 0, y: 0 };

	constructor({ network, tree, ground, params, rng, tuning = POI_TUNING, factions = FACTIONS }: PoiOptions) {
		this.network = network;
		this.tree = tree;
		this.ground = ground;
		this.params = params;
		this.rng = rng;
		this.tuning = tuning;
		this.factions = factions;
		this.radius = ground.radius;
		this.usedStretch = new Uint8Array(network.stretches.length);
		if (Object.keys(factions).length < params.strongholds) {
			throw new RangeError(`placePois: ${params.strongholds} strongholds need as many factions, got ${Object.keys(factions).length}`);
		}
		this.highways = this.indexHighways();
		this.listCandidates();
	}

	public place(): PoiLayer {
		const sectorRotation = this.seatStrongholds();
		const rings = this.placeRings();
		const types = this.typePois();
		const destinations = this.placements.map(({ candidate }) => ({ arrivals: this.arrivalsAt(candidate) }));
		const { legs, lastLegs } = buildLegs({ network: this.network, tree: this.tree, destinations });
		const pois: Poi[] = this.placements.map(({ candidate, ring }, index) => {
			const point = this.tree.meetingPoints[this.sitePoint[candidate]];
			return {
				site: { x: this.siteX[candidate], y: this.siteY[candidate], stretch: point.stretch, along: this.siteAlong[candidate], node: point.node },
				arrivals: destinations[index].arrivals.map((arrival, place) => ({ ...arrival, leg: lastLegs[index][place] })),
				type: types[index],
				ring,
				tier: types[index] === STRONGHOLD_TYPE ? STRONGHOLD_TIER : ring + 1,
			};
		});
		const strongholds = this.placements
			.map(({ faction, sector }, poi) => ({ poi, faction, sector }))
			.filter((_seat, poi) => this.placements[poi].type === STRONGHOLD_TYPE);
		return { pois, strongholds, sectorRotation, legs, rings, failures: this.failures };
	}

	/** Every highway segment, for the score's and the placement rules' nearness tests. */
	private indexHighways(): SegmentIndex {
		const index = new SegmentIndex({ extent: this.radius * 1.25, cellSize: 64 });
		this.network.stretches.forEach(({ roadClass, points }, stretch) => {
			if (roadClass !== 'highway') return;
			for (let point = 0; point + 3 < points.length; point += 2) index.add(points[point], points[point + 1], points[point + 2], points[point + 3], stretch);
		});
		return index;
	}

	private highwayWithin(x: number, y: number, reach: number): boolean {
		return this.highways.nearest(x, y, reach, NO_OWNER) < reach;
	}

	/** Lists and scores the candidate sites, one draw each from the `sites` fork in the order they're listed. */
	private listCandidates(): void {
		const { meetingPoints, lengths } = this.tree;
		const { step, margin, marginShare } = this.tuning.sites;
		let total = 0;
		const steps = (stretch: number) => floor((lengths[stretch] - 2 * edgeMargin(lengths[stretch], margin, marginShare)) / step);
		for (const { stretch } of meetingPoints) total += stretch < 0 ? 1 : steps(stretch) + 1;
		this.siteX = new Float64Array(total);
		this.siteY = new Float64Array(total);
		this.siteAlong = new Float64Array(total);
		this.sitePoint = new Int32Array(total);
		this.siteScore = new Float64Array(total);
		this.siteRadius = new Float64Array(total);
		const stream = this.rng.fork('sites');
		const { noise, ruin, highway, highwayWithin, threeWay } = this.tuning.score;
		meetingPoints.forEach((point, index) => {
			if (point.stretch < 0) {
				const { x, y } = this.network.nodes[point.node];
				this.addCandidate(index, x, y, 0, threeWay);
				return;
			}
			const keep = edgeMargin(lengths[point.stretch], margin, marginShare);
			const points = this.network.stretches[point.stretch].points;
			for (let place = 0; place <= steps(point.stretch); place += 1) {
				const along = keep + place * step;
				pointAlong(points, along, this.direction);
				this.addCandidate(index, this.direction.x, this.direction.y, along, 0);
			}
		});
		for (let candidate = 0; candidate < this.count; candidate += 1) {
			const x = this.siteX[candidate];
			const y = this.siteY[candidate];
			this.siteScore[candidate] += noise * stream.float() + ruin * this.ground.ruin(x, y) + (this.highwayWithin(x, y, highwayWithin) ? highway : 0);
		}
	}

	private addCandidate(point: number, x: number, y: number, along: number, bonus: number): void {
		const candidate = this.count;
		this.count += 1;
		this.siteX[candidate] = x;
		this.siteY[candidate] = y;
		this.siteAlong[candidate] = along;
		this.sitePoint[candidate] = point;
		this.siteScore[candidate] = bonus;
		this.siteRadius[candidate] = sqrt(x * x + y * y);
	}

	/**
	 * The sectors' rotation, drawn, then stepped by a share of a sector until
	 * every sector holds a meeting point in the outer band; then one
	 * stronghold a sector, on the free site whose best untaken faction fits it
	 * best. A sector left without one is a failure. Returns the rotation.
	 */
	private seatStrongholds(): number {
		const count = this.params.strongholds;
		const { band, rotationSteps, fitJitter } = this.tuning.strongholds;
		const drawn = this.rng.fork('sectors').float() * 360 / count;
		const inner = band.inner * this.radius;
		const outer = band.outer * this.radius;
		const inBand: number[] = [];
		for (let candidate = 0; candidate < this.count; candidate += 1) {
			if (this.siteRadius[candidate] >= inner && this.siteRadius[candidate] <= outer) inBand.push(candidate);
		}
		const sites = inBand.map((candidate) => ({ x: this.siteX[candidate], y: this.siteY[candidate] }));
		const { rotation, sectors } = stepSectors({ drawn, count, steps: rotationSteps, sites });

		const names = Object.keys(this.factions);
		const jitterStream = this.rng.fork('factions');
		const jitter = names.map(() => jitterStream.float() * fitJitter);
		const taken = new Uint8Array(names.length);
		// Every site is in one sector, so each one's land is sampled once, into the one scratch array.
		const land = new Float64Array(BIOMES.length + 2);
		for (let sector = 0; sector < count; sector += 1) {
			let best = -1;
			let bestFit = -Infinity;
			let bestFaction = -1;
			for (const candidate of inBand) {
				const x = this.siteX[candidate];
				const y = this.siteY[candidate];
				if (sectors.sectorOf(x, y) !== sector || !this.free(candidate, true)) continue;
				const { fit, faction } = this.bestFaction(this.landAround(x, y, land), jitter, taken);
				if (fit > bestFit || (fit === bestFit && this.siteScore[candidate] > this.siteScore[best])) {
					best = candidate;
					bestFit = fit;
					bestFaction = faction;
				}
			}
			if (best < 0) {
				this.failures.push(`sector ${sector} has no free meeting point in the outer band`);
				continue;
			}
			taken[bestFaction] = 1;
			this.take(best, { type: STRONGHOLD_TYPE, ring: this.ringOf(this.siteRadius[best]), faction: names[bestFaction], sector });
		}
		return rotation;
	}

	/** Biome counts and ruin around a site, into `land`: the site and `FIT_DIRECTIONS` points `fitRadius` from it, those inside the disc. The last two entries are the ruin sum and the samples. */
	private landAround(x: number, y: number, land: Float64Array): Float64Array {
		land.fill(0);
		const reach = this.tuning.strongholds.fitRadius;
		for (let index = -1; index < FIT_DIRECTIONS; index += 1) {
			if (index >= 0) unitVector(index * 360 / FIT_DIRECTIONS, this.direction);
			const px = index < 0 ? x : x + this.direction.x * reach;
			const py = index < 0 ? y : y + this.direction.y * reach;
			if (px * px + py * py > this.radius * this.radius) continue;
			land[BIOMES.indexOf(this.ground.biome(px, py))] += 1;
			land[BIOMES.length] += this.ground.ruin(px, py);
			land[BIOMES.length + 1] += 1;
		}
		return land;
	}

	/** The untaken faction the land suits best, with its fit plus the faction's jitter; the earlier faction on a tie. */
	private bestFaction(land: Float64Array, jitter: readonly number[], taken: Uint8Array): { fit: number; faction: number } {
		const samples = land[BIOMES.length + 1];
		let fit = -Infinity;
		let faction = -1;
		Object.values(this.factions).forEach(({ terrain: wants }, index) => {
			if (taken[index] === 1) return;
			let score = wants.ruin * land[BIOMES.length];
			BIOMES.forEach((biome, place) => {
				score += (wants.biomes[biome] ?? 0) * land[place];
			});
			score = (samples > 0 ? score / samples : 0) + jitter[index];
			if (score > fit) {
				fit = score;
				faction = index;
			}
		});
		return { fit, faction };
	}

	/**
	 * POIs by ring, from the metro's edge out to the rings' outer share: the
	 * best scored free sites first, each into its ring while the ring is
	 * under its target times poiDensity. Returns each ring's count.
	 */
	private placeRings(): RingCount[] {
		const { targets } = this.tuning.rings;
		const aims = targets.map((base) => round(base * this.params.poiDensity));
		const placed = aims.map(() => 0);
		const order = Array.from({ length: this.count }, (_, candidate) => candidate);
		order.sort((a, b) => this.siteScore[b] - this.siteScore[a] || a - b);
		const start = this.ground.metro.radius;
		const end = this.tuning.rings.outer * this.radius;
		for (const candidate of order) {
			const distance = this.siteRadius[candidate];
			if (distance < start || distance > end) continue;
			const ring = this.ringOf(distance);
			if (placed[ring] >= aims[ring] || !this.free(candidate, false)) continue;
			placed[ring] += 1;
			this.take(candidate, { type: '', ring, faction: '', sector: -1 });
		}
		return aims.map((target, ring) => ({ target, placed: placed[ring] }));
	}

	private ringOf(distance: number): number {
		const rings = this.tuning.rings.targets.length;
		const start = this.ground.metro.radius;
		const span = this.tuning.rings.outer * this.radius - start;
		const ring = floor((distance - start) / span * rings);
		return ring < 0 ? 0 : ring >= rings ? rings - 1 : ring;
	}

	/**
	 * Whether a candidate's meeting point is untaken and it keeps the sites'
	 * spacing from everything placed; a stronghold keeps the strongholds'
	 * spacing from other strongholds too, where that's wider.
	 */
	private free(candidate: number, stronghold: boolean): boolean {
		const point = this.tree.meetingPoints[this.sitePoint[candidate]];
		for (const stretch of point.via) if (this.usedStretch[stretch] === 1) return false;
		const spacing = this.tuning.sites.spacing * this.radius;
		const strongholdSpacing = this.tuning.strongholds.spacing * this.radius;
		const wider = strongholdSpacing > spacing ? strongholdSpacing : spacing;
		const x = this.siteX[candidate];
		const y = this.siteY[candidate];
		for (let index = 0; index < this.placedX.length; index += 1) {
			const dx = x - this.placedX[index];
			const dy = y - this.placedY[index];
			const apart = stronghold && this.placements[index].type === STRONGHOLD_TYPE ? wider : spacing;
			if (dx * dx + dy * dy < apart * apart) return false;
		}
		return true;
	}

	private take(candidate: number, placement: Omit<Placement, 'candidate'>): void {
		for (const stretch of this.tree.meetingPoints[this.sitePoint[candidate]].via) this.usedStretch[stretch] = 1;
		this.placedX.push(this.siteX[candidate]);
		this.placedY.push(this.siteY[candidate]);
		this.placements.push({ candidate, ...placement });
	}

	/**
	 * Each placement's type: a stronghold's own, then the first ring's POIs,
	 * quickest first, typed to yield the cover resources before location
	 * types them, and every other POI by location. One draw per POI from the
	 * `types` fork, in placement order, whether it's used or not.
	 */
	private typePois(): string[] {
		const stream = this.rng.fork('types');
		const draws = this.placements.map(() => stream.float());
		const types = this.placements.map(({ candidate, type }, index) => type || this.typeAt(this.siteX[candidate], this.siteY[candidate], draws[index]));
		const needed = new Set<PoiResource>(this.tuning.cover);
		const first = this.placements
			.map((placement, index) => ({ placement, index, hours: this.quickest(placement.candidate) }))
			.filter(({ placement }) => placement.type === '' && placement.ring === 0)
			.sort((a, b) => a.hours - b.hours || a.index - b.index);
		for (const { placement, index } of first) {
			if (needed.size === 0) break;
			const type = this.coverType(types[index], placement.candidate, needed);
			types[index] = type;
			for (const resource of Object.keys(this.tuning.types[type].yields) as PoiResource[]) needed.delete(resource);
		}
		if (needed.size > 0) this.failures.push(`the first ring's POIs yield no ${[...needed].join(', ')}`);
		return types;
	}

	/**
	 * A type for a first-ring POI that yields something still needed: its
	 * location's if that does, or else the one yielding the most needed
	 * resources, preferring types whose placement rule holds here, then the
	 * placement rules' order.
	 */
	private coverType(located: string, candidate: number, needed: ReadonlySet<PoiResource>): string {
		const covers = (type: string) => Object.keys(this.tuning.types[type].yields).filter((resource) => needed.has(resource as PoiResource)).length;
		if (covers(located) > 0) return located;
		const x = this.siteX[candidate];
		const y = this.siteY[candidate];
		let best = located;
		let bestCovers = 0;
		let bestHolds = false;
		for (const rule of this.tuning.placement) {
			const holds = rule.where.some((condition) => this.holds(condition, x, y));
			for (const type of rule.types) {
				const count = covers(type);
				if (count > bestCovers || (count === bestCovers && count > 0 && holds && !bestHolds)) {
					best = type;
					bestCovers = count;
					bestHolds = holds;
				}
			}
		}
		return best;
	}

	/** The type a POI at (x, y) is: the first placement rule that holds there, one of its types picked by `draw`. */
	private typeAt(x: number, y: number, draw: number): string {
		for (const rule of this.tuning.placement) {
			if (rule.where.some((condition) => this.holds(condition, x, y))) return rule.types[floor(draw * rule.types.length)];
		}
		throw new Error('placePois: the last placement rule holds everywhere');
	}

	private holds(condition: SiteCondition, x: number, y: number): boolean {
		const ground = this.ground;
		if (condition.ruinAtLeast !== undefined && ground.ruin(x, y) < condition.ruinAtLeast) return false;
		if (condition.elevationBelow !== undefined && !(ground.elevation(x, y) < condition.elevationBelow)) return false;
		if (condition.moistureAtLeast !== undefined && ground.moisture(x, y) < condition.moistureAtLeast) return false;
		if (condition.biomes !== undefined && !condition.biomes.includes(ground.biome(x, y))) return false;
		if (condition.highwayWithin !== undefined && !this.highwayWithin(x, y, condition.highwayWithin)) return false;
		return true;
	}

	/** A candidate's arrivals, quickest first, ties to the lower node. */
	private arrivalsAt(candidate: number): Omit<Arrival, 'leg'>[] {
		const point: MeetingPoint = this.tree.meetingPoints[this.sitePoint[candidate]];
		const { hours, lengths, stretchHours } = this.tree;
		const arrivals = point.from.map((from, index) => {
			const stretch = point.via[index];
			if (point.stretch < 0) return { from, stretch, length: lengths[stretch], hours: hours[from] + stretchHours[stretch] };
			const along = this.siteAlong[candidate];
			const length = this.network.stretches[stretch].from === from ? along : lengths[stretch] - along;
			return { from, stretch, length, hours: hours[from] + stretchHours[stretch] * (length / lengths[stretch]) };
		});
		return arrivals.sort((a, b) => a.hours - b.hours || a.from - b.from);
	}

	private quickest(candidate: number): number {
		return this.arrivalsAt(candidate)[0].hours;
	}
}

/** World units a site keeps from either end of a stretch this long. */
function edgeMargin(length: number, margin: number, share: number): number {
	const scaled = share * length;
	return margin < scaled ? margin : scaled;
}
