import type { TextureHandle } from '../draw/commands';
import type { TextureStore } from '../gpu/TextureStore';

/**
 * Character information in the font atlas
 */
export interface CharacterInfo {
	x: number;        // UV coordinates in atlas
	y: number;
	width: number;    // Character dimensions in atlas
	height: number;
	offsetX: number;  // Rendering offset from baseline
	offsetY: number;
	advance: number;  // Horizontal advance to next character
}

export interface FontAtlasOptions {
	/** The resource layer the atlas texture belongs to (R5.30). */
	textures: TextureStore<WebGLTexture>;
	fontFamily?: string;
	fontSize?: number;
	/** Logical size of the square atlas. */
	atlasSize?: number;
	/**
	 * Device pixels per logical pixel (R7.2) to rasterise at: a fallback
	 * raster size, which is one of the ratio's named consumers. Read once; the
	 * atlas does not follow a later ratio change, and chapter 6's distance-field
	 * atlases, which do not need to, replace it.
	 */
	ratio?: number;
}

/**
 * Font atlas that manages character textures for efficient text rendering
 */
export class FontAtlas {
	private canvas: HTMLCanvasElement;
	private context: CanvasRenderingContext2D;
	private readonly textures: TextureStore<WebGLTexture>;
	private texture: TextureHandle | null = null;
	private characters: Map<string, CharacterInfo> = new Map();
	private fontFamily: string;
	private fontSize: number;
	private atlasSize: number;
	private lineHeight: number;

	constructor({ textures, fontFamily = 'Arial', fontSize = 16, atlasSize = 512, ratio = 1 }: FontAtlasOptions) {
		this.textures = textures;
		this.fontFamily = fontFamily;
		this.fontSize = fontSize;
		this.atlasSize = atlasSize;

		// Create high-DPI canvas for rendering characters
		this.canvas = document.createElement('canvas');
		this.canvas.width = atlasSize * ratio;
		this.canvas.height = atlasSize * ratio;
		const context = this.canvas.getContext('2d');
		if (!context) {
			throw new Error('Failed to get 2D context for font atlas');
		}
		this.context = context;
		this.context.scale(ratio, ratio);

		// Configure text rendering with anti-aliasing for smooth edges
		this.context.font = `${fontSize}px ${fontFamily}`;
		this.context.textBaseline = 'top';
		this.context.fillStyle = 'white';
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';

		// Calculate line height
		// const metrics = this.context.measureText('Mg'); // For future use with actual metrics
		this.lineHeight = fontSize * 1.2; // Standard line height

		this.generateAtlas();
	}

	/**
	 * Generate the font atlas texture with all printable ASCII characters
	 */
	private generateAtlas(): void {
		// Clear canvas with black background for better debugging
		this.context.fillStyle = 'black';
		this.context.fillRect(0, 0, this.atlasSize, this.atlasSize);
		this.context.fillStyle = 'white';

		// Define character set (printable ASCII)
		const chars = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
		
		let x = 0;
		let y = 0;
		const padding = 1; // Reduce padding for better texture utilization
		const maxRowHeight = Math.ceil(this.fontSize * 1.2); // More accurate row height

		for (let i = 0; i < chars.length; i++) {
			const char = chars[i];
			const metrics = this.context.measureText(char);
			const charWidth = Math.ceil(metrics.width) + padding * 2;
			const charHeight = maxRowHeight;

			// Check if we need to move to next row
			if (x + charWidth > this.atlasSize) {
				x = 0;
				y += maxRowHeight;
				
				// Check if we've run out of space
				if (y + charHeight > this.atlasSize) {
					console.warn(`FontAtlas: Ran out of space for character '${char}'`);
					break;
				}
			}

			// Render character to canvas (position properly within character area)
			this.context.fillText(char, x + padding, y + padding);

			// Store character info (UV coordinates normalized to 0-1)
			const charInfo = {
				x: x / this.atlasSize,
				y: y / this.atlasSize,
				width: charWidth / this.atlasSize,
				height: charHeight / this.atlasSize,
				offsetX: 0,
				offsetY: 0,
				advance: metrics.width
			};
			
			this.characters.set(char, charInfo);

			x += charWidth;
		}

		this.upload();
	}

	/**
	 * Hands the atlas canvas to the resource layer as an immediate, kept
	 * texture: it is on the GPU before the first frame (R2.18), and the canvas
	 * is the CPU-side copy a restored context uploads again (R15.5). A `mask`,
	 * so it goes up without premultiplication: the canvas is opaque, white
	 * glyphs on black, and the shader reads the red channel as coverage.
	 * `WebGL2TextureDevice` allocates it with `texStorage2D` and fills it with
	 * `texSubImage2D` exactly as this method used to (R15.18, R15.19).
	 */
	private upload(): void {
		this.texture = this.textures.create({
			width: this.canvas.width,
			height: this.canvas.height,
			label: `font atlas ${this.fontFamily} ${this.fontSize}`,
			source: this.canvas,
			content: 'mask',
			keepSource: true,
			immediate: true,
		});
	}

	/**
	 * Get character information for a specific character
	 */
	public getCharacter(char: string): CharacterInfo | null {
		return this.characters.get(char) || null;
	}

	/**
	 * Get the WebGL texture
	 */
	public getTexture(): WebGLTexture | null {
		return this.texture ? this.textures.native(this.texture) : null;
	}

	/**
	 * Get font metrics
	 */
	public getFontSize(): number {
		return this.fontSize;
	}

	public getAtlasSize(): number {
		return this.atlasSize;
	}

	/**
	 * Measure text dimensions
	 */
	public measureText(text: string): { width: number; height: number } {
		let width = 0;
		const height = this.lineHeight;

		for (let i = 0; i < text.length; i++) {
			const char = this.getCharacter(text[i]);
			if (char) {
				width += char.advance;
			}
		}

		return { width, height };
	}

	/**
	 * Unmount and clean up resources
	 */
	public unmount(): void {
		if (this.texture) {
			this.textures.release(this.texture);
			this.texture = null;
		}
		this.characters.clear();
	}
}