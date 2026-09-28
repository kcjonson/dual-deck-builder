import { Component } from '../components/Component';
import { Text } from '../components/Text';
import type { BoxShadow } from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import { shadowExtent } from '../style/look';
import { tokens } from '../theme/tokens';
import type { TooltipSpec } from './tooltipSpec';

const PADDING_X = tokens.space.space_3;
const PADDING_Y = tokens.space.space_2;
const LINE_GAP = tokens.space.space_1;
const HOTKEY_GAP = tokens.space.space_3;
export const DEFAULT_TOOLTIP_MAX_WIDTH = 280;

const RAISED = tokens.elevation.shadow_raised;
const SURFACE_SHADOW: BoxShadow = {
	color: RAISED.color,
	blur: RAISED.blur,
	spread: RAISED.spread,
	offset: { x: RAISED.offset[0], y: RAISED.offset[1] },
};

/** A token colour as the mutable tuple a style takes. */
function rgba(color: readonly number[]): [number, number, number, number] {
	return [color[0], color[1], color[2], color[3]];
}

/**
 * The tooltip service's own surface for text content: a raised card with a
 * title, an optional key hint, and an optional description wrapped at
 * `maxWidth`. It is the plainest thing that shows R12.22's text content; the
 * catalog's Tooltip (DDB-87) replaces it through the service's `surface`
 * option.
 *
 * Sized from measured text once mounted (`fit`), never from a per-character
 * estimate (R12.22).
 */
export class TooltipSurface extends Component {
	private readonly title: Text | null;
	private readonly hotkey: Text | null;
	private readonly description: Text | null;
	private readonly maxWidth: number;

	constructor({ spec, id }: { spec: TooltipSpec; id?: string }) {
		super({ id: id ?? 'tooltip_surface', pointerEvents: 'none' });
		this.componentType = 'TooltipSurface';
		this.maxWidth = spec.maxWidth ?? DEFAULT_TOOLTIP_MAX_WIDTH;
		this.title = spec.title
			? new Text(spec.title, { id: 'tooltip_title', style: { fontSize: tokens.fontSize.fs_base, fontWeight: 'bold', color: rgba(tokens.color.text_bright) } })
			: null;
		this.hotkey = spec.hotkey
			? new Text(spec.hotkey, { id: 'tooltip_hotkey', style: { fontSize: tokens.fontSize.fs_xs, fontFamily: 'mono', color: rgba(tokens.color.text_faint) } })
			: null;
		this.description = spec.description
			? new Text(spec.description, { id: 'tooltip_description', style: { fontSize: tokens.fontSize.fs_sm, color: rgba(tokens.color.text_dim) } })
			: null;
		for (const text of [this.title, this.hotkey, this.description]) {
			if (text) this.addChild(text);
		}
	}

	/**
	 * Lays the texts out from their measured sizes and sizes the card to
	 * them. Called by the service after mount, when the texts have measured.
	 */
	public fit(): void {
		const contentWidthLimit = this.maxWidth - PADDING_X * 2;
		let y = PADDING_Y;
		let width = 0;

		if (this.title) {
			this.title.setPosition(PADDING_X, y);
			let rowWidth = this.title.width;
			if (this.hotkey) {
				this.hotkey.setPosition(PADDING_X + this.title.width + HOTKEY_GAP, y + (this.title.height - this.hotkey.height) / 2);
				rowWidth += HOTKEY_GAP + this.hotkey.width;
			}
			width = Math.max(width, rowWidth);
			y += this.title.height;
		} else if (this.hotkey) {
			this.hotkey.setPosition(PADDING_X, y);
			width = Math.max(width, this.hotkey.width);
			y += this.hotkey.height;
		}

		if (this.description) {
			// Hugging, it measured one line; past the limit it wraps at it.
			if (this.description.width > contentWidthLimit) this.description.setWidth(contentWidthLimit);
			if (this.title || this.hotkey) y += LINE_GAP;
			this.description.setPosition(PADDING_X, y);
			width = Math.max(width, this.description.width);
			y += this.description.height;
		}

		this.setSize(Math.ceil(width + PADDING_X * 2), Math.ceil(y + PADDING_Y));
	}

	/** R8.8: the raised shadow reaches past the box. */
	public get inkExtent(): number {
		return shadowExtent(SURFACE_SHADOW);
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: tokens.color.bg_panel_raised,
			radius: tokens.radius.radius_ui,
			border: { color: tokens.color.line_edge, width: tokens.borderWidth.bw_hair },
			shadow: SURFACE_SHADOW,
		});
	}
}
