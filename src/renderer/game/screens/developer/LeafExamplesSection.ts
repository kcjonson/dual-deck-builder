import { CatalogSection } from './CatalogSection';
import { Container } from '../../../engine/components/Container';
import { Image, ImageFit } from '../../../engine/components/Image';
import { Line } from '../../../engine/components/Line';
import type { MountContext } from '../../../engine/components/MountContext';
import type { TextureHandle } from '../../../engine/draw/commands';
import type { ColorToken } from '../../../engine/theme/tokens';
import { tokens } from '../../../engine/theme/tokens';

const TILE_WIDTH = 96;
const TILE_HEIGHT = 64;
/** The test card: 32 by 16 texels, a 2 by 1 grid of 16 px frames, each four quadrants of colour. */
const ART_WIDTH = 32;
const ART_HEIGHT = 16;

/** Texels for the test card, straight RGBA bytes: frame 0 warm, frame 1 cool, each split in quadrants. */
function testCard(): Uint8Array {
	const warm: ColorToken[] = ['accent', 'status_crit', 'accent_dim', 'text'];
	const cool: ColorToken[] = ['data', 'status_ok', 'data_dim', 'text_bright'];
	const texels = new Uint8Array(ART_WIDTH * ART_HEIGHT * 4);
	for (let y = 0; y < ART_HEIGHT; y++) {
		for (let x = 0; x < ART_WIDTH; x++) {
			const frame = x < 16 ? warm : cool;
			const quadrant = (x % 16 < 8 ? 0 : 1) + (y < 8 ? 0 : 2);
			const color = tokens.color[frame[quadrant]];
			const index = (y * ART_WIDTH + x) * 4;
			for (let channel = 0; channel < 4; channel++) texels[index + channel] = Math.round(color[channel] * 255);
		}
	}
	return texels;
}

/**
 * The catalog's two newer leaves (R12.3, R12.5): lines at several
 * thicknesses with butt and round caps, and images of a generated test card
 * in each fit, as one sprite frame, tinted, and as a placeholder for art that
 * is not resident. The texture is created on mount, outside any frame
 * (R2.17), and destroyed on unmount.
 */
export class LeafExamplesSection extends CatalogSection {
	private readonly images: Image[] = [];
	private art: TextureHandle | null = null;

	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_leaves', title: 'Lines and Images', x, y, width });

		const lines = new Container({ id: 'dev_lines', width: 560, height: 60 });
		const tones: ColorToken[] = ['text', 'accent', 'data', 'status_ok', 'status_crit', 'text_dim'];
		[1, 2, 3, 4, 6, 8].forEach((thickness, index) => {
			// Each line's box is its endpoints' extent, so the six sit side by side.
			lines.addChild(new Line({
				x: index * 92 + 8,
				y: 8,
				start: { x: 0, y: 0 },
				end: { x: 60, y: 42 },
				thickness,
				cap: index % 2 === 0 ? 'butt' : 'round',
				style: { color: tones[index] },
			}));
		});
		this.addRow('line: 1, 2, 3, 4, 6, 8 px; butt and round caps alternate', lines, 60);

		const fits: ImageFit[] = ['fill', 'contain', 'cover', 'none'];
		const tiles = fits.map((fit) => this.image(`dev_image_${fit}`, { fit }));
		tiles.push(this.image('dev_image_frame', { sourceRect: { x: 16, y: 0, width: 16, height: 16 }, fit: 'contain' }));
		tiles.push(this.image('dev_image_tint', { tint: 'accent', fit: 'contain' }));
		tiles.push(new Image({ id: 'dev_image_placeholder', width: TILE_WIDTH, height: TILE_HEIGHT, style: { backgroundColor: 'bg_inset' } }));
		this.addRow('image: fill, contain, cover, none; frame 2 of 2; tinted; placeholder', this.line(tiles, tokens.space.space_4), TILE_HEIGHT);
	}

	protected onMount(context: MountContext): void {
		super.onMount(context);
		this.art = context.draw.createTexture({ width: ART_WIDTH, height: ART_HEIGHT, label: 'dev_test_card', source: testCard(), immediate: true });
		for (const image of this.images) image.texture = this.art;
	}

	protected onUnmount(): void {
		for (const image of this.images) image.texture = null;
		if (this.art) this.context?.draw.destroyTexture(this.art);
		this.art = null;
		super.onUnmount();
	}

	private image(id: string, options: { fit: ImageFit; sourceRect?: { x: number; y: number; width: number; height: number }; tint?: ColorToken }): Image {
		const image = new Image({ id, width: TILE_WIDTH, height: TILE_HEIGHT, style: { backgroundColor: 'bg_inset' }, ...options });
		this.images.push(image);
		return image;
	}
}
