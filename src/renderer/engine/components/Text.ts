import { Component, ComponentOptions, ResolvedColors } from './Component';
import type {
	DrawTextOptions,
	TextAlign,
	TextDecoration,
	TextMetrics,
	TextOverflow,
	TextShadow,
	TextTransform,
	TextWrap,
} from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { MountContext } from './MountContext';
import { Axis, Size, SizeMode, authoredSizeMode } from './layoutTypes';
import type { Rect } from '../draw/geometry';
import type { FontRole } from '../text/fontFaces';
import { resolveFontRole } from '../text/fontRoles';
import type { RGBA } from '../draw/geometry';
import {
	ColorValue,
	StyleAcceptance,
	StyleProperties,
	StyleProperty,
	resolveColor,
	resolveLength,
	resolveLetterSpacing,
	validateStyle,
} from '../style/styleObject';

const DEFAULT_FONT_SIZE = 16;
const WHITE: RGBA = [1, 1, 1, 1];

/** R11.14's properties a text renders. */
export type TextStyleObject = Pick<
	StyleProperties,
	'color' | 'fontSize' | 'fontRole' | 'fontFamily' | 'fontWeight' | 'letterSpacing' | 'textTransform' | 'textAlign' | 'textDecoration' | 'opacity'
>;

const TEXT_STYLE: StyleAcceptance = {
	component: 'Text',
	properties: new Set<StyleProperty>([
		'color',
		'fontSize',
		'fontRole',
		'fontFamily',
		'fontWeight',
		'letterSpacing',
		'textTransform',
		'textAlign',
		'textDecoration',
		'opacity',
	]),
	states: new Set(),
};

/**
 * R12.4's text properties that are not style: where the lines sit in the box,
 * whether they wrap, what an overrun does, and the line height.
 */
export interface TextLayoutOptions {
	verticalAlign?: TextVerticalAlign;
	/** `word` (the default) wraps at the box width; `none` keeps one line. */
	wrap?: TextWrap;
	/**
	 * R12.4's `overflow` (default `visible`), named for text since the base
	 * `overflow` is whether a component clips its children.
	 */
	textOverflow?: TextOverflow;
	/** A multiple of `fontSize`; absent is the face's own line height (R6.10). */
	lineHeight?: number;
}

export interface TextOptions extends Omit<ComponentOptions, 'style'>, TextLayoutOptions {
	/** The string drawn. Default empty. */
	text?: string;
	style?: TextStyleObject;
}

/** R12.4's vertical alignment inside the text's own box. */
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * R13.22's `text.overflow`: what happened to a text that did not fit its box.
 * `none` when it fits; `visible` when it runs past the box with nothing
 * handling it, which is what the lint's text-overflow rule reports.
 */
export type TextOverflowOutcome = 'none' | 'clip' | 'ellipsis' | 'visible';

/**
 * R12.4's text component. Its position is the top-left of its line box and
 * its bounds are that box; the draw API's baseline anchor never shows.
 *
 * Each axis is `fixed` or hugs (R10.1). A fixed width (a `width` option,
 * the `width` accessor or `setSize` with a positive value) is the alignment box and,
 * unless `wrap` is `none`, the wrap width; `none` with an ellipsis
 * truncates to it (R6.14). A fixed height is the box `verticalAlign` places
 * the lines in, and the height a wrapped ellipsis fits. An axis left at zero
 * hugs: it takes the measured width, or `lines * lineHeight`, from the
 * metrics service, the same layout `drawText` draws (R6.8). Setting an axis
 * back to zero hugs it again.
 *
 * Inside a stack, the stack's assignment is the box on a non-fixed axis for
 * the pass (R10.13): a width assigned or constrained by the cross pass is the
 * wrap width, and the height follows. Outside one, nothing assigns and the
 * text hugs as above.
 *
 * Measurement goes through the mount context's draw API (R1.6), on mount and
 * on every change while mounted. Unmounted, or mounted on a backend without
 * the text's atlas (a unit test's null backend), a hugging text keeps a zero
 * size, the layout lint's `unmeasured-text`. It never estimates, and it never
 * measures during render, where a size change would invalidate layout
 * (R8.16).
 */
