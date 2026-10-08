import type { Rng } from '../core/Rng';
import { BIOMES, Biome } from './Biome';
import { Vector, chaikin, pointSegmentDistanceSquared, unitVector } from './Geometry';
import type { MapParams } from './MapParams';
import { FACTIONS, Factions, POI_TUNING, PoiTuning, SiteCondition, lengthOf } from './PoiData';
import {
	APPROACH_FLOOR_TOLERANCE, CANDIDATE_HEADINGS, GrowthTerrain, JUNCTION_COS, ROAD_CLASS_RULES, STEP_LENGTH, StepRules, candidateTurns, isPassable,
	trailThreshold, turnScale,
} from './RoadGrowth';
import { ROAD_CLASSES, Road, RoadClass, RoadNetwork, RoadNode, RoadStretch } from './RoadNetwork';
import type { Terrain } from './Terrain';

/**
 * Stage 5 of area map generation (Area Map Generation, Pipeline, 5. POIs and
 * their approaches): strongholds first, one per sector in the outer band,
 * each where the land best suits a faction not yet seated; then POIs, darts
 * thrown ring by ring, more of them kept near ruins. A site is kept only if
 * approach roads can reach it from at least two groups of attach points,
 * points on the grown roads whose paths to the compound meet only inside the
 * home area, so its routes are real choices (guarantee 5). Approaches grow by
 * growth's step rules, steered at their site, and end there, so every POI is
 * a dead end (guarantee 4). A POI's type comes from where it lands.
 *
 * Every decision is plain arithmetic, as growth's are (see Geometry), and
 * every number is tuning from `data/pois.json` and `data/factions.json`. The
 * rules and their measurements are in
 * docs/AI_TECHNICAL_DECISIONS/pois-and-strongholds.md.
 */

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const round = Math.round;
const INFINITY = Infinity;

/** An owner no road has, for distance queries that skip nothing. */
const NO_ROAD = -2;
/** Directions around a stronghold's site its terrain fit samples, besides the site itself. */
const FIT_DIRECTIONS = 6;

/** What stage 5 reads from the terrain. */
export type PoiTerrain = GrowthTerrain & Pick<Terrain, 'biome' | 'ruin' | 'elevation' | 'moisture'>;

/** A faction's seat, at the end of its approaches in the outer band. */
export interface Stronghold {
	/** Its node in the network, a `poi`. */
	readonly node: number;
	/** The faction it seats, a key of `FACTIONS`. No two strongholds on a map seat the same one. */
	readonly faction: string;
	/** Its sector, counterclockwise from the first, which starts at the map's sector rotation. */
	readonly sector: number;
	/** Its approaches' road ids, in the order they were grown, cheapest first. */
	readonly approaches: readonly number[];
}

export interface Poi {
	/** Its node in the network, a `poi`. */
	readonly node: number;
	/** A key of the tuning's `types`, which sets its yields. */
	readonly type: string;
	/** Its ring, from the metro's edge out. */
	readonly ring: number;
	/** Its approaches' road ids, in the order they were grown, cheapest first. */
	readonly approaches: readonly number[];
}

/** Stage 5's output, plain data a save can hold. */
export interface PoiMap {
	/**
	 * Growth's network with the approaches added. A stretch an approach
	 * leaves is split there at a new junction: its inner part keeps its id
	 * and the rest are new stretches at the end, so each stretch still leads
	 * on from its parent. An approach is a road of one stretch, from that
	 * junction (or the dead end it carries on) to its POI's node, its parent
	 * the stretch it leaves, so a route walks parents to the compound.
	 */
	readonly network: RoadNetwork;
	readonly strongholds: readonly Stronghold[];
	readonly pois: readonly Poi[];
	/**
	 * World units of road from the compound: the home area. Two routes to a
	 * POI share no road past it, so tier 1 (stage 6) has to cover it for
	 * guarantee 5 to hold.
	 */
	readonly homeReach: number;
}

/** What happened during stage 5, for the Map Lab's readout and for tuning; not part of the map. */
export interface PoiStats {
	/** Stronghold sites drawn, open (clear of roads and other sites), with two groups in reach, and tried, over the sectors tried. */
	strongholds: { sites: number; open: number; reachable: number; tried: number };
	/** Darts thrown, kept by the ruin draw, open, and with two groups in reach, so tried; then POIs placed and aimed for, per ring. */
	pois: { darts: number; kept: number; open: number; reachable: number; placed: number[]; targets: number[] };
	/**
	 * Approaches kept, and dead ends carried on among them, and how many smoothed; then approaches given
	 * up on: grown for a site that didn't get two, not tried since another road stood in the straight
	 * line, and stalled, by where: a dead end turned too far for its turn limit, the first step
	 * blocked, no step on the way, or past the detour.
	 */
	approaches: {
		grown: number; extensions: number; smoothed: number; dropped: number; unsighted: number;
		stalled: { turn: number; start: number; way: number; detour: number };
	};
}

export type PoiOutcome =
	| { readonly placed: true; readonly map: PoiMap; readonly stats: PoiStats }
	/** A sector couldn't seat its stronghold, which fails the stage. */
	| { readonly placed: false; readonly sector: number; readonly stats: PoiStats };

