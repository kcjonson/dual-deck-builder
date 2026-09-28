import { DrawApi, DrawCommand, RecordingBackend, RGBA, TextureHandle, UNCLIPPED_RECT } from '../draw';
import { Batcher, GeometryUpload, GroupShape } from '../draw/Batcher';
import { ResidentTextureSet } from '../draw/ResidentTextureSet';
import type { CharacterInfo } from './FontAtlas';
import {
	GlyphSource,
	UBER_MODE,
	UBER_VERTEX,
	UberGeometryEncoder,
	borderOutset,
	premultiply,
	spreadRadius,
} from './UberGeometryEncoder';

/**
 * The CPU half of chapter 5: what `UberGeometryEncoder` writes for each
 * command. The shader's half (coverage, compositing, the clip test) runs on a
 * GPU and is checked by `tests/visual/web/uberShader.spec.ts`.
 */

const RED: RGBA = [1, 0, 0, 1];
const BLUE: RGBA = [0.2, 0.4, 0.6, 0.8];
const V = UBER_VERTEX;

/** A two-glyph atlas at a 32 px base, 512 px square, with a line height of 40. */
class FakeGlyphs implements GlyphSource {
	readonly glyphs: Record<string, CharacterInfo> = {
		A: { x: 0.1, y: 0.2, width: 0.03, height: 0.05, offsetX: 1.5, offsetY: 2.25, advance: 20 },
		b: { x: 0.4, y: 0.5, width: 0.02, height: 0.06, offsetX: -0.5, offsetY: 3.75, advance: 17 },
	};

	getCharacter(char: string): CharacterInfo | null {
		return this.glyphs[char] ?? null;
	}

	getFontSize(): number {
		return 32;
	}

	getAtlasSize(): number {
		return 512;
	}

	measureText(text: string): { width: number; height: number } {
		let width = 0;
		for (const char of text) width += this.glyphs[char]?.advance ?? 0;
		return { width, height: 40 };
	}
}

function record(
	build: (api: DrawApi) => void,
	ratio = 1,
	prepare?: (api: DrawApi) => void,
	strict = true,
): DrawCommand[] {
	const backend = new RecordingBackend({ maxFrames: 1 });
	backend.loadFontAtlas({ name: 'body', metrics: null, texture: { id: 1, width: 1, height: 1, label: null } });
	const api = new DrawApi({ backend, strict });
	prepare?.(api);
	api.beginFrame({ viewport: { width: 800, height: 600 }, ratio });
	build(api);
	api.endFrame();
	return [...backend.commands];
}

function setup(ratio = 1) {
	const glyphs = new FakeGlyphs();
	const unpaintable: string[] = [];
	const encoder = new UberGeometryEncoder({
		glyphs,
		onUnpaintable: (kind, detail) => unpaintable.push(`${kind}: ${detail}`),
	});
	encoder.ratio = ratio;
	// Every encoding in this file runs under the contract check, so an encoder
	// that writes a count other than the one it reported fails here.
	const batcher = new Batcher({
		encoder,
		textures: new ResidentTextureSet({ units: 4, resident: [glyphs] }),
		verify: (command, problem) => {
			throw new Error(`${command.kind}: ${problem}`);
		},
	});

	function encode(commands: DrawCommand[]) {
		const uploads: Array<{ floats: Float32Array; indices: number[]; upload: GeometryUpload }> = [];
		const work = batcher.flush(commands, (upload) => {
			uploads.push({
				floats: upload.vertices.slice(0, upload.floatCount),
				indices: Array.from(upload.indices.subarray(0, upload.indexCount)),
				upload,
			});
		});
		return { uploads, work };
	}

	/** One frame recorded and encoded; the floats of the one upload. */
	function draw(build: (api: DrawApi) => void): { floats: Float32Array; indices: number[] } {
		const { uploads } = encode(record(build, ratio));
		if (uploads.length !== 1) throw new Error(`expected one upload, got ${uploads.length}`);
		return uploads[0];
	}

	return { encoder, encode, draw, unpaintable, glyphs };
}

