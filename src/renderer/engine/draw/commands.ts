import { ResolvedClip } from './clip';
import { Mat2D, RGBA, Rect, Vec2 } from './geometry';
import { LayerName } from './layers';

/**
 * The draw-call options of R2.8 to R2.13, and the command objects they produce.
 *
 * This is the seam. A `DrawCommand` is inert plain data with every piece of
 * ambient state already resolved onto it: the concatenated transform, the
 * screen-space clip, the multiplied opacity, and the layer key (R2.4 to R2.7,
 * "captured into each draw at submission time (nothing is GPU state)"). Nothing
 * downstream may consult a stack, because by the time a backend sees a command
 * the stacks have moved on and the partition of R3.10 has moved the command
 * away from the call that produced it, so any state a command did not capture
 * is state it has lost.
 *
 * Payload geometry is in *local* space beside the resolved matrix, not
 * pre-transformed vertices. R2.4 permits both: the vertex-quad path transforms
 * on the CPU at submission, the instanced path carries translation and scale
 * per instance. Baking vertices here would pick one of those two backends, and
 * R5.5's SDF is evaluated in the rect-local frame that baking would destroy.
 *
 * Every command is JSON-serialisable and every value on one is copied out of
 * the caller's memory at submission, so nothing aliases a rect or a colour
 * array a component reuses next frame. That is what makes the recording backend
 * a `push` and the future sort a pure function over an array.
 *
 * Three departures from R2.8 and R2.13's literal field lists, each named here
 * because a reviewer will otherwise read them as mistakes:
 *
 * 1. `radius` is a field of `drawRect`, not of `border`. R2.8 nests it inside
 *    `border`, which leaves a rounded rectangle with no border inexpressible;
 *    every Panel in this codebase is exactly that (`Panel.ts` defaults
 *    `borderRadius: 5` and draws no border). R5.3 lists the corner radii beside
 *    the border colour rather than inside it, and R5.5 treats them as the
 *    rectangle's own.
 * 2. R2.13's `transform` is the text transform of R6.9 (uppercasing before
 *    measurement), not a matrix. It is `textTransform` here so that it cannot
 *    be confused with the transform stack of R2.4 at a call site.
 * 3. R2.8's parenthetical says a shadowed rectangle produces two draw groups
 *    and says nothing about text; R3.17 requires the same of a shadowed text
 *    run. Both produce two commands, distinguished by `group`.
 */

/** R5.7's three border positions; `inside` is the default the components use. */
export type BorderPosition = 'inside' | 'center' | 'outside';

/** R5.7a: one radius, or four selected by quadrant (top-left, top-right, bottom-right, bottom-left). */
export type CornerRadii = number | readonly [number, number, number, number];

export interface Border {
	color: RGBA;
	width: number;
	position?: BorderPosition;
}

/** R2.8's four corner colours, in the order top-left, top-right, bottom-right, bottom-left. */
export type CornerColors = readonly [RGBA, RGBA, RGBA, RGBA];

/**
 * R2.8's shadow parameters, carried unresolved. R5.11's geometry (the rect
 * offset by `offset`, grown by `spread`, radii grown by the cubic, padded by
 * three sigma) is the shader's, and resolving it before the shader that has to
 * agree with it exists would fix it in the wrong place. The cull of R4.2a needs
 * only a conservative outer bound, which `bounds.ts` derives from these fields.
 */
export interface BoxShadow {
	color: RGBA;
	blur?: number;
	spread?: number;
	offset?: Vec2;
}

/** R5.22a. `over` is the default; nothing here reads it, the backend does. */
export type BlendMode = 'over' | 'additive' | 'multiply' | 'screen';

export type LineCap = 'butt' | 'round';

/** Created through R2.17's `createTexture` and referenced by handle only. */
export interface TextureHandle {
	readonly id: number;
	readonly width: number;
	readonly height: number;
	/** Debug name, `null` when the caller gave none; never `undefined`, see DrawApi. */
	readonly label: string | null;
}

export interface FontAtlasHandle {
	readonly id: number;
	/** The name `drawText`'s `font` selects; R11.8's three roles. */
	readonly name: string;
}

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type TextWrap = 'none' | 'word';
export type TextOverflow = 'visible' | 'clip' | 'ellipsis';
/** R6.9's pre-measurement transform. */
export type TextTransform = 'none' | 'uppercase';

export interface TextShadow {
	color: RGBA;
	offset?: Vec2;
	blur?: number;
}