export interface PoiOptions {
	terrain: PoiTerrain;
	/** Validated. */
	params: MapParams;
	/** Growth's network, from `growRoads`. */
	network: RoadNetwork;
	/** The stage's stream, root.fork('map', mapAttempt).fork('pois', stageAttempt). Each part forks its own from it. */
	rng: Rng;
	/** The shipped tuning when left out. */
	tuning?: PoiTuning;
	factions?: Factions;
}

/** Stage 5: strongholds, POIs, and their approaches over growth's network, on the `pois` stream. */
export function placePois(options: PoiOptions): PoiOutcome {
	return new PoiPlacer(options).place();
}

/** Where an approach leaves a grown road, chosen for a site. */
interface Attachment {
	/** Its attach point. */
	readonly attach: number;
	/** The approach's road id and polyline, from the attach point to the site. */
	readonly road: number;
	readonly roadClass: RoadClass;
	readonly points: readonly number[];
	/** Its segments' ids in the rules' index. */
	readonly segments: readonly number[];
}

/** Where an approach splits a stretch: the junction's node, and the stretch that now ends there. */
interface Cut {
	readonly node: number;
	readonly inner: number;
}

/** A site with its approaches, before the network is rebuilt round them. */
interface Site {
	readonly x: number;
	readonly y: number;
	readonly approaches: readonly Attachment[];
}

/** One run of stage 5; `place` runs it. */
class PoiPlacer {
	private readonly terrain: PoiTerrain;
	private readonly params: MapParams;
	private readonly network: RoadNetwork;
	private readonly rng: Rng;
	private readonly tuning: PoiTuning;
	private readonly factions: Factions;
	private readonly rules: StepRules;
	private readonly radius: number;
	private readonly clearance: number;
	private readonly reach: number;
	private readonly strongholdReach: number;
	private readonly spacing: number;
	private readonly homeReach: number;
	private readonly trailCost: number;

	/** Attach points: every vertex inside a stretch, clear of its ends, and every dead end's tip. */
	private attachCount = 0;
	private attachX = new Float64Array(0);
	private attachY = new Float64Array(0);
	private attachStretch = new Int32Array(0);
	private attachVertex = new Int32Array(0);
	/** Its group: the first stretch on its path from the compound that runs past the home area, or its own stretch if none does. */
	private attachKey = new Int32Array(0);
	private attachTip = new Uint8Array(0);
	/** Unit directions of the road coming into the point and going on from it; the same at a tip. */
	private attachIn = new Float64Array(0);
	private attachOn = new Float64Array(0);
	/** A grid over the disc, cells `reach` across, listing attach points. */
	private gridColumns = 0;
	private gridHeads = new Int32Array(0);
	private gridNext = new Int32Array(0);

	/** Per class, the cosine and sine of each candidate heading's turn, and the cosine of the turn limit. */
	private readonly turns: { readonly [Name in RoadClass]: Float64Array };
	private readonly turnCos: { readonly [Name in RoadClass]: number };
	private readonly fitDirections: Vector[] = [];
	private readonly direction: Vector = { x: 0, y: 0 };

	/** The groups in reach of the site `gather` last looked at: each group's attach points, cheapest first, groups by their cheapest. */
	private groups: number[][] = [];
	private readonly sites: Site[] = [];
	private readonly placedX: number[] = [];
	private readonly placedY: number[] = [];
	private approachDraws = 0;
	private readonly stats: PoiStats;

	constructor({ terrain, params, network, rng, tuning = POI_TUNING, factions = FACTIONS }: PoiOptions) {
		this.terrain = terrain;
		this.params = params;
		this.network = network;
		this.rng = rng;
		this.tuning = tuning;
		this.factions = factions;
		this.radius = terrain.radius;
		this.clearance = params.roadClearance;
		this.reach = lengthOf(tuning.approaches.reach, terrain.radius, params.roadClearance);
		this.strongholdReach = lengthOf(tuning.strongholds.reach, terrain.radius, params.roadClearance);
		this.spacing = lengthOf(tuning.sites.spacing, terrain.radius, params.roadClearance);
		this.homeReach = terrain.metro.radius + tuning.approaches.home * terrain.radius;
		this.trailCost = trailThreshold(params.trailShare);
		this.rules = StepRules.fromNetwork({ network, terrain, clearance: params.roadClearance });
		const turns = {} as { [Name in RoadClass]: Float64Array };
		const turnCos = {} as { [Name in RoadClass]: number };
		for (const roadClass of ROAD_CLASSES) {
			const table = new Float64Array(2 * CANDIDATE_HEADINGS);
			candidateTurns(roadClass, params.curviness).forEach((turn, candidate) => {
				unitVector(turn, this.direction);
				table[2 * candidate] = this.direction.x;
				table[2 * candidate + 1] = this.direction.y;
			});
			turns[roadClass] = table;
			turnCos[roadClass] = unitVector(ROAD_CLASS_RULES[roadClass].turnLimit * turnScale(params.curviness), this.direction).x;
		}
		this.turns = turns;
		this.turnCos = turnCos;
		for (let index = 0; index < FIT_DIRECTIONS; index += 1) this.fitDirections.push(unitVector(index * 360 / FIT_DIRECTIONS, { x: 0, y: 0 }));
		this.stats = {
			strongholds: { sites: 0, open: 0, reachable: 0, tried: 0 },
			pois: { darts: 0, kept: 0, open: 0, reachable: 0, placed: [], targets: [] },
			approaches: { grown: 0, extensions: 0, smoothed: 0, dropped: 0, unsighted: 0, stalled: { turn: 0, start: 0, way: 0, detour: 0 } },
		};
		this.indexAttachPoints();
	}

