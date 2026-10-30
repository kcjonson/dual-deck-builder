import type { RGBA } from '../draw/geometry';
import { tokens } from '../theme/tokens';
import type { Theme } from '../theme/tokens';
import type { LookBase, LookLayers, LookOverlay } from './look';
import { over } from './look';
import {
	StyleObject,
	StyleProperties,
	resolveColor,
	resolveLength,
	resolveShadow,
} from './styleObject';

const CLEAR: RGBA = [0, 0, 0, 0];

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
	/** A filled control's border: the fill itself, except the accent's `accent_edge` (the atlas highway's Casing). */
	edge: RGBA;
	/** The hover fill; null for a tone with no bright token, which gets the wash instead. */
	bright: RGBA | null;
	glow: RGBA;
}

function withAlpha(rgba: RGBA, alpha: number): RGBA {
	return [rgba[0], rgba[1], rgba[2], alpha];
}

function sameColor(a: RGBA, b: RGBA): boolean {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

type FilledTone = Exclude<Tone, 'default' | 'auto'>;

/** What every builder below reads from a theme, made once per theme. */
interface ThemeLook {
	color: Theme['color'];
	/** The filled tones. `warn` is the warm accent (R11.6), so it shares accent's bright and glow. */
	tones: Readonly<Record<FilledTone, TonePalette>>;
	pressed: LookOverlay;
	active: LookOverlay;
}

const themeLooks = new Map<Theme, ThemeLook>();

function themeLook(theme: Theme): ThemeLook {
	let look = themeLooks.get(theme);
	if (look) return look;
	const { color } = theme;
	const glowAlpha = color.accent_glow[3];
	look = {
		color,
		tones: {
			accent: { fill: color.accent, edge: color.accent_edge, bright: color.accent_bright, glow: color.accent_glow },
			warn: { fill: color.status_warn, edge: color.status_warn, bright: color.accent_bright, glow: color.accent_glow },
			data: { fill: color.data, edge: color.data, bright: color.data_bright, glow: color.data_glow },
			ok: { fill: color.status_ok, edge: color.status_ok, bright: null, glow: withAlpha(color.status_ok, glowAlpha) },
			crit: { fill: color.status_crit, edge: color.status_crit, bright: null, glow: withAlpha(color.status_crit, glowAlpha) },
		},
		pressed: { wash: color.bg_pressed, offsetY: theme.control.press_offset },
		active: { border: color.accent, wash: color.bg_active },
	};
	themeLooks.set(theme, look);
	return look;
}

/**
 * A tone's own colour for a mark that is not a control (a meter's fill, a
 * badge, a stat's value): the tone's fill, `text_dim` for `default`, and
 * `auto` banded from `value` (R11.10).
 */
export function toneColor(tone: Tone, value = 1, theme: Theme = tokens): RGBA {
	const { color, tones } = themeLook(theme);
	if (tone === 'default') return color.text_dim;
	return tones[tone === 'auto' ? autoTone(value) : tone].fill;
}

/** A filled tone's glow colour: the accent glow's alpha in the tone's hue. */
export function toneGlow(tone: SegmentChip, theme: Theme = tokens): RGBA {
	return tone === 'highlight' ? CLEAR : themeLook(theme).tones[tone].glow;
}

/** The overlay a per-state override describes: colours only, each replacing (R11.15). */
function overlayFrom(style: StyleProperties, theme: Theme): LookOverlay {
	const overlay: LookOverlay = {};
	if (style.backgroundColor !== undefined) overlay.fill = resolveColor(style.backgroundColor, theme);
	if (style.borderColor !== undefined) overlay.border = resolveColor(style.borderColor, theme);
	if (style.color !== undefined) overlay.text = resolveColor(style.color, theme);
	return overlay;
}

/** R11.15's middle step: the instance style replaces the matching values of a base. */
function withInstance(base: LookBase, style: StyleObject, theme: Theme): LookBase {
	return {
		fill: style.backgroundColor !== undefined ? resolveColor(style.backgroundColor, theme) : base.fill,
		border: style.borderColor !== undefined ? resolveColor(style.borderColor, theme) : base.border,
		borderWidth: style.borderWidth !== undefined ? resolveLength(style.borderWidth, 'borderWidth', theme) : base.borderWidth,
		radius: style.borderRadius !== undefined ? resolveLength(style.borderRadius, 'borderRadius', theme) : base.radius,
		text: style.color !== undefined ? resolveColor(style.color, theme) : base.text,
		shadow: style.shadow !== undefined ? resolveShadow(style.shadow, theme) : base.shadow,
	};
}

/**
 * Layer 1's selected base from a normal one: R11.12's accent-glow wash with
 * bright text. The component draws its own selection mark on top.
 */
function selectedOf(base: LookBase, color: Theme['color']): LookBase {
	return { ...base, fill: over(base.fill, color.bg_active), border: color.accent, text: color.text_bright };
}

/**
 * A button's layers for a tone and an instance style (R11.10, R11.12,
 * R11.15). `default` is a raised neutral surface; every other tone is filled
 * with its colour and dark text, brightens with a glow on hover, and drops to
 * the neutral surface with `text_dim` when disabled, as the battle screen
 * mock's waiting End Turn does (`text_disabled` there would be about 1.6:1). An instance `backgroundColor` keeps the white hover wash rather
 * than the tone's bright fill, so the override still reads as hovered.
 * `ghost` is R12.7's ghost variant, built by `ghostLayers`.
 */
export function buttonLayers(tone: Tone, style: StyleObject, ghost = false, theme: Theme = tokens): LookLayers {
	if (tone === 'auto') throw new Error('Button: tone "auto" bands a value, which a button does not have (R11.10)');
	if (ghost) return ghostLayers(tone, style, theme);
	const { color, tones, pressed, active } = themeLook(theme);
	const neutral: LookBase = {
		fill: color.bg_panel_raised,
		border: color.line_edge,
		borderWidth: theme.borderWidth.bw,
		radius: theme.radius.radius_ui,
		text: color.text,
		shadow: null,
	};
	const palette = tone === 'default' ? null : tones[tone];
	const variantBase: LookBase = palette
		? { ...neutral, fill: palette.fill, border: palette.edge, text: color.accent_contrast }
		: neutral;
	const normal = withInstance(variantBase, style, theme);
	const selected = style.selected ? { ...selectedOf(normal, color), ...baseColors(style.selected, theme) } : selectedOf(normal, color);

	let hover: LookOverlay;
	if (style.hover) {
		hover = overlayFrom(style.hover, theme);
	} else if (palette) {
		// An edge of its own (the atlas Casing) stays through hover; one that is the fill brightens with it.
		hover = palette.bright && style.backgroundColor === undefined
			? { fill: palette.bright, border: sameColor(palette.edge, palette.fill) ? palette.bright : palette.edge, glow: palette.glow }
			: { wash: color.bg_hover, glow: palette.glow };
	} else {
		hover = { wash: color.bg_hover };
	}

	const disabled: LookOverlay = style.disabled
		? overlayFrom(style.disabled, theme)
		: palette && style.backgroundColor === undefined
			? { fill: neutral.fill, border: neutral.border, text: color.text_dim }
			: { text: color.text_disabled };

	return {
		normal,
		selected,
		hover,
		pressed: style.pressed ? { ...overlayFrom(style.pressed, theme), offsetY: pressed.offsetY } : pressed,
		active: style.active ? overlayFrom(style.active, theme) : active,
		disabled,
		focusRing: color.focus_ring,
	};
}

/**
 * A text field's layers: an inset well (R11.5) whose editing state is layer
 * 4's `active` (the border lifts to the accent), so a field focused by the
 * pointer shows it is taking keys even without a focus-visible ring.
 */
export function fieldLayers(style: StyleObject, theme: Theme = tokens): LookLayers {
	const { color, active } = themeLook(theme);
	const normal = withInstance({
		fill: color.bg_inset,
		border: color.line_edge,
		borderWidth: theme.borderWidth.bw,
		radius: theme.radius.radius_ui,
		text: color.text,
		shadow: null,
	}, style, theme);
	return {
		normal,
		selected: normal,
		hover: style.hover ? overlayFrom(style.hover, theme) : { wash: color.bg_hover },
		pressed: {},
		active: style.active ? overlayFrom(style.active, theme) : active,
		disabled: style.disabled ? overlayFrom(style.disabled, theme) : { text: color.text_disabled },
		focusRing: color.focus_ring,
	};
}

function baseColors(style: StyleProperties, theme: Theme): Partial<LookBase> {
	const overlay = overlayFrom(style, theme);
	const colors: Partial<LookBase> = {};
	if (overlay.fill) colors.fill = overlay.fill;
	if (overlay.border) colors.border = overlay.border;
	if (overlay.text) colors.text = overlay.text;
	return colors;
}

/**
 * R12.7's ghost button: clear at rest, with no border, and the label in the
 * tone's colour (`text` for the default tone). Hover is the white wash with
 * the tone's glow, pressed the usual wash and nudge, so a ghost says it is a
 * control only when the pointer or focus reaches it. An instance style
 * replaces the base as for any button (R11.15).
 */
function ghostLayers(tone: Exclude<Tone, 'auto'>, style: StyleObject, theme: Theme): LookLayers {
	const { color, tones, pressed, active } = themeLook(theme);
	const palette = tone === 'default' ? null : tones[tone];
	const normal = withInstance({
		fill: CLEAR,
		border: CLEAR,
		borderWidth: 0,
		radius: theme.radius.radius_ui,
		text: palette ? palette.fill : color.text,
		shadow: null,
	}, style, theme);
	return {
		normal,
		selected: style.selected ? { ...selectedOf(normal, color), ...baseColors(style.selected, theme) } : selectedOf(normal, color),
		hover: style.hover ? overlayFrom(style.hover, theme) : palette ? { wash: color.bg_hover, glow: palette.glow } : { wash: color.bg_hover },
		pressed: style.pressed ? { ...overlayFrom(style.pressed, theme), offsetY: pressed.offsetY } : pressed,
		active: style.active ? overlayFrom(style.active, theme) : active,
		disabled: style.disabled ? overlayFrom(style.disabled, theme) : { text: color.text_disabled },
		focusRing: color.focus_ring,
	};
}

/**
 * R12.8's list row: clear at rest with the body text colour (`text_dim`
 * when `dim`), the selected base R11.12 names for a row (the accent-glow
 * wash with bright text; the row draws its 2 px bar itself), a hover wash,
 * a pressed wash with no nudge (a row in a list does not move), and the
 * disabled text. The row's hairline is not a state layer.
 */
export function rowLayers({ dim, theme = tokens }: { dim: boolean; theme?: Theme }): LookLayers {
	const { color } = theme;
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
		focusRing: color.focus_ring,
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
export function markLayers({ on, theme = tokens }: { on: boolean; theme?: Theme }): LookLayers {
	const { color } = theme;
	const off: LookBase = {
		fill: color.bg_inset,
		border: color.line_strong,
		borderWidth: theme.borderWidth.bw,
		radius: theme.radius.radius_ui,
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
		focusRing: color.focus_ring,
	};
}

/**
 * R12.16's tab: clear at rest with dim display text, bright when selected
 * (the bar draws its 2 px accent underline), and on hover a wash with the
 * bright text; pressed washes darker, with no nudge (a tab in a bar does not
 * move); disabled drops to the disabled text colour.
 */
export function tabLayers(theme: Theme = tokens): LookLayers {
	const { color } = theme;
	const normal: LookBase = { fill: CLEAR, border: CLEAR, borderWidth: 0, radius: 0, text: color.text_dim, shadow: null };
	return {
		normal,
		selected: { ...normal, text: color.text_bright },
		hover: { wash: color.bg_hover, text: color.text_bright },
		pressed: { wash: color.bg_pressed },
		active: {},
		disabled: { text: color.text_disabled },
		focusRing: color.focus_ring,
	};
}

/**
 * A segment's selected chip: a filled tone, or `highlight`, the selection
 * wash with bright text, for a theme whose filled tones are too strong for
 * small labels (the atlas marks a selection with the highlighter: UI Art
 * Direction, Wear).
 */
export type SegmentChip = FilledTone | 'highlight';

/**
 * R12.17's segment: a dim label on the well at rest; selected, the tone's
 * filled chip with the contrast text (the control draws its glow), or the
 * highlight's wash with bright text; hover a wash with the body text, or the
 * tone's bright fill on the chip; pressed a darker wash. Disabled greys the
 * chip and the label; `on` picks the disabled chip, as `markLayers` does.
 */
export function segmentLayers({ tone, on, theme = tokens }: { tone: SegmentChip; on: boolean; theme?: Theme }): LookLayers {
	const { color, tones } = themeLook(theme);
	const normal: LookBase = { fill: CLEAR, border: CLEAR, borderWidth: 0, radius: theme.radius.radius_ui, text: color.text_dim, shadow: null };
	const palette = tone === 'highlight' ? null : tones[tone];
	let hover: LookOverlay = { wash: color.bg_hover, text: color.text };
	if (on) hover = palette?.bright ? { fill: palette.bright } : { wash: color.bg_hover };
	const selected: LookBase = palette
		? { ...normal, fill: palette.fill, text: color.accent_contrast }
		: { ...normal, fill: color.bg_selection, text: color.text_bright };
	return {
		normal,
		selected,
		hover,
		pressed: { wash: color.bg_pressed },
		active: {},
		disabled: on ? { fill: color.line_strong, text: color.text_disabled } : { text: color.text_disabled },
		focusRing: color.focus_ring,
	};
}
