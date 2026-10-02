import {
	DrawBackend,
	DrawBatch,
	FontAtlasOptions,
	TextureOptions,
} from './DrawBackend';
import {
	FEATHER_MITER_LIMIT,
	SUBTREE_INK_OUTSET,
	circleInk,
	lineInk,
	pointsInk,
	rectInk,
	screenInk,
	shadowInk,
} from './bounds';
import { isSingleOutline } from './triangulate';
import { snapClipRectInto } from '../coords/snapping';
import {
	ClipState,
	clipRadiusScale,
	clipRectOf,
} from './clip';
import { ClipStack, NumberStack, TransformStack, ValueStack } from './drawStacks';
import {
	BlendMode,
	Border,
	BoxShadow,
	CornerColors,
	CornerRadii,
	DrawCircleOptions,
	DrawCommand,
	DrawGroupRole,
	DrawImageOptions,
	DrawLineOptions,
	DrawPolygonOptions,
	DrawPolylineOptions,
	DrawRectOptions,
	DrawTextOptions,
	FontAtlasHandle,
	MeasureTextOptions,
	NineSlice,
	ResolvedState,
	TextMetrics,
	TextureHandle,
} from './commands';
import {
	Mat2D,
	RGBA,
	Rect,
	Vec2,
	ClipRect,
	copyColor,
	copyRect,
	copyVec2,
	inflate,
	intersects,
	isAxisAligned,
	transformedBounds,
} from './geometry';
import { LayerPartition } from './layerPartition';
import { LayerName, ROOT_LAYER, layerOrdinal } from './layers';
import { DrawCounters, DrawStats, FlushReason, GpuWork } from './stats';

/**
 * The immediate draw API of chapter 2.
 *
 * Imports nothing outside this directory. No GL, no DOM, no `window`, no
 * canvas, so the module is importable and fully exercisable under Jest's node
 * environment (R14.1), which is also how R2.21's null backend earns its keep.
 *
 * WHERE STATE IS RESOLVED, which is the decision everything else follows from.
 * R2.4 to R2.7 say the four stacks are "captured into each draw at submission
 * time (nothing is GPU state)". So a draw call reads the stacks once, at the
 * call, and stamps the resolved values onto a `DrawCommand`: the concatenated
 * transform and its translate-only flag, the screen-space clip already
 * intersected down the stack, the multiplied opacity, and the layer name with
 * its ordinal. From that point the command is inert plain data, and every value
 * on it is copied out of the caller's memory so nothing aliases a rect or a
 * colour array a component reuses next frame.
 *
 * It has to work that way, not merely may. R3.10's partition moves a group away
 * from the call that produced it, so by the time a group is emitted the stacks
 * have unwound and any state it did not capture is gone. R4.6 says it outright
 * for the clip: "sorting, texture splitting, and later pushes and pops cannot
 * change what a vertex is clipped to". Resolving anywhere later is not a
 * different implementation of the same rule, it is a different rule.
 *
 * WHAT ORDERING HAPPENS HERE, and what does not. R3.10's stable per-layer
 * partition runs before submission, so the array a backend receives is already
 * in emit order and R2.22's "sorted draw list" is true for every backend rather
 * than for whichever one implemented a sort. This is the front half of the
 * batcher. The back half, which merges geometry into GPU draws, selects texture
 * slots, and splits a submission with a reason, is `Batcher`, owned by the
 * backend because it writes the backend's vertex format. Nothing here drops a
 * group as occluded (R3.2 is a MAY and `occluded` stays null).
 *
 * WHAT IT COSTS. One object per draw group per frame, plus the copies. The
 * heaviest screen in this game submits 96 draws at a p99 of 1.02 ms against a
 * 16.67 ms budget, and these are short-lived, same-shaped, young-generation
 * objects, which is the pattern a generational collector handles best. A free
 * list behind this same interface is the escape hatch if a stress scene ever
 * proves otherwise, and it should not be taken pre-emptively: pooling is
 * exactly what would destroy the inert, outlives-the-call property the
 * recording backend and the partition depend on.
 *
 * The state stacks are the exception, because nothing outlives a push but
 * what a command captured: each level is a pooled frame the next push at that
 * depth overwrites, and the transform and clip are copied once per push, at
 * the first capture under it, and shared by every command after it
 * (`drawStacks.ts`, DDB-215). A push nothing draws under costs nothing.
 */

export type DiagnosticCode =
	| 'call-outside-frame'
	| 'frame-already-open'
	| 'pop-empty-stack'
	| 'unbalanced-stack'
	| 'clip-under-non-translate-transform'
	| 'nested-rounded-clip'
	| 'layer-lowered'
	| 'opacity-out-of-range'
	| 'text-before-atlas'
	| 'texture-upload-in-frame'
	| 'texture-not-live'
	| 'polygon-not-one-outline'
	| 'foreign-draw-without-flush'
	| 'ink-outside-bound';

export interface Diagnostic {
	code: DiagnosticCode;
	message: string;
}

