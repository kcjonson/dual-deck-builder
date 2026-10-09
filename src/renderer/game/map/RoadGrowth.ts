import type { Rng } from '../core/Rng';
import { Vector, chaikin, pointSegmentDistanceSquared, segmentDistanceSquared, unitVector } from './Geometry';
import type { HighwayDeparture } from './Highways';
import type { MapParams } from './MapParams';
import { ROAD_CLASSES, Road, RoadClass, RoadNetwork, RoadNode, RoadNodeKind, RoadStretch } from './RoadNetwork';
import { SegmentIndex } from './SegmentIndex';
import type { Terrain } from './Terrain';

/**
 * Stages 3 and 4 of area map generation (Area Map Generation, Pipeline, 3.
 * Growth and 4. Road classes): the drivable roads grow outward from the
 * highways' departures in steps, from a queue ordered by distance from the
 * compound. Each step proposes headings within its class's turn limit,
 * scores them by the terrain here and ahead, how far they stray from the
 * road's preferred heading, how close they come to the road it branched
 * from, and a little noise, and takes the best one that keeps the step
 * rules: outward, passable, clear of other roads, and inside the disc. Roads
 * branch into open country as they go, and back roads degrade to trails in
 * rough ground. When every road has ended, each stretch is smoothed and
 * checked again. The result is plain data, trees rooted at the compound.
 *
 * Every decision is plain arithmetic (see Geometry), so a seed grows the same
 * roads in every engine. Starting values throughout are for the Map Lab to
 * tune; the rules and their numbers are in
 * docs/AI_TECHNICAL_DECISIONS/road-growth.md.
 */

// Globals read once, at load: under Jest's vm context each read costs about 0.15 us (seeded-prng.md).
const sqrt = Math.sqrt;
const floor = Math.floor;
const ceil = Math.ceil;
const INFINITY = Infinity;

/** World units a step covers: the spec's s. */
export const STEP_LENGTH = 20;
/** cos(65 degrees): a step gains at least this share of its length in distance from the compound. */
export const OUTWARD_SHARE = 0.42261826174069944;
/**
 * Near a junction two roads share, the gap they keep grows from nothing at
 * the junction by this much per unit away from it, up to the clearance.
 * It's sin(14.5 degrees), under sin(20), so a branch leaving at the least
 * angle, and highways leaving the metro the least separation apart, clear it
 * with room to bend.
 */
export const JUNCTION_TAPER = 0.25;
/** Degrees a branch leaves its parent at. */
export const BRANCH_ANGLE = { min: 20, max: 55 } as const;
/** cos(20 degrees): roads meeting at a junction leave it at least 20 degrees apart. */
export const JUNCTION_COS = 0.9396926207859084;
/** Headings a step proposes, evenly across its turn limit either way. Odd, so one goes straight on. */
export const CANDIDATE_HEADINGS = 5;
/**
 * World units between impassability samples along a step, and the passable
 * rule's tolerance: between two samples a step can clip a cliff's corner, or
 * cross anything narrower than this. The terrain's thinnest slivers run
 * under a unit.
 */
export const PASSABLE_SPACING = 0.5;
/** World units between the knots a road's preferred heading drifts through. */
export const DRIFT_SPACING = 200;
/** Where a road leaving the area ends, as a share of the radius. */
const RIM_INSET = 1 - 1e-9;
/** Crowding eases off over this share of the gap the clearance rule needs, beyond that gap. */
const CROWD_BAND = 0.75;

export interface RoadClassRules {
	/** Degrees a step can turn either way at curviness 0.5, the spec's figures; `turnScale` scales them. */
	readonly turnLimit: number;
	/** World units a road can run in this class before it ends; Infinity for no limit. */
	readonly maxLength: number;
	/** Weight in a step's score of straying from the preferred heading: how hard the class holds its course. */
	readonly holdCourse: number;
	/** Weight in a step's score of rough country ahead, where cliffs stand: how hard the class keeps out of it. */
	readonly shunRough: number;
	/** Degrees a road's preferred heading drifts either way at curviness 1: stage 2 draws a highway's out of the metro, growth a branch's. */
	readonly drift: number;
	/** Chance per step of trying a branch, at branchiness 0.5 and away from the metro. 0 never branches. */
	readonly branchChance: number;
	/**
	 * World units nearer the compound the queue counts the class's tips: the
	 * trunks grow that far ahead of the roads round them, so they claim their
	 * way before a branch sweeping across can cut them off.
	 */
	readonly lead: number;
	/**
	 * World units ahead a step looks for impassable ground along its heading,
	 * so a trunk turns off before a cliff band fills its whole fan. 0 for
	 * none: a branch that meets a cliff can end there.
	 */
	readonly wallReach: number;
}

export const ROAD_CLASS_RULES: { readonly [Name in RoadClass]: RoadClassRules } = {
	highway: { turnLimit: 10, maxLength: Infinity, holdCourse: 12, shunRough: 4, drift: 45, branchChance: 0.4, lead: 100, wallReach: 80 },
	backRoad: { turnLimit: 18, maxLength: 800, holdCourse: 6, shunRough: 1.5, drift: 50, branchChance: 0.35, lead: 0, wallReach: 0 },
	trail: { turnLimit: 28, maxLength: 400, holdCourse: 3, shunRough: 0.3, drift: 60, branchChance: 0, lead: 0, wallReach: 0 },
};

/** How `curviness` scales every class's turn limit: 0.6 at 0, ruler-straight but able to steer round a crater, to 1.4 at 1. */
export function turnScale(curviness: number): number {
	return 0.6 + 0.8 * curviness;
}

/** The turns a step of `roadClass` proposes, degrees counterclockwise: `CANDIDATE_HEADINGS` of them, evenly across its turn limit either way. */
export function candidateTurns(roadClass: RoadClass, curviness: number): number[] {
	const limit = ROAD_CLASS_RULES[roadClass].turnLimit * turnScale(curviness);
	const half = (CANDIDATE_HEADINGS - 1) / 2;
	return Array.from({ length: CANDIDATE_HEADINGS }, (_, candidate) => (candidate - half) / half * limit);
}