export interface NineSlice {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

interface CommonOptions {
	/** R2.8's optional inspection id, and R13.22's node id when the tree walk supplies one. */
	id?: string;
	blend?: BlendMode;
}

export interface DrawRectOptions extends CommonOptions {
	rect: Rect;
	fill?: RGBA;
	radius?: CornerRadii;
	border?: Border;
	/** R5.9's per-corner fill colours. Overrides `fill` when present. */
	gradient?: CornerColors;
	shadow?: BoxShadow;
}

export interface DrawCircleOptions extends CommonOptions {
	center: Vec2;
	radius: number;
	fill?: RGBA;
	border?: Border;
}

export interface DrawLineOptions extends CommonOptions {
	from: Vec2;
	to: Vec2;
	color: RGBA;
	width: number;
	cap?: LineCap;
}

export interface DrawPolylineOptions extends CommonOptions {
	points: readonly Vec2[];
	color: RGBA;
	width: number;
	closed?: boolean;
	cap?: LineCap;
}

export interface DrawPolygonOptions extends CommonOptions {
	points: readonly Vec2[];
	/** R2.11's triangle list into `points`. Absent means `points` is already one. */
	indices?: readonly number[];
	fill?: RGBA;
	/** R2.11's per-vertex colours, one per entry in `points`. */
	colors?: readonly RGBA[];
}

/** R2.12: `sourceRect` is read in texture pixels unless the caller says UV. */
export type SourceSpace = 'pixels' | 'uv';

export interface DrawImageOptions extends CommonOptions {
	rect: Rect;
	texture: TextureHandle;
	sourceRect?: Rect;
	sourceSpace?: SourceSpace;
	/** R5.18's multiplied tint; white is identity. */
	tint?: RGBA;
	/** R5.19's nine-slice insets, in texture pixels. */
	slice?: NineSlice;
}

export interface DrawTextOptions extends CommonOptions {
	text: string;
	/** The alignment anchor and the baseline when `box` is absent (R2.13). */
	position?: Vec2;
	/** R2.13's optional alignment box. */
	box?: Rect;
	font: string;
	size: number;
	color: RGBA;
	align?: TextAlign;
	verticalAlign?: VerticalAlign;
	letterSpacing?: number;
	textTransform?: TextTransform;
	shadow?: TextShadow;
	maxWidth?: number;
	wrap?: TextWrap;
	overflow?: TextOverflow;
}

export interface MeasureTextOptions {
	text: string;
	font: string;
	size: number;
	letterSpacing?: number;
	textTransform?: TextTransform;
	maxWidth?: number;
	wrap?: TextWrap;
}

/** R2.14's return shape, declared so callers compile against the real contract. */
export interface TextMetrics {
	width: number;
	height: number;
	lines: number;
	/** Pen x after each glyph, in the same iteration order (R2.14, R6.8). */
	advances: readonly number[];
}

/**
 * R3.16 and R3.17: a shadow is its own group emitted immediately before its
 * owner, in the same layer. `group` is what a test asserts adjacency on without
 * having to decode colours.
 */
export type DrawGroupRole = 'primary' | 'shadow';

export type DrawCommandKind =
	| 'rect'
	| 'shadow'
	| 'circle'
	| 'line'
	| 'polyline'
	| 'polygon'
	| 'image'
	| 'text';

/**
 * The resolved ambient state every command carries. Read this list as the
 * answer to "what does a backend never have to ask for".
 */
export interface ResolvedState {
	readonly id: string | null;
	/** Position in the frame's submission order, from zero, across domains. */
	readonly sequence: number;
	readonly layer: LayerName;
	/** R3.14: the batcher's only sort key. */
	readonly layerOrdinal: number;
	/** Local space to screen space, concatenated down the stack (R2.4). */
	readonly transform: Mat2D;
	/** R2.4's cheap-snapping flag, decided at push and never re-tested per draw. */
	readonly translateOnly: boolean;
	/** Screen space, already intersected, converted at push (R4.6, R4.7). */
	readonly clip: ResolvedClip;
	/** R2.6, R3.25: the product of the stack, applied to every alpha including borders and shadows. */
	readonly opacity: number;
	readonly blend: BlendMode;
	readonly group: DrawGroupRole;
}

export interface RectCommand extends ResolvedState {
	readonly kind: 'rect';
	readonly rect: Rect;
	readonly fill: RGBA | null;
	readonly radius: CornerRadii | null;
	readonly border: Border | null;
	readonly gradient: CornerColors | null;
}

export interface ShadowCommand extends ResolvedState {
	readonly kind: 'shadow';
	/** The owner's rect and radii; R5.11's offset, spread and padding are the shader's. */
	readonly rect: Rect;
	readonly radius: CornerRadii | null;
	readonly shadow: Required<Omit<BoxShadow, 'color'>> & { color: RGBA };
}

export interface CircleCommand extends ResolvedState {
	readonly kind: 'circle';
	readonly center: Vec2;
	readonly radius: number;
	readonly fill: RGBA | null;
	readonly border: Border | null;
}

export interface LineCommand extends ResolvedState {
	readonly kind: 'line';
	readonly from: Vec2;
	readonly to: Vec2;
	readonly color: RGBA;
	readonly width: number;
	readonly cap: LineCap;
}

export interface PolylineCommand extends ResolvedState {
	readonly kind: 'polyline';
	readonly points: readonly Vec2[];
	readonly color: RGBA;
	readonly width: number;
	readonly closed: boolean;
	readonly cap: LineCap;
}

export interface PolygonCommand extends ResolvedState {
	readonly kind: 'polygon';
	readonly points: readonly Vec2[];
	readonly indices: readonly number[] | null;
	readonly fill: RGBA | null;
	readonly colors: readonly RGBA[] | null;
}

export interface ImageCommand extends ResolvedState {
	readonly kind: 'image';
	readonly rect: Rect;
	readonly texture: TextureHandle;
	readonly sourceRect: Rect | null;
	readonly sourceSpace: SourceSpace;
	readonly tint: RGBA | null;
	readonly slice: NineSlice | null;
}

export interface TextCommand extends ResolvedState {
	readonly kind: 'text';
	readonly text: string;
	readonly position: Vec2 | null;
	readonly box: Rect | null;
	readonly font: string;
	readonly size: number;
	readonly color: RGBA;
	readonly align: TextAlign;
	readonly verticalAlign: VerticalAlign;
	readonly letterSpacing: number;
	readonly textTransform: TextTransform;
	readonly maxWidth: number | null;
	readonly wrap: TextWrap;
	readonly overflow: TextOverflow;
	/** Non-zero only on the shadow run of R3.17; the main run is never blurred. */
	readonly blur: number;
}

export type DrawCommand =
	| RectCommand
	| ShadowCommand
	| CircleCommand
	| LineCommand
	| PolylineCommand
	| PolygonCommand
	| ImageCommand
	| TextCommand;