export interface DrawApiOptions {
	backend: DrawBackend;
	/**
	 * R2.1 and R13.2: every check in this file is development-build tooling.
	 * Off, all of them are silent no-ops and nothing is recorded. The build
	 * flag wires this later; it defaults on so a test that forgets to set it
	 * still gets the checks.
	 */
	development?: boolean;
	/**
	 * Turns a recorded diagnostic into a throw. Off by default because a throw
	 * inside the tree walk abandons the frame with its stacks half-unwound,
	 * which turns a report about one bad call into a blank screen. A test, and
	 * the gallery, want the opposite and say so here.
	 */
	strict?: boolean;
	onDiagnostic?: (diagnostic: Diagnostic) => void;
}

export interface BeginFrameOptions {
	/** Logical viewport in logical pixels (R7.1). */
	viewport: { width: number; height: number };
	/**
	 * `dpr * uiScale` (R7.2). R4.2a's cull bounds need it for R5.7's
	 * one-device-pixel inflation. Defaults to 1 until chapter 7's mount context
	 * supplies the real value.
	 */
	ratio?: number;
}

/**
 * R2.14's refusal, exported so a test asserts on the code rather than on prose.
 *
 * R2.14's actual requirement is not "return numbers", it is that measurement
 * "MUST use the same iteration as `drawText` so measured and rendered extents
 * agree" (R6.8). The only thing that can honour that is whatever owns the glyph
 * walk and the atlas metrics, which is a backend (the WebGL2 one, through its
 * `TextMetricsService`). So `measureText` is delegated to
 * `DrawBackend.measureText`, and throws when a backend does not implement it
 * rather than substituting an estimate.
 *
 * A stub would not stay local. R13.25's `text-overflow` rule compares a
 * measured extent against a box, and a fabricated width would either invent
 * violations or suppress real ones under a gate R13.29 checks as
 * `count === 0`.
 */
export const TEXT_MEASUREMENT_UNAVAILABLE =
	'measureText: this backend supplies no metrics. R2.14 requires measurement to share drawText\'s glyph iteration (R6.8), and a backend that lays no text out has nothing honest to return.';

/** Screen-space slack for float error in the ink audit, far below a pixel. */
const INK_AUDIT_EPSILON = 1e-3;

interface CaptureRequest {
	id?: string;
	blend?: BlendMode;
	group: DrawGroupRole;
	/**
	 * Conservative local-space ink extent for R4.2a, or null for a primitive
	 * whose extent cannot be derived (text, when the backend offers no
	 * `textInk`).
	 */
	ink: Rect | null;
	/** Device pixels the drawn ink may reach past `ink` after the transform; 1 unless said. */
	inkOutset?: number;
}

export class DrawApi {
	private readonly backend: DrawBackend;
	private readonly development: boolean;
	private readonly strict: boolean;
	private readonly onDiagnostic?: (diagnostic: Diagnostic) => void;

	private readonly counters = new DrawCounters();
	private readonly recordedDiagnostics: Diagnostic[] = [];
	private readonly partition = new LayerPartition<DrawCommand>();

	/** R2.4 to R2.7's stacks, pooled so a push allocates nothing once warm (DDB-215). */
	private readonly transforms = new TransformStack();
	private readonly clips = new ClipStack();
	private readonly opacities = new NumberStack({ root: 1 });
	private readonly layerStack = new ValueStack<LayerName>({ root: ROOT_LAYER });
	/** The screen rect a clip push computes, reused; the clip stack copies it. */
	private readonly clipScratch: ClipRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

	private frameOpen = false;
	private frameIndex = 0;
	private domain = 0;
	private sequence = 0;
	private domainFirstSequence = 0;
	private viewportWidth = 0;
	private viewportHeight = 0;
	private ratio = 1;
	private warnedNestedRoundedClip = false;
	private inkBoundLocal: Rect | null = null;
	private readonly inkBoundMatrix: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
	private inkBoundScreen: ClipRect | null = null;
	private warnedInkBound = false;

	constructor({
		backend,
		development = true,
		strict = false,
		onDiagnostic,
	}: DrawApiOptions) {
		this.backend = backend;
		this.development = development;
		this.strict = strict;
		this.onDiagnostic = onDiagnostic;
	}

	// -- inspection ---------------------------------------------------------

	get isFrameOpen(): boolean {
		return this.frameOpen;
	}

	get frame(): number {
		return this.frameIndex;
	}

	/**
	 * The current local-to-screen matrix (R2.4). Live: the next push at this
	 * depth overwrites it, so read it on the spot and copy it to keep it.
	 */
	get transform(): Mat2D {
		return this.transforms.matrix;
	}

	get translateOnly(): boolean {
		return this.transforms.translateOnly;
	}

	/** The current clip, in screen space, in all three of R4.2's states. Live, as `transform` is. */
	get clip(): ClipState {
		return this.clips.state;
	}

	get opacity(): number {
		return this.opacities.value;
	}

	get layer(): LayerName {
		return this.layerStack.value;
	}

	/** The logical viewport of the open frame (R7.1); R4.1's target rect when `none` grows one. */
	get viewport(): { width: number; height: number } {
		return { width: this.viewportWidth, height: this.viewportHeight };
	}

	/** `dpr * uiScale` for the open frame (R7.2). */
	get devicePixelScale(): number {
		return this.ratio;
	}