	public place(): PoiOutcome {
		const seats: { site: number; faction: string; sector: number }[] = [];
		const failed = this.placeStrongholds(seats);
		if (failed >= 0) return { placed: false, sector: failed, stats: this.stats };
		const placed: { site: number; type: string; ring: number }[] = [];
		this.placeRings(placed);
		return { placed: true, map: this.build(seats, placed), stats: this.stats };
	}

	/**
	 * One stronghold per sector, sectors evenly spaced from a random rotation.
	 * Each sector draws its sites in the outer band, keeps those on open
	 * ground with two groups in reach, and tries them best fit first; a site
	 * seats the faction not yet placed whose terrain it suits best. Returns
	 * the first sector that can't seat one, or -1.
	 */
	private placeStrongholds(seats: { site: number; faction: string; sector: number }[]): number {
		const count = this.params.strongholds;
		const { band, candidates } = this.tuning.strongholds;
		const width = 360 / count;
		const rotation = this.rng.fork('sectors').float() * width;
		const names = Object.keys(this.factions);
		const jitterStream = this.rng.fork('factions');
		const jitter = names.map(() => jitterStream.float() * this.tuning.strongholds.fitJitter);
		const taken = new Uint8Array(names.length);
		const inner = band.inner * this.radius;
		const outer = band.outer * this.radius;
		for (let sector = 0; sector < count; sector += 1) {
			const stream = this.rng.fork('stronghold', sector);
			const options: { x: number; y: number; fit: number; faction: number; draw: number }[] = [];
			for (let candidate = 0; candidate < candidates; candidate += 1) {
				unitVector(rotation + (sector + stream.float()) * width, this.direction);
				const distance = sqrt(inner * inner + stream.float() * (outer * outer - inner * inner));
				const x = this.direction.x * distance;
				const y = this.direction.y * distance;
				this.stats.strongholds.sites += 1;
				if (!this.open(x, y)) continue;
				this.stats.strongholds.open += 1;
				if (this.gather(x, y, this.strongholdReach) < 2) continue;
				this.stats.strongholds.reachable += 1;
				const { fit, faction } = this.bestFaction(x, y, jitter, taken);
				options.push({ x, y, fit, faction, draw: candidate });
			}
			options.sort((a, b) => b.fit - a.fit || a.draw - b.draw);
			let seated = false;
			for (const option of options) {
				this.stats.strongholds.tried += 1;
				this.gather(option.x, option.y, this.strongholdReach);
				const site = this.approach(option.x, option.y);
				if (site < 0) continue;
				taken[option.faction] = 1;
				seats.push({ site, faction: names[option.faction], sector });
				seated = true;
				break;
			}
			if (!seated) return sector;
		}
		return -1;
	}

	/** The untaken faction whose terrain the site suits best, with its fit plus the faction's jitter. */
	private bestFaction(x: number, y: number, jitter: readonly number[], taken: Uint8Array): { fit: number; faction: number } {
		const terrain = this.terrain;
		const reach = this.tuning.strongholds.fitRadius;
		const counts = new Float64Array(BIOMES.length);
		let ruin = 0;
		let samples = 0;
		for (let index = -1; index < FIT_DIRECTIONS; index += 1) {
			const px = index < 0 ? x : x + this.fitDirections[index].x * reach;
			const py = index < 0 ? y : y + this.fitDirections[index].y * reach;
			if (px * px + py * py > this.radius * this.radius) continue;
			counts[BIOMES.indexOf(terrain.biome(px, py))] += 1;
			ruin += terrain.ruin(px, py);
			samples += 1;
		}
		let best = -INFINITY;
		let faction = -1;
		Object.values(this.factions).forEach(({ terrain: wants }, index) => {
			if (taken[index] === 1) return;
			let fit = wants.ruin * ruin;
			BIOMES.forEach((biome: Biome, place) => {
				fit += (wants.biomes[biome] ?? 0) * counts[place];
			});
			fit = fit / samples + jitter[index];
			if (fit > best) {
				best = fit;
				faction = index;
			}
		});
		return { fit: best, faction };
	}

	/**
	 * POIs ring by ring, from the metro's edge out, each ring aiming for its
	 * target times poiDensity. Darts land evenly over a ring and are kept
	 * more often near ruins; one on open ground with two groups in reach is
	 * tried, and placed if it gets its approaches.
	 */
	private placeRings(placed: { site: number; type: string; ring: number }[]): void {
		const { outer, targets } = this.tuning.rings;
		const { ruinFloor, darts } = this.tuning.sites;
		const start = this.terrain.metro.radius;
		const span = outer * this.radius - start;
		const typeStream = this.rng.fork('types');
		targets.forEach((base, ring) => {
			const target = round(base * this.params.poiDensity);
			const inner = start + span * ring / targets.length;
			const outerEdge = start + span * (ring + 1) / targets.length;
			const stream = this.rng.fork('ring', ring);
			let count = 0;
			for (let dart = 0; dart < target * darts && count < target; dart += 1) {
				unitVector(stream.float() * 360, this.direction);
				const distance = sqrt(inner * inner + stream.float() * (outerEdge * outerEdge - inner * inner));
				const keep = stream.float();
				const x = this.direction.x * distance;
				const y = this.direction.y * distance;
				this.stats.pois.darts += 1;
				if (keep >= ruinFloor + (1 - ruinFloor) * this.terrain.ruin(x, y)) continue;
				this.stats.pois.kept += 1;
				if (!this.open(x, y)) continue;
				this.stats.pois.open += 1;
				if (this.gather(x, y, this.reach) < 2) continue;
				this.stats.pois.reachable += 1;
				const site = this.approach(x, y);
				if (site < 0) continue;
				placed.push({ site, type: this.typeAt(x, y, typeStream.float()), ring });
				count += 1;
			}
			this.stats.pois.placed.push(count);
			this.stats.pois.targets.push(target);
		});
	}

