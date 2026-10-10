import { EdgeCostField, MOVES, MOVE_X, MOVE_Y, NEIGHBOURS, OPPOSITE, moveBetween } from './RoadCost';
import { impassableAlong, polylineBridges } from './RoadChecks';
import { ROAD_CLASSES } from './RoadNetwork';
import { landFor } from './roadTesting';

describe('EdgeCostField', () => {
	// Rugged and wet, with broad rivers, so moves meet every kind of ground.
	const { params, terrain, water } = landFor({ seed: 7, environment: 'floodlands', radius: 600, ruggedness: 0.8, riverDensity: 1 });
	const field = new EdgeCostField({ terrain, rivers: water.lines, curviness: params.curviness });
	const cells = field.size * field.size;
	const move = (cell: number, direction: number) => {
		const next = cell + field.offsets[direction];
		return { next, x0: field.x(cell), y0: field.y(cell), x1: field.x(next), y1: field.y(next) };
	};

	it('files each move once, under the same id from either end', () => {
		const middle = (field.size / 2) * field.size + field.size / 2;
		const ids = new Set<number>();
		for (let direction = 0; direction < MOVES; direction += 1) {
			const { next } = move(middle, direction);
			expect(field.edge(next, OPPOSITE[direction])).toBe(field.edge(middle, direction));
			expect(moveBetween(MOVE_X[direction], MOVE_Y[direction])).toBe(direction);
			const { cell, direction: forward } = field.ends(field.edge(middle, direction));
			expect([middle, next]).toContain(cell);
			expect(forward === direction || forward === OPPOSITE[direction]).toBe(true);
			ids.add(field.edge(middle, direction));
		}
		expect(ids.size).toBe(MOVES);
	});

	it('agrees with moveCost on every move it leaves open, and is stricter only where a sample along the move is impassable', () => {
		let agreed = 0;
		let stricter = 0;
		for (let cell = 0; cell < cells; cell += 5) {
			if (field.open[cell] === 0) continue;
			for (let direction = 0; direction < NEIGHBOURS; direction += 1) {
				const { x0, y0, x1, y1 } = move(cell, direction);
				const edge = field.edge(cell, direction);
				ROAD_CLASSES.forEach((roadClass) => {
					const cost = field.costFor(edge, roadClass);
					const reference = terrain.moveCost(x0, y0, x1, y1, roadClass);
					if (Number.isFinite(cost)) {
						expect(Math.abs(cost - reference)).toBeLessThanOrEqual(1e-12 * reference);
						agreed += 1;
					} else if (Number.isFinite(reference)) {
						const { next } = move(cell, direction);
						if (field.open[next] === 0) {
							// moveCost knows nothing of the rim, which the field keeps every road inside.
							expect(x1 * x1 + y1 * y1).toBeGreaterThan((terrain.radius - 1) * (terrain.radius - 1));
							return;
						}
						const points = [x0, y0, x1, y1];
						expect(impassableAlong(terrain, points, polylineBridges(terrain, points))).toBeGreaterThan(0);
						stricter += 1;
					}
				});
			}
		}
		expect(agreed).toBeGreaterThan(5000);
		expect(stricter).toBeGreaterThan(0);
	});

	it('bridges two cells straight on only over a cell whose centre is in a river, and costs it as moveCost does', () => {
		let leaps = 0;
		for (let cell = 0; cell < cells; cell += 1) {
			if (field.open[cell] === 0) continue;
			for (let direction = NEIGHBOURS; direction < MOVES; direction += 1) {
				const edge = field.edge(cell, direction);
				const cost = field.cost(edge, 1);
				if (!Number.isFinite(cost)) continue;
				const { next, x0, y0, x1, y1 } = move(cell, direction);
				const middle = (cell + next) / 2;
				expect(field.open[middle]).toBe(0);
				expect(terrain.obstacle(field.x(middle), field.y(middle))).toBe('river');
				expect(field.bridged(edge)).toBe(true);
				expect(Math.abs(cost - terrain.moveCost(x0, y0, x1, y1, 'backRoad'))).toBeLessThanOrEqual(1e-12 * cost);
				leaps += 1;
			}
		}
		expect(leaps).toBeGreaterThan(0);
	});

	it('works each move out the same whichever order the searches ask in', () => {
		const again = new EdgeCostField({ terrain, rivers: water.lines, curviness: params.curviness });
		for (let cell = cells - 1; cell >= 0; cell -= 7) {
			for (let direction = MOVES - 1; direction >= 0; direction -= 1) {
				if (cell + field.offsets[direction] < 0 || cell + field.offsets[direction] >= cells) continue;
				const edge = field.edge(cell, direction);
				expect(again.cost(edge, 2)).toBe(field.cost(edge, 2));
			}
		}
		expect(again.worked).toBeGreaterThan(0);
	});

	it('weights a climb by curviness, and turns a highway or back road back from one past 1.1', () => {
		const winding = new EdgeCostField({ terrain, rivers: water.lines, curviness: 1 });
		const straight = new EdgeCostField({ terrain, rivers: water.lines, curviness: 0 });
		let steep = 0;
		for (let cell = 0; cell < cells; cell += 5) {
			if (field.open[cell] === 0) continue;
			const edge = field.edge(cell, 2);
			const grade = field.grade(edge);
			if (!Number.isFinite(field.cost(edge, 2)) || grade === 0) continue;
			expect(winding.cost(edge, 2)).toBeGreaterThan(straight.cost(edge, 2));
			if (grade > 1.1) {
				steep += 1;
				expect(field.cost(edge, 0)).toBe(Infinity);
				expect(field.cost(edge, 1)).toBe(Infinity);
			}
		}
		expect(steep).toBeGreaterThan(0);
	});
});