	/**
	 * R4.2a's `apiDraws + culled` so far this frame: every group asked for,
	 * drawn or dropped. The render walk reads it around a subtree to learn
	 * the subtree's count without allocating a stats snapshot.
	 */
	get groupsRequested(): number {
		return this.counters.requested;
	}

	/** Groups accumulated since the last barrier. */
	get pendingCount(): number {
		return this.partition.size;
	}

	/** Development-build findings for the current frame, cleared at `beginFrame`. */
	get diagnostics(): readonly Diagnostic[] {
		return this.recordedDiagnostics;
	}

	/** R2.19. Current frame while one is open, last frame otherwise. */
	getStats(): DrawStats {
		return this.counters.snapshot(this.backend.textures.stats);
	}

	// -- frame lifecycle (R2.1 to R2.3) -------------------------------------

	beginFrame({ viewport, ratio = 1 }: BeginFrameOptions): void {
		const reopened = this.frameOpen;
		this.frameIndex += 1;
		this.frameOpen = true;
		this.viewportWidth = viewport.width;
		this.viewportHeight = viewport.height;
		this.ratio = ratio;
		this.partition.clear();
		this.domain = 0;
		this.sequence = 0;
		this.domainFirstSequence = 0;
		this.warnedNestedRoundedClip = false;
		this.warnedInkBound = false;
		this.inkBoundLocal = null;
		this.inkBoundScreen = null;
		this.transforms.reset();
		this.clips.reset();
		this.opacities.reset();
		this.layerStack.reset();
		this.counters.reset();
		this.recordedDiagnostics.length = 0;
		if (reopened) {
			// Reported after the reset, not before it, or the reset erases the
			// one diagnostic that says the previous frame was abandoned.
			this.report(
				'frame-already-open',
				'beginFrame called while a frame was open; the previous frame is discarded',
			);
		}
		// R5.32: the metered uploads, before anything this frame can draw.
		this.backend.textures.beginFrame();
		this.backend.beginFrame({
			viewport: { width: this.viewportWidth, height: this.viewportHeight },
			ratio: this.ratio,
			frame: this.frameIndex,
		});
	}

	/** R3.20's barrier, and the only one. Nothing else ends a domain. */
	flush(): void {
		if (!this.ensureFrame('flush')) return;
		this.submitPending('barrier');
	}

	endFrame(): void {
		if (!this.ensureFrame('endFrame')) return;
		this.checkBalanced();
		this.submitPending('endFrame');
		this.frameOpen = false;
		this.backend.endFrame();
		// Textures released during the frame are freed now that every command
		// that could name them has been submitted.
		this.backend.textures.endFrame();
	}

	// -- foreign draws (R2.15, R2.16) ---------------------------------------

	invalidateState(): void {
		this.backend.invalidateState();
	}

	/**
	 * R2.16: a pass that drew outside the batcher folds its GPU work into the
	 * same counters, because a draw-call number that omits the world renderer
	 * is the "3 draw calls for the whole game" failure R13.15 names.
	 *
	 * R2.15's other half is checked here rather than trusted: a foreign pass
	 * that reports with groups still pending drew under draws submitted before
	 * it, which is the ordering failure R3.22 describes.
	 */
	reportForeignDraws(work: GpuWork): void {
		if (!this.ensureFrame('reportForeignDraws')) return;
		if (this.partition.size > 0) {
			this.report(
				'foreign-draw-without-flush',
				`a foreign pass reported ${work.gpuDraws} GPU draws with ${this.partition.size} groups still pending; R2.15 requires flush() first, or the foreign pass paints under draws submitted before it`,
			);
		}
		this.counters.addGpuWork(work);
	}

	// -- transform stack (R2.4) ---------------------------------------------

	pushTransform(matrix: Mat2D): void {
		if (!this.ensureFrame('pushTransform')) return;
		this.transforms.push(matrix);
	}

	/** The common case, and the one R2.4 requires be tracked as translate-only. */
	pushTranslate(dx: number, dy: number): void {
		if (!this.ensureFrame('pushTranslate')) return;
		this.transforms.pushTranslate(dx, dy);
	}

	popTransform(): void {
		if (!this.ensureFrame('popTransform')) return;
		if (!this.transforms.pop()) this.reportEmptyPop('popTransform');
	}

	// -- clip stack (R2.5, R4.2, R4.7) --------------------------------------

	pushClip(rect: Rect): void {
		if (!this.ensureFrame('pushClip')) return;
		this.pushClipInternal(rect, null);
	}

	/**
	 * R4.14's rounded clip. The parameters ride on every draw inside it and a
	 * backend evaluates a second SDF; this layer approximates nothing, so
	 * R4.15's "MUST reject rather than silently approximate" has nothing to
	 * reject. There is no API for a circle or polygon clip, which is what R4.15
	 * is actually about.
	 */
	pushClipRounded(rect: Rect, radius: number): void {
		if (!this.ensureFrame('pushClipRounded')) return;
		this.pushClipInternal(rect, radius);
	}

	/**
	 * R3.8 and R4.8: layer promotion resets the inherited clip to `none` and
	 * changes nothing else. Chapter 2 names no call for it, which is worth
	 * raising against the spec, but the tree walk cannot express promotion
	 * without one and it cannot be folded into `pushLayer` because a direct
	 * caller may raise a layer without promoting a subtree (R2.7).
	 */
	pushClipReset(): void {
		if (!this.ensureFrame('pushClipReset')) return;
		this.counters.countClipPush();
		this.clips.pushNone();
	}