export class Text extends Component {
	private content: string;
	private ownFontSize = DEFAULT_FONT_SIZE;
	private styleObject: TextStyleObject = {};
	/** R11.8's role, from the style's `fontFamily` and `fontWeight` through the theme table. */
	private fontRole: FontRole = 'body';
	private ownColor: RGBA = WHITE;
	private ownAlign: TextAlign = 'left';
	private ownVerticalAlign: TextVerticalAlign = 'top';
	/** A multiple of `fontSize`; null is the face's own (R6.10). */
	private lineHeight: number | null = null;
	private wrapMode: TextWrap = 'word';
	private textOverflow: TextOverflow = 'visible';
	private letterSpacing = 0;
	private textTransform: TextTransform = 'none';
	private decoration: TextDecoration = 'none';
	private textShadow: TextShadow | null = null;
	/** The size a `fixed` axis holds; layout never changes it. */
	private authoredWidth: number;
	private authoredHeight: number;
	/** The parent stack's assignment for the current pass, on non-fixed axes (R10.5). */
	private layoutWidth: number | null = null;
	private layoutHeight: number | null = null;
	private metrics: TextMetrics | null = null;
	private stale = true;
	/** `measuredInk`'s cache, and the box and inputs it was taken for. */
	private cachedInk: Rect | null = null;
	private inkWidth = Number.NaN;
	private inkHeight = Number.NaN;
	private inkDirty = true;

	constructor({ text = '', style, verticalAlign, wrap, textOverflow, lineHeight, ...options }: TextOptions = {}) {
		super(options);
		this.content = text;
		this.componentType = 'Text';
		this.authoredWidth = this.width;
		this.authoredHeight = this.height;

		if (style) this.applyTextStyle(style);
		this.applyLayoutOptions({ verticalAlign, wrap, textOverflow, lineHeight });
		this.remeasure();
	}

	/** R10.1: text hugs an axis it was given no size on. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	/**
	 * R11.14 and R11.16: validated, then resolved over the defaults, so a new
	 * style replaces the old one whole, as construction does. A property the
	 * style leaves out goes back to its default.
	 */
	private applyTextStyle(style: TextStyleObject): void {
		validateStyle(style, TEXT_STYLE);
		this.styleObject = style;
		this.ownFontSize = style.fontSize !== undefined ? resolveLength(style.fontSize, 'fontSize') : DEFAULT_FONT_SIZE;
		this.fontRole = style.fontRole !== undefined || style.fontFamily !== undefined || style.fontWeight !== undefined
			? resolveFontRole({ family: style.fontRole ?? style.fontFamily, weight: style.fontWeight })
			: 'body';
		this.ownColor = style.color !== undefined ? resolveColor(style.color) : WHITE;
		this.ownAlign = style.textAlign ?? 'left';
		this.letterSpacing = style.letterSpacing !== undefined ? resolveLetterSpacing(style.letterSpacing) : 0;
		this.textTransform = style.textTransform ?? 'none';
		this.decoration = style.textDecoration ?? 'none';
		if (style.opacity !== undefined) this.opacity = style.opacity;
	}

	private applyLayoutOptions({ verticalAlign, wrap, textOverflow, lineHeight }: TextLayoutOptions): void {
		if (verticalAlign !== undefined) this.ownVerticalAlign = verticalAlign;
		if (wrap !== undefined) this.wrapMode = wrap;
		if (textOverflow !== undefined) this.textOverflow = textOverflow;
		if (lineHeight !== undefined) this.lineHeight = lineHeight;
	}

	public get style(): TextStyleObject {
		return this.styleObject;
	}