	/** Inside the disc, on passable ground, `spacing` from every site placed, and `roadClearance` from every road. */
	private open(x: number, y: number): boolean {
		if (x * x + y * y > this.radius * this.radius || this.terrain.impassable(x, y)) return false;
		const spacingSquared = this.spacing * this.spacing;
		for (let index = 0; index < this.placedX.length; index += 1) {
			const dx = x - this.placedX[index];
			const dy = y - this.placedY[index];
			if (dx * dx + dy * dy < spacingSquared) return false;
		}
		return this.rules.index.nearest(x, y, this.clearance, NO_ROAD) >= this.clearance;
	}

	/**
	 * Grows approaches to the site from the groups `gather` found, cheapest
	 * group first. In each, its attach points are looked at cheapest first,
	 * up to `sightChecks` of them: one whose straight line to the site keeps
	 * clear of other roads is grown from, up to `triesPerGroup` of them,
	 * until one grows. Stops at routesTarget approaches, or when too few
	 * groups are left to make two. With two or more, the site is placed and
	 * its index returned; otherwise nothing is kept and it's -1.
	 */
	private approach(x: number, y: number): number {
		const groups = this.groups;
		const goal = this.sites.length;
		const firstRoad = this.network.roads.length + this.sites.reduce((sum, site) => sum + site.approaches.length, 0);
		const { sightChecks, triesPerGroup } = this.tuning.approaches;
		const grown: Attachment[] = [];
		for (let group = 0; group < groups.length && grown.length < this.params.routesTarget; group += 1) {
			if (grown.length + groups.length - group < 2) break;
			const attaches = groups[group];
			const road = firstRoad + grown.length;
			let tries = 0;
			for (let look = 0; look < attaches.length && look < sightChecks && tries < triesPerGroup; look += 1) {
				const attach = attaches[look];
				this.register(attach, road, goal, x, y);
				if (this.rules.blocker(road, this.attachX[attach], this.attachY[attach], x, y) !== 'none') {
					this.stats.approaches.unsighted += 1;
					continue;
				}
				tries += 1;
				const attachment = this.grow(attach, x, y, road);
				if (attachment === null) continue;
				grown.push(attachment);
				break;
			}
		}
		if (grown.length < 2) {
			for (const { segments } of grown) segments.forEach((segment) => this.rules.index.retire(segment));
			this.stats.approaches.dropped += grown.length;
			return -1;
		}
		for (const { attach } of grown) {
			this.stats.approaches.grown += 1;
			if (this.attachTip[attach] === 1) this.stats.approaches.extensions += 1;
		}
		this.sites.push({ x, y, approaches: grown });
		this.placedX.push(x);
		this.placedY.push(y);
		return this.sites.length - 1;
	}

