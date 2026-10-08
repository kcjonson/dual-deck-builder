import { Component, ComponentOptions, Cursor, PointerEvents, ResolvedColors } from '../components/Component';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import type { AnyUiEvent, UiKeyEvent, UiPointerEvent } from '../input/events';
import { glowShadow, shadowExtent } from '../style/look';
import { CONTROL_SIZES, ControlSize } from '../style/variants';
import { tokens } from '../theme/tokens';
import { StepRange, snapToStep } from './stepGrid';

export interface SliderRange extends StepRange {
	readonly logScale: boolean;
}

/** Logarithmic only with positive bounds; anything else falls back to linear (R12.15). */
function isLogarithmic({ min, max, logScale }: SliderRange): boolean {
	return logScale && min > 0 && max > 0;
}

/**
 * R12.15's normative math: position `t` in [0, 1] to a value,
 * `min * (max / min) ^ t` when logarithmic, linear otherwise. A range with
 * `max <= min` is `min` everywhere.
 */
export function positionToValue(range: SliderRange, t: number): number {
	const { min, max } = range;
	if (!(max > min)) return min;
	const clamped = Math.min(Math.max(t, 0), 1);
	if (isLogarithmic(range)) return min * Math.pow(max / min, clamped);
	return min + clamped * (max - min);
}

/** The inverse, clamped to [0, 1]; never NaN, whatever the bounds or the value. */
export function valueToPosition(range: SliderRange, value: number): number {
	const { min, max } = range;
	if (!(max > min) || !Number.isFinite(value)) return 0;
	let t: number;
	if (isLogarithmic(range)) t = value <= 0 ? 0 : Math.log(value / min) / Math.log(max / min);
	else t = (value - min) / (max - min);
	return Math.min(Math.max(t, 0), 1);
}

export interface SliderOptions extends Omit<ComponentOptions, 'style'> {
	min?: number;
	max?: number;
	/** 0 (the default) is continuous. */
	step?: number;
	value?: number;
	logScale?: boolean;
	/** A name drawn in a column at the left; with it, the formatted value shows in a column at the right. */
	label?: string;
	valueFormatter?: ((value: number) => string) | null;
	/**
	 * Fixed widths for the label and value columns, so stacked sliders line
	 * their tracks up. Absent, the label column is the measured label (at most
	 * 40% of the width) and the value column the widest of the formatted min,
	 * midpoint, and max.
	 */
	labelWidth?: number | null;
	valueWidth?: number | null;
	/** A snap tick's normalised position along the track, 0 to 1; drawn, not snapped to. Null for none. */
	detent?: number | null;
	disabled?: boolean;
	/** R11.10: the row height. */
	size?: ControlSize;
	/** A user change, with the value already applied; never fired by setting `value`. */
	onChange?: ((value: number) => void) | null;
}

const DEFAULT_WIDTH = 240;
/** Keyboard step for a continuous slider, as a fraction of the track (R12.15). */
const FINE_STEP = 0.01;
const TRACK_HEIGHT = tokens.space.space_1;
const THUMB_SIZE = tokens.control.icon_sm;
/** A press this close to the thumb's centre grabs it rather than jumping. */
const THUMB_HIT_RADIUS = THUMB_SIZE / 2 + tokens.space.space_1;
const COLUMN_GAP = tokens.space.space_1_5;
const LABEL_SIZE = tokens.fontSize.fs_sm;
/** The most of the width a label column takes. */
const LABEL_SHARE = 0.4;
const THUMB_GLOW = glowShadow(tokens.color.accent_glow);
const DETENT_COLOR: RGBA = [tokens.color.data[0], tokens.color.data[1], tokens.color.data[2], 0.7];

/**
 * R12.15's slider: a pill track with the filled portion up to a thumb, an
 * optional detent tick, and with a `label` a name column at the left and
 * the formatted value at the right.
 *
 * - A press within the thumb's hit radius grabs it (keeping where on the
 *   thumb it was grabbed); a press elsewhere on the track jumps there. Either
 *   way the pointer is captured and the drag follows it off the slider.
 * - Left steps down and Right steps up, by `step` or 1% of the track, and
 *   are consumed at the ends too, so a held key never runs off the slider;
 *   Home and End go to the ends. Up and Down cross the track, so they go
 *   unconsumed to directional focus and a column of sliders is walked with
 *   them (R9.24).
 * - `value` set programmatically is clamped and snapped silently; a user
 *   change fires `onChange` once with the value applied, and never for a
 *   value that did not move; a `value` set from inside `onChange` stands
 *   (R8.25).
 */
