import type { ComponentOptions, ResolvedColors } from '../components/Component';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import { tokens } from '../theme/tokens';
import { LabelledLeaf } from './LabelledLeaf';
import { rgba } from './surfaces';

export type KeyCapSize = 'sm' | 'md';

export interface KeyCapOptions extends Omit<ComponentOptions, 'style'> {
	/** The key's name as printed on it: `R`, `Esc`, `Shift`. */
	label: string;
	/** `sm` sits in a line of small text (a tooltip's hint), `md` beside a control. Default `sm`. */
	size?: KeyCapSize;
}

interface CapMetrics {
	height: number;
	fontSize: number;
	/** How far the face sits above the base: the extrusion. */
	depth: number;
}

const METRICS: Readonly<Record<KeyCapSize, CapMetrics>> = {
	sm: { height: 18, fontSize: tokens.fontSize.fs_xs, depth: tokens.borderWidth.bw_thick },
	md: { height: 24, fontSize: tokens.fontSize.fs_sm, depth: tokens.borderWidth.bw_thick },
};

const PAD_X = tokens.space.space_1;
const { color } = tokens;

/**
 * R12.29's key cap: a key's name in a small extruded cap, for hotkey hints in
 * tooltips, menus, and tutorials. The face is a raised surface over a darker
 * base that shows `depth` pixels below it; the label is mono, centred on the
 * face.
 *
 * Sized from the measured label and never narrower than it is tall, so `R`
 * is a square and `Shift` a wider cap.
 */
export class KeyCap extends LabelledLeaf {
	private readonly metrics: CapMetrics;

	constructor({ label, size = 'sm', ...options }: KeyCapOptions) {
		const metrics = METRICS[size];
		super({ ...options, height: options.height ?? metrics.height }, new Text(label, {
			style: {
				fontRole: 'mono',
				fontSize: metrics.fontSize,
				color: rgba(color.text),
			},
			verticalAlign: 'middle',
			wrap: 'none',
		}));
		this.componentType = 'KeyCap';
		this.metrics = metrics;
		this.placeLabel();
	}

	public get labelText(): string {
		return this.label.text;
	}

	public set labelText(text: string) {
		this.label.text = text;
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: color.bg_panel_raised, border: color.line_strong, text: color.text };
	}

	public get hugWidth(): number {
		return Math.max(this.height, Math.ceil(this.label.width) + PAD_X * 2);
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		const radius = tokens.radius.r_md;
		const border = { color: color.line_strong, width: tokens.borderWidth.bw_hair };
		draw.drawRect({
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: color.bg_void,
			radius,
			border,
		});
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height - this.metrics.depth },
			fill: color.bg_panel_raised,
			radius,
			border,
		});
	}

	/** Centred on the face, which is the box less the extrusion. */
	protected placeLabel(): void {
		if (!this.metrics) return;
		this.label.height = this.height - this.metrics.depth;
		this.label.setPosition(Math.round((this.width - this.label.width) / 2), 0);
	}
}