	popClip(): void {
		if (!this.ensureFrame('popClip')) return;
		if (!this.clips.pop()) this.reportEmptyPop('popClip');
	}

	private pushClipInternal(rect: Rect, radius: number | null): void {
		this.counters.countClipPush();
		const translateOnly = this.transforms.translateOnly;

		if (!translateOnly && !isAxisAligned(this.transforms.matrix)) {
			// R4.7: the axis-aligned bounds of the transformed rect is the
			// first of the three permitted responses, and it under-clips, so
			// the warning is required rather than polite. A scale without
			// rotation keeps the rect on the axes, where the bounds are exact
			// and there is nothing to warn about (the scaled combat stage).
			this.report(
				'clip-under-non-translate-transform',
				'pushClip under a rotated or skewed transform; the clip is the axis-aligned bounds of the transformed rect, which under-clips (R4.7)',
			);
		}

		// R7.8a: under a translation the clip goes onto the device grid, so R4.4's
		// hard edge keeps or drops the same pixels as the content under it moves.
		const screen = this.screenBounds(rect);
		if (translateOnly) snapClipRectInto(screen, this.ratio, screen);

		const screenRadius = radius === null || translateOnly ? radius : radius * clipRadiusScale(this.transforms.matrix);
		// A rounded clip inside another nests only where both cut the merged
		// rect; one clear of the other's corners is exact (`keptRoundedClip`).
		const nested = this.clips.push(screen, screenRadius, this.ratio);
		if (nested && !this.warnedNestedRoundedClip) {
			// R4.14: once per frame. The outer rounded clip degrades to its
			// bounding rect, so content can show in its corners.
			this.warnedNestedRoundedClip = true;
			this.report(
				'nested-rounded-clip',
				'a rounded clip was pushed inside another whose corner it reaches; only the innermost radius is carried and the outer contributes its bounding rect (R4.14)',
			);
		}
	}

	/**
	 * `transformedBounds` of `rect` under the current transform, into the
	 * reused scratch rect. The translate-only case, every clip the render walk
	 * pushes, is the same arithmetic in place; a rotated clip is rare and
	 * already reported (R4.7), so it may allocate. A scale without rotation
	 * (the combat stage) is every clip under it, so it is done in place too.
	 */
	private screenBounds(rect: Rect): ClipRect {
		const out = this.clipScratch;
		const matrix = this.transforms.matrix;
		if (this.transforms.translateOnly) {
			out.minX = rect.x + matrix[4];
			out.minY = rect.y + matrix[5];
			out.maxX = rect.x + rect.width + matrix[4];
			out.maxY = rect.y + rect.height + matrix[5];
			return out;
		}
		if (isAxisAligned(matrix)) {
			const x0 = rect.x * matrix[0] + matrix[4];
			const x1 = (rect.x + rect.width) * matrix[0] + matrix[4];
			const y0 = rect.y * matrix[3] + matrix[5];
			const y1 = (rect.y + rect.height) * matrix[3] + matrix[5];
			out.minX = Math.min(x0, x1);
			out.maxX = Math.max(x0, x1);
			out.minY = Math.min(y0, y1);
			out.maxY = Math.max(y0, y1);
			return out;
		}
		const bounds = transformedBounds(matrix, rect);
		out.minX = bounds.minX;
		out.minY = bounds.minY;
		out.maxX = bounds.maxX;
		out.maxY = bounds.maxY;
		return out;
	}

	// -- opacity stack (R2.6) -----------------------------------------------

	pushOpacity(factor: number): void {
		if (!this.ensureFrame('pushOpacity')) return;
		if (factor < 0 || factor > 1 || Number.isNaN(factor)) {
			this.report('opacity-out-of-range', `pushOpacity(${factor}) is outside [0, 1] and is clamped (R3.25)`);
		}
		const clamped = Number.isNaN(factor) ? 1 : Math.min(1, Math.max(0, factor));
		this.opacities.push(this.opacity * clamped);
	}

	popOpacity(): void {
		if (!this.ensureFrame('popOpacity')) return;
		if (!this.opacities.pop()) this.reportEmptyPop('popOpacity');
	}

	// -- layer stack (R2.7, R3.6) -------------------------------------------

	/**
	 * R3.6's monotonicity, enforced here rather than trusted to the caller: the
	 * effective layer is `max(own, parent.effective)`, and a request beneath the
	 * current layer is reported as the authoring error the same rule names.
	 *
	 * R2.7 read alone says "sets", and that reading is departed from
	 * deliberately. R3.6 states the invariant as an outcome ("a subtree never
	 * paints beneath its own ancestor's layer"), 3.12 requires one test to see
	 * both halves at once (the child renders in the parent's layer AND the
	 * error is reported), and the ordinal is stamped here, so this is the only
	 * place the invariant can be guaranteed. Nothing legitimate is blocked:
	 * R2.7's own example of a direct caller, a targeting line pushing
	 * `overlay`, is a raise.
	 */
	pushLayer(name: LayerName): void {
		if (!this.ensureFrame('pushLayer')) return;
		const current = this.layer;
		if (layerOrdinal(name) < layerOrdinal(current)) {
			this.report(
				'layer-lowered',
				`pushLayer('${name}') is beneath the current layer '${current}'; a subtree never paints beneath its own ancestor's layer, so '${current}' is kept (R3.6)`,
			);
			this.layerStack.push(current);
			return;
		}
		this.layerStack.push(name);
	}

