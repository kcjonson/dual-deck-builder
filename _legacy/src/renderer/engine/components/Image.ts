import { Component, ComponentOptions, ResolvedColors } from './Component';
import type { MountContext } from './MountContext';
import type { TextureHandle } from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA, Rect } from '../draw/geometry';
import type { AssetRef } from '../services/AssetService';
import { ColorValue, StyleProperties, StyleProperty, resolveColor, validateStyle } from '../style/styleObject';

/** R12.5's fit of the texture into the box. */
export type ImageFit = 'fill' | 'contain' | 'cover' | 'none';

/** R11.14's properties an image renders: `backgroundColor` is the placeholder fill. */
export type ImageStyleObject = Pick<StyleProperties, 'backgroundColor' | 'opacity'>;

export interface ImageOptions extends Omit<ComponentOptions, 'style'> {
	/** An asset key, acquired from the mount context's asset cache on mount and released on unmount. */
	src?: string;
	/** A texture the caller owns, instead of `src`. */
	texture?: TextureHandle | null;
	/** The part of the texture to draw, in texture pixels (a sprite frame); the whole texture by default. */
	sourceRect?: Rect | null;
	/** R5.18's multiplied tint; white draws the texture as it is. */
	tint?: ColorValue;
	/** Default `fill`. */
	fit?: ImageFit;
	style?: ImageStyleObject;
}

const IMAGE_STYLE = { component: 'Image', properties: new Set<StyleProperty>(['backgroundColor', 'opacity']), states: new Set<never>() };
const WHITE: RGBA = [1, 1, 1, 1];

/**
 * R12.5's image: a texture drawn into the box by `fit`, from a `sourceRect`
 * (sprite frames are `sourceRect` changes), with a `tint`. Layout sizes the
 * box, never the texture. A texture that is not resident yet draws the
 * placeholder (the style's `backgroundColor`, or nothing), and the image is
 * drawn from the first frame after it arrives: the frame renders every frame,
 * so nothing has to be requested. Textures from `src` are the asset cache's,
 * held from mount to unmount (R12.32); a failed load keeps the placeholder
 * and is not an error here, since the asset cache reports it.
 */
export class Image extends Component {
	private source: string | null;
	private ownTexture: TextureHandle | null;
	private assetRef: AssetRef | null = null;
	private frameRect: Rect | null;
	private imageTint: RGBA;
	private imageFit: ImageFit;
	private placeholder: RGBA | null = null;
	private styleObject: ImageStyleObject = {};

	constructor({ src, texture = null, sourceRect = null, tint, fit = 'fill', style = {}, ...options }: ImageOptions = {}) {
		super(options);
		this.componentType = 'Image';
		if (src !== undefined && texture) throw new Error('Image: give `src` or `texture`, not both (R12.5)');
		this.source = src ?? null;
		this.ownTexture = texture;
		this.frameRect = sourceRect ? { ...sourceRect } : null;
		this.imageTint = tint !== undefined ? resolveColor(tint) : WHITE;
		this.imageFit = fit;
		this.style = style;
	}

	public get style(): ImageStyleObject {
		return this.styleObject;
	}

	/** R11.16: construction's path and validation; the new style replaces the old one whole. */
	public set style(style: ImageStyleObject) {
		validateStyle(style, IMAGE_STYLE);
		this.styleObject = style;
		this.placeholder = style.backgroundColor !== undefined ? resolveColor(style.backgroundColor) : null;
		if (style.opacity !== undefined) this.opacity = style.opacity;
	}

	/** The texture drawn now: the caller's, or the asset cache's once it is resident; null draws the placeholder. */
	public get texture(): TextureHandle | null {
		return this.ownTexture ?? this.assetRef?.texture ?? null;
	}

	public set texture(texture: TextureHandle | null) {
		this.releaseAsset();
		this.source = null;
		this.ownTexture = texture;
	}

	public get src(): string | null {
		return this.source;
	}

	/** A new key: the old one is released, and the new one acquired now if mounted. */
	public set src(src: string | null) {
		if (src === this.source) return;
		this.releaseAsset();
		this.ownTexture = null;
		this.source = src;
		if (this.context) this.acquireAsset(this.context);
	}

	public get sourceRect(): Rect | null {
		return this.frameRect;
	}

	public set sourceRect(rect: Rect | null) {
		this.frameRect = rect ? { ...rect } : null;
	}

	public get tint(): RGBA {
		return this.imageTint;
	}

	public set tint(tint: ColorValue) {
		this.imageTint = resolveColor(tint);
	}

	public get fit(): ImageFit {
		return this.imageFit;
	}

	public set fit(fit: ImageFit) {
		this.imageFit = fit;
	}

	public get resolvedColors(): ResolvedColors | null {
		if (this.texture) return { fill: this.imageTint };
		return this.placeholder ? { fill: this.placeholder } : null;
	}

	protected onMount(context: MountContext): void {
		this.acquireAsset(context);
	}

	protected onUnmount(): void {
		this.releaseAsset();
	}

	public render(draw: DrawApi): void {
		const { width, height } = this;
		if (width <= 0 || height <= 0) return;
		const texture = this.texture;
		if (!texture) {
			if (this.placeholder) draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: 0, width, height }, fill: this.placeholder });
			return;
		}
		const source = this.frameRect ?? { x: 0, y: 0, width: texture.width, height: texture.height };
		const placed = fitRects(this.imageFit, source, width, height);
		if (!placed) return;
		draw.drawImage({
			id: this.id ?? undefined,
			rect: placed.rect,
			texture,
			sourceRect: placed.source,
			sourceSpace: 'pixels',
			tint: this.imageTint,
		});
	}

	private acquireAsset(context: MountContext): void {
		if (this.source === null || this.assetRef) return;
		this.assetRef = context.assets.acquire(this.source);
		// A failed load keeps the placeholder; the cache has the failure.
		this.assetRef.ready.catch(() => undefined);
	}

	private releaseAsset(): void {
		this.assetRef?.release();
		this.assetRef = null;
	}
}

/**
 * Where `source` (texture pixels) lands in a `width` by `height` box, and the
 * part of it that is drawn: `fill` stretches, `contain` letterboxes, `cover`
 * crops the source to the box's aspect, `none` draws at texture size,
 * centred, cropped to the box. Null when nothing would be drawn.
 */
export function fitRects(fit: ImageFit, source: Rect, width: number, height: number): { rect: Rect; source: Rect } | null {
	if (source.width <= 0 || source.height <= 0) return null;
	switch (fit) {
		case 'fill':
			return { rect: { x: 0, y: 0, width, height }, source };
		case 'contain': {
			const scale = Math.min(width / source.width, height / source.height);
			const w = source.width * scale;
			const h = source.height * scale;
			return { rect: { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }, source };
		}
		case 'cover': {
			const scale = Math.max(width / source.width, height / source.height);
			const w = width / scale;
			const h = height / scale;
			return {
				rect: { x: 0, y: 0, width, height },
				source: { x: source.x + (source.width - w) / 2, y: source.y + (source.height - h) / 2, width: w, height: h },
			};
		}
		case 'none': {
			const w = Math.min(source.width, width);
			const h = Math.min(source.height, height);
			return {
				rect: { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h },
				source: { x: source.x + (source.width - w) / 2, y: source.y + (source.height - h) / 2, width: w, height: h },
			};
		}
	}
}
