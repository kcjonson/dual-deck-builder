import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { DrawApi, RecordingBackend, TextureHandle } from '../../../src/renderer/engine/draw';
import { Batcher } from '../../../src/renderer/engine/draw/Batcher';
import { ResidentTextureSet } from '../../../src/renderer/engine/draw/ResidentTextureSet';
import { FontAtlas, parseFontAtlas } from '../../../src/renderer/engine/text/FontAtlas';
import { TextMetricsService } from '../../../src/renderer/engine/text/TextMetricsService';
import {
	UBER_ATTRIBUTES,
	UBER_FRAME_BLOCK,
	UBER_STRIDE,
	UBER_TEXTURE_UNITS,
	UBER_VERTICES_PER_INSTANCE,
	UberGeometryEncoder,
} from '../../../src/renderer/engine/rendering/UberGeometryEncoder';

/**
 * Chapter 5's pixel tests (5.10) and chapter 4's fragment-test fixture (4.7),
 * run on the real uber shader in the harness's SwiftShader, as numbers rather
 * than pictures.
 *
 * The geometry is the production path in Node: commands from the draw API,
 * encoded by `UberGeometryEncoder` through the `Batcher`. The page gets the
 * resulting instance bytes, compiles `uber.vert` and `uber.frag` from the
 * source tree on a bare canvas, points the attributes as the backend does,
 * draws the instances with premultiplied `over`, and reads the framebuffer
 * back. Nothing of the game is loaded, so a failure
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
	/** Draw API diagnostics the drawing is expected to raise; each must be raised. Any other still throws. */
	expectDiagnostics?: string[];
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

/** The `body` role a test draws with: its metrics and the texture its groups name. */
interface BodyFont {
	atlas: FontAtlas;
	texture: TextureHandle;
}

const GLYPH_FONT: BodyFont = { atlas: GLYPH_ATLAS, texture: GLYPH_TEXTURE };

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
	font: BodyFont = GLYPH_FONT,
): { bytes: number[]; instances: number; roundedClips: number[] } {
	const backend = new RecordingBackend({ maxFrames: 1 });
	backend.loadFontAtlas({ name: 'body', atlas: font.atlas, texture: font.texture });
	const expected = target.expectDiagnostics ?? [];
	const raised = new Set<string>();
	const api = new DrawApi({
		backend,
		strict: expected.length === 0,
		onDiagnostic: ({ code, message }) => {
			if (!expected.includes(code)) throw new Error(`${code}: ${message}`);
			raised.add(code);
		},
	});
	prepare?.(api);
	api.beginFrame({ viewport: { width: target.width / target.ratio, height: target.height / target.ratio }, ratio: target.ratio });
	build(api);
	api.endFrame();
	for (const code of expected) {
		if (!raised.has(code)) throw new Error(`expected the draw API to report ${code}`);
	}

	const text = new TextMetricsService();
	text.addAtlas({ name: 'body', atlas: font.atlas });
	const encoder = new UberGeometryEncoder({
		text,
		onUnpaintable: (kind, detail) => {
			throw new Error(`${kind}: ${detail}`);
		},
	});
	encoder.registerFontTexture('body', font.texture);
	encoder.ratio = target.ratio;
	const batcher = new Batcher({
		encoder,
		textures: new ResidentTextureSet({ units: UBER_TEXTURE_UNITS, resident: [font.texture] }),
	});
	let bytes: number[] = [];
	let instances = 0;
	batcher.flush(backend.commands, (upload) => {
		if (bytes.length > 0) throw new Error('expected one upload');
		if (upload.draws.length !== 1) throw new Error('expected one draw');
		bytes = Array.from(upload.bytes.subarray(0, upload.byteCount));
		instances = upload.instanceCount;
	});
	// R4.14's table, which the backend puts in the frame block behind the projection.
	const table = encoder.roundedClips;
	const roundedClips = Array.from(table.floats.subarray(0, table.count * 8));
	return { bytes, instances, roundedClips };
}

