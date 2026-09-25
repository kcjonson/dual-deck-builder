import {
	DrawBackend,
	DrawBatch,
	FontAtlasOptions,
	TextureOptions,
} from './DrawBackend';
import {
	circleInk,
	lineInk,
	pointsInk,
	rectInk,
	screenInk,
	shadowInk,
} from './bounds';
import {
	CLIP_NONE,
	ClipState,
	clipRectOf,
	hasRoundedClip,
	intersectClip,
	resolveClip,
} from './clip';
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
	IDENTITY,
	Mat2D,
	RGBA,
	Rect,
	Vec2,
	concat,
	copyColor,
	copyRect,
	copyVec2,
	intersects,
	isTranslateOnly,
	transformedBounds,
	translation,
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
 * than for whichever one implemented a sort. The batcher proper is still a
 * later PR: nothing here merges geometry, drops a group as occluded, splits a
 * GPU submission, or looks at a texture.
 *
 * WHAT IT COSTS. One object per draw group per frame, plus the copies. The
 * heaviest screen in this game submits 96 draws at a p99 of 1.02 ms against a
 * 16.67 ms budget, and these are short-lived, same-shaped, young-generation
 * objects, which is the pattern a generational collector handles best. A free
 * list behind this same interface is the escape hatch if a stress scene ever
 * proves otherwise, and it should not be taken pre-emptively: pooling is
 * exactly what would destroy the inert, outlives-the-call property the
 * recording backend and the partition depend on.
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
	| 'foreign-draw-without-flush';

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
	/**
	 * TEMPORARY, and the only concession this file makes to the legacy backend.
	 * Deleted by the ordering re-baseline PR; see
	 * docs/AI_TECHNICAL_DECISIONS/legacy-gl-backend.md.
	 *
	 * R2.2: "there are no modes to enter (no separate text batch to begin and
	 * end). The sibling TypeScript engine had a text batch that opened in the
	 * frame loop and flushed on scissor changes, which reordered text above
	 * every shape drawn in the same clip scope." That engine is this one, and
	 * the 26 committed screenshot goldens are pictures of exactly that bug.
	 *
	 * `TextRenderer` reproduces the reordering by itself, because
	 * `LegacyGLBackend` keeps it and flushes it once per batch. What no backend
	 * can reproduce is the BOUND: a backend never sees a push or a pop (see
	 * `DrawBackend`), so it cannot know where a clip scope started. This flag
	 * supplies that half by ending a domain at every clip push and pop, which is
	 * where `Renderer.enableScissor` and `disableScissor` flushed.
	 *
	 * Measured, not assumed: with the flag off, the three chromium goldens whose
	 * screens clip (developerScreen, cardShowcaseScreen, combatScreen) fail,
	 * because text submitted before a clip survives to the end of the frame and
	 * paints over content drawn inside it. The other eighteen have no clip and
	 * are unaffected.
	 *
	 * It is a deliberate violation of R3.20 ("Nothing else flushes: not a
	 * texture change, not a clip change"), which is why it is off by default and
	 * set in exactly one place, `createLegacyDrawApi`.
	 */
	legacyTextOrder?: boolean;
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
 * walk and the atlas metrics, which is a backend, and chapter 6's text layout
 * is phase 2. So `measureText` is declared with its real signature, delegated
 * to `DrawBackend.measureText`, and throws when no backend implements it.
 *
 * A stub would not stay local. R13.25's `text-overflow` rule compares a
 * measured extent against a box, and `layoutLint.ts` already carries a live
 * `unmeasured-text` bucket holding exactly the nodes whose measurement does not
 * exist yet. A fabricated width would move those nodes out of that bucket early
 * and either invent violations or suppress real ones under a gate R13.29 checks
 * as `count === 0`. That is phase 0's "Verts: 5327.999999999999" one layer up.
 */
export const TEXT_MEASUREMENT_UNAVAILABLE =
	'measureText: no backend supplied metrics. R2.14 requires measurement to share drawText\'s glyph iteration (R6.8), and chapter 6 text layout is phase 2, so there is nothing to return.';

interface TransformEntry {
	readonly matrix: Mat2D;
	readonly translateOnly: boolean;
}

const ROOT_TRANSFORM: TransformEntry = { matrix: IDENTITY, translateOnly: true };

interface CaptureRequest {
	id?: string;
	blend?: BlendMode;
	group: DrawGroupRole;
	/**
	 * Conservative screen-space ink extent for R4.2a, or null for a primitive
	 * whose extent this phase cannot derive (text, until R6.8's iteration).
	 */
	ink: Rect | null;
}

