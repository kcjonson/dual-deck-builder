import {
	DrawBackend,
	DrawBatch,
	FontAtlasOptions,
	FrameDescription,
	TextureOptions,
} from './DrawBackend';
import { DrawCommandKind, FontAtlasHandle, TextureHandle } from './commands';
import { GpuWork, NO_GPU_WORK } from './stats';

/**
 * R2.21's required null backend: every draw call is accepted and counted and
 * nothing touches a GPU, so the retained tree, layout, lint and input run in
 * unit tests without a context.
 *
 * It reports real zeros from `submit` rather than `null`. That is not a stub
 * standing in for a measurement: this backend rasterises nothing, so zero GPU
 * draws, zero vertices and zero uploaded bytes is what happened. A headless
 * frame therefore reads `apiDraws: 48, gpuDraws: 0`, which is both the honest
 * description and the assertion a test wants. A backend that genuinely cannot
 * attribute its work returns `null` instead, and `backends.test.ts` drives one
 * of those to prove the two paths differ.
 *
 * The command counts it keeps are its own, not R13.12's; `DrawApi.getStats()`
 * is the counter of record. These exist so a test can assert a backend was
 * reached at all, which is the difference between "the draw API dropped
 * everything" and "the draw API submitted and nothing drew".
 */
export class NullBackend implements DrawBackend {
	readonly name = 'null';

	private frames = 0;
	private batches = 0;
	private commands = 0;
	private invalidations = 0;
	private textures = 0;
	private atlases = 0;
	private readonly atlasNames: string[] = [];
	private readonly byKind = new Map<DrawCommandKind, number>();
	private lastFrameDescription: FrameDescription | null = null;

	get frameCount(): number {
		return this.frames;
	}

	get batchCount(): number {
		return this.batches;
	}

	get commandCount(): number {
		return this.commands;
	}

	get invalidateStateCount(): number {
		return this.invalidations;
	}

	get lastFrame(): FrameDescription | null {
		return this.lastFrameDescription;
	}

	get fontAtlasNames(): readonly string[] {
		return this.atlasNames;
	}

	countOf(kind: DrawCommandKind): number {
		return this.byKind.get(kind) ?? 0;
	}

	beginFrame(frame: FrameDescription): void {
		this.frames += 1;
		this.lastFrameDescription = frame;
	}

	submit(batch: DrawBatch): GpuWork {
		this.batches += 1;
		this.commands += batch.commands.length;
		for (const command of batch.commands) {
			this.byKind.set(command.kind, (this.byKind.get(command.kind) ?? 0) + 1);
		}
		return { ...NO_GPU_WORK };
	}

	endFrame(): void {
		// Nothing is pending because nothing was ever queued.
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