export class Slider extends Component {
	public onChange: ((value: number) => void) | null;

	private range: SliderRange;
	private current: number;
	private labelText: string;
	private formatter: ((value: number) => string) | null;
	private fixedLabelWidth: number | null;
	private fixedValueWidth: number | null;
	private detentAt: number | null;
	private readonly sliderSize: ControlSize;
	/** A drag in progress, and where on the thumb it was grabbed. */
	private dragging = false;
	private grabOffset = 0;
	/** The formatted value and the measured column texts, kept until what they depend on changes; null when stale. */
	private formattedText: string | null = null;
	private labelTextWidth: number | null = null;
	private valueTextWidth: number | null = null;

	constructor({
		min = 0,
		max = 1,
		step = 0,
		value,
		logScale = false,
		label = '',
		valueFormatter = null,
		labelWidth = null,
		valueWidth = null,
		detent = null,
		disabled = false,
		size = 'md',
		onChange = null,
		...options
	}: SliderOptions = {}) {
		super({
			focusable: true,
			...(disabled ? { enabled: false } : {}),
			...options,
			width: options.width ?? DEFAULT_WIDTH,
			height: options.height ?? CONTROL_SIZES[size].height,
		});
		this.componentType = 'Slider';
		this.range = { min, max, step, logScale };
		this.current = snapToStep(this.range, value ?? min);
		this.labelText = label;
		this.formatter = valueFormatter;
		this.fixedLabelWidth = labelWidth;
		this.fixedValueWidth = valueWidth;
		this.detentAt = detent;
		this.sliderSize = size;
		this.onChange = onChange;
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	protected get defaultCursor(): Cursor | null {
		return 'pointer';
	}

	public get handlesPointer(): boolean {
		return true;
	}

	public get value(): number {
		return this.current;
	}

	/** Programmatic: clamped and snapped, never fires `onChange`. */
	public set value(value: number) {
		this.apply(snapToStep(this.range, value));
	}

	public get min(): number {
		return this.range.min;
	}

	public get max(): number {
		return this.range.max;
	}

	public get step(): number {
		return this.range.step;
	}

	public get logScale(): boolean {
		return this.range.logScale;
	}

	/** New bounds, step, or scale; the value is clamped and snapped to them silently. */
	public setRange({ min = this.range.min, max = this.range.max, step = this.range.step, logScale = this.range.logScale }: Partial<SliderRange>): void {
		this.range = { min, max, step, logScale };
		this.valueTextWidth = null;
		this.apply(snapToStep(this.range, this.current));
	}

	public get label(): string {
		return this.labelText;
	}

	public set label(label: string) {
		this.labelText = label;
		this.labelTextWidth = null;
		this.valueTextWidth = null;
	}

	public get valueFormatter(): ((value: number) => string) | null {
		return this.formatter;
	}

	public set valueFormatter(formatter: ((value: number) => string) | null) {
		this.formatter = formatter;
		this.formattedText = null;
		this.valueTextWidth = null;
	}

	public get labelWidth(): number | null {
		return this.fixedLabelWidth;
	}

	public set labelWidth(width: number | null) {
		this.fixedLabelWidth = width;
	}

	public get valueWidth(): number | null {
		return this.fixedValueWidth;
	}

	public set valueWidth(width: number | null) {
		this.fixedValueWidth = width;
	}

	public get detent(): number | null {
		return this.detentAt;
	}

	public set detent(detent: number | null) {
		this.detentAt = detent;
	}

	public get size(): ControlSize {
		return this.sliderSize;
	}

	/** The thumb's centre, in the slider's box. */
	public get thumbX(): number {
		const { left, right } = this.track;
		return left + valueToPosition(this.range, this.current) * (right - left);
	}

	/** Where the track runs, in the slider's box: inside the label and value columns, inset by the thumb's radius. */
	public get track(): { left: number; right: number; y: number } {
		const radius = THUMB_SIZE / 2;
		const left = (this.labelText ? this.labelColumn + COLUMN_GAP : 0) + radius;
		const right = this.width - (this.labelText ? this.valueColumn + COLUMN_GAP : 0) - radius;
		return { left, right: Math.max(left, right), y: this.height / 2 };
	}

	/** Its label and formatted value, when it draws them (the text record, DDB-206). */
	public get drawnText(): readonly string[] | null {
		if (!this.labelText) return null;
		const value = this.formattedValue;
		return value ? [this.labelText, value] : [this.labelText];
	}

	/** R8.8: the thumb's glow. */
	public get inkExtent(): number {
		return shadowExtent(THUMB_GLOW);
	}

	public get resolvedColors(): ResolvedColors {
		return {
			fill: this.effectivelyEnabled ? tokens.color.accent : tokens.color.text_faint,
			border: tokens.color.line_hairline,
			text: this.effectivelyEnabled ? tokens.color.text_dim : tokens.color.text_disabled,
		};
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'pointerdown':
				this.pointerDown(event);
				return;
			case 'pointermove':
				if (!this.dragging) return;
				event.consume();
				this.dragTo(event);
				return;
			case 'pointerup':
			case 'pointercancel':
			case 'lostpointercapture':
				if (!this.dragging) return;
				this.dragging = false;
				this.pressed = false;
				return;
			case 'keydown':
				if (this.handleKey(event)) event.consume();
				return;
		}
	}

