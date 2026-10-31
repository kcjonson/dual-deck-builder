import { CLIP_EMPTY, CLIP_NONE, ClipState, ResolvedClip, intersectClipRectInto, keptRoundedClip } from './clip';
import { ClipRect, IDENTITY, Mat2D, isTranslateOnly } from './geometry';

/**
 * The draw API's four state stacks (R2.4 to R2.7), allocation-free once warm
 * (DDB-215). Each level is a frame that the next push at that depth
 * overwrites in place, so a frame of pushes and pops allocates nothing after
 * the deepest nesting has been reached once.
 *
 * What a command carries still outlives the call (R2.4 to R2.7's capture at
 * submission, and the recording backend keeps commands across frames): the
 * transform and clip stacks hand out an immutable copy of a level the first
 * time something is captured under it, and every later capture under the
 * same push shares that copy. A push that nothing draws under copies
 * nothing. The live values (`matrix`, `state`) are valid until the next push
 * or pop and are for reading on the spot, never for keeping.
 */

type MutableMat2D = [number, number, number, number, number, number];

interface TransformFrame {
	readonly matrix: MutableMat2D;
	translateOnly: boolean;
	/** The copy commands under this push carry, taken at the first capture; null until then. */
	captured: Mat2D | null;
}

export class TransformStack {
	private readonly frames: TransformFrame[] = [{ matrix: [...IDENTITY], translateOnly: true, captured: IDENTITY }];
	private depth = 0;
	/** `pushTranslate`'s inner matrix, reused so the product is the same arithmetic as `concat`. */
	private readonly translation: MutableMat2D = [1, 0, 0, 1, 0, 0];

	/** Levels pushed above the root. */
	get pushed(): number {
		return this.depth;
	}

	/** The current local-to-screen matrix; live, valid until the next push or pop. */
	get matrix(): Mat2D {
		return this.frames[this.depth].matrix;
	}

	get translateOnly(): boolean {
		return this.frames[this.depth].translateOnly;
	}

	/** The current matrix as a command keeps it: immutable, shared by every capture under this push. */
	captured(): Mat2D {
		const frame = this.frames[this.depth];
		if (frame.captured === null) frame.captured = [...frame.matrix] as Mat2D;
		return frame.captured;
	}

	/** Pushes the current matrix times `inner`, what pushing a child transform means. */
	push(inner: Mat2D): void {
		const outer = this.frames[this.depth].matrix;
		const frame = this.next();
		const out = frame.matrix;
		// Indexed, not destructured: array destructuring walks an iterator,
		// which allocates until the optimiser removes it.
		const a = outer[0];
		const b = outer[1];
		const c = outer[2];
		const d = outer[3];
		const e = outer[4];
		const f = outer[5];
		out[0] = a * inner[0] + c * inner[1];
		out[1] = b * inner[0] + d * inner[1];
		out[2] = a * inner[2] + c * inner[3];
		out[3] = b * inner[2] + d * inner[3];
		out[4] = a * inner[4] + c * inner[5] + e;
		out[5] = b * inner[4] + d * inner[5] + f;
		// R2.4's flag is decided once, here, from the product, so a draw never
		// re-tests it and a scale under its own inverse gets the cheap snapping
		// path back instead of staying false for the scope.
		frame.translateOnly = isTranslateOnly(out);
	}

	pushTranslate(dx: number, dy: number): void {
		this.translation[4] = dx;
		this.translation[5] = dy;
		this.push(this.translation);
	}

	/** False when nothing was pushed. */
	pop(): boolean {
		if (this.depth === 0) return false;
		this.depth -= 1;
		return true;
	}

	reset(): void {
		this.depth = 0;
	}

	private next(): TransformFrame {
		this.depth += 1;
		let frame = this.frames[this.depth];
		if (!frame) {
			frame = { matrix: [1, 0, 0, 1, 0, 0], translateOnly: true, captured: null };
			this.frames.push(frame);
		}
		frame.captured = null;
		return frame;
	}
}

interface LiveRounded {
	readonly rect: ClipRect;
	radius: number;
}

interface LiveRectClip {
	readonly kind: 'rect';
	readonly rect: ClipRect;
	rounded: LiveRounded | null;
}

interface ClipFrame {
	/** What `state` answers at this level: `CLIP_NONE`, `CLIP_EMPTY`, or `live`. */
	state: ClipState;
	readonly live: LiveRectClip;
	/** This level's own rounded clip, which `live.rounded` points at when it has one. */
	readonly ownRounded: LiveRounded;
	captured: ResolvedClip | null;
}

function clipFrame(state: ClipState): ClipFrame {
	return {
		state,
		live: { kind: 'rect', rect: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, rounded: null },
		ownRounded: { rect: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, radius: 0 },
		captured: null,
	};
}

