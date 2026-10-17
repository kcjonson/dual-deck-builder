import { Rng } from '../core/Rng';
import { AreaMapGeneration, DRESSING_STAGE, generateAreaMap } from './AreaMapPipeline';
import { Dressing, HATCH, dressingScale } from './Dressing';
import { MapLabelKind } from './MapLabels';
import { MAP_PARAMETERS, MapParams } from './MapParams';
import { STRONGHOLD_TYPE } from './PoiData';
import { poiNames } from './PoiNames';
import { STREET_GRIDS } from './StreetGrids';
import { paramsFor } from './roadTesting';

/** Everything a gameplay stage made, and how the run got there, less the dressing: what play reads. */
function gameplayOf(map: AreaMapGeneration): unknown {
	const { water, hazards, places, roads, routeTree, pois, stops } = map.products;
	const attempts: Record<string, number> = { ...map.attempts };
	const streams: Record<string, number> = { ...map.streams };
	delete attempts.dressing;
	delete streams.dressing;
	return JSON.parse(JSON.stringify({
		rivers: water.rivers, lines: Array.from(water.lines.points), lakes: water.lakes, hotspots: hazards.hotspots, places, roads, routeTree, pois, stops,
		mapAttempt: map.mapAttempt, attempts, streams,
	}));
}

/** The land and its water as the grid stages left them: the eroded surface, the badlands, and every field of the water. */
function landOf(map: AreaMapGeneration): unknown {
	const { terrain, water } = map.products;
	return { surface: terrain.surface, badlands: terrain.badlandsCells, water: water.surface };
}

/** The dressing again on a map's own products, on its own stream, for other dressing params. */
function redress(map: AreaMapGeneration, params: Partial<MapParams>): Dressing {
	return DRESSING_STAGE.run({ input: { ...map.params, ...params }, products: map.products, rng: new Rng({ seed: map.streams.dressing }) });
}

const GAMEPLAY_LABELS: readonly MapLabelKind[] = ['metro', 'town', 'village', 'poi', 'stronghold', 'shield'];

