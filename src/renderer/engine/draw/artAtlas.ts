import type { DrawApi } from './DrawApi';
import type { TextureHandle } from './commands';
import type { RGBA, Rect } from './geometry';

/**
 * What a piece's tint multiplies (R5.18): `surface` is white paper with its
 * wear multiplied in, tinted with the paper token so the flat centre comes out
 * exactly that colour; `ink` is white coverage for an ink colour; `none` is
 * baked colour, drawn with white.
 */
export type ArtTint = 'surface' | 'ink' | 'none';

export interface ArtSlice {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
}

/** One piece of an art atlas page: its rect in texture pixels, and how it draws. */
export interface ArtPiece {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	/** Texels per logical pixel: 2 for the 2x raster of a 1x piece. */
	readonly scale: number;
	readonly tint: ArtTint;
	/** R5.19's insets in texture pixels; only 1x pieces are sliced, since a corner draws one logical pixel per texel. */
	readonly slice?: ArtSlice;
}

/** An offline-built atlas page (R5.31's UI atlases): its size and named pieces. */
export interface ArtAtlasManifest {
	readonly width: number;
	readonly height: number;
	readonly pieces: { readonly [name: string]: ArtPiece };
}

/**
 * The problems with a manifest, none when it is sound: every piece inside the
 * page, no two overlapping, insets that leave a centre, and slices only on 1x
 * pieces. A generated manifest that fails this was generated wrong.
 */
export function validateArtAtlas(manifest: ArtAtlasManifest): string[] {
	const problems: string[] = [];
	const entries = Object.entries(manifest.pieces);
	for (const [name, piece] of entries) {
		const { x, y, width, height, scale, slice } = piece;
		if (![x, y, width, height].every(Number.isInteger) || width <= 0 || height <= 0) {
			problems.push(`${name}: rect ${x},${y} ${width}x${height} is not a positive integer rect`);
		} else if (x < 0 || y < 0 || x + width > manifest.width || y + height > manifest.height) {
			problems.push(`${name}: rect ${x},${y} ${width}x${height} leaves the ${manifest.width}x${manifest.height} page`);
		}
		if (scale !== 1 && scale !== 2) problems.push(`${name}: scale ${scale} is not 1 or 2`);
		if (slice) {
			if (scale !== 1) problems.push(`${name}: a sliced piece has to be 1x`);
			if (slice.left + slice.right >= width || slice.top + slice.bottom >= height) {
				problems.push(`${name}: insets ${slice.top} ${slice.right} ${slice.bottom} ${slice.left} leave no centre in ${width}x${height}`);
			}
		}
	}
	for (let first = 0; first < entries.length; first++) {
		for (let second = first + 1; second < entries.length; second++) {
			const [nameA, a] = entries[first];
			const [nameB, b] = entries[second];
			if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
				problems.push(`${nameA} overlaps ${nameB}`);
			}
		}
	}
	return problems;
}

/** The part of a decoded image the loader checks; `HTMLImageElement` satisfies it. */
export interface ArtAtlasImage {
	readonly naturalWidth: number;
	readonly naturalHeight: number;
}

export class ArtAtlasError extends Error {
	constructor(atlas: string, message: string) {
		super(`art atlas ${atlas}: ${message}`);
		this.name = 'ArtAtlasError';
	}
}

export interface LoadArtAtlasOptions<Image extends ArtAtlasImage> {
	name: string;
	manifest: ArtAtlasManifest;
	/** The page as a bundler asset module (R15.34: no fetch). */
	imageUrl: string;
	loadImage: (url: string) => Promise<Image>;
}

/**
 * Decodes an atlas page and checks it is the size its manifest describes, the
 * one mistake the manifest alone cannot catch: a page rebuilt without its
 * manifest would sample the wrong texels for every piece.
 */
export async function loadArtAtlasImage<Image extends ArtAtlasImage>({
	name,
	manifest,
	imageUrl,
	loadImage,
}: LoadArtAtlasOptions<Image>): Promise<Image> {
	let image: Image;
	try {
		image = await loadImage(imageUrl);
	} catch (error) {
		throw new ArtAtlasError(name, `image failed to load (${error instanceof Error ? error.message : String(error)})`);
	}
	if (image.naturalWidth !== manifest.width || image.naturalHeight !== manifest.height) {
		throw new ArtAtlasError(name, `image is ${image.naturalWidth}x${image.naturalHeight} but the manifest describes ${manifest.width}x${manifest.height}`);
	}
	return image;
}

/** A piece's size in logical pixels at its native resolution. */
export function artSize(piece: ArtPiece): { width: number; height: number } {
	return { width: piece.width / piece.scale, height: piece.height / piece.scale };
}

const WHITE: RGBA = [1, 1, 1, 1];

export interface DrawArtOptions {
	texture: TextureHandle;
	piece: ArtPiece;
	rect: Rect;
	/** R5.18's multiplied tint; see `ArtTint` for what each piece expects. White by default. */
	tint?: RGBA;
	id?: string;
}

/**
 * One piece as an image draw from the resident atlas (R5.20): its source rect,
 * and its nine-slice insets when it has them (R5.19). A shape and an art piece
 * sharing a flush stay one GPU draw.
 */
export function drawArt(draw: DrawApi, { texture, piece, rect, tint = WHITE, id }: DrawArtOptions): void {
	draw.drawImage({
		id,
		rect,
		texture,
		// The piece is its own source rect; the draw API copies what it keeps.
		sourceRect: piece,
		sourceSpace: 'pixels',
		tint,
		slice: piece.slice,
	});
}
