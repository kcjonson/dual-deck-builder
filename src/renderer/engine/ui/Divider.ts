import { Component, ComponentOptions, ResolvedColors } from '../components/Component';
import type { Axis, Size } from '../components/layoutTypes';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import { tokens } from '../theme/tokens';
import { rgba } from './surfaces';

export type DividerOrientation = 'horizontal' | 'vertical';

export interface DividerOptions extends Omit<ComponentOptions, 'style'> {
	/** A small mono caption centred on a horizontal rule, breaking it. */
	caption?: string;
	/** Default `horizontal`. */
	orientation?: DividerOrientation;
}

const HAIRLINE = tokens.borderWidth.bw_hair;
const CAPTION_GAP = tokens.space.space_2;
const { color } = tokens;

/**
 * R12.29's divider: a hairline across its box, with an optional caption
 * centred on it that the line stops short of. Horizontal by default, filling
 * a parent stack's width unless given one; vertical fills the height and has
 * no caption. The box is the caption's line when there is one and the
 * hairline otherwise.
 */
export class Divider extends Component {
	private readonly orientation: DividerOrientation;
	private readonly captionText: Text | null;

	constructor({ caption, orientation = 'horizontal', ...options }: DividerOptions = {}) {
		const horizontal = orientation === 'horizontal';
		if (!horizontal && caption !== undefined) throw new Error('Divider: a vertical divider has no caption (R12.29)');
		super({
			widthMode: horizontal && options.width === undefined ? 'fill' : undefined,
			heightMode: options.height === undefined ? (horizontal ? 'hug' : 'fill') : undefined,
			...options,
			width: options.width ?? (horizontal ? 0 : HAIRLINE),
			height: options.height ?? (horizontal ? HAIRLINE : 0),
		});
		this.componentType = 'Divider';
		this.orientation = orientation;
		this.captionText = caption !== undefined
			? new Text(caption, {
				style: {
					fontFamily: 'mono',
					fontSize: tokens.fontSize.fs_xs,
					color: rgba(color.text_faint),
					textTransform: 'uppercase',
					letterSpacing: tokens.letterSpacing.ls_wide,
					whiteSpace: 'nowrap',
				},
			})
			: null;
		if (this.captionText) this.addPart(this.captionText);
	}

	public get caption(): string | null {
		return this.captionText?.getText() ?? null;
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: color.line_edge };
	}

	/** Across: whatever the parent gives. Along the thin axis: the caption's line, or the hairline. */
	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		const thin = this.captionText ? Math.max(HAIRLINE, this.captionText.height) : HAIRLINE;
		if (this.orientation === 'horizontal') {
			return { width: definite === 'width' ? availableWidth : this.width, height: definite === 'height' ? availableHeight : thin };
		}
		return { width: definite === 'width' ? availableWidth : thin, height: definite === 'height' ? availableHeight : this.height };
	}

	protected layoutChildren(): void {
		const caption = this.captionText;
		if (!caption) return;
		if (this.heightMode === 'hug' && !this.parent?.sizesChildren) this.resizeInLayout(this.width, Math.max(HAIRLINE, caption.height));
		caption.setPosition(Math.round((this.width - caption.width) / 2), 0);
	}

	protected onResized(): void {
		super.onResized();
		const caption = this.captionText;
		if (caption) caption.setPosition(Math.round((this.width - caption.width) / 2), 0);
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		if (this.orientation === 'vertical') {
			draw.drawRect({ id: this.id ?? undefined, rect: { x: Math.floor((this.width - HAIRLINE) / 2), y: 0, width: HAIRLINE, height: this.height }, fill: color.line_edge });
			return;
		}
		const y = Math.floor((this.height - HAIRLINE) / 2);
		const caption = this.captionText;
		if (!caption || caption.width <= 0) {
			draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y, width: this.width, height: HAIRLINE }, fill: color.line_edge });
			return;
		}
		const left = caption.x - CAPTION_GAP;
		const right = caption.x + caption.width + CAPTION_GAP;
		if (left > 0) draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y, width: left, height: HAIRLINE }, fill: color.line_edge });
		if (right < this.width) draw.drawRect({ rect: { x: right, y, width: this.width - right, height: HAIRLINE }, fill: color.line_edge });
	}
}
