/**
 * Slot bookkeeping for the index stream (DDB-195): a buffer per upload rather
 * than one buffer written at an advancing offset. It is a hybrid of R5.27's
 * two shapes, slots per flush with the offset shape's two-frame age rule and
 * one vertex array for all of them; `docs/AI_TECHNICAL_DECISIONS/
 * index-buffer-pool.md` says why.
 *
 * Why indices get their own shape. Measured on ANGLE Metal (Radeon Pro 560X,
 * Chrome, paced): a `drawElements` that reads an element buffer written since
 * its last draw pays work proportional to the whole buffer, not to what was
 * written. Six write-then-draw pairs into a 4 MB index buffer took a paced
 * frame from 16.7 to 26.4 ms; into a 256 KB one, nothing measurable. It is
 * triggered by the draw, not the write (six writes followed by six draws cost
 * nothing extra), so it is not copy-on-write of an in-flight buffer; it is the
 * same for 16-bit and 32-bit indices; and in the game, shrinking the index
 * storage alone removed it with the 8 MB vertex ring left as it was. That fits the
 * index-specific work a backend does on a dirtied element buffer, restart-index
 * or index-range bookkeeping over its contents, though which one ANGLE runs was
 * not confirmed from its source. A single ring sized for three frames of the
 * heaviest screen puts the whole ring under every upload's draw: that is what
 * took combat from 60 to 36 FPS when the WebGL2 backend landed.
 *
 * So every upload gets its own buffer, sized to the upload: the draw-time work
 * then scales with the indices actually written. A slot is reused only once
 * the frame that last wrote it is `minAge` frames old (R5.27's two), and the
 * smallest free slot that fits is chosen, so a slot grown for the heaviest
 * upload is not rewritten for every small one. Slots are created, never
 * resized or freed, so a screen's working set stops allocating once it has
 * been seen (R15.11); the pool starts with enough small slots that ordinary
 * screens never create one.
 *
 * Like `StreamRing`, this knows nothing about GL: it answers "which slot, and
 * is it new", and the backend owns the buffers.
 */

export interface IndexBufferPoolOptions {
	/** Slots that exist from the start, each `minCapacity` bytes. */
	initialSlots?: number;
	/** Bytes. The smallest slot; larger slots are powers of two above it. */
	minCapacity?: number;
	/** Frames a slot must age before it may be rewritten (R5.27). */
	minAge?: number;
}

/** Eight uploads a frame, three frames deep: combat, the busiest screen by uploads, has six. */
export const DEFAULT_INITIAL_INDEX_SLOTS = 24;

/** 4096 32-bit indices, which holds most uploads; a larger one gets a larger slot. */
export const DEFAULT_MIN_INDEX_SLOT_BYTES = 16 * 1024;

interface SlotState {
	capacity: number;
	lastFrame: number;
}

export class IndexBufferPool {
	private readonly initialSlots: number;
	private readonly minCapacity: number;
	private readonly minAge: number;
	private readonly slots: SlotState[] = [];
	private currentFrame = -1;
	private lastCreated = false;

	constructor({
		initialSlots = DEFAULT_INITIAL_INDEX_SLOTS,
		minCapacity = DEFAULT_MIN_INDEX_SLOT_BYTES,
		minAge = 2,
	}: IndexBufferPoolOptions = {}) {
		if (!(minCapacity > 0)) throw new Error('IndexBufferPool: minCapacity must be positive');
		if (!(minAge >= 1)) throw new Error('IndexBufferPool: minAge must be at least 1');
		this.initialSlots = Math.max(0, Math.floor(initialSlots));
		this.minCapacity = minCapacity;
		this.minAge = minAge;
		this.reset();
	}

	/** Each slot's capacity in bytes, by slot index. */
	get capacities(): readonly number[] {
		return this.slots.map((slot) => slot.capacity);
	}

	/** Whether the last `acquire` created its slot, so the backend must create and size a buffer for it. */
	get created(): boolean {
		return this.lastCreated;
	}

	capacityOf(slot: number): number {
		return this.slots[slot].capacity;
	}

	/** Frames only move forward, as `StreamRing`'s do. */
	beginFrame(frame: number): void {
		if (frame <= this.currentFrame) {
			throw new Error(`IndexBufferPool: frame ${frame} after frame ${this.currentFrame}`);
		}
		this.currentFrame = frame;
	}

	/**
	 * The smallest slot that holds `bytes` and was last written at least
	 * `minAge` frames ago, or a new slot when none does. The slot is marked
	 * written in this frame. Returns the slot index, stable for the pool's life
	 * (the backend's buffer array is parallel to it); `created` and
	 * `capacityOf` answer the rest, so a steady frame allocates nothing here.
	 */
	acquire(bytes: number): number {
		let best = -1;
		for (let index = 0; index < this.slots.length; index++) {
			const slot = this.slots[index];
			if (slot.capacity < bytes || this.currentFrame - slot.lastFrame < this.minAge) continue;
			if (best < 0 || slot.capacity < this.slots[best].capacity) best = index;
		}

		if (best >= 0) {
			this.slots[best].lastFrame = this.currentFrame;
			this.lastCreated = false;
			return best;
		}

		let capacity = this.minCapacity;
		while (capacity < bytes) capacity *= 2;
		this.slots.push({ capacity, lastFrame: this.currentFrame });
		this.lastCreated = true;
		return this.slots.length - 1;
	}

	/**
	 * Back to the initial slots, all free: after a restored context nothing the
	 * GPU could be reading exists. Frame order is kept, so a restore mid-run
	 * does not trip `beginFrame`.
	 */
	reset(): void {
		this.slots.length = 0;
		for (let index = 0; index < this.initialSlots; index++) {
			this.slots.push({ capacity: this.minCapacity, lastFrame: -Infinity });
		}
	}
}