export class ClipStack {
	private readonly frames: ClipFrame[] = [clipFrame(CLIP_NONE)];
	private depth = 0;

	/** Levels pushed above the root. */
	get pushed(): number {
		return this.depth;
	}

	/** The current clip in screen space, in all three of R4.2's states; live, valid until the next push or pop. */
	get state(): ClipState {
		return this.frames[this.depth].state;
	}

	/** The current clip as a command keeps it, or null under `empty`: immutable, shared by every capture under this push. */
	captured(): ResolvedClip | null {
		const frame = this.frames[this.depth];
		const state = frame.state;
		if (state.kind === 'empty') return null;
		if (state.kind === 'none') return state;
		if (frame.captured === null) {
			const { rect, rounded } = frame.live;
			frame.captured = {
				kind: 'rect',
				rect: { minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY },
				rounded: rounded
					? { rect: { minX: rounded.rect.minX, minY: rounded.rect.minY, maxX: rounded.rect.maxX, maxY: rounded.rect.maxY }, radius: rounded.radius }
					: null,
			};
		}
		return frame.captured;
	}

	/**
	 * R4.3: nesting is intersection, of the current clip with `screen`, which
	 * is copied, by `intersectClip`'s own arithmetic. R4.14: with a `radius`
	 * this level's own rounded clip is `screen` itself; `keptRoundedClip`
	 * chooses between it and the one inherited from below (which has already
	 * contributed its bounding rect), dropping either where it cuts nothing
	 * at `ratio`. True when both cut, so the inherited one degraded to its
	 * bounding rect, which the caller warns about.
	 */
	push(screen: ClipRect, radius: number | null, ratio: number): boolean {
		const current = this.frames[this.depth].state;
		const frame = this.next();
		if (current.kind === 'empty') {
			frame.state = CLIP_EMPTY;
			return false;
		}
		if (!intersectClipRectInto(current, screen, frame.live.rect)) {
			frame.state = CLIP_EMPTY;
			return false;
		}
		let own: LiveRounded | null = null;
		if (radius !== null) {
			own = frame.ownRounded;
			own.rect.minX = screen.minX;
			own.rect.minY = screen.minY;
			own.rect.maxX = screen.maxX;
			own.rect.maxY = screen.maxY;
			own.radius = radius;
		}
		// An ancestor level's own rounded clip, which stays put while it is on the stack.
		const inherited = current.kind === 'rect' ? (current.rounded as LiveRounded | null) : null;
		const kept = keptRoundedClip(frame.live.rect, own, inherited, ratio);
		frame.live.rounded = kept === 'nested' ? own : kept;
		frame.state = frame.live;
		return kept === 'nested';
	}

	/** R3.8 and R4.8's promotion: `none`, whatever was inherited. */
	pushNone(): void {
		this.next().state = CLIP_NONE;
	}

	/** False when nothing was pushed. */
	pop(): boolean {
		if (this.depth === 0) return false;
		this.depth -= 1;
		return true;
	}

	reset(): void {
		this.depth = 0;
	}

	private next(): ClipFrame {
		this.depth += 1;
		let frame = this.frames[this.depth];
		if (!frame) {
			frame = clipFrame(CLIP_NONE);
			this.frames.push(frame);
		}
		frame.captured = null;
		return frame;
	}
}

/**
 * A stack of numbers (opacity) in a typed array, since a fractional number
 * stored in a plain array can be boxed on every write.
 */
export class NumberStack {
	private values: Float64Array;
	private depth = 0;

	constructor({ root }: { root: number }) {
		this.values = new Float64Array(16);
		this.values[0] = root;
	}

	/** Levels pushed above the root. */
	get pushed(): number {
		return this.depth;
	}

	get value(): number {
		return this.values[this.depth];
	}

	push(value: number): void {
		this.depth += 1;
		if (this.depth === this.values.length) {
			const grown = new Float64Array(this.values.length * 2);
			grown.set(this.values);
			this.values = grown;
		}
		this.values[this.depth] = value;
	}

	/** False when nothing was pushed. */
	pop(): boolean {
		if (this.depth === 0) return false;
		this.depth -= 1;
		return true;
	}

	reset(): void {
		this.depth = 0;
	}
}

/** A stack of plain values (a layer name), written by index so a push never allocates once warm. */
export class ValueStack<T> {
	private readonly values: T[];
	private depth = 0;

	constructor({ root }: { root: T }) {
		this.values = [root];
	}

	/** Levels pushed above the root. */
	get pushed(): number {
		return this.depth;
	}

	get value(): T {
		return this.values[this.depth];
	}

	push(value: T): void {
		this.depth += 1;
		this.values[this.depth] = value;
	}

	/** False when nothing was pushed. */
	pop(): boolean {
		if (this.depth === 0) return false;
		this.depth -= 1;
		return true;
	}

	reset(): void {
		this.depth = 0;
	}
}