	popLayer(): void {
		if (!this.ensureFrame('popLayer')) return;
		if (!this.layerStack.pop()) this.reportEmptyPop('popLayer');
	}

	// -- subtree cull (R4.2a, DDB-184) ---------------------------------------

	/**
	 * Counts as culled the groups of a subtree the caller skipped whole
	 * because its conservative ink missed the clip, so that `apiDraws +
	 * culled` still counts every group the frame asked for (R4.2a). The
	 * render walk passes the count from the subtree's last walk.
	 */
	cullGroups(groups: number): void {
		if (!this.ensureFrame('cullGroups')) return;
		this.counters.countCulled(groups);
	}

	/** Whether `setInkBound` does anything: development builds only, so a production walk never builds the rect. */
	get auditsInk(): boolean {
		return this.development;
	}

	/**
	 * The local rect, under the current transform, that the caller promises
	 * its next draws stay inside; null withdraws the promise. The render walk
	 * sets a component's `cullInk` around its `render`, since a subtree skip
	 * trusts exactly that promise. In a development build a group whose cull
	 * ink leaves the rect is reported once a frame as `ink-outside-bound`.
	 * Checked only where the cull computes ink anyway, under a rect clip,
	 * which is also the only place a skip can happen. A no-op otherwise.
	 */
	setInkBound(local: Rect | null): void {
		if (!this.development) return;
		this.inkBoundLocal = local;
		// Copied, since the live matrix is overwritten by the next push at its
		// depth, which an over-popping `render` would reach unreported.
		const matrix = this.transforms.matrix;
		const bound = this.inkBoundMatrix;
		for (let index = 0; index < 6; index++) bound[index] = matrix[index];
		this.inkBoundScreen = null;
	}

	// -- draw calls (R2.8 to R2.13) -----------------------------------------

	drawRect(options: DrawRectOptions): void {
		if (!this.ensureFrame('drawRect')) return;
		const radius = copyRadii(options.radius);

		if (options.shadow) {
			// R3.16: the shadow group is emitted immediately before its owner,
			// in the same layer, so a stable partition keeps them adjacent.
			const state = this.capture({
				id: options.id,
				blend: options.blend,
				group: 'shadow',
				ink: shadowInk(options.rect, options.shadow),
			});
			if (state) {
				this.emit({
					...state,
					kind: 'shadow',
					rect: copyRect(options.rect),
					radius,
					shadow: copyShadow(options.shadow),
				});
			}
		}

		const state = this.capture({
			id: options.id,
			blend: options.blend,
			group: 'primary',
			ink: rectInk(options.rect, options.border),
		});
		if (!state) return;
		this.emit({
			...state,
			kind: 'rect',
			rect: copyRect(options.rect),
			fill: options.fill ? copyColor(options.fill) : null,
			radius,
			border: copyBorder(options.border),
			gradient: copyGradient(options.gradient),
		});
	}

	drawCircle(options: DrawCircleOptions): void {
		if (!this.ensureFrame('drawCircle')) return;
		const state = this.capture({
			id: options.id,
			blend: options.blend,
			group: 'primary',
			ink: circleInk(options.center, options.radius, options.border),
		});
		if (!state) return;
		this.emit({
			...state,
			kind: 'circle',
			center: copyVec2(options.center),
			radius: options.radius,
			fill: options.fill ? copyColor(options.fill) : null,
			border: copyBorder(options.border),
		});
	}

	drawLine(options: DrawLineOptions): void {
		if (!this.ensureFrame('drawLine')) return;
		const state = this.capture({
			id: options.id,
			blend: options.blend,
			group: 'primary',
			ink: lineInk(options.from, options.to, options.width),
		});
		if (!state) return;
		this.emit({
			...state,
			kind: 'line',
			from: copyVec2(options.from),
			to: copyVec2(options.to),
			color: copyColor(options.color),
			width: options.width,
			cap: options.cap ?? 'butt',
		});
	}

	/**
	 * R2.10's convenience over capsule segments. It produces ONE group, not one
	 * per segment: R2.8 says a draw call produces one draw group, and counting
	 * a segment each would inflate `apiDraws` against R13.12's definition.
	 */
	drawPolyline(options: DrawPolylineOptions): void {
		if (!this.ensureFrame('drawPolyline')) return;
		const state = this.capture({
			id: options.id,
			blend: options.blend,
			group: 'primary',
			ink: pointsInk(options.points, options.width),
		});
		if (!state) return;
		this.emit({
			...state,
			kind: 'polyline',
			points: options.points.map(copyVec2),
			color: copyColor(options.color),
			width: options.width,
			closed: options.closed ?? false,
			cap: options.cap ?? 'butt',
		});
	}