/** The floats of vertex `n` of an upload, by field. */
function vertex(floats: Float32Array, n: number) {
	const base = n * V.floats;
	const read = (offset: number, size: number) => Array.from(floats.slice(base + offset, base + offset + size));
	return {
		position: read(V.position, 2),
		local: read(V.local, 2),
		halfSize: read(V.halfSize, 2),
		texCoord: read(V.texCoord, 2),
		radii: read(V.radii, 4),
		fill: read(V.fill, 4),
		border: read(V.border, 4),
		clip: read(V.clip, 4),
		borderWidth: floats[base + V.shape],
		outset: floats[base + V.shape + 1],
		sigma: floats[base + V.shape + 2],
		opacity: floats[base + V.shape + 3],
		mode: floats[base + V.mode],
		slot: floats[base + V.mode + 1],
		additive: floats[base + V.mode + 2],
	};
}

const f32 = (values: readonly number[]) => Array.from(new Float32Array(values));
const close = (values: number[]) => values.map((value) => Math.round(value * 1e4) / 1e4);

describe('UberGeometryEncoder: rect (R5.5 to R5.10)', () => {
	it('writes one quad inflated by a device pixel, measured from the rect centre (R5.7)', () => {
		const { draw } = setup();
		const { floats, indices } = draw((api) => {
			api.drawRect({ rect: { x: 10, y: 20, width: 100, height: 40 }, fill: RED });
		});
		expect(floats.length).toBe(4 * V.floats);
		expect(indices).toEqual([0, 1, 2, 0, 2, 3]);
		// Top-left, top-right, bottom-right, bottom-left.
		expect([0, 1, 2, 3].map((n) => vertex(floats, n).position)).toEqual([[9, 19], [111, 19], [111, 61], [9, 61]]);
		expect([0, 1, 2, 3].map((n) => vertex(floats, n).local)).toEqual([[-51, -21], [51, -21], [51, 21], [-51, 21]]);
		const first = vertex(floats, 0);
		expect(first.halfSize).toEqual([50, 20]);
		expect(first.mode).toBe(UBER_MODE.rect);
		expect(first.fill).toEqual(RED);
		expect(first.borderWidth).toBe(0);
		expect(first.radii).toEqual([0, 0, 0, 0]);
		expect(first.opacity).toBe(1);
	});

	it('inflates by half a logical pixel at ratio 2', () => {
		const { draw } = setup(2);
		const { floats } = draw((api) => {
			api.drawRect({ rect: { x: 10, y: 20, width: 100, height: 40 }, fill: RED });
		});
		expect(vertex(floats, 0).position).toEqual([9.5, 19.5]);
		expect(vertex(floats, 2).local).toEqual([50.5, 20.5]);
	});

	it('draws white with no border when a rect has neither fill nor border', () => {
		const { draw } = setup();
		const first = vertex(draw((api) => api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } })).floats, 0);
		expect(first.fill).toEqual([1, 1, 1, 1]);
		expect(first.borderWidth).toBe(0);
	});

	it('premultiplies fill and border, and keeps opacity out of both (R5.8, R5.22)', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			api.pushOpacity(0.5);
			api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, fill: BLUE, border: { color: [1, 1, 0, 0.5], width: 2 } });
			api.popOpacity();
		});
		const first = vertex(floats, 0);
		expect(first.fill).toEqual(f32([0.2 * 0.8, 0.4 * 0.8, 0.6 * 0.8, 0.8]));
		expect(first.border).toEqual(f32([0.5, 0.5, 0, 0.5]));
		// R5.8's formula multiplies the composited result by opacity, which is
		// not the same as fading each colour first: the border-over-fill term
		// uses the border's own alpha.
		expect(first.opacity).toBe(0.5);
	});

	it.each([
		['inside', 0],
		['center', 3],
		['outside', 6],
	] as const)('grows the quad by the %s border\'s outset and keeps the shape size (R5.7)', (position, outset) => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 20, height: 20 }, fill: RED, border: { color: BLUE, width: 6, position } });
		});
		const first = vertex(floats, 0);
		expect(first.borderWidth).toBe(6);
		expect(first.outset).toBe(outset);
		expect(first.halfSize).toEqual([10, 10]);
		expect(first.local).toEqual([-(10 + outset + 1), -(10 + outset + 1)]);
	});

	it('clamps each corner radius to the smaller half extent, and at zero (R5.5, R5.7a)', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 40, height: 20 }, radius: 100 });
			api.drawRect({ rect: { x: 0, y: 0, width: 40, height: 20 }, radius: [2, 30, -4, 5] });
		});
		expect(vertex(floats, 0).radii).toEqual([10, 10, 10, 10]);
		expect(vertex(floats, 4).radii).toEqual([2, 10, 0, 5]);
	});

	it('carries the clip rect on every vertex, and the all-covering rect under none (R4.1)', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } });
			api.pushClip({ x: 1, y: 2, width: 3, height: 4 });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } });
			api.popClip();
		});
		const none = UNCLIPPED_RECT;
		expect(vertex(floats, 3).clip).toEqual([none.minX, none.minY, none.maxX, none.maxY]);
		for (let n = 4; n < 8; n++) expect(vertex(floats, n).clip).toEqual([1, 2, 4, 6]);
	});

	it('applies the transform on the CPU and keeps the local coordinates the SDF reads (R5.3)', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			// A 90 degree turn and a scale of two about the origin, then a move.
			api.pushTransform([0, 2, -2, 0, 100, 50]);
			api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 6 }, fill: RED });
			api.popTransform();
		});
		const topLeft = vertex(floats, 0);
		// One device pixel is half a local unit under a scale of two.
		expect(topLeft.local).toEqual([-5.5, -3.5]);
		// Local (-0.5, -0.5) maps to (100 + 1, 50 - 1).
		expect(topLeft.position).toEqual([101, 49]);
		expect(topLeft.halfSize).toEqual([5, 3]);
	});

	it('premultiplies gradient corners before interpolation and extrapolates to the inflated quad (R5.9)', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			// Opaque red at the top to fully transparent red at the bottom.
			api.drawRect({
				rect: { x: 0, y: 0, width: 10, height: 10 },
				gradient: [RED, RED, [1, 0, 0, 0], [1, 0, 0, 0]],
			});
		});
		// The inflated top edge is 1 px above a 10 px rect, v = -0.1, so alpha
		// extrapolates to 1.1 and clamps to 1.
		expect(close(vertex(floats, 0).fill)).toEqual([1, 0, 0, 1]);
		// The bottom edge is 1 px below: v = 1.1, alpha -0.1, clamped to 0,
		// and the colour clamps with it, so no negative premultiplied red.
		expect(close(vertex(floats, 3).fill)).toEqual([0, 0, 0, 0]);
		// The transparent corners are premultiplied to zero, so the rasteriser
		// interpolates (0.5, 0, 0, 0.5) at the midpoint: half-covered red. A
		// straight (1, 0, 0, 0) corner would interpolate to (1, 0, 0, 0.5),
		// which is too bright once treated as premultiplied.
	});
});

