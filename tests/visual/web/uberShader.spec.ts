import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DrawApi, RecordingBackend } from '../../../src/renderer/engine/draw';
import { Batcher } from '../../../src/renderer/engine/draw/Batcher';
import { ResidentTextureSet } from '../../../src/renderer/engine/draw/ResidentTextureSet';
import {
	UBER_ATTRIBUTES,
	UBER_TEXTURE_UNITS,
	UBER_VERTEX,
	UberGeometryEncoder,
} from '../../../src/renderer/engine/rendering/UberGeometryEncoder';

/**
 * Chapter 5's pixel tests (5.10) and chapter 4's fragment-test fixture (4.7),
 * run on the real uber shader in the harness's SwiftShader, as numbers rather
 * than pictures.
 *
 * The geometry is the production path in Node: commands from the draw API,
 * encoded by `UberGeometryEncoder` through the `Batcher`. The page gets the
 * resulting floats and indices, compiles `uber.vert` and `uber.frag` from
 * the source tree on a bare canvas, draws them with premultiplied `over`, and
 * reads the framebuffer back. Nothing of the game is loaded, so a failure
 * here is the shader's or the encoder's and nobody else's.
 */

const SHADERS = join(__dirname, '../../../src/assets/shaders');
const VERTEX_SOURCE = readFileSync(join(SHADERS, 'uber.vert'), 'utf8');
const FRAGMENT_SOURCE = readFileSync(join(SHADERS, 'uber.frag'), 'utf8');

interface Target {
	/** Device pixels. */
	width: number;
	height: number;
	ratio: number;
	/** Straight RGBA, 0 to 1. */
	clear: [number, number, number, number];
}

interface Frame {
	pixels: number[];
	width: number;
	height: number;
}

/** The draw API and the encoder, as the backend drives them, into one upload. */
function encode(target: Target, build: (api: DrawApi) => void): { floats: number[]; indices: number[] } {
	const backend = new RecordingBackend({ maxFrames: 1 });
	const api = new DrawApi({ backend, strict: true });
	api.beginFrame({ viewport: { width: target.width / target.ratio, height: target.height / target.ratio }, ratio: target.ratio });
	build(api);
	api.endFrame();

	const encoder = new UberGeometryEncoder({
		glyphs: {
			getCharacter: () => null,
			getFontSize: () => 16,
			getAtlasSize: () => 1,
			measureText: () => ({ width: 0, height: 0 }),
		},
		onUnpaintable: (kind, detail) => {
			throw new Error(`${kind}: ${detail}`);
		},
	});
	encoder.ratio = target.ratio;
	const batcher = new Batcher({ encoder, textures: new ResidentTextureSet({ units: UBER_TEXTURE_UNITS }) });
	let floats: number[] = [];
	let indices: number[] = [];
	batcher.flush(backend.commands, (upload) => {
		if (floats.length > 0) throw new Error('expected one upload');
		floats = Array.from(upload.vertices.subarray(0, upload.floatCount));
		indices = Array.from(upload.indices.subarray(0, upload.indexCount));
	});
	return { floats, indices };
}

