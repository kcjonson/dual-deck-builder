import type { RGBA } from '../../../engine/draw/geometry';
import { resolveFont } from '../../../engine/text/fontRoles';
import type { FontName } from '../../../engine/text/fontFaces';
import type { Theme } from '../../../engine/theme/tokens';

/**
 * The face the atlas parts draw their own labels in: display 700 (UI Art
 * Direction, Type), through the weight table (R11.8). Text components ask
 * the same way, with `fontWeight` in their style; mono 500 values do too,
 * and draw in the nearest mono face until a 500 one is generated.
 */
export const DISPLAY_BOLD: FontName = resolveFont({ family: 'display', weight: 700 });

/**
 * The spec's component geometry (UI Art Direction, Components), in logical
 * pixels. Rule weights and the highway's 18.66 px label floor sit off the
 * spacing scale (R11.9), so they live here once rather than in each part.
 */
export const ATLAS = {
	/** The sheet's double neatline: the outer rule's inset from the sheet edge, then the inner rule 8 px in. */
	neatlineInset: 18,
	neatlineGap: 8,
	neatlineOuter: 0.6,
	neatlineInner: 1.6,
	/** Between the inner neatline and the sheet's content. */
	sheetPadding: 20,
	/** The legend box: its ink border, the inner rule and how far in it sits, and the padding inside both. */
	legendBorder: 1.4,
	legendRule: 0.6,
	legendRuleInset: 6,
	legendPadding: 16,
	/** Display 700 heads in spaced capitals: section heads, screen titles. */
	headSize: 20,
	headTracking: 0.16,
	/** Thumb-index tabs. */
	tabSize: 15,
	tabTracking: 0.14,
	tabPadX: 16,
	tabPadTop: 6,
	tabPadBottom: 8,
	tabRaise: 4,
	tabGap: 6,
	/** The highway: Casing border and offset, and its label floor for paper-coloured text (3.5:1, large text only). */
	highwayBorder: 4,
	highwayOffset: 3,
	highwayLabelMin: 18.66,
	highwayLabel: 28,
	/** The back road: border, and the inner rule's weight and inset. */
	backRoadBorder: 1.6,
	backRoadRule: 1,
	backRoadRuleInset: 3,
	backRoadLabel: 19,
	/** Hover lifts a button; the 2 px ink focus ring sits 3 px out. */
	hoverLift: 1,
	focusRingWidth: 2,
	focusRingGap: 3,
	/** The spec's minimum hit size for a button. */
	minHit: 44,
	/** Disabled borders: faded print, dashed. */
	dash: 5,
	dashGap: 3,
	/** Mono captions under plates and in footers. */
	captionSize: 10,
	captionTracking: 0.12,
	/** Plate rules: the main rule, and the fine one 4 px outside it. */
	plateRule: 1.6,
	plateOuterRule: 0.6,
	plateOuterGap: 4,
	/** The scale bar's ink frame. */
	scaleFrame: 1.2,
} as const;

/** Every colour an atlas part draws with, resolved once per theme from its tokens. */
export interface AtlasInks {
	table: RGBA;
	sheet: RGBA;
	index: RGBA;
	paper: RGBA;
	freshPaper: RGBA;
	ink: RGBA;
	inkDim: RGBA;
	inkFaint: RGBA;
	fadedPrint: RGBA;
	hairline: RGBA;
	hover: RGBA;
	highway: RGBA;
	highwayBright: RGBA;
	casing: RGBA;
	highwayLabel: RGBA;
	backRoad: RGBA;
	river: RGBA;
	stronghold: RGBA;
	highlighter: RGBA;
	grease: RGBA;
	tape: RGBA;
	focusRing: RGBA;
	shadow: RGBA;
	/** The highlighter as a flat tone, until the baked swipe draws it. */
	highlighterTone: RGBA;
	/** Each driver's ink on its casing: A is always the highway orange, B the route teal (UI Art Direction, Card hints). */
	drivers: Readonly<Record<Driver, DriverInks>>;
}

export type Driver = 'a' | 'b';

export interface DriverInks {
	fill: RGBA;
	casing: RGBA;
}

const inksByTheme = new Map<Theme, AtlasInks>();

/** The inks for `theme`, built the first time it is asked for. */
export function atlasInks(theme: Theme): AtlasInks {
	let inks = inksByTheme.get(theme);
	if (inks) return inks;
	const { color } = theme;
	inks = {
		table: color.bg_void,
		sheet: color.bg_base,
		index: color.bg_inset,
		paper: color.bg_panel,
		freshPaper: color.bg_panel_raised,
		ink: color.text,
		inkDim: color.text_dim,
		inkFaint: color.text_faint,
		fadedPrint: color.text_disabled,
		hairline: color.line_hairline,
		hover: color.bg_hover,
		highway: color.accent,
		highwayBright: color.accent_bright,
		casing: color.accent_dim,
		highwayLabel: color.accent_contrast,
		backRoad: color.back_road,
		river: color.data,
		stronghold: color.status_crit,
		highlighter: color.hand_highlighter,
		grease: color.hand_grease,
		tape: color.duct_tape,
		focusRing: color.focus_ring,
		shadow: color.shadow,
		highlighterTone: color.bg_selection,
		drivers: {
			a: { fill: color.driver_a, casing: color.driver_a_casing },
			b: { fill: color.driver_b, casing: color.driver_b_casing },
		},
	};
	inksByTheme.set(theme, inks);
	return inks;
}