	/**
	 * An approach from attach point `attach` to (px, py) as road `road`, or
	 * null. Its class is a trail where it leaves a trail or its straight line
	 * runs over ground that would degrade a back road, else a back road. Its
	 * first step runs straight at the site, then each step proposes headings
	 * across the class's turn limit, scored by the terrain, by how far they
	 * stray from the way to the site, and by noise, and takes the best that
	 * keeps the rules (see `keeps`). Once within `arrival` steps it runs
	 * straight in if its turn limit allows. Smoothed like growth's stretches,
	 * and kept only if that keeps the rules.
	 */
	private grow(attach: number, px: number, py: number, road: number): Attachment | null {
		const jx = this.attachX[attach];
		const jy = this.attachY[attach];
		const stretch = this.network.stretches[this.attachStretch[attach]];
		const roadClass = this.approachClass(stretch.roadClass, jx, jy, px, py);
		const tip = this.attachTip[attach] === 1;
		const toX = px - jx;
		const toY = py - jy;
		const straight = sqrt(toX * toX + toY * toY);
		// A dead end carries on within its turn limit.
		if (tip && (toX * this.attachIn[2 * attach] + toY * this.attachIn[2 * attach + 1]) < this.turnCos[roadClass] * straight) {
			this.stats.approaches.stalled.turn += 1;
			return null;
		}
		const floorSquared = (jx * jx + jy * jy) * (1 - APPROACH_FLOOR_TOLERANCE);
		const { detour, arrival, steer } = this.tuning.approaches;
		const rng = this.rng.fork('approach', this.approachDraws);
		this.approachDraws += 1;
		const turns = this.turns[roadClass];
		const turnCos = this.turnCos[roadClass];
		const points = [jx, jy];
		let x = jx;
		let y = jy;
		let headingX = toX / straight;
		let headingY = toY / straight;
		let length = 0;
		for (let first = true; length <= detour * straight; first = false) {
			const restX = px - x;
			const restY = py - y;
			const rest = sqrt(restX * restX + restY * restY);
			if (rest <= arrival * STEP_LENGTH && (first || restX * headingX + restY * headingY >= turnCos * rest)
				&& this.keeps(road, x, y, px, py, px, py, floorSquared)) {
				points.push(px, py);
				return this.finish(attach, road, roadClass, points, px, py, floorSquared);
			}
			let bestScore = INFINITY;
			let bestX = 0;
			let bestY = 0;
			const options = first ? 1 : CANDIDATE_HEADINGS;
			const scores: { score: number; dx: number; dy: number; candidate: number }[] = [];
			for (let candidate = 0; candidate < options; candidate += 1) {
				const noise = first ? 0 : rng.float();
				const cos = first ? 1 : turns[2 * candidate];
				const sin = first ? 0 : turns[2 * candidate + 1];
				const dx = headingX * cos - headingY * sin;
				const dy = headingX * sin + headingY * cos;
				const endX = x + STEP_LENGTH * dx;
				const endY = y + STEP_LENGTH * dy;
				const cost = this.terrain.travelCost(endX, endY);
				if (cost === INFINITY) continue;
				const aheadX = x + steer.lookaheadSteps * STEP_LENGTH * dx;
				const aheadY = y + steer.lookaheadSteps * STEP_LENGTH * dy;
				const ahead = aheadX * aheadX + aheadY * aheadY > this.radius * this.radius ? 1 : this.terrain.travelCost(aheadX, aheadY);
				const stray = 1 - (dx * restX + dy * restY) / rest;
				const score = steer.cost * cost + steer.lookahead * (ahead === INFINITY ? 2 * this.trailCost : ahead) + steer.homing * stray + steer.noise * noise;
				scores.push({ score, dx, dy, candidate });
			}
			scores.sort((a, b) => a.score - b.score || a.candidate - b.candidate);
			for (const option of scores) {
				const endX = x + STEP_LENGTH * option.dx;
				const endY = y + STEP_LENGTH * option.dy;
				if (!this.keeps(road, x, y, endX, endY, px, py, floorSquared)) continue;
				bestScore = option.score;
				bestX = option.dx;
				bestY = option.dy;
				break;
			}
			if (bestScore === INFINITY) {
				if (first) this.stats.approaches.stalled.start += 1;
				else this.stats.approaches.stalled.way += 1;
				return null;
			}
			x += STEP_LENGTH * bestX;
			y += STEP_LENGTH * bestY;
			points.push(x, y);
			headingX = bestX;
			headingY = bestY;
			length += STEP_LENGTH;
		}
		this.stats.approaches.stalled.detour += 1;
		return null;
	}

	/** Registers approach `road` with the rules: leaving the road attach point `attach` is on, for the site `goal` at (px, py). */
	private register(attach: number, road: number, goal: number, px: number, py: number): void {
		this.rules.setRoad(road, this.network.stretches[this.attachStretch[attach]].road, this.attachX[attach], this.attachY[attach]);
		this.rules.setGoal(road, goal, px, py);
	}

	/** Smooths a grown approach where that keeps the rules, files its segments, and returns it. */
	private finish(attach: number, road: number, roadClass: RoadClass, steps: number[], px: number, py: number, floorSquared: number): Attachment {
		let points = steps;
		if (steps.length >= 6) {
			const smoothed = chaikin(chaikin(steps));
			let keeps = true;
			for (let point = 0; keeps && point + 3 < smoothed.length; point += 2) {
				keeps = this.keeps(road, smoothed[point], smoothed[point + 1], smoothed[point + 2], smoothed[point + 3], px, py, floorSquared);
			}
			if (keeps) {
				points = smoothed;
				this.stats.approaches.smoothed += 1;
			}
		}
		const segments: number[] = [];
		for (let point = 0; point + 3 < points.length; point += 2) {
			segments.push(this.rules.index.add(points[point], points[point + 1], points[point + 2], points[point + 3], road));
		}
		return { attach, road, roadClass, points, segments };
	}

	/**
	 * The rules for a segment of approach `road` to the site at (px, py):
	 * inside the disc; closing on the site all along it, so an approach can't
	 * loop back over itself; no nearer the compound than its floor, where it
	 * attached; clear of other roads, tapered near its junction and, against
	 * the site's other approaches, near the site; and passable.
	 */
	private keeps(road: number, x0: number, y0: number, x1: number, y1: number, px: number, py: number, floorSquared: number): boolean {
		if (x1 * x1 + y1 * y1 > this.radius * this.radius) return false;
		if (!closes(x0, y0, x1, y1, px, py)) return false;
		if (pointSegmentDistanceSquared(0, 0, x0, y0, x1, y1) < floorSquared) return false;
		if (this.rules.blocker(road, x0, y0, x1, y1) !== 'none') return false;
		return isPassable(this.terrain, x0, y0, x1, y1);
	}

