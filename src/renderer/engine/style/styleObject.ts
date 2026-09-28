import type { RGBA } from '../draw/geometry';
import type { Sides } from '../components/componentGeometry';
import type { BoxShadow } from '../draw/commands';
import type { FontRole } from '../text/fontFaces';
import type { FontWeight } from '../text/fontRoles';
import { tokens } from '../theme/tokens';
import type { ColorToken, ElevationToken } from '../theme/tokens';

export type { Sides };

/**
 * R11.14's closed set. Every key has one meaning on every component that
 * accepts it; anything else is an error, never ignored.
 */
export const STYLE_PROPERTIES = [
	'backgroundColor',
	'color',
	'borderColor',
	'borderWidth',
	'borderRadius',
	'opacity',
	'fontSize',
	'fontRole',
	'fontFamily',
	'fontWeight',
	'letterSpacing',
	'textTransform',
	'textAlign',
	'textDecoration',
	'padding',
	'shadow',
	'cursor',
] as const;

export type StyleProperty = (typeof STYLE_PROPERTIES)[number];

/** R11.15's per-state overrides: each replaces that state's overlay only. */
export const STYLE_STATES = ['hover', 'pressed', 'selected', 'active', 'disabled'] as const;

export type StyleState = (typeof STYLE_STATES)[number];

/** A colour in the accepted forms: a colour token name, `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `transparent`, or floats. */
export type ColorValue = ColorToken | string | RGBA;

/** Logical pixels, or the name of a token in the category the property reads. */
export type LengthValue = number | string;

export interface PaddingSides {
	top?: LengthValue;
	right?: LengthValue;
	bottom?: LengthValue;
	left?: LengthValue;
}

export interface ShadowValue {
	color: ColorValue;
	blur?: number;
	spread?: number;
	offset?: { x: number; y: number };
}

export interface StyleProperties {
	backgroundColor?: ColorValue;
	color?: ColorValue;
	borderColor?: ColorValue;
	borderWidth?: LengthValue;
	borderRadius?: LengthValue;
	opacity?: number;
	fontSize?: LengthValue;
	fontRole?: FontRole;
	/** An alias: `monospace` is `mono`, anything else `body` with a warning (R11.14). */
	fontFamily?: string;
	fontWeight?: FontWeight;
	/** Em, or a `letterSpacing` token name. */
	letterSpacing?: number | string;
	textTransform?: 'none' | 'uppercase';
	textAlign?: 'left' | 'center' | 'right';
	textDecoration?: 'none' | 'underline' | 'strike';
	padding?: LengthValue | PaddingSides;
	shadow?: ElevationToken | ShadowValue;
	cursor?: 'default' | 'pointer' | 'text';
}

/** The authoring surface of a styled component: base properties plus per-state overrides. */
export interface StyleObject extends StyleProperties {
	hover?: StyleProperties;
	pressed?: StyleProperties;
	selected?: StyleProperties;
	active?: StyleProperties;
	disabled?: StyleProperties;
}

export interface StyleAcceptance {
	/** The component's name, for messages. */
	component: string;
	properties: ReadonlySet<StyleProperty>;
	states: ReadonlySet<StyleState>;
	/** What a state override may set; the base set when absent. State layers are relative colours, so usually fewer. */
	stateProperties?: ReadonlySet<StyleProperty>;
}

const PROPERTY_SET: ReadonlySet<string> = new Set(STYLE_PROPERTIES);
const STATE_SET: ReadonlySet<string> = new Set(STYLE_STATES);

/** Development builds check what production trusts (R11.14); Jest runs as one. */
export function isDevelopmentBuild(): boolean {
	return process.env.NODE_ENV !== 'production';
}

/**
 * R11.14's construction-time check. A property the component does not accept
 * throws in every build, since ignoring it is what the rule forbids; a key
 * outside the closed set throws in development builds, where it is a typo or
 * a legacy CSS name (`border`, `verticalAlign`) and production skips the scan.
 */
export function validateStyle(style: StyleObject, acceptance: StyleAcceptance): void {
	checkProperties(style, acceptance, null);
	for (const state of STYLE_STATES) {
		const overlay = style[state];
		if (overlay === undefined) continue;
		if (!acceptance.states.has(state)) {
			throw new Error(`${acceptance.component}: style.${state} is a state this component does not have (R11.15)`);
		}
		checkProperties(overlay, acceptance, state);
	}
}

function checkProperties(style: StyleProperties, acceptance: StyleAcceptance, state: StyleState | null): void {
	const where = state ? `style.${state}` : 'style';
	for (const key of Object.keys(style)) {
		if (state === null && STATE_SET.has(key)) continue;
		if (!PROPERTY_SET.has(key)) {
			if (isDevelopmentBuild()) {
				throw new Error(`${acceptance.component}: ${where}.${key} is not a style property; the closed set is ${STYLE_PROPERTIES.join(', ')} (R11.14)`);
			}
			continue;
		}
		const accepted = state === null ? acceptance.properties : (acceptance.stateProperties ?? acceptance.properties);
		if (!accepted.has(key as StyleProperty)) {
			throw new Error(`${acceptance.component}: ${where}.${key} is a style property this component does not render${state ? ' in a state' : ''} (R11.14)`);
		}
	}
}

