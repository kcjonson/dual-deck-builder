import { TexelSource, TextureDescription, TextureDevice, TextureRegion } from '../gpu/TextureStore';

/**
 * WebGL2 has at least 32 combined texture units (the ES 3.0 minimum for
 * `MAX_COMBINED_TEXTURE_IMAGE_UNITS`) and a fragment shader samples at most 16
 * (R15.20), so the last unit is never one a draw reads. Uploads bind there and
 * leave every unit the backend bound for drawing alone, which is what lets an
 * upload happen between two flushes without the backend re-binding anything.
 */
const UPLOAD_UNIT = 31;

/**
 * The GPU half of the resource layer, for WebGL2.
 *
 * R15.18: storage is `texStorage2D` once, contents are `texSubImage2D`, and a
 * live texture is never re-specified with `texImage2D`. R15.19: no colour
 * management on upload, and colour sources premultiplied (a `Uint8Array` is
 * premultiplied by contract, R5.18, so the flag only matters for a DOM
 * source); masks and distance fields go up raw. UI textures sample `LINEAR`
 * without mipmaps; the mipmapped art array is phase 6's.
 *
 * Both pixel-store flags are set on every upload rather than tracked. They are
 * global state a foreign pass could change, uploads are rare, and a stale flag
 * is a wrong picture rather than a slow one.
 */
export class WebGL2TextureDevice implements TextureDevice<WebGLTexture> {
	private readonly gl: WebGL2RenderingContext;

	constructor({ gl }: { gl: WebGL2RenderingContext }) {
		this.gl = gl;
	}

	allocate({ width, height }: TextureDescription): WebGLTexture {
		const gl = this.gl;
		const texture = gl.createTexture();
		// Null only on a lost context, whose restore rebuilds every texture anyway.
		if (!texture) throw new Error('WebGL2TextureDevice: could not create a texture');
		gl.activeTexture(gl.TEXTURE0 + UPLOAD_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return texture;
	}

	upload(texture: WebGLTexture, { width, height, content }: TextureDescription, source: TexelSource): void {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + UPLOAD_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, content === 'color' && !(source instanceof Uint8Array));
		if (source instanceof Uint8Array) {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, source);
		} else {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
		}
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	uploadRegion(texture: WebGLTexture, { x, y, width, height }: TextureRegion, texels: Uint8Array): void {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + UPLOAD_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, texels);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	release(texture: WebGLTexture): void {
		this.gl.deleteTexture(texture);
	}
}
