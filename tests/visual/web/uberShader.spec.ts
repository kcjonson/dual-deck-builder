import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DrawApi, RecordingBackend, TextureHandle } from '../../../src/renderer/engine/draw';
import { Batcher } from '../../../src/renderer/engine/draw/Batcher';
import { ResidentTextureSet } from '../../../src/renderer/engine/draw/ResidentTextureSet';
import { parseFontAtlas } from '../../../src/renderer/engine/text/FontAtlas';
import { TextMetricsService } from '../../../src/renderer/engine/text/TextMetricsService';
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
	/** Textures to put on units before drawing, RGBA8 texels uploaded as given. */
	textures?: UnitTexture[];
}

interface UnitTexture {
	unit: number;
	width: number;
	height: number;
	texels: number[];
}

/**
 * One glyph, 'A', filling a 4x4 atlas: a quarter em square at 16 texels per
 * em with a range of 4, so at size 16 and ratio 1 the glyph quad is 4x4
 * device pixels, each sampling one texel at its centre, and the screen range
 * is 4 (R6.5). The atlas is the font role's resident texture, on unit 0 as in
 * the backend.
 */
const GLYPH_ATLAS = parseFontAtlas({
	source: 'one glyph',
	json: {
		atlas: { type: 'mtsdf', distanceRange: 4, distanceRangeMiddle: 0, size: 16, width: 4, height: 4, yOrigin: 'top' },
		metrics: { emSize: 1, lineHeight: 1.25, ascender: -1, descender: 0.25 },
		glyphs: [{
			unicode: 0x41,
			advance: 0.25,
			planeBounds: { left: 0, top: -0.25, right: 0.25, bottom: 0 },
			atlasBounds: { left: 0, top: 0, right: 4, bottom: 4 },
		}],
		kerning: [],
	},
});
const GLYPH_TEXTURE: TextureHandle = { id: 1, width: 4, height: 4, label: 'glyph atlas' };

interface Frame {
	pixels: number[];
	width: number;
	height: number;
}

/** The draw API and the encoder, as the backend drives them, into one upload. */
function encode(
	target: Target,
	build: (api: DrawApi) => void,
	prepare?: (api: DrawApi) => void,
): { floats: number[]; indices: number[] } {
	const backend = new RecordingBackend({ maxFrames: 1 });
	backend.loadFontAtlas({ name: 'body', atlas: GLYPH_ATLAS, texture: GLYPH_TEXTURE });
	const api = new DrawApi({ backend, strict: true });
	prepare?.(api);
	api.beginFrame({ viewport: { width: target.width / target.ratio, height: target.height / target.ratio }, ratio: target.ratio });
	build(api);
	api.endFrame();

	const text = new TextMetricsService();
	text.addAtlas({ name: 'body', atlas: GLYPH_ATLAS });
	const encoder = new UberGeometryEncoder({
		text,
		onUnpaintable: (kind, detail) => {
			throw new Error(`${kind}: ${detail}`);
		},
	});
	encoder.registerFontTexture('body', GLYPH_TEXTURE);
	encoder.ratio = target.ratio;
	const batcher = new Batcher({
		encoder,
		textures: new ResidentTextureSet({ units: UBER_TEXTURE_UNITS, resident: [GLYPH_TEXTURE] }),
	});
	let floats: number[] = [];
	let indices: number[] = [];
	batcher.flush(backend.commands, (upload) => {
		if (floats.length > 0) throw new Error('expected one upload');
		floats = Array.from(upload.vertices.subarray(0, upload.floatCount));
		indices = Array.from(upload.indices.subarray(0, upload.indexCount));
	});
	return { floats, indices };
}