/** How a step is scored; lowest wins. */
const SCORE = {
	/** Weight of the travel cost at the step's end, 1 a unit on flat scrub. */
	cost: 1,
	/** Weight of the cost further along the heading, so a road bends round costly ground before it gets there... */
	lookahead: 0.5,
	/** ...sampled this many steps ahead. */
	lookaheadSteps: 2.5,
	/** What an impassable lookahead sample costs: a wall to steer round, not a rule. Off the map counts as flat. */
	wall: 8,
	/** Weight of impassable ground within a class's `wallReach`, by how little of the reach is clear... */
	wallAhead: 6,
	/** ...looked for every this many world units, through `impassable`, which is cheap outside rough country. */
	wallSpacing: 4,
	/** Rough country ahead is read off the terrain's lattice at this many points along the heading... */
	roughSamples: 10,
	/** ...this many world units apart, nearer points counting more. A cheap lookup, so it can see far. */
	roughSpacing: 16,
	/** Weight of crowding: coming near the gap the clearance rule needs from a road this one meets at a junction. */
	crowd: 2,
	/** Weight of the noise, a draw in [0, 1) per candidate from the road's stream. */
	noise: 0.15,
};

const BRANCHING = {
	/** Steps a road takes from its start or its last junction before it can branch. */
	gap: 4,
	/** Steps a branch has to manage at once, the first straight along its junction angle, or it isn't made. */
	probe: 2,
	/** Branchiness 0 to 1 scales the class's chance from this to this. */
	scale: { min: 0.3, max: 1.7 },
	/** At the metro's edge the chance is this share of the full one, which it reaches this share of the radius out. */
	near: 0.5,
	full: 0.4,
	/** No branch starts within this share of the radius of the rim, where it would only be a spur off the map. */
	rim: 0.06,
	/** Of a highway's branches, the share that stay highway: an interchange. */
	interchange: 0.06,
	/** Of a back road's branches, the share that are trails. */
	trail: 0.4,
	/** Open room on a side is the distance to the nearest road at this many points along the branch's heading... */
	roomProbes: 3,
	/** ...this many steps apart... */
	roomSpacing: 2,
	/**
	 * ...each counting up to this many world units, or this many clearances
	 * if that's more. The chance goes with the room's square, so this is
	 * about how far apart branches settle: density is branchiness's to set,
	 * not the clearance's.
	 */
	roomCap: 120,
	roomCapClearances: 3,
};

const DEGRADE = {
	/** A back road becomes a trail once its running travel cost passes this, from trailShare 0 to 1... */
	cost: { min: 3.2, max: 1.7 },
	/** ...a running mean that weights each step's cost this much. */
	weight: 0.5,
};

/** What growth reads from the terrain; `Terrain` has it all, and tests can stand in a smaller one. */
export type GrowthTerrain = Pick<Terrain, 'radius' | 'metro' | 'hotspots' | 'impassable' | 'travelCost' | 'rough'>;

/**
 * Growth's own knobs, which were map parameters (`branchiness` and
 * `roadClearance`) until the realistic map's table dropped them: road links
 * replace growth, and neither means anything there.
 */
export interface GrowthTuning {
	/** 0 to 1: scales every class's branch chance (`BRANCHING.scale`). */
	branchiness?: number;
	/** World units a road keeps from roads it doesn't meet. */
	clearance?: number;
}

/** The old table's defaults. */
export const GROWTH_TUNING: Readonly<Required<GrowthTuning>> = { branchiness: 0.5, clearance: 24 };

export interface GrowthOptions extends GrowthTuning {
	terrain: GrowthTerrain;
	/** Validated. */
	params: MapParams;
	/** Stage 2's departures, from `planHighways`. */
	highways: readonly HighwayDeparture[];
	/** The stage's stream, root.fork('map', mapAttempt).fork('growth', stageAttempt). Each road forks its own from it. */
	rng: Rng;
}

/** What happened during growth, for the Map Lab's readout and for tuning; not part of the map. */
export interface GrowthStats {
	/** Steps taken, branches' first steps included. */
	steps: number;
	/** Candidate headings scored. */
	candidates: number;
	/** Candidates turned down, by the rule that turned them down. `junction` is a parent's first step after a branch. */
	rejected: { outward: number; junction: number; passable: number; clearance: number };
	/** How roads ended: blocked (a dead end), at their class's longest, or out of the area. */
	ends: { blocked: number; maxLength: number; exit: number };
	branches: { tried: number; grown: number };
	/** Back roads that degraded to trails. */
	degraded: number;
	/** Stretches smoothed, and stretches whose smoothing failed a rule and kept their steps. */
	stretches: { smoothed: number; unsmoothed: number };
}

export interface RoadGrowth {
	readonly network: RoadNetwork;
	readonly stats: GrowthStats;
}

/** Stages 3 and 4: the drivable network grown from stage 2's highways, on the `growth` stream. */
export function growRoads(options: GrowthOptions): RoadGrowth {
	return new RoadGrower(options).grow();
}

/**
 * The step rules (Area Map Generation, Growth, step 3) over the roads laid so
 * far: outward, passable, clear of other roads, inside the disc. Growth asks
 * them of every step and of every smoothed stretch; tests ask them directly.
 * Roads are registered with their parent and junction, which the clearance
 * rule needs, and their segments filed in `index` under their id.
 */
export class StepRules {
	public readonly index: SegmentIndex;
	private readonly terrain: GrowthTerrain;
	private readonly clearance: number;
	private readonly radiusSquared: number;
	/** Per road: its parent's id (-1 for a highway out of the metro) and its junction, where it meets its parent or the compound. */
	private readonly parents: number[] = [];
	private readonly junctions: number[] = [];
	/** The junction `meet` found. */
	private meetX = 0;
	private meetY = 0;
	/** Other roads' segments `gather` found. */
	private near = new Int32Array(64);
	private nearCount = 0;

	constructor({ terrain, clearance }: { terrain: GrowthTerrain; clearance: number }) {
		this.terrain = terrain;
		this.clearance = clearance;
		this.radiusSquared = terrain.radius * terrain.radius;
		this.index = new SegmentIndex({ extent: terrain.radius + STEP_LENGTH, cellSize: Math.max(clearance, STEP_LENGTH) });
	}

	/** Registers road `id`: the road it branches from, -1 for a highway out of the metro, and where it meets it (the compound's origin for those). */
	public setRoad(id: number, parent: number, junctionX: number, junctionY: number): void {
		this.parents[id] = parent;
		this.junctions[2 * id] = junctionX;
		this.junctions[2 * id + 1] = junctionY;
	}