	protected onMount(): void {
		this.labelTextWidth = null;
		this.valueTextWidth = null;
	}

	protected onUnmount(): void {
		this.dragging = false;
	}

	/** Disabling mid-drag ends the drag for good (R9.5). */
	protected onStateChange(): void {
		if (this.dragging && !this.effectivelyEnabled) {
			this.dragging = false;
			this.pressed = false;
		}
	}

	public render(draw: DrawApi): void {
		const enabled = this.effectivelyEnabled;
		const { color } = tokens;
		const { left, right, y } = this.track;
		if (this.labelText) {
			draw.drawText({
				text: this.labelText,
				box: { x: 0, y: 0, width: this.labelColumn, height: this.height },
				font: 'mono',
				size: LABEL_SIZE,
				letterSpacing: tokens.letterSpacing.ls_wider,
				textTransform: 'uppercase',
				color: enabled ? color.text_dim : color.text_disabled,
				align: 'left',
				verticalAlign: 'middle',
				wrap: 'none',
				overflow: 'ellipsis',
			});
			const valueText = this.formattedValue;
			if (valueText) {
				draw.drawText({
					text: valueText,
					box: { x: this.width - this.valueColumn, y: 0, width: this.valueColumn, height: this.height },
					font: 'mono',
					size: LABEL_SIZE,
					color: enabled ? color.accent_bright : color.text_disabled,
					align: 'right',
					verticalAlign: 'middle',
					wrap: 'none',
				});
			}
		}

		const radius = TRACK_HEIGHT / 2;
		const trackTop = y - radius;
		const radiusThumb = THUMB_SIZE / 2;
		// The pill runs under the thumb's whole travel, ends included.
		const pill = { x: left - radiusThumb, y: trackTop, width: right - left + THUMB_SIZE, height: TRACK_HEIGHT };
		draw.drawRect({
			id: this.id ?? undefined,
			rect: pill,
			fill: color.bg_inset,
			radius,
			border: { color: color.line_hairline, width: tokens.borderWidth.bw },
		});
		const thumbX = this.thumbX;
		const filled = thumbX - pill.x;
		if (filled > 0) draw.drawRect({ rect: { x: pill.x, y: trackTop, width: filled, height: TRACK_HEIGHT }, fill: enabled ? color.accent : color.text_faint, radius });

		if (this.detentAt !== null) {
			const at = Math.min(Math.max(this.detentAt, 0), 1);
			const tickWidth = tokens.borderWidth.bw_thick;
			const inset = tokens.space.space_0_5;
			draw.drawRect({
				rect: { x: left + at * (right - left) - tickWidth / 2, y: y - radiusThumb + inset, width: tickWidth, height: THUMB_SIZE - inset * 2 },
				fill: enabled ? DETENT_COLOR : color.text_disabled,
			});
		}

		const active = enabled && (this.hovered || this.dragging);
		draw.drawRect({
			rect: { x: thumbX - radiusThumb, y: y - radiusThumb, width: THUMB_SIZE, height: THUMB_SIZE },
			fill: !enabled ? color.text_dim : active ? color.text_bright : color.accent_bright,
			radius: tokens.radius.r_sm,
			border: { color: color.bg_void, width: tokens.borderWidth.bw },
			shadow: enabled ? THUMB_GLOW : undefined,
		});
	}