describe('the dressing', () => {
	const params = paramsFor({ seed: 11, environment: 'rustBelt', radius: 800, railLines: 2 });
	const map = generateAreaMap({ params });
	const { dressing, hazards, places, roads, pois } = map.products;
	const terrain = hazards.terrain;

	it('runs last on its own stream, inert, retrying only itself', () => {
		expect(DRESSING_STAGE).toMatchObject({ name: 'dressing', inert: true, localRetry: true });
		expect(map.streams.dressing).toBe(new Rng({ seed: map.streams.stops }).fork('dressing', 0).seed);
		expect(redress(map, {})).toEqual(dressing);
	});

	it('is the same from the same seed and params, and another from another seed', () => {
		expect(generateAreaMap({ params }).products.dressing).toEqual(dressing);
		expect(redress(map, {}).labels).toEqual(dressing.labels);
		expect(DRESSING_STAGE.run({ input: params, products: map.products, rng: new Rng({ seed: 12 }) })).not.toEqual(dressing);
	});

	it('changes no gameplay: the map with no dressing and with all of it is the same map, for a set of seeds', () => {
		for (const set of [{ seed: 11, environment: 'rustBelt', radius: 800, railLines: 2 }, { seed: 4, environment: 'floodlands', radius: 700 }] as const) {
			const bare = generateAreaMap({ params: paramsFor({ ...set, dressing: 0 }) });
			const full = generateAreaMap({ params: paramsFor({ ...set, dressing: 1 }) });
			expect(gameplayOf(bare)).toEqual(gameplayOf(full));
			expect(landOf(bare)).toEqual(landOf(full));
			const none = bare.products.dressing;
			expect([none.districts, none.rails, none.hatches, Array.from(none.stipple)]).toEqual([[], [], [], []]);
			none.labels.forEach(({ kind }) => expect(GAMEPLAY_LABELS).toContain(kind));
			expect(full.products.dressing.labels.length).toBeGreaterThan(none.labels.length);
		}
		expect(gameplayOf(generateAreaMap({ params: { ...params, dressing: 0 } }))).toEqual(gameplayOf(map));
	});

	it('touches nothing it reads, roads above all, and none of its lines is a road', () => {
		const { water, routeTree, stops } = map.products;
		const before = JSON.stringify({ roads, places, pois, stops, routeTree, hotspots: hazards.hotspots, rivers: water.rivers, lakes: water.lakes });
		const lines = Array.from(water.lines.points);
		redress(map, { dressing: 1, railLines: 4, streetGrids: 1 });
		expect(JSON.stringify({ roads, places, pois, stops, routeTree, hotspots: hazards.hotspots, rivers: water.rivers, lakes: water.lakes })).toBe(before);
		expect(Array.from(water.lines.points)).toEqual(lines);
		const roadLines = new Set([...roads.network.stretches, ...roads.network.broken].map(({ points }) => points));
		dressing.rails.forEach(({ points }) => expect(roadLines.has(points)).toBe(false));
	});

	describe('street grids', () => {
		const metro = dressing.districts.filter(({ kind }) => kind === 'metro');

		it('lay the metro as several districts at different angles, and each town and village a grid of its own', () => {
			expect(metro.length).toBeGreaterThanOrEqual(3);
			metro.forEach((one, index) => metro.slice(index + 1).forEach((other) => {
				// Grids look the same a quarter turn round, so compare their angles modulo 90 degrees.
				const turned = Math.abs(Math.atan2(one.ux * other.uy - one.uy * other.ux, one.ux * other.ux + one.uy * other.uy)) * 180 / Math.PI % 90;
				// Spread a step apart over a quarter turn, each jittered a quarter step at most.
				expect(Math.min(turned, 90 - turned)).toBeGreaterThanOrEqual(90 / metro.length * (1 - 2 * STREET_GRIDS.districts.jitter) - 1e-9);
			}));
			const towns = new Set(dressing.districts.filter(({ kind }) => kind === 'town').map(({ place }) => place));
			expect(towns).toEqual(new Set(places.towns.map(({ id }) => id)));
			dressing.districts.forEach(({ ux, uy, spacing, blocks, rubble }) => {
				expect(ux * ux + uy * uy).toBeCloseTo(1, 12);
				expect(spacing).toBeGreaterThan(0);
				expect(blocks.length % 2).toBe(0);
				expect(rubble.length % 2).toBe(0);
			});
		});

		it('stand no block on water, a crater, or a cliff, nor under a road, a collapsed span, or a rail', () => {
			const wrong: string[] = [];
			for (const { x, y, ux, uy, spacing, blocks, rubble, place } of dressing.districts) {
				const kept = new Set<string>();
				const keyOf = (px: number, py: number) => `${Math.floor(((px - x) * ux + (py - y) * uy) / spacing)},${Math.floor(((px - x) * -uy + (py - y) * ux) / spacing)}`;
				let reach = 0;
				for (const centres of [blocks, rubble]) {
					for (let index = 0; index < centres.length; index += 2) {
						if (terrain.obstacle(centres[index], centres[index + 1]) !== null) wrong.push(`place ${place}: a block on ${terrain.obstacle(centres[index], centres[index + 1])}`);
						kept.add(keyOf(centres[index], centres[index + 1]));
						reach = Math.max(reach, Math.hypot(centres[index] - x, centres[index + 1] - y) + spacing);
					}
				}
				for (const { points } of [...roads.network.stretches, ...roads.network.broken, ...dressing.rails]) {
					for (let index = 0; index + 3 < points.length; index += 2) {
						const length = Math.hypot(points[index + 2] - points[index], points[index + 3] - points[index + 1]);
						if (Math.hypot(points[index] - x, points[index + 1] - y) > reach + length) continue;
						for (let step = 0; step <= 8; step += 1) {
							const px = points[index] + (points[index + 2] - points[index]) * step / 8;
							const py = points[index + 1] + (points[index + 3] - points[index + 1]) * step / 8;
							if (kept.has(keyOf(px, py))) wrong.push(`place ${place}: a line through a block at ${px.toFixed(1)}, ${py.toFixed(1)}`);
						}
					}
				}
			}
			expect(wrong).toEqual([]);
			const standing = dressing.districts.reduce((sum, { blocks }) => sum + blocks.length, 0);
			const fallen = dressing.districts.reduce((sum, { rubble }) => sum + rubble.length, 0);
			expect(standing).toBeGreaterThan(0);
			expect(fallen).toBeGreaterThan(0);
		});

		it('survive more the more built-up the map, and shrink with the dressing below its default', () => {
			const blocks = (dressed: Dressing) => dressed.districts.reduce((sum, { blocks: standing }) => sum + standing.length / 2, 0);
			const rubble = (dressed: Dressing) => dressed.districts.reduce((sum, { rubble: fallen }) => sum + fallen.length / 2, 0);
			const sparse = redress(map, { streetGrids: 0 });
			const dense = redress(map, { streetGrids: 1 });
			expect(blocks(dense) / (blocks(dense) + rubble(dense))).toBeGreaterThan(blocks(sparse) / (blocks(sparse) + rubble(sparse)));
			const thin = redress(map, { dressing: 0.3 });
			expect(blocks(thin) + rubble(thin)).toBeLessThan(blocks(dressing) + rubble(dressing));
			// Above the default the grids keep to streetGrids.
			expect(redress(map, { dressing: 1 }).districts).toEqual(dressing.districts);
		});
	});

	it('lays rail lines rim to rim, clear of lakes, craters, and cliffs, bridging the rivers it crosses', () => {
		expect(dressing.rails).toHaveLength(params.railLines);
		for (const { points, length, bridges } of dressing.rails) {
			for (const [x, y] of [[points[0], points[1]], [points[points.length - 2], points[points.length - 1]]]) expect(Math.hypot(x, y)).toBeCloseTo(params.radius, 6);
			let along = 0;
			let crossed = 0;
			for (let index = 0; index + 3 < points.length; index += 2) {
				const dx = points[index + 2] - points[index];
				const dy = points[index + 3] - points[index + 1];
				const piece = Math.hypot(dx, dy);
				for (let at = 0; at < piece; at += 1) {
					const x = points[index] + dx * at / piece;
					const y = points[index + 1] + dy * at / piece;
					const obstacle = terrain.obstacle(x, y);
					expect(obstacle === null || obstacle === 'river').toBe(true);
					if (terrain.waterAt(x, y) === 'river') {
						crossed += 1;
						expect(bridges.some(({ start, end }) => along + at >= start - 1 && along + at <= end + 1)).toBe(true);
					}
				}
				along += piece;
			}
			expect(along).toBeCloseTo(length, 6);
			bridges.forEach(({ start, end }, index) => {
				expect(start).toBeLessThanOrEqual(end);
				if (index > 0) expect(start).toBeGreaterThan(bridges[index - 1].end);
			});
			expect(bridges.length > 0).toBe(crossed > 0);
		}
		expect(redress(map, { dressing: 0.3 }).rails).toHaveLength(Math.round(params.railLines * dressingScale(0.3)));
	});

	it('hatches each crater\'s plume out to where it fades, and stipples only mire', () => {
		const inside = hazards.hotspots.filter(({ x, y, strength }) => Math.hypot(x, y) <= params.radius && strength > HATCH.level);
		expect(dressing.hatches).toHaveLength(inside.length);
		dressing.hatches.forEach(({ x, y, inner, outer, ux, uy, spacing }) => {
			const hotspot = hazards.hotspots.find((spot) => spot.x === x && spot.y === y);
			expect(inner).toBe(hotspot?.craterRadius);
			expect(outer).toBeGreaterThan(inner);
			// The plume, strength * (1 - d^2 / r^2)^2, is down to the level at the outer edge.
			const share = 1 - (outer * outer) / ((hotspot?.plumeRadius ?? 1) ** 2);
			expect((hotspot?.strength ?? 0) * share * share).toBeCloseTo(HATCH.level, 9);
			expect(ux * ux + uy * uy).toBeCloseTo(1, 12);
			expect(spacing).toBe(HATCH.spacing);
		});
		expect(dressing.stipple.length).toBeGreaterThan(0);
		for (let index = 0; index < dressing.stipple.length; index += 2) {
			expect(terrain.biome(dressing.stipple[index], dressing.stipple[index + 1])).toBe('mire');
			expect(terrain.waterAt(dressing.stipple[index], dressing.stipple[index + 1])).toBeNull();
		}
		expect(redress(map, { dressing: 1 }).stipple.length).toBeGreaterThan(dressing.stipple.length);
	});

	describe('labels', () => {
		const { labels } = dressing;
		const names = poiNames(pois, { places, radius: params.radius });

		it('come highest priority first, the metro in capitals over everything', () => {
			labels.forEach((label, index) => {
				if (index > 0) expect(label.priority).toBeLessThanOrEqual(labels[index - 1].priority);
			});
			expect(labels[0]).toMatchObject({ kind: 'metro', text: dressing.metroName.toUpperCase(), ref: 0 });
			expect([...places.towns, ...places.villages].map(({ name }) => name)).not.toContain(dressing.metroName);
		});

		it('name every town, village, POI, and stronghold, and shield every highway with its route number', () => {
			const refs = (kind: MapLabelKind) => new Set(labels.filter((label) => label.kind === kind).map(({ ref }) => ref));
			expect(refs('town')).toEqual(new Set(places.towns.map(({ id }) => id)));
			expect(refs('village')).toEqual(new Set(places.villages.map(({ id }) => id)));
			pois.pois.forEach(({ type }, index) => {
				const label = labels.find((one) => (one.kind === 'poi' || one.kind === 'stronghold') && one.ref === index);
				expect(label).toMatchObject({ kind: type === STRONGHOLD_TYPE ? 'stronghold' : 'poi', text: names[index] });
			});
			const highways = new Set(roads.network.stretches.filter(({ highway, street }) => highway !== undefined && !street).map(({ highway }) => highway));
			expect(refs('shield')).toEqual(highways);
			labels.filter(({ kind }) => kind === 'shield').forEach(({ text, ref }) => expect(text).toBe(String(dressing.routeNumbers[ref])));
			expect(new Set(dressing.routeNumbers).size).toBe(dressing.routeNumbers.length);
			expect(dressing.routeNumbers).toHaveLength(places.exits.filter(({ highway }) => highway).length);
		});

		it('set rivers along their courses and ranges along their long axes, inside the disc, and name the land\'s features no two alike', () => {
			for (const kind of ['river', 'range'] as const) {
				const lined = labels.filter((label) => label.kind === kind);
				expect(lined.length).toBeGreaterThan(0);
				lined.forEach(({ path }) => {
					expect(path.length).toBeGreaterThanOrEqual(4);
					for (let index = 0; index < path.length; index += 2) expect(Math.hypot(path[index], path[index + 1])).toBeLessThanOrEqual(params.radius);
				});
			}
			const features = new Map<string, string>();
			labels.filter(({ kind }) => ['river', 'range', 'lake', 'reservoir', 'pass'].includes(kind)).forEach(({ kind, text, ref }) => {
				const key = `${kind === 'reservoir' ? 'lake' : kind} ${ref}`;
				expect(features.get(key) ?? text).toBe(text);
				features.set(key, text);
			});
			expect(new Set(features.values()).size).toBe(features.size);
			labels.filter(({ kind }) => kind === 'pass').forEach(({ ref }) => expect(ref).toBeLessThan(roads.network.passes.length));
		});

		it('name the land\'s features the same whatever the dressing, labelling more of them as it rises', () => {
			const textOf = (dressed: Dressing) => new Map(dressed.labels.filter(({ kind }) => !GAMEPLAY_LABELS.includes(kind)).map(({ kind, ref, text }) => [`${kind} ${ref}`, text]));
			const sparse = textOf(redress(map, { dressing: MAP_PARAMETERS.dressing.campaign.min }));
			const full = textOf(redress(map, { dressing: 1 }));
			expect(full.size).toBeGreaterThan(sparse.size);
			sparse.forEach((text, key) => expect(full.get(key)).toBe(text));
		});
	});
});