	/**
	 * R2.11. Today's `Renderer.drawTriangle` has no counterpart in chapter 2
	 * and gets none: a triangle is three points and no indices, so under the
	 * delete-legacy convention it is absorbed here rather than kept as a second
	 * spelling of the same thing.
	 */
	drawPolygon(options: DrawPolygonOptions): void {
		if (!this.ensureFrame('drawPolygon')) return;
		const state = this.capture({
			id: options.id,
			blend: options.blend,
			group: 'primary',
			ink: pointsInk(options.points, 0),
			// R5.17's feather miter reaches past the points at a sharp vertex.
			inkOutset: FEATHER_MITER_LIMIT,
		});
		if (!state) return;
		if (options.indices && !isSingleOutline(options.points, options.indices)) {
			this.report(
				'polygon-not-one-outline',
				`drawPolygon: ${options.points.length} points are not one simple outline covered once by their `
					+ 'indices, so the polygon is drawn without its anti-aliasing feather (R5.17)',
			);
		}
		this.emit({
			...state,
			kind: 'polygon',
			points: options.points.map(copyVec2),
			indices: options.indices ? [...options.indices] : null,
			fill: options.fill ? copyColor(options.fill) : null,
			colors: options.colors ? options.colors.map(copyColor) : null,
		});
	}

	drawImage(options: DrawImageOptions): void {
		if (!this.ensureFrame('drawImage')) return;
		if (!this.backend.textures.isLive(options.texture)) {
			// A released handle names nothing, and a later texture may reuse
			// nothing of it; drawing it would be drawing garbage (R5.30).
			this.report('texture-not-live', `drawImage with texture ${options.texture.id}, which was released`);
			return;
		}
		const state = this.capture({
			id: options.id,
			blend: options.blend,
			group: 'primary',
			ink: copyRect(options.rect),
		});
		if (!state) return;
		this.emit({
			...state,
			kind: 'image',
			rect: copyRect(options.rect),
			// The handle is an identity minted by the backend, not caller-owned
			// geometry, and a backend compares handles by reference.
			texture: options.texture,
			sourceRect: options.sourceRect ? copyRect(options.sourceRect) : null,
			sourceSpace: options.sourceSpace ?? 'pixels',
			tint: options.tint ? copyColor(options.tint) : null,
			slice: copySlice(options.slice),
		});
	}

	/**
	 * R2.13. Glyph layout is chapter 6's and the backend's; a command carries
	 * the run and its parameters, and it goes through exactly the same capture
	 * as a rectangle, so text is in the same batch as shapes and there is no
	 * text batch to open (R2.2).
	 *
	 * `overflow: 'clip'` with a box clips the run to the box through the clip
	 * stack (R6.14), for this draw only.
	 */
	drawText(options: DrawTextOptions): void {
		if (!this.ensureFrame('drawText')) return;

		if (this.development && !this.backend.fontAtlasNames.includes(options.font)) {
			// R2.18: an error in a development build, not a silent no-op. The
			// run is still emitted, because dropping it would be the silent
			// no-op the rule forbids.
			this.report(
				'text-before-atlas',
				`drawText with font '${options.font}' before its atlas is loaded (R2.18); loaded atlases: [${this.backend.fontAtlasNames.join(', ')}]`,
			);
		}

		const box = options.overflow === 'clip' ? options.box : undefined;
		if (box) this.clips.push(this.screenBounds(box), null, this.ratio);
		this.emitText(options);
		if (box) this.clips.pop();
	}

	private emitText(options: DrawTextOptions): void {
		const ink = this.textInk(options);

		if (options.shadow) {
			// R3.17: the shadow run immediately precedes the main run.
			const offset = options.shadow.offset ?? { x: 0, y: 0 };
			const blur = options.shadow.blur ?? 0;
			const state = this.capture({
				id: options.id,
				blend: options.blend,
				group: 'shadow',
				ink: ink
					? {
							x: ink.x + offset.x - blur,
							y: ink.y + offset.y - blur,
							width: ink.width + blur * 2,
							height: ink.height + blur * 2,
						}
					: null,
			});
			if (state) {
				this.emit(buildText(state, options, options.shadow.color, offset, blur));
			}
		}

		const state = this.capture({ id: options.id, blend: options.blend, group: 'primary', ink });
		if (!state) return;
		this.emit(buildText(state, options, options.color, { x: 0, y: 0 }, 0));
	}

	/**
	 * R4.2a's per-run extent, when the backend can take it. Glyph quads go
	 * through the whole transform, so the transformed bounds of the local
	 * extent contain what a rotated or scaled run draws too.
	 */
	private textInk(options: DrawTextOptions): Rect | null {
		if (!this.backend.textInk) return null;
		if (this.clip.kind !== 'rect') return null;
		return this.backend.textInk(options);
	}

	/**
	 * Whether `measureText` can answer for `font`: the backend lays text out
	 * and has that role's atlas. A component that sizes itself from its text
	 * asks this first and stays unmeasured when the answer is no (the null and
	 * recording backends), rather than guessing a width.
	 */
	canMeasureText(font: string): boolean {
		return this.backend.measureText !== undefined && this.backend.fontAtlasNames.includes(font);
	}

	/** Whether `measureTextInk` can answer: the backend offers `textInk`. */
	get canMeasureTextInk(): boolean {
		return this.backend.textInk !== undefined;
	}

