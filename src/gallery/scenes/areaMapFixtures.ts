import { generateAreaMap } from '../../renderer/game/map/AreaMapPipeline';
import { MapParamSet, resolveMapParams } from '../../renderer/game/map/MapParams';
import { validateMapParams } from '../../renderer/game/map/ParamValidator';
import type { PoiLayer } from '../../renderer/game/map/Pois';
import type { RoadNetwork } from '../../renderer/game/map/RoadNetwork';
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
 * path of the area map view before those stages exist: knowledge and fog
 * (DDB-294), each built from the network by a plain rule, not by the spec's,
 * and markers for some of the map's own POIs and a stronghold, with labels
 * and states of the fixture's. None is game code.
 */

/** A generated map as the view draws it, with the POIs the pipeline placed on it. */
export interface FixtureAreaMap extends AreaMapData {
	readonly pois: PoiLayer;
}

/** The area map's stages as they stand, through the pipeline runner: the land with its water and hazards, the rivers, the places, the road network, and its POIs. */
export function fixtureAreaMap(set: MapParamSet): FixtureAreaMap {
	const { params } = validateMapParams(resolveMapParams(set).params);
	const { water, hazards, places, roads, pois } = generateAreaMap({ params }).products;
	return { terrain: hazards.terrain, network: roads.network, rivers: water.lines, places, pois };
}

/**
 * A starting reveal of sorts: stretches with both ends within `reach` of the
 * compound charted, each highway stretch leaving that charted too, and the
 * first `rumored` back roads leaving charted road rumored. The rest are
 * uncharted, which the view draws as stubs where they leave known road.
 */
export function fixtureKnowledge(network: RoadNetwork, { reach, rumored }: { reach: number; rumored: number }): RoadKnowledgeLayer {
	const near = (node: number) => Math.hypot(network.nodes[node].x, network.nodes[node].y) <= reach;
	const states: RoadKnowledge[] = network.stretches.map((stretch) => (near(stretch.from) && near(stretch.to) ? 'charted' : 'uncharted'));
	const charted = new Set<number>([0]);
	network.stretches.forEach((stretch, id) => {
		if (states[id] === 'charted') [stretch.from, stretch.to].forEach((node) => charted.add(node));
	});
	network.stretches.forEach((stretch, id) => {
		if (states[id] === 'uncharted' && stretch.roadClass === 'highway' && charted.has(stretch.from) && near(stretch.from)) states[id] = 'charted';
	});
	let left = rumored;
	network.stretches.forEach((stretch, id) => {
		if (left > 0 && states[id] === 'uncharted' && stretch.roadClass === 'backRoad' && charted.has(stretch.from)) {
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
 * The map's own POIs within `within` of the compound, farthest first so they
 * spread round the map: one per spec, in order, each at least `spacing` from
 * the ones before. The stronghold marker goes on the map's nearest
 * stronghold at least `strongholdBeyond` out.
 */
export function fixtureMarkers(
	layer: PoiLayer,
	{ pois, stronghold, spacing, within, strongholdBeyond }: { pois: readonly FixtureMarkerSpec[]; stronghold: FixtureMarkerSpec; spacing: number; within: number; strongholdBeyond: number },
): MapMarker[] {
	const sites = layer.pois.map(({ site, type }) => ({ x: site.x, y: site.y, out: Math.hypot(site.x, site.y), stronghold: type === 'stronghold' }));
	const known = sites.filter(({ out, stronghold: held }) => !held && out <= within).sort((a, b) => b.out - a.out);
	const markers: MapMarker[] = [];
	for (const spec of pois) {
		const site = known.find(({ x, y }) => markers.every((marker) => Math.hypot(marker.x - x, marker.y - y) >= spacing));
		if (!site) break;
		markers.push({ id: spec.id, kind: 'poi', x: site.x, y: site.y, label: spec.label, state: spec.state });
	}
	const far = sites.filter(({ out, stronghold: held }) => held && out >= strongholdBeyond).sort((a, b) => a.out - b.out)[0];
	if (far) markers.push({ id: stronghold.id, kind: 'stronghold', x: far.x, y: far.y, label: stronghold.label });
	return markers;
}
