import type { ComponentOptions, ResolvedColors } from '../components/Component';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { Tone, toneColor } from '../style/variants';
import { tokens } from '../theme/tokens';
import { LabelledLeaf } from './LabelledLeaf';
import { CLEAR, rgba } from './surfaces';

export interface BadgeOptions extends Omit<ComponentOptions, 'style'> {
	label: string;
	/** Default `default`, a neutral chip. `auto` needs a value and is refused. */
	tone?: Tone;
	/** A status dot before the label, in the tone's colour. */
	dot?: boolean;
	/** The tone as a border and text colour rather than a fill. */
	outline?: boolean;
}

export const BADGE_HEIGHT = 18;
const PAD_X = tokens.space.space_1_5;
const DOT = tokens.space.space_1_5;
const DOT_GAP = tokens.space.space_1;
const { color } = tokens;

interface BadgeLook {
	fill: RGBA;
	border: RGBA;
	text: RGBA;
	dot: RGBA;
}

function badgeLook(tone: Tone, outline: boolean): BadgeLook {
	if (tone === 'auto') throw new Error('Badge: tone "auto" bands a value, which a badge does not have (R11.10)');
	if (tone === 'default') {
		return outline
			? { fill: CLEAR, border: color.line_strong, text: color.text_dim, dot: color.text_dim }
			: { fill: color.bg_panel_raised, border: color.line_edge, text: color.text, dot: color.text_dim };
	}
	const tint = toneColor(tone);
	return outline
		? { fill: CLEAR, border: tint, text: tint, dot: tint }
		: { fill: tint, border: tint, text: color.accent_contrast, dot: color.accent_contrast };
}

/**
 * R12.26's badge: a small mono pill sized from its measured label, filled in
 * its tone or outlined in it, with an optional status dot. `measureWidth`
 * is the width it hugs to, for hand layout (a count on a card's corner).
 */
export class Badge extends LabelledLeaf {
	private toneValue: Tone;
	private readonly outline: boolean;
	private readonly dot: boolean;
	private look: BadgeLook;

	constructor({ label, tone = 'default', dot = false, outline = false, ...options }: BadgeOptions) {
		const look = badgeLook(tone, outline);
		super({ ...options, height: options.height ?? BADGE_HEIGHT }, new Text(label, {
			style: {
				fontRole: 'mono',
				fontSize: tokens.fontSize.fs_xs,
				color: rgba(look.text),
				textTransform: 'uppercase',
				letterSpacing: tokens.letterSpacing.ls_wide,
			},
			verticalAlign: 'middle',
			wrap: 'none',
		}));
		this.componentType = 'Badge';
		this.toneValue = tone;
		this.outline = outline;
		this.dot = dot;
		this.look = look;
		this.label.visible = label !== '';
		this.placeLabel();
	}

	public get labelText(): string {
		return this.label.text;
	}

	public set labelText(text: string) {
		this.label.text = text;
		this.label.visible = text !== '';
		this.invalidateLayout();
	}

	public get tone(): Tone {
		return this.toneValue;
	}

	public set tone(tone: Tone) {
		if (tone === this.toneValue) return;
		this.toneValue = tone;
		this.look = badgeLook(tone, this.outline);
		this.label.color = rgba(this.look.text);
	}

	/** The width the badge takes when it hugs its label. */
	public measureWidth(): number {
		return this.hugWidth;
	}

	public get hugWidth(): number {
		const text = this.label.text === '' ? 0 : Math.ceil(this.label.width);
		const dot = this.dot ? DOT + (text > 0 ? DOT_GAP : 0) : 0;
		return Math.max(this.height, dot + text + PAD_X * 2);
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: this.look.fill, border: this.look.border, text: this.look.text };
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: this.look.fill,
			radius: this.height / 2,
			border: { color: this.look.border, width: tokens.borderWidth.bw_hair },
		});
		if (this.dot) {
			draw.drawCircle({ center: { x: this.contentLeft + DOT / 2, y: this.height / 2 }, radius: DOT / 2, fill: this.look.dot });
		}
	}

	/** Where the dot and label start: centred as a group when the badge is wider than it hugs. */
	private get contentLeft(): number {
		return Math.round((this.width - this.hugWidth) / 2) + PAD_X;
	}

	protected placeLabel(): void {
		if (!this.look) return;
		this.label.height = this.height;
		const dot = this.dot && this.label.text !== '' ? DOT + DOT_GAP : 0;
		this.label.setPosition(this.contentLeft + dot, 0);
	}
}