describe('UberGeometryEncoder: shadow (R5.11 to R5.13)', () => {
	it('grows radii by CSS\'s spread formula', () => {
		expect(spreadRadius(10, 4)).toBe(14);
		expect(spreadRadius(0, 4)).toBe(0);
		// r < spread: r + spread * (1 + (r / spread - 1)^3).
		expect(spreadRadius(2, 4)).toBeCloseTo(2 + 4 * (1 + (0.5 - 1) ** 3), 10);
		expect(spreadRadius(10, -4)).toBe(6);
		expect(spreadRadius(2, -4)).toBe(0);
		expect(spreadRadius(5, 0)).toBe(5);
	});

	it('emits the shadow quad before its owner, offset, spread and padded by three sigma', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			api.drawRect({
				rect: { x: 100, y: 100, width: 40, height: 20 },
				radius: 4,
				fill: RED,
				shadow: { color: [0, 0, 0, 0.5], blur: 8, spread: 2, offset: { x: 3, y: 5 } },
			});
		});
		const shadow = vertex(floats, 0);
		expect(shadow.mode).toBe(UBER_MODE.shadow);
		expect(shadow.halfSize).toEqual([22, 12]);
		expect(shadow.radii).toEqual([6, 6, 6, 6]);
		// sigma = blur / 2.
		expect(shadow.sigma).toBe(4);
		expect(shadow.fill).toEqual([0, 0, 0, 0.5]);
		// Centre (123, 115), half size plus 3 sigma plus one pixel.
		expect(shadow.local).toEqual([-(22 + 12 + 1), -(12 + 12 + 1)]);
		expect(shadow.position).toEqual([123 - 35, 115 - 25]);
		expect(vertex(floats, 4).mode).toBe(UBER_MODE.rect);
	});

	it('draws nothing for a negative spread that consumes the box', () => {
		const { encode } = setup();
		const { uploads } = encode(record((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, shadow: { color: RED, blur: 4, spread: -6 } });
		}));
		expect(uploads[0].upload.groups).toBe(1);
		expect(vertex(uploads[0].floats, 0).mode).toBe(UBER_MODE.rect);
	});
});

