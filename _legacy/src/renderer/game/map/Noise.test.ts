import { Rng } from '../core/Rng';
import { MAX_OCTAVES, SIMPLEX_GRADIENTS, SIMPLEX_SCALE, SimplexNoise } from './Noise';

const noiseFor = (seed: number) => new SimplexNoise({ rng: new Rng({ seed }) });

/** Points spread over a few hundred lattice units, both signs, off the lattice. */
function points(count: number, seed = 11): [number, number][] {
	const rng = new Rng({ seed });
	return Array.from({ length: count }, () => [rng.float() * 600 - 300, rng.float() * 600 - 300]);
}

describe('SimplexNoise', () => {
	it('samples the same values from the same stream, and different ones from another', () => {
		const first = noiseFor(42);
		const second = noiseFor(42);
		const other = noiseFor(43);
		const samples = points(500);
		samples.forEach(([x, y]) => expect(second.sample(x, y)).toBe(first.sample(x, y)));
		expect(samples.filter(([x, y]) => other.sample(x, y) !== first.sample(x, y)).length).toBeGreaterThan(490);
	});

	// A seed's noise is part of what the seed means, so a few values are
	// pinned the way the PRNG's are. Sampling is IEEE arithmetic only, so
	// these hold in any engine; a change here moves every map.
	it('samples the pinned values for seed 2183746551', () => {
		const noise = noiseFor(2183746551);
		expect([noise.sample(0.5, 0.25), noise.sample(-17.3, 4.75), noise.sample(123.456, -78.9), noise.fractal(3.21, -6.54, 4, 0.5)])
			.toEqual([-0.2323726846275739, -0.5281659698459956, -0.48323012715629404, -0.36172201921402614]);
	});

	it('draws 255 values for its permutation, a shuffle of 0 to 255', () => {
		const stream = new Rng({ seed: 9 });
		new SimplexNoise({ rng: stream });
		const reference = new Rng({ seed: 9 });
		reference.shuffle(Array.from({ length: 256 }, (_, index) => index));
		expect(stream.next()).toBe(reference.next());
	});

	it('stays inside (-1, 1)', () => {
		const noise = noiseFor(5);
		let largest = 0;
		points(200000, 3).forEach(([x, y]) => {
			largest = Math.max(largest, Math.abs(noise.sample(x, y)));
		});
		expect(largest).toBeLessThan(1);
		expect(largest).toBeGreaterThan(0.8);
	});

	describe('the gradients', () => {
		/** The simplex grid's corners and edges in unskewed space: skewed lattice point (i, j) sits at i - (i + j) * G2, j - (i + j) * G2. */
		const unskew = (3 - Math.sqrt(3)) / 6;
		const corner = (i: number, j: number): [number, number] => [i - (i + j) * unskew, j - (i + j) * unskew];
		const EDGE_STEPS = [[1, 1], [1, 0], [0, 1]] as const;
		const edgeDirections = EDGE_STEPS.map(([di, dj]) => {
			const [x, y] = corner(di, dj);
			const length = Math.hypot(x, y);
			return [x / length, y / length] as const;
		});

		it('are unit length, come in opposite pairs, and none is within 15 degrees of square to an edge', () => {
			expect(SIMPLEX_GRADIENTS).toHaveLength(12);
			SIMPLEX_GRADIENTS.forEach(([x, y]) => {
				expect(Math.abs(x * x + y * y - 1)).toBeLessThan(1e-15);
				expect(SIMPLEX_GRADIENTS.some(([ox, oy]) => ox === -x && oy === -y)).toBe(true);
				edgeDirections.forEach(([ex, ey]) => expect(Math.abs(x * ex + y * ey)).toBeGreaterThanOrEqual(Math.sin(Math.PI / 12) - 1e-12));
			});
		});

		// Gradients square to an edge at both its ends would make a layer zero
		// all along it, and a ridged layer crease there in a straight line.
		it('never leave a layer zero along a whole edge of the simplex grid', () => {
			const along = [0.1, 0.25, 0.4, 0.6, 0.75, 0.9];
			let zeroAllAlong = 0;
			for (let seed = 1; seed <= 8; seed += 1) {
				const noise = noiseFor(seed);
				for (let i = -16; i < 16; i += 1) {
					for (let j = -16; j < 16; j += 1) {
						EDGE_STEPS.forEach(([di, dj]) => {
							const [ax, ay] = corner(i, j);
							const [bx, by] = corner(i + di, j + dj);
							const values = along.map((share) => noise.sample(ax + (bx - ax) * share, ay + (by - ay) * share));
							if (values.every((value) => Math.abs(value) < 1e-12)) zeroAllAlong += 1;
						});
					}
				}
			}
			// The sixteen-direction set it replaced left 140 of these 24,576 edges zero.
			expect(zeroAllAlong).toBe(0);
		});

		// The fractal sum's early out counts on every sample being under 1.
		it('can\'t bring a sample to 1, whatever gradients a seed hands the corners', () => {
			// A corner adds falloff^4 (g . d), so at most falloff^4 |d| with any
			// unit gradient, and falloff^4 |d| cos(the angle to the nearest of
			// these twelve), since the set holds every gradient's opposite. The
			// largest sums over a fine grid of the cell, either way:
			let anyGradients = 0;
			let theseTwelve = 0;
			const cells = 240;
			for (let a = 0; a <= cells; a += 1) {
				for (let b = 0; b <= cells; b += 1) {
					const skewedX = a / cells;
					const skewedY = b / cells;
					const shift = (skewedX + skewedY) * unskew;
					const x0 = skewedX - shift;
					const y0 = skewedY - shift;
					const stepX = x0 > y0 ? 1 : 0;
					let any = 0;
					let twelve = 0;
					[[x0, y0], [x0 - stepX + unskew, y0 - (1 - stepX) + unskew], [x0 - 1 + 2 * unskew, y0 - 1 + 2 * unskew]].forEach(([dx, dy]) => {
						const falloff = 0.5 - dx * dx - dy * dy;
						if (falloff <= 0) return;
						const weight = falloff ** 4;
						any += weight * Math.hypot(dx, dy);
						twelve += weight * Math.max(...SIMPLEX_GRADIENTS.map(([gx, gy]) => Math.abs(gx * dx + gy * dy)));
					});
					anyGradients = Math.max(anyGradients, any);
					theseTwelve = Math.max(theseTwelve, twelve);
				}
			}
			// Any unit gradients peak midway along a long edge, both pointing at
			// the sample, at 2 / (81 sqrt 6), a point the grid lands on; the
			// slack is for rounding.
			const bound = 2 / (81 * Math.sqrt(6));
			expect(anyGradients).toBeLessThanOrEqual(bound * (1 + 1e-12));
			expect(anyGradients).toBeGreaterThan(bound * (1 - 1e-12));
			expect(SIMPLEX_SCALE * bound).toBeLessThan(1);
			// These twelve peak lower.
			expect(theseTwelve * SIMPLEX_SCALE).toBeGreaterThan(0.97);
			expect(theseTwelve * SIMPLEX_SCALE).toBeLessThan(0.98);
		});
	});

	it('is zero at every lattice point', () => {
		const noise = noiseFor(5);
		// Skewed lattice point (i, j) sits at i - (i + j) * G2, j - (i + j) * G2.
		const unskew = (3 - Math.sqrt(3)) / 6;
		for (let i = -20; i <= 20; i += 7) {
			for (let j = -20; j <= 20; j += 5) {
				expect(noise.sample(i - (i + j) * unskew, j - (i + j) * unskew)).toBeCloseTo(0, 12);
			}
		}
	});

	it('leaves its exact derivatives behind', () => {
		const noise = noiseFor(17);
		const step = 1e-6;
		points(2000).forEach(([x, y]) => {
			noise.sample(x, y);
			const { derivativeX, derivativeY } = noise;
			const along = (noise.sample(x + step, y) - noise.sample(x - step, y)) / (2 * step);
			const across = (noise.sample(x, y + step) - noise.sample(x, y - step)) / (2 * step);
			expect(derivativeX).toBeCloseTo(along, 6);
			expect(derivativeY).toBeCloseTo(across, 6);
		});
	});

	describe('fractal', () => {
		it('is the octaves summed at doubling frequency and scaled amplitude, divided by the amplitudes\' total', () => {
			const noise = noiseFor(21);
			const reference = noiseFor(21);
			const octaves = 3;
			const gain = 0.4;
			points(200).forEach(([x, y]) => {
				const value = noise.fractal(x, y, octaves, gain);
				let sum = 0;
				// Each octave samples from its own offset, so octaves don't share lattice points.
				for (let octave = 0; octave < octaves; octave += 1) {
					sum += gain ** octave * reference.sample(x * 2 ** octave + [17.31, 43.17, 87.71][octave], y * 2 ** octave + [29.53, 71.29, 13.97][octave]);
				}
				expect(value).toBeCloseTo(sum / (1 + gain + gain * gain), 12);
			});
		});

		it('stays inside (-1, 1), with exact derivatives', () => {
			const noise = noiseFor(23);
			const step = 1e-6;
			points(1000).forEach(([x, y]) => {
				const value = noise.fractal(x / 50, y / 50, MAX_OCTAVES, 0.5);
				expect(Math.abs(value)).toBeLessThan(1);
				const { derivativeX, derivativeY } = noise;
				const along = (noise.fractal((x + step) / 50, y / 50, MAX_OCTAVES, 0.5) - noise.fractal((x - step) / 50, y / 50, MAX_OCTAVES, 0.5)) / (2 * step / 50);
				const across = (noise.fractal(x / 50, (y + step) / 50, MAX_OCTAVES, 0.5) - noise.fractal(x / 50, (y - step) / 50, MAX_OCTAVES, 0.5)) / (2 * step / 50);
				expect(derivativeX).toBeCloseTo(along, 4);
				expect(derivativeY).toBeCloseTo(across, 4);
			});
		});
	});

	describe('fractal with bounds', () => {
		it('returns the full sum and derivatives unless the value is sure to fall outside the range', () => {
			const noise = noiseFor(31);
			const reference = noiseFor(31);
			let early = 0;
			points(5000).forEach(([x, y], index) => {
				const low = (index % 7) / 10 - 0.3;
				const high = low + 0.2;
				const value = noise.fractal(x / 40, y / 40, 3, 0.5, low, high);
				const exact = reference.fractal(x / 40, y / 40, 3, 0.5);
				if (value === -Infinity) {
					expect(exact).toBeLessThanOrEqual(low);
					early += 1;
				} else if (value === Infinity) {
					expect(exact).toBeGreaterThanOrEqual(high);
					early += 1;
				} else {
					expect(value).toBe(exact);
					expect(noise.derivativeX).toBe(reference.derivativeX);
					expect(noise.derivativeY).toBe(reference.derivativeY);
				}
			});
			expect(early).toBeGreaterThan(1000);
		});

		it('sums every octave with open ends, the same as with no bounds', () => {
			const noise = noiseFor(37);
			const reference = noiseFor(37);
			points(500).forEach(([x, y]) => {
				expect(noise.fractal(x / 30, y / 30, 2, 0.5, -Infinity, Infinity)).toBe(reference.fractal(x / 30, y / 30, 2, 0.5));
			});
		});
	});
});
