import barlowCondensedSemiBoldMetrics from '../../../assets/fonts/barlow-condensed-semibold.json';
import barlowCondensedSemiBoldImage from '../../../assets/fonts/barlow-condensed-semibold.png';
import openSansRegularMetrics from '../../../assets/fonts/open-sans-regular.json';
import openSansRegularImage from '../../../assets/fonts/open-sans-regular.png';
import jetBrainsMonoRegularMetrics from '../../../assets/fonts/jetbrains-mono-regular.json';
import jetBrainsMonoRegularImage from '../../../assets/fonts/jetbrains-mono-regular.png';
import materialIconsMetrics from '../../../assets/fonts/material-icons.json';
import materialIconsImage from '../../../assets/fonts/material-icons.png';
import barlowCondensedSemiBoldFont from '../../../assets/fonts/barlow-condensed/BarlowCondensed-SemiBold.ttf';
import openSansRegularFont from '../../../assets/fonts/open-sans/OpenSans-Regular.ttf';
import jetBrainsMonoRegularFont from '../../../assets/fonts/jetbrains-mono/JetBrainsMono-Regular.ttf';

/** R11.8's three roles. */
export type FontRole = 'display' | 'body' | 'mono';

/** The icon atlas's name: the `font` a `drawText` of an icon selects (R12.6). */
export const ICON_ATLAS_ROLE = 'icons';

/** Every atlas the draw API loads: the three text roles and the icon atlas. */
export type AtlasRole = FontRole | typeof ICON_ATLAS_ROLE;

export interface FontFaceAsset<Role extends AtlasRole = FontRole> {
	readonly role: Role;
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
}

/**
 * The committed atlases, one face per role (R6.4). There is no body bold face,
 * so R11.8's weight table resolves `bold` on body to the display face.
 */
export const FONT_FACES: readonly FontFaceAsset[] = [
	{
		role: 'display',
		face: 'barlow-condensed-semibold',
		metrics: barlowCondensedSemiBoldMetrics,
		imageUrl: barlowCondensedSemiBoldImage,
		fontUrl: barlowCondensedSemiBoldFont,
	},
	{
		role: 'body',
		face: 'open-sans-regular',
		metrics: openSansRegularMetrics,
		imageUrl: openSansRegularImage,
		fontUrl: openSansRegularFont,
	},
	{
		role: 'mono',
		face: 'jetbrains-mono-regular',
		metrics: jetBrainsMonoRegularMetrics,
		imageUrl: jetBrainsMonoRegularImage,
		fontUrl: jetBrainsMonoRegularFont,
	},
];

/**
 * The icon atlas (R12.6), built by the same script from Material Icons with
 * the glyphs `src/assets/fonts/icons.txt` names, and addressed through the
 * generated `icons.ts`. It is drawn in `text` mode like any face.
 */
export const ICON_ATLAS: FontFaceAsset<typeof ICON_ATLAS_ROLE> = {
	role: ICON_ATLAS_ROLE,
	face: 'material-icons',
	metrics: materialIconsMetrics,
	imageUrl: materialIconsImage,
};

/** What the bootstraps load before the first frame (R2.18): the faces, then the icons. */
export const ATLAS_ASSETS: readonly FontFaceAsset<AtlasRole>[] = [...FONT_FACES, ICON_ATLAS];
