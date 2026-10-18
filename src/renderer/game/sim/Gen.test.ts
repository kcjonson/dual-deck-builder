import { legCapacity, playGenCell, summarizeGen } from './Gen';
import { simConfig } from './SimConfig';

describe('balance sim gen', () => {
	test('a leg holds the stops its length leaves room for, clear of its ends', () => {
		expect(legCapacity(10)).toBe(0);
		expect(legCapacity(70)).toBe(1);
		expect(legCapacity(200)).toBe(4);
	});

	test('a map audits every route to every POI, and the summary counts them by tier', () => {
		const config = simConfig({ seed: 1, maps: 1 });
		const map = playGenCell({ config, cell: { name: 'map-1', seed: 1 } });
		expect(map.failed).toBeNull();
		expect(map.routes.length).toBeGreaterThan(0);
		for (const { legs, audit } of map.routes) {
			const stops = legs.flatMap(leg => leg.stops);
			expect(audit.stops).toBe(stops.length);
			expect(audit.fights + audit.empty).toBe(audit.stops);
			expect(audit.ownStops).toBeLessThanOrEqual(audit.stops);
			expect(audit.ownFights).toBeLessThanOrEqual(audit.fights);
			if (audit.neighbor) expect(audit.neighbor.cleared.length).toBeLessThanOrEqual(audit.stops);
		}
		const summary = summarizeGen({ config, maps: [map] });
		expect(summary.tiers.reduce((sum, tier) => sum + tier.routes, 0)).toBe(map.routes.length);
	});
});
