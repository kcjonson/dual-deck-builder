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

	it('does not re-request when the tick stops the loop', () => {
		const frames = scheduler();
		const loop: FrameLoop = new FrameLoop({ tick: () => loop.stop(), ...frames });
		loop.start();
		frames.runFrame();
		expect(frames.pending()).toBe(0);
	});
});