	/**
	 * Replaces the style, the same path as construction (R11.16). Every text
	 * property can move a glyph, so it measures again and invalidates layout.
	 */
	public set style(style: TextStyleObject) {
		this.applyTextStyle(style);
		this.remeasure();
		this.invalidateLayout();
	}

	/** The layout options, applied over the current ones; measures again like `style`. */
	public set layoutOptions(options: TextLayoutOptions) {
		this.applyLayoutOptions(options);
		this.remeasure();
		this.invalidateLayout();
	}

	public get text(): string {
		return this.content;
	}

	public set text(text: string) {
		if (text !== this.content) {
			this.content = text;
			this.remeasure();
			// Content is measurement input even when both axes are assigned (R8.18).
			this.invalidateLayout();
		}
	}

	public get fontSize(): number {
		return this.ownFontSize;
	}

	public set fontSize(size: number) {
		if (size !== this.ownFontSize) {
			this.ownFontSize = size;
			this.remeasure();
			this.invalidateLayout();
		}
	}

	public get color(): RGBA {
		return this.ownColor;
	}

	public set color(color: ColorValue) {
		this.ownColor = resolveColor(color);
	}

	public get align(): TextAlign {
		return this.ownAlign;
	}

	public set align(align: TextAlign) {
		if (align !== this.ownAlign) {
			this.ownAlign = align;
			this.runMoved();
		}
	}

	public get verticalAlign(): TextVerticalAlign {
		return this.ownVerticalAlign;
	}

	public set verticalAlign(verticalAlign: TextVerticalAlign) {
		if (verticalAlign !== this.ownVerticalAlign) {
			this.ownVerticalAlign = verticalAlign;
			this.runMoved();
		}
	}

	/**
	 * R12.4's `shadow`: a copy of the run drawn beneath it (R3.17), for text
	 * over a fill, such as a meter's inline label (R12.24). Moves no glyph.
	 */
	public get shadow(): TextShadow | null {
		return this.textShadow;
	}

	public set shadow(shadow: TextShadow | null) {
		this.textShadow = shadow;
		this.runMoved();
	}

	/** The run moved inside its box without changing size: only its ink is stale. */
	private runMoved(): void {
		this.inkDirty = true;
		this.invalidateInk();
	}

	public get width(): number {
		return super.width;
	}

	/** Positive fixes the width; zero hugs the measured width again. */
	public set width(width: number) {
		this.authoredWidth = width;
		this.widthMode = authoredSizeMode(width, this.widthMode);
		this.fit();
	}

	public get height(): number {
		return super.height;
	}

	/** Positive fixes the height; zero hugs the measured height again. */
	public set height(height: number) {
		this.authoredHeight = height;
		this.heightMode = authoredSizeMode(height, this.heightMode);
		this.fit();
	}

	public setSize(width: number, height: number): this {
		this.authoredWidth = width;
		this.authoredHeight = height;
		this.widthMode = authoredSizeMode(width, this.widthMode);
		this.heightMode = authoredSizeMode(height, this.heightMode);
		this.fit();
		return this;
	}

	/** The font role this text draws with (R11.8). */
	get font(): FontRole {
		return this.fontRole;
	}

	/**
	 * The text as laid out in its box: unwrapped and untruncated when the
	 * width hugs, wrapped at an assigned width. Null until it can be measured.
	 * Its width can exceed an assigned width, which is how a caller tells that
	 * a `nowrap` text will be truncated or overflow.
	 */
	get measured(): TextMetrics | null {
		if (this.stale) this.remeasure();
		return this.metrics;
	}

	/**
	 * The last measurement, or null when there is none current. Unlike
	 * `measured` it never measures, so a reader (the tree snapshot) cannot
	 * resize the text it is observing.
	 */
	get currentMetrics(): TextMetrics | null {
		return this.stale ? null : this.metrics;
	}