async function render(
	page: Page,
	target: Target,
	build: (api: DrawApi) => void,
	prepare?: (api: DrawApi) => void,
	font?: BodyFont,
): Promise<Frame> {
	const geometry = encode(target, build, prepare, font);
	return page.evaluate(({ target, geometry, sources, attributes, stride, verticesPerInstance, units, frameBlock }) => {
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

		// The frame block: an orthographic projection of the logical viewport,
		// y down, then the rounded clip table.
		const width = target.width / target.ratio;
		const height = target.height / target.ratio;
		const block = new Float32Array(frameBlock.floats);
		block.set([
			2 / width, 0, 0, 0,
			0, -2 / height, 0, 0,
			0, 0, -1, 0,
			-1, 1, 0, 1,
		], frameBlock.projection);
		block.set(geometry.roundedClips, frameBlock.roundedClips);
		const uniforms = gl.createBuffer();
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms);
		gl.bufferData(gl.UNIFORM_BUFFER, block, gl.STATIC_DRAW);
		gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'Frame'), 0);
		gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, uniforms);

		// Every attribute per instance, as `WebGL2Backend` sets them.
		const vertexArray = gl.createVertexArray();
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
		gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(geometry.bytes), gl.STATIC_DRAW);
		const types = { float: gl.FLOAT, half: gl.HALF_FLOAT, unorm8: gl.UNSIGNED_BYTE, uint8: gl.UNSIGNED_BYTE };
		for (const attribute of attributes) {
			gl.enableVertexAttribArray(attribute.location);
			gl.vertexAttribDivisor(attribute.location, 1);
			if (attribute.type === 'uint8') {
				gl.vertexAttribIPointer(attribute.location, attribute.size, types[attribute.type], stride, attribute.offset);
			} else {
				gl.vertexAttribPointer(attribute.location, attribute.size, types[attribute.type], attribute.type === 'unorm8', stride, attribute.offset);
			}
		}

		gl.viewport(0, 0, target.width, target.height);
		const [r, g, b, a] = target.clear;
		gl.clearColor(r * a, g * a, b * a, a);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, verticesPerInstance, geometry.instances);

		const pixels = new Uint8Array(target.width * target.height * 4);
		gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		return { pixels: Array.from(pixels), width: target.width, height: target.height };
	}, {
		target,
		geometry,
		sources: { vertex: VERTEX_SOURCE, fragment: FRAGMENT_SOURCE },
		attributes: UBER_ATTRIBUTES.map((attribute) => ({ ...attribute })),
		stride: UBER_STRIDE,
		verticesPerInstance: UBER_VERTICES_PER_INSTANCE,
		units: UBER_TEXTURE_UNITS,
		frameBlock: { ...UBER_FRAME_BLOCK },
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

	test('rounds a clip\'s corners with an anti-aliased edge and keeps its straight edges whole (4.7, R4.14)', async ({ page }) => {
		for (const ratio of [1, 2]) {
			const frame = await render(page, { width: 40 * ratio, height: 40 * ratio, ratio, clear: OPAQUE_BLACK }, (api) => {
				api.pushClipRounded({ x: 10, y: 10, width: 20, height: 20 }, 8);
				api.drawRect({ rect: { x: 0, y: 0, width: 40, height: 40 }, fill: [1, 1, 1, 1] });
				api.popClip();
			});
			const at = (x: number, y: number) => pixel(frame, Math.floor(x * ratio), Math.floor(y * ratio))[0];
			// The corner's own pixel is outside the arc, centred 8 px in from it.
			expect(at(10.25, 10.25)).toBe(0);
			expect(at(29.75, 29.75)).toBe(0);
			// Along the straight edges, the first pixel inside is whole.
			expect(at(10.25, 20)).toBe(255);
			expect(at(20, 10.25)).toBe(255);
			expect(at(29.75, 20)).toBe(255);
			// Inside the arc is whole, and the arc itself is partly covered.
			expect(at(14, 14)).toBe(255);
			const arc = 18 - 8 / Math.SQRT2;
			const ramp = at(arc, arc);
			expect(ramp).toBeGreaterThan(40);
			expect(ramp).toBeLessThan(215);
		}
	});

	test('clips text to a rounded clip too, in the same draw (R4.5, R4.14)', async ({ page }) => {
		const frame = await render(page, { width: 16, height: 16, ratio: 1, clear: OPAQUE_BLACK, textures: [{ unit: 0, width: 4, height: 4, texels: new Array(64).fill(255) }] }, (api) => {
			api.pushClipRounded({ x: 4, y: 4, width: 4, height: 4 }, 2);
			api.drawText({ text: 'A', position: { x: 4, y: 8 }, font: 'body', size: 16, color: [1, 1, 1, 1] });
			api.popClip();
		});
		// The glyph fills the clip; its corners are cut by a 2 px radius.
		expect(pixel(frame, 4, 4)[0]).toBeLessThan(128);
		expect(pixel(frame, 7, 7)[0]).toBeLessThan(128);
		expect(pixel(frame, 5, 6)[0]).toBe(255);
		expect(pixel(frame, 6, 5)[0]).toBe(255);
	});

	test('nests rounded clips with the inner radius and the outer bounding rect (4.7, R4.14)', async ({ page }) => {
		const target: Target = { width: 80, height: 80, ratio: 1, clear: OPAQUE_BLACK, expectDiagnostics: ['nested-rounded-clip'] };
		const frame = await render(page, target, (api) => {
			api.pushClipRounded({ x: 10, y: 10, width: 50, height: 50 }, 20);
			api.pushClipRounded({ x: 0, y: 0, width: 40, height: 40 }, 6);
			api.drawRect({ rect: { x: 0, y: 0, width: 80, height: 80 }, fill: [1, 1, 1, 1] });
			api.popClip();
			api.popClip();
		});
		// The outer clip's corner, which its 20 px radius would cut, shows: it
		// contributes only its bounding rect.
		expect(pixel(frame, 10, 10)[0]).toBe(255);
		expect(pixel(frame, 9, 20)[0]).toBe(0);
		// The inner clip's corner inside the intersection is rounded.
		expect(pixel(frame, 39, 39)[0]).toBe(0);
		expect(pixel(frame, 35, 35)[0]).toBe(255);
		expect(pixel(frame, 39, 20)[0]).toBe(255);
	});

	test('ramps a fractional edge over exactly one device pixel on each side (R5.6, R5.7)', async ({ page }) => {
		const frame = await render(page, { width: 48, height: 8, ratio: 1, clear: OPAQUE_BLACK }, (api) => {
			// Under a scale, where R7.9 snaps nothing: a translated square rect
			// would have its edges put on the grid (R7.8) and show no ramp.
			api.pushTransform([2, 0, 0, 2, 0, 0]);
			api.drawRect({ rect: { x: 5.125, y: 0, width: 10, height: 4 }, fill: [1, 1, 1, 1] });
			api.popTransform();
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
			// Scaled so R7.8 leaves the hairline where it is (R7.9).
			api.pushTransform([2, 0, 0, 2, 0, 0]);
			api.drawRect({
				rect: { x: 5.25, y: 1, width: 10, height: 8 },
				fill: [0.9, 0.9, 0.9, 1],
				border: { color: [0.1, 0.1, 0.1, 1], width: 0.5 },
			});
			api.popTransform();
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

	test('shows no seam between two rects that abut at a fractional x once snapped (R5.10, R7.8a)', async ({ page }) => {
		// Unsnapped, each rect would ramp its own edge: the shared column 0.3
		// covered by one and 0.7 by the other, which composites to about 0.79,
		// a visible seam. Both round 20.3 to 20, so the column is the second
		// rect's alone.
		const frame = await render(page, { width: 40, height: 8, ratio: 1, clear: OPAQUE_BLACK }, (api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 20.3, height: 8 }, fill: [1, 1, 1, 1] });
			api.drawRect({ rect: { x: 20.3, y: 0, width: 19.7, height: 8 }, fill: [1, 1, 1, 1] });
		});
		expect(pixel(frame, 20, 4)).toEqual([255, 255, 255, 255]);
	});

	test('puts a 1 px border at y 10.4 on whole device rows 21 and 22 at ratio 2 (R7.8)', async ({ page }) => {
		const frame = await render(page, { width: 40, height: 40, ratio: 2, clear: OPAQUE_BLACK }, (api) => {
			api.drawRect({ rect: { x: 2, y: 10.4, width: 14, height: 6 }, fill: [1, 0, 0, 1], border: { color: [0, 1, 0, 1], width: 1 } });
		});
		expect(pixel(frame, 16, 20)).toEqual([0, 0, 0, 255]);
		expect(pixel(frame, 16, 21)).toEqual([0, 255, 0, 255]);
		expect(pixel(frame, 16, 22)).toEqual([0, 255, 0, 255]);
		expect(pixel(frame, 16, 23)).toEqual([255, 0, 0, 255]);
	});

	test('centres a 1 px center border on one whole device column (R7.8)', async ({ page }) => {
		const frame = await render(page, { width: 40, height: 40, ratio: 1, clear: OPAQUE_BLACK }, (api) => {
			api.drawRect({ rect: { x: 10, y: 10, width: 20, height: 20 }, fill: [1, 0, 0, 1], border: { color: [0, 1, 0, 1], width: 1, position: 'center' } });
		});
		// Unsnapped it would straddle x 10 and cover columns 9 and 10 by half each.
		expect(pixel(frame, 9, 20)).toEqual([0, 0, 0, 255]);
		expect(pixel(frame, 10, 20)).toEqual([0, 255, 0, 255]);
		expect(pixel(frame, 11, 20)).toEqual([255, 0, 0, 255]);
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

	test('keeps nine-slice corners at their texel size and leaves no gap between cells (R5.19)', async ({ page }) => {
		// A 6x6 frame with 2-texel insets: red corners, green edges, a blue centre.
		const red = [255, 0, 0, 255];
		const green = [0, 255, 0, 255];
		const blue = [0, 0, 255, 255];
		const texels: number[] = [];
		for (let row = 0; row < 6; row++) {
			for (let column = 0; column < 6; column++) {
				const edgeX = column < 2 || column > 3;
				const edgeY = row < 2 || row > 3;
				texels.push(...(edgeX && edgeY ? red : edgeX || edgeY ? green : blue));
			}
		}
		const created: { frame?: TextureHandle } = {};
		const prepare = (api: DrawApi) => {
			created.frame = api.createTexture({ width: 6, height: 6, label: 'frame' });
		};
		const target: Target = { width: 40, height: 48, ratio: 1, clear: TRANSPARENT, textures: [{ unit: 1, width: 6, height: 6, texels }] };
		const slice = { top: 2, right: 2, bottom: 2, left: 2 };
		const frame = await render(page, target, (api) => {
			api.drawImage({ rect: { x: 0, y: 0, width: 30, height: 20 }, texture: created.frame as TextureHandle, slice });
			api.drawImage({ rect: { x: 3.3, y: 24.6, width: 27.9, height: 17.7 }, texture: created.frame as TextureHandle, slice });
		}, prepare);

		// Each corner is 2x2 device pixels of pure red at every scale; stretched
		// unsliced, the 30 px image would spread each corner texel over 5 columns.
		for (const [x, y] of [[0, 0], [1, 1], [28, 0], [29, 1], [0, 18], [1, 19], [28, 18], [29, 19]]) {
			expect(pixel(frame, x, y)).toEqual(red);
		}
		expect(pixel(frame, 15, 0)).toEqual(green);
		expect(pixel(frame, 0, 10)).toEqual(green);
		expect(pixel(frame, 15, 10)).toEqual(blue);
		// Each stretched cell's pixels next to a neighbour are its own colour:
		// linear filtering at the cell edge would blend in the neighbour's
		// texel (about [118, 137, 0] at (2, 0) unclamped).
		for (const [x, y] of [[2, 0], [27, 0], [2, 19], [27, 19], [0, 2], [1, 17], [29, 2], [28, 17]]) {
			expect(pixel(frame, x, y)).toEqual(green);
		}
		for (const [x, y] of [[15, 2], [15, 17], [2, 10], [27, 10], [2, 2], [27, 17]]) {
			expect(pixel(frame, x, y)).toEqual(blue);
		}
		expect(pixel(frame, 30, 10)[3]).toBe(0);

		// Every pixel inside the fractional one is opaque: its cells meet at
		// fractional edges with no gap, since image mode has no edge ramp.
		for (let y = 26; y < 42; y++) {
			for (let x = 4; x < 31; x++) expect(pixel(frame, x, y)[3]).toBe(255);
		}
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

/**
 * 6.9's scored small-size gate: at ratio 1, the body face at 10, 12 and 13 px
 * through the distance field against the platform's own rasterisation of the
 * same font file, for stem weight (total ink over a word) and evenness (how
 * much the darkest column of each `l` in a row of them varies as its
 * sub-pixel phase moves), plus placement (how far each `l` sits from its
 * advance), the cost of buying evenness by snapping. Distance fields have no
 * hinting (R6.4a), so the gate is a band, not equality; the scores print so
 * a regression shows how far it moved.
 */
test.describe('small text against a platform reference (6.9)', () => {
	const FONTS = join(__dirname, '../../../src/assets/fonts');
	const BODY_ATLAS = parseFontAtlas({
		json: JSON.parse(readFileSync(join(FONTS, 'open-sans-regular.json'), 'utf8')),
		source: 'open-sans-regular',
		warn: () => undefined,
	});
	const BODY_TEXTURE: TextureHandle = { id: 1, width: BODY_ATLAS.width, height: BODY_ATLAS.height, label: 'body atlas' };
	const BODY_FACE = readFileSync(join(FONTS, 'open-sans/OpenSans-Regular.ttf')).toString('base64');
	const WORD = 'Hamburgefonstiv';
	// 34 so that at 12 px, where an `l` advances 3.03 px, the pens walk a
	// whole pixel of phase rather than half of one.
	const STEMS = 'l'.repeat(34);
	const WIDTH = 240;
	const HEIGHT = 48;
	const WORD_BASELINE = 18;
	const STEM_BASELINE = 40;
	/**
	 * The tolerance band (docs/AI_TECHNICAL_DECISIONS/small-text-evenness.md).
	 * The reference is the platform's, so the weight floor is too: the Linux
	 * runner's FreeType matches the field's ink (0.95 to 1.0) and macOS
	 * CoreText draws a third heavier. The field's own scores do not depend on
	 * the platform (SwiftShader on both), so its stem variation (0.22, 0.19,
	 * 0.18 at 10, 12, 13 px) and placement error (0.06, 0.02, 0.02 px) are held
	 * close. Snapping each glyph to a whole pixel takes variation to zero and
	 * placement error to 0.28 to 0.29 px, which the placement ceiling refuses.
	 */
	const WEIGHT_FLOOR = process.platform === 'linux' ? 0.9 : 0.55;
	const WEIGHT_CEILING = process.platform === 'linux' ? 1.05 : 0.85;
	const VARIATION_CEILING: Record<number, number> = { 10: 0.25, 12: 0.21, 13: 0.2 };
	const PLACEMENT_CEILING = 0.1;
	let texels: number[] = [];

	test.beforeAll(() => {
		texels = Array.from(PNG.sync.read(readFileSync(join(FONTS, 'open-sans-regular.png'))).data);
	});

	test.beforeEach(async ({ page }) => {
		await page.setContent('<!doctype html><title>small text</title>');
	});

	/**
	 * Coverage per device pixel, top row first, the pen advance of one `l`, and
	 * where its stem's centre sits right of its pen (from the atlas's plane
	 * bounds, the same outline the platform draws).
	 */
	interface Raster {
		coverage: number[];
		stemAdvance: number;
		stemCentre: number;
	}

	function stemCentre(size: number): number {
		const plane = BODY_ATLAS.glyph(0x6C)?.plane;
		return plane ? ((plane.left + plane.right) / 2) * size : 0;
	}

	/** The two runs through the uber shader, laid out by the atlas metrics. */
	async function distanceField(page: Page, size: number): Promise<Raster> {
		const target: Target = {
			width: WIDTH,
			height: HEIGHT,
			ratio: 1,
			clear: TRANSPARENT,
			textures: [{ unit: 0, width: BODY_ATLAS.width, height: BODY_ATLAS.height, texels }],
		};
		const frame = await render(page, target, (api) => {
			api.drawText({ text: WORD, position: { x: 4, y: WORD_BASELINE }, font: 'body', size, color: [1, 1, 1, 1] });
			api.drawText({ text: STEMS, position: { x: 4, y: STEM_BASELINE }, font: 'body', size, color: [1, 1, 1, 1] });
		}, undefined, { atlas: BODY_ATLAS, texture: BODY_TEXTURE });
		const coverage: number[] = [];
		for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) coverage.push(pixel(frame, x, y)[3] / 255);
		return { coverage, stemAdvance: (BODY_ATLAS.glyph(0x6C)?.advance ?? 0) * size, stemCentre: stemCentre(size) };
	}

	/** The same two runs from the platform's 2D text API with the same font file. */
	async function platform(page: Page, size: number): Promise<Raster> {
		const raster = await page.evaluate(async ({ face, size, width, height, word, stems, wordBaseline, stemBaseline }) => {
			const bytes = Uint8Array.from(atob(face), (char) => char.charCodeAt(0));
			const font = new FontFace('reference', bytes.buffer);
			await font.load();
			// This project's test lib predates `FontFaceSet.add`.
			(document.fonts as unknown as { add(face: FontFace): void }).add(font);
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext('2d') as CanvasRenderingContext2D;
			context.font = `${size}px reference`;
			context.fillStyle = '#ffffff';
			context.fillText(word, 4, wordBaseline);
			context.fillText(stems, 4, stemBaseline);
			const data = context.getImageData(0, 0, width, height).data;
			const coverage: number[] = [];
			for (let index = 3; index < data.length; index += 4) coverage.push(data[index] / 255);
			// The platform's own advances, which hinting may round.
			return { coverage, stemAdvance: context.measureText(stems).width / stems.length };
		}, { face: BODY_FACE, size, width: WIDTH, height: HEIGHT, word: WORD, stems: STEMS, wordBaseline: WORD_BASELINE, stemBaseline: STEM_BASELINE });
		return { ...raster, stemCentre: stemCentre(size) };
	}

	function ink(coverage: number[], top: number, bottom: number): number {
		let sum = 0;
		for (let y = top; y < bottom; y++) for (let x = 0; x < WIDTH; x++) sum += coverage[y * WIDTH + x];
		return sum;
	}

	/**
	 * Each `l`'s ink per column, with the window's first column: the columns
	 * whose centres lie within half an advance of where the stem's centre
	 * should be, so the whole stem is inside its window at every phase.
	 */
	function stemColumns({ coverage, stemAdvance: advance, stemCentre: centre }: Raster, glyph: number): { start: number; columns: number[] } {
		const expected = 4 + glyph * advance + centre;
		const start = Math.ceil(expected - advance / 2 - 0.5);
		const end = Math.ceil(expected + advance / 2 - 0.5);
		const columns: number[] = [];
		for (let x = start; x < end; x++) {
			let column = 0;
			for (let y = WORD_BASELINE + 4; y < HEIGHT; y++) column += coverage[y * WIDTH + x];
			columns.push(column);
		}
		return { start, columns };
	}

	function deviation(values: number[]): { mean: number; deviation: number } {
		const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
		const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
		return { mean, deviation: Math.sqrt(variance) };
	}

	/** The coefficient of variation of each `l`'s darkest column. */
	function stemVariation(raster: Raster): number {
		const peaks: number[] = [];
		for (let glyph = 0; glyph < STEMS.length; glyph++) peaks.push(Math.max(...stemColumns(raster, glyph).columns));
		const { mean, deviation: spread } = deviation(peaks);
		return spread / mean;
	}

	/**
	 * How far, in device pixels (standard deviation), each `l`'s ink centre
	 * sits from where its advance puts it. Snapping each glyph to a whole pixel
	 * buys stem evenness with exactly this: gaps that alternate by a pixel.
	 */
	function placementError(raster: Raster): number {
		const offsets: number[] = [];
		for (let glyph = 0; glyph < STEMS.length; glyph++) {
			const { start, columns } = stemColumns(raster, glyph);
			let ink = 0;
			let moment = 0;
			columns.forEach((column, index) => {
				ink += column;
				moment += column * (start + index + 0.5);
			});
			offsets.push(moment / ink - (4 + glyph * raster.stemAdvance + raster.stemCentre));
		}
		return deviation(offsets).deviation;
	}

	for (const size of [10, 12, 13]) {
		test(`scores the body face at ${size} px for stem weight and evenness`, async ({ page }) => {
			const field = await distanceField(page, size);
			const reference = await platform(page, size);
			const weight = ink(field.coverage, 0, WORD_BASELINE + 4) / ink(reference.coverage, 0, WORD_BASELINE + 4);
			const fieldEvenness = stemVariation(field);
			const referenceEvenness = stemVariation(reference);
			const fieldPlacement = placementError(field);
			const referencePlacement = placementError(reference);
			console.log(`6.9 small text, body ${size} px: weight ${weight.toFixed(3)} of the platform's, stem variation ${fieldEvenness.toFixed(3)} against ${referenceEvenness.toFixed(3)}, placement error ${fieldPlacement.toFixed(3)} px against ${referencePlacement.toFixed(3)}`);
			// The field keeps every stem where its advance puts it and lets
			// the stem's sub-pixel phase vary. The Linux platform scores zero
			// on both because it rounds the advances, which measurement here
			// may not (R6.16); snapping glyphs without that trades evenness
			// for placement, so placement is held (DDB-218).
			expect(weight).toBeGreaterThan(WEIGHT_FLOOR);
			expect(weight).toBeLessThan(WEIGHT_CEILING);
			expect(fieldEvenness).toBeLessThan(VARIATION_CEILING[size]);
			expect(fieldPlacement).toBeLessThan(PLACEMENT_CEILING);
		});
	}
});
