import { tokens } from '../theme/tokens';
import type { FontRole } from './fontFaces';

export type FontWeight = 'normal' | 'bold' | number;

interface RoleTypography {
	readonly family: string;
	readonly weights: readonly number[];
	readonly boldRole?: string;
}

const ROLES: Readonly<Record<FontRole, RoleTypography>> = {
	display: tokens.typography.role_display,
	body: tokens.typography.role_body,
	mono: tokens.typography.role_mono,
};

/**
 * Generic CSS families a style may name, and the role each means. Any other
 * family that is not a role's own family resolves to `body`.
 */
const GENERIC_FAMILIES: Readonly<Record<string, FontRole>> = {
	monospace: 'mono',
	'sans-serif': 'body',
	'system-ui': 'body',
};

export interface ResolveFontRoleOptions {
	/** A style's `fontFamily`: a role name, a role's family, or a generic CSS family. */
	family?: string;
	weight?: FontWeight;
}

/**
 * The font role a style's `fontFamily` and `fontWeight` draw with, through
 * the typography tokens (R11.8), never per component.
 *
 * The family picks a role: a role's own name or family (`'JetBrains Mono'`
 * is `mono`), `monospace` for `mono`, and anything else `body`. The weight
 * then resolves within the theme table: a weight the role has a face for
 * stays; `bold` (700 or more) on a role without a bold face goes to the
 * role's `boldRole` when it names one (body's is `display`, since no body
 * bold face is loaded); any other weight falls back to the nearest one the
 * role has, which with one face per role is that face.
 */
export function resolveFontRole({ family, weight = 'normal' }: ResolveFontRoleOptions = {}): FontRole {
	const role = roleOfFamily(family);
	const numeric = weight === 'normal' ? tokens.typography.weight_normal : weight === 'bold' ? tokens.typography.weight_bold : weight;
	const typography = ROLES[role];
	if (typography.weights.includes(numeric)) return role;
	if (numeric >= tokens.typography.weight_bold && isRole(typography.boldRole)) return typography.boldRole;
	return role;
}

function roleOfFamily(family: string | undefined): FontRole {
	if (family === undefined) return 'body';
	const name = family.trim();
	if (isRole(name)) return name;
	const lower = name.toLowerCase();
	for (const role of Object.keys(ROLES) as FontRole[]) {
		if (ROLES[role].family.toLowerCase() === lower) return role;
	}
	return GENERIC_FAMILIES[lower] ?? 'body';
}

function isRole(name: string | undefined): name is FontRole {
	return name === 'display' || name === 'body' || name === 'mono';
}
