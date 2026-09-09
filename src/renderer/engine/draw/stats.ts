import { LAYER_NAMES, LayerName } from './layers';

/**
 * The batcher counters of R13.12 to R13.15, under R13.5's discipline: every
 * field either carries a number this layer can derive, or `null` meaning "the
 * field applies and nobody measured it", never zero standing in for unknown.
 * Phase 0 shipped a per-draw vertex counter that read `5327.999999999999`
 * because it was synthesised from a byte count. Nothing here synthesises
 * anything, and `FrameTimer` set the precedent by leaving its input, layout and
 * present sections null rather than zero.
 *
 * What this PR fills, and where each number comes from:
 *
 * - `apiDraws`   draw groups emitted, counted at emission, so a shadowed rect
 *                and a shadowed text run each count two (R13.12's "draw groups
 *                plus shadow groups"). A draw the clip dropped is NOT counted
 *                here, because it produced no draw group; it is counted under
 *                `culled`, and `apiDraws + culled` is the number of groups the
 *                frame asked for.
 * - `culled`     draws dropped on the CPU by the clip: R4.2's `empty` state and
 *                R4.2a's bounds rejection, both counted where they happen. Text
 *                is exempt from the bounds test until R6.8's glyph iteration
 *                exists, which `bounds.ts` states and a test asserts.
 * - `clipPushes` counted at `pushClip`, `pushClipRounded` and `pushClipReset`
 *                (R4.17).
 * - `flushes`    `barrier` and `endFrame` are caused here and counted here.
 *                `targetChange` and `bufferFull` are backend-caused and this
 *                seam gives a backend no way to cause one, so the count of such
 *                flushes really is zero rather than unmeasured.
 * - `groupsByLayer` counted at emission, every one of R3.5's nine bands present
 *                with an explicit zero, because "how many groups in modal" has
 *                a real answer of zero. R13.13 calls this the number that
 *                explains a reorder.
 * - `reorderedGroups` groups emitted at a position different from their
 *                submission position within their domain, measured by comparing
 *                the partition's output against submission order. It is zero on
 *                a single-layer frame and non-zero the moment a popup opens, so
 *                it is a measurement rather than a tautology.
 * - `clipChange` / `shaderChange`: R13.13 requires these to exist and to read
 *                zero under this design. Clip is per-draw data (R4.1) and there
 *                is one uber shader (R5.1), so a non-zero value is a failure,
 *                which is the whole reason the counters are kept rather than
 *                deleted.
 *
 * What is null, and what fills it:
 *
 * - `occluded`   R3.2's occlusion drop is a MAY and is not implemented. Zero
 *                would claim a coverage test ran and found nothing to drop; no
 *                such test runs.
 * - `gpuDraws`, `vertices`, `triangles`, `instances`, `textureBinds`,
 *   `bytesUploaded`, `splits` come from whoever did the GPU work: a backend's
 *   return from `submit`, or a foreign pass through `reportForeignDraws`
 *   (R2.16, R13.15). Only the backend knows how many quads a bordered rounded
 *   rect became. A backend that reports nothing leaves them null for the frame.
 *   The null and recording backends report real zeros: they rasterise nothing,
 *   so zero draws, zero vertices and zero uploaded bytes is what happened.
 * - `residentTextureBytes`, `pendingUploads`, `evictions`, `targetSwitches` are
 *   R13.14's resource-layer counters. R5.30 to R5.35's resource manager is a
 *   later PR; `createTexture` here forwards to a backend and keeps no residency
 *   accounting, so there is nothing to ask.
 */

export const FLUSH_REASONS = ['barrier', 'endFrame', 'targetChange', 'bufferFull'] as const;
export type FlushReason = (typeof FLUSH_REASONS)[number];

export const SPLIT_REASONS = ['textureSlotsExhausted', 'blendChange', 'stencilLevel'] as const;
export type SplitReason = (typeof SPLIT_REASONS)[number];

export type FlushCounts = Record<FlushReason, number>;
export type SplitCounts = Record<SplitReason, number>;
export type LayerCounts = Record<LayerName, number>;

