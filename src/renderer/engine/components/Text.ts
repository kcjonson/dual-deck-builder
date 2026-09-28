import { Component, ComponentOptions, ResolvedColors } from './Component';
import type {
	TextAlign,
	TextDecoration,
	TextMetrics,
	TextOverflow,
	TextTransform,
	TextWrap,
} from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { MountContext } from './MountContext';
import { Axis, Size, SizeMode, authoredSizeMode } from './layoutTypes';
import type { Rect } from '../draw/geometry';
import type { FontRole } from '../text/fontFaces';
import { resolveFontRole } from '../text/fontRoles';
import { Style, StyleParser } from '../types/Style';

export type TextOptions = ComponentOptions;

/** R12.4's vertical alignment inside the text's own box. */
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * R13.22's `text.overflow`: what happened to a text that did not fit its box.
 * `none` when it fits; `visible` when it runs past the box with nothing
 * handling it, which is what the lint's text-overflow rule reports.
 */
export type TextOverflowOutcome = 'none' | 'clip' | 'ellipsis' | 'visible';

const OVERFLOW: Readonly<Record<NonNullable<Style['textOverflow']>, TextOverflow>> = {
	visible: 'visible',
	hidden: 'clip',
	ellipsis: 'ellipsis',
};

/**
 * R12.4's text component. Its position is the top-left of its line box and
 * its bounds are that box; the draw API's baseline anchor never shows.
 *
 * Each axis is `fixed` or hugs (R10.1). A fixed width (a `width` option,
 * `setWidth` or `setSize` with a positive value) is the alignment box and,
 * unless `whiteSpace` is `nowrap`, the wrap width; `nowrap` with an ellipsis
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
	private fontSize = 16;
	/** R11.8's role, from the style's `fontFamily` and `fontWeight` through the theme table. */
	private fontRole: FontRole = 'body';
	private color: [number, number, number, number] = [1, 1, 1, 1];
	private align: TextAlign = 'left';
	private verticalAlign: TextVerticalAlign = 'top';
	/** A multiple of `fontSize`; null is the face's own (R6.10). */
	private lineHeight: number | null = null;
	private whiteSpace: 'normal' | 'nowrap' = 'normal';
	private textOverflow: TextOverflow = 'visible';
	private letterSpacing = 0;
	private textTransform: TextTransform = 'none';
	private decoration: TextDecoration = 'none';
	/** The size a `fixed` axis holds; layout never changes it. */
	private authoredWidth: number;
	private authoredHeight: number;
	/** The parent stack's assignment for the current pass, on non-fixed axes (R10.5). */
	private layoutWidth: number | null = null;
	private layoutHeight: number | null = null;
	private metrics: TextMetrics | null = null;
	private stale = true;

	constructor(text = '', options?: TextOptions) {
		super(options);
		this.content = text;
		this.componentType = 'Text';
		this.authoredWidth = this.width;
		this.authoredHeight = this.height;

		if (options?.style) {
			this.applyTextStyle(options.style);
		}
		this.remeasure();
	}

	/** R10.1: text hugs an axis it was given no size on. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	private applyTextStyle(style: Style): void {
		if (style.fontSize !== undefined) {
			this.fontSize = this.parseSize(style.fontSize);
		}
		if (style.fontFamily !== undefined || style.fontWeight !== undefined) {
			this.fontRole = resolveFontRole({ family: style.fontFamily, weight: style.fontWeight });
		}
		if (style.color !== undefined) {
			this.color = StyleParser.parseColor(style.color);
		}
		if (style.textAlign !== undefined) {
			this.align = style.textAlign;
		}
		if (style.verticalAlign !== undefined) {
			this.verticalAlign = style.verticalAlign;
		}
		if (style.lineHeight !== undefined) {
			this.lineHeight = style.lineHeight;
		}
		if (style.whiteSpace !== undefined) {
			this.whiteSpace = style.whiteSpace;
		}
		if (style.textOverflow !== undefined) {
			this.textOverflow = OVERFLOW[style.textOverflow];
		}
		if (style.letterSpacing !== undefined) {
			this.letterSpacing = style.letterSpacing;
		}
		if (style.textTransform !== undefined) {
			this.textTransform = style.textTransform;
		}
		if (style.textDecoration !== undefined) {
			this.decoration = style.textDecoration;
		}
	}

	/**
	 * Applies these style properties over the current ones, the same path as
	 * construction (R11.16). Every text property can move a glyph, so it
	 * measures again and invalidates layout.
	 */
	public set textStyle(style: Style) {
		this.applyTextStyle(style);
		this.remeasure();
		this.invalidateLayout();
	}

	public setText(text: string): this {
		if (text !== this.content) {
			this.content = text;
			this.remeasure();
			// Content is measurement input even when both axes are assigned (R8.18).
			this.invalidateLayout();
		}
		return this;
	}

	public getText(): string {
		return this.content;
	}

	public setFontSize(size: number): this {
		if (size !== this.fontSize) {
			this.fontSize = size;
			this.remeasure();
			this.invalidateLayout();
		}
		return this;
	}

	public getFontSize(): number {
		return this.fontSize;
	}

	public setColor(color: string | [number, number, number, number]): this {
		this.color = StyleParser.parseColor(color);
		return this;
	}

	public setAlign(align: TextAlign): this {
		this.align = align;
		return this;
	}

	public setVerticalAlign(verticalAlign: TextVerticalAlign): this {
		this.verticalAlign = verticalAlign;
		return this;
	}

	/**
	 * The accessors mean what `setWidth` and `setHeight` mean, so an authored
	 * size has one home: set through either, it survives the next re-fit.
	 */
	public get width(): number {
		return super.width;
	}

	public set width(value: number) {
		this.setWidth(value);
	}

	public get height(): number {
		return super.height;
	}

	public set height(value: number) {
		this.setHeight(value);
	}

	/** Positive fixes the width; zero hugs the measured width again. */
	public setWidth(width: number): this {
		this.authoredWidth = width;
		this.widthMode = authoredSizeMode(width, this.widthMode);
		this.fit();
		return this;
	}

	/** Positive fixes the height; zero hugs the measured height again. */
	public setHeight(height: number): this {
		this.authoredHeight = height;
		this.heightMode = authoredSizeMode(height, this.heightMode);
		this.fit();
		return this;
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
		return { text: this.color };
	}

	/**
	 * The subtree cull's bound on the run (DDB-184): the box grown on every
	 * side by however far the laid-out run overruns it, so any alignment is
	 * covered, and by an em beyond that for side bearings, ascenders past a
	 * tight line height, decorations and the glyph quads' distance-field
	 * padding. The clip of `overflow: clip` is not relied on, since the ink
	 * audit compares the unclipped run. Null while nothing has measured,
	 * because then nothing bounds what `drawText` lays out.
	 */
	protected get cullInk(): Rect | null {
		const metrics = this.currentMetrics;
		if (!metrics) return null;
		const spillX = Math.max(0, metrics.width - this.width);
		const spillY = Math.max(0, metrics.height - this.height);
		const slack = Math.max(0, this.fontSize);
		return {
			x: -spillX - slack,
			y: -spillY - slack,
			width: this.width + (spillX + slack) * 2,
			height: this.height + (spillY + slack) * 2,
		};
	}

	get wrap(): TextWrap {
		return this.whiteSpace === 'normal' && this.boxWidth !== null ? 'word' : 'none';
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
		this.stale = metrics === null;
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
			size: this.fontSize,
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
			const wrap: TextWrap = this.whiteSpace === 'normal' ? 'word' : 'none';
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
		if (this.whiteSpace === 'nowrap') return this.metricsFor(undefined, 'none')?.width ?? 0;
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
		draw.drawText({
			id: this.id ?? undefined,
			text: this.content,
			box: { x: 0, y: 0, width: this.width, height: this.height },
			font: this.fontRole,
			size: this.fontSize,
			color: this.color,
			align: this.align,
			verticalAlign: this.verticalAlign,
			wrap: this.wrap,
			overflow: this.textOverflow,
			letterSpacing: this.letterSpacing,
			textTransform: this.textTransform,
			decoration: this.decoration,
			lineHeight: this.lineHeight ?? undefined,
		});
	}
}

/**
 * A wrap width narrower than any glyph, so every break opportunity is taken.
 * Zero would read as no wrap at all.
 */
const NARROWEST_WRAP = 1e-3;
