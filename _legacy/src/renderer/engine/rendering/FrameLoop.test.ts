import { FrameLoop } from './FrameLoop';

function scheduler(): {
	requestFrame: (callback: FrameRequestCallback) => number;
	cancelFrame: (handle: number) => void;
	runFrame: () => void;
	pending: () => number;
} {
	let next = 1;
	const queued = new Map<number, FrameRequestCallback>();
	return {
		requestFrame: (callback) => {
			const handle = next++;
			queued.set(handle, callback);
			return handle;
		},
		cancelFrame: (handle) => {
			queued.delete(handle);
		},
		runFrame: () => {
			const callbacks = [...queued.values()];
			queued.clear();
			for (const callback of callbacks) callback(0);
		},
		pending: () => queued.size,
	};
}

describe('FrameLoop', () => {
	it('ticks once per frame after start and re-requests itself', () => {
		const frames = scheduler();
		const tick = jest.fn();
		const loop = new FrameLoop({ tick, ...frames });
		loop.start();
		frames.runFrame();
		frames.runFrame();
		expect(tick).toHaveBeenCalledTimes(2);
		expect(frames.pending()).toBe(1);
	});

	it('cancels the pending frame on stop (R15.5)', () => {
		const frames = scheduler();
		const tick = jest.fn();
		const loop = new FrameLoop({ tick, ...frames });
		loop.start();
		loop.stop();
		frames.runFrame();
		expect(tick).not.toHaveBeenCalled();
		expect(loop.running).toBe(false);
	});

	it('resumes with exactly one pending frame, however often it is started', () => {
		const frames = scheduler();
		const tick = jest.fn();
		const loop = new FrameLoop({ tick, ...frames });
		loop.start();
		loop.stop();
		loop.start();
		loop.start();
		expect(frames.pending()).toBe(1);
		frames.runFrame();
		expect(tick).toHaveBeenCalledTimes(1);
	});

	it('halts for good when a frame\'s tick throws (DDB-538)', () => {
		const frames = scheduler();
		let fail = true;
		const tick = jest.fn(() => {
			if (fail) throw new Error('boom');
		});
		const loop = new FrameLoop({ tick, ...frames });
		loop.start();
		expect(() => frames.runFrame()).toThrow('boom');
		expect(loop.running).toBe(false);
		expect(loop.failed).toBe(true);
		expect(frames.pending()).toBe(0);

		// A restored context or a released frame hold starts it; neither revives it.
		fail = false;
		loop.start();
		loop.step();
		loop.runNow();
		frames.runFrame();
		expect(tick).toHaveBeenCalledTimes(1);
		expect(frames.pending()).toBe(0);
	});

	it('does not re-request when the tick stops the loop', () => {
		const frames = scheduler();
		const loop: FrameLoop = new FrameLoop({ tick: () => loop.stop(), ...frames });
		loop.start();
		frames.runFrame();
		expect(frames.pending()).toBe(0);
	});
});

describe('FrameLoop.runNow', () => {
	it('ticks immediately only while running, and keeps the scheduled frame', () => {
		const tick = jest.fn();
		const requestFrame = jest.fn(() => 1);
		const loop = new FrameLoop({ tick, requestFrame, cancelFrame: jest.fn() });

		loop.runNow();
		expect(tick).not.toHaveBeenCalled();

		loop.start();
		loop.runNow();
		expect(tick).toHaveBeenCalledTimes(1);
		expect(requestFrame).toHaveBeenCalledTimes(1);
	});

	it('stops the loop when the tick throws', () => {
		const loop = new FrameLoop({
			tick: () => {
				throw new Error('boom');
			},
			requestFrame: () => 1,
			cancelFrame: jest.fn(),
		});
		loop.start();
		expect(() => loop.runNow()).toThrow('boom');
		expect(loop.running).toBe(false);
		expect(loop.failed).toBe(true);
	});

	it('halts when a stepped tick throws', () => {
		const tick = jest.fn(() => {
			throw new Error('boom');
		});
		const frames = scheduler();
		const loop = new FrameLoop({ tick, ...frames });
		expect(() => loop.step()).toThrow('boom');
		expect(loop.failed).toBe(true);
		loop.start();
		expect(frames.pending()).toBe(0);
	});

	it('steps one tick while stopped, without scheduling a frame (DDB-532)', () => {
		const frames = scheduler();
		const tick = jest.fn();
		const loop = new FrameLoop({ tick, ...frames });
		loop.start();
		loop.stop();
		loop.step();
		expect(tick).toHaveBeenCalledTimes(1);
		expect(frames.pending()).toBe(0);
		expect(loop.running).toBe(false);
	});

	it('does not step while running, since the scheduled frame is coming', () => {
		const frames = scheduler();
		const tick = jest.fn();
		const loop = new FrameLoop({ tick, ...frames });
		loop.start();
		loop.step();
		expect(tick).not.toHaveBeenCalled();
	});
});
