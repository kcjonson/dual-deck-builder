import type { RoundedClip } from '../draw';

/** Entries a frame can hold: the instance's index byte, less zero for "none". */
export const ROUNDED_CLIP_CAPACITY = 255;

/** Floats per entry, two std140 vec4s: centre and half size, then the radius and three unused lanes. */
export const ROUNDED_CLIP_FLOATS = 8;

export interface RoundedClipTableOptions {
	/** Entries before `indexOf` answers 0; `ROUNDED_CLIP_CAPACITY` unless a test wants fewer. */
	capacity?: number;
	/** Once per frame, when a rounded clip did not fit and its draws clip to the bounding rect. */
	onOverflow?: (() => void) | null;
}

/**
 * R4.14's rounded-clip parameters, stored once per frame and referenced by a
 * byte on each instance (R5.4's per-flush table, kept for the whole frame so
 * an index never has to be renumbered between uploads). Entry `n` is
 * referenced as `n + 1`; 0 is "no rounded clip". The backend appends what
 * each upload added to the frame's uniform slot before drawing it.
 *
 * Consecutive draws under one push share its captured `RoundedClip`, so the
 * last one is remembered by identity; a second push with the same values
 * (the same panel drawn again after a sibling's clip) is found by comparing
 * with the last entry. Anything else appends.
 */
export class RoundedClipTable {
	readonly capacity: number;
	readonly floats: Float32Array;
	private countValue = 0;
	private lastClip: RoundedClip | null = null;
	private lastIndex = 0;
	private overflowed = false;
	private readonly onOverflow: (() => void) | null;

	constructor({ capacity = ROUNDED_CLIP_CAPACITY, onOverflow = null }: RoundedClipTableOptions = {}) {
		this.capacity = Math.min(capacity, ROUNDED_CLIP_CAPACITY);
		this.floats = new Float32Array(this.capacity * ROUNDED_CLIP_FLOATS);
		this.onOverflow = onOverflow;
	}

	/** Entries written this frame. */
	get count(): number {
		return this.countValue;
	}

	/** Between frames: every index handed out is void. */
	reset(): void {
		this.countValue = 0;
		this.lastClip = null;
		this.lastIndex = 0;
		this.overflowed = false;
	}

	/**
	 * The instance index for `clip`, appending it if it is new. 0 for a radius
	 * that rounds nothing and for a table that is full, in which case the
	 * draw keeps the bounding rect it already carries.
	 */
	indexOf(clip: RoundedClip): number {
		if (clip === this.lastClip) return this.lastIndex;
		const { minX, minY, maxX, maxY } = clip.rect;
		const halfWidth = (maxX - minX) / 2;
		const halfHeight = (maxY - minY) / 2;
		// R5.5's clamp, so a radius past the half extent is a capsule rather than a cusp.
		const radius = Math.min(clip.radius, halfWidth, halfHeight);
		const centreX = minX + halfWidth;
		const centreY = minY + halfHeight;

		let index = 0;
		if (radius > 0) {
			const floats = this.floats;
			const last = (this.countValue - 1) * ROUNDED_CLIP_FLOATS;
			if (
				this.countValue > 0 &&
				floats[last] === Math.fround(centreX) &&
				floats[last + 1] === Math.fround(centreY) &&
				floats[last + 2] === Math.fround(halfWidth) &&
				floats[last + 3] === Math.fround(halfHeight) &&
				floats[last + 4] === Math.fround(radius)
			) {
				index = this.countValue;
			} else if (this.countValue < this.capacity) {
				const base = this.countValue * ROUNDED_CLIP_FLOATS;
				floats[base] = centreX;
				floats[base + 1] = centreY;
				floats[base + 2] = halfWidth;
				floats[base + 3] = halfHeight;
				floats[base + 4] = radius;
				this.countValue += 1;
				index = this.countValue;
			} else if (!this.overflowed) {
				this.overflowed = true;
				this.onOverflow?.();
			}
		}
		this.lastClip = clip;
		this.lastIndex = index;
		return index;
	}
}