	/** The rule a step from (x0, y0) to (x1, y1) on `road` breaks, or null when it keeps them all. */
	public broken(road: number, x0: number, y0: number, x1: number, y1: number): 'disc' | 'outward' | 'passable' | 'clearance' | null {
		if (!this.inside(x1, y1)) return 'disc';
		if (!isOutward(x0, y0, x1, y1)) return 'outward';
		if (!this.passable(x0, y0, x1, y1)) return 'passable';
		if (this.blocker(road, x0, y0, x1, y1) !== 'none') return 'clearance';
		return null;
	}

	/** Inside the disc, rim included. */
	public inside(x: number, y: number): boolean {
		return x * x + y * y <= this.radiusSquared;
	}

	/**
	 * No impassable ground on the segment: craters exactly, as circles, and
	 * cliffs and water from `impassable` every `PASSABLE_SPACING` along it.
	 * The start isn't sampled; it's the end of the step before, or a junction.
	 * See `isPassable` for where bridges will come in.
	 */
	public passable(x0: number, y0: number, x1: number, y1: number): boolean {
		return isPassable(this.terrain, x0, y0, x1, y1);
	}

	/**
	 * The clearance rule: no point of the segment within the clearance of
	 * another road's, except near a junction the two share, where the gap
	 * needed tapers to nothing at the junction (`junctionGap`) and they may
	 * touch only there, at 20 degrees or more. A road's own segments never
	 * count: each runs outward, so a road can't come back to itself.
	 */
	public clear(road: number, x0: number, y0: number, x1: number, y1: number): boolean {
		return this.blocker(road, x0, y0, x1, y1) === 'none';
	}

	/**
	 * What breaks the clearance rule for the segment: 'stranger' when a road
	 * it shares no junction with comes within the clearance, else 'kin' when
	 * one it does share a junction with comes within the tapered gap or
	 * touches it wrongly, else 'none'.
	 */
	public blocker(road: number, x0: number, y0: number, x1: number, y1: number): 'none' | 'kin' | 'stranger' {
		const clearance = this.clearance;
		const index = this.index;
		const count = index.query(
			(x0 < x1 ? x0 : x1) - clearance, (y0 < y1 ? y0 : y1) - clearance,
			(x0 < x1 ? x1 : x0) + clearance, (y0 < y1 ? y1 : y0) + clearance,
		);
		const found = index.results;
		let blocked: 'none' | 'kin' = 'none';
		for (let entry = 0; entry < count; entry += 1) {
			const id = found[entry];
			const other = index.owner(id);
			if (other === road) continue;
			const ax = index.x0(id);
			const ay = index.y0(id);
			const bx = index.x1(id);
			const by = index.y1(id);
			const distanceSquared = segmentDistanceSquared(x0, y0, x1, y1, ax, ay, bx, by);
			if (distanceSquared >= clearance * clearance) continue;
			if (!this.meet(road, other)) return 'stranger';
			const gap = junctionGap(clearance, this.meetX, this.meetY, x0, y0, x1, y1, ax, ay, bx, by);
			if (gap > 0 ? distanceSquared < gap * gap : !leaveApart(this.meetX, this.meetY, x0, y0, x1, y1, ax, ay, bx, by)) blocked = 'kin';
		}
		return blocked;
	}

	/** Collects other roads' segments within `reach` of (x, y) for `crowding`, which reads them until the next call. */
	public gather(road: number, x: number, y: number, reach: number): void {
		const index = this.index;
		const count = index.query(x - reach, y - reach, x + reach, y + reach);
		const found = index.results;
		if (this.near.length < count) this.near = new Int32Array(2 * count);
		let kept = 0;
		for (let entry = 0; entry < count; entry += 1) {
			if (index.owner(found[entry]) === road) continue;
			this.near[kept] = found[entry];
			kept += 1;
		}
		this.nearCount = kept;
	}

	/**
	 * How crowded (x, y) is for `road` by its kin, the roads it shares a
	 * junction with, 0 to 1, from the segments `gather` collected: 1 at the
	 * gap the clearance rule needs from the nearest, easing to 0 at
	 * `CROWD_BAND` of that gap beyond it. A soft edge on the rule, which growth
	 * scores so a road and its branch turn apart before the rule stops either.
	 * Other roads don't crowd: a back road or trail that runs into one ends
	 * there, and a highway turns aside only when the rule makes it.
	 */
	public crowding(road: number, x: number, y: number): number {
		const index = this.index;
		const clearance = this.clearance;
		const reach = clearance * (1 + CROWD_BAND);
		let worst = 0;
		for (let entry = 0; entry < this.nearCount; entry += 1) {
			const id = this.near[entry];
			const ax = index.x0(id);
			const ay = index.y0(id);
			const bx = index.x1(id);
			const by = index.y1(id);
			const distanceSquared = pointSegmentDistanceSquared(x, y, ax, ay, bx, by);
			if (distanceSquared >= reach * reach || !this.meet(road, index.owner(id))) continue;
			const jx = this.meetX;
			const jy = this.meetY;
			const fromJunction = (x - jx) * (x - jx) + (y - jy) * (y - jy);
			const segmentFromJunction = pointSegmentDistanceSquared(jx, jy, ax, ay, bx, by);
			let need = JUNCTION_TAPER * sqrt(fromJunction > segmentFromJunction ? fromJunction : segmentFromJunction);
			if (need > clearance) need = clearance;
			const crowd = need > 0 ? 1 - (sqrt(distanceSquared) - need) / (CROWD_BAND * need) : 0;
			if (crowd > worst) worst = crowd < 1 ? crowd : 1;
		}
		return worst;
	}

	/**
	 * Whether two roads share a junction, left in `meetX` and `meetY`: a
	 * branch and its parent meet at the branch's junction, and the highways
	 * out of the metro all meet at the compound.
	 */
	private meet(road: number, other: number): boolean {
		const parent = this.parents[road];
		const otherParent = this.parents[other];
		const at = parent === other || (parent === -1 && otherParent === -1) ? road : otherParent === road ? other : -1;
		if (at < 0) return false;
		this.meetX = this.junctions[2 * at];
		this.meetY = this.junctions[2 * at + 1];
		return true;
	}
}