async function render(page: Page, target: Target, build: (api: DrawApi) => void): Promise<Frame> {
	const geometry = encode(target, build);
	return page.evaluate(({ target, geometry, sources, attributes, stride, units }) => {
		const canvas = document.createElement('canvas');
		canvas.width = target.width;
		canvas.height = target.height;
		const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, depth: false });
		if (!gl) throw new Error('no WebGL2 context');

		const compile = (type: number, source: string) => {
			const shader = gl.createShader(type) as WebGLShader;
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile');
			return shader;
		};
		const program = gl.createProgram() as WebGLProgram;
		gl.attachShader(program, compile(gl.VERTEX_SHADER, sources.vertex));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, sources.fragment));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
		gl.useProgram(program);

		// Every sampler on a 1x1 transparent texture, as the backend does.
		const empty = gl.createTexture();
		const unitIndices = new Int32Array(units);
		for (let unit = 0; unit < units; unit++) {
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_2D, empty);
			if (unit === 0) {
				gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
				gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
			}
			unitIndices[unit] = unit;
		}
		gl.uniform1iv(gl.getUniformLocation(program, 'uTextures[0]'), unitIndices);

		// The frame block: an orthographic projection of the logical viewport, y down.
		const width = target.width / target.ratio;
		const height = target.height / target.ratio;
		const projection = new Float32Array([
			2 / width, 0, 0, 0,
			0, -2 / height, 0, 0,
			0, 0, -1, 0,
			-1, 1, 0, 1,
		]);
		const uniforms = gl.createBuffer();
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms);
		gl.bufferData(gl.UNIFORM_BUFFER, projection, gl.STATIC_DRAW);
		gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'Frame'), 0);
		gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, uniforms);

		const vertexArray = gl.createVertexArray();
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.floats), gl.STATIC_DRAW);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(geometry.indices), gl.STATIC_DRAW);
		for (const attribute of attributes) {
			gl.enableVertexAttribArray(attribute.location);
			gl.vertexAttribPointer(attribute.location, attribute.size, gl.FLOAT, false, stride, attribute.offset * 4);
		}

		gl.viewport(0, 0, target.width, target.height);
		const [r, g, b, a] = target.clear;
		gl.clearColor(r * a, g * a, b * a, a);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.drawElements(gl.TRIANGLES, geometry.indices.length, gl.UNSIGNED_INT, 0);

		const pixels = new Uint8Array(target.width * target.height * 4);
		gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		return { pixels: Array.from(pixels), width: target.width, height: target.height };
	}, {
		target,
		geometry,
		sources: { vertex: VERTEX_SOURCE, fragment: FRAGMENT_SOURCE },
		attributes: UBER_ATTRIBUTES.map((attribute) => ({ ...attribute })),
		stride: UBER_VERTEX.floats * 4,
		units: UBER_TEXTURE_UNITS,
	});
}

/** The RGBA of the device pixel at column `x`, row `y` from the top. */
function pixel(frame: Frame, x: number, y: number): number[] {
	const offset = ((frame.height - 1 - y) * frame.width + x) * 4;
	return frame.pixels.slice(offset, offset + 4);
}

const OPAQUE_BLACK: Target['clear'] = [0, 0, 0, 1];
const TRANSPARENT: Target['clear'] = [0, 0, 0, 0];

