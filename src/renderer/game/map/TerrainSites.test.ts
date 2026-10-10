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

describe('placeTowns', () => {
	const ring = { inner: 250, outer: 900 };
	const hotspots: Hotspot[] = [
		{ x: 500, y: 0, craterRadius: 20, plumeRadius: 120, strength: 1 },
		{ x: -300, y: -500, craterRadius: 26, plumeRadius: 150, strength: 1 },
	];
	const CELL = 16;

	/** Centres of the CELL-unit cells over the map whose centres lie between `inner` and `outer` and that `keep` keeps. */
	function cellsIn(inner: number, outer: number, keep: (x: number, y: number) => boolean = () => true): { x: number; y: number }[] {
		const cells: { x: number; y: number }[] = [];
		for (let y = -1000 + CELL / 2; y < 1000; y += CELL) {
			for (let x = -1000 + CELL / 2; x < 1000; x += CELL) {
				const fromMiddle = Math.hypot(x, y);
				if (fromMiddle >= inner && fromMiddle <= outer && keep(x, y)) cells.push({ x, y });
			}
		}
		return cells;
	}
	const ringCells = cellsIn(ring.inner, ring.outer);

	interface Options {
		count?: number;
		withHotspots?: boolean;
		cells?: { x: number; y: number }[];
		suits?: (x: number, y: number, strict: boolean) => boolean;
	}
	const place = (seed: number, { count = 12, withHotspots = true, cells = ringCells, suits = () => true }: Options = {}) => placeTowns({
		rng: new Rng({ seed }),
		count,
		radius: 1000,
		metroRadius: 150,
		ring,
		hotspots: withHotspots ? hotspots : [],
		cells,
		cellSize: CELL,
		suits,
	});

	/** The centre of the CELL-unit cell holding (x, y), as the key `cellsIn`'s centres make. */
	const cellKey = (x: number, y: number) => `${Math.floor((x + 1000) / CELL) * CELL + CELL / 2 - 1000},${Math.floor((y + 1000) / CELL) * CELL + CELL / 2 - 1000}`;

	function expectValid(towns: readonly Ruin[], cells = ringCells) {
		const keys = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
		towns.forEach((town, index) => {
			expect(fromCentre(town)).toBeGreaterThanOrEqual(ring.inner + town.radius);
			expect(fromCentre(town)).toBeLessThanOrEqual(ring.outer - town.radius);
			expect(keys.has(cellKey(town.x, town.y))).toBe(true);
			hotspots.forEach((hotspot) => expect(distance(town, hotspot)).toBeGreaterThanOrEqual(hotspot.craterRadius + town.radius + TOWN_CRATER_GAP));
			towns.slice(index + 1).forEach((other) => expect(distance(town, other)).toBeGreaterThanOrEqual(TOWN_SPACING * 1000));
		});
	}

	it('places them Poisson-disc spaced, wholly inside the ring, clear of craters, and in the cells given', () => {
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

	it('asks for good ground over the first half of each town\'s candidates, then takes any', () => {
		// Cells well inside the ring, so every candidate has room and is asked.
		const roomy = cellsIn(ring.inner + 80, ring.outer - 80);
		const asked: boolean[] = [];
		const towns = place(4, { count: 1, withHotspots: false, cells: roomy, suits: (_x, _y, strict) => {
			asked.push(strict);
			return !strict;
		} });
		expect(towns).toHaveLength(1);
		expect(asked).toEqual([...Array(PLACEMENT_ATTEMPTS / 2).fill(true), false]);
	});

	it('places every town asked for when the ground it likes is a quarter of the ring', () => {
		SEEDS.forEach((seed) => {
			const towns = place(seed, { suits: (x, y) => x > 0 && y > 0 });
			expect(towns).toHaveLength(12);
			expectValid(towns);
		});
	});

	it('falls back to the first cell centre with room, walking the cells in a shuffled order, when no candidate suits', () => {
		const towns = place(5, { suits: () => false });
		expect(towns).toHaveLength(12);
		expectValid(towns);
		towns.forEach((town) => expect(ringCells.some((cell) => cell.x === town.x && cell.y === town.y)).toBe(true));
	});

	it('leaves a town out only when no cell centre has room for it', () => {
		const cluster = [{ x: 400, y: 0 }, { x: 416, y: 0 }, { x: 400, y: 16 }];
		expect(place(6, { count: 3, withHotspots: false, cells: cluster })).toHaveLength(1);
		expect(place(6, { cells: [] })).toEqual([]);
	});
});
