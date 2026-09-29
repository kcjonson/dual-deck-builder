/**
 * R8.28's frame clock: the one source of time for UI code. It reads no
 * platform timer; the frame advances it once per update phase with the
 * frame's clamped delta (R13.9), so a paused page stops it and a test moves it
 * exactly as far as it says.
 *
 * Milliseconds throughout, the unit of the motion tokens and of
 * `performance.now`. `Component.update(dt)` keeps R8.17's seconds.
 */
export class Clock {
	private elapsed = 0;
	private delta = 0;
	private frames = 0;

	/** While frozen, a frame still counts but no time passes (R13.37). */
	public frozen = false;

	/** Milliseconds of frame time since the clock was built. */
	public get now(): number {
		return this.elapsed;
	}

	/** Milliseconds the last frame advanced; 0 while frozen. */
	public get dt(): number {
		return this.delta;
	}

	/** Frames advanced, frozen ones included. */
	public get frame(): number {
		return this.frames;
	}

	public advance(milliseconds: number): void {
		if (!(milliseconds >= 0) || !Number.isFinite(milliseconds)) {
			throw new Error(`Clock.advance: ${milliseconds} is not a finite, non-negative duration`);
		}
		this.frames += 1;
		this.delta = this.frozen ? 0 : milliseconds;
		this.elapsed += this.delta;
	}
}
