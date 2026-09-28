import type { RGBA } from '../draw/geometry';
import { tokens } from '../theme/tokens';
import type { LookBase, LookLayers, LookOverlay } from './look';
import { over } from './look';
import {
	StyleObject,
	StyleProperties,
	resolveColor,
	resolveLength,
	resolveShadow,
} from './styleObject';

/** R11.10's cross-component vocabulary. */
export type Tone = 'accent' | 'data' | 'ok' | 'warn' | 'crit' | 'auto' | 'default';
export type ControlSize = 'sm' | 'md' | 'lg';

export interface SizeMetrics {
	height: number;
	fontSize: number;
	iconSize: number;
}

/**
 * R11.10: one `size` sets height, font size, and icon size together; nothing
 * derives a font size from a height.
 */
export const CONTROL_SIZES: Readonly<Record<ControlSize, SizeMetrics>> = {
	sm: { height: tokens.control.control_h_sm, fontSize: tokens.control.control_fs_sm, iconSize: tokens.control.icon_sm },
	md: { height: tokens.control.control_h_md, fontSize: tokens.control.control_fs_md, iconSize: tokens.control.icon_md },
	lg: { height: tokens.control.control_h_lg, fontSize: tokens.control.control_fs_lg, iconSize: tokens.control.icon_lg },
};

/** R11.10's `tone: auto`: a normalised value banded into critical, warning, or ok. */
export function autoTone(value: number): 'crit' | 'warn' | 'ok' {
	if (value < tokens.control.tone_auto_crit) return 'crit';
	if (value < tokens.control.tone_auto_warn) return 'warn';
	return 'ok';
}

interface TonePalette {
	fill: RGBA;
	/** The hover fill; null for a tone with no bright token, which gets the wash instead. */
	bright: RGBA | null;
	glow: RGBA;
}

const { color } = tokens;
const GLOW_ALPHA = color.accent_glow[3];

function withAlpha(rgba: RGBA, alpha: number): RGBA {
	return [rgba[0], rgba[1], rgba[2], alpha];
}

/** The filled tones. `warn` is the warm accent (R11.6), so it shares accent's bright and glow. */
const TONES: Readonly<Record<Exclude<Tone, 'default' | 'auto'>, TonePalette>> = {
	accent: { fill: color.accent, bright: color.accent_bright, glow: color.accent_glow },
	warn: { fill: color.status_warn, bright: color.accent_bright, glow: color.accent_glow },
	data: { fill: color.data, bright: color.data_bright, glow: color.data_glow },
	ok: { fill: color.status_ok, bright: null, glow: withAlpha(color.status_ok, GLOW_ALPHA) },
	crit: { fill: color.status_crit, bright: null, glow: withAlpha(color.status_crit, GLOW_ALPHA) },
};

/** The overlay a per-state override describes: colours only, each replacing (R11.15). */
function overlayFrom(style: StyleProperties): LookOverlay {
	const overlay: LookOverlay = {};
	if (style.backgroundColor !== undefined) overlay.fill = resolveColor(style.backgroundColor);
	if (style.borderColor !== undefined) overlay.border = resolveColor(style.borderColor);
	if (style.color !== undefined) overlay.text = resolveColor(style.color);
	return overlay;
}

/** R11.15's middle step: the instance style replaces the matching values of a base. */
function withInstance(base: LookBase, style: StyleObject): LookBase {
	return {
		fill: style.backgroundColor !== undefined ? resolveColor(style.backgroundColor) : base.fill,
		border: style.borderColor !== undefined ? resolveColor(style.borderColor) : base.border,
		borderWidth: style.borderWidth !== undefined ? resolveLength(style.borderWidth, 'borderWidth') : base.borderWidth,
		radius: style.borderRadius !== undefined ? resolveLength(style.borderRadius, 'borderRadius') : base.radius,
		text: style.color !== undefined ? resolveColor(style.color) : base.text,
		shadow: style.shadow !== undefined ? resolveShadow(style.shadow) : base.shadow,
	};
}

/**
 * Layer 1's selected base from a normal one: R11.12's accent-glow wash with
 * bright text. The component draws its own selection mark on top.
 */
function selectedOf(base: LookBase): LookBase {
	return { ...base, fill: over(base.fill, color.bg_active), border: color.accent, text: color.text_bright };
}

const PRESSED: LookOverlay = { wash: color.bg_pressed, offsetY: tokens.control.press_offset };
const ACTIVE: LookOverlay = { border: color.accent, wash: color.bg_active };

