import { Component, ComponentOptions } from '../../engine/components/Component';
import { Icon } from '../../engine/components/Icon';
import { grownRect } from '../../engine/components/componentGeometry';
import type { Rect } from '../../engine/draw/geometry';
import type { DrawApi } from '../../engine/draw/DrawApi';
import { StyleParser } from '../../engine/types/Style';
import { tokens } from '../../engine/theme/tokens';

export interface ArmorBadgeOptions extends ComponentOptions {
	/** The narrowest the badge gets; it grows past this to fit its value. */
	minWidth: number;
	height: number;
}

const ICON_SIZE = 12;
const LEFT_INSET = 3;
const ICON_GAP = 3;
const RIGHT_INSET = 4;
const VALUE_SIZE = 8;
const VALUE_FONT = 'body';

const FILL_ACTIVE = StyleParser.parseColor('#6a6aaa');
const FILL_EMPTY = StyleParser.parseColor('#4a4a4a');
const BORDER = StyleParser.parseColor('#8a8aaa');

/**
 * A vehicle's armor: a shield icon and the armor value, with shield (temporary
 * armor) as "SH" and a second number while there is any. The badge draws its
 * own parts and is as wide as they need, `minWidth` at least, so "10 SH12"
 * never runs onto the icon or out of the badge.
 *
 * The width comes from the value's measured width (R2.14), through the
 * mount context (R1.6), in the layout phase: on the first layout after mount
 * and after every change of value (R8.18).
 */
export class ArmorBadge extends Component {
	private readonly minWidth: number;
	private readonly icon: Icon;
	private armorValue = 0;
	private shieldValue = 0;
	private label = '0';
	private labelWidth = 0;
	/** The label `labelWidth` was measured for; null until the first measure. */
	private measuredLabel: string | null = null;

	constructor({ minWidth, height, ...options }: ArmorBadgeOptions) {
		super({ ...options, width: minWidth, height });
		this.componentType = 'ArmorBadge';
		this.minWidth = minWidth;
		this.icon = new Icon({
			glyph: 'shield',
			size: ICON_SIZE,
			tint: tokens.color.text_bright,
			x: LEFT_INSET,
			y: Math.round((height - ICON_SIZE) / 2),
		});
	}

	get armor(): number {
		return this.armorValue;
	}

	set armor(armor: number) {
		this.armorValue = armor;
		this.updateLabel();
	}

	get shield(): number {
		return this.shieldValue;
	}

	set shield(shield: number) {
		this.shieldValue = shield;
		this.updateLabel();
	}

	/** What the badge reads, "10" or "10 SH12". */
	get text(): string {
		return this.label;
	}

	private updateLabel(): void {
		const label = this.shieldValue > 0 ? `${this.armorValue} SH${this.shieldValue}` : `${this.armorValue}`;
		if (label === this.label) return;
		this.label = label;
		this.invalidateLayout();
	}

	/** It hugs its value, so its size follows the measure: once per value. */
	protected layoutChildren(): void {
		if (this.label !== this.measuredLabel) this.measureLabel();
	}

	private measureLabel(): void {
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText(VALUE_FONT)) return;
		this.labelWidth = draw.measureText({
			text: this.label,
			font: VALUE_FONT,
			size: VALUE_SIZE,
		}).width;
		const contentWidth = Math.ceil(LEFT_INSET + ICON_SIZE + ICON_GAP + this.labelWidth + RIGHT_INSET);
		const width = Math.max(this.minWidth, contentWidth);
		if (width !== this.width) this.setSize(width, this.height);
		this.measuredLabel = this.label;
	}

	/**
	 * The subtree cull's bound (DDB-184): the badge grown by an em of the
	 * icon, the larger of its two glyph sizes, for glyph quads past the box.
	 */
	protected get cullInk(): Rect {
		return grownRect(this.inkRect, ICON_SIZE);
	}

	public render(draw: DrawApi): void {
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: this.armorValue > 0 || this.shieldValue > 0 ? FILL_ACTIVE : FILL_EMPTY,
			border: { color: BORDER, width: 1 },
		});

		this.icon.drawGlyph(draw, this.icon.x, this.icon.y);

		// The value centres in what the icon leaves
		const valueLeft = LEFT_INSET + ICON_SIZE + ICON_GAP;
		draw.drawText({
			text: this.label,
			box: { x: valueLeft, y: 0, width: this.width - valueLeft - RIGHT_INSET, height: this.height },
			font: VALUE_FONT,
			size: VALUE_SIZE,
			color: tokens.color.text_bright,
			align: 'center',
			verticalAlign: 'middle',
			wrap: 'none',
		});
	}
}