describe('UberGeometryEncoder: circle and lines (R5.15, R5.16)', () => {
	it('writes a circle as one SDF quad with its border outset', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			api.drawCircle({ center: { x: 50, y: 60 }, radius: 10, fill: RED, border: { color: BLUE, width: 2, position: 'center' } });
		});
		expect(floats.length).toBe(4 * V.floats);
		const first = vertex(floats, 0);
		expect(first.mode).toBe(UBER_MODE.circle);
		expect(first.halfSize).toEqual([10, 10]);
		expect(first.outset).toBe(1);
		expect(first.local).toEqual([-12, -12]);
		expect(first.position).toEqual([38, 48]);
	});

	it('writes a line as a rect-mode quad along it, with round caps as radii', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			api.drawLine({ from: { x: 10, y: 10 }, to: { x: 10, y: 30 }, color: RED, width: 4, cap: 'round' });
		});
		const first = vertex(floats, 0);
		expect(first.mode).toBe(UBER_MODE.rect);
		// 20 long plus a 2 px cap at each end, 4 wide.
		expect(first.halfSize).toEqual([12, 2]);
		expect(first.radii).toEqual([2, 2, 2, 2]);
		// Local x runs down the line: the top-left corner is before `from`.
		expect(first.local).toEqual([-13, -3]);
		expect(close(first.position)).toEqual([13, 7]);
	});

	it('gives butt caps square ends and draws nothing for a zero-width line', () => {
		const { draw, encode } = setup();
		const first = vertex(draw((api) => {
			api.drawLine({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, color: RED, width: 2 });
		}).floats, 0);
		expect(first.halfSize).toEqual([5, 1]);
		expect(first.radii).toEqual([0, 0, 0, 0]);
		expect(encode(record((api) => {
			api.drawLine({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, color: RED, width: 0 });
		})).uploads).toEqual([]);
	});

	it('writes a polyline segment per edge with round interior joints', () => {
		const { draw } = setup();
		const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
		const open = draw((api) => api.drawPolyline({ points, color: RED, width: 2 })).floats;
		expect(open.length).toBe(2 * 4 * V.floats);
		// First segment: butt at the start, round at the joint.
		expect(vertex(open, 0).radii).toEqual([0, 1, 1, 0]);
		// Second segment: round at the joint, butt at the end.
		expect(vertex(open, 4).radii).toEqual([1, 0, 0, 1]);

		const closed = draw((api) => api.drawPolyline({ points, color: RED, width: 2, closed: true })).floats;
		expect(closed.length).toBe(3 * 4 * V.floats);
		for (let segment = 0; segment < 3; segment++) expect(vertex(closed, segment * 4).radii).toEqual([1, 1, 1, 1]);
	});
});

