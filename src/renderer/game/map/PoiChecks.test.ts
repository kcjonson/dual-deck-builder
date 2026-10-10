import { Rng } from '../core/Rng';
import { fakeGround, randomMesh } from './meshTesting';
import { PoiRule, checkPoiLayer } from './PoiChecks';
import { Poi, PoiLayer, placePois } from './Pois';
import { RouteTree, buildRouteTree, splitNode } from './RouteTree';

describe('checkPoiLayer', () => {
	const network = randomMesh({ seed: 41 });
	const tree = buildRouteTree({ network, travelPace: 1, routeSplit: 0.5 });
	const layer = placePois({ network, tree, ground: fakeGround(), params: { strongholds: 4, poiDensity: 1 }, rng: new Rng({ seed: 41 }) });
	const check = (changed: PoiLayer, changedTree: RouteTree = tree) => checkPoiLayer({ network, tree: changedTree, layer: changed, params: { strongholds: 4, routeSplit: 0.5 }, radius: 1000 });
	const rules = (changed: PoiLayer, changedTree?: RouteTree): PoiRule[] => [...new Set(check(changed, changedTree).map(({ rule }) => rule))];
	const withPoi = (index: number, poi: Poi): PoiLayer => ({ ...layer, pois: layer.pois.map((each, at) => (at === index ? poi : each)) });
	const onStretch = layer.pois.findIndex(({ site, type }) => site.stretch >= 0 && type !== 'stronghold');

	it('passes a placed layer', () => {
		expect(check(layer)).toEqual([]);
	});

	it('catches a POI on a stretch a way home uses', () => {
		const poi = layer.pois[onStretch];
		const used = tree.parentStretch[poi.arrivals[0].from];
		expect(rules(withPoi(onStretch, { ...poi, site: { ...poi.site, stretch: used } }))).toContain('destination');
	});

	it('catches a POI at a stretch\'s end', () => {
		const poi = layer.pois[onStretch];
		expect(check(withPoi(onStretch, { ...poi, site: { ...poi.site, along: 0 } }))[0].detail).toMatch(/not inside it/);
	});

	it('catches routes that share road too far out', () => {
		const poi = layer.pois[onStretch];
		const strict = checkPoiLayer({ network, tree, layer, params: { strongholds: 4, routeSplit: 0 }, radius: 1000 });
		// Most POIs' routes leave the compound together, so with no shared road allowed they fail.
		expect(layer.pois.some(({ arrivals }) => splitNode(tree, arrivals[0].from, arrivals[1].from) !== 0)).toBe(true);
		expect(strict.map(({ rule }) => rule)).toContain('choice');
		expect(rules(withPoi(onStretch, { ...poi, arrivals: [poi.arrivals[0]] }))).toContain('choice');
	});

	it('catches a way home that isn\'t a tree', () => {
		const broken = { ...tree, parentNode: tree.parentNode.slice() };
		broken.parentNode[5] = 5;
		expect(rules(layer, broken)).toEqual(['tree']);
	});

	it('catches POIs too close together, and strongholds out of their sectors', () => {
		const [first, second] = [layer.pois[0], layer.pois[1]];
		expect(rules(withPoi(1, { ...second, site: { ...second.site, x: first.site.x + 1, y: first.site.y } }))).toContain('spacing');
		expect(rules({ ...layer, sectorRotation: layer.sectorRotation + 45 })).toContain('sectors');
		expect(rules({ ...layer, strongholds: layer.strongholds.slice(1) })).toEqual(['sectors']);
	});

	it('catches a leg that doesn\'t carry on from its parent', () => {
		const legs = layer.legs.map((leg, id) => (id === 1 ? { ...leg, from: leg.from + 1 } : leg));
		expect(rules({ ...layer, legs })).toContain('legs');
	});
});
