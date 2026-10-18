import { legCapacity, playGenCell, summarizeGen } from './Gen';
import { simConfig } from './SimConfig';

describe('balance sim gen', () => {
	test('a leg holds the stops its length leaves room for, clear of its ends', () => {
		expect(legCapacity({ length: 10 })).toBe(0);
		expect(legCapacity({ length: 70 })).toBe(1);
		expect(legCapacity({ length: 200 })).toBe(4);
	});

	test('a map audits every route to every POI, and the summary counts them by tier', () => {
		const config = simConfig({ seed: 1, maps: 1 });
		const map = playGenCell({ config, cell: { name: 'map-1', seed: 1 } });
		expect(map.failed).toBeNull();
		// Seed 1 on today's generator; a generator change that moves these moves the Baseline too
		expect(map.routes).toHaveLength(75);
		expect(map.routes.reduce((sum, { audit }) => sum + audit.stops, 0)).toBe(411);
		expect(map.routes.reduce((sum, { audit }) => sum + audit.fights, 0)).toBe(95);
		expect(map.routes.reduce((sum, { audit }) => sum + audit.ownStops, 0)).toBe(76);
		for (const { legs, audit, poi, destination } of map.routes) {
			expect(destination.id).toBe(`poi-${poi}`);
			const stops = legs.flatMap(leg => leg.stops);
			expect(audit.stops).toBe(stops.length);
			expect(audit.ownStops).toBeLessThanOrEqual(audit.stops);
			expect(audit.ownFights).toBeLessThanOrEqual(audit.fights);
			if (audit.neighbor) expect(audit.neighbor.cleared.length).toBeLessThanOrEqual(audit.stops);
		}
		const summary = summarizeGen({ config, maps: [map] });
		expect(summary.tiers.reduce((sum, tier) => sum + tier.routes, 0)).toBe(map.routes.length);
	});
});