async function render(
	page: Page,
	target: Target,
	build: (api: DrawApi) => void,
	prepare?: (api: DrawApi) => void,
): Promise<Frame> {
	const geometry = encode(target, build, prepare);
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

		// The given textures on their units, as `WebGL2TextureDevice` creates
		// them, and a 1x1 transparent texture on every other unit, as the
		// backend does.
		const texture = (width: number, height: number, texels: Uint8Array) => {
			const created = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, created);
			gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, texels);
			return created;
		};
		const empty = texture(1, 1, new Uint8Array(4));
		const unitIndices = new Int32Array(units);
		for (let unit = 0; unit < units; unit++) {
			const given = (target.textures ?? []).find((entry) => entry.unit === unit);
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_2D, given ? texture(given.width, given.height, new Uint8Array(given.texels)) : empty);
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
	test('samples an image from a dynamic unit, premultiplied, and multiplies its tint (R5.18, R5.20)', async ({ page }) => {
		// Premultiplied texels: opaque red, half green, opaque blue, transparent.
		const texels = [255, 0, 0, 255, 0, 128, 0, 128, 0, 0, 255, 255, 0, 0, 0, 0];
		const created: { art?: TextureHandle } = {};
		const prepare = (api: DrawApi) => {
			created.art = api.createTexture({ width: 2, height: 2, label: 'art' });
		};
		// The atlas is resident on unit 0, so the image is handed unit 1.
		const target: Target = { width: 16, height: 8, ratio: 1, clear: TRANSPARENT, textures: [{ unit: 1, width: 2, height: 2, texels }] };
		const frame = await render(page, target, (api) => {
			api.drawImage({ rect: { x: 0, y: 0, width: 8, height: 8 }, texture: created.art as TextureHandle });
			api.drawImage({ rect: { x: 8, y: 0, width: 8, height: 8 }, texture: created.art as TextureHandle, tint: [1, 1, 1, 0.5] });
		}, prepare);
		expect(pixel(frame, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(pixel(frame, 7, 0)).toEqual([0, 128, 0, 128]);
		expect(pixel(frame, 0, 7)).toEqual([0, 0, 255, 255]);
		expect(pixel(frame, 7, 7)).toEqual([0, 0, 0, 0]);
		// Half tint halves every premultiplied channel.
		const tinted = pixel(frame, 8, 0);
		expect(Math.abs(tinted[0] - 128)).toBeLessThanOrEqual(1);
		expect(Math.abs(tinted[3] - 128)).toBeLessThanOrEqual(1);
	});

	/** A 4x4 atlas whose four columns hold the given RGBA texels, top to bottom alike. */
	function columns(...texels: number[][]): number[] {
		const out: number[] = [];
		for (let row = 0; row < 4; row++) {
			for (let column = 0; column < 4; column++) out.push(...texels[column]);
		}
		return out;
	}

	test('shades a glyph by the median of the three channels with the linear ramp (R6.5)', async ({ page }) => {
		// Column 0: all three channels in, covered. Column 1: two of three in,
		// still covered (the median). Column 2: one of three in, empty, where a
		// max or a single channel would cover it. Column 3: all at 0.6, which a
		// screen range of 4 ramps to 0.5 + 4 * 0.1.
		const texels = columns([255, 255, 255, 255], [255, 0, 255, 255], [255, 0, 0, 255], [153, 153, 153, 255]);
		const target: Target = { width: 8, height: 8, ratio: 1, clear: OPAQUE_BLACK, textures: [{ unit: 0, width: 4, height: 4, texels }] };
		const frame = await render(page, target, (api) => {
			api.drawText({ text: 'A', position: { x: 2, y: 6 }, font: 'body', size: 16, color: [0, 1, 0, 1] });
		});
		expect(pixel(frame, 2, 3)).toEqual([0, 255, 0, 255]);
		expect(pixel(frame, 3, 3)).toEqual([0, 255, 0, 255]);
		expect(pixel(frame, 4, 3)).toEqual([0, 0, 0, 255]);
		const ramp = pixel(frame, 5, 3);
		expect(Math.abs(ramp[1] - 230)).toBeLessThanOrEqual(2);
		expect(pixel(frame, 1, 3)).toEqual([0, 0, 0, 255]);
		expect(pixel(frame, 6, 3)).toEqual([0, 0, 0, 255]);
	});

	test('derives the range from the texture footprint under a scale (R6.5)', async ({ page }) => {
		// Every texel at 0.6. At scale 2 each texel spans two pixels, so the
		// range doubles to 8 and 0.5 + 8 * 0.1 saturates; the per-draw
		// constant of an unscaled draw would have left it at 0.9.
		const texels = columns(...new Array(4).fill([153, 153, 153, 255]));
		const target: Target = { width: 16, height: 16, ratio: 1, clear: OPAQUE_BLACK, textures: [{ unit: 0, width: 4, height: 4, texels }] };
		const frame = await render(page, target, (api) => {
			api.pushTransform([2, 0, 0, 2, 0, 0]);
			api.drawText({ text: 'A', position: { x: 1, y: 6 }, font: 'body', size: 16, color: [0, 1, 0, 1] });
			api.popTransform();
		});
		expect(pixel(frame, 4, 6)).toEqual([0, 255, 0, 255]);
		expect(pixel(frame, 9, 10)).toEqual([0, 255, 0, 255]);
	});

	test('blurs a shadow run from the true distance in the alpha channel (R6.6)', async ({ page }) => {
		// The colour channels say outside everywhere; the alpha channel says
		// two device pixels inside in the left half and far outside in the
		// right. A one-pixel blur reads only the alpha.
		const texels = columns([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0]);
		const target: Target = { width: 8, height: 8, ratio: 1, clear: OPAQUE_BLACK, textures: [{ unit: 0, width: 4, height: 4, texels }] };
		const frame = await render(page, target, (api) => {
			api.drawText({
				text: 'A',
				position: { x: 2, y: 6 },
				font: 'body',
				size: 16,
				color: [0, 0, 0, 0],
				shadow: { color: [0, 0, 1, 1], blur: 1 },
			});
		});
		expect(pixel(frame, 2, 3)).toEqual([0, 0, 255, 255]);
		expect(pixel(frame, 5, 3)).toEqual([0, 0, 0, 255]);
	});

	test('adds an additive draw without covering what is under it (R5.22a)', async ({ page }) => {
		const frame = await render(page, { width: 16, height: 8, ratio: 1, clear: [0, 0, 1, 1] }, (api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 8, height: 8 }, fill: [1, 0, 0, 1], blend: 'additive' });
			api.drawRect({ rect: { x: 8, y: 0, width: 8, height: 8 }, fill: [1, 0, 0, 1] });
		});
		expect(pixel(frame, 4, 4)).toEqual([255, 0, 255, 255]);
		expect(pixel(frame, 12, 4)).toEqual([255, 0, 0, 255]);
	});
});
