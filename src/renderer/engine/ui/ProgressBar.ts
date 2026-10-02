import type { TweenHandle } from '../animation/Animator';
import { Component, ComponentOptions, ResolvedColors } from '../components/Component';
import type { Axis, Size, SizeMode } from '../components/layoutTypes';
import type { MountContext } from '../components/MountContext';
import { Text } from '../components/Text';
import type { TextShadow } from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { Tone, toneColor } from '../style/variants';
import { tokens } from '../theme/tokens';
import { rgba } from './surfaces';

export type MeterSize = 'sm' | 'md' | 'lg';

/** What the value line says: fixed text, or a formatter of the value. */
export type MeterValueText = string | ((value: number) => string);

export interface ProgressBarOptions extends Omit<ComponentOptions, 'style' | 'height'> {
	/** 0 to 1; clamped. */
	value?: number;
	/** Default `auto`: critical, warning, or ok by the value's band (R11.10). */
	tone?: Tone;
	/** Left above the track, or inside it when `inline`. */
	label?: string;
	/** Right above the track, or inside it when `inline`. */
	valueText?: MeterValueText;
	/** The track's thickness. Default `md`. */
	size?: MeterSize;
	/** Draws the track as this many equal cells (fuel, a shield's pips); 0 or 1 is continuous. */
	segmented?: number;
	/** Label and value drawn inside a taller track, over the fill, with a dark text shadow. */
	inline?: boolean;
}

const TRACK_HEIGHT: Readonly<Record<MeterSize, number>> = { sm: 4, md: 8, lg: 12 };
const INLINE_HEIGHT: Readonly<Record<MeterSize, number>> = { sm: 18, md: 22, lg: 28 };
const DEFAULT_WIDTH = 200;
const LABEL_GAP = tokens.space.space_1;
const SEGMENT_GAP = tokens.space.space_0_5;
const INLINE_INSET = tokens.space.space_2;
const { color } = tokens;
const TEXT_SHADOW: TextShadow = {
	color: tokens.elevation.text_shadow.color,
	offset: { x: tokens.elevation.text_shadow.offset[0], y: tokens.elevation.text_shadow.offset[1] },
	blur: tokens.elevation.text_shadow.blur,
};

