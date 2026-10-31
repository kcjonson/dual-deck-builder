import barlowCondensedSemiBoldMetrics from '../../../assets/fonts/barlow-condensed-semibold.json';
import barlowCondensedSemiBoldImage from '../../../assets/fonts/barlow-condensed-semibold.png';
import barlowCondensedBoldMetrics from '../../../assets/fonts/barlow-condensed-bold.json';
import barlowCondensedBoldImage from '../../../assets/fonts/barlow-condensed-bold.png';
import openSansRegularMetrics from '../../../assets/fonts/open-sans-regular.json';
import openSansRegularImage from '../../../assets/fonts/open-sans-regular.png';
import openSansSemiBoldMetrics from '../../../assets/fonts/open-sans-semibold.json';
import openSansSemiBoldImage from '../../../assets/fonts/open-sans-semibold.png';
import jetBrainsMonoRegularMetrics from '../../../assets/fonts/jetbrains-mono-regular.json';
import jetBrainsMonoRegularImage from '../../../assets/fonts/jetbrains-mono-regular.png';
import materialIconsMetrics from '../../../assets/fonts/material-icons.json';
import materialIconsImage from '../../../assets/fonts/material-icons.png';
import barlowCondensedSemiBoldFont from '../../../assets/fonts/barlow-condensed/BarlowCondensed-SemiBold.ttf';
import barlowCondensedBoldFont from '../../../assets/fonts/barlow-condensed/BarlowCondensed-Bold.ttf';
import openSansRegularFont from '../../../assets/fonts/open-sans/OpenSans-Regular.ttf';
import openSansSemiBoldFont from '../../../assets/fonts/open-sans/OpenSans-SemiBold.ttf';
import jetBrainsMonoRegularFont from '../../../assets/fonts/jetbrains-mono/JetBrainsMono-Regular.ttf';
import { FIELD_INK } from './fieldInk';

/** R11.8's three roles. */
export type FontRole = 'display' | 'body' | 'mono';

/** The icon atlas's name: the `font` a `drawText` of an icon selects (R12.6). */
export const ICON_ATLAS_ROLE = 'icons';

/** Every atlas the draw API loads: the three text roles and the icon atlas. */
export type AtlasRole = FontRole | typeof ICON_ATLAS_ROLE;

/**
 * The name `drawText` and `measureText` select a face's atlas by. Each role's
 * base face, the one it draws with when no weight is asked for, goes by the
 * role's own name; another weight of the role is `<role>-<weight>`
 * (`display-700`). R11.8's weight table picks between them (`resolveFont`).
 */
export type FontName = FontRole | `${FontRole}-${number}`;

/** A name the draw API loads an atlas under: a face's, or the icon atlas's. */
export type AtlasName = FontName | typeof ICON_ATLAS_ROLE;

export interface FontFaceAsset<Role extends AtlasRole = FontRole> {
	readonly role: Role;
	/** The name the draw API selects this atlas by (`FontName`). */
	readonly font: Role extends FontRole ? FontName : Role;
	/** The face's CSS weight, which R11.8's table resolves a style's `fontWeight` against. */
	readonly weight: number;
	/** The atlas basename under src/assets/fonts/, as written by scripts/build-fonts. */
	readonly face: string;
	/** The metrics JSON as a bundled module (R15.34: no fetch). */
	readonly metrics: unknown;
	/**
	 * The atlas image as a bundler asset module: a URL in the web build, a data
	 * URI in the Electron renderer, so a packaged page running from file://
	 * never requests a file for it (R15.34).
	 */
	readonly imageUrl: string;
	/**
	 * The face's font file as a bundler asset module, which the atlas was
	 * built from. R6.4a's raster fallback draws sizes too small for the
	 * distance field with it through the platform's 2D text API. Absent for
	 * the icon atlas, whose small sizes stay on the distance field.
	 */
	readonly fontUrl?: string;
	/** The distance field's ink the raster fallback's glyphs are matched to (`FIELD_INK`, DDB-217). */
	readonly fieldInk?: number;
}

/**
 * The committed atlases (R6.4): each role's base face, then the other weights
 * the UI art direction sets. Body has no bold face (700), so R11.8's table
 * sends `bold` on body to the display role's.
 */
export const FONT_FACES: readonly FontFaceAsset[] = [
	{
		role: 'display',
		font: 'display',
		weight: 600,
		face: 'barlow-condensed-semibold',
		metrics: barlowCondensedSemiBoldMetrics,
		imageUrl: barlowCondensedSemiBoldImage,
		fontUrl: barlowCondensedSemiBoldFont,
		fieldInk: FIELD_INK['barlow-condensed-semibold'],
	},
	{
		role: 'display',
		font: 'display-700',
		weight: 700,
		face: 'barlow-condensed-bold',
		metrics: barlowCondensedBoldMetrics,
		imageUrl: barlowCondensedBoldImage,
		fontUrl: barlowCondensedBoldFont,
		fieldInk: FIELD_INK['barlow-condensed-bold'],
	},
	{
		role: 'body',
		font: 'body',
		weight: 400,
		face: 'open-sans-regular',
		metrics: openSansRegularMetrics,
		imageUrl: openSansRegularImage,
		fontUrl: openSansRegularFont,
		fieldInk: FIELD_INK['open-sans-regular'],
	},
	{
		role: 'body',
		font: 'body-600',
		weight: 600,
		face: 'open-sans-semibold',
		metrics: openSansSemiBoldMetrics,
		imageUrl: openSansSemiBoldImage,
		fontUrl: openSansSemiBoldFont,
		fieldInk: FIELD_INK['open-sans-semibold'],
	},
	{
		role: 'mono',
		font: 'mono',
		weight: 400,
		face: 'jetbrains-mono-regular',
		metrics: jetBrainsMonoRegularMetrics,
		imageUrl: jetBrainsMonoRegularImage,
		fontUrl: jetBrainsMonoRegularFont,
		fieldInk: FIELD_INK['jetbrains-mono-regular'],
	},
];

/**
 * The icon atlas (R12.6), built by the same script from Material Icons with
 * the glyphs `src/assets/fonts/icons.txt` names, and addressed through the
 * generated `icons.ts`. It is drawn in `text` mode like any face.
 */
export const ICON_ATLAS: FontFaceAsset<typeof ICON_ATLAS_ROLE> = {
	role: ICON_ATLAS_ROLE,
	font: ICON_ATLAS_ROLE,
	weight: 400,
	face: 'material-icons',
	metrics: materialIconsMetrics,
	imageUrl: materialIconsImage,
};

/** What the bootstraps load before the first frame (R2.18): the faces, then the icons. */
export const ATLAS_ASSETS: readonly FontFaceAsset<AtlasRole>[] = [...FONT_FACES, ICON_ATLAS];
