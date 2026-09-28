export interface FrameLoopOptions {
	/** One frame of the application: update, render, flush. */
	tick: () => void;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (handle: number) => void;
}

/**
 * The `requestAnimationFrame` loop both pages run, as something that can be
 * stopped: R15.5 cancels the frame loop while the context is lost, and a loop
 * that only ever re-requests itself at the bottom of its body cannot be.
 *
 * A tick that throws ends the loop, as the hand-written loops it replaces did;
 * a frame loop that swallowed exceptions would turn one error into sixty a
 * second.
 */
export class FrameLoop {
	private readonly tick: () => void;
	private readonly requestFrame: (callback: FrameRequestCallback) => number;
	private readonly cancelFrame: (handle: number) => void;
	private handle = 0;
	private active = false;

	constructor({ tick, requestFrame, cancelFrame }: FrameLoopOptions) {
		this.tick = tick;
		this.requestFrame = requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
		this.cancelFrame = cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
	}

	get running(): boolean {
		return this.active;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.handle = this.requestFrame(this.frame);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.cancelFrame(this.handle);
	}

	private frame = (): void => {
		if (!this.active) return;
		this.tick();
		// `tick` may have stopped the loop (a context lost mid-frame is
		// delivered as an event, but a caller is free to stop it directly).
		if (this.active) this.handle = this.requestFrame(this.frame);
	};
}