describe('UberGeometryEncoder: polygon (R5.17)', () => {
	const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

	it('writes flat, premultiplied vertices and a one-device-pixel feather ring around the outline', () => {
		const { draw } = setup(2);
		const { floats, indices } = draw((api) => {
			api.drawPolygon({ points: square, indices: [0, 1, 2, 0, 2, 3], fill: BLUE });
		});
		expect(floats.length).toBe(8 * V.floats);
		for (let n = 0; n < 4; n++) {
			expect(vertex(floats, n).mode).toBe(UBER_MODE.flat);
			expect(vertex(floats, n).fill).toEqual(f32([0.2 * 0.8, 0.4 * 0.8, 0.6 * 0.8, 0.8]));
			expect(vertex(floats, n).position).toEqual([square[n].x, square[n].y]);
		}
		// Outer ring: the corner pushed out along the miter, half a logical
		// pixel from each edge at ratio 2, and transparent.
		expect(close(vertex(floats, 4).position)).toEqual([-0.5, -0.5]);
		expect(close(vertex(floats, 6).position)).toEqual([10.5, 10.5]);
		expect(vertex(floats, 4).fill).toEqual([0, 0, 0, 0]);
		expect(indices.slice(0, 6)).toEqual([0, 1, 2, 0, 2, 3]);
		expect(indices.slice(6, 12)).toEqual([0, 1, 5, 0, 5, 4]);
		expect(indices).toHaveLength(6 + 4 * 6);
	});

	it('feathers outward whichever way the outline winds', () => {
		const { draw } = setup();
		const reversed = [...square].reverse();
		const { floats } = draw((api) => api.drawPolygon({ points: reversed, indices: [0, 1, 2, 0, 2, 3], fill: RED }));
		// reversed[0] is (0, 10); its outer vertex is below and to the left.
		expect(close(vertex(floats, 4).position)).toEqual([-1, 11]);
	});

	it('feathers a single bare triangle, but not a bare list of several', () => {
		const { draw } = setup();
		const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
		expect(draw((api) => api.drawPolygon({ points: triangle, fill: RED })).floats.length).toBe(6 * V.floats);
		const two = [...triangle, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 10 }];
		expect(draw((api) => api.drawPolygon({ points: two, fill: RED })).floats.length).toBe(6 * V.floats);
	});

	it('draws an indexed list that is not one outline without a ring across its interior', () => {
		const { encode } = setup();
		const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 10 }];
		// Not strict: the draw API reports this list, and still draws it.
		const [{ floats, indices }] = encode(record((api) => {
			api.drawPolygon({ points, indices: [0, 1, 2, 3, 4, 5], fill: RED });
		}, 1, undefined, false)).uploads;
		expect(floats.length).toBe(6 * V.floats);
		expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('premultiplies per-vertex colours and keeps them on the inner ring', () => {
		const { draw } = setup();
		const colors: RGBA[] = [RED, BLUE, RED, BLUE];
		const { floats } = draw((api) => api.drawPolygon({ points: square, indices: [0, 1, 2, 0, 2, 3], colors }));
		expect(vertex(floats, 1).fill).toEqual(f32([0.2 * 0.8, 0.4 * 0.8, 0.6 * 0.8, 0.8]));
		expect(vertex(floats, 2).fill).toEqual(RED);
	});

	it('refuses a polygon index that would reach a neighbouring group', () => {
		const { encode, unpaintable } = setup();
		expect(encode(record((api) => {
			api.drawPolygon({ points: square, indices: [0, 1, 7] });
		}, 1, undefined, false)).uploads).toEqual([]);
		expect(unpaintable).toEqual(['polygon: polygon index 7 is outside its 4 points']);
	});
});

describe('UberGeometryEncoder: image (R5.18)', () => {
	let texture: TextureHandle;
	const create = (api: DrawApi) => {
		texture = api.createTexture({ width: 200, height: 100, label: 'art' });
	};

	it('maps a pixel source rect to texture coordinates and premultiplies the tint', () => {
		const { encoder } = setup();
		const [command] = record((api) => {
			api.drawImage({
				rect: { x: 10, y: 10, width: 50, height: 25 },
				texture,
				sourceRect: { x: 20, y: 10, width: 100, height: 50 },
				tint: [1, 1, 1, 0.5],
			});
		}, 1, create);
		const shape: GroupShape = { vertices: 0, indices: 0, texture: null };
		expect(encoder.shape(command, shape)).toBe(true);
		expect(shape.texture).toBe(texture);

		const floats = new Float32Array(4 * V.floats);
		encoder.encode(command, { vertices: floats, indices: new Uint32Array(6), floatOffset: 0, baseVertex: 0, indexOffset: 0 }, 2);
		const topLeft = vertex(floats, 0);
		expect(topLeft.mode).toBe(UBER_MODE.image);
		expect(topLeft.slot).toBe(2);
		expect(topLeft.position).toEqual([10, 10]);
		expect(topLeft.texCoord).toEqual(f32([0.1, 0.1]));
		expect(vertex(floats, 2).texCoord).toEqual(f32([0.6, 0.6]));
		expect(vertex(floats, 2).position).toEqual([60, 35]);
		expect(topLeft.fill).toEqual([0.5, 0.5, 0.5, 0.5]);
	});

	it('refuses a nine-slice image rather than stretching its corners', () => {
		const { encode, unpaintable } = setup();
		expect(encode(record((api) => {
			api.drawImage({ rect: { x: 0, y: 0, width: 10, height: 10 }, texture, slice: { top: 1, right: 1, bottom: 1, left: 1 } });
		}, 1, create)).uploads).toEqual([]);
		expect(unpaintable).toEqual(['image: nine-slice images are not drawn yet']);
	});
});