test.describe('uber shader', () => {
	test.beforeEach(async ({ page }) => {
		await page.setContent('<!doctype html><title>uber shader</title>');
	});

	test('keeps and discards whole device pixels by their centres against a logical clip (4.7, R4.4)', async ({ page }) => {
		for (const size of [{ width: 80, height: 80 }, { width: 200, height: 120 }]) {
			const frame = await render(page, { ...size, ratio: 2, clear: OPAQUE_BLACK }, (api) => {
				api.pushClip({ x: 10, y: 10, width: 10, height: 10 });
				api.drawRect({ rect: { x: 0, y: 0, width: 40, height: 40 }, fill: [1, 1, 1, 1] });
				api.popClip();
			});
			// Centre (20.5, 20.5) is logical (10.25, 10.25): inside.
			expect(pixel(frame, 20, 20)).toEqual([255, 255, 255, 255]);
			// Centre (19.5, 19.5) is logical (9.75, 9.75): outside.
			expect(pixel(frame, 19, 19)).toEqual([0, 0, 0, 255]);
			// Centre (40.5, 40.5) is logical (20.25, 20.25): outside the half-open max.
			expect(pixel(frame, 40, 40)).toEqual([0, 0, 0, 255]);
			expect(pixel(frame, 39, 39)).toEqual([255, 255, 255, 255]);
		}
	});

	test('ramps a fractional edge over exactly one device pixel on each side (R5.6, R5.7)', async ({ page }) => {
		const frame = await render(page, { width: 48, height: 8, ratio: 1, clear: OPAQUE_BLACK }, (api) => {
			api.drawRect({ rect: { x: 10.25, y: 0, width: 20, height: 8 }, fill: [1, 1, 1, 1] });
		});
		const row = (x: number) => pixel(frame, x, 4)[0];
		expect(row(9)).toBe(0);
		// Column 10 is three quarters covered, column 30 one quarter.
		expect(Math.abs(row(10) - 191)).toBeLessThanOrEqual(2);
		expect(row(11)).toBe(255);
		expect(row(29)).toBe(255);
		expect(Math.abs(row(30) - 64)).toBeLessThanOrEqual(2);
		expect(row(31)).toBe(0);
	});

	test('leaves no fill halo outside a dark border offset by half a pixel (R5.8)', async ({ page }) => {
		const clear: Target['clear'] = [0.5, 0.5, 0.5, 1];
		const frame = await render(page, { width: 40, height: 20, ratio: 1, clear }, (api) => {
			api.drawRect({
				rect: { x: 10.5, y: 2, width: 20, height: 16 },
				fill: [0.9, 0.9, 0.9, 1],
				border: { color: [0.1, 0.1, 0.1, 1], width: 1 },
			});
		});
		// Column 10 is half covered by the border and nothing else: 0.1 over
		// 0.5 at half coverage is 0.3, and no fill colour leaks in.
		expect(pixel(frame, 10, 10)[0]).toBeLessThanOrEqual(Math.round(0.3 * 255) + 2);
		expect(pixel(frame, 10, 10)[0]).toBeGreaterThanOrEqual(Math.round(0.3 * 255) - 2);
	});

	test('shows the fill through a translucent border and stays opaque (R5.8)', async ({ page }) => {
		const frame = await render(page, { width: 40, height: 40, ratio: 1, clear: TRANSPARENT }, (api) => {
			api.drawRect({ rect: { x: 4, y: 4, width: 32, height: 32 }, fill: [1, 0, 0, 1], border: { color: [0, 0, 1, 0.5], width: 4 } });
		});
		const [r, g, b, a] = pixel(frame, 5, 20);
		expect(a).toBe(255);
		expect(Math.abs(r - 128)).toBeLessThanOrEqual(2);
		expect(g).toBe(0);
		expect(Math.abs(b - 128)).toBeLessThanOrEqual(2);
	});

	test('draws a center border past the shape edge without clipping it to the quad (R5.7)', async ({ page }) => {
		const frame = await render(page, { width: 40, height: 40, ratio: 1, clear: OPAQUE_BLACK }, (api) => {
			api.drawRect({ rect: { x: 10, y: 10, width: 20, height: 20 }, fill: [1, 0, 0, 1], border: { color: [0, 1, 0, 1], width: 6, position: 'center' } });
		});
		// The border runs from x 7 to 13; column 7 is the outermost.
		expect(pixel(frame, 7, 20)).toEqual([0, 255, 0, 255]);
		expect(pixel(frame, 6, 20)).toEqual([0, 0, 0, 255]);
		expect(pixel(frame, 13, 20)).toEqual([255, 0, 0, 255]);
	});

	test('writes premultiplied colour over a transparent clear (R5.22)', async ({ page }) => {
		const frame = await render(page, { width: 8, height: 8, ratio: 1, clear: TRANSPARENT }, (api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 8, height: 8 }, fill: [1, 0, 0, 0.5] });
		});
		const [r, g, b, a] = pixel(frame, 4, 4);
		expect(Math.abs(r - 128)).toBeLessThanOrEqual(1);
		expect([g, b]).toEqual([0, 0]);
		expect(Math.abs(a - 128)).toBeLessThanOrEqual(1);
	});

	test('draws a flat triangle opaque inside, feathered at its edge (R5.2, R5.17)', async ({ page }) => {
		const frame = await render(page, { width: 40, height: 40, ratio: 1, clear: OPAQUE_BLACK }, (api) => {
			api.drawPolygon({ points: [{ x: 4, y: 4 }, { x: 36, y: 4 }, { x: 4, y: 36 }], fill: [0, 0, 1, 1] });
		});
		expect(pixel(frame, 10, 10)).toEqual([0, 0, 255, 255]);
		// Just past the hypotenuse, inside the feather: partly blue, not solid.
		const edge = pixel(frame, 20, 20)[2];
		expect(edge).toBeGreaterThan(0);
		expect(edge).toBeLessThan(255);
		expect(pixel(frame, 30, 30)).toEqual([0, 0, 0, 255]);
	});

	test('has no dark midpoint in a gradient to transparent (R5.9)', async ({ page }) => {
		const frame = await render(page, { width: 8, height: 40, ratio: 1, clear: TRANSPARENT }, (api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 8, height: 40 }, gradient: [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 0], [1, 0, 0, 0]] });
		});
		const [r, , , a] = pixel(frame, 4, 20);
		// Premultiplied red equals its alpha all the way down: the colour
		// never darkens, only the coverage falls.
		expect(Math.abs(r - a)).toBeLessThanOrEqual(1);
		expect(Math.abs(a - 128)).toBeLessThanOrEqual(8);
	});

	test('fades a 24 px shadow to nothing inside its quad, with no cutoff line (R5.11, R5.12)', async ({ page }) => {
		const frame = await render(page, { width: 200, height: 120, ratio: 1, clear: TRANSPARENT }, (api) => {
			api.drawRect({ rect: { x: 60, y: 40, width: 80, height: 40 }, fill: [1, 1, 1, 1], shadow: { color: [0, 0, 0, 1], blur: 24 } });
		});
		// Walk right from the owner's edge to the quad's (3 sigma = 36 px).
		let previous = 256;
		for (let x = 140; x < 178; x++) {
			const alpha = pixel(frame, x, 60)[3];
			expect(alpha).toBeLessThanOrEqual(previous);
			previous = alpha;
		}
		expect(pixel(frame, 140, 60)[3]).toBeGreaterThan(100);
		expect(previous).toBeLessThanOrEqual(1);
		expect(pixel(frame, 178, 60)[3]).toBe(0);
	});

	test('shows no seam between two rects that abut on the device grid (R5.10)', async ({ page }) => {
		const frame = await render(page, { width: 40, height: 8, ratio: 1, clear: OPAQUE_BLACK }, (api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 20, height: 8 }, fill: [1, 1, 1, 1] });
			api.drawRect({ rect: { x: 20, y: 0, width: 20, height: 8 }, fill: [1, 1, 1, 1] });
		});
		expect(pixel(frame, 19, 4)).toEqual([255, 255, 255, 255]);
		expect(pixel(frame, 20, 4)).toEqual([255, 255, 255, 255]);
	});

	test('rounds corners and anti-aliases a circle (R5.5, R5.15)', async ({ page }) => {
		const frame = await render(page, { width: 40, height: 40, ratio: 1, clear: OPAQUE_BLACK }, (api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 40, height: 20 }, radius: 10, fill: [1, 1, 1, 1] });
			api.drawCircle({ center: { x: 20, y: 30 }, radius: 8, fill: [1, 1, 1, 1] });
		});
		// The corner pixel of a 10 px radius is outside the arc.
		expect(pixel(frame, 0, 0)).toEqual([0, 0, 0, 255]);
		expect(pixel(frame, 20, 0)).toEqual([255, 255, 255, 255]);
		expect(pixel(frame, 20, 30)).toEqual([255, 255, 255, 255]);
		// On the circle's rim at 45 degrees coverage is partial.
		const rim = pixel(frame, 25, 35)[0];
		expect(rim).toBeGreaterThan(0);
		expect(rim).toBeLessThan(255);
	});
});
