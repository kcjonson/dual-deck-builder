import type { Clock } from '../../../engine/animation/Clock';
import type { FrameTicker, UiFrame } from '../../../engine/components/UiFrame';

/**
 * Beats on the frame clock (R8.28), for the enemy turn (DDB-112): after a
 * wait, `onBeat` runs and says how long until the next one, or null to stop.
 * Time is reading time, not motion, so reduced motion leaves it alone; a
 * paused or frozen clock holds it. One beat at most per frame.
 */
export class EnemyTurnPacer implements FrameTicker {
	private readonly frame: UiFrame;
	private readonly clock: Clock;
	private readonly onBeat: () => number | null;
	private dueAt: number | null = null;

	constructor({ frame, clock, onBeat }: { frame: UiFrame; clock: Clock; onBeat: () => number | null }) {
		this.frame = frame;
		this.clock = clock;
		this.onBeat = onBeat;
	}

	public get running(): boolean {
		return this.dueAt !== null;
	}

	/** The first beat comes `delayMs` of frame time from now. */
	public start(delayMs: number): void {
		this.dueAt = this.clock.now + delayMs;
		this.frame.requestTick(this);
	}

	/** No more beats; a tick already requested finds nothing to do. */
	public stop(): void {
		this.dueAt = null;
	}

	public tick(): void {
		if (this.dueAt === null) return;
		if (this.clock.now >= this.dueAt) {
			const next = this.onBeat();
			// A beat that ended the screen stopped the pacer
			if (this.dueAt === null) return;
			if (next === null) {
				this.dueAt = null;
				return;
			}
			this.dueAt = this.clock.now + next;
		}
		this.frame.requestTick(this);
	}
}