	/**
	 * The local extent `drawText(options)` would cover, the same rect R4.2a
	 * culls the run by, whatever the clip. Null when the run draws nothing or
	 * the backend cannot say (`canMeasureTextInk`).
	 */
	measureTextInk(options: DrawTextOptions): Rect | null {
		return this.backend.textInk?.(options) ?? null;
	}

	/**
	 * Called when a screen or scene has just mounted: the next frame builds
	 * all the small text it draws rather than spreading it over frames under
	 * the backend's budget (R6.4a, `DrawBackend.prewarmText`).
	 */
	prewarmText(): void {
		this.backend.prewarmText?.();
	}

	/** R2.14, delegated to the backend that owns the glyph walk. See `TEXT_MEASUREMENT_UNAVAILABLE`. */
	measureText(options: MeasureTextOptions): TextMetrics {
		if (!this.backend.measureText) {
			throw new Error(`${TEXT_MEASUREMENT_UNAVAILABLE} Backend: '${this.backend.name}'.`);
		}
		return this.backend.measureText(options);
	}

	// -- resources (R2.17, R2.18, R5.30) ------------------------------------

	/**
	 * A texture with one reference, owned by the caller. With a source it is
	 * queued and uploaded under the per-frame budget (R5.32) unless it asks to
	 * be immediate; until then `isTextureResident` is false and the caller
	 * draws its placeholder.
	 */
	createTexture(options: TextureOptions): TextureHandle {
		if (this.frameOpen) {
			// R2.17: uploads happen outside the frame or at beginFrame, never
			// inside a flush.
			this.report(
				'texture-upload-in-frame',
				'createTexture inside a frame; uploads happen outside it or at beginFrame (R2.17)',
			);
		}
		return this.backend.textures.create(options);
	}

	/** A second holder of the same texture. Each `retainTexture` is paired with a `destroyTexture`. */
	retainTexture(handle: TextureHandle): TextureHandle {
		return this.backend.textures.retain(handle);
	}

	/** Drops the caller's reference; the texture is freed with the last one (R5.30). */
	destroyTexture(handle: TextureHandle): void {
		this.backend.textures.release(handle);
	}

	isTextureResident(handle: TextureHandle): boolean {
		return this.backend.textures.isResident(handle);
	}

	loadFontAtlas(options: FontAtlasOptions): FontAtlasHandle {
		return this.backend.loadFontAtlas(options);
	}

	// -- internals ----------------------------------------------------------

	/**
	 * The one place ambient state becomes draw data, and the one place a draw is
	 * dropped. Returns null when the draw produced no group, having already
	 * counted why:
	 *
	 * - R4.2's `empty` clip. While the state is empty the batcher MUST drop on
	 *   the CPU and MUST NOT collapse to `none`.
	 * - R4.2a's bounds test: the transformed ink extent does not intersect the
	 *   clip rect. Skipped under `none`, whose rect is R4.1's all-covering one,
	 *   and for text whose extent the backend cannot give (`textInk`).
	 */
	private capture({ id, blend, group, ink, inkOutset = 1 }: CaptureRequest): ResolvedState | null {
		const clip = this.clips.captured();
		if (!clip) {
			this.counters.countCulled();
			return null;
		}

		if (ink && clip.kind === 'rect') {
			const bounds = screenInk(ink, this.transforms.matrix, this.ratio, inkOutset);
			if (this.inkBoundLocal) this.auditInk(id, bounds);
			if (!intersects(bounds, clipRectOf(clip))) {
				this.counters.countCulled();
				return null;
			}
		}

		const layer = this.layer;
		this.counters.countApiDraw(layer);
		return {
			id: id ?? null,
			sequence: this.sequence++,
			layer,
			layerOrdinal: layerOrdinal(layer),
			transform: this.transforms.captured(),
			translateOnly: this.transforms.translateOnly,
			clip,
			opacity: this.opacity,
			blend: blend ?? 'over',
			group,
		};
	}

	private auditInk(id: string | undefined, bounds: ClipRect): void {
		const local = this.inkBoundLocal;
		if (!local || this.warnedInkBound) return;
		let bound = this.inkBoundScreen;
		if (!bound) {
			const devicePixel = this.ratio > 0 ? 1 / this.ratio : 1;
			bound = inflate(transformedBounds(this.inkBoundMatrix, local), devicePixel * SUBTREE_INK_OUTSET);
			this.inkBoundScreen = bound;
		}
		if (bounds.minX >= bound.minX - INK_AUDIT_EPSILON && bounds.minY >= bound.minY - INK_AUDIT_EPSILON
			&& bounds.maxX <= bound.maxX + INK_AUDIT_EPSILON && bounds.maxY <= bound.maxY + INK_AUDIT_EPSILON) {
			return;
		}
		this.warnedInkBound = true;
		const format = (rect: ClipRect): string => `[${rect.minX.toFixed(1)}, ${rect.minY.toFixed(1)}, ${rect.maxX.toFixed(1)}, ${rect.maxY.toFixed(1)}]`;
		this.report(
			'ink-outside-bound',
			`${id ?? 'a group'} draws at ${format(bounds)}, outside its component's cull ink ${format(bound)}; a subtree skip (R4.2a) would drop it while visible. Grow the component's inkExtent or cullInk.`,
		);
	}