/** The outward rule: the segment gains at least `OUTWARD_SHARE` of its length in distance from the compound. */
export function isOutward(x0: number, y0: number, x1: number, y1: number): boolean {
	const dx = x1 - x0;
	const dy = y1 - y0;
	return sqrt(x1 * x1 + y1 * y1) - sqrt(x0 * x0 + y0 * y0) >= OUTWARD_SHARE * sqrt(dx * dx + dy * dy);
}

/**
 * The passable rule over a terrain; see `StepRules.passable`. Water is
 * impassable here like the rest, through `impassable`, until the water stage
 * (DDB-289) widens `WaterLayer` to tell a river from a lake and give its
 * direction. Then this is where a step that crosses a river square-on is
 * let through as a bridge (Area Map Generation, Growth, step 3): the samples
 * that land on that river stop counting, and the crossing is recorded as a
 * bridge, the spec's candidate spot for a "bridge out" hazard.
 */
export function isPassable(terrain: Pick<Terrain, 'hotspots' | 'impassable'>, x0: number, y0: number, x1: number, y1: number): boolean {
	const hotspots = terrain.hotspots;
	for (let index = 0; index < hotspots.length; index += 1) {
		const { x, y, craterRadius } = hotspots[index];
		if (pointSegmentDistanceSquared(x, y, x0, y0, x1, y1) < craterRadius * craterRadius) return false;
	}
	const dx = x1 - x0;
	const dy = y1 - y0;
	const samples = ceil(sqrt(dx * dx + dy * dy) / PASSABLE_SPACING);
	for (let sample = 1; sample <= samples; sample += 1) {
		const along = sample / samples;
		if (terrain.impassable(x0 + dx * along, y0 + dy * along)) return false;
	}
	return true;
}

/**
 * The gap two segments of roads that meet at (jx, jy) must keep: the
 * clearance, less near the junction, where it's `JUNCTION_TAPER` times the
 * farther segment's distance from it. Zero only when both touch the junction.
 */
export function junctionGap(
	clearance: number, jx: number, jy: number,
	ax: number, ay: number, bx: number, by: number,
	cx: number, cy: number, dx: number, dy: number,
): number {
	const first = pointSegmentDistanceSquared(jx, jy, ax, ay, bx, by);
	const second = pointSegmentDistanceSquared(jx, jy, cx, cy, dx, dy);
	const gap = JUNCTION_TAPER * sqrt(first > second ? first : second);
	return gap < clearance ? gap : clearance;
}

/**
 * Whether two segments that both touch the junction (jx, jy) leave it at
 * least 20 degrees apart: each must end exactly on it, and their far ends
 * have to lie in directions `JUNCTION_COS` or less alike, so they meet only
 * there.
 */
export function leaveApart(
	jx: number, jy: number,
	ax: number, ay: number, bx: number, by: number,
	cx: number, cy: number, dx: number, dy: number,
): boolean {
	const firstAtStart = ax === jx && ay === jy;
	const secondAtStart = cx === jx && cy === jy;
	if (!firstAtStart && !(bx === jx && by === jy)) return false;
	if (!secondAtStart && !(dx === jx && dy === jy)) return false;
	const ux = (firstAtStart ? bx : ax) - jx;
	const uy = (firstAtStart ? by : ay) - jy;
	const vx = (secondAtStart ? dx : cx) - jx;
	const vy = (secondAtStart ? dy : cy) - jy;
	const lengths = sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
	return lengths > 0 && ux * vx + uy * vy <= JUNCTION_COS * lengths;
}

/** A road's preferred heading's drift at `length` along it, degrees: its knots, eased between. */
export function driftAt(knots: readonly number[], length: number): number {
	const position = length / DRIFT_SPACING;
	const knot = floor(position);
	if (knot >= knots.length - 1) return knots[knots.length - 1];
	const along = position - knot;
	return knots[knot] + (knots[knot + 1] - knots[knot]) * along * along * (3 - 2 * along);
}

/**
 * Drift knots for a road that can grow until `span` further from the
 * compound: enough for the longest it can be, since every unit of road gains
 * at least `OUTWARD_SHARE` of one. The first is 0, so a road sets off on its
 * heading; the rest are uniform within `amplitude` either way, one draw each.
 */
export function driftKnots({ rng, span, amplitude }: { rng: Rng; span: number; amplitude: number }): number[] {
	const count = floor(Math.max(0, span) / OUTWARD_SHARE / DRIFT_SPACING) + 2;
	const knots = [0];
	for (let knot = 1; knot < count; knot += 1) knots.push((rng.float() * 2 - 1) * amplitude);
	return knots;
}

/** Where a stretch of a road starts: a point of its polyline, the node there, and the stretch's class. */
interface Cut {
	readonly point: number;
	node: number;
	readonly roadClass: RoadClass;
}

/** A road while it grows. */
interface GrowingRoad {
	readonly id: number;
	readonly parent: number;
	readonly startClass: RoadClass;
	readonly rng: Rng;
	readonly drift: readonly number[];
	/** The heading its preferred heading drifts around: its bearing, or its junction angle. */
	readonly baseX: number;
	readonly baseY: number;
	/** Its polyline so far, flat, from its first node. */
	readonly points: number[];
	/** Index ids of its segments; segment k runs from point k to point k + 1. */
	readonly segments: number[];
	/** Its stretch boundaries in order, from its first node to its end once it has one. */
	readonly cuts: Cut[];
	/** Each stretch's smoothed polyline, by the cut it starts at, where smoothing kept the rules. */
	readonly curves: (number[] | undefined)[];
	roadClass: RoadClass;
	/** The direction of its last step, unit length. */
	headingX: number;
	headingY: number;
	/** World units grown, and grown in its current class. */
	length: number;
	classLength: number;
	/** Steps since it started or last branched. */
	sinceJunction: number;
	/** The running mean of its steps' travel cost. */
	runningCost: number;
	/** After it branches, its next step keeps 20 degrees from the branch, which leaves along this. */
	avoiding: boolean;
	avoidX: number;
	avoidY: number;
}

type Advance = 'step' | 'exit' | 'blocked';

