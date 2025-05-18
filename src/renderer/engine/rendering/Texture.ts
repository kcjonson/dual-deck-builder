/**
 * Texture class for loading and binding WebGL textures
 */
export class Texture {
	private gl: WebGLRenderingContext;
	private textureId: WebGLTexture | null;
	private width = 0;
	private height = 0;

	/**
	 * Create a new texture object
	 * @param gl WebGL rendering context
	 */
	constructor(gl: WebGLRenderingContext) {
		this.gl = gl;
		this.textureId = this.gl.createTexture();
	}

	/**
	 * Load an image from URL and create a texture
	 * @param url Path to the image
	 * @returns Promise that resolves when texture is loaded
	 */
	public loadFromUrl(url: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => {
				this.loadFromImage(image);
				resolve();
			};
			image.onerror = () => {
				reject(new Error(`Failed to load texture: ${url}`));
			};
			image.src = url;
		});
	}

	/**
	 * Create a texture from an HTML Image element
	 * @param image The source image
	 */
	public loadFromImage(image: HTMLImageElement): void {
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.textureId);

		// Store dimensions
		this.width = image.width;
		this.height = image.height;

		// Upload the image to the texture
		this.gl.texImage2D(
			this.gl.TEXTURE_2D,
			0,
			this.gl.RGBA,
			this.gl.RGBA,
			this.gl.UNSIGNED_BYTE,
			image,
		);

		// Generate mipmaps
		this.gl.generateMipmap(this.gl.TEXTURE_2D);

		// Set texture parameters
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_MIN_FILTER,
			this.gl.LINEAR_MIPMAP_LINEAR,
		);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

		// Unbind the texture
		this.gl.bindTexture(this.gl.TEXTURE_2D, null);
	}

	/**
	 * Create an empty texture with specified dimensions
	 * @param width Texture width in pixels
	 * @param height Texture height in pixels
	 */
	public createEmpty(width: number, height: number): void {
		this.width = width;
		this.height = height;

		this.gl.bindTexture(this.gl.TEXTURE_2D, this.textureId);

		// Create empty texture with specified dimensions
		this.gl.texImage2D(
			this.gl.TEXTURE_2D,
			0,
			this.gl.RGBA,
			width,
			height,
			0,
			this.gl.RGBA,
			this.gl.UNSIGNED_BYTE,
			null,
		);

		// Set texture parameters
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

		// Unbind the texture
		this.gl.bindTexture(this.gl.TEXTURE_2D, null);
	}

	/**
	 * Bind this texture to a texture unit
	 * @param unit Texture unit (default: 0)
	 */
	public bind(unit = 0): void {
		this.gl.activeTexture(this.gl.TEXTURE0 + unit);
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.textureId);
	}

	/**
	 * Unbind this texture
	 */
	public unbind(): void {
		this.gl.bindTexture(this.gl.TEXTURE_2D, null);
	}

	/**
	 * Clean up resources
	 */
	public destroy(): void {
		this.gl.deleteTexture(this.textureId);
		this.textureId = null;
	}

	/**
	 * Get the texture width
	 */
	public getWidth(): number {
		return this.width;
	}

	/**
	 * Get the texture height
	 */
	public getHeight(): number {
		return this.height;
	}
}
