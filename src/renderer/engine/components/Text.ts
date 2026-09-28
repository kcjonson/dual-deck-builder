import { Component, ComponentOptions } from './Component';
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
import type { FontRole } from '../text/fontFaces';
import { resolveFontRole } from '../text/fontRoles';
import { Style, StyleParser } from '../types/Style';

export type TextOptions = ComponentOptions;

/** R12.4's vertical alignment inside the text's own box. */
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';

const OVERFLOW: Readonly<Record<NonNullable<Style['textOverflow']>, TextOverflow>> = {
	visible: 'visible',
	hidden: 'clip',
	ellipsis: 'ellipsis',
};

/**
 * R12.4's text component. Its position is the top-left of its line box and
 * its bounds are that box; the draw API's baseline anchor never shows.
 *
 * Each axis is either assigned or hugged. An assigned width (a `width` option,
 * `setWidth` or `setSize` with a positive value) is the alignment box and,
 * unless `whiteSpace` is `nowrap`, the wrap width; `nowrap` with an ellipsis
 * truncates to it (R6.14). An assigned height is the box `verticalAlign`
 * places the lines in, and the height a wrapped ellipsis fits. An axis left at
 * zero hugs: it takes the measured width, or `lines * lineHeight`, from the
 * metrics service, the same layout `drawText` draws (R6.8). Setting an axis
 * back to zero hugs it again.
 *
 * Measurement needs the draw API and a backend with the text's atlas. Built
 * before either exists (a unit test's tree on the null backend), a hugging
 * text keeps a zero size, the layout lint's `unmeasured-text`, and measures
 * the first time it renders somewhere that can. It never estimates.
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
	private assignedWidth: boolean;
	private assignedHeight: boolean;
	private metrics: TextMetrics | null = null;
	private stale = true;

	constructor(text = '', options?: TextOptions) {
		super(options);
		this.content = text;
		this.componentType = 'Text';
		this.assignedWidth = this.width > 0;
		this.assignedHeight = this.height > 0;

		if (options?.style) {
			this.applyTextStyle(options.style);
		}
		this.measure();
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

	public setText(text: string): this {
		if (text !== this.content) {
			this.content = text;
			this.measure();
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
			this.measure();
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

	/** Positive assigns the width; zero hugs the measured width again. */
	public setWidth(width: number): this {
		this.assignedWidth = width > 0;
		this.fit(width, this.height);
		return this;
	}

	/** Positive assigns the height; zero hugs the measured height again. */
	public setHeight(height: number): this {
		this.assignedHeight = height > 0;
		this.fit(this.width, height);
		return this;
	}

	public setSize(width: number, height: number): this {
		this.assignedWidth = width > 0;
		this.assignedHeight = height > 0;
		this.fit(width, height);
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
		if (this.stale) this.measure();
		return this.metrics;
	}

	get wrap(): TextWrap {
		return this.whiteSpace === 'normal' && this.assignedWidth ? 'word' : 'none';
	}

	/**
	 * Lays the text out again and resizes each hugging axis to it. Called on
	 * every change that moves a glyph; the layouts are cached (R6.12), so
	 * repeating one is a map lookup.
	 */
	private measure(): void {
		this.fit(this.width, this.height);
	}

	/**
	 * Sizes both axes in one step: an assigned axis to the value given, a
	 * hugging one to the measure, or zero while nothing can measure. One step,
	 * because a hugging axis that passed through zero on its way to its
	 * measure would invalidate layout for a size it never had (R8.18).
	 */
	private fit(width: number, height: number): void {
		const metrics = this.layoutMetrics(this.assignedWidth ? width : undefined);
		super.setSize(
			this.assignedWidth ? width : (metrics?.width ?? 0),
			this.assignedHeight ? height : (metrics?.height ?? 0),
		);
	}

	/** The layout at a wrap width, through the mount context's draw API (R1.6); null when nothing can measure. */
	private layoutMetrics(maxWidth: number | undefined): TextMetrics | null {
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText(this.fontRole)) {
			this.stale = true;
			return null;
		}
		this.metrics = draw.measureText({
			text: this.content,
			font: this.fontRole,
			size: this.fontSize,
			letterSpacing: this.letterSpacing,
			textTransform: this.textTransform,
			wrap: this.wrap,
			maxWidth,
			lineHeight: this.lineHeight ?? undefined,
		});
		this.stale = false;
		return this.metrics;
	}

	public layout(): void {
		if (this.stale) this.measure();
		super.layout();
	}

	/**
	 * Measurement comes through the mount context (R1.6), so a text measures
	 * here the first time and hugs from then on; the size change invalidates
	 * its relayout boundary, which lays out again before the first render.
	 */
	protected onMount(_context: MountContext): void {
		this.measure();
	}

	public render(draw: DrawApi): void {
		if (this.stale) this.measure();

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
