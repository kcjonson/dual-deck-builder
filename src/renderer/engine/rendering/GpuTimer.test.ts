import {
	GPU_WINDOW_SIZE,
	GpuFence,
	GpuQuery,
	GpuQueryDevice,
	GpuTimer,
	MAX_PENDING_FRAMES,
	WebGL2QueryDevice,
} from './GpuTimer';

interface FakeQuery {
	id: number;
	/** Result in ns, set when the test decides the GPU finished it. */
	resultNs: number | null;
}

interface FakeFence {
	id: number;
	signalled: boolean;
}

/**
 * A scripted GPU: queries finish when the test says so, and every call the
 * timer makes is logged, so the tests can assert both what was measured and
 * that nothing was read before its time (R13.17, R15.22).
 */
class FakeDevice implements GpuQueryDevice {
	timerQuery = true;
	readonly log: string[] = [];
	readonly issued: FakeQuery[] = [];
	readonly fences: FakeFence[] = [];
	disjointNext = false;
	private created = 0;
	private active: FakeQuery | null = null;

	createQuery(): GpuQuery {
		this.log.push('createQuery');
		return { id: ++this.created, resultNs: null } as FakeQuery;
	}

	beginTimeElapsed(query: GpuQuery): void {
		if (this.active !== null) throw new Error('nested query');
		const fake = query as FakeQuery;
		fake.resultNs = null;
		this.active = fake;
		this.issued.push(fake);
		this.log.push(`begin ${fake.id}`);
	}

	endTimeElapsed(): void {
		if (this.active === null) throw new Error('no active query');
		this.log.push(`end ${this.active.id}`);
		this.active = null;
	}

	queryAvailable(query: GpuQuery): boolean {
		this.log.push(`available ${(query as FakeQuery).id}`);
		return (query as FakeQuery).resultNs !== null;
	}

	queryResultNs(query: GpuQuery): number {
		const fake = query as FakeQuery;
		if (fake.resultNs === null) throw new Error('result read before it was available');
		this.log.push(`result ${fake.id}`);
		return fake.resultNs;
	}

	disjoint(): boolean {
		this.log.push('disjoint');
		const value = this.disjointNext;
		this.disjointNext = false;
		return value;
	}

	fence(): GpuFence {
		const fence: FakeFence = { id: this.fences.length + 1, signalled: false };
		this.fences.push(fence);
		this.log.push(`fence ${fence.id}`);
		return fence;
	}

	fenceSignalled(fence: GpuFence): boolean {
		this.log.push(`poll fence ${(fence as FakeFence).id}`);
		return (fence as FakeFence).signalled;
	}

	deleteFence(fence: GpuFence): void {
		this.log.push(`delete fence ${(fence as FakeFence).id}`);
	}

	/** The GPU finishes every issued query still pending, each taking `ms`. */
	finishAll(ms: number): void {
		for (const query of this.issued) if (query.resultNs === null) query.resultNs = ms * 1e6;
	}
}

function setup(options: { timerQuery?: boolean; frameMs?: number } = {}) {
	const device = new FakeDevice();
	device.timerQuery = options.timerQuery ?? true;
	let clock = 0;
	const timer = new GpuTimer({ device, now: () => clock });
	const frameMs = options.frameMs ?? 16;

	/** One frame with `passes` submissions, the way the backend brackets them. */
	function frame(passes = 2): void {
		timer.beginFrame();
		for (let index = 0; index < passes; index++) {
			timer.beginPass();
			timer.endPass();
		}
		timer.endFrame();
		clock += frameMs;
	}
	return { device, timer, frame, advance: (ms: number) => { clock += ms; } };
}