/**
 * A button's layers for a tone and an instance style (R11.10, R11.12,
 * R11.15). `default` is a raised neutral surface; every other tone is filled
 * with its colour and dark text, brightens with a glow on hover, and drops to
 * the neutral surface with `text_dim` when disabled, as the battle screen
 * mock's waiting End Turn does (`text_disabled` there would be about 1.6:1). An instance `backgroundColor` keeps the white hover wash rather
 * than the tone's bright fill, so the override still reads as hovered.
 * `ghost` is R12.7's ghost variant, built by `ghostLayers`.
 */
export function buttonLayers(tone: Tone, style: StyleObject, ghost = false): LookLayers {
	if (tone === 'auto') throw new Error('Button: tone "auto" bands a value, which a button does not have (R11.10)');
	if (ghost) return ghostLayers(tone, style);
	const neutral: LookBase = {
		fill: color.bg_panel_raised,
		border: color.line_edge,
		borderWidth: tokens.borderWidth.bw,
		radius: tokens.radius.radius_ui,
		text: color.text,
		shadow: null,
	};
	const palette = tone === 'default' ? null : TONES[tone];
	const variantBase: LookBase = palette
		? { ...neutral, fill: palette.fill, border: palette.fill, text: color.accent_contrast }
		: neutral;
	const normal = withInstance(variantBase, style);
	const selected = style.selected ? { ...selectedOf(normal), ...baseColors(style.selected) } : selectedOf(normal);

	let hover: LookOverlay;
	if (style.hover) {
		hover = overlayFrom(style.hover);
	} else if (palette) {
		hover = palette.bright && style.backgroundColor === undefined
			? { fill: palette.bright, border: palette.bright, glow: palette.glow }
			: { wash: color.bg_hover, glow: palette.glow };
	} else {
		hover = { wash: color.bg_hover };
	}

	const disabled: LookOverlay = style.disabled
		? overlayFrom(style.disabled)
		: palette && style.backgroundColor === undefined
			? { fill: neutral.fill, border: neutral.border, text: color.text_dim }
			: { text: color.text_disabled };

	return {
		normal,
		selected,
		hover,
		pressed: style.pressed ? { ...overlayFrom(style.pressed), offsetY: PRESSED.offsetY } : PRESSED,
		active: style.active ? overlayFrom(style.active) : ACTIVE,
		disabled,
		focusRing: color.accent,
	};
}

/**
 * A text field's layers: an inset well (R11.5) whose editing state is layer
 * 4's `active` (the border lifts to the accent), so a field focused by the
 * pointer shows it is taking keys even without a focus-visible ring.
 */
export function fieldLayers(style: StyleObject): LookLayers {
	const normal = withInstance({
		fill: color.bg_inset,
		border: color.line_edge,
		borderWidth: tokens.borderWidth.bw,
		radius: tokens.radius.radius_ui,
		text: color.text,
		shadow: null,
	}, style);
	return {
		normal,
		selected: normal,
		hover: style.hover ? overlayFrom(style.hover) : { wash: color.bg_hover },
		pressed: {},
		active: style.active ? overlayFrom(style.active) : ACTIVE,
		disabled: style.disabled ? overlayFrom(style.disabled) : { text: color.text_disabled },
		focusRing: color.accent,
	};
}

function baseColors(style: StyleProperties): Partial<LookBase> {
	const overlay = overlayFrom(style);
	const colors: Partial<LookBase> = {};
	if (overlay.fill) colors.fill = overlay.fill;
	if (overlay.border) colors.border = overlay.border;
	if (overlay.text) colors.text = overlay.text;
	return colors;
}

const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * R12.7's ghost button: clear at rest, with no border, and the label in the
 * tone's colour (`text` for the default tone). Hover is the white wash with
 * the tone's glow, pressed the usual wash and nudge, so a ghost says it is a
 * control only when the pointer or focus reaches it. An instance style
 * replaces the base as for any button (R11.15).
 */
function ghostLayers(tone: Exclude<Tone, 'auto'>, style: StyleObject): LookLayers {
	const palette = tone === 'default' ? null : TONES[tone];
	const normal = withInstance({
		fill: CLEAR,
		border: CLEAR,
		borderWidth: 0,
		radius: tokens.radius.radius_ui,
		text: palette ? palette.fill : color.text,
		shadow: null,
	}, style);
	return {
		normal,
		selected: style.selected ? { ...selectedOf(normal), ...baseColors(style.selected) } : selectedOf(normal),
		hover: style.hover ? overlayFrom(style.hover) : palette ? { wash: color.bg_hover, glow: palette.glow } : { wash: color.bg_hover },
		pressed: style.pressed ? { ...overlayFrom(style.pressed), offsetY: PRESSED.offsetY } : PRESSED,
		active: style.active ? overlayFrom(style.active) : ACTIVE,
		disabled: style.disabled ? overlayFrom(style.disabled) : { text: color.text_disabled },
		focusRing: color.accent,
	};
}

