import type { RoadNetwork } from '../map/RoadNetwork';
import { legCapacity, playGenCell, summarizeGen } from './Gen';
import { simConfig } from './SimConfig';

describe('balance sim gen', () => {
	test('a leg holds the stops its length leaves room for at the tight gap, clear of its ends', () => {
		const network = { nodes: [{ x: 0, y: 0 }, { x: 200, y: 0 }], stretches: [] } as unknown as RoadNetwork;
		const leg = (length: number) => ({ length, pieces: [{ stretch: 0, forward: true, length }] });
		// 12 apart, half a gap in from 15 units at each end
		expect(legCapacity({ network, leg: leg(10) })).toBe(0);
		expect(legCapacity({ network, leg: leg(42) })).toBe(1);
		expect(legCapacity({ network, leg: leg(54) })).toBe(2);
		expect(legCapacity({ network, leg: leg(200) })).toBe(14);
	});

	test('a map audits every route to every POI, and the summary counts them by tier', () => {
		const config = simConfig({ seed: 1, maps: 1 });
		const map = playGenCell({ config, cell: { name: 'map-1', seed: 1 } });
		expect(map.failed).toBeNull();
		// Seed 1 on today's generator; a generator change that moves these moves the Baseline too
		expect(map.routes).toHaveLength(55);
		expect(map.routes.reduce((sum, { audit }) => sum + audit.stops, 0)).toBe(261);
		expect(map.routes.reduce((sum, { audit }) => sum + audit.fights, 0)).toBe(96);
		expect(map.routes.reduce((sum, { audit }) => sum + audit.ownStops, 0)).toBe(133);
		for (const { legs, audit, poi, destination } of map.routes) {
			expect(destination.id).toBe(`poi-${poi}`);
			const stops = legs.flatMap(leg => leg.stops);
			expect(audit.stops).toBe(stops.length);
			expect(audit.ownStops).toBeLessThanOrEqual(audit.stops);
			expect(audit.ownFights).toBeLessThanOrEqual(audit.fights);
			if (audit.neighbor) expect(audit.neighbor.cleared.length).toBeLessThanOrEqual(audit.stops);
			// Every route has a fight, its floor on its own road, and no stop the run can't resolve.
			expect(audit.fights).toBeGreaterThan(0);
			expect(audit.ownFights).toBeGreaterThan(0);
			expect(audit.empty).toBe(0);
		}
		const summary = summarizeGen({ config, maps: [map] });
		expect(summary.tiers.reduce((sum, tier) => sum + tier.routes, 0)).toBe(map.routes.length);
	});
});
