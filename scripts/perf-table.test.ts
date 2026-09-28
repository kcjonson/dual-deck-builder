import { comparisonTable, median, summarizeScenario, summaryTable, type ScenarioCaptureLike } from './perf-table';

function sample(frameMs: number, gpuMs: number | null, options: { valid?: boolean; draws?: number } = {}) {
	return {
		frame: { ms: frameMs, p99Ms: 9, maxMs: 12 },
		sections: { update: { maxMs: 1 }, render: { maxMs: 2.5 }, flush: { maxMs: 0.75 }, input: null },
		gpu: {
			ms: gpuMs,
			valid: gpuMs === null ? null : (options.valid ?? true),
			latencyMs: null,
			source: 'timerQuery',
			p99Ms: 3,
			maxMs: 4,
			invalidCount: 1,
		},
		batcher: {
			apiDraws: 40,
			gpuDraws: options.draws ?? 6,
			triangles: 1200,
			flushes: { barrier: 2, endFrame: 1, targetChange: 0, bufferFull: 0 },
		},
		renderer: { glDrawCalls: 6 },
		device: { renderer: 'ANGLE (Apple, Metal)' },
	};
}

const CAPTURE: ScenarioCaptureLike = {
	scenario: 'combatScreen',
	samples: [sample(4, 1), sample(5, 2), sample(6, 100, { valid: false }), sample(8, 3)],
};

describe('median', () => {
	it('picks the middle of an odd count and splits an even one', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 3, 2])).toBe(2.5);
		expect(median([])).toBeNull();
	});
});

describe('summarizeScenario', () => {
	it('reads the windowed figures off the last sample and the median off every sample', () => {
		expect(summarizeScenario(CAPTURE)).toEqual({
			scenario: 'combatScreen',
			fps: 1000 / 5.5,
			frameMedianMs: 5.5,
			frameP99Ms: 9,
			frameMaxMs: 12,
			updateMaxMs: 1,
			renderMaxMs: 2.5,
			flushMaxMs: 0.75,
			gpuSource: 'timerQuery',
			// The invalid 100 ms sample is left out (R13.18).
			gpuMedianMs: 2,
			gpuP99Ms: 3,
			gpuMaxMs: 4,
			gpuInvalid: 1,
			apiDraws: 40,
			gpuDraws: 6,
			triangles: 1200,
			flushes: 'barrier 2, endFrame 1',
			device: 'ANGLE (Apple, Metal)',
		});
	});

	it('summarises a phase 0 file, which has no batcher and a null GPU block, as n/a', () => {
		const summary = summarizeScenario({
			scenario: 'splashScreen',
			samples: [{
				frame: { ms: 0.1, p99Ms: 0.4, maxMs: 0.5 },
				sections: { update: { maxMs: 0.01 }, render: { maxMs: 0.02 }, flush: { maxMs: 0.03 } },
				gpu: { ms: null, valid: null, latencyMs: null },
				batcher: null,
				renderer: { glDrawCalls: 4 },
			}],
		});
		expect(summary).toMatchObject({ gpuSource: null, gpuMedianMs: null, gpuP99Ms: null, gpuDraws: 4, triangles: null, flushes: null });
	});

	it('takes the fence latency as the GPU median when that is the only measurement', () => {
		const fence = (latencyMs: number) => ({ ...sample(4, null), gpu: { ms: null, valid: null, latencyMs, source: 'fence', p99Ms: null, maxMs: null } });
		const summary = summarizeScenario({ scenario: 'x', samples: [fence(10), fence(20), fence(30)] });
		expect(summary.gpuSource).toBe('fence');
		expect(summary.gpuMedianMs).toBe(20);
	});
});

describe('summaryTable', () => {
	it('prints one row per scenario under a markdown header', () => {
		const lines = summaryTable([CAPTURE]).split('\n');
		expect(lines).toHaveLength(3);
		expect(lines[0]).toMatch(/^\| Scenario \| FPS \|/);
		expect(lines[2]).toBe('| combatScreen | 182 | 5.50 | 9.00 | 12.00 | 1.00 | 2.50 | 0.75 | 2.00 | 3.00 | 4.00 | 40 | 6 | 1200 | barrier 2, endFrame 1 |');
	});
});

describe('comparisonTable (R13.39)', () => {
	it('shows before and after with the change, and a value once when both agree', () => {
		const after: ScenarioCaptureLike = {
			scenario: 'combatScreen',
			samples: [sample(4, 1, { draws: 3 }), sample(5, 2, { draws: 3 }), sample(6, 100, { valid: false, draws: 3 }), sample(8, 3, { draws: 3 })],
		};
		const line = comparisonTable([CAPTURE], [after]).split('\n')[2];
		expect(line).toContain('| 6 -> 3 (-50%) |');
		expect(line).toContain('| 9.00 |');
	});

	it('keeps a scenario only one side captured, with n/a on the other', () => {
		const lines = comparisonTable([CAPTURE], [{ scenario: 'mainMenuScreen', samples: [sample(2, 1)] }]).split('\n');
		expect(lines).toHaveLength(4);
		expect(lines[2]).toContain('9.00 -> n/a');
		expect(lines[3]).toContain('n/a -> 9.00');
	});
});