export interface DrawStats {
	apiDraws: number;
	gpuDraws: number | null;
	vertices: number | null;
	triangles: number | null;
	instances: number | null;
	culled: number;
	occluded: number | null;
	flushes: FlushCounts;
	splits: SplitCounts | null;
	groupsByLayer: LayerCounts;
	reorderedGroups: number;
	clipChange: number;
	shaderChange: number;
	textureBinds: number | null;
	clipPushes: number;
	bytesUploaded: number | null;
	residentTextureBytes: number | null;
	pendingUploads: number | null;
	evictions: number | null;
	targetSwitches: number | null;
}

/** What a backend or a foreign pass adds to the frame's GPU-side counters (R13.15). */
export interface GpuWork {
	gpuDraws: number;
	vertices: number;
	triangles: number;
	instances: number;
	textureBinds: number;
	bytesUploaded: number;
	splits?: Partial<SplitCounts>;
}

export const NO_GPU_WORK: GpuWork = {
	gpuDraws: 0,
	vertices: 0,
	triangles: 0,
	instances: 0,
	textureBinds: 0,
	bytesUploaded: 0,
};

function zeroFlushes(): FlushCounts {
	return { barrier: 0, endFrame: 0, targetChange: 0, bufferFull: 0 };
}

function zeroSplits(): SplitCounts {
	return { textureSlotsExhausted: 0, blendChange: 0, stencilLevel: 0 };
}

function zeroLayers(): LayerCounts {
	const counts = {} as LayerCounts;
	for (const name of LAYER_NAMES) counts[name] = 0;
	return counts;
}

/**
 * The mutable per-frame counters. `gpu` stays null until something reports GPU
 * work, so a frame in which no backend reported keeps R13.5's distinction
 * between "no draws" and "nobody counted".
 */
export class DrawCounters {
	private apiDraws = 0;
	private culled = 0;
	private clipPushes = 0;
	private reordered = 0;
	private flushes: FlushCounts = zeroFlushes();
	private layers: LayerCounts = zeroLayers();
	private gpu: GpuWork | null = null;
	private splits: SplitCounts | null = null;

	reset(): void {
		this.apiDraws = 0;
		this.culled = 0;
		this.clipPushes = 0;
		this.reordered = 0;
		this.flushes = zeroFlushes();
		this.layers = zeroLayers();
		this.gpu = null;
		this.splits = null;
	}

	countApiDraw(layer: LayerName): void {
		this.apiDraws += 1;
		this.layers[layer] += 1;
	}

	countCulled(): void {
		this.culled += 1;
	}

	countClipPush(): void {
		this.clipPushes += 1;
	}

	countFlush(reason: FlushReason): void {
		this.flushes[reason] += 1;
	}

	countReordered(groups: number): void {
		this.reordered += groups;
	}

	addGpuWork(work: GpuWork): void {
		const total = this.gpu ?? { ...NO_GPU_WORK };
		total.gpuDraws += work.gpuDraws;
		total.vertices += work.vertices;
		total.triangles += work.triangles;
		total.instances += work.instances;
		total.textureBinds += work.textureBinds;
		total.bytesUploaded += work.bytesUploaded;
		this.gpu = total;

		if (work.splits) {
			const splits = this.splits ?? zeroSplits();
			for (const reason of SPLIT_REASONS) splits[reason] += work.splits[reason] ?? 0;
			this.splits = splits;
		}
	}

	snapshot(): DrawStats {
		const gpu = this.gpu;
		return {
			apiDraws: this.apiDraws,
			gpuDraws: gpu ? gpu.gpuDraws : null,
			vertices: gpu ? gpu.vertices : null,
			triangles: gpu ? gpu.triangles : null,
			instances: gpu ? gpu.instances : null,
			culled: this.culled,
			occluded: null,
			flushes: { ...this.flushes },
			splits: this.splits ? { ...this.splits } : null,
			groupsByLayer: { ...this.layers },
			reorderedGroups: this.reordered,
			clipChange: 0,
			shaderChange: 0,
			textureBinds: gpu ? gpu.textureBinds : null,
			clipPushes: this.clipPushes,
			bytesUploaded: gpu ? gpu.bytesUploaded : null,
			residentTextureBytes: null,
			pendingUploads: null,
			evictions: null,
			targetSwitches: null,
		};
	}
}