describe('GpuTimer', () => {
	it('issues one query per pass, never nested, and reports the passes and their sum (R13.16)', () => {
		const { device, timer, frame } = setup();
		frame(3);
		device.finishAll(0.5);
		frame();
		frame();
		expect(timer.stats.passes).toEqual([0.5, 0.5, 0.5]);
		expect(timer.stats.ms).toBeCloseTo(1.5);
		expect(timer.stats.valid).toBe(true);
		expect(timer.stats.source).toBe('timerQuery');
		expect(timer.stats.spanMs).toBeNull();
		expect(timer.stats.latencyMs).toBeNull();
	});

	it('refuses a pass opened inside a pass rather than nesting', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { device, timer } = setup();
		timer.beginFrame();
		timer.beginPass();
		timer.beginPass();
		timer.endPass();
		timer.endPass();
		timer.endFrame();
		expect(device.issued).toHaveLength(1);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('never reads a result sooner than two frames after it was issued (R13.17)', () => {
		const { device, timer, frame } = setup();
		frame();
		// The GPU is instant, and the timer still does not look.
		device.finishAll(1);
		device.log.length = 0;
		frame();
		expect(device.log.filter((entry) => entry.startsWith('available') || entry.startsWith('result'))).toEqual([]);
		expect(timer.stats.ms).toBeNull();
		frame();
		expect(timer.stats.ms).toBe(2);
	});

	it('skips a result that is not ready rather than waiting for it', () => {
		const { device, timer, frame } = setup();
		frame();
		frame();
		device.log.length = 0;
		frame();
		// One availability check on the oldest frame's last query, no result read.
		expect(device.log.filter((entry) => entry.startsWith('available'))).toEqual(['available 2']);
		expect(device.log.some((entry) => entry.startsWith('result'))).toBe(false);
		expect(timer.stats.ms).toBeNull();
		device.finishAll(1);
		frame();
		// Frames 0 and 1 are old enough now; frame 2 is not, finished or not.
		expect(timer.stats.sampleCount).toBe(2);
	});

	it('reuses query objects once their results are read', () => {
		const { device, frame } = setup();
		for (let index = 0; index < 20; index++) {
			frame(2);
			device.finishAll(0.1);
		}
		// Two frames in flight plus the one being issued, two passes each.
		expect(device.log.filter((entry) => entry === 'createQuery').length).toBeLessThanOrEqual(6);
	});

	it('marks every sample resolved across a disjoint event invalid and leaves it out of the window (R13.18)', () => {
		const { device, timer, frame } = setup();
		frame();
		frame();
		frame();
		device.finishAll(1);
		device.disjointNext = true;
		frame();
		expect(timer.stats.valid).toBe(false);
		expect(timer.stats.ms).toBe(2);
		expect(timer.stats.sampleCount).toBe(0);
		expect(timer.stats.invalidCount).toBe(2);
		expect(timer.stats.p99Ms).toBeNull();
	});

	it('marks a sample over three times its CPU frame time invalid (R13.18)', () => {
		const { device, timer, frame } = setup({ frameMs: 4 });
		frame(1);
		device.finishAll(13);
		frame(1);
		device.finishAll(11);
		frame(1);
		frame(1);
		// 13 ms against a 4 ms frame is past 12; 11 ms is not.
		expect(timer.stats.invalidCount).toBe(1);
		expect(timer.stats.sampleCount).toBe(1);
		expect(timer.stats.maxMs).toBe(11);
	});

	it('takes p99 and max over valid samples only, across a bounded window', () => {
		const { device, timer, frame } = setup();
		for (let index = 0; index < GPU_WINDOW_SIZE + 10; index++) {
			frame(1);
			device.finishAll(index < 10 ? 50 : 1 + (index % 3));
		}
		expect(timer.stats.sampleCount).toBeLessThanOrEqual(GPU_WINDOW_SIZE);
		expect(timer.stats.maxMs).toBe(3);
		expect(timer.stats.p99Ms).toBe(3);
	});

	it('drops what was in flight on a lost context and counts it invalid (R13.18)', () => {
		const { device, timer, frame } = setup();
		frame();
		frame();
		timer.contextLost();
		expect(timer.stats.invalidCount).toBe(2);
		device.finishAll(1);
		frame();
		// Nothing issued before the loss is ever read.
		expect(device.log.some((entry) => entry.startsWith('result'))).toBe(false);
	});

	it('stops issuing after MAX_PENDING_FRAMES unresolved frames rather than growing, and resumes', () => {
		const { device, timer, frame } = setup();
		for (let index = 0; index < MAX_PENDING_FRAMES + 5; index++) frame(1);
		expect(device.issued).toHaveLength(MAX_PENDING_FRAMES);
		device.finishAll(1);
		frame(1);
		expect(timer.stats.sampleCount).toBe(MAX_PENDING_FRAMES);
		expect(device.issued).toHaveLength(MAX_PENDING_FRAMES + 1);
	});

	it('issues nothing while disabled and reports no source (R13.2)', () => {
		const { device, timer, frame } = setup();
		timer.enabled = false;
		frame();
		frame();
		expect(device.log).toEqual([]);
		expect(timer.stats).toMatchObject({ source: null, ms: null, valid: null, latencyMs: null });
		timer.enabled = true;
		frame();
		expect(device.issued).toHaveLength(2);
	});

	describe('without the timer extension', () => {
		it('reports fence latency, never GPU time, polled from the next frame on (R13.19, R15.23)', () => {
			const { device, timer, frame, advance } = setup({ timerQuery: false });
			frame();
			expect(device.issued).toEqual([]);
			expect(device.log).toEqual(['fence 1']);
			device.fences[0].signalled = true;
			advance(5);
			frame();
			expect(timer.stats.source).toBe('fence');
			expect(timer.stats.ms).toBeNull();
			expect(timer.stats.p99Ms).toBeNull();
			// Fence made at 0, observed at the next frame's start, 16 + 5 ms later.
			expect(timer.stats.latencyMs).toBe(21);
			expect(device.log).toContain('delete fence 1');
		});

		it('leaves an unsignalled fence pending and polls it once per frame', () => {
			const { device, timer, frame } = setup({ timerQuery: false });
			frame();
			device.log.length = 0;
			frame();
			frame();
			expect(device.log.filter((entry) => entry.startsWith('poll'))).toEqual(['poll fence 1', 'poll fence 1']);
			expect(timer.stats.latencyMs).toBeNull();
		});
	});
});

describe('WebGL2QueryDevice', () => {
	function fakeGl(extension: object | null) {
		const calls: string[] = [];
		const gl = {
			QUERY_RESULT_AVAILABLE: 1,
			QUERY_RESULT: 2,
			SYNC_GPU_COMMANDS_COMPLETE: 3,
			ALREADY_SIGNALED: 4,
			CONDITION_SATISFIED: 5,
			TIMEOUT_EXPIRED: 6,
			getExtension: () => extension,
			fenceSync: () => {
				calls.push('fenceSync');
				return {};
			},
			flush: () => calls.push('flush'),
			clientWaitSync: (_sync: unknown, flags: number, timeout: number) => {
				calls.push(`clientWaitSync ${flags} ${timeout}`);
				return 6;
			},
		};
		return { gl: gl as unknown as WebGL2RenderingContext, calls };
	}

	it('reports the extension it found', () => {
		expect(new WebGL2QueryDevice({ gl: fakeGl(null).gl }).timerQuery).toBe(false);
		expect(new WebGL2QueryDevice({ gl: fakeGl({ TIME_ELAPSED_EXT: 7, GPU_DISJOINT_EXT: 8 }).gl }).timerQuery).toBe(true);
	});

	it('flushes after the fence and polls it with a zero timeout (R15.23)', () => {
		const { gl, calls } = fakeGl(null);
		const device = new WebGL2QueryDevice({ gl });
		const fence = device.fence() as GpuFence;
		expect(device.fenceSignalled(fence)).toBe(false);
		expect(calls).toEqual(['fenceSync', 'flush', 'clientWaitSync 0 0']);
	});
});