export class DrawApi {
	private readonly backend: DrawBackend;
	private readonly development: boolean;
	private readonly strict: boolean;
	private readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
	/** TEMPORARY. See `DrawApiOptions.legacyTextOrder`. */
	private readonly legacyTextOrder: boolean;

	private readonly counters = new DrawCounters();
	private readonly recordedDiagnostics: Diagnostic[] = [];
	private readonly partition = new LayerPartition<DrawCommand>();

	private transforms: TransformEntry[] = [ROOT_TRANSFORM];
	private clips: ClipState[] = [CLIP_NONE];
	private opacities: number[] = [1];
	private layerStack: LayerName[] = [ROOT_LAYER];

	private frameOpen = false;
	private frameIndex = 0;
	private domain = 0;
	private sequence = 0;
	private domainFirstSequence = 0;
	private viewportWidth = 0;
	private viewportHeight = 0;
	private ratio = 1;
	private warnedNestedRoundedClip = false;

	constructor({
		backend,
		development = true,
		strict = false,
		onDiagnostic,
		legacyTextOrder = false,
	}: DrawApiOptions) {
		this.backend = backend;
		this.development = development;
		this.strict = strict;
		this.onDiagnostic = onDiagnostic;
		this.legacyTextOrder = legacyTextOrder;
	}

	// -- inspection ---------------------------------------------------------

	get isFrameOpen(): boolean {
		return this.frameOpen;
	}

	get frame(): number {
		return this.frameIndex;
	}

	/** The current local-to-screen matrix (R2.4). */
	get transform(): Mat2D {
		return this.transforms[this.transforms.length - 1].matrix;
	}

	get translateOnly(): boolean {
		return this.transforms[this.transforms.length - 1].translateOnly;
	}

	/** The current clip, in screen space, in all three of R4.2's states. */
	get clip(): ClipState {
		return this.clips[this.clips.length - 1];
	}

	get opacity(): number {
		return this.opacities[this.opacities.length - 1];
	}

	get layer(): LayerName {
		return this.layerStack[this.layerStack.length - 1];
	}

	/** The logical viewport of the open frame (R7.1); R4.1's target rect when `none` grows one. */
	get viewport(): { width: number; height: number } {
		return { width: this.viewportWidth, height: this.viewportHeight };
	}

	/** `dpr * uiScale` for the open frame (R7.2). */
	get devicePixelScale(): number {
		return this.ratio;
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
		return this.counters.snapshot();
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
		this.transforms = [ROOT_TRANSFORM];
		this.clips = [CLIP_NONE];
		this.opacities = [1];
		this.layerStack = [ROOT_LAYER];
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
		this.pushMatrix(concat(this.transform, matrix));
	}

	/** The common case, and the one R2.4 requires be tracked as translate-only. */
	pushTranslate(dx: number, dy: number): void {
		if (!this.ensureFrame('pushTranslate')) return;
		this.pushMatrix(concat(this.transform, translation(dx, dy)));
	}

	popTransform(): void {
		if (!this.ensureFrame('popTransform')) return;
		this.popStack(this.transforms, 'popTransform');
	}

	private pushMatrix(matrix: Mat2D): void {
		// R2.4's flag is decided once, here, from the concatenated result, so a
		// draw never re-tests it and a scale under its own inverse gets the
		// cheap snapping path back instead of staying false for the scope.
		this.transforms.push({ matrix, translateOnly: isTranslateOnly(matrix) });
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
		this.legacyTextOrderBarrier();
		this.counters.countClipPush();
		this.clips.push(CLIP_NONE);
	}

	popClip(): void {
		if (!this.ensureFrame('popClip')) return;
		this.legacyTextOrderBarrier();
		this.popStack(this.clips, 'popClip');
	}

	/**
	 * TEMPORARY. See `DrawApiOptions.legacyTextOrder`.
	 *
	 * Before the stack mutates, not after, because `Renderer.enableScissor`
	 * flushed the pending text and only then called `gl.scissor`: the outgoing
	 * scope's text painted under the outgoing scope's scissor box.
	 */
	private legacyTextOrderBarrier(): void {
		if (this.legacyTextOrder) this.submitPending('barrier');
	}

