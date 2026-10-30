import { Component, ComponentOptions, ResolvedColors } from '../components/Component';
import type { Axis, Size, SizeMode } from '../components/layoutTypes';
import { Text } from '../components/Text';
import type { TextAlign } from '../draw/commands';
import type { RGBA } from '../draw/geometry';
import { Tone, toneColor } from '../style/variants';
import { tokens } from '../theme/tokens';
import { rgba } from './surfaces';

export type StatSize = 'sm' | 'md' | 'lg';

export interface StatOptions extends Omit<ComponentOptions, 'style'> {
	label: string;
	value: string | number;
	/** Trailing the value at 0.62 of its size, on its baseline: `km`, `%`, `/ 12`. */
	unit?: string;
	/** The value's colour. Default `default`, bright text; `auto` bands a number between 0 and 1. */
	tone?: Tone;
	/** The value's size. Default `md`. */
	size?: StatSize;
	/** Where the label and value line sit across the stat's width. Default `left`. */
	align?: TextAlign;
}

/** R12.28's unit size, as a fraction of the value's. */
export const UNIT_SCALE = 0.62;
const VALUE_SIZE: Readonly<Record<StatSize, number>> = { sm: tokens.fontSize.fs_lg, md: tokens.fontSize.fs_2xl, lg: tokens.fontSize.fs_3xl };
const LABEL_GAP = tokens.space.space_0_5;
const UNIT_GAP = tokens.space.space_1;
const { color } = tokens;

/**
 * R12.28's stat: a small mono label over a large value, with an optional
 * unit trailing the value at 0.62 of its size and sharing its baseline (the
 * baselines come from the measured runs, `TextMetrics.baseline`, so the
 * alignment is the face's and not a guess). Hugs its content; `align` places
 * the two lines across a wider box.
 */
export class Stat extends Component {
	private readonly labelText: Text;
	private readonly valueText: Text;
	private readonly unitText: Text | null;
	private toneValue: Tone;
	private readonly alignment: TextAlign;

	constructor({ label, value, unit, tone = 'default', size = 'md', align = 'left', ...options }: StatOptions) {
		super(options);
		this.componentType = 'Stat';
		this.toneValue = tone;
		this.alignment = align;
		const valueSize = VALUE_SIZE[size];
		this.labelText = new Text({
			text: label,
			style: {
				fontRole: 'mono',
				fontSize: tokens.fontSize.fs_xs,
				color: rgba(color.text_dim),
				textTransform: 'uppercase',
				letterSpacing: tokens.letterSpacing.ls_wide,
			},
			wrap: 'none',
		});
		this.valueText = new Text({
			text: String(value),
			style: { fontRole: 'display', fontSize: valueSize, color: rgba(this.valueColor(value)) },
			wrap: 'none',
		});
		this.unitText = unit !== undefined
			? new Text({
				text: unit,
				style: { fontRole: 'display', fontSize: Math.round(valueSize * UNIT_SCALE), color: rgba(color.text_dim) },
				wrap: 'none',
			})
			: null;
		this.addPart(this.labelText);
		this.addPart(this.valueText);
		if (this.unitText) this.addPart(this.unitText);
	}

	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	public get label(): string {
		return this.labelText.text;
	}

	public get value(): string {
		return this.valueText.text;
	}

	public set value(value: string | number) {
		this.valueText.text = String(value);
		this.valueText.color = rgba(this.valueColor(value));
	}

	public get unit(): string | null {
		return this.unitText?.text ?? null;
	}

	public get tone(): Tone {
		return this.toneValue;
	}

	public set tone(tone: Tone) {
		this.toneValue = tone;
		this.valueText.color = rgba(this.valueColor(this.valueText.text));
	}

	public get resolvedColors(): ResolvedColors {
		return { text: this.valueColor(this.valueText.text) };
	}

	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		const natural = this.natural;
		return {
			width: definite === 'width' ? availableWidth : this.widthMode === 'fixed' ? this.width : natural.width,
			height: definite === 'height' ? availableHeight : this.heightMode === 'fixed' ? this.height : natural.height,
		};
	}

	protected layoutChildren(): void {
		if (!this.parent?.sizesChildren) {
			const natural = this.natural;
			this.resizeInLayout(
				this.widthMode === 'fixed' ? this.width : natural.width,
				this.heightMode === 'fixed' ? this.height : natural.height,
			);
		}
		this.place();
	}

	protected onResized(): void {
		super.onResized();
		if (this.valueText) this.place();
	}

	private valueColor(value: string | number): RGBA {
		if (this.toneValue === 'default') return color.text_bright;
		const numeric = typeof value === 'number' ? value : Number.parseFloat(value);
		return toneColor(this.toneValue, Number.isFinite(numeric) ? numeric : 1);
	}

	private get valueLineWidth(): number {
		const unit = this.unitText;
		return this.valueText.width + (unit ? UNIT_GAP + unit.width : 0);
	}

	private get natural(): Size {
		return {
			width: Math.ceil(Math.max(this.labelText.width, this.valueLineWidth)),
			height: Math.ceil(this.labelText.height + LABEL_GAP + this.valueText.height),
		};
	}

	private lineX(width: number): number {
		if (this.alignment === 'center') return Math.round((this.width - width) / 2);
		if (this.alignment === 'right') return Math.round(this.width - width);
		return 0;
	}

	/** The label on top; the value under it, the unit on the value's baseline. */
	private place(): void {
		this.labelText.setPosition(this.lineX(this.labelText.width), 0);
		const valueY = this.labelText.height + LABEL_GAP;
		const valueX = this.lineX(this.valueLineWidth);
		this.valueText.setPosition(valueX, valueY);
		const unit = this.unitText;
		if (!unit) return;
		const valueBaseline = this.valueText.measured?.baseline ?? this.valueText.height;
		const unitBaseline = unit.measured?.baseline ?? unit.height;
		unit.setPosition(valueX + this.valueText.width + UNIT_GAP, valueY + valueBaseline - unitBaseline);
	}
}