	/**
	 * Whether the last measurement overran the box, and what drew it then:
	 * `clip` clips the run to its box on both axes, and `ellipsis` truncates
	 * lines to the width, and to the height only when wrapping (R6.14). Null
	 * when nothing has measured.
	 */
	get overflowOutcome(): TextOverflowOutcome | null {
		const metrics = this.currentMetrics;
		if (!metrics) return null;
		const wide = metrics.width > this.width;
		const tall = metrics.height > this.height;
		if (!wide && !tall) return 'none';
		if (this.textOverflow === 'clip') return 'clip';
		if (this.textOverflow === 'ellipsis' && (!tall || this.wrap === 'word')) return 'ellipsis';
		return 'visible';
	}

	public get resolvedColors(): ResolvedColors {
		return { text: this.ownColor };
	}

	/**
	 * The box unioned with the run's ink, from the layout and placement
	 * `render` draws (`DrawApi.measureTextInk`, the extent R4.2a culls the run
	 * by), so a nowrap run past a narrow box, wrapped lines past a fixed
	 * height, and glyphs past a tight line height are all inside it. Null
	 * while nothing has measured, when the run draws nothing, or when the
	 * backend cannot give the extent. Cached until the text, its style, its
	 * alignment or its box changes.
	 */
	private get measuredInk(): Rect | null {
		const width = this.width;
		const height = this.height;
		if (this.inkDirty || width !== this.inkWidth || height !== this.inkHeight) {
			this.inkDirty = false;
			this.inkWidth = width;
			this.inkHeight = height;
			const draw = this.context?.draw;
			const run = this.currentMetrics && draw ? draw.measureTextInk(this.drawOptions()) : null;
			if (run) {
				let minX = Math.min(0, run.x);
				let minY = Math.min(0, run.y);
				let maxX = Math.max(width, run.x + run.width);
				let maxY = Math.max(height, run.y + run.height);
				const shadow = this.textShadow;
				if (shadow) {
					// The shadow run's ink, as `DrawApi.emitText` places it.
					const offset = shadow.offset ?? { x: 0, y: 0 };
					const blur = shadow.blur ?? 0;
					minX = Math.min(minX, run.x + offset.x - blur);
					minY = Math.min(minY, run.y + offset.y - blur);
					maxX = Math.max(maxX, run.x + run.width + offset.x + blur);
					maxY = Math.max(maxY, run.y + run.height + offset.y + blur);
				}
				this.cachedInk = Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
			} else {
				this.cachedInk = null;
			}
		}
		return this.cachedInk;
	}

	/** R8.8: how far the measured run reaches past the box on its furthest side. */
	public get inkExtent(): number {
		const ink = this.measuredInk;
		if (!ink) return 0;
		return Math.max(-ink.x, -ink.y, ink.x + ink.width - this.width, ink.y + ink.height - this.height);
	}

	/**
	 * The box and the measured run, per side rather than `inkExtent` on all
	 * four, since a run overruns on the sides its alignment sends it to. The
	 * snapshot's `inkBounds` (R13.22).
	 */
	public get inkRect(): Rect {
		return this.measuredInk ?? super.inkRect;
	}

	/**
	 * The subtree cull's bound on the run (DDB-184): `inkRect`. The clip of
	 * `overflow: clip` is not relied on, since the ink audit compares the
	 * unclipped run. Null while nothing has measured, because then nothing
	 * bounds what `drawText` lays out. On a backend that measures text but
	 * cannot give its extent, the box grown on every side by however far the
	 * layout overruns it, and an em beyond that for side bearings, ascenders
	 * past a tight line height, decorations and distance-field padding.
	 */
	protected get cullInk(): Rect | null {
		const metrics = this.currentMetrics;
		if (!metrics) return null;
		if (this.context?.draw.canMeasureTextInk) return this.inkRect;
		const spillX = Math.max(0, metrics.width - this.width);
		const spillY = Math.max(0, metrics.height - this.height);
		const shadow = this.textShadow;
		const shadowReach = shadow
			? Math.max(Math.abs(shadow.offset?.x ?? 0), Math.abs(shadow.offset?.y ?? 0)) + (shadow.blur ?? 0)
			: 0;
		const slack = Math.max(0, this.ownFontSize) + shadowReach;
		return {
			x: -spillX - slack,
			y: -spillY - slack,
			width: this.width + (spillX + slack) * 2,
			height: this.height + (spillY + slack) * 2,
		};
	}