	private pushClipInternal(rect: Rect, radius: number | null): void {
		this.legacyTextOrderBarrier();
		this.counters.countClipPush();
		const current = this.transforms[this.transforms.length - 1];

		if (!current.translateOnly) {
			// R4.7: the axis-aligned bounds of the transformed rect is the
			// first of the three permitted responses, and it under-clips, so
			// the warning is required rather than polite.
			this.report(
				'clip-under-non-translate-transform',
				'pushClip under a rotated or non-uniformly scaled transform; the clip is the axis-aligned bounds of the transformed rect, which under-clips (R4.7)',
			);
		}

		const screen = transformedBounds(current.matrix, rect);
		const rounded = radius === null ? null : { rect: screen, radius };

		if (rounded && hasRoundedClip(this.clip) && !this.warnedNestedRoundedClip) {
			// R4.14: once per frame. The outer rounded clip degrades to its
			// bounding rect, so content can show in its corners.
			this.warnedNestedRoundedClip = true;
			this.report(
				'nested-rounded-clip',
				'a rounded clip was pushed inside another; only the innermost radius is carried and the outer contributes its bounding rect (R4.14)',
			);
		}

		this.clips.push(intersectClip(this.clip, screen, rounded));
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
		this.popStack(this.opacities, 'popOpacity');
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
		this.popStack(this.layerStack, 'popLayer');
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
		});
		if (!state) return;
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
	 * R2.13. Glyph layout is chapter 6 and phase 2; a command carries the run
	 * and its parameters, and it goes through exactly the same capture as a
	 * rectangle, so text is in the same batch as shapes and there is no text
	 * batch to open (R2.2).
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

		if (options.shadow) {
			// R3.17: the shadow run immediately precedes the main run.
			const state = this.capture({
				id: options.id,
				blend: options.blend,
				group: 'shadow',
				ink: null,
			});
			if (state) {
				const offset = options.shadow.offset ?? { x: 0, y: 0 };
				this.emit(
					buildText(state, options, options.shadow.color, offset, options.shadow.blur ?? 0),
				);
			}
		}

		const state = this.capture({ id: options.id, blend: options.blend, group: 'primary', ink: null });
		if (!state) return;
		this.emit(buildText(state, options, options.color, { x: 0, y: 0 }, 0));
	}

	/** R2.14, delegated and refused. See `TEXT_MEASUREMENT_UNAVAILABLE`. */
	measureText(options: MeasureTextOptions): TextMetrics {
		if (!this.backend.measureText) {
			throw new Error(`${TEXT_MEASUREMENT_UNAVAILABLE} Backend: '${this.backend.name}'.`);
		}
		return this.backend.measureText(options);
	}

	// -- resources (R2.17, R2.18) -------------------------------------------

	createTexture(options: TextureOptions): TextureHandle {
		if (this.frameOpen) {
			// R2.17: uploads happen outside the frame or at beginFrame, never
			// inside a flush.
			this.report(
				'texture-upload-in-frame',
				'createTexture inside a frame; uploads happen outside it or at beginFrame (R2.17)',
			);
		}
		return this.backend.createTexture(options);
	}

	destroyTexture(handle: TextureHandle): void {
		this.backend.destroyTexture(handle);
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
	 *   and skipped for text, whose extent needs R6.8's glyph iteration.
	 */
	private capture({ id, blend, group, ink }: CaptureRequest): ResolvedState | null {
		const clip = resolveClip(this.clip);
		if (!clip) {
			this.counters.countCulled();
			return null;
		}

		const transform = this.transforms[this.transforms.length - 1];

		if (ink && clip.kind === 'rect') {
			const bounds = screenInk(ink, transform.matrix, this.ratio);
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
			transform: transform.matrix,
			translateOnly: transform.translateOnly,
			clip,
			opacity: this.opacity,
			blend: blend ?? 'over',
			group,
		};
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

	private popStack(stack: unknown[], call: string): void {
		if (stack.length <= 1) {
			this.report('pop-empty-stack', `${call} with nothing pushed`);
			return;
		}
		stack.pop();
	}

	private checkBalanced(): void {
		const unbalanced: string[] = [];
		if (this.transforms.length > 1) unbalanced.push(`transform x${this.transforms.length - 1}`);
		if (this.clips.length > 1) unbalanced.push(`clip x${this.clips.length - 1}`);
		if (this.opacities.length > 1) unbalanced.push(`opacity x${this.opacities.length - 1}`);
		if (this.layerStack.length > 1) unbalanced.push(`layer x${this.layerStack.length - 1}`);
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
		verticalAlign: options.verticalAlign ?? 'top',
		letterSpacing: options.letterSpacing ?? 0,
		textTransform: options.textTransform ?? 'none',
		maxWidth: options.maxWidth ?? null,
		wrap: options.wrap ?? 'none',
		overflow: options.overflow ?? 'visible',
		blur,
	};
}