	/**
	 * A trail where it leaves a trail, since classes never upgrade outward, or
	 * where the mean travel cost along its straight line passes the cost a
	 * back road degrades at; a back road otherwise. Impassable samples count
	 * as twice that cost.
	 */
	private approachClass(from: RoadClass, jx: number, jy: number, px: number, py: number): RoadClass {
		if (from === 'trail') return 'trail';
		const dx = px - jx;
		const dy = py - jy;
		const samples = Math.max(1, Math.ceil(sqrt(dx * dx + dy * dy) / STEP_LENGTH));
		let total = 0;
		for (let sample = 1; sample <= samples; sample += 1) {
			const cost = this.terrain.travelCost(jx + dx * sample / samples, jy + dy * sample / samples);
			total += cost === INFINITY ? 2 * this.trailCost : cost;
		}
		return total / samples > this.trailCost ? 'trail' : 'backRoad';
	}

	/**
	 * Collects the groups of attach points that could take an approach to
	 * (px, py) into `groups`, and returns how many. An attach point is within
	 * `reach`, its straight line to the site gets no nearer the compound, and
	 * that line leaves the road at least 20 degrees from it both ways (a dead
	 * end's tip carries on instead, within a trail's turn limit, the widest).
	 * Points are ranked by distance, the cost estimate, and each group lists
	 * its points cheapest first, the groups ordered by their cheapest.
	 */
	private gather(px: number, py: number, reach: number): number {
		const candidates: { attach: number; distance: number }[] = [];
		const first = this.cell(px - reach);
		const last = this.cell(px + reach);
		const bottom = this.cell(py - reach);
		const top = this.cell(py + reach);
		const tipCos = this.turnCos.trail;
		for (let row = bottom; row <= top; row += 1) {
			for (let column = first; column <= last; column += 1) {
				for (let attach = this.gridHeads[row * this.gridColumns + column]; attach >= 0; attach = this.gridNext[attach]) {
					const vx = this.attachX[attach];
					const vy = this.attachY[attach];
					const dx = px - vx;
					const dy = py - vy;
					const squared = dx * dx + dy * dy;
					if (squared > reach * reach || squared === 0 || dx * vx + dy * vy < 0) continue;
					const distance = sqrt(squared);
					const inward = dx * this.attachIn[2 * attach] + dy * this.attachIn[2 * attach + 1];
					if (this.attachTip[attach] === 1) {
						if (inward < tipCos * distance) continue;
					} else {
						const onward = dx * this.attachOn[2 * attach] + dy * this.attachOn[2 * attach + 1];
						if (inward > JUNCTION_COS * distance || onward > JUNCTION_COS * distance) continue;
					}
					candidates.push({ attach, distance });
				}
			}
		}
		candidates.sort((a, b) => a.distance - b.distance || a.attach - b.attach);
		const byKey = new Map<number, number[]>();
		const groups: number[][] = [];
		for (const { attach } of candidates) {
			const key = this.attachKey[attach];
			let group = byKey.get(key);
			if (group === undefined) {
				group = [];
				byKey.set(key, group);
				groups.push(group);
			}
			group.push(attach);
		}
		this.groups = groups;
		return groups.length;
	}

	/** The type a POI at (x, y) is: the first placement rule that holds there, one of its types picked by `draw`. */
	private typeAt(x: number, y: number, draw: number): string {
		for (const rule of this.tuning.placement) {
			if (rule.where.some((condition) => this.holds(condition, x, y))) return rule.types[floor(draw * rule.types.length)];
		}
		throw new Error('the last placement rule holds everywhere');
	}

	private holds(condition: SiteCondition, x: number, y: number): boolean {
		const terrain = this.terrain;
		if (condition.ruinAtLeast !== undefined && terrain.ruin(x, y) < condition.ruinAtLeast) return false;
		if (condition.elevationBelow !== undefined && !(terrain.elevation(x, y) < condition.elevationBelow)) return false;
		if (condition.moistureAtLeast !== undefined && terrain.moisture(x, y) < condition.moistureAtLeast) return false;
		if (condition.biomes !== undefined && !condition.biomes.includes(terrain.biome(x, y))) return false;
		if (condition.highwayWithin !== undefined && !this.highwayWithin(x, y, condition.highwayWithin)) return false;
		return true;
	}

	/** Whether a highway, grown or out of the metro, comes within `reach` of (x, y). */
	private highwayWithin(x: number, y: number, reach: number): boolean {
		const index = this.rules.index;
		const count = index.query(x - reach, y - reach, x + reach, y + reach);
		const found = index.results;
		const roads = this.network.roads;
		for (let entry = 0; entry < count; entry += 1) {
			const id = found[entry];
			const owner = index.owner(id);
			if (owner >= roads.length || roads[owner].roadClass !== 'highway') continue;
			if (pointSegmentDistanceSquared(x, y, index.x0(id), index.y0(id), index.x1(id), index.y1(id)) <= reach * reach) return true;
		}
		return false;
	}