	get wrap(): TextWrap {
		return this.wrapMode === 'word' && this.boxWidth !== null ? 'word' : 'none';
	}

	/** The width the lines are laid out in: fixed, or the parent stack's for this pass; null hugs. */
	private get boxWidth(): number | null {
		if (this.widthMode === 'fixed') return this.authoredWidth;
		return this.layoutWidth !== null && this.parent?.sizesChildren ? this.layoutWidth : null;
	}

	private get boxHeight(): number | null {
		if (this.heightMode === 'fixed') return this.authoredHeight;
		return this.layoutHeight !== null && this.parent?.sizesChildren ? this.layoutHeight : null;
	}

	/**
	 * Lays the text out again and resizes each hugging axis to it. Called on
	 * every change that moves a glyph; the layouts are cached (R6.12), so
	 * repeating one is a map lookup.
	 */
	private remeasure(): void {
		this.fit();
	}

	/**
	 * Sizes both axes in one step: a boxed axis to its box, a hugging one to
	 * the measure, or zero while nothing can measure. One step, because a
	 * hugging axis that passed through zero on its way to its measure would
	 * invalidate layout for a size it never had (R8.18).
	 */
	private fit(): void {
		this.inkDirty = true;
		const size = this.resolveSize();
		this.storeSize({ width: size.width, height: size.height, notify: true });
	}

	private resolveSize(): Size {
		const boxWidth = this.boxWidth;
		const boxHeight = this.boxHeight;
		const metrics = this.layoutMetrics(boxWidth ?? undefined);
		return {
			width: boxWidth ?? metrics?.width ?? 0,
			height: boxHeight ?? metrics?.height ?? 0,
		};
	}

	/** The layout at a wrap width, through the mount context's draw API (R1.6); null when nothing can measure. */
	private layoutMetrics(maxWidth: number | undefined): TextMetrics | null {
		const metrics = this.metricsFor(maxWidth, this.wrap);
		const stale = metrics === null;
		// Measured or not decides whether `cullInk` has a bound at all, and a
		// first measure at an unchanged size invalidates nothing else, so the
		// subtree would otherwise stay unbounded and never be skipped.
		// A different layout moves the run, and a stack's `assignSize` lays out
		// here without `fit`, often at an unchanged size, so this is where the
		// cached ink learns of it (a measure returns a fresh object each time,
		// hence the comparison by value).
		if (stale !== this.stale || (metrics !== null && !sameLayout(metrics, this.metrics))) {
			this.inkDirty = true;
			this.invalidateInk();
		}
		this.stale = stale;
		if (metrics) this.metrics = metrics;
		return metrics;
	}

