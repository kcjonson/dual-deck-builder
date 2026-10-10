import type { Component, Overflow, PointerEvents, ResolvedColors } from '../components/Component';
import type { Sides } from '../components/componentGeometry';
import { Stack, StackOptions } from '../components/Stack';
import { Text } from '../components/Text';
import type { BoxShadow } from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA, Rect } from '../draw/geometry';
import { glowShadow, shadowExtent } from '../style/look';
import {
	StyleAcceptance,
	StyleObject,
	StyleProperty,
	resolveColor,
	resolveLength,
	resolvePadding,
	resolveShadow,
	validateStyle,
} from '../style/styleObject';
import { tokens } from '../theme/tokens';

export type PanelVariant = 'panel' | 'raised' | 'inset';
export type PanelAccent = 'accent' | 'data' | 'none';

/**
 * `stack` lays the children out as a stack (R12.19's content slot, the
 * default); `free` leaves them where they were put, inside the content box,
 * for the hand-placed layouts older screens still have.
 */
export type PanelLayout = 'stack' | 'free';

export interface PanelOptions extends Omit<StackOptions, 'style' | 'padding'> {
	/** The header's title; a header band is drawn only with a title or kicker. */
	title?: string;
	/** A small line above the title: a category, a count, a status. */
	kicker?: string;
	/** Default `panel`. `raised` adds the raised shadow, `inset` is a well. */
	variant?: PanelVariant;
	/** The colour of the corner ticks, the kicker, and the glow. Default `accent`. */
	accent?: PanelAccent;
	/** Bracket ticks at the four corners, straddling the border in the accent colour. */
	corners?: boolean;
	/** A smaller header and content inset. */
	compact?: boolean;
	/** No content inset at all: the content meets the border (a list, a map). */
	flush?: boolean;
	/** The accent's glow around the box. */
	glow?: boolean;
	/** Components laid out right to left at the header's right end. Needs a title or kicker. */
	actions?: Component[];
	/** Default `stack`. */
	layout?: PanelLayout;
	/** R11.14's closed set: box colours, border, radius, shadow, and the content inset (`padding`). */
	style?: StyleObject;
}

const PANEL_STYLE: StyleAcceptance = {
	component: 'Panel',
	properties: new Set<StyleProperty>(['backgroundColor', 'borderColor', 'borderWidth', 'borderRadius', 'opacity', 'padding', 'shadow']),
	states: new Set(),
};

const { color } = tokens;
const CLEAR: RGBA = [0, 0, 0, 0];
/** A corner tick's arm length. */
const TICK = tokens.space.space_2;
const TICK_WIDTH = tokens.borderWidth.bw_thick;
/** A kicker line and a title line: their font sizes times the default line height. */
const KICKER_LINE = Math.round(tokens.fontSize.fs_xs * tokens.lineHeight.lh);
const TITLE_LINE = Math.round(tokens.fontSize.fs_md * tokens.lineHeight.lh);

interface PanelBox {
	fill: RGBA;
	border: RGBA;
	borderWidth: number;
	radius: number;
	shadow: BoxShadow | null;
}

/**
 * R12.19's panel: a box from the theme (`variant`), an optional header band
 * with a kicker, a title, and a slot of actions at its right end, a hairline
 * under the header, bracket ticks at the corners, and a glow; the content is
 * a stack by default (`layout: 'stack'`), inset from the border by the
 * content padding, below the header.
 *
 * The children are exactly what the caller added (R12.18): the kicker and
 * title are the panel's own parts, drawn in its header and never in the
 * flow; the actions are the caller's own components, which the panel takes
 * out of the flow and places in the header. With `layout: 'free'` nothing
 * flows and every child sits at its `position` inside the content box.
 *
 * `pointerEvents` defaults to `auto` so a panel occludes what is beneath it.
 * Scrolling is not the panel's: put a ScrollContainer inside it (R12.20).
 */