	/**
	 * Files the attach points: vertices inside a stretch at least
	 * `nodeMargin` along it from both ends and `attachSpacing` along it from
	 * the last one filed, and the tip of every dead end
	 * (an `end`, or a metro edge nothing leaves), each with its group key.
	 */
	private indexAttachPoints(): void {
		const { stretches } = this.network;
		const { nodeMargin: margin, attachSpacing: spacing } = this.tuning.approaches;
		const keys = routeGroups(this.network, this.homeReach);
		const tips = new Set(deadEnds(this.network));
		const xs: number[] = [];
		const ys: number[] = [];
		const owners: number[] = [];
		const vertices: number[] = [];
		const groupKeys: number[] = [];
		const tipFlags: number[] = [];
		const ins: number[] = [];
		const ons: number[] = [];
		const push = (stretch: number, vertex: number, tip: boolean, points: readonly number[]) => {
			const at = 2 * vertex;
			const inX = points[at] - points[at - 2];
			const inY = points[at + 1] - points[at - 1];
			const inLength = sqrt(inX * inX + inY * inY);
			xs.push(points[at]);
			ys.push(points[at + 1]);
			owners.push(stretch);
			vertices.push(vertex);
			groupKeys.push(keys[stretch]);
			tipFlags.push(tip ? 1 : 0);
			ins.push(inX / inLength, inY / inLength);
			if (tip) {
				ons.push(inX / inLength, inY / inLength);
			} else {
				const onX = points[at + 2] - points[at];
				const onY = points[at + 3] - points[at + 1];
				const onLength = sqrt(onX * onX + onY * onY);
				ons.push(onX / onLength, onY / onLength);
			}
		};
		stretches.forEach(({ points }, id) => {
			const count = points.length / 2;
			const along = new Float64Array(count);
			for (let point = 1; point < count; point += 1) {
				const dx = points[2 * point] - points[2 * point - 2];
				const dy = points[2 * point + 1] - points[2 * point - 1];
				along[point] = along[point - 1] + sqrt(dx * dx + dy * dy);
			}
			const total = along[count - 1];
			let last = -INFINITY;
			for (let vertex = 1; vertex < count - 1; vertex += 1) {
				if (along[vertex] < margin || total - along[vertex] < margin || along[vertex] - last < spacing) continue;
				push(id, vertex, false, points);
				last = along[vertex];
			}
			if (tips.has(id)) push(id, count - 1, true, points);
		});
		this.attachCount = xs.length;
		this.attachX = Float64Array.from(xs);
		this.attachY = Float64Array.from(ys);
		this.attachStretch = Int32Array.from(owners);
		this.attachVertex = Int32Array.from(vertices);
		this.attachKey = Int32Array.from(groupKeys);
		this.attachTip = Uint8Array.from(tipFlags);
		this.attachIn = Float64Array.from(ins);
		this.attachOn = Float64Array.from(ons);
		this.gridColumns = Math.max(1, Math.ceil(2 * this.radius / this.reach));
		this.gridHeads = new Int32Array(this.gridColumns * this.gridColumns).fill(-1);
		this.gridNext = new Int32Array(this.attachCount);
		for (let attach = 0; attach < this.attachCount; attach += 1) {
			const cell = this.cell(this.attachY[attach]) * this.gridColumns + this.cell(this.attachX[attach]);
			this.gridNext[attach] = this.gridHeads[cell];
			this.gridHeads[cell] = attach;
		}
	}

	private cell(value: number): number {
		const column = floor((value + this.radius) / this.reach);
		return column < 0 ? 0 : column >= this.gridColumns ? this.gridColumns - 1 : column;
	}

