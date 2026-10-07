import { Rng } from '../core/Rng';
import { MAX_OCTAVES, SimplexNoise } from './Noise';

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
			.toEqual([0.21772395993177998, -0.046893495295743055, -0.4930850431416073, -0.26576720828488243]);
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

	describe('fractalWithin', () => {
		it('returns fractal\'s value and derivatives unless the value is sure to fall outside the range', () => {
			const noise = noiseFor(31);
			const reference = noiseFor(31);
			let early = 0;
			points(5000).forEach(([x, y], index) => {
				const low = (index % 7) / 10 - 0.3;
				const high = low + 0.2;
				const value = noise.fractalWithin(x / 40, y / 40, 3, 0.5, low, high);
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

		it('never stops early with open ends', () => {
			const noise = noiseFor(37);
			const reference = noiseFor(37);
			points(500).forEach(([x, y]) => {
				expect(noise.fractalWithin(x / 30, y / 30, 2, 0.5, -Infinity, Infinity)).toBe(reference.fractal(x / 30, y / 30, 2, 0.5));
			});
		});
	});
});
