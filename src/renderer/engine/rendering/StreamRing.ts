/**
 * Offset bookkeeping for one fixed-capacity GPU stream buffer (R5.27, R15.11).
 *
 * R5.27 allows two shapes of stream storage: a ring of at least three buffers
 * per flush, or one buffer of at least three frames' capacity written at a
 * monotonically advancing offset that wraps only when the region being
 * overwritten is at least two frames old. This is the second. It knows nothing
 * about GL: the backend asks it where the next upload goes, and it answers with
 * a byte offset or with -1 when the only place left would overwrite a region
 * the GPU may still be reading. The backend decides what -1 means (it grows the
 * buffer once and says so), so the rule "never write into a live region" lives
 * here as arithmetic a unit test can pin.
 *
 * Positions are virtual: `head` counts every byte ever handed out, plus the
 * tail skipped when an upload does not fit before the end of the buffer, so
 * the physical offset is `position % capacity` and "how far back does the live
 * region start" is a subtraction rather than a case analysis over wraps.
 */

export interface StreamRingOptions {
	/** Bytes. Fixed for the life of the ring; growth is a new ring (`reset`). */
	capacity: number;
	/**
	 * How many frames a region must age before it may be overwritten. R5.27's
	 * two: a region written in frame `f` is reusable from frame `f + 2` on.
	 */
	minAge?: number;
}

interface FrameMark {
	frame: number;
	start: number;
}

export class StreamRing {
	private capacityBytes: number;
	private readonly minAge: number;
	/** Virtual position of the next free byte. */
	private head = 0;
	/** Where each of the last `minAge` frames started, oldest overwritten first. */
	private readonly marks: FrameMark[];
	private currentFrame = -1;

	constructor({ capacity, minAge = 2 }: StreamRingOptions) {
		if (!(capacity > 0)) throw new Error('StreamRing: capacity must be positive');
		if (!(minAge >= 1)) throw new Error('StreamRing: minAge must be at least 1');
		this.capacityBytes = capacity;
		this.minAge = minAge;
		this.marks = Array.from({ length: minAge }, () => ({ frame: -Infinity, start: 0 }));
	}

	get capacity(): number {
		return this.capacityBytes;
	}

	/** Records where this frame's writes start. Frames only move forward. */
	beginFrame(frame: number): void {
		if (frame <= this.currentFrame) {
			throw new Error(`StreamRing: frame ${frame} after frame ${this.currentFrame}`);
		}
		this.currentFrame = frame;
		const mark = this.marks[frame % this.minAge];
		mark.frame = frame;
		mark.start = this.head;
	}

	/**
	 * The byte offset of `bytes` fresh bytes aligned to `alignment`, or -1 when
	 * the ring cannot hold them without overwriting a region younger than
	 * `minAge` frames. An upload never straddles the end of the buffer.
	 */
	allocate(bytes: number, alignment: number): number {
		if (bytes > this.capacityBytes) return -1;
		let position = alignUp(this.head, alignment);
		const physical = position % this.capacityBytes;
		if (physical + bytes > this.capacityBytes) {
			position += this.capacityBytes - physical;
		}
		if (position + bytes - this.liveStart() > this.capacityBytes) return -1;
		this.head = position + bytes;
		return position % this.capacityBytes;
	}

	/**
	 * A new, empty buffer of `capacity` bytes behind the same ring: after
	 * growth, or after a restored context, nothing the GPU could be reading
	 * lives in it.
	 */
	reset(capacity: number = this.capacityBytes): void {
		if (!(capacity > 0)) throw new Error('StreamRing: capacity must be positive');
		this.capacityBytes = capacity;
		this.head = 0;
		for (const mark of this.marks) {
			mark.frame = -Infinity;
			mark.start = 0;
		}
		if (this.currentFrame >= 0) {
			const mark = this.marks[this.currentFrame % this.minAge];
			mark.frame = this.currentFrame;
		}
	}

	/** The oldest virtual position still live: the start of the oldest of the last `minAge` frames. */
	private liveStart(): number {
		let start = this.head;
		for (const mark of this.marks) {
			if (this.currentFrame - mark.frame < this.minAge && mark.start < start) start = mark.start;
		}
		return start;
	}
}

function alignUp(value: number, alignment: number): number {
	const remainder = value % alignment;
	return remainder === 0 ? value : value + alignment - remainder;
}
