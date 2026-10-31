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
 * A tick that throws halts the loop for good and rethrows, so the page's
 * error handler and the console see it once and the last presented frame
 * stays up under the error overlay (DDB-538, error-overlay.md). A loop that
 * carried on would turn one error into sixty a second, each frame running on
 * whatever state the throw left half done. Nothing restarts a halted loop, a
 * restored GL context included.
 */
export class FrameLoop {
	private readonly tick: () => void;
	private readonly requestFrame: (callback: FrameRequestCallback) => number;
	private readonly cancelFrame: (handle: number) => void;
	private handle = 0;
	private active = false;
	private halted = false;

	constructor({ tick, requestFrame, cancelFrame }: FrameLoopOptions) {
		this.tick = tick;
		this.requestFrame = requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
		this.cancelFrame = cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
	}

	get running(): boolean {
		return this.active;
	}

	/** A tick threw: the loop is stopped and nothing starts it again. */
	get failed(): boolean {
		return this.halted;
	}

	start(): void {
		if (this.active || this.halted) return;
		this.active = true;
		this.handle = this.requestFrame(this.frame);
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.cancelFrame(this.handle);
	}

	/**
	 * One tick now, outside the rAF schedule, when the loop is running; the
	 * scheduled frame still comes. For a callback that runs after this
	 * update's rAF callbacks but before paint (a `ResizeObserver`), where
	 * waiting for the next rAF would present a stale frame. A tick that throws
	 * halts the loop, as it does from rAF.
	 */
	runNow(): void {
		if (!this.active) return;
		this.guardedTick();
	}

	/**
	 * One tick while the loop is stopped, for a caller that has stopped it to
	 * hold the presented frame and still wants a fresh one drawn on demand.
	 * Does nothing while the loop runs, since the next rAF frame is coming,
	 * or once it has failed.
	 */
	step(): void {
		if (this.active || this.halted) return;
		this.guardedTick();
	}

	private guardedTick(): void {
		try {
			this.tick();
		} catch (error) {
			this.stop();
			this.halted = true;
			throw error;
		}
	}

	private frame = (): void => {
		if (!this.active) return;
		this.guardedTick();
		// `tick` may have stopped the loop (a context lost mid-frame is
		// delivered as an event, but a caller is free to stop it directly).
		if (this.active) this.handle = this.requestFrame(this.frame);
	};
}