describe('UberGeometryEncoder: text in mask mode', () => {
	/** The pre-uber alignment and glyph loop, longhand, as quads of (x, y, u, v) top-left first. */
	function expectedGlyphQuads(
		glyphs: FakeGlyphs,
		text: string,
		x: number,
		y: number,
		size: number,
		align: 'left' | 'center' | 'right',
		verticalAlign: 'top' | 'middle' | 'bottom',
	) {
		const scale = size / 32;
		const metrics = glyphs.measureText(text);
		let startX = x;
		if (align === 'center') startX = x - (metrics.width * scale) / 2;
		if (align === 'right') startX = x - metrics.width * scale;
		let startY = y;
		if (verticalAlign === 'middle') startY = y - (metrics.height * scale) / 2;
		if (verticalAlign === 'bottom') startY = y - metrics.height * scale;

		const quads: number[][] = [];
		let currentX = startX;
		for (const char of text) {
			const info = glyphs.getCharacter(char);
			if (!info) continue;
			const width = info.width * 512 * scale;
			const height = info.height * 512 * scale;
			const left = Math.round(currentX + info.offsetX * scale);
			const top = Math.round(startY + info.offsetY * scale);
			const u0 = info.x;
			const v0 = info.y;
			const u1 = info.x + info.width;
			const v1 = info.y + info.height;
			quads.push([
				left, top, u0, v0,
				left + width, top, u1, v0,
				left + width, top + height, u1, v1,
				left, top + height, u0, v1,
			]);
			currentX += info.advance * scale;
		}
		return quads;
	}

	function quadsOf(floats: Float32Array, count: number): number[][] {
		const quads: number[][] = [];
		for (let glyph = 0; glyph < count; glyph++) {
			const quad: number[] = [];
			for (let corner = 0; corner < 4; corner++) {
				const v = vertex(floats, glyph * 4 + corner);
				quad.push(...v.position, ...v.texCoord);
			}
			quads.push(quad);
		}
		return quads;
	}

	it.each([
		['left', 'top'],
		['center', 'middle'],
		['right', 'bottom'],
	] as const)('places glyphs where the legacy path did (%s, %s)', (align, verticalAlign) => {
		const { draw, glyphs } = setup();
		const { floats, indices } = draw((api) => {
			api.pushTranslate(3, 4);
			api.drawText({ text: 'Ab?A', position: { x: 100.25, y: 50 }, font: 'body', size: 18, color: BLUE, align, verticalAlign });
			api.popTransform();
		});

		// '?' has no glyph and is skipped.
		expect(quadsOf(floats, 3)).toEqual(expectedGlyphQuads(glyphs, 'Ab?A', 103.25, 54, 18, align, verticalAlign).map(f32));
		expect(indices).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
		for (let n = 0; n < 12; n++) {
			expect(vertex(floats, n).fill).toEqual(f32([0.2 * 0.8, 0.4 * 0.8, 0.6 * 0.8, 0.8]));
			expect(vertex(floats, n).mode).toBe(UBER_MODE.mask);
			expect(vertex(floats, n).slot).toBe(0);
		}
	});

	it('snaps glyphs to the device grid of the frame\'s ratio (R7.2)', () => {
		const { draw } = setup(2);
		const { floats } = draw((api) => {
			api.drawText({ text: 'AA', position: { x: 100.3, y: 50.2 }, font: 'body', size: 32, color: BLUE });
		});
		// 'A' is offset (1.5, 2.25), so it starts at (101.8, 52.45): the
		// half-pixel grid of ratio 2 puts it at (102, 52.5).
		expect(vertex(floats, 0).position).toEqual([102, 52.5]);
	});

	it.each([
		[0, 0, 'left', 'top'],
		[0.4, 0.6, 'center', 'middle'],
		[3.5, -2.5, 'right', 'bottom'],
	] as const)('reports an ink extent that contains every glyph it draws (translate %s, %s)', (dx, dy, align, verticalAlign) => {
		const { encoder, draw } = setup();
		const options = { text: 'bAb?A', position: { x: 60.3, y: 40.7 }, font: 'body', size: 21, color: RED, align, verticalAlign };
		const { floats } = draw((api) => {
			api.pushTranslate(dx, dy);
			api.drawText(options);
			api.popTransform();
		});

		const ink = encoder.textInk(options);
		if (!ink) throw new Error('a run with glyphs has an extent');
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (let n = 0; n < floats.length / V.floats; n++) {
			const [x, y] = vertex(floats, n).position;
			minX = Math.min(minX, x - dx);
			minY = Math.min(minY, y - dy);
			maxX = Math.max(maxX, x - dx);
			maxY = Math.max(maxY, y - dy);
		}
		expect(ink.x).toBeLessThanOrEqual(minX);
		expect(ink.y).toBeLessThanOrEqual(minY);
		expect(ink.x + ink.width).toBeGreaterThanOrEqual(maxX);
		expect(ink.y + ink.height).toBeGreaterThanOrEqual(maxY);
		expect(minX - ink.x).toBeLessThanOrEqual(2);
		expect(ink.x + ink.width - maxX).toBeLessThanOrEqual(2);
	});

	it('has no extent for a run it would not draw', () => {
		const { encoder } = setup();
		expect(encoder.textInk({ text: '??', position: { x: 0, y: 0 }, size: 12 })).toBeNull();
		expect(encoder.textInk({ text: 'A', position: null, size: 12 })).toBeNull();
	});

	it('samples the atlas it was built with, which is the resident texture', () => {
		const { encoder, glyphs } = setup();
		const [command] = record((api) => {
			api.drawText({ text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
		});
		const shape: GroupShape = { vertices: 0, indices: 0, texture: null };
		expect(encoder.shape(command, shape)).toBe(true);
		expect(shape.texture).toBe(glyphs);
		expect(encoder.glyphTexture).toBe(glyphs);
	});

	it('refuses a run with a box and no position, and says so', () => {
		const { encode, unpaintable } = setup();
		const { uploads } = encode(record((api) => {
			api.drawText({ text: 'A', box: { x: 0, y: 0, width: 10, height: 10 }, font: 'body', size: 12, color: RED });
		}));
		expect(uploads).toEqual([]);
		expect(unpaintable).toEqual(["text: drawText with a box and no position needs chapter 6's layout"]);
	});
});

describe('UberGeometryEncoder: one program for everything (R5.1)', () => {
	it('marks additive draws for the shader and leaves over alone (R5.22a)', () => {
		const { draw } = setup();
		const { floats } = draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 }, blend: 'additive' });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } });
		});
		expect(vertex(floats, 0).additive).toBe(1);
		expect(vertex(floats, 4).additive).toBe(0);
	});

	it('merges a whole mixed domain, clipped and unclipped, into one GPU draw', () => {
		const { encode } = setup();
		const commands = record((api) => {
			api.drawText({ text: 'Ab', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 }, fill: RED, border: { color: BLUE, width: 1 }, radius: 2 });
			api.pushClip({ x: 0, y: 0, width: 3, height: 3 });
			api.drawCircle({ center: { x: 0, y: 0 }, radius: 3, fill: RED, border: { color: BLUE, width: 1 } });
			api.drawLine({ from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: RED, width: 1 });
			api.popClip();
			api.drawPolygon({ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }], fill: BLUE });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 }, shadow: { color: RED, blur: 4 } });
		});
		const { uploads, work } = encode(commands);
		expect(uploads[0].upload.draws).toHaveLength(1);
		expect(uploads[0].upload.groups).toBe(7);
		expect(work.gpuDraws).toBe(1);
	});

	it('has the helpers the modes are built from', () => {
		expect(borderOutset({ color: RED, width: 4 })).toBe(0);
		expect(borderOutset({ color: RED, width: 4, position: 'center' })).toBe(2);
		expect(borderOutset({ color: RED, width: 4, position: 'outside' })).toBe(4);
		expect(premultiply([0.5, 1, 0, 0.5], [0, 0, 0, 0])).toEqual([0.25, 0.5, 0, 0.5]);
	});
});