/** One run of growth; `grow` runs it to the end and returns the network. */
class RoadGrower {
	private readonly terrain: GrowthTerrain;
	private readonly params: MapParams;
	private readonly highways: readonly HighwayDeparture[];
	private readonly rng: Rng;
	private readonly rules: StepRules;
	private readonly index: SegmentIndex;
	private readonly radius: number;
	private readonly clearance: number;
	private readonly branchScale: number;
	private readonly degradeCost: number;
	/** Per class, the cosine and sine of each candidate heading's turn. */
	private readonly turns: { readonly [Name in RoadClass]: Float64Array };

	private readonly roads: GrowingRoad[] = [];
	private readonly nodes: { kind: RoadNodeKind; x: number; y: number }[] = [{ kind: 'compound', x: 0, y: 0 }];
	private readonly queue = new TipQueue();
	private readonly stats: GrowthStats = {
		steps: 0,
		candidates: 0,
		rejected: { outward: 0, junction: 0, passable: 0, clearance: 0 },
		ends: { blocked: 0, maxLength: 0, exit: 0 },
		branches: { tried: 0, grown: 0 },
		degraded: 0,
		stretches: { smoothed: 0, unsmoothed: 0 },
	};

	/** Each candidate's end, heading, step cost, score, and whether it leaves the area, by candidate. */
	private readonly endX = new Float64Array(CANDIDATE_HEADINGS);
	private readonly endY = new Float64Array(CANDIDATE_HEADINGS);
	private readonly headingX = new Float64Array(CANDIDATE_HEADINGS);
	private readonly headingY = new Float64Array(CANDIDATE_HEADINGS);
	private readonly stepCost = new Float64Array(CANDIDATE_HEADINGS);
	private readonly scores = new Float64Array(CANDIDATE_HEADINGS);
	private readonly exits = new Uint8Array(CANDIDATE_HEADINGS);
	/** The surviving candidates, best first. */
	private readonly order = new Int32Array(CANDIDATE_HEADINGS);
	private readonly direction: Vector = { x: 0, y: 0 };

	constructor({ terrain, params, highways, rng, branchiness = GROWTH_TUNING.branchiness, clearance = GROWTH_TUNING.clearance }: GrowthOptions) {
		this.terrain = terrain;
		this.params = params;
		this.highways = highways;
		this.rng = rng;
		this.radius = terrain.radius;
		this.clearance = clearance;
		this.rules = new StepRules({ terrain, clearance });
		this.index = this.rules.index;
		this.branchScale = BRANCHING.scale.min + (BRANCHING.scale.max - BRANCHING.scale.min) * branchiness;
		this.degradeCost = DEGRADE.cost.min + (DEGRADE.cost.max - DEGRADE.cost.min) * params.trailShare;
		const turns = {} as { [Name in RoadClass]: Float64Array };
		for (const roadClass of ROAD_CLASSES) {
			const table = new Float64Array(2 * CANDIDATE_HEADINGS);
			candidateTurns(roadClass, params.curviness).forEach((turn, candidate) => {
				unitVector(turn, this.direction);
				table[2 * candidate] = this.direction.x;
				table[2 * candidate + 1] = this.direction.y;
			});
			turns[roadClass] = table;
		}
		this.turns = turns;
	}

	public grow(): RoadGrowth {
		this.depart();
		while (this.queue.size > 0) {
			const road = this.roads[this.queue.pop()];
			const advance = this.advance(road);
			if (advance === 'blocked') {
				this.stats.ends.blocked += 1;
				this.end(road, 'end');
				continue;
			}
			if (advance === 'exit') {
				this.stats.ends.exit += 1;
				this.end(road, 'exit');
				continue;
			}
			this.degrade(road);
			if (road.classLength >= ROAD_CLASS_RULES[road.roadClass].maxLength) {
				this.stats.ends.maxLength += 1;
				this.end(road, 'end');
				continue;
			}
			this.branch(road);
			this.enqueue(road);
		}
		this.smooth();
		return { network: this.network(), stats: this.stats };
	}

	/** The highways out of the metro: each a city street from the compound to its departure, then growth. */
	private depart(): void {
		this.highways.forEach((departure, id) => {
			unitVector(departure.bearing, this.direction);
			this.rules.setRoad(id, -1, 0, 0);
			const metroEdge = this.addNode('metroEdge', departure.x, departure.y);
			const road = this.createRoad({
				id, parent: -1, roadClass: 'highway', drift: departure.drift, baseX: this.direction.x, baseY: this.direction.y,
				points: [0, 0, departure.x, departure.y],
			});
			road.cuts.push({ point: 0, node: 0, roadClass: 'highway' }, { point: 1, node: metroEdge, roadClass: 'highway' });
			this.roads.push(road);
			this.enqueue(road);
		});
	}

	private createRoad({ id, parent, roadClass, drift, baseX, baseY, points }: {
		id: number; parent: number; roadClass: RoadClass; drift: readonly number[]; baseX: number; baseY: number; points: number[];
	}): GrowingRoad {
		const segments: number[] = [];
		for (let point = 0; point + 3 < points.length; point += 2) {
			segments.push(this.index.add(points[point], points[point + 1], points[point + 2], points[point + 3], id));
		}
		return {
			id, parent, startClass: roadClass, rng: this.rng.fork('road', id), drift, baseX, baseY, points, segments, cuts: [], curves: [],
			roadClass, headingX: baseX, headingY: baseY, length: 0, classLength: 0, sinceJunction: 0, runningCost: 1,
			avoiding: false, avoidX: 0, avoidY: 0,
		};
	}

	/**
	 * One step of `road`: propose candidate headings, score them, and take the
	 * best that keeps the step rules. Appends the step and returns 'step', or
	 * 'exit' when it reached the rim; appends nothing and returns 'blocked'
	 * when no candidate survives.
	 */
	private advance(road: GrowingRoad): Advance {
		const points = road.points;
		const x = points[points.length - 2];
		const y = points[points.length - 1];
		const survivors = this.propose(road, x, y);
		for (let rank = 0; rank < survivors; rank += 1) {
			const candidate = this.order[rank];
			const toX = this.endX[candidate];
			const toY = this.endY[candidate];
			const blocker = this.rules.blocker(road.id, x, y, toX, toY);
			if (blocker !== 'none') {
				this.stats.rejected.clearance += 1;
				// A back road or trail whose best way on runs into another road ends there, rather than turning to run alongside it.
				if (rank === 0 && blocker === 'stranger' && road.roadClass !== 'highway') return 'blocked';
				continue;
			}
			if (!this.rules.passable(x, y, toX, toY)) {
				this.stats.rejected.passable += 1;
				continue;
			}
			this.accept(road, x, y, candidate);
			return this.exits[candidate] === 1 ? 'exit' : 'step';
		}
		return 'blocked';
	}

