import { Rng } from '../../renderer/game/core/Rng';
import { planHighways } from '../../renderer/game/map/Highways';
import { MapParamSet, resolveMapParams } from '../../renderer/game/map/MapParams';
import { validateMapParams } from '../../renderer/game/map/ParamValidator';
import { growRoads } from '../../renderer/game/map/RoadGrowth';
import type { RoadNetwork } from '../../renderer/game/map/RoadNetwork';
import { generateTerrain } from '../../renderer/game/map/Terrain';
import type {
	AreaMapData,
	LandFogLayer,
	MapMarker,
	PoiState,
	RoadKnowledge,
	RoadKnowledgeLayer,
} from '../../renderer/game/ui/areaMap/layers';

/**
 * Typed stand-ins for what later stages generate, so the gallery draws every
 * path of the area map view before those stages exist: knowledge (DDB-294),
 * fog (DDB-294), and POI and stronghold markers (DDB-291). Each is built
 * from the grown network by a plain rule, not by the spec's, and none is
 * game code.
 */

/** Stages 1 to 3 on the pipeline's streams: the terrain and the drivable network. */
export function generateAreaMap(set: MapParamSet): AreaMapData {
	const { params } = validateMapParams(resolveMapParams(set).params);
	const map = new Rng({ seed: params.seed }).fork('map', 0);
	const terrain = generateTerrain({ params, rng: map.fork('terrain', 0) });
	const highways = planHighways({ terrain, params, rng: map.fork('highways', 0) });
	const { network } = growRoads({ terrain, params, highways, rng: map.fork('growth', 0) });
	return { terrain, network };
}

/**
 * A starting reveal of sorts: stretches that end within `reach` of the
 * compound charted, each highway's next stretch past that charted too, and
 * the first `rumored` back roads leaving charted road rumored. The rest are
 * uncharted, which the view draws as stubs where they leave known road.
 */
export function fixtureKnowledge(network: RoadNetwork, { reach, rumored }: { reach: number; rumored: number }): RoadKnowledgeLayer {
	const states: RoadKnowledge[] = network.stretches.map((stretch) => {
		const end = network.nodes[stretch.to];
		return Math.hypot(end.x, end.y) <= reach ? 'charted' : 'uncharted';
	});
	network.stretches.forEach((stretch, id) => {
		if (states[id] === 'uncharted' && stretch.roadClass === 'highway' && (stretch.parent < 0 || states[stretch.parent] === 'charted')) {
			const start = network.nodes[stretch.from];
			if (Math.hypot(start.x, start.y) <= reach) states[id] = 'charted';
		}
	});
	let left = rumored;
	network.stretches.forEach((stretch, id) => {
		if (left > 0 && states[id] === 'uncharted' && stretch.roadClass === 'backRoad' && stretch.parent >= 0 && states[stretch.parent] === 'charted') {
			states[id] = 'rumored';
			left -= 1;
		}
	});
	return { knowledgeOf: (stretch: number) => states[stretch] };
}

/** Land within `sight` of a charted or rumored road, or `reach` of the compound, revealed on a 64-cell grid. */
export function fixtureFog(network: RoadNetwork, knowledge: RoadKnowledgeLayer, { radius, reach, sight }: { radius: number; reach: number; sight: number }): LandFogLayer {
	const cells = 64;
	const side = (radius * 2) / cells;
	const revealed = new Uint8Array(cells * cells);
	const reveal = (x: number, y: number, distance: number): void => {
		const first = Math.max(0, Math.floor((x - distance + radius) / side));
		const last = Math.min(cells - 1, Math.floor((x + distance + radius) / side));
		const bottom = Math.max(0, Math.floor((y - distance + radius) / side));
		const top = Math.min(cells - 1, Math.floor((y + distance + radius) / side));
		for (let row = bottom; row <= top; row++) {
			for (let column = first; column <= last; column++) {
				const centreX = -radius + (column + 0.5) * side;
				const centreY = -radius + (row + 0.5) * side;
				if (Math.hypot(centreX - x, centreY - y) <= distance) revealed[row * cells + column] = 1;
			}
		}
	};
	reveal(0, 0, reach);
	network.stretches.forEach((stretch, id) => {
		if (knowledge.knowledgeOf(id) === 'uncharted') return;
		for (let point = 0; point + 1 < stretch.points.length; point += 8) reveal(stretch.points[point], stretch.points[point + 1], sight);
	});
	return { cells, isRevealed: (column: number, row: number) => revealed[row * cells + column] === 1 };
}

export interface FixtureMarkerSpec {
	id: string;
	label: string;
	state?: PoiState;
}

/**
 * POIs at dead ends within `within` of the compound, farthest first so they
 * spread round the map: one per spec, in order, each at least `spacing` from
 * the ones before. A stronghold goes at the nearest dead end of an
 * uncharted road at least `strongholdBeyond` out, found in the fog.
 */
export function fixtureMarkers(
	network: RoadNetwork,
	knowledge: RoadKnowledgeLayer,
	{ pois, stronghold, spacing, within, strongholdBeyond }: { pois: readonly FixtureMarkerSpec[]; stronghold: FixtureMarkerSpec; spacing: number; within: number; strongholdBeyond: number },
): MapMarker[] {
	const ends = network.stretches
		.map((stretch, id) => ({ id, node: network.nodes[stretch.to] }))
		.filter(({ node }) => node.kind === 'end');
	const known = ends
		.filter(({ node }) => Math.hypot(node.x, node.y) <= within)
		.sort((a, b) => Math.hypot(b.node.x, b.node.y) - Math.hypot(a.node.x, a.node.y));
	const markers: MapMarker[] = [];
	for (const spec of pois) {
		const end = known.find(({ node }) => markers.every((marker) => Math.hypot(marker.x - node.x, marker.y - node.y) >= spacing));
		if (!end) break;
		markers.push({ id: spec.id, kind: 'poi', x: end.node.x, y: end.node.y, label: spec.label, state: spec.state });
	}
	const far = ends
		.filter(({ id, node }) => knowledge.knowledgeOf(id) === 'uncharted' && Math.hypot(node.x, node.y) >= strongholdBeyond)
		.sort((a, b) => Math.hypot(a.node.x, a.node.y) - Math.hypot(b.node.x, b.node.y))[0];
	if (far) markers.push({ id: stronghold.id, kind: 'stronghold', x: far.node.x, y: far.node.y, label: stronghold.label });
	return markers;
}
