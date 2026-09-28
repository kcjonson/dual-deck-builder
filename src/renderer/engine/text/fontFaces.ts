import barlowCondensedSemiBoldMetrics from '../../../assets/fonts/barlow-condensed-semibold.json';
import barlowCondensedSemiBoldImage from '../../../assets/fonts/barlow-condensed-semibold.png';
import openSansRegularMetrics from '../../../assets/fonts/open-sans-regular.json';
import openSansRegularImage from '../../../assets/fonts/open-sans-regular.png';
import jetBrainsMonoRegularMetrics from '../../../assets/fonts/jetbrains-mono-regular.json';
import jetBrainsMonoRegularImage from '../../../assets/fonts/jetbrains-mono-regular.png';

/** R11.8's three roles. */
export type FontRole = 'display' | 'body' | 'mono';

export interface FontFaceAsset {
	readonly role: FontRole;
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
	},
	{
		role: 'body',
		face: 'open-sans-regular',
		metrics: openSansRegularMetrics,
		imageUrl: openSansRegularImage,
	},
	{
		role: 'mono',
		face: 'jetbrains-mono-regular',
		metrics: jetBrainsMonoRegularMetrics,
		imageUrl: jetBrainsMonoRegularImage,
	},
];