	/**
	 * Scores the candidate headings from (x, y), dropping those that break the
	 * cheap rules (outward, the junction angle, a sample on impassable ground),
	 * and sorts the rest into `order`, best first. Every candidate draws its
	 * noise, survivor or not, so a step always takes the same draws. Returns
	 * how many survive. A candidate that would leave the disc is cut short at
	 * the rim, where its road leaves the area.
	 */
	private propose(road: GrowingRoad, x: number, y: number): number {
		const rules = ROAD_CLASS_RULES[road.roadClass];
		const turns = this.turns[road.roadClass];
		const terrain = this.terrain;
		const radiusSquared = this.radius * this.radius;
		// A hair inside the rim, so rounding never puts an exit outside the disc.
		const rim = this.radius * RIM_INSET;
		const fromSquared = x * x + y * y;
		unitVector(driftAt(road.drift, road.length), this.direction);
		const preferredX = road.baseX * this.direction.x - road.baseY * this.direction.y;
		const preferredY = road.baseX * this.direction.y + road.baseY * this.direction.x;
		this.rules.gather(road.id, x, y, STEP_LENGTH + this.clearance * (1 + CROWD_BAND));
		let survivors = 0;
		for (let candidate = 0; candidate < CANDIDATE_HEADINGS; candidate += 1) {
			const noise = road.rng.float();
			this.stats.candidates += 1;
			const cos = turns[2 * candidate];
			const sin = turns[2 * candidate + 1];
			const dx = road.headingX * cos - road.headingY * sin;
			const dy = road.headingX * sin + road.headingY * cos;
			let toX = x + STEP_LENGTH * dx;
			let toY = y + STEP_LENGTH * dy;
			let exit = 0;
			if (toX * toX + toY * toY > radiusSquared) {
				// Out to the rim: the root of |(x, y) + t (dx, dy)| = rim past the tip.
				const along = x * dx + y * dy;
				const reach = -along + sqrt(along * along - (fromSquared - rim * rim));
				toX = x + reach * dx;
				toY = y + reach * dy;
				exit = 1;
			}
			if (!isOutward(x, y, toX, toY)) {
				this.stats.rejected.outward += 1;
				continue;
			}
			if (road.avoiding && dx * road.avoidX + dy * road.avoidY > JUNCTION_COS) {
				this.stats.rejected.junction += 1;
				continue;
			}
			const stepCost = terrain.travelCost(toX, toY);
			if (stepCost === INFINITY) {
				this.stats.rejected.passable += 1;
				continue;
			}
			const ahead = this.lookahead(x + SCORE.lookaheadSteps * STEP_LENGTH * dx, y + SCORE.lookaheadSteps * STEP_LENGTH * dy);
			const stray = 1 - (dx * preferredX + dy * preferredY);
			let score = SCORE.cost * stepCost + SCORE.lookahead * ahead + rules.holdCourse * stray
				+ rules.shunRough * this.roughAhead(x, y, dx, dy) + SCORE.crowd * this.rules.crowding(road.id, toX, toY) + SCORE.noise * noise;
			if (rules.wallReach > 0 && exit === 0) score += SCORE.wallAhead * (1 - this.clearAhead(toX, toY, dx, dy, rules.wallReach));
			this.endX[candidate] = toX;
			this.endY[candidate] = toY;
			this.headingX[candidate] = dx;
			this.headingY[candidate] = dy;
			this.stepCost[candidate] = stepCost;
			this.scores[candidate] = score;
			this.exits[candidate] = exit;
			// Insertion into the ranks so far: lower score first, then lower candidate.
			let rank = survivors;
			while (rank > 0 && this.scores[this.order[rank - 1]] > score) {
				this.order[rank] = this.order[rank - 1];
				rank -= 1;
			}
			this.order[rank] = candidate;
			survivors += 1;
		}
		return survivors;
	}

	/** The cost a lookahead sample counts: the travel cost, `SCORE.wall` on impassable ground, and flat off the map. */
	private lookahead(x: number, y: number): number {
		if (!this.rules.inside(x, y)) return 1;
		const cost = this.terrain.travelCost(x, y);
		return cost === INFINITY ? SCORE.wall : cost;
	}

	/**
	 * How much of the way ahead along (dx, dy) is rough country or crater, 0
	 * to 1: lattice lookups and crater circles at `SCORE.roughSamples` points,
	 * the nearest weighted most, so a road starts round an island of cliff
	 * country while it can still bend that far. Points off the map count as
	 * open.
	 */
	private roughAhead(x: number, y: number, dx: number, dy: number): number {
		const samples = SCORE.roughSamples;
		const hotspots = this.terrain.hotspots;
		let rough = 0;
		for (let sample = 1; sample <= samples; sample += 1) {
			const px = x + sample * SCORE.roughSpacing * dx;
			const py = y + sample * SCORE.roughSpacing * dy;
			if (!this.rules.inside(px, py)) break;
			let blocked = this.terrain.rough(px, py);
			for (let hotspot = 0; hotspot < hotspots.length && !blocked; hotspot += 1) {
				const { x: cx, y: cy, craterRadius } = hotspots[hotspot];
				const reach = craterRadius + SCORE.roughSpacing;
				blocked = (px - cx) * (px - cx) + (py - cy) * (py - cy) < reach * reach;
			}
			if (blocked) rough += samples + 1 - sample;
		}
		return rough / (samples * (samples + 1) / 2);
	}

	/**
	 * How much of the way from (x, y) along (dx, dy), out to `reach`, is clear
	 * of impassable ground, 0 to 1: the share before the first impassable
	 * sample. The disc's rim isn't a wall.
	 */
	private clearAhead(x: number, y: number, dx: number, dy: number, reach: number): number {
		const samples = floor(reach / SCORE.wallSpacing);
		for (let sample = 1; sample <= samples; sample += 1) {
			const px = x + sample * SCORE.wallSpacing * dx;
			const py = y + sample * SCORE.wallSpacing * dy;
			if (!this.rules.inside(px, py)) return 1;
			if (this.terrain.impassable(px, py)) return (sample - 1) / samples;
		}
		return 1;
	}

