import { tokens } from '../theme/tokens';
import { FONT_FACES, type FontName, type FontRole } from './fontFaces';

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

/** The part of a face the weight table reads (`FontFaceAsset`). */
export interface WeightedFace {
	readonly role: FontRole;
	readonly font: FontName;
	readonly weight: number;
}

export interface ResolveFontOptions {
	/** A style's `fontFamily`: a role name, a role's family, or a generic CSS family. */
	family?: string;
	weight?: FontWeight;
	/** The loaded faces; the committed ones by default. */
	faces?: readonly WeightedFace[];
}

/**
 * The face a style's `fontFamily` and `fontWeight` draw with, through the
 * typography tokens (R11.8), never per component.
 *
 * The family picks a role: a role's own name or family (`'JetBrains Mono'`
 * is `mono`), `monospace` for `mono`, and anything else `body`. `normal` and
 * `bold` are the theme's `weight_normal` and `weight_bold`. A role's faces are
 * the loaded ones at the weights its theme entry lists. A weight at or above
 * `weight_bold` on a role with no face that heavy goes to the role's
 * `boldRole` when it names one (body's is `display`, since no body bold face
 * is loaded), keeping the weight. Within the role, the face of that weight
 * wins, else the nearest one; a tie goes to the heavier face above 500 and the
 * lighter one otherwise, the direction CSS font matching searches first.
 */
export function resolveFont({ family, weight = 'normal', faces = FONT_FACES }: ResolveFontOptions = {}): FontName {
	let role = roleOfFamily(family);
	const numeric = weight === 'normal' ? tokens.typography.weight_normal : weight === 'bold' ? tokens.typography.weight_bold : weight;
	const boldRole = ROLES[role].boldRole;
	if (numeric >= tokens.typography.weight_bold && isRole(boldRole)
		&& !facesOf(role, faces).some((face) => face.weight >= tokens.typography.weight_bold)) {
		role = boldRole;
	}
	return nearestFace(facesOf(role, faces), numeric)?.font ?? role;
}

/** A role's loaded faces at the weights its theme entry lists. */
function facesOf(role: FontRole, faces: readonly WeightedFace[]): WeightedFace[] {
	const weights = ROLES[role].weights;
	return faces.filter((face) => face.role === role && weights.includes(face.weight));
}

function nearestFace(faces: readonly WeightedFace[], weight: number): WeightedFace | undefined {
	let best: WeightedFace | undefined;
	for (const face of faces) {
		if (!best) {
			best = face;
			continue;
		}
		const distance = Math.abs(face.weight - weight);
		const bestDistance = Math.abs(best.weight - weight);
		const heavierFirst = weight > 500;
		if (distance < bestDistance || (distance === bestDistance && (heavierFirst ? face.weight > best.weight : face.weight < best.weight))) {
			best = face;
		}
	}
	return best;
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