	/** A layout of this text, or null when nothing can measure it. Writes nothing. */
	private metricsFor(maxWidth: number | undefined, wrap: TextWrap): TextMetrics | null {
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText(this.fontRole)) return null;
		return draw.measureText({
			text: this.content,
			font: this.fontRole,
			size: this.ownFontSize,
			letterSpacing: this.letterSpacing,
			textTransform: this.textTransform,
			wrap,
			maxWidth,
			lineHeight: this.lineHeight ?? undefined,
		});
	}

	// -- the layout protocol (R8.1, R10.7, R10.13) ------------------------------

	/**
	 * Shrink-to-fit on a hugging width, as CSS auto-width items do: the
	 * unwrapped width, or the space available if that is less, but never
	 * below the longest word (R10.4's automatic minimum); the height is the
	 * wrapped height at that width. Unmeasurable text reports its current size.
	 */
	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		if (!this.context?.draw.canMeasureText(this.fontRole)) return { width: this.width, height: this.height };
		let width: number;
		if (this.widthMode === 'fixed') {
			width = this.authoredWidth;
		} else if (definite === 'width') {
			width = availableWidth;
		} else {
			const intrinsic = this.metricsFor(undefined, 'none')?.width ?? 0;
			width = Math.min(intrinsic, Math.max(this.automaticMinSize('width'), availableWidth));
		}
		let height: number;
		if (this.heightMode === 'fixed') {
			height = this.authoredHeight;
		} else if (definite === 'height') {
			height = availableHeight;
		} else {
			const wrap: TextWrap = this.wrapMode;
			height = this.metricsFor(width, wrap)?.height ?? 0;
		}
		return { width, height };
	}

	/** The box for this pass on each non-fixed axis; the text wraps to an assigned width. */
	public assignSize(width: number, height: number): void {
		if (!Number.isNaN(width) && this.widthMode !== 'fixed') this.layoutWidth = width;
		if (!Number.isNaN(height) && this.heightMode !== 'fixed') this.layoutHeight = height;
		const size = this.resolveSize();
		this.applyLayoutSize(size.width, size.height);
	}

	/** How narrow a stack may shrink it: its automatic minimum across, its height down. */
	public minContentSize(axis: Axis): number {
		if (axis === 'width') return this.widthMode === 'fixed' ? this.authoredWidth : this.automaticMinSize('width');
		return this.height;
	}

	/**
	 * R10.4: CSS `min-width: auto`. The longest unbreakable word, or the whole
	 * line when it cannot wrap; zero when it clips or ellipsises, since then it
	 * may be as narrow as it is given.
	 */
	public automaticMinSize(axis: Axis): number {
		if (axis !== 'width' || this.textOverflow !== 'visible') return 0;
		if (this.wrapMode === 'none') return this.metricsFor(undefined, 'none')?.width ?? 0;
		// Every break opportunity taken: each line is one word.
		return this.metricsFor(NARROWEST_WRAP, 'word')?.width ?? 0;
	}

	/** The last stack's assignment belongs to that stack. */
	protected onParentChanged(): void {
		this.layoutWidth = null;
		this.layoutHeight = null;
		this.remeasure();
	}

	public layout(): void {
		if (this.stale) this.remeasure();
		super.layout();
	}

	/**
	 * Measurement comes through the mount context (R1.6), so a text measures
	 * here the first time and hugs from then on; the size change invalidates
	 * its relayout boundary, which lays out again before the first render.
	 */
	protected onMount(_context: MountContext): void {
		this.remeasure();
	}

	public render(draw: DrawApi): void {
		draw.drawText(this.drawOptions());
	}

	/** The run `render` draws, which `measuredInk` measures too. */
	private drawOptions(): DrawTextOptions {
		return {
			id: this.id ?? undefined,
			text: this.content,
			box: { x: 0, y: 0, width: this.width, height: this.height },
			font: this.fontRole,
			size: this.ownFontSize,
			color: this.ownColor,
			align: this.ownAlign,
			verticalAlign: this.ownVerticalAlign,
			wrap: this.wrap,
			overflow: this.textOverflow,
			letterSpacing: this.letterSpacing,
			textTransform: this.textTransform,
			decoration: this.decoration,
			lineHeight: this.lineHeight ?? undefined,
			shadow: this.textShadow ?? undefined,
		};
	}
}

/**
 * A wrap width narrower than any glyph, so every break opportunity is taken.
 * Zero would read as no wrap at all.
 */
const NARROWEST_WRAP = 1e-3;

/** Whether two measures describe the same lines, so the run lands in the same place. */
function sameLayout(a: TextMetrics, b: TextMetrics | null): boolean {
	if (!b || a.width !== b.width || a.height !== b.height || a.lines !== b.lines) return false;
	for (let line = 0; line < a.lineWidths.length; line++) {
		if (a.lineWidths[line] !== b.lineWidths[line]) return false;
	}
	return true;
}
