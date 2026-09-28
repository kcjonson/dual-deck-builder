import type { BoxShadow } from '../draw/commands';
import type { RGBA } from '../draw/geometry';
import { tokens } from '../theme/tokens';

/**
 * R11.11's flags. `hovered`, `pressed`, `focused`, `focusVisible`, and
 * `enabled` are the framework's; `selected`, `open`, `active`, and
 * `dropActive` belong to the component. They compose: there is no single
 * winning state.
 */
export interface StateFlags {
	hovered: boolean;
	pressed: boolean;
	focused: boolean;
	focusVisible: boolean;
	enabled: boolean;
	selected: boolean;
	open: boolean;
	active: boolean;
	dropActive: boolean;
}

export const RESTING_FLAGS: Readonly<StateFlags> = {
	hovered: false,
	pressed: false,
	focused: false,
	focusVisible: false,
	enabled: true,
	selected: false,
	open: false,
	active: false,
	dropActive: false,
};

/** What a control draws with, after every layer. Render reads it; nothing else decides a colour. */
export interface Look {
	fill: RGBA;
	border: RGBA;
	borderWidth: number;
	radius: number;
	text: RGBA;
	/** The glow's colour; zero alpha draws none. */
	glow: RGBA;
	/** The style's own elevation, under the glow. */
	shadow: BoxShadow | null;
	/** R11.12's pressed nudge, logical pixels down. */
	offsetY: number;
	/** R11.12 layer 6, independent of every other layer; null when not drawn. */
	focusRing: RGBA | null;
}

/** A base look: layer 1's `normal` or `selected`. */
export type LookBase = Pick<Look, 'fill' | 'border' | 'borderWidth' | 'radius' | 'text' | 'shadow'>;

/**
 * One state layer, relative to whatever is beneath it (R11.15): a wash is
 * composited over the fill, the rest replace. Absent keys leave the layer
 * below alone.
 */
export interface LookOverlay {
	wash?: RGBA;
	fill?: RGBA;
	border?: RGBA;
	text?: RGBA;
	glow?: RGBA;
	offsetY?: number;
}

/** Everything R11.12 layers, built once per variant and style, resolved per state change. */
export interface LookLayers {
	normal: LookBase;
	selected: LookBase;
	hover: LookOverlay;
	pressed: LookOverlay;
	/** Layer 4, for `open`, `active`, and `dropActive`. */
	active: LookOverlay;
	disabled: LookOverlay;
	focusRing: RGBA;
}

export interface ResolveOptions {
	/** Whether the pointer that hovers can hover at all; touch cannot (R11.12 layer 2). */
	canHover?: boolean;
}

const NO_GLOW: RGBA = [0, 0, 0, 0];

/**
 * R11.12's fixed order: base (selected or normal), hover wash, pressed
 * treatment, `open`/`active`/`dropActive` accents, disabled treatment, then
 * the focus ring on its own. Pure, so a table of flag combinations can test
 * it without a component.
 */
export function resolveLook(layers: LookLayers, flags: StateFlags, { canHover = true }: ResolveOptions = {}): Look {
	const base = flags.selected ? layers.selected : layers.normal;
	const look: Look = {
		fill: base.fill,
		border: base.border,
		borderWidth: base.borderWidth,
		radius: base.radius,
		text: base.text,
		glow: NO_GLOW,
		shadow: base.shadow,
		offsetY: 0,
		focusRing: null,
	};

	if (flags.hovered && flags.enabled && !flags.pressed && canHover) apply(look, layers.hover);
	if (flags.pressed && flags.enabled) apply(look, layers.pressed);
	if (flags.open || flags.active || flags.dropActive) {
		// Disabled removes washes and glows, so only the border lift survives it.
		apply(look, flags.enabled ? layers.active : { border: layers.active.border });
	}
	if (!flags.enabled) {
		look.glow = NO_GLOW;
		apply(look, layers.disabled);
	}
	if (flags.focusVisible && flags.enabled) look.focusRing = layers.focusRing;
	return look;
}

function apply(look: Look, overlay: LookOverlay): void {
	if (overlay.fill) look.fill = overlay.fill;
	if (overlay.wash) look.fill = over(look.fill, overlay.wash);
	if (overlay.border) look.border = overlay.border;
	if (overlay.text) look.text = overlay.text;
	if (overlay.glow) look.glow = overlay.glow;
	if (overlay.offsetY !== undefined) look.offsetY = overlay.offsetY;
}

/** Source-over of a straight-alpha wash on a straight-alpha fill. */
export function over(fill: RGBA, wash: RGBA): RGBA {
	const washAlpha = wash[3];
	const alpha = washAlpha + fill[3] * (1 - washAlpha);
	if (alpha <= 0) return [0, 0, 0, 0];
	const channel = (index: number) => round((wash[index] * washAlpha + fill[index] * fill[3] * (1 - washAlpha)) / alpha);
	return [channel(0), channel(1), channel(2), round(alpha)];
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}

/** The glow a look's `glow` colour draws as: R11.5's accent glow preset with the colour swapped. */
export function glowShadow(color: RGBA): BoxShadow {
	const { blur, spread } = tokens.elevation.glow_accent;
	return { color, blur, spread, offset: { x: 0, y: 0 } };
}

export function sameLook(a: Look, b: Look): boolean {
	return sameColor(a.fill, b.fill)
		&& sameColor(a.border, b.border)
		&& sameColor(a.text, b.text)
		&& sameColor(a.glow, b.glow)
		&& a.offsetY === b.offsetY
		&& a.borderWidth === b.borderWidth
		&& a.radius === b.radius
		&& a.shadow === b.shadow
		&& (a.focusRing === b.focusRing || (a.focusRing !== null && b.focusRing !== null && sameColor(a.focusRing, b.focusRing)));
}

function sameColor(a: RGBA, b: RGBA): boolean {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
