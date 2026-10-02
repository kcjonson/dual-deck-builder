import type { PointerEvents, ResolvedColors } from '../components/Component';
import { Stack } from '../components/Stack';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect } from '../draw/geometry';
import { shadowExtent } from '../style/look';
import type { TooltipSpec } from '../services/tooltipSpec';
import { tokens } from '../theme/tokens';
import { KeyCap } from './KeyCap';
import { SHADOW_RAISED, borderClipRadius, borderClipRect, rgba } from './surfaces';

export const DEFAULT_TOOLTIP_MAX_WIDTH = 280;

const PADDING_X = tokens.space.space_3;
const PADDING_Y = tokens.space.space_2;
const RADIUS = tokens.radius.radius_ui;
const BORDER_WIDTH = tokens.borderWidth.bw_hair;
const { color } = tokens;

export interface TooltipOptions {
	/** The text content (R12.22): a title, a description, and a key hint. A factory is the service's business, not this surface's. */
	spec: TooltipSpec;
	id?: string;
}

/**
 * R12.22's tooltip surface for text content: a raised card with the title
 * and its key hint on one line, as a KeyCap (R12.29), and the description
 * under them, wrapped at `maxWidth`. The tooltip service mounts one per
 * showing through its `surface` option and lays it out before placing it,
 * so its size is the measured text's, never an estimate.
 *
 * A column stack with the row and the description as parts: it hugs its
 * content up to `maxWidth` and a long description wraps inside that. It
 * never takes input (`pointerEvents: none`). When the service shrinks it to
 * the room, it clips at the border's inner edge with a rounded clip (R4.14).
 */
export class Tooltip extends Stack {
	private readonly titleText: Text | null;
	private readonly hotkeyCap: KeyCap | null;
	private readonly descriptionText: Text | null;

	constructor({ spec, id }: TooltipOptions) {
		const maxWidth = spec.maxWidth ?? DEFAULT_TOOLTIP_MAX_WIDTH;
		super({
			id: id ?? 'tooltip',
			pointerEvents: 'none',
			direction: 'vertical',
			gap: tokens.space.space_1,
			padding: { top: PADDING_Y, right: PADDING_X, bottom: PADDING_Y, left: PADDING_X },
			maxSize: { width: maxWidth },
		});
		this.componentType = 'Tooltip';

		this.titleText = spec.title
			? new Text(spec.title, {
				id: 'tooltip_title',
				style: { fontRole: 'display', fontSize: tokens.fontSize.fs_base, color: rgba(color.text_bright) },
				wrap: 'none',
			})
			: null;
		this.hotkeyCap = spec.hotkey ? new KeyCap({ id: 'tooltip_hotkey', label: spec.hotkey }) : null;
		if (this.titleText || this.hotkeyCap) {
			const row = new Stack({ id: 'tooltip_heading', direction: 'horizontal', gap: tokens.space.space_3, crossAlign: 'center' });
			if (this.titleText) row.addPart(this.titleText);
			if (this.hotkeyCap) row.addPart(this.hotkeyCap);
			this.addPart(row);
		}

		this.descriptionText = spec.description
			? new Text(spec.description, {
				id: 'tooltip_description',
				// The stack measures its own hug width unconstrained and then
				// clamps it; the text's own limit is what makes it wrap.
				maxSize: { width: maxWidth - PADDING_X * 2 },
				style: { fontSize: tokens.fontSize.fs_sm, color: rgba(color.text_dim) },
			})
			: null;
		if (this.descriptionText) this.addPart(this.descriptionText);
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'none';
	}

	public get title(): string | null {
		return this.titleText?.text ?? null;
	}

	public get description(): string | null {
		return this.descriptionText?.text ?? null;
	}

	public get hotkey(): string | null {
		return this.hotkeyCap?.labelText ?? null;
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: color.bg_panel_raised, border: color.line_edge };
	}

	/** R8.8: the raised shadow reaches past the box. */
	public get inkExtent(): number {
		return shadowExtent(SHADOW_RAISED);
	}

	protected computeClipRect(): Rect {
		return borderClipRect(this.width, this.height, BORDER_WIDTH);
	}

	public get clipRadius(): number {
		return borderClipRadius(RADIUS, this.clipRect);
	}

	public render(draw: DrawApi): void {
		if (this.width <= 0 || this.height <= 0) return;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: color.bg_panel_raised,
			radius: RADIUS,
			border: { color: color.line_edge, width: BORDER_WIDTH },
			shadow: SHADOW_RAISED,
		});
	}
}