export class Panel extends Stack {
	private box: PanelBox;
	private readonly panelVariant: PanelVariant;
	private readonly panelAccent: PanelAccent;
	private readonly showCorners: boolean;
	private readonly showGlow: boolean;
	/** The inset asked for (`flush`, `compact`, or the style's `padding`), before `contentInsetFor` raises it. */
	private readonly requestedPadding: Sides;
	private contentPadding: Sides;
	private readonly headerInset: number;
	private readonly headerHeight: number;
	private readonly kickerText: Text | null;
	private readonly titleText: Text | null;
	private readonly actionItems: readonly Component[];
	private readonly freeLayout: boolean;

	constructor({
		title,
		kicker,
		variant = 'panel',
		accent = 'accent',
		corners = false,
		compact = false,
		flush = false,
		glow = false,
		actions = [],
		layout = 'stack',
		style = {},
		...options
	}: PanelOptions = {}) {
		validateStyle(style, PANEL_STYLE);
		const box = panelBox(variant, style);
		const inset = flush ? 0 : compact ? tokens.space.space_2 : tokens.space.space_4;
		const requested = style.padding !== undefined
			? resolvePadding(style.padding, { top: inset, right: inset, bottom: inset, left: inset })
			: { top: inset, right: inset, bottom: inset, left: inset };
		const contentPadding = contentInsetFor(requested, box, options.overflow === 'hidden');
		const hasHeader = title !== undefined || kicker !== undefined;
		if (actions.length > 0 && !hasHeader) throw new Error('Panel: actions sit in the header, which needs a title or kicker (R12.19)');
		const headerInset = compact ? tokens.space.space_1_5 : tokens.space.space_2;
		const headerHeight = hasHeader
			? headerInset * 2 + (kicker !== undefined ? KICKER_LINE : 0) + (title !== undefined ? TITLE_LINE : 0)
			: 0;
		super({
			...options,
			padding: { ...contentPadding, top: contentPadding.top + headerHeight },
		});
		this.componentType = 'Panel';
		this.panelVariant = variant;
		this.panelAccent = accent;
		this.showCorners = corners;
		this.showGlow = glow;
		this.requestedPadding = requested;
		this.contentPadding = contentPadding;
		this.headerInset = headerInset;
		this.headerHeight = headerHeight;
		this.freeLayout = layout === 'free';
		this.box = box;
		if (style.opacity !== undefined) this.opacity = style.opacity;

		this.kickerText = kicker !== undefined
			? new Text({
				text: kicker,
				style: {
					fontRole: 'mono',
					fontSize: tokens.fontSize.fs_xs,
					color: [...(accent === 'none' ? color.text_dim : this.accentColor)] as [number, number, number, number],
					textTransform: 'uppercase',
					letterSpacing: tokens.letterSpacing.ls_wide,
				},
				wrap: 'none',
				textOverflow: 'ellipsis',
			})
			: null;
		this.titleText = title !== undefined
			? new Text({
				text: title,
				style: {
					fontRole: 'display',
					fontSize: tokens.fontSize.fs_md,
					color: [...color.text_bright] as [number, number, number, number],
					textTransform: 'uppercase',
					letterSpacing: tokens.letterSpacing.ls_wide,
				},
				wrap: 'none',
				textOverflow: 'ellipsis',
			})
			: null;
		if (this.kickerText) this.addPart(this.kickerText);
		if (this.titleText) this.addPart(this.titleText);
		this.actionItems = actions;
		for (const action of actions) this.addChild(action);
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public get variant(): PanelVariant {
		return this.panelVariant;
	}

	public get accent(): PanelAccent {
		return this.panelAccent;
	}

	public get title(): string | null {
		return this.titleText?.text ?? null;
	}

	public set title(title: string | null) {
		if (!this.titleText) throw new Error('Panel: a panel built without a title has no header to put one in');
		this.titleText.text = title ?? '';
	}

	public get kicker(): string | null {
		return this.kickerText?.text ?? null;
	}

	public set kicker(kicker: string | null) {
		if (!this.kickerText) throw new Error('Panel: a panel built without a kicker has no line in its header to put one in');
		this.kickerText.text = kicker ?? '';
	}

	public get actions(): readonly Component[] {
		return this.actionItems;
	}

	/** The content inset from each edge, below the header (the style's `padding`). */
	public get contentInset(): Sides {
		return this.contentPadding;
	}

	/** The header band's height; zero without a title or kicker. */
	public get header(): number {
		return this.headerHeight;
	}

	/** Width available to the content: the box less the content inset on both sides. */
	public get innerWidth(): number {
		return Math.max(this.width - this.contentPadding.left - this.contentPadding.right, 0);
	}

	/** The header's parts and the actions are placed by the panel; in `free` layout nothing flows. */
	public flows(child: Component): boolean {
		if (child.isPart || this.actionItems.includes(child) || this.freeLayout) return false;
		return super.flows(child);
	}

	protected anchorsChild(child: Component): boolean {
		return super.anchorsChild(child) && !this.actionItems.includes(child);
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		this.placeHeader();
	}

	/**
	 * Clipping happens only when `overflow` is `hidden`, at the border's
	 * inner edge with the background's corner concentric inside it: R4.14's
	 * rounded clip, radius `borderRadius - borderWidth` (`clipRadius`), so
	 * content never paints over the border or past the rounded corners
	 * `render` drew first, and the straight edges keep every pixel inside
	 * the border. Decision: docs/AI_TECHNICAL_DECISIONS/component-rounded-clip.md.
	 */
	protected computeClipRect(): Rect {
		const inset = Math.min(this.box.borderWidth, this.width / 2, this.height / 2);
		return { x: inset, y: inset, width: this.width - inset * 2, height: this.height - inset * 2 };
	}

	public get clipRadius(): number {
		return Math.max(this.box.radius - this.clipRect.x, 0);
	}

	/** A clipping panel clears its corners with the rounded clip; one that does not, by inset (R12.19). */
	public get overflow(): Overflow {
		return super.overflow;
	}

	public set overflow(overflow: Overflow) {
		super.overflow = overflow;
		// Component's constructor sets it before this class has its fields.
		if (this.requestedPadding === undefined) return;
		const inset = contentInsetFor(this.requestedPadding, this.box, overflow === 'hidden');
		if (!sameSides(inset, this.contentPadding)) {
			this.contentPadding = inset;
			this.padding = { ...inset, top: inset.top + this.headerHeight };
		}
	}

	/** R8.8: the corner ticks straddle the border; the glow and the raised shadow reach further. */
	public get inkExtent(): number {
		let extent = this.showCorners ? TICK_WIDTH / 2 : 0;
		if (this.box.shadow) extent = Math.max(extent, shadowExtent(this.box.shadow));
		if (this.showGlow) extent = Math.max(extent, shadowExtent(glowShadow(this.glowColor)));
		return extent;
	}

	public get resolvedColors(): ResolvedColors {
		return this.box.borderWidth > 0 ? { fill: this.box.fill, border: this.box.border } : { fill: this.box.fill };
	}

	public render(draw: DrawApi): void {
		const { width, height } = this;
		const box = this.box;
		const radius = box.radius > 0 ? box.radius : undefined;
		const rect = { x: 0, y: 0, width, height };
		const glow = this.showGlow ? glowShadow(this.glowColor) : null;
		// One shadow per rect: a glow on a raised panel gets its own.
		if (glow && box.shadow) draw.drawRect({ rect, fill: CLEAR, radius, shadow: glow });
		draw.drawRect({
			id: this.id ?? undefined,
			rect,
			fill: box.fill,
			radius,
			border: box.borderWidth > 0 ? { color: box.border, width: box.borderWidth } : undefined,
			shadow: box.shadow ?? glow ?? undefined,
		});
		if (this.headerHeight > 0) {
			const hairline = tokens.borderWidth.bw_hair;
			draw.drawRect({
				rect: { x: box.borderWidth, y: this.headerHeight - hairline, width: width - box.borderWidth * 2, height: hairline },
				fill: color.line_hairline,
			});
		}
		if (this.showCorners && this.panelAccent !== 'none') this.drawCorners(draw);
	}

	private get accentColor(): RGBA {
		return this.panelAccent === 'data' ? color.data : color.accent;
	}

	private get glowColor(): RGBA {
		return this.panelAccent === 'data' ? color.data_glow : color.accent_glow;
	}

	/** Four L shapes centred on the border line, each two arms of `TICK` by `TICK_WIDTH`. */
	private drawCorners(draw: DrawApi): void {
		const { width, height } = this;
		const half = this.box.borderWidth / 2;
		const start = half - TICK_WIDTH / 2;
		const fill = this.accentColor;
		const corners: Array<[number, number, 1 | -1, 1 | -1]> = [
			[start, start, 1, 1],
			[width - start, start, -1, 1],
			[width - start, height - start, -1, -1],
			[start, height - start, 1, -1],
		];
		for (const [x, y, dx, dy] of corners) {
			draw.drawRect({ rect: spanRect(x, y, TICK * dx, TICK_WIDTH * dy), fill });
			draw.drawRect({ rect: spanRect(x, y, TICK_WIDTH * dx, TICK * dy), fill });
		}
	}

	/** Kicker over title at the left, actions right to left at the right, all inside the header band. */
	private placeHeader(): void {
		if (this.headerHeight === 0) return;
		const left = Math.max(this.contentPadding.left, tokens.space.space_3);
		const right = Math.max(this.contentPadding.right, tokens.space.space_3);
		let actionsLeft = this.width - right;
		for (let index = this.actionItems.length - 1; index >= 0; index--) {
			const action = this.actionItems[index];
			if (!action.visible) continue;
			actionsLeft -= action.width + action.margin.left + action.margin.right;
			action.setPosition(actionsLeft, Math.round((this.headerHeight - action.bounds.height) / 2));
			actionsLeft -= tokens.space.space_2;
		}
		const textWidth = Math.max(actionsLeft - left, 0);
		let y = this.headerInset;
		if (this.kickerText) {
			this.kickerText.setPosition(left, y);
			this.kickerText.setSize(textWidth, KICKER_LINE);
			y += KICKER_LINE;
		}
		if (this.titleText) {
			this.titleText.setPosition(left, y);
			this.titleText.setSize(textWidth, TITLE_LINE);
		}
	}
}

/** The variant's box from tokens, with the instance style replacing what it names (R11.15). */
function panelBox(variant: PanelVariant, style: StyleObject): PanelBox {
	const fill = variant === 'raised' ? color.bg_panel_raised : variant === 'inset' ? color.bg_inset : color.bg_panel;
	return {
		fill: style.backgroundColor !== undefined ? resolveColor(style.backgroundColor) : fill,
		border: style.borderColor !== undefined ? resolveColor(style.borderColor) : color.line_edge,
		borderWidth: style.borderWidth !== undefined ? resolveLength(style.borderWidth, 'borderWidth') : tokens.borderWidth.bw,
		radius: style.borderRadius !== undefined ? resolveLength(style.borderRadius, 'borderRadius') : tokens.radius.radius_panel,
		shadow: style.shadow !== undefined ? resolveShadow(style.shadow) : variant === 'raised' ? resolveShadow('shadow_raised') : null,
	};
}

/**
 * R12.19: content is inset at least to the border's inner edge, so `flush`
 * and a smaller padding meet the border rather than paint over it. A panel
 * that clips clears its corners with the rounded clip (`clipRadius`) and
 * goes no further; one that does not clip also clears the corner radius,
 * since nothing else keeps a child placed at the edge off the rounded
 * corner.
 */
function contentInsetFor(requested: Sides, box: PanelBox, clips: boolean): Sides {
	const edge = clips ? box.borderWidth : Math.max(box.borderWidth, box.radius);
	return {
		top: Math.max(requested.top, edge),
		right: Math.max(requested.right, edge),
		bottom: Math.max(requested.bottom, edge),
		left: Math.max(requested.left, edge),
	};
}

function sameSides(a: Sides, b: Sides): boolean {
	return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/** A rect from a corner and a signed extent on each axis. */
function spanRect(x: number, y: number, dx: number, dy: number): Rect {
	return { x: Math.min(x, x + dx), y: Math.min(y, y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}
