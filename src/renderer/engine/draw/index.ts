/**
 * The public surface of the draw module. Curated rather than a wall of
 * `export *`: `intersectClip`, `screenInk`, `LayerPartition` and the rest are
 * how this module keeps its promises, not promises it makes, and a consumer
 * that reaches for one of them is reaching past the seam. They stay importable
 * from their own files, which is what the tests do.
 */

export { DrawApi, TEXT_MEASUREMENT_UNAVAILABLE } from './DrawApi';
export type { BeginFrameOptions, Diagnostic, DiagnosticCode, DrawApiOptions } from './DrawApi';

export { NullBackend } from './NullBackend';
export { RecordingBackend } from './RecordingBackend';
export type { RecordedBatch, RecordedFrame, RecordingBackendOptions } from './RecordingBackend';

export type {
	DrawBackend,
	DrawBatch,
	FontAtlasOptions,
	FrameDescription,
	TextureOptions,
} from './DrawBackend';

export type {
	BlendMode,
	Border,
	BorderPosition,
	BoxShadow,
	CircleCommand,
	CornerColors,
	CornerRadii,
	DrawCircleOptions,
	DrawCommand,
	DrawCommandKind,
	DrawGroupRole,
	DrawImageOptions,
	DrawLineOptions,
	DrawPolygonOptions,
	DrawPolylineOptions,
	DrawRectOptions,
	DrawTextOptions,
	FontAtlasHandle,
	ImageCommand,
	LineCap,
	LineCommand,
	MeasureTextOptions,
	NineSlice,
	PolygonCommand,
	PolylineCommand,
	RectCommand,
	ResolvedState,
	ShadowCommand,
	SourceSpace,
	TextAlign,
	TextCommand,
	TextMetrics,
	TextOverflow,
	TextShadow,
	TextTransform,
	TextWrap,
	TextureHandle,
	VerticalAlign,
} from './commands';

export { UNCLIPPED_RECT, clipRectOf } from './clip';
export type { ClipState, ResolvedClip, RoundedClip } from './clip';

export { IDENTITY, concat, transformPoint, translation } from './geometry';
export type { ClipRect, Mat2D, RGBA, Rect, Vec2 } from './geometry';

export { LAYER_NAMES, LAYER_ORDINALS, ROOT_LAYER, layerOrdinal } from './layers';
export type { LayerName } from './layers';

export { FLUSH_REASONS, SPLIT_REASONS } from './stats';
export type {
	DrawStats,
	FlushCounts,
	FlushReason,
	GpuWork,
	LayerCounts,
	SplitCounts,
	SplitReason,
} from './stats';
