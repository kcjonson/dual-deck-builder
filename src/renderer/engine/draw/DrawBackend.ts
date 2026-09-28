import {
	DrawCommand,
	DrawTextOptions,
	FontAtlasHandle,
	MeasureTextOptions,
	TextMetrics,
	TextureHandle,
} from './commands';
export type { TextureOptions } from '../gpu/TextureStore';
import type { TextureStore } from '../gpu/TextureStore';
import { Rect } from './geometry';
import { FlushReason, GpuWork } from './stats';

/**
 * The one seam between the draw API and anything that talks to a GPU.
 *
 * A backend receives fully resolved commands, already in emit order, one sort
 * domain at a time. It is handed the array rather than each command as it is
 * submitted, because the domain is the unit chapter 3 orders (R3.10) and
 * chapter 5 packs: a per-command entry point forces every backend to
 * re-accumulate what the draw API already accumulated, and leaves the batcher
 * nowhere to sit.
 *
 * A backend never sees a stack, a push, or a pop. It cannot: the partition of
 * R3.10 moves a command away from the call that produced it, so ambient state
 * is captured at submission (R2.4 to R2.7) and travels on the command. That is
 * the design decision this whole module exists to express, and this interface
 * is where it is enforced by shape rather than by convention.
 *
 * WHY THIS FILE IS NOT `gpu/Backend.ts`. The phase 1 recon note puts the
 * backends under `src/renderer/engine/gpu/` and describes that file as the
 * R15.38 seam: render passes as objects with attachments and clear operations,
 * immutable pipeline keys, bind groups, uniform blocks, async readback. That is
 * a different and lower seam than this one, one layer under the batcher. The
 * WebGL2 backend did not split it out: with one program and one texture there
 * is nothing for a pipeline key or a bind group to select between. The
 * resource layer (DDB-66) landed as `gpu/TextureStore.ts` without needing one
 * either, since it binds nothing for drawing; the uber shader (DDB-64) is the
 * first that will. Naming this `DrawBackend` in `draw/` leaves
 * `gpu/Backend.ts` free for R15.38 with no collision and no file move when the
 * fourth backend lands.
 *
 * The three implementations this seam has to fit today:
 *
 * - `NullBackend` (R2.21) accepts and counts, touches nothing.
 * - `RecordingBackend` (R2.22) keeps the arrays it was handed so a test can
 *   assert what would have been drawn and in what order.
 * - `WebGL2Backend` (chapter 15): it hands the array to a `Batcher`, today
 *   with the legacy program's per-vertex encoder, so a domain becomes one GPU
 *   draw unless something splits it.
 *
 * And the change it has to absorb next: the uber shader (DDB-64), which hands
 * the same array to the same `Batcher` with an instance encoder. The batcher
 * sits behind this seam rather than in front of it because what a group's
 * geometry looks like is the backend's vertex format (R5.4); see `Batcher.ts`.
 */

export interface FrameDescription {
	/** Logical viewport in logical pixels (R7.1). */
	readonly viewport: { readonly width: number; readonly height: number };
	/** `dpr * uiScale` (R7.2); the only place device pixels enter this module. */
	readonly ratio: number;
	/** Monotonic frame index since construction, for a backend's buffer ring. */
	readonly frame: number;
}

/** One sort domain (chapter 3), in final emit order, ended by the named barrier. */
export interface DrawBatch {
	/** Index of this domain within the frame, from zero. Keys never compare across domains (R3.20). */
	readonly domain: number;
	readonly reason: FlushReason;
	/** R3.10's per-layer partition already applied; submission order inside each layer. */
	readonly commands: readonly DrawCommand[];
}

export interface FontAtlasOptions {
	/** The name `drawText`'s `font` field selects; R11.8's three roles. */
	name: string;
	/** msdf-atlas-gen's metrics schema (R6.2); the backend that renders text validates it. */
	metrics: unknown;
	texture: TextureHandle;
}

export interface DrawBackend {
	readonly name: string;

	beginFrame(frame: FrameDescription): void;

	/**
	 * Returns the GPU work this submission performed so the draw API can fold
	 * it into R13.12's counters, or `null` when the backend cannot attribute
	 * it. `null` is not zero: it leaves `gpuDraws` and the geometry counters
	 * null for the frame rather than reporting a count nobody took.
	 */
	submit(batch: DrawBatch): GpuWork | null;

	endFrame(): void;

	/**
	 * R2.15: a foreign pass that left the GPU in a state the batcher does not
	 * expect calls this, and the backend rebinds on its next flush. The batcher
	 * MUST NOT ask the GPU what its state is; a synchronous query stalls
	 * through ANGLE, and R15.22 bans `getParameter` in the frame loop by name.
	 * There is deliberately no read side to this interface for that reason.
	 */
	invalidateState(): void;

	// -- resources (R2.17, R2.18, R5.30) ------------------------------------

	/**
	 * R5.30's resource layer. The draw API creates, retains and releases
	 * through it and drives its frame (uploads at `beginFrame`, deferred frees
	 * after `endFrame`); the backend resolves a handle to its own texture
	 * object with `native` when it draws. The null and recording backends
	 * hold one over `NULL_TEXTURE_DEVICE`, so they count textures too.
	 */
	readonly textures: TextureStore<unknown>;
	loadFontAtlas(options: FontAtlasOptions): FontAtlasHandle;
	/** Atlases loaded so far. R2.18's precondition is checked against this. */
	readonly fontAtlasNames: readonly string[];

	/**
	 * R2.14, optional because it is the one call that cannot be answered
	 * without the font metrics of chapter 6, and a backend with no atlas has
	 * nothing honest to return. It hangs here rather than on `DrawApi` so that
	 * R2.14's "MUST use the same iteration as drawText" is structural: one
	 * object owns the glyph walk and answers both calls, so they cannot drift
	 * the way worldsim's centred text did. `DrawApi.measureText` throws when a
	 * backend omits it rather than substituting an estimate.
	 */
	measureText?(options: MeasureTextOptions): TextMetrics;

	/**
	 * R4.2a's per-run test for text: a conservative local-space extent of the
	 * run as this backend would draw it, or null when it cannot say. Optional
	 * for the same reason as `measureText`: the extent needs the glyph walk,
	 * and only the object that owns the atlas can take it without guessing. A
	 * backend that omits it leaves text exempt from the bounds cull, which is
	 * correct, just slower. Distinct from `measureText` because this is ink for
	 * a cull and carries none of R2.14's layout contract.
	 */
	textInk?(options: DrawTextOptions): Rect | null;
}
