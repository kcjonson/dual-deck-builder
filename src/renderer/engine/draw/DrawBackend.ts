import {
	DrawCommand,
	FontAtlasHandle,
	MeasureTextOptions,
	TextMetrics,
	TextureHandle,
} from './commands';
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
 * a different and lower seam than this one, one layer under the batcher, and it
 * arrives with the WebGL2 backend. Naming this `DrawBackend` in `draw/` leaves
 * `gpu/Backend.ts` free for R15.38 with no collision and no file move when the
 * fourth backend lands.
 *
 * The three implementations this seam has to fit today:
 *
 * - `NullBackend` (R2.21) accepts and counts, touches nothing.
 * - `RecordingBackend` (R2.22) keeps the arrays it was handed so a test can
 *   assert what would have been drawn and in what order.
 * - `LegacyGLBackend`, next PR, whose body is today's `Renderer`: it walks the
 *   array and issues one GL draw per command, which is what the current shader
 *   forces (one unit quad times a per-draw model matrix).
 *
 * And the one it has to fit later: the WebGL2 backend of chapter 15, which
 * packs the same array into an instance buffer. Nothing here presumes either.
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

export interface TextureOptions {
	width: number;
	height: number;
	/** Premultiplied RGBA8 (R5.18). */
	pixels?: Uint8Array;
	label?: string;
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

	// -- resources (R2.17, R2.18) -------------------------------------------

	createTexture(options: TextureOptions): TextureHandle;
	destroyTexture(handle: TextureHandle): void;
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
}
