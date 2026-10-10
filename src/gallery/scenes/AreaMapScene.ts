import { Text } from '../../renderer/engine/components/Text';
import { tokens } from '../../renderer/engine/theme/tokens';
import { rgba } from '../../renderer/engine/ui/surfaces';
import { ENVIRONMENTS, Environment, MAP_PARAMETERS } from '../../renderer/game/map/MapParams';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import { AreaMapView } from '../../renderer/game/ui/areaMap/AreaMapView';
import { AreaMapData, revealedBounds } from '../../renderer/game/ui/areaMap/layers';
import type { SceneFactoryOptions } from '../registry';
import { fixtureAreaMap, fixtureFog, fixtureKnowledge, fixtureMarkers } from './areaMapFixtures';

export type AreaMapSceneMode = 'whole' | 'fog';

const NOTE_HEIGHT = 20;
const VIEW_HEIGHT = 680;

/**
 * The area map view (DDB-298) over a generated map.
 *
 * - `whole`: a 1600-radius map, the largest the tuning ranges allow, with
 *   nothing yet to hide: terrain, every road charted, junctions, and the
 *   compound, the camera fitted to the disc. It's also the map the view's
 *   draw calls and frame cost are measured on. The URL can ask for another
 *   map and a closer frame (`readAreaMapQuery`).
 * - `fog`: a 1000-radius map with typed stand-ins for the stages not built
 *   yet: a starting reveal's knowledge (charted, rumored, uncharted stubs),
 *   land fog, POIs in each state, a stronghold found in the fog, and a POI
 *   selected, the camera fitted to what's uncovered.
 *
 * Gallery only, until the Map Lab section (DDB-299) hosts the view.
 */
export class AreaMapScene extends DeveloperSectionPanel {
	public readonly view: AreaMapView;

	constructor({ mode, x, y, width, search = '' }: SceneFactoryOptions & { mode: AreaMapSceneMode; search?: string }) {
		super({ id: `gallery_scene_area_map_${mode}`, title: 'Area map', x, y, width });
		const query = readAreaMapQuery(search);
		this.view = mode === 'whole' ? wholeMap(query) : fogMap();
		this.addChild(new Text({
			text: mode === 'whole'
				? `Seed ${query.seed}, ${environmentLabel(query.environment)}, radius ${query.radius}: terrain baked once, every road charted. Drag to pan, wheel to zoom, click to select.`
				: 'Seed 3, Mixed, radius 1000: stand-in knowledge, fog, and markers. Charted solid, rumored pale, uncharted dashed into the fog.',
			height: NOTE_HEIGHT,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));
		this.addChild(this.view);
	}
}

/** What the `whole` scene draws: the map's seed, environment, and radius, and the square of the world to frame, or null for the whole disc. */
export interface AreaMapQuery {
	readonly seed: number;
	readonly environment: Environment;
	readonly radius: number;
	readonly frame: { x: number; y: number; width: number; height: number } | null;
}

const WHOLE_MAP: AreaMapQuery = { seed: 7, environment: 'mixed', radius: 1600, frame: null };

/**
 * The `whole` scene's map and framing from a gallery URL, so before and
 * after shots can show the same ground: `seed`, `environment`, and `radius`
 * pick the map, and `x`, `y`, and `span` frame a square `span` world units
 * across centred on (x, y), north up. Anything missing or unreadable keeps
 * the default, seed 7, Mixed, radius 1600, the disc whole; the radius is
 * held to the tuning range by the validator.
 */
export function readAreaMapQuery(search: string): AreaMapQuery {
	const query = new URLSearchParams(search);
	const number = (name: string): number | null => {
		const text = query.get(name);
		const value = text === null || text.trim() === '' ? NaN : Number(text);
		return Number.isFinite(value) ? value : null;
	};
	const environmentName = query.get('environment');
	const environment = ENVIRONMENTS.find((name) => name === environmentName) ?? WHOLE_MAP.environment;
	const seed = number('seed');
	const radius = number('radius');
	const x = number('x');
	const y = number('y');
	const span = number('span');
	return {
		seed: seed !== null && Number.isInteger(seed) ? seed : WHOLE_MAP.seed,
		environment,
		radius: radius ?? WHOLE_MAP.radius,
		frame: x !== null && y !== null && span !== null && span > 0 ? { x: x - span / 2, y: y - span / 2, width: span, height: span } : null,
	};
}

function environmentLabel(environment: Environment): string {
	return MAP_PARAMETERS.environment.options.find(({ value }) => value === environment)?.label ?? environment;
}

function wholeMap({ seed, environment, radius, frame }: AreaMapQuery): AreaMapView {
	const view = new AreaMapView({
		id: 'area_map_whole',
		widthMode: 'fill',
		height: VIEW_HEIGHT,
		map: fixtureAreaMap({ seed, environment, radius }),
	});
	if (frame) view.camera.fit(frame);
	return view;
}

function fogMap(): AreaMapView {
	const radius = 1000;
	const map: AreaMapData = fixtureAreaMap({ seed: 3, environment: 'mixed', radius });
	const reach = 430;
	const knowledge = fixtureKnowledge(map.network, { reach, rumored: 2 });
	const fog = fixtureFog(map.network, knowledge, { radius, reach: reach * 0.8, sight: 100 });
	const markers = fixtureMarkers(map.network, knowledge, {
		pois: [
			{ id: 'hospital', label: 'St. Brendan\'s Hospital' },
			{ id: 'water_plant', label: 'Water plant (looted)', state: 'looted' },
			{ id: 'silos', label: 'Grain silos' },
			{ id: 'fuel_depot', label: 'Fuel Depot 9 (depleted)', state: 'depleted' },
		],
		stronghold: { id: 'rust_vultures', label: 'Rust Vulture yard' },
		spacing: 200,
		within: reach * 1.15,
		strongholdBeyond: reach * 1.3,
	});
	const view = new AreaMapView({
		id: 'area_map_fog',
		widthMode: 'fill',
		height: VIEW_HEIGHT,
		map,
		knowledge,
		fog,
		markers,
		selection: { kind: 'marker', id: 'hospital' },
	});
	const uncovered = revealedBounds(fog, radius);
	const stronghold = markers.find((marker) => marker.kind === 'stronghold');
	if (uncovered) {
		const frame = stronghold ? unionPoint(uncovered, stronghold.x, stronghold.y, 60) : uncovered;
		view.camera.fit(frame);
	}
	return view;
}

function unionPoint(rect: { x: number; y: number; width: number; height: number }, x: number, y: number, pad: number): { x: number; y: number; width: number; height: number } {
	const minX = Math.min(rect.x, x - pad);
	const minY = Math.min(rect.y, y - pad);
	const maxX = Math.max(rect.x + rect.width, x + pad);
	const maxY = Math.max(rect.y + rect.height, y + pad);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