	private pointerDown(event: UiPointerEvent): void {
		if (event.button !== 0 || !this.effectivelyEnabled) return;
		const local = event.local;
		if (!local) return;
		const offset = local.x - this.thumbX;
		const grab = Math.abs(offset) <= THUMB_HIT_RADIUS;
		const { left, right } = this.track;
		// The label and value columns are not track: a press there only focuses.
		if (!grab && (local.x < left - THUMB_SIZE / 2 || local.x > right + THUMB_SIZE / 2)) return;
		event.consume();
		event.capturePointer();
		this.dragging = true;
		this.pressed = true;
		this.grabOffset = grab ? offset : 0;
		if (!grab) this.userSet(this.valueAtX(local.x));
	}

	private dragTo(event: UiPointerEvent): void {
		const local = event.local;
		if (!local || !this.effectivelyEnabled) return;
		this.userSet(this.valueAtX(local.x - this.grabOffset));
	}

	private handleKey(event: UiKeyEvent): boolean {
		const { modifiers } = event;
		if (!this.effectivelyEnabled || modifiers.ctrl || modifiers.meta || modifiers.alt) return false;
		switch (event.key) {
			case 'ArrowLeft':
				this.stepBy(-1);
				return true;
			case 'ArrowRight':
				this.stepBy(1);
				return true;
			case 'Home':
				this.userSet(this.range.min);
				return true;
			case 'End':
				this.userSet(this.range.max);
				return true;
		}
		return false;
	}

	/** One keyboard step: `step`, or 1% of the track (in position, so a log slider moves evenly). */
	private stepBy(direction: 1 | -1): void {
		if (this.range.step > 0) {
			this.userSet(this.current + direction * this.range.step);
			return;
		}
		const t = valueToPosition(this.range, this.current) + direction * FINE_STEP;
		this.userSet(positionToValue(this.range, t));
	}

	private valueAtX(x: number): number {
		const { left, right } = this.track;
		if (right <= left) return this.range.min;
		return positionToValue(this.range, (x - left) / (right - left));
	}

	/** A user change: snapped and clamped, applied, then `onChange` once when it moved. */
	private userSet(value: number): void {
		const next = snapToStep(this.range, value);
		if (next === this.current) return;
		this.apply(next);
		this.onChange?.(next);
	}

	private apply(value: number): void {
		if (value === this.current) return;
		this.current = value;
		this.formattedText = null;
	}

	private get formattedValue(): string {
		if (!this.formatter) return '';
		this.formattedText ??= this.formatter(this.current);
		return this.formattedText;
	}

	/** The label column: `labelWidth`, or the measured label, at most `LABEL_SHARE` of the width (a longer one ellipsises). */
	private get labelColumn(): number {
		if (!this.labelText) return 0;
		if (this.fixedLabelWidth !== null) return this.fixedLabelWidth;
		if (this.labelTextWidth === null) this.labelTextWidth = this.textWidth(this.labelText, true);
		return Math.min(this.labelTextWidth ?? 0, Math.floor(this.width * LABEL_SHARE));
	}

	/**
	 * The value column: `valueWidth`, or the widest of the formatted min,
	 * midpoint, and max, measured once per range, formatter, and label rather
	 * than per value, so the track never moves under a drag.
	 */
	private get valueColumn(): number {
		if (!this.labelText || !this.formatter) return 0;
		if (this.fixedValueWidth !== null) return this.fixedValueWidth;
		if (this.valueTextWidth === null) {
			let widest: number | null = 0;
			for (const t of [0, 0.5, 1]) {
				const width = this.textWidth(this.formatter(positionToValue(this.range, t)), false);
				widest = width === null || widest === null ? null : Math.max(widest, width);
			}
			this.valueTextWidth = widest;
		}
		return this.valueTextWidth ?? 0;
	}

	/** Null while nothing can measure, so the column is measured again once something can. */
	private textWidth(text: string, label: boolean): number | null {
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText('mono')) return null;
		return Math.ceil(draw.measureText({
			text,
			font: 'mono',
			size: LABEL_SIZE,
			letterSpacing: label ? tokens.letterSpacing.ls_wider : 0,
			textTransform: label ? 'uppercase' : 'none',
			wrap: 'none',
		}).width);
	}
}
