import { Rng } from '../core/Rng';
import { HOTSPOT_SPACING, MAX_CRATER_RADIUS, placeHotspots } from './TerrainSites';

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const fromCentre = (point: { x: number; y: number }) => Math.hypot(point.x, point.y);
const SEEDS = Array.from({ length: 40 }, (_, index) => (index * 2654435761 + 7) >>> 0);

describe('placeHotspots', () => {
	const ring = { inner: 300, outer: 900 };
	const place = (seed: number, count = 6, radius = 1000) => placeHotspots({ rng: new Rng({ seed }), count, radius, ring });

	it('places them in the ring, spaced apart, with craters and plumes in range', () => {
		SEEDS.forEach((seed) => {
			const hotspots = place(seed);
			expect(hotspots).toHaveLength(6);
			hotspots.forEach((hotspot, index) => {
				expect(fromCentre(hotspot)).toBeGreaterThanOrEqual(ring.inner);
				expect(fromCentre(hotspot)).toBeLessThanOrEqual(ring.outer);
				expect(hotspot.craterRadius).toBeGreaterThan(0);
				expect(hotspot.craterRadius).toBeLessThanOrEqual(MAX_CRATER_RADIUS);
				expect(hotspot.plumeRadius).toBeGreaterThan(hotspot.craterRadius);
				expect(hotspot.strength).toBeGreaterThan(0);
				expect(hotspot.strength).toBeLessThanOrEqual(1);
				hotspots.slice(index + 1).forEach((other) => expect(distance(hotspot, other)).toBeGreaterThanOrEqual(HOTSPOT_SPACING * 1000));
			});
		});
	});

	it('places the same hotspots from the same stream', () => {
		expect(place(5)).toEqual(place(5));
		expect(place(5)).not.toEqual(place(6));
	});

	it('places them only where the land suits a crater of the size drawn', () => {
		SEEDS.slice(0, 10).forEach((seed) => {
			// Nothing north of the equator, and nothing whose crater reaches past x = 600.
			const suits = (x: number, y: number, craterRadius: number) => y < 0 && x + craterRadius < 600;
			const hotspots = placeHotspots({ rng: new Rng({ seed }), count: 3, radius: 1000, ring, suits });
			expect(hotspots).toHaveLength(3);
			hotspots.forEach((hotspot) => expect(suits(hotspot.x, hotspot.y, hotspot.craterRadius)).toBe(true));
		});
	});

	it('places none in an empty ring, or when asked for none', () => {
		expect(placeHotspots({ rng: new Rng({ seed: 1 }), count: 3, radius: 1000, ring: { inner: 500, outer: 500 } })).toEqual([]);
		expect(place(1, 0)).toEqual([]);
	});

	it('leaves out what can\'t keep its spacing rather than crowding', () => {
		// A ring too thin for more than a handful at a quarter of the radius apart.
		const hotspots = placeHotspots({ rng: new Rng({ seed: 3 }), count: 40, radius: 1000, ring: { inner: 850, outer: 900 } });
		expect(hotspots.length).toBeLessThan(40);
		hotspots.forEach((hotspot, index) => {
			hotspots.slice(index + 1).forEach((other) => expect(distance(hotspot, other)).toBeGreaterThanOrEqual(HOTSPOT_SPACING * 1000));
		});
	});
});