	/** Appends candidate's step to `road` and files it. */
	private accept(road: GrowingRoad, x: number, y: number, candidate: number): void {
		const toX = this.endX[candidate];
		const toY = this.endY[candidate];
		road.points.push(toX, toY);
		road.segments.push(this.index.add(x, y, toX, toY, road.id));
		const dx = this.headingX[candidate];
		const dy = this.headingY[candidate];
		const norm = sqrt(dx * dx + dy * dy);
		road.headingX = dx / norm;
		road.headingY = dy / norm;
		const length = this.exits[candidate] === 1 ? sqrt((toX - x) * (toX - x) + (toY - y) * (toY - y)) : STEP_LENGTH;
		road.length += length;
		road.classLength += length;
		road.sinceJunction += 1;
		road.runningCost += (this.stepCost[candidate] - road.runningCost) * DEGRADE.weight;
		road.avoiding = false;
		this.stats.steps += 1;
	}

	/** A back road whose running cost has passed the threshold becomes a trail from its tip on. Classes never upgrade. */
	private degrade(road: GrowingRoad): void {
		if (road.roadClass !== 'backRoad' || road.runningCost <= this.degradeCost) return;
		const point = road.points.length / 2 - 1;
		road.roadClass = 'trail';
		road.classLength = 0;
		road.cuts.push({ point, node: this.addNode('classChange', road.points[2 * point], road.points[2 * point + 1]), roadClass: 'trail' });
		this.stats.degraded += 1;
	}

	/**
	 * Maybe sprouts a branch at `road`'s tip, once it's `BRANCHING.gap` steps
	 * past its last junction, with a chance by class, branchiness, distance
	 * from the compound, and open room, so branches fill empty country and
	 * leave crowded country be. The branch leaves at an angle drawn between
	 * `BRANCH_ANGLE`'s bounds, on the side with more open room. Draws four
	 * numbers whenever the road could branch, whether it does or not.
	 */
	private branch(road: GrowingRoad): void {
		const chance = ROAD_CLASS_RULES[road.roadClass].branchChance;
		if (chance === 0 || road.sinceJunction < BRANCHING.gap) return;
		const points = road.points;
		const x = points[points.length - 2];
		const y = points[points.length - 1];
		const distance = sqrt(x * x + y * y);
		if (distance > (1 - BRANCHING.rim) * this.radius) return;
		const draw = road.rng.float();
		const angle = BRANCH_ANGLE.min + (BRANCH_ANGLE.max - BRANCH_ANGLE.min) * road.rng.float();
		const kind = road.rng.float();
		const tie = road.rng.float();
		const metroRadius = this.terrain.metro.radius;
		const ramp = clamp01((distance - metroRadius) / (BRANCHING.full * this.radius - metroRadius));
		const most = chance * this.branchScale * (BRANCHING.near + (1 - BRANCHING.near) * ramp);
		if (draw >= most) return;
		unitVector(angle, this.direction);
		const cos = this.direction.x;
		const sin = this.direction.y;
		const leftX = road.headingX * cos - road.headingY * sin;
		const leftY = road.headingX * sin + road.headingY * cos;
		const rightX = road.headingX * cos + road.headingY * sin;
		const rightY = -road.headingX * sin + road.headingY * cos;
		const leftRoom = this.room(road, x, y, leftX, leftY);
		const rightRoom = this.room(road, x, y, rightX, rightY);
		const left = leftRoom > rightRoom || (leftRoom === rightRoom && tie < 0.5);
		const room = left ? leftRoom : rightRoom;
		if (draw >= most * room * room) return;
		this.stats.branches.tried += 1;
		const roadClass: RoadClass = road.roadClass === 'highway'
			? (kind < BRANCHING.interchange ? 'highway' : 'backRoad')
			: (kind < BRANCHING.trail ? 'trail' : 'backRoad');
		if (this.sprout(road, roadClass, x, y, left ? leftX : rightX, left ? leftY : rightY)) this.stats.branches.grown += 1;
	}

	/**
	 * Open room along a heading from (x, y), 0 to 1: the distance to the
	 * nearest other road at points along it, each counting up to a cap, as a
	 * share of the most it could count. Points stop at the disc's rim or on
	 * impassable ground.
	 */
	private room(road: GrowingRoad, x: number, y: number, dx: number, dy: number): number {
		const cap = Math.max(BRANCHING.roomCap, BRANCHING.roomCapClearances * this.clearance);
		const spacing = BRANCHING.roomSpacing * STEP_LENGTH;
		let room = 0;
		for (let probe = 1; probe <= BRANCHING.roomProbes; probe += 1) {
			const px = x + probe * spacing * dx;
			const py = y + probe * spacing * dy;
			if (!this.rules.inside(px, py) || this.terrain.impassable(px, py)) break;
			room += this.index.nearest(px, py, cap, road.id);
		}
		return room / (BRANCHING.roomProbes * cap);
	}

	/**
	 * Grows a branch of `parent` from its tip, heading (dx, dy): a first step
	 * straight along it, then `BRANCHING.probe` - 1 ordinary ones. If any
	 * fails, nothing is kept and the branch isn't made. Otherwise the tip
	 * becomes a junction, the parent's next step keeps 20 degrees from the
	 * branch, and the branch joins the queue.
	 */
	private sprout(parent: GrowingRoad, roadClass: RoadClass, x: number, y: number, dx: number, dy: number): boolean {
		const id = this.roads.length;
		this.rules.setRoad(id, parent.id, x, y);
		const toX = x + STEP_LENGTH * dx;
		const toY = y + STEP_LENGTH * dy;
		if (this.rules.broken(id, x, y, toX, toY) !== null) return false;
		const startCost = this.terrain.travelCost(toX, toY);
		if (startCost === INFINITY) return false;
		const drift = driftKnots({
			rng: this.rng.fork('drift', id),
			span: this.radius - sqrt(x * x + y * y),
			amplitude: ROAD_CLASS_RULES[roadClass].drift * this.params.curviness,
		});
		const road = this.createRoad({ id, parent: parent.id, roadClass, drift, baseX: dx, baseY: dy, points: [x, y, toX, toY] });
		road.length = STEP_LENGTH;
		road.classLength = STEP_LENGTH;
		road.sinceJunction = 1;
		road.runningCost += (startCost - road.runningCost) * DEGRADE.weight;
		this.stats.steps += 1;
		for (let probe = 1; probe < BRANCHING.probe; probe += 1) {
			if (this.advance(road) !== 'step') {
				road.segments.forEach((segment) => this.index.retire(segment));
				return false;
			}
		}
		road.cuts.push({ point: 0, node: this.junctionAt(parent), roadClass });
		parent.sinceJunction = 0;
		parent.avoiding = true;
		parent.avoidX = dx;
		parent.avoidY = dy;
		this.roads.push(road);
		this.enqueue(road);
		return true;
	}