function clamp01(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * R12.24's meter: a pill track filled to `value`, with an optional label and
 * value line above it or, `inline`, inside it over the fill. The fill moves
 * to a new value over `dur_slow` through the animator; a value set while
 * unmounted, or under reduced motion, is shown at once. `segmented` cuts the
 * track into cells, each filled in turn.
 *
 * Width is the caller's (200 by default, or `widthMode: 'fill'` in a stack);
 * the height follows the size and whether there is a label line.
 */
export class ProgressBar extends Component {
	private target: number;
	private shown: number;
	private toneValue: Tone;
	private readonly sizeValue: MeterSize;
	private readonly segments: number;
	private readonly inline: boolean;
	private valueFormat: MeterValueText | null;
	private readonly labelText: Text | null;
	private valueLabel: Text | null = null;
	private fill: TweenHandle<number> | null = null;

	constructor({ value = 0, tone = 'auto', label, valueText, size = 'md', segmented = 0, inline = false, ...options }: ProgressBarOptions = {}) {
		super({ ...options, width: options.width ?? DEFAULT_WIDTH });
		this.componentType = 'ProgressBar';
		this.target = clamp01(value);
		this.shown = this.target;
		this.toneValue = tone;
		this.sizeValue = size;
		this.segments = Math.max(0, Math.floor(segmented));
		this.inline = inline;
		this.valueFormat = valueText ?? null;

		const textColor = rgba(inline ? color.text_bright : color.text_dim);
		this.labelText = label !== undefined
			? new Text(label, {
				style: { fontSize: tokens.fontSize.fs_sm, color: textColor },
				wrap: 'none',
				verticalAlign: 'middle',
			})
			: null;
		if (this.labelText) {
			if (inline) this.labelText.shadow = TEXT_SHADOW;
			this.addPart(this.labelText);
		}
		if (valueText !== undefined) this.addValueLabel();
		this.formatValue();
		this.place();
	}

	/** The height is the track's, plus the label line when it is above it. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	public get value(): number {
		return this.target;
	}

	/** Programmatic: the fill heads for it over `dur_slow`. */
	public set value(value: number) {
		const next = clamp01(value);
		if (next === this.target) return;
		this.target = next;
		this.formatValue();
		const animator = this.context?.animator;
		if (!animator) {
			this.fill?.cancel();
			this.fill = null;
			this.shown = next;
			this.invalidateInk();
			return;
		}
		if (this.fill?.running) {
			this.fill.retarget(next);
			return;
		}
		this.fill = animator.tween({
			from: this.shown,
			to: next,
			duration: tokens.motion.dur_slow,
			owner: this,
			onUpdate: (shown) => {
				this.shown = shown;
			},
		});
	}

	/** An unmount cancels the fill where it was (R8.15); mounting again shows the target. */
	protected onMount(context: MountContext): void {
		super.onMount(context);
		this.fill = null;
		if (this.shown !== this.target) {
			this.shown = this.target;
			this.invalidateInk();
		}
	}

	/** Where the fill is now, mid-animation included. */
	public get displayedValue(): number {
		return this.shown;
	}

	public get tone(): Tone {
		return this.toneValue;
	}

	public set tone(tone: Tone) {
		this.toneValue = tone;
	}

	public get valueText(): MeterValueText | null {
		return this.valueFormat;
	}

	/** A bar built without a value line gains one; null hides it again. */
	public set valueText(valueText: MeterValueText | null) {
		this.valueFormat = valueText;
		if (valueText !== null && !this.valueLabel) this.addValueLabel();
		if (this.valueLabel) this.valueLabel.visible = valueText !== null;
		this.formatValue();
		this.invalidateLayout();
	}

	/** The fill's colour now: the tone, banded by the target value when `auto`. */
	public get fillColor(): RGBA {
		return toneColor(this.toneValue, this.target);
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: this.fillColor, border: color.line_edge };
	}

	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		return {
			width: definite === 'width' ? availableWidth : this.widthMode === 'fixed' ? this.width : DEFAULT_WIDTH,
			height: definite === 'height' ? availableHeight : this.heightMode === 'fixed' ? this.height : this.naturalHeight,
		};
	}

	protected layoutChildren(): void {
		if (this.heightMode !== 'fixed' && !this.parent?.sizesChildren) this.resizeInLayout(this.width, this.naturalHeight);
		this.place();
	}

	protected onResized(): void {
		super.onResized();
		if (this.sizeValue) this.place();
	}

	public render(draw: DrawApi): void {
		const track = this.trackRect;
		if (track.width <= 0 || track.height <= 0) return;
		const radius = track.height / 2;
		const fill = this.fillColor;
		if (this.segments <= 1) {
			draw.drawRect({ id: this.id ?? undefined, rect: track, fill: color.bg_inset, radius, border: { color: color.line_edge, width: tokens.borderWidth.bw_hair } });
			const width = track.width * this.shown;
			if (width > 0) draw.drawRect({ rect: { ...track, width: Math.max(width, Math.min(track.height, track.width)) }, fill, radius });
			return;
		}
		const cell = (track.width - SEGMENT_GAP * (this.segments - 1)) / this.segments;
		const cellRadius = Math.min(tokens.radius.r_sm, track.height / 2);
		const filled = this.shown * this.segments;
		for (let index = 0; index < this.segments; index += 1) {
			const rect = { x: track.x + index * (cell + SEGMENT_GAP), y: track.y, width: cell, height: track.height };
			draw.drawRect({ id: index === 0 ? this.id ?? undefined : undefined, rect, fill: color.bg_inset, radius: cellRadius });
			const share = Math.min(1, Math.max(0, filled - index));
			if (share > 0) draw.drawRect({ rect: { ...rect, width: cell * share }, fill, radius: cellRadius });
		}
	}

	private get lineHeight(): number {
		if (this.inline) return 0;
		const heights = [this.labelText, this.valueLabel].map((text) => (text?.visible ? text.height : 0));
		return Math.max(0, ...heights);
	}

	private get naturalHeight(): number {
		if (this.inline) return INLINE_HEIGHT[this.sizeValue];
		const line = this.lineHeight;
		return (line > 0 ? line + LABEL_GAP : 0) + TRACK_HEIGHT[this.sizeValue];
	}

	private get trackRect(): { x: number; y: number; width: number; height: number } {
		if (this.inline) return { x: 0, y: 0, width: this.width, height: this.height };
		const height = TRACK_HEIGHT[this.sizeValue];
		return { x: 0, y: this.height - height, width: this.width, height };
	}

	private addValueLabel(): void {
		const label = new Text('', {
			style: { fontRole: 'mono', fontSize: tokens.fontSize.fs_sm, color: rgba(this.inline ? color.text_bright : color.text) },
			wrap: 'none',
			verticalAlign: 'middle',
		});
		if (this.inline) label.shadow = TEXT_SHADOW;
		this.valueLabel = label;
		this.addPart(label);
	}

	private formatValue(): void {
		if (!this.valueLabel) return;
		const format = this.valueFormat;
		this.valueLabel.setText(typeof format === 'function' ? format(this.target) : format ?? '');
	}

	/** Label left and value right, on the line above the track or inside it. */
	private place(): void {
		const inset = this.inline ? INLINE_INSET : 0;
		const lineY = 0;
		const lineHeight = this.inline ? this.height : this.lineHeight;
		const valueWidth = this.valueLabel ? this.valueLabel.width : 0;
		if (this.valueLabel) {
			this.valueLabel.setHeight(lineHeight);
			this.valueLabel.setPosition(Math.round(this.width - inset - valueWidth), lineY);
		}
		if (this.labelText) {
			this.labelText.setHeight(lineHeight);
			this.labelText.setPosition(inset, lineY);
		}
	}
}
