import { Component, ComponentOptions } from '../../engine/components/Component';
import { Icon } from '../../engine/components/Icon';
import { grownRect } from '../../engine/components/componentGeometry';
import type { Rect } from '../../engine/draw/geometry';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { IconName } from '../../engine/text/icons';
import { resolveFontRole } from '../../engine/text/fontRoles';
import { tokens } from '../../engine/theme/tokens';
import { resolveColor } from '../../engine/style/styleObject';

/**
 * Enemy intent indicator types
 */
export type IntentType = 'attack' | 'defend' | 'repair' | 'special';

export interface EnemyIntent {
	type: IntentType;
	value?: number; // Damage amount, armor gain, etc.
	description: string;
}

export interface IntentMarkerOptions extends ComponentOptions {
	/** The marker's diameter. */
	size: number;
}

const ICON_SCALE = 0.6;
const VALUE_SIZE = 16;
const VALUE_FONT = resolveFontRole({ weight: 'bold' });
const BORDER = resolveColor('#cc6a6a');

const FILLS: Readonly<Record<IntentType, string>> = {
	attack: '#cc4444',
	defend: '#4444cc',
	repair: '#44cc44',
	special: '#cc8844',
};

/** Defend and repair show an icon; attack shows its value and special a "!". */
const ICONS: Readonly<Partial<Record<IntentType, IconName>>> = {
	defend: 'shield',
	repair: 'build',
};

/**
 * An enemy's next action over its plate: a disc in the intent's colour
 * holding the intent's icon or value, centred. Draws its own parts; hidden
 * while there is no intent.
 */
export class IntentMarker extends Component {
	private readonly icon: Icon;
	private current: EnemyIntent | null = null;

	constructor({ size, ...options }: IntentMarkerOptions) {
		super({ ...options, width: size, height: size });
		this.componentType = 'IntentMarker';
		const iconSize = Math.round(size * ICON_SCALE);
		this.icon = new Icon({
			glyph: 'shield',
			size: iconSize,
			tint: tokens.color.text_bright,
			x: (size - iconSize) / 2,
			y: (size - iconSize) / 2,
		});
		this.setVisible(false);
	}

	get intent(): EnemyIntent | null {
		return this.current;
	}

	set intent(intent: EnemyIntent | null) {
		this.current = intent;
		this.setVisible(intent !== null);
		const glyph = intent ? ICONS[intent.type] : undefined;
		if (glyph) this.icon.glyph = glyph;
	}

	/** The text shown in place of an icon, or null when the intent has an icon. */
	get label(): string | null {
		if (!this.current || ICONS[this.current.type]) return null;
		switch (this.current.type) {
			case 'attack':
				return this.current.value ? this.current.value.toString() : '?';
			case 'special':
				return '!';
			default:
				return '?';
		}
	}

	/**
	 * The subtree cull's bound (DDB-184): the disc, grown by two ems of the
	 * value's size, since an unmeasured value centred in the disc can run
	 * past it on both sides.
	 */
	protected get cullInk(): Rect {
		return grownRect(this.inkRect, VALUE_SIZE * 2);
	}

	public render(draw: DrawApi): void {
		if (!this.current) return;

		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: resolveColor(FILLS[this.current.type] ?? '#666666'),
			radius: this.width / 2,
			border: { color: BORDER, width: 2 },
		});

		const label = this.label;
		if (label === null) {
			this.icon.drawGlyph(draw, this.icon.x, this.icon.y);
			return;
		}
		draw.drawText({
			text: label,
			box: { x: 0, y: 0, width: this.width, height: this.height },
			font: VALUE_FONT,
			size: VALUE_SIZE,
			color: tokens.color.text_bright,
			align: 'center',
			verticalAlign: 'middle',
			wrap: 'none',
		});
	}
}