/**
 * R12.8's list row: clear at rest with the body text colour (`text_dim`
 * when `dim`), the selected base R11.12 names for a row (the accent-glow
 * wash with bright text; the row draws its 2 px bar itself), a hover wash,
 * a pressed wash with no nudge (a row in a list does not move), and the
 * disabled text. The row's hairline is not a state layer.
 */
export function rowLayers({ dim }: { dim: boolean }): LookLayers {
	const normal: LookBase = {
		fill: CLEAR,
		border: CLEAR,
		borderWidth: 0,
		radius: 0,
		text: dim ? color.text_dim : color.text,
		shadow: null,
	};
	return {
		normal,
		selected: { ...normal, fill: color.bg_active, text: color.text_bright },
		hover: { wash: color.bg_hover },
		pressed: { wash: color.bg_pressed },
		active: { wash: color.bg_active },
		disabled: { text: color.text_disabled },
		focusRing: color.accent,
	};
}

/**
 * R12.9 and R12.35's marks (a checkbox's box, a toggle's track, a radio's
 * ring): an inset well with a strong edge when off, the accent filled when on
 * (`selected`), with the mark or thumb drawn in `text` on it. Hover washes
 * the well and brightens the edge; the accent brightens with its glow when
 * on, which the component picks by building from `on`. Disabled drops to the
 * well with the disabled text colour for the mark, whether on or off.
 */
export function markLayers({ on }: { on: boolean }): LookLayers {
	const off: LookBase = {
		fill: color.bg_inset,
		border: color.line_strong,
		borderWidth: tokens.borderWidth.bw,
		radius: tokens.radius.r_sm,
		text: color.text_dim,
		shadow: null,
	};
	const filled: LookBase = { ...off, fill: color.accent, border: color.accent, text: color.accent_contrast };
	return {
		normal: off,
		selected: filled,
		hover: on
			? { fill: color.accent_bright, border: color.accent_bright, glow: color.accent_glow }
			: { wash: color.bg_hover, border: color.text_dim },
		pressed: { wash: color.bg_pressed },
		active: {},
		disabled: { fill: color.bg_inset, border: color.line_edge, text: color.text_disabled },
		focusRing: color.accent,
	};
}

/**
 * R12.16's tab: clear at rest with dim display text, bright when selected
 * (the bar draws its 2 px accent underline), and on hover a wash with the
 * bright text; pressed washes darker, with no nudge (a tab in a bar does not
 * move); disabled drops to the disabled text colour.
 */
export function tabLayers(): LookLayers {
	const normal: LookBase = { fill: CLEAR, border: CLEAR, borderWidth: 0, radius: 0, text: color.text_dim, shadow: null };
	return {
		normal,
		selected: { ...normal, text: color.text_bright },
		hover: { wash: color.bg_hover, text: color.text_bright },
		pressed: { wash: color.bg_pressed },
		active: {},
		disabled: { text: color.text_disabled },
		focusRing: color.accent,
	};
}

/**
 * R12.17's segment: a dim label on the well at rest; selected, the tone's
 * filled chip with the contrast text (the control draws its glow); hover a
 * wash with the body text, or the tone's bright fill on the chip; pressed a
 * darker wash. Disabled greys the chip and the label; `on` picks the
 * disabled chip, as `markLayers` does.
 */
export function segmentLayers({ tone, on }: { tone: Exclude<Tone, 'auto' | 'default'>; on: boolean }): LookLayers {
	const palette = TONES[tone];
	const normal: LookBase = { fill: CLEAR, border: CLEAR, borderWidth: 0, radius: tokens.radius.r_sm, text: color.text_dim, shadow: null };
	let hover: LookOverlay = { wash: color.bg_hover, text: color.text };
	if (on) hover = palette.bright ? { fill: palette.bright } : { wash: color.bg_hover };
	return {
		normal,
		selected: { ...normal, fill: palette.fill, text: color.accent_contrast },
		hover,
		pressed: { wash: color.bg_pressed },
		active: {},
		disabled: on ? { fill: color.line_strong, text: color.text_disabled } : { text: color.text_disabled },
		focusRing: color.accent,
	};
}
