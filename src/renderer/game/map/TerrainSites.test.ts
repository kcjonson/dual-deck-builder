import { Rng } from '../core/Rng';
import { HOTSPOT_SPACING, Hotspot, MAX_CRATER_RADIUS, PLACEMENT_ATTEMPTS, Ruin, TOWN_CRATER_GAP, TOWN_SPACING, placeHotspots, placeTowns } from './TerrainSites';

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

describe('placeTowns', () => {
	const ring = { inner: 250, outer: 900 };
	const hotspots: Hotspot[] = [
		{ x: 500, y: 0, craterRadius: 20, plumeRadius: 120, strength: 1 },
		{ x: -300, y: -500, craterRadius: 26, plumeRadius: 150, strength: 1 },
	];
	interface Options {
		count?: number;
		withHotspots?: boolean;
		suits?: (x: number, y: number, strict: boolean) => boolean;
	}
	const place = (seed: number, { count = 12, withHotspots = true, suits = () => true }: Options = {}) => placeTowns({
		rng: new Rng({ seed }),
		count,
		radius: 1000,
		metroRadius: 150,
		ring,
		hotspots: withHotspots ? hotspots : [],
		suits,
	});

	function expectValid(towns: readonly Ruin[]) {
		towns.forEach((town, index) => {
			expect(fromCentre(town)).toBeGreaterThanOrEqual(ring.inner + town.radius);
			expect(fromCentre(town)).toBeLessThanOrEqual(ring.outer - town.radius);
			hotspots.forEach((hotspot) => expect(distance(town, hotspot)).toBeGreaterThanOrEqual(hotspot.craterRadius + town.radius + TOWN_CRATER_GAP));
			towns.slice(index + 1).forEach((other) => expect(distance(town, other)).toBeGreaterThanOrEqual(TOWN_SPACING * 1000));
		});
	}

	it('places them Poisson-disc spaced, wholly inside the ring, and clear of craters', () => {
		SEEDS.forEach((seed) => {
			const towns = place(seed);
			expect(towns).toHaveLength(12);
			expectValid(towns);
			towns.forEach((town) => {
				expect(town.radius).toBeGreaterThanOrEqual(20);
				expect(town.radius).toBeLessThanOrEqual(0.4 * 150);
			});
		});
	});

	it('places the same towns from the same stream', () => {
		expect(place(8)).toEqual(place(8));
		expect(place(8)).not.toEqual(place(9));
	});

	it('asks for good ground over the first half of each town\'s candidates, then any reachable ground', () => {
		const asked: boolean[] = [];
		const towns = place(4, { count: 1, withHotspots: false, suits: (_x, _y, strict) => {
			asked.push(strict);
			return !strict;
		} });
		expect(towns).toHaveLength(1);
		expect(asked).toEqual([...Array(PLACEMENT_ATTEMPTS / 2).fill(true), false]);
	});

	it('leaves out a town that finds no ground, after a bounded number of candidates', () => {
		let asked = 0;
		const towns = place(4, { count: 3, withHotspots: false, suits: () => {
			asked += 1;
			return false;
		} });
		expect(towns).toEqual([]);
		expect(asked).toBe(3 * PLACEMENT_ATTEMPTS);
	});

	it('places only where suits says yes', () => {
		const towns = place(12, { suits: (x) => x > 0 });
		expect(towns.length).toBeGreaterThan(0);
		towns.forEach((town) => expect(town.x).toBeGreaterThan(0));
		expectValid(towns);
	});
});