// -- values -----------------------------------------------------------------

const COLOR_TOKENS = tokens.color as Readonly<Record<string, RGBA>>;

/**
 * A colour value as floats. A token name reads the theme; `transparent`,
 * `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, and `rgba()` are parsed. A string
 * that is none of them throws, where the old parser turned it into white
 * without a word.
 */
export function resolveColor(value: ColorValue): RGBA {
	if (typeof value !== 'string') return value;
	const token = COLOR_TOKENS[value];
	if (token) return token;
	const parsed = parseCssColor(value.trim().toLowerCase());
	if (!parsed) throw new Error(`style: "${value}" is not a colour token or a CSS colour`);
	return parsed;
}

function parseCssColor(text: string): RGBA | null {
	if (text === 'transparent') return [0, 0, 0, 0];
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
	if (hex) {
		const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
		const channel = (index: number): number => parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255;
		return [channel(0), channel(1), channel(2), digits.length === 8 ? channel(3) : 1];
	}
	const functional = /^rgba?\(([^)]+)\)$/.exec(text);
	if (!functional) return null;
	const values = functional[1].split(',').map((part) => parseFloat(part.trim()));
	if (values.length < 3 || values.length > 4 || values.some((part) => !Number.isFinite(part))) return null;
	return [values[0] / 255, values[1] / 255, values[2] / 255, values.length === 4 ? values[3] : 1];
}

type LengthCategory = 'space' | 'radius' | 'borderWidth' | 'fontSize' | 'control';

/** Which token categories a length property may name, in lookup order. */
const LENGTH_CATEGORIES: Readonly<Record<'borderWidth' | 'borderRadius' | 'fontSize' | 'padding', readonly LengthCategory[]>> = {
	borderWidth: ['borderWidth'],
	borderRadius: ['radius'],
	fontSize: ['fontSize', 'control'],
	padding: ['space', 'control'],
};

export function resolveLength(value: LengthValue, property: keyof typeof LENGTH_CATEGORIES): number {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`style.${property}: ${value} is not a finite number of logical pixels`);
		return value;
	}
	for (const category of LENGTH_CATEGORIES[property]) {
		const table = tokens[category] as Readonly<Record<string, unknown>>;
		const token = table[value];
		if (typeof token === 'number') return token;
	}
	throw new Error(`style.${property}: "${value}" is not a number or a ${LENGTH_CATEGORIES[property].join(' or ')} token`);
}

export function resolveLetterSpacing(value: number | string): number {
	if (typeof value === 'number') return value;
	const token = (tokens.letterSpacing as Readonly<Record<string, number>>)[value];
	if (token === undefined) throw new Error(`style.letterSpacing: "${value}" is not a number or a letterSpacing token`);
	return token;
}

export function resolvePadding(value: LengthValue | PaddingSides, fallback: Sides): Sides {
	if (typeof value === 'number' || typeof value === 'string') {
		const all = resolveLength(value, 'padding');
		return { top: all, right: all, bottom: all, left: all };
	}
	const side = (length: LengthValue | undefined, base: number) => (length === undefined ? base : resolveLength(length, 'padding'));
	return {
		top: side(value.top, fallback.top),
		right: side(value.right, fallback.right),
		bottom: side(value.bottom, fallback.bottom),
		left: side(value.left, fallback.left),
	};
}

const ELEVATION = tokens.elevation as Readonly<Record<string, { color: RGBA; blur: number; spread: number; offset: readonly number[]; inset?: boolean }>>;

/** An elevation token or an explicit shadow, as the draw API's box shadow. Inset presets have no box-shadow form yet. */
export function resolveShadow(value: ElevationToken | ShadowValue): BoxShadow {
	if (typeof value === 'string') {
		const preset = ELEVATION[value];
		if (!preset || !('blur' in preset)) throw new Error(`style.shadow: "${value}" is not an elevation token`);
		if (preset.inset) throw new Error(`style.shadow: "${value}" is an inset shadow, which the draw API cannot draw yet`);
		return { color: preset.color, blur: preset.blur, spread: preset.spread, offset: { x: preset.offset[0], y: preset.offset[1] } };
	}
	return { color: resolveColor(value.color), blur: value.blur ?? 0, spread: value.spread ?? 0, offset: value.offset ?? { x: 0, y: 0 } };
}

/**
 * R11.14's `fontFamily` alias: `monospace` is `mono`, anything else is `body`,
 * with a development-build warning, since a family name is not a role.
 */
export function fontRoleOfFamily(family: string, component: string): FontRole {
	if (family.trim().toLowerCase() === 'monospace') return 'mono';
	if (isDevelopmentBuild()) {
		console.warn(`${component}: style.fontFamily "${family}" maps to the body role; use fontRole (R11.14)`);
	}
	return 'body';
}
