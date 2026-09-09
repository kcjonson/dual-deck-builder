import {
	DrawBackend,
	DrawBatch,
	FontAtlasOptions,
	FrameDescription,
	TextureOptions,
} from './DrawBackend';
import { DrawCommand, FontAtlasHandle, TextureHandle } from './commands';
import { FlushReason, GpuWork, NO_GPU_WORK } from './stats';

/**
 * R2.22's recording backend, and the one worldsim never built: it returns the
 * sorted draw list so a test can assert what would have been drawn and in what
 * order. R2.22 rates it SHOULD, but chapter 3's required tests (3.12: group
 * order, barrier isolation, shadow adjacency, promotion, determinism) all read
 * that list, so it lands with the API rather than with the batcher that needs
 * it.
 *
 * "Sorted" is not this class's doing and deliberately so. The draw API applies
 * R3.10's partition before it submits, so what arrives here is already in emit
 * order and every backend sees the same order. A recording backend that sorted
 * for itself would let two backends disagree about what a frame looked like,
 * and the required order tests would then be asserting one backend's private
 * behaviour rather than the system's.
 *
 * It stores the commands it was handed, unchanged and uncopied. That is cheap
 * only because a command is inert: nothing downstream can mutate one, and every
 * value on one was copied out of the caller's memory at submission, so a
 * recording taken in frame 1 still describes frame 1 after frame 90. There is a
 * test for exactly that.
 *
 * Recordings are per frame and per batch, because a batch boundary is a barrier
 * (R3.20) and "the tooltip group emitted before the flush" is the distinction
 * R3.12's barrier-isolation test asserts. `commands` flattens the frame for the
 * common case where the domain does not matter.
 */

export interface RecordedBatch {
	readonly domain: number;
	readonly reason: FlushReason;
	readonly commands: readonly DrawCommand[];
}

export interface RecordedFrame {
	readonly frame: number;
	readonly batches: readonly RecordedBatch[];
}

export interface RecordingBackendOptions {
	/** Frames kept, oldest dropped. One is enough for most tests and is the default. */
	maxFrames?: number;
}

export class RecordingBackend implements DrawBackend {
	readonly name = 'recording';

	private readonly maxFrames: number;
	private readonly recorded: RecordedFrame[] = [];
	private open: { frame: number; batches: RecordedBatch[] } | null = null;
	private invalidations = 0;
	private textures = 0;
	private atlases = 0;
	private readonly atlasNames: string[] = [];

	constructor({ maxFrames = 1 }: RecordingBackendOptions = {}) {
		this.maxFrames = Math.max(1, maxFrames);
	}

	/** Every frame still kept, oldest first. */
	get frames(): readonly RecordedFrame[] {
		return this.recorded;
	}

	get lastFrame(): RecordedFrame | null {
		return this.recorded.length > 0 ? this.recorded[this.recorded.length - 1] : null;
	}

	get batches(): readonly RecordedBatch[] {
		return this.lastFrame ? this.lastFrame.batches : [];
	}

	/** The last frame's commands, every domain concatenated in emit order. */
	get commands(): readonly DrawCommand[] {
		const flat: DrawCommand[] = [];
		for (const batch of this.batches) flat.push(...batch.commands);
		return flat;
	}

	/** Ids in emit order, unidentified commands as `null`; the readable form of an order assertion. */
	get ids(): readonly (string | null)[] {
		return this.commands.map((command) => command.id);
	}

	get layerOrder(): readonly string[] {
		return this.commands.map((command) => command.layer);
	}

	get invalidateStateCount(): number {
		return this.invalidations;
	}

	get fontAtlasNames(): readonly string[] {
		return this.atlasNames;
	}

	clear(): void {
		this.recorded.length = 0;
		this.open = null;
	}

	beginFrame(frame: FrameDescription): void {
		this.open = { frame: frame.frame, batches: [] };
	}

	submit(batch: DrawBatch): GpuWork {
		// A submit outside a frame cannot happen through the draw API, which
		// refuses to flush when no frame is open. Recording it rather than
		// throwing keeps this backend usable by hand in a test.
		if (!this.open) this.open = { frame: -1, batches: [] };
		this.open.batches.push({
			domain: batch.domain,
			reason: batch.reason,
			commands: batch.commands,
		});
		return { ...NO_GPU_WORK };
	}

	endFrame(): void {
		if (!this.open) return;
		this.recorded.push({ frame: this.open.frame, batches: this.open.batches });
		this.open = null;
		while (this.recorded.length > this.maxFrames) this.recorded.shift();
	}

	invalidateState(): void {
		this.invalidations += 1;
	}

	createTexture({ width, height, label }: TextureOptions): TextureHandle {
		this.textures += 1;
		return { id: this.textures, width, height, label: label ?? null };
	}

	destroyTexture(): void {
		// Handles are plain values; there is nothing to release.
	}

	loadFontAtlas({ name }: FontAtlasOptions): FontAtlasHandle {
		this.atlases += 1;
		this.atlasNames.push(name);
		return { id: this.atlases, name };
	}
}