	/**
	 * The plain data: growth's network with each attach point made a node,
	 * splitting its stretch, the approaches added as roads of one stretch,
	 * and a `poi` node for every site.
	 */
	private build(seats: readonly { site: number; faction: string; sector: number }[], placed: readonly { site: number; type: string; ring: number }[]): PoiMap {
		const source = this.network;
		const nodes: { kind: RoadNode['kind']; x: number; y: number }[] = source.nodes.map(({ kind, x, y }) => ({ kind, x, y }));
		const stretches: RoadStretch[] = source.stretches.map((stretch) => ({ ...stretch }));
		const roads: Road[] = source.roads.map((road) => ({ ...road, stretches: [...road.stretches] }));

		// Where each attach point leaves its stretch: the junction's node and the stretch that ends there.
		const cutsByStretch = new Map<number, number[]>();
		for (const site of this.sites) {
			for (const { attach } of site.approaches) {
				if (this.attachTip[attach] === 1) continue;
				const stretch = this.attachStretch[attach];
				const cuts = cutsByStretch.get(stretch) ?? [];
				cuts.push(this.attachVertex[attach]);
				cutsByStretch.set(stretch, cuts);
			}
		}
		const children = new Map<number, number[]>();
		source.stretches.forEach((stretch, id) => {
			if (stretch.parent < 0) return;
			const list = children.get(stretch.parent) ?? [];
			list.push(id);
			children.set(stretch.parent, list);
		});
		/** Per split stretch, by vertex: the junction node there and the stretch ending at it. */
		const cutAt = new Map<number, Map<number, Cut>>();
		[...cutsByStretch.keys()].sort((a, b) => a - b).forEach((id) => {
			const original = source.stretches[id];
			const vertices = [...new Set(cutsByStretch.get(id))].sort((a, b) => a - b);
			const byVertex = new Map<number, Cut>();
			const pieces: number[] = [];
			let previous = id;
			let startVertex = 0;
			let startNode = original.from;
			vertices.forEach((vertex, place) => {
				const node = nodes.length;
				nodes.push({ kind: 'junction', x: original.points[2 * vertex], y: original.points[2 * vertex + 1] });
				const points = original.points.slice(2 * startVertex, 2 * vertex + 2);
				if (place === 0) {
					// From the copy, not the original: splitting its parent may have moved its parent already.
					stretches[id] = { ...stretches[id], to: node, points };
				} else {
					stretches.push({ road: original.road, roadClass: original.roadClass, from: startNode, to: node, parent: previous, points });
					previous = stretches.length - 1;
					pieces.push(previous);
				}
				byVertex.set(vertex, { node, inner: previous });
				startVertex = vertex;
				startNode = node;
			});
			stretches.push({
				road: original.road, roadClass: original.roadClass, from: startNode, to: original.to, parent: previous,
				points: original.points.slice(2 * startVertex),
			});
			const outer = stretches.length - 1;
			pieces.push(outer);
			for (const child of children.get(id) ?? []) stretches[child] = { ...stretches[child], parent: outer };
			const chain = roads[original.road].stretches as number[];
			chain.splice(chain.indexOf(id) + 1, 0, ...pieces);
			cutAt.set(id, byVertex);
		});

		const addSite = (site: Site): { node: number; approaches: number[] } => {
			const node = nodes.length;
			nodes.push({ kind: 'poi', x: site.x, y: site.y });
			const approaches = site.approaches.map(({ attach, roadClass, points }) => {
				const stretchId = this.attachStretch[attach];
				const grownRoad = source.stretches[stretchId].road;
				let from: number;
				let parent: number;
				if (this.attachTip[attach] === 1) {
					from = source.stretches[stretchId].to;
					// The stretch ending at the tip: the dead end's last piece, if an approach also split it.
					parent = roads[grownRoad].stretches.find((piece) => stretches[piece].to === from) as number;
					if (nodes[from].kind === 'end') nodes[from].kind = 'extension';
				} else {
					const cut = cutAt.get(stretchId)?.get(this.attachVertex[attach]) as Cut;
					from = cut.node;
					parent = cut.inner;
				}
				const road = roads.length;
				roads.push({ roadClass, parent: grownRoad, from, stretches: [stretches.length] });
				stretches.push({ road, roadClass, from, to: node, parent, points: [...points] });
				return road;
			});
			return { node, approaches };
		};

		const strongholds = seats.map(({ site, faction, sector }): Stronghold => {
			const { node, approaches } = addSite(this.sites[site]);
			return { node, faction, sector, approaches };
		});
		const pois = placed.map(({ site, type, ring }): Poi => {
			const { node, approaches } = addSite(this.sites[site]);
			return { node, type, ring, approaches };
		});
		const network: RoadNetwork = { nodes: nodes.map(({ kind, x, y }) => ({ kind, x, y })), roads, stretches };
		return { network, strongholds, pois, homeReach: this.homeReach };
	}
}

/**
 * Each stretch's route group, for a home area reaching `homeReach` along
 * the roads from the compound. Walking out from the compound, the first
 * stretch that ends past the home area keys everything beyond it, and a
 * stretch inside the home area keys itself. So two points on the network
 * with different keys have paths to the compound that meet only inside the
 * home area, and routes through them share no road beyond it.
 */
export function routeGroups({ nodes, stretches }: RoadNetwork, homeReach: number): Int32Array {
	const reached = new Float64Array(nodes.length).fill(-1);
	const exits = new Int32Array(stretches.length).fill(-2);
	const keys = new Int32Array(stretches.length);
	reached[0] = 0;
	const settle = (id: number): void => {
		if (exits[id] !== -2) return;
		const stretch = stretches[id];
		if (stretch.parent >= 0) settle(stretch.parent);
		reached[stretch.to] = reached[stretch.from] + polylineLength(stretch.points);
		const inherited = stretch.parent >= 0 ? exits[stretch.parent] : -1;
		exits[id] = inherited >= 0 ? inherited : reached[stretch.to] > homeReach ? id : -1;
		keys[id] = exits[id] >= 0 ? exits[id] : id;
	};
	for (let id = 0; id < stretches.length; id += 1) settle(id);
	return keys;
}

/**
 * The stretches that end in a dead end, in order: at an `end` node, or at a
 * metro edge nothing leaves, where a highway was blocked as it left the
 * metro. A junction a blocked parent ends at still has its branch going on,
 * so it isn't one, and neither is an exit at the rim.
 */
export function deadEnds({ nodes, stretches }: RoadNetwork): number[] {
	const leaving = new Int32Array(nodes.length);
	for (const stretch of stretches) leaving[stretch.from] += 1;
	const ends: number[] = [];
	stretches.forEach(({ to }, id) => {
		const kind = nodes[to].kind;
		if (leaving[to] === 0 && (kind === 'end' || kind === 'metroEdge')) ends.push(id);
	});
	return ends;
}

/**
 * Whether the segment closes on (px, py) all along it: the site lies ahead
 * of its end, so the distance to the site only falls along it (it's convex
 * along a segment). A path made of such segments can't cross itself, since
 * every point of it is nearer the site than every point before.
 */
export function closes(x0: number, y0: number, x1: number, y1: number, px: number, py: number): boolean {
	const dx = x1 - x0;
	const dy = y1 - y0;
	return (dx !== 0 || dy !== 0) && (px - x1) * dx + (py - y1) * dy >= 0;
}

function polylineLength(points: readonly number[]): number {
	let length = 0;
	for (let point = 0; point + 3 < points.length; point += 2) {
		const dx = points[point + 2] - points[point];
		const dy = points[point + 3] - points[point + 1];
		length += sqrt(dx * dx + dy * dy);
	}
	return length;
}
