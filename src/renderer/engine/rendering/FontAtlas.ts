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

/**
 * Font atlas that manages character textures for efficient text rendering
 */
export class FontAtlas {
	private canvas: HTMLCanvasElement;
	private context: CanvasRenderingContext2D;
	private texture: WebGLTexture | null = null;
	private gl: WebGL2RenderingContext;
	private characters: Map<string, CharacterInfo> = new Map();
	private fontFamily: string;
	private fontSize: number;
	private atlasSize: number;
	private lineHeight: number;

	constructor(
		gl: WebGL2RenderingContext,
		fontFamily = 'Arial',
		fontSize = 16,
		atlasSize = 512
	) {
		this.gl = gl;
		this.fontFamily = fontFamily;
		this.fontSize = fontSize;
		this.atlasSize = atlasSize;

		// Create high-DPI canvas for rendering characters
		const devicePixelRatio = window.devicePixelRatio || 1;
		this.canvas = document.createElement('canvas');
		this.canvas.width = atlasSize * devicePixelRatio;
		this.canvas.height = atlasSize * devicePixelRatio;
		const context = this.canvas.getContext('2d');
		if (!context) {
			throw new Error('Failed to get 2D context for font atlas');
		}
		this.context = context;
		this.context.scale(devicePixelRatio, devicePixelRatio);

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
	 * Uploads the atlas canvas into a new immutable texture: `texStorage2D`
	 * once, then `texSubImage2D` (R15.18), so ANGLE never re-specifies a live
	 * texture. The canvas stays alive as the CPU-side copy, which is what a
	 * restored context uploads again (R15.5); the previous texture died with
	 * the old context and is not deleted.
	 *
	 * No colour-space conversion (R15.19). No premultiplication either: the
	 * canvas is opaque, white glyphs on black, and the shader reads the red
	 * channel as coverage, so this is a mask rather than a colour texture.
	 */
	public upload(): void {
		const gl = this.gl;
		this.texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.canvas.width, this.canvas.height);
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		gl.bindTexture(gl.TEXTURE_2D, null);
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
		return this.texture;
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
			this.gl.deleteTexture(this.texture);
			this.texture = null;
		}
		this.characters.clear();
	}
}