	private emit(command: DrawCommand): void {
		this.partition.push(command.layer, command);
	}

	/**
	 * An empty domain submits nothing and counts no flush: a barrier separating
	 * nothing from nothing changed no order and moved no bytes, and a flush
	 * count that disagrees with `gpuDraws` is the kind of number R13.5 exists to
	 * prevent. The domain index still advances so domains number the same way
	 * whether or not content landed in them.
	 */
	private submitPending(reason: FlushReason): void {
		const first = this.domainFirstSequence;
		this.domainFirstSequence = this.sequence;
		const domain = this.domain;
		this.domain += 1;

		const commands = this.partition.drain();
		if (commands.length === 0) return;

		// R13.13's `reorderedGroups`, measured rather than assumed: a group
		// whose submission index within this domain differs from the position
		// the partition emitted it at.
		let reordered = 0;
		for (let position = 0; position < commands.length; position++) {
			if (commands[position].sequence - first !== position) reordered += 1;
		}
		this.counters.countReordered(reordered);

		this.counters.countFlush(reason);
		const batch: DrawBatch = { domain, reason, commands };
		const work = this.backend.submit(batch);
		if (work) this.counters.addGpuWork(work);
	}

	private reportEmptyPop(call: string): void {
		this.report('pop-empty-stack', `${call} with nothing pushed`);
	}

	private checkBalanced(): void {
		const unbalanced: string[] = [];
		if (this.transforms.pushed > 0) unbalanced.push(`transform x${this.transforms.pushed}`);
		if (this.clips.pushed > 0) unbalanced.push(`clip x${this.clips.pushed}`);
		if (this.opacities.pushed > 0) unbalanced.push(`opacity x${this.opacities.pushed}`);
		if (this.layerStack.pushed > 0) unbalanced.push(`layer x${this.layerStack.pushed}`);
		if (unbalanced.length > 0) {
			this.report('unbalanced-stack', `endFrame with unpopped state: ${unbalanced.join(', ')}`);
		}
	}

	private ensureFrame(call: string): boolean {
		if (this.frameOpen) return true;
		this.report('call-outside-frame', `${call} outside beginFrame/endFrame`);
		return false;
	}

	/**
	 * R2.1's one policy, applied to every entry point in this file: in a
	 * development build the finding is recorded and handed to `onDiagnostic`,
	 * and throws only when the caller asked for `strict`; in a production build
	 * nothing happens and the call is a no-op.
	 */
	private report(code: DiagnosticCode, message: string): void {
		if (!this.development) return;
		const diagnostic: Diagnostic = { code, message };
		this.recordedDiagnostics.push(diagnostic);
		if (this.onDiagnostic) this.onDiagnostic(diagnostic);
		if (this.strict) throw new Error(`${code}: ${message}`);
	}
}

function copyRadii(radius: CornerRadii | undefined): CornerRadii | null {
	if (radius === undefined) return null;
	return typeof radius === 'number' ? radius : [radius[0], radius[1], radius[2], radius[3]];
}

function copyBorder(border: Border | undefined): Border | null {
	if (!border) return null;
	// R5.7: `inside` is the default because nearly every component in this
	// codebase overrides worldsim's `center` to it.
	return { color: copyColor(border.color), width: border.width, position: border.position ?? 'inside' };
}

function copyGradient(gradient: CornerColors | undefined): CornerColors | null {
	if (!gradient) return null;
	return [
		copyColor(gradient[0]),
		copyColor(gradient[1]),
		copyColor(gradient[2]),
		copyColor(gradient[3]),
	];
}

function copyShadow(shadow: BoxShadow): Required<Omit<BoxShadow, 'color'>> & { color: RGBA } {
	return {
		color: copyColor(shadow.color),
		blur: shadow.blur ?? 0,
		spread: shadow.spread ?? 0,
		offset: shadow.offset ? copyVec2(shadow.offset) : { x: 0, y: 0 },
	};
}

function copySlice(slice: NineSlice | undefined): NineSlice | null {
	if (!slice) return null;
	return { top: slice.top, right: slice.right, bottom: slice.bottom, left: slice.left };
}

function buildText(
	state: ResolvedState,
	options: DrawTextOptions,
	color: RGBA,
	offset: Vec2,
	blur: number,
): DrawCommand {
	const position = options.position
		? { x: options.position.x + offset.x, y: options.position.y + offset.y }
		: null;
	const box = options.box
		? {
				x: options.box.x + offset.x,
				y: options.box.y + offset.y,
				width: options.box.width,
				height: options.box.height,
			}
		: null;
	return {
		...state,
		kind: 'text',
		text: options.text,
		position,
		box,
		font: options.font,
		size: options.size,
		color: copyColor(color),
		align: options.align ?? 'left',
		verticalAlign: options.verticalAlign ?? (options.box ? 'top' : 'baseline'),
		letterSpacing: options.letterSpacing ?? 0,
		textTransform: options.textTransform ?? 'none',
		maxWidth: options.maxWidth ?? null,
		wrap: options.wrap ?? 'none',
		overflow: options.overflow ?? 'visible',
		decoration: options.decoration ?? 'none',
		lineHeight: options.lineHeight ?? null,
		blur,
	};
}