	/** The junction node at `road`'s tip, made a stretch boundary of it. */
	private junctionAt(road: GrowingRoad): number {
		const point = road.points.length / 2 - 1;
		const last = road.cuts[road.cuts.length - 1];
		if (last.point === point) {
			this.nodes[last.node].kind = 'junction';
			return last.node;
		}
		const node = this.addNode('junction', road.points[2 * point], road.points[2 * point + 1]);
		road.cuts.push({ point, node, roadClass: road.roadClass });
		return node;
	}

	/**
	 * Ends `road` at its tip. A node already there stays, but a class change
	 * with nothing after it becomes the end.
	 */
	private end(road: GrowingRoad, kind: 'end' | 'exit'): void {
		const point = road.points.length / 2 - 1;
		const last = road.cuts[road.cuts.length - 1];
		if (last.point === point) {
			if (this.nodes[last.node].kind === 'classChange') this.nodes[last.node].kind = kind;
			return;
		}
		road.cuts.push({ point, node: this.addNode(kind, road.points[2 * point], road.points[2 * point + 1]), roadClass: road.roadClass });
	}

	private enqueue(road: GrowingRoad): void {
		const points = road.points;
		const x = points[points.length - 2];
		const y = points[points.length - 1];
		this.queue.push(road.id, sqrt(x * x + y * y) - ROAD_CLASS_RULES[road.roadClass].lead);
	}

	private addNode(kind: RoadNodeKind, x: number, y: number): number {
		this.nodes.push({ kind, x, y });
		return this.nodes.length - 1;
	}

	/**
	 * Chaikin smoothing, two passes, stretch by stretch with the nodes held
	 * still, so junction angles keep. A smoothed stretch has to keep the step
	 * rules against everything laid so far, the stretches smoothed before it
	 * included; one that doesn't keeps its steps, which already did.
	 */
	private smooth(): void {
		for (const road of this.roads) {
			for (let cut = 0; cut + 1 < road.cuts.length; cut += 1) {
				const first = road.cuts[cut].point;
				const last = road.cuts[cut + 1].point;
				if (last - first < 2) continue;
				const smoothed = chaikin(chaikin(road.points.slice(2 * first, 2 * last + 2)));
				if (!this.keepsRules(road.id, smoothed)) {
					this.stats.stretches.unsmoothed += 1;
					continue;
				}
				for (let segment = first; segment < last; segment += 1) this.index.retire(road.segments[segment]);
				for (let point = 0; point + 3 < smoothed.length; point += 2) {
					this.index.add(smoothed[point], smoothed[point + 1], smoothed[point + 2], smoothed[point + 3], road.id);
				}
				road.curves[cut] = smoothed;
				this.stats.stretches.smoothed += 1;
			}
		}
	}

	private keepsRules(road: number, points: readonly number[]): boolean {
		for (let point = 0; point + 3 < points.length; point += 2) {
			if (this.rules.broken(road, points[point], points[point + 1], points[point + 2], points[point + 3]) !== null) return false;
		}
		return true;
	}

	/** The plain data: nodes, roads, and stretches with their parents. */
	private network(): RoadNetwork {
		const stretches: RoadStretch[] = [];
		const roads: Road[] = [];
		/** The stretch ending at each node, which a branch from it leads on from. */
		const into = new Map<number, number>();
		for (const road of this.roads) {
			const ids: number[] = [];
			for (let cut = 0; cut + 1 < road.cuts.length; cut += 1) {
				const start = road.cuts[cut];
				const finish = road.cuts[cut + 1];
				const id = stretches.length;
				const parent = cut > 0 ? ids[cut - 1] : road.parent === -1 ? -1 : (into.get(start.node) as number);
				const points = road.curves[cut] ?? road.points.slice(2 * start.point, 2 * finish.point + 2);
				stretches.push({ road: road.id, roadClass: start.roadClass, from: start.node, to: finish.node, parent, points });
				into.set(finish.node, id);
				ids.push(id);
			}
			roads.push({ roadClass: road.startClass, parent: road.parent, from: road.cuts[0].node, stretches: ids });
		}
		const nodes: RoadNode[] = this.nodes.map(({ kind, x, y }) => ({ kind, x, y }));
		return { nodes, roads, stretches };
	}
}

/**
 * Growth's queue: a min-heap of road ids keyed by their tips' distance from
 * the compound, less their class's lead, ties to the lower id. A road is in
 * it at most once; pushing it again after a pop re-keys it.
 */
export class TipQueue {
	private readonly heap: number[] = [];
	private readonly keys: number[] = [];

	public get size(): number {
		return this.heap.length;
	}

	public push(id: number, key: number): void {
		this.keys[id] = key;
		const heap = this.heap;
		let at = heap.length;
		heap.push(id);
		while (at > 0) {
			const up = (at - 1) >> 1;
			if (!this.before(id, heap[up])) break;
			heap[at] = heap[up];
			at = up;
		}
		heap[at] = id;
	}

	public pop(): number {
		const heap = this.heap;
		const top = heap[0];
		const last = heap.pop() as number;
		if (heap.length > 0) {
			let at = 0;
			for (;;) {
				const left = 2 * at + 1;
				if (left >= heap.length) break;
				const right = left + 1;
				const child = right < heap.length && this.before(heap[right], heap[left]) ? right : left;
				if (!this.before(heap[child], last)) break;
				heap[at] = heap[child];
				at = child;
			}
			heap[at] = last;
		}
		return top;
	}

	private before(a: number, b: number): boolean {
		const keys = this.keys;
		return keys[a] < keys[b] || (keys[a] === keys[b] && a < b);
	}
}

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}
