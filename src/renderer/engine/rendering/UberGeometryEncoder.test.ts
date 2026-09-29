import { DrawApi, DrawCommand, DrawTextOptions, RecordingBackend, RGBA, TextureHandle, UNCLIPPED_RECT } from '../draw';
import { Batcher, GeometryUpload, GroupShape } from '../draw/Batcher';
import { ResidentTextureSet } from '../draw/ResidentTextureSet';
import { TextMetricsService } from '../text/TextMetricsService';
import type { TextLayout } from '../text/TextLayout';
import { GlyphCanvasContext, RASTER_PHASES, RasterGlyphCell, RasterGlyphRun, RasterGlyphSource } from '../text/rasterGlyphs';
import { committedFontAtlas, syntheticFontAtlas } from '../text/testing';
import { RasterGlyphPage } from './RasterGlyphPage';
import { fromHalf, toUnorm8 } from './packing';
import {
	UBER_ATTRIBUTES,
	UBER_FLAGS,
	UBER_INSTANCE,
	UBER_MODE,
	UBER_STRIDE,
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
const I = UBER_INSTANCE;
const CORNER_X = [-1, 1, 1, -1];
const CORNER_Y = [-1, -1, 1, 1];

/** The synthetic atlas's texture: 512 by 64, the key its text groups report. */
const ATLAS_TEXTURE: TextureHandle = { id: 1, width: 512, height: 64, label: 'synthetic atlas' };

function record(
	build: (api: DrawApi) => void,
	ratio = 1,
	prepare?: (api: DrawApi) => void,
	strict = true,
): DrawCommand[] {
	const backend = new RecordingBackend({ maxFrames: 1 });
	backend.loadFontAtlas({ name: 'body', atlas: syntheticFontAtlas(), texture: ATLAS_TEXTURE });
	const api = new DrawApi({ backend, strict });
	prepare?.(api);
	api.beginFrame({ viewport: { width: 800, height: 600 }, ratio });
	build(api);
	api.endFrame();
	return [...backend.commands];
}

interface Encoded {
	/** A copy of the upload's bytes. */
	data: Uint8Array;
	count: number;
	upload: GeometryUpload;
}

function setup(ratio = 1, smallText: RasterGlyphSource | null = null) {
	const text = new TextMetricsService();
	text.addAtlas({ name: 'body', atlas: syntheticFontAtlas() });
	const unpaintable: string[] = [];
	const encoder = new UberGeometryEncoder({
		text,
		onUnpaintable: (kind, detail) => unpaintable.push(`${kind}: ${detail}`),
		smallText,
	});
	encoder.registerFontTexture('body', ATLAS_TEXTURE);
	encoder.ratio = ratio;
	// Every encoding in this file runs under the contract check, so an encoder
	// that writes a count other than the one it reported fails here.
	const batcher = new Batcher({
		encoder,
		textures: new ResidentTextureSet({ units: 4, resident: [ATLAS_TEXTURE] }),
		verify: (command, problem) => {
			throw new Error(`${command.kind}: ${problem}`);
		},
	});

	function encode(commands: DrawCommand[]) {
		const uploads: Encoded[] = [];
		const work = batcher.flush(commands, (upload) => {
			uploads.push({ data: upload.bytes.slice(0, upload.byteCount), count: upload.instanceCount, upload });
		});
		return { uploads, work };
	}

	/** One frame recorded and encoded; the one upload. */
	function draw(build: (api: DrawApi) => void): Encoded {
		const { uploads } = encode(record(build, ratio));
		if (uploads.length !== 1) throw new Error(`expected one upload, got ${uploads.length}`);
		return uploads[0];
	}

	return { encoder, encode, draw, unpaintable, text };
}

/** Instance `n` of an upload, by field, as the vertex stage reads it. */
function instance({ data }: { data: Uint8Array }, n: number) {
	const buffer = data.buffer.slice(data.byteOffset + n * UBER_STRIDE, data.byteOffset + (n + 1) * UBER_STRIDE);
	const floats = new Float32Array(buffer);
	const halves = new Uint16Array(buffer);
	const bytes = new Uint8Array(buffer);
	const float = (word: number, size: number) => Array.from(floats.slice(word, word + size));
	const half = (word: number, lane: number) => fromHalf(halves[word * 2 + lane]);
	const byteLanes = (word: number) => Array.from(bytes.slice(word * 4, word * 4 + 4));
	const geometry = float(I.geometry, 4);
	return {
		corners: [0, 1, 2, 3].map((corner) => float(I.corners + corner * 2, 2)),
		halfSize: geometry.slice(0, 2),
		/** The local position the shader gives corner `corner`. */
		local: (corner: number) => [CORNER_X[corner] * geometry[2], CORNER_Y[corner] * geometry[3]],
		texCoords: geometry,
		clip: float(I.clip, 4),
		radii: [0, 1, 2, 3].map((lane) => half(I.radii, lane)),
		colors: [0, 1, 2, 3].map((corner) => byteLanes(I.colors + corner)),
		border: byteLanes(I.border),
		borderWidth: half(I.shape, 0),
		outset: half(I.shape, 1),
		sigma: half(I.shape, 2),
		opacity: half(I.shape, 3),
		mode: bytes[I.mode * 4],
		slot: bytes[I.mode * 4 + 1],
		flags: bytes[I.mode * 4 + 2],
	};
}

/** A colour as the bytes the encoder writes for it. */
const unorm = (color: readonly number[]) => color.map(toUnorm8);
const pm = (color: RGBA) => unorm(premultiply(color, [0, 0, 0, 0]));
const f32 = (values: readonly number[]) => Array.from(new Float32Array(values));
const close = (values: number[]) => values.map((value) => Math.round(value * 1e4) / 1e4);

describe('UberGeometryEncoder: the instance layout (R5.4)', () => {
	it('packs 104 bytes into twelve attributes that tile the instance without overlap', () => {
		expect(UBER_STRIDE).toBe(104);
		const sizes = { float: 16, half: 8, unorm8: 4, uint8: 4 } as const;
		const spans = UBER_ATTRIBUTES.map((attribute) => [attribute.offset, attribute.offset + sizes[attribute.type]])
			.sort((a, b) => a[0] - b[0]);
		let end = 0;
		for (const [start, stop] of spans) {
			expect(start).toBe(end);
			end = stop;
		}
		expect(end).toBe(UBER_STRIDE);
		expect(new Set(UBER_ATTRIBUTES.map((attribute) => attribute.location)).size).toBe(UBER_ATTRIBUTES.length);
		// WebGL2 guarantees sixteen.
		expect(UBER_ATTRIBUTES.length).toBeLessThanOrEqual(16);
		// The contract check's NaN scan covers exactly the float32 attributes.
		const floatBytes = UBER_ATTRIBUTES.filter((attribute) => attribute.type === 'float').length * 16;
		expect(I.floatWords * 4).toBe(floatBytes);
	});
});

describe('UberGeometryEncoder: rect (R5.5 to R5.10)', () => {
	it('writes one quad inflated by a device pixel, measured from the rect centre (R5.7)', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawRect({ rect: { x: 10, y: 20, width: 100, height: 40 }, fill: RED });
		});
		expect(upload.count).toBe(1);
		expect(upload.data.length).toBe(UBER_STRIDE);
		const first = instance(upload, 0);
		// Top-left, top-right, bottom-right, bottom-left.
		expect(first.corners).toEqual([[9, 19], [111, 19], [111, 61], [9, 61]]);
		expect([0, 1, 2, 3].map(first.local)).toEqual([[-51, -21], [51, -21], [51, 21], [-51, 21]]);
		expect(first.halfSize).toEqual([50, 20]);
		expect(first.mode).toBe(UBER_MODE.rect);
		expect(first.colors).toEqual([0, 1, 2, 3].map(() => [255, 0, 0, 255]));
		expect(first.borderWidth).toBe(0);
		expect(first.radii).toEqual([0, 0, 0, 0]);
		expect(first.opacity).toBe(1);
		expect(first.flags).toBe(0);
	});

	it('inflates by half a logical pixel at ratio 2', () => {
		const { draw } = setup(2);
		const first = instance(draw((api) => {
			api.drawRect({ rect: { x: 10, y: 20, width: 100, height: 40 }, fill: RED });
		}), 0);
		expect(first.corners[0]).toEqual([9.5, 19.5]);
		expect(first.local(2)).toEqual([50.5, 20.5]);
	});

	it('draws white with no border when a rect has neither fill nor border', () => {
		const { draw } = setup();
		const first = instance(draw((api) => api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } })), 0);
		expect(first.colors[0]).toEqual([255, 255, 255, 255]);
		expect(first.borderWidth).toBe(0);
	});

	it('premultiplies fill and border into bytes, and keeps opacity out of both (R5.8, R5.22)', () => {
		const { draw } = setup();
		const first = instance(draw((api) => {
			api.pushOpacity(0.5);
			api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, fill: BLUE, border: { color: [1, 1, 0, 0.5], width: 2 } });
			api.popOpacity();
		}), 0);
		expect(first.colors[0]).toEqual(unorm([0.2 * 0.8, 0.4 * 0.8, 0.6 * 0.8, 0.8]));
		expect(first.border).toEqual([128, 128, 0, 128]);
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
		const first = instance(draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 20, height: 20 }, fill: RED, border: { color: BLUE, width: 6, position } });
		}), 0);
		expect(first.borderWidth).toBe(6);
		expect(first.outset).toBe(outset);
		expect(first.halfSize).toEqual([10, 10]);
		expect(first.local(0)).toEqual([-(10 + outset + 1), -(10 + outset + 1)]);
	});

	it('clamps each corner radius to the smaller half extent, and at zero (R5.5, R5.7a)', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 40, height: 20 }, radius: 100 });
			api.drawRect({ rect: { x: 0, y: 0, width: 40, height: 20 }, radius: [2, 30, -4, 5] });
		});
		expect(instance(upload, 0).radii).toEqual([10, 10, 10, 10]);
		expect(instance(upload, 1).radii).toEqual([2, 10, 0, 5]);
	});

	it('carries the clip rect on every instance, and the all-covering rect under none (R4.1)', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } });
			api.pushClip({ x: 1, y: 2, width: 3, height: 4 });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } });
			api.popClip();
		});
		const none = UNCLIPPED_RECT;
		expect(instance(upload, 0).clip).toEqual([none.minX, none.minY, none.maxX, none.maxY]);
		expect(instance(upload, 1).clip).toEqual([1, 2, 4, 6]);
	});

	it('applies the transform on the CPU and keeps the local coordinates the SDF reads (R5.3)', () => {
		const { draw } = setup();
		const topLeft = instance(draw((api) => {
			// A 90 degree turn and a scale of two about the origin, then a move.
			api.pushTransform([0, 2, -2, 0, 100, 50]);
			api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 6 }, fill: RED });
			api.popTransform();
		}), 0);
		// One device pixel is half a local unit under a scale of two.
		expect(topLeft.local(0)).toEqual([-5.5, -3.5]);
		// Local (-0.5, -0.5) maps to (100 + 1, 50 - 1).
		expect(topLeft.corners[0]).toEqual([101, 49]);
		expect(topLeft.halfSize).toEqual([5, 3]);
	});

	it('premultiplies gradient corners before interpolation and extrapolates to the inflated quad (R5.9)', () => {
		const { draw } = setup();
		const first = instance(draw((api) => {
			// Opaque red at the top to fully transparent red at the bottom.
			api.drawRect({
				rect: { x: 0, y: 0, width: 10, height: 10 },
				gradient: [RED, RED, [1, 0, 0, 0], [1, 0, 0, 0]],
			});
		}), 0);
		// The inflated top edge is 1 px above a 10 px rect, v = -0.1, so alpha
		// extrapolates to 1.1 and clamps to 1.
		expect(first.colors[0]).toEqual([255, 0, 0, 255]);
		// The bottom edge is 1 px below: v = 1.1, alpha -0.1, clamped to 0,
		// and the colour clamps with it, so no negative premultiplied red.
		expect(first.colors[3]).toEqual([0, 0, 0, 0]);
		// The transparent corners are premultiplied to zero, so the rasteriser
		// interpolates (0.5, 0, 0, 0.5) at the midpoint: half-covered red. A
		// straight (1, 0, 0, 0) corner would interpolate to (1, 0, 0, 0.5),
		// which is too bright once treated as premultiplied.
	});
});

describe('UberGeometryEncoder: rect snapping (R7.8, R7.8a)', () => {
	/** The snapped rect's screen edges, from the top-left corner and the half size. */
	function edges(upload: Encoded, n = 0) {
		const first = instance(upload, n);
		const centerX = first.corners[0][0] - first.local(0)[0];
		const centerY = first.corners[0][1] - first.local(0)[1];
		return close([centerX - first.halfSize[0], centerY - first.halfSize[1], centerX + first.halfSize[0], centerY + first.halfSize[1]]);
	}

	it('puts a translated hairline rect\'s edges and border on the device grid', () => {
		const { draw } = setup(2);
		const upload = draw((api) => {
			api.pushTranslate(0.3, 10);
			api.drawRect({ rect: { x: 10, y: 0.4, width: 50.1, height: 20 }, fill: RED, border: { color: BLUE, width: 0.6 } });
			api.popTransform();
		});
		// 10.3 to 10.5, 10.4 to 10.5, 60.4 to 60.5, 30.4 to 30.5 at ratio 2.
		expect(edges(upload)).toEqual([10.5, 10.5, 60.5, 30.5]);
		// 0.6 logical is 1.2 device pixels, which rounds to one.
		expect(instance(upload, 0).borderWidth).toBe(0.5);
	});

	it('snaps a borderless rect, so two that abut at a fractional x share one edge', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 20.3, height: 8 }, fill: RED });
			api.drawRect({ rect: { x: 20.3, y: 0, width: 19.7, height: 8 }, fill: RED });
		});
		expect(edges(upload, 0)).toEqual([0, 0, 20, 8]);
		expect(edges(upload, 1)).toEqual([20, 0, 40, 8]);
		expect(instance(upload, 0).borderWidth).toBe(0);
	});

	it('shifts a center hairline by half its width so the border covers one whole column', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawRect({ rect: { x: 10, y: 10, width: 20, height: 20 }, fill: RED, border: { color: BLUE, width: 1, position: 'center' } });
		});
		// The border straddles 10.5, covering column 10 from 10 to 11.
		expect(edges(upload)).toEqual([10.5, 10.5, 30.5, 30.5]);
		expect(instance(upload, 0).outset).toBe(0.5);
	});

	it('leaves heavy borders, rounded corners and scaled or rotated rects to the coverage ramp (R7.9)', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawRect({ rect: { x: 0.3, y: 0.3, width: 10, height: 10 }, fill: RED, border: { color: BLUE, width: 2 } });
			api.drawRect({ rect: { x: 0.3, y: 0.3, width: 10, height: 10 }, fill: RED, radius: [0, 0, 2, 0] });
			api.pushTransform([2, 0, 0, 2, 0, 0]);
			api.drawRect({ rect: { x: 0.3, y: 0.3, width: 10, height: 10 }, fill: RED });
			api.popTransform();
		});
		expect(edges(upload, 0)).toEqual([0.3, 0.3, 10.3, 10.3]);
		expect(edges(upload, 1)).toEqual([0.3, 0.3, 10.3, 10.3]);
		expect(instance(upload, 2).halfSize).toEqual(f32([5, 5]));
		expect(close(instance(upload, 2).corners[0])).toEqual([-0.4, -0.4]);
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
		const upload = draw((api) => {
			api.drawRect({
				rect: { x: 100, y: 100, width: 40, height: 20 },
				radius: 4,
				fill: RED,
				shadow: { color: [0, 0, 0, 0.5], blur: 8, spread: 2, offset: { x: 3, y: 5 } },
			});
		});
		const shadow = instance(upload, 0);
		expect(shadow.mode).toBe(UBER_MODE.shadow);
		expect(shadow.halfSize).toEqual([22, 12]);
		expect(shadow.radii).toEqual([6, 6, 6, 6]);
		// sigma = blur / 2.
		expect(shadow.sigma).toBe(4);
		expect(shadow.colors[0]).toEqual([0, 0, 0, 128]);
		// Centre (123, 115), half size plus 3 sigma plus one pixel.
		expect(shadow.local(0)).toEqual([-(22 + 12 + 1), -(12 + 12 + 1)]);
		expect(shadow.corners[0]).toEqual([123 - 35, 115 - 25]);
		expect(instance(upload, 1).mode).toBe(UBER_MODE.rect);
	});

	it('draws nothing for a negative spread that consumes the box', () => {
		const { encode } = setup();
		const { uploads } = encode(record((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 10, height: 10 }, shadow: { color: RED, blur: 4, spread: -6 } });
		}));
		expect(uploads[0].upload.groups).toBe(1);
		expect(instance(uploads[0], 0).mode).toBe(UBER_MODE.rect);
	});
});

describe('UberGeometryEncoder: circle and lines (R5.15, R5.16)', () => {
	it('writes a circle as one SDF quad with its border outset', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawCircle({ center: { x: 50, y: 60 }, radius: 10, fill: RED, border: { color: BLUE, width: 2, position: 'center' } });
		});
		expect(upload.count).toBe(1);
		const first = instance(upload, 0);
		expect(first.mode).toBe(UBER_MODE.circle);
		expect(first.halfSize).toEqual([10, 10]);
		expect(first.outset).toBe(1);
		expect(first.local(0)).toEqual([-12, -12]);
		expect(first.corners[0]).toEqual([38, 48]);
	});

	it('writes a line as a rect-mode quad along it, with round caps as radii', () => {
		const { draw } = setup();
		const first = instance(draw((api) => {
			api.drawLine({ from: { x: 10, y: 10 }, to: { x: 10, y: 30 }, color: RED, width: 4, cap: 'round' });
		}), 0);
		expect(first.mode).toBe(UBER_MODE.rect);
		// 20 long plus a 2 px cap at each end, 4 wide.
		expect(first.halfSize).toEqual([12, 2]);
		expect(first.radii).toEqual([2, 2, 2, 2]);
		// Local x runs down the line: the top-left corner is before `from`.
		expect(first.local(0)).toEqual([-13, -3]);
		expect(close(first.corners[0])).toEqual([13, 7]);
	});

	it('gives butt caps square ends and draws nothing for a zero-width line', () => {
		const { draw, encode } = setup();
		const first = instance(draw((api) => {
			api.drawLine({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, color: RED, width: 2 });
		}), 0);
		expect(first.halfSize).toEqual([5, 1]);
		expect(first.radii).toEqual([0, 0, 0, 0]);
		expect(encode(record((api) => {
			api.drawLine({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, color: RED, width: 0 });
		})).uploads).toEqual([]);
	});

	it('writes a polyline segment per edge with round interior joints', () => {
		const { draw } = setup();
		const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
		const open = draw((api) => api.drawPolyline({ points, color: RED, width: 2 }));
		expect(open.count).toBe(2);
		// First segment: butt at the start, round at the joint.
		expect(instance(open, 0).radii).toEqual([0, 1, 1, 0]);
		// Second segment: round at the joint, butt at the end.
		expect(instance(open, 1).radii).toEqual([1, 0, 0, 1]);

		const closed = draw((api) => api.drawPolyline({ points, color: RED, width: 2, closed: true }));
		expect(closed.count).toBe(3);
		for (let segment = 0; segment < 3; segment++) expect(instance(closed, segment).radii).toEqual([1, 1, 1, 1]);
	});
});

describe('UberGeometryEncoder: polygon (R5.17)', () => {
	const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
	const at = ({ x, y }: { x: number; y: number }) => [x, y];

	it('writes flat, premultiplied triangles and a one-device-pixel feather ring around the outline', () => {
		const { draw } = setup(2);
		const upload = draw((api) => {
			api.drawPolygon({ points: square, indices: [0, 1, 2, 0, 2, 3], fill: BLUE });
		});
		// Two triangles, then a ring quad per outline edge.
		expect(upload.count).toBe(2 + 4);
		for (let n = 0; n < 2; n++) {
			expect(instance(upload, n).mode).toBe(UBER_MODE.flat);
			expect(instance(upload, n).colors).toEqual([0, 1, 2, 3].map(() => pm(BLUE)));
		}
		// Each triangle's third corner repeats, so the quad's second triangle has no area.
		expect(instance(upload, 0).corners).toEqual([square[0], square[1], square[2], square[2]].map(at));
		expect(instance(upload, 1).corners).toEqual([square[0], square[2], square[3], square[3]].map(at));

		// The first ring quad: inner 0, inner 1, outer 1, outer 0, the outer
		// corners pushed out along the miter, half a logical pixel from each
		// edge at ratio 2, and transparent.
		const ring = instance(upload, 2);
		expect(ring.mode).toBe(UBER_MODE.flat);
		expect(ring.corners.slice(0, 2)).toEqual([at(square[0]), at(square[1])]);
		expect(close(ring.corners[2])).toEqual([10.5, -0.5]);
		expect(close(ring.corners[3])).toEqual([-0.5, -0.5]);
		expect(ring.colors).toEqual([pm(BLUE), pm(BLUE), [0, 0, 0, 0], [0, 0, 0, 0]]);
		expect(close(instance(upload, 4).corners[3])).toEqual([10.5, 10.5]);
	});

	it('feathers outward whichever way the outline winds', () => {
		const { draw } = setup();
		const reversed = [...square].reverse();
		const upload = draw((api) => api.drawPolygon({ points: reversed, indices: [0, 1, 2, 0, 2, 3], fill: RED }));
		// reversed[0] is (0, 10); its outer corner is below and to the left.
		expect(close(instance(upload, 2).corners[3])).toEqual([-1, 11]);
	});

	it('feathers a single bare triangle, but not a bare list of several', () => {
		const { draw } = setup();
		const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
		expect(draw((api) => api.drawPolygon({ points: triangle, fill: RED })).count).toBe(1 + 3);
		const two = [...triangle, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 10 }];
		expect(draw((api) => api.drawPolygon({ points: two, fill: RED })).count).toBe(2);
	});

	it('draws an indexed list that is not one outline without a ring across its interior', () => {
		const { encode } = setup();
		const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 10 }];
		// Not strict: the draw API reports this list, and still draws it.
		const [upload] = encode(record((api) => {
			api.drawPolygon({ points, indices: [0, 1, 2, 3, 4, 5], fill: RED });
		}, 1, undefined, false)).uploads;
		expect(upload.count).toBe(2);
		expect(instance(upload, 1).corners).toEqual([points[3], points[4], points[5], points[5]].map(at));
	});

	it('premultiplies per-point colours and keeps them on the inner ring', () => {
		const { draw } = setup();
		const colors: RGBA[] = [RED, BLUE, RED, BLUE];
		const upload = draw((api) => api.drawPolygon({ points: square, indices: [0, 1, 2, 0, 2, 3], colors }));
		expect(instance(upload, 0).colors.slice(0, 3)).toEqual([pm(RED), pm(BLUE), pm(RED)]);
		expect(instance(upload, 1).colors.slice(0, 3)).toEqual([pm(RED), pm(RED), pm(BLUE)]);
		// The ring quad from point 1 to point 2.
		expect(instance(upload, 3).colors.slice(0, 2)).toEqual([pm(BLUE), pm(RED)]);
	});

	it('refuses a polygon index outside its points', () => {
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
		const shape: GroupShape = { instances: 0, texture: null };
		expect(encoder.shape(command, shape)).toBe(true);
		expect(shape).toEqual({ instances: 1, texture });

		const buffer = new ArrayBuffer(UBER_STRIDE);
		const sink = {
			floats: new Float32Array(buffer),
			words: new Uint32Array(buffer),
			halves: new Uint16Array(buffer),
			bytes: new Uint8Array(buffer),
			wordOffset: 0,
		};
		encoder.encode(command, sink, 2);
		const image = instance({ data: sink.bytes }, 0);
		expect(image.mode).toBe(UBER_MODE.image);
		expect(image.slot).toBe(2);
		expect(image.corners).toEqual([[10, 10], [60, 10], [60, 35], [10, 35]]);
		expect(image.texCoords).toEqual(f32([0.1, 0.1, 0.6, 0.6]));
		expect(image.colors[0]).toEqual([128, 128, 128, 128]);
	});

});

describe('UberGeometryEncoder: nine-slice image (R5.19)', () => {
	let texture: TextureHandle;
	const create = (api: DrawApi) => {
		texture = api.createTexture({ width: 20, height: 10, label: 'frame' });
	};

	function encodeSliced(build: (api: DrawApi) => void) {
		const { encoder } = setup();
		const [command] = record(build, 1, create);
		const shape: GroupShape = { instances: 0, texture: null };
		expect(encoder.shape(command, shape)).toBe(true);
		const buffer = new ArrayBuffer(UBER_STRIDE * Math.max(1, shape.instances));
		const sink = {
			floats: new Float32Array(buffer),
			words: new Uint32Array(buffer),
			halves: new Uint16Array(buffer),
			bytes: new Uint8Array(buffer),
			wordOffset: 0,
		};
		encoder.encode(command, sink, 1);
		return { shape, quads: Array.from({ length: shape.instances }, (_, n) => instance({ data: sink.bytes }, n)) };
	}

	it('writes nine image quads, row by row, corners unscaled and edges stretched along one axis', () => {
		const { shape, quads } = encodeSliced((api) => {
			api.drawImage({ rect: { x: 10, y: 10, width: 100, height: 50 }, texture, slice: { top: 2, right: 4, bottom: 2, left: 4 } });
		});
		expect(shape).toEqual({ instances: 9, texture });
		expect(quads.map((quad) => quad.mode)).toEqual(new Array(9).fill(UBER_MODE.image));
		// Top-left corner: 4 by 2 logical pixels, the texture's 4 by 2 texels.
		expect(quads[0].corners).toEqual([[10, 10], [14, 10], [14, 12], [10, 12]]);
		expect(quads[0].texCoords).toEqual(f32([0, 0, 0.2, 0.2]));
		// Top edge: stretched across, one texel row band tall.
		expect(quads[1].corners).toEqual([[14, 10], [106, 10], [106, 12], [14, 12]]);
		expect(quads[1].texCoords).toEqual(f32([0.2, 0, 0.8, 0.2]));
		// Centre: stretched both ways.
		expect(quads[4].corners).toEqual([[14, 12], [106, 12], [106, 58], [14, 58]]);
		// Bottom-right corner, same size as the top-left.
		expect(quads[8].corners).toEqual([[106, 58], [110, 58], [110, 60], [106, 60]]);
		expect(quads[8].texCoords).toEqual(f32([0.8, 0.8, 1, 1]));
	});

	it('gives every cell half a texel in UV for the shader\'s clamp, and an unsliced image none', () => {
		const { quads } = encodeSliced((api) => {
			api.drawImage({ rect: { x: 0, y: 0, width: 60, height: 30 }, texture, slice: { top: 2, right: 2, bottom: 2, left: 2 } });
		});
		for (const quad of quads) {
			// The texture is 20 by 10 texels.
			expect(quad.borderWidth).toBeCloseTo(0.5 / 20, 4);
			expect(quad.outset).toBeCloseTo(0.5 / 10, 4);
		}
		const { quads: unsliced } = encodeSliced((api) => {
			api.drawImage({ rect: { x: 0, y: 0, width: 60, height: 30 }, texture });
		});
		expect(unsliced[0].borderWidth).toBe(0);
		expect(unsliced[0].outset).toBe(0);
	});

	it('mirrors a negative-width sliced image like an unsliced one', () => {
		const { quads } = encodeSliced((api) => {
			api.drawImage({ rect: { x: 40, y: 0, width: -40, height: 10 }, texture, slice: { top: 2, right: 4, bottom: 2, left: 4 } });
		});
		expect(quads).toHaveLength(9);
		// The top-left texture corner is drawn at the right end, running left.
		expect(quads[0].corners).toEqual([[40, 0], [36, 0], [36, 2], [40, 2]]);
		expect(quads[0].texCoords).toEqual(f32([0, 0, 0.2, 0.2]));
	});

	it('shares every cell edge exactly with its neighbour, so there is no seam', () => {
		const { quads } = encodeSliced((api) => {
			api.drawImage({ rect: { x: 10.3, y: 7.7, width: 61.9, height: 33.1 }, texture, slice: { top: 3, right: 3, bottom: 3, left: 3 } });
		});
		for (let row = 0; row < 3; row++) {
			for (let column = 0; column < 2; column++) {
				const left = quads[row * 3 + column];
				const right = quads[row * 3 + column + 1];
				expect(right.corners[0]).toEqual(left.corners[1]);
				expect(right.corners[3]).toEqual(left.corners[2]);
			}
		}
	});

	it('sends the grid through the transform and tints every cell', () => {
		const { quads } = encodeSliced((api) => {
			api.pushTransform([2, 0, 0, 2, 5, 0]);
			api.drawImage({ rect: { x: 0, y: 0, width: 20, height: 10 }, texture, slice: { top: 2, right: 2, bottom: 2, left: 2 }, tint: [1, 0, 0, 0.5] });
			api.popTransform();
		});
		expect(quads[0].corners).toEqual([[5, 0], [9, 0], [9, 4], [5, 4]]);
		expect(quads[8].corners).toEqual([[41, 16], [45, 16], [45, 20], [41, 20]]);
		for (const quad of quads) expect(quad.colors[0]).toEqual(pm([1, 0, 0, 0.5]));
	});

	it('draws only the cells with area, and merges into the group with its neighbours', () => {
		const { encode } = setup();
		const { uploads, work } = encode(record((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 5, height: 5 }, fill: RED });
			api.drawImage({ rect: { x: 0, y: 0, width: 40, height: 10 }, texture, slice: { top: 0, right: 4, bottom: 0, left: 4 } });
			api.drawRect({ rect: { x: 0, y: 0, width: 5, height: 5 }, fill: RED });
		}, 1, create));
		expect(uploads).toHaveLength(1);
		expect(uploads[0].count).toBe(1 + 3 + 1);
		expect(work.gpuDraws).toBe(1);
	});
});

describe('UberGeometryEncoder: text (chapter 6)', () => {
	/**
	 * The synthetic atlas at 16 px: A is 10 px wide and 12 tall above the
	 * baseline, b 8 by 12, A then b kerns by -2. Its atlas cells are 30 by 60
	 * texels at x = 32n of 512 by 64.
	 */
	function quadsOf(upload: Encoded, count: number, first = 0): number[][] {
		const quads: number[][] = [];
		for (let quad = first; quad < first + count; quad++) quads.push(instance(upload, quad).corners.flat());
		return quads;
	}

	it('writes a quad per glyph from the layout, in text mode, with the atlas cell as its texture coordinates (R6.5)', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.pushTranslate(3, 4);
			api.drawText({ text: 'A b', position: { x: 100, y: 50 }, font: 'body', size: 16, color: BLUE });
			api.popTransform();
		});

		// The space is a blank: two quads. b sits at 10 + 4 (no kerning across the space).
		expect(upload.count).toBe(2);
		expect(quadsOf(upload, 2)).toEqual([
			[103, 42, 113, 42, 113, 54, 103, 54],
			[117, 42, 125, 42, 125, 54, 117, 54],
		]);
		expect(instance(upload, 1).texCoords).toEqual(f32([32 / 512, 0, 62 / 512, 60 / 64]));
		for (let n = 0; n < 2; n++) {
			const glyph = instance(upload, n);
			expect(glyph.colors).toEqual([0, 1, 2, 3].map(() => pm(BLUE)));
			expect(glyph.mode).toBe(UBER_MODE.text);
			expect(glyph.slot).toBe(0);
			// R6.5's range, a per-draw constant under a translation: 8 * 16 / 48.
			expect(glyph.sigma).toBeCloseTo(8 * 16 / 48, 2);
			// The shadow blur lane (text has no border).
			expect(glyph.borderWidth).toBe(0);
		}
	});

	it('clamps the screen range to at least one device pixel (R6.4a)', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawText({ text: 'A', position: { x: 0, y: 20 }, font: 'body', size: 4, color: RED });
		});
		expect(instance(upload, 0).sigma).toBe(1);
	});

	it('snaps the run origin, not each glyph, to the device grid (R6.16)', () => {
		const { draw } = setup(2);
		const upload = draw((api) => {
			api.drawText({ text: 'AbA', position: { x: 10.3, y: 50.2 }, font: 'body', size: 16, color: BLUE });
		});
		// Origin (10.3, 50.2) to (10.5, 50); the glyphs keep their spacing.
		const [a, b, second] = quadsOf(upload, 3);
		expect(a[0]).toBe(10.5);
		expect(a[1]).toBe(38);
		expect(b[0] - a[0]).toBe(8);
		expect(second[0] - b[0]).toBe(8);
	});

	it('sends every corner through a rotation, snaps nothing, and leaves the range to the shader', () => {
		const { draw } = setup(2);
		const glyph = instance(draw((api) => {
			api.pushTransform([0, 1, -1, 0, 0, 0]);
			api.drawText({ text: 'A', position: { x: 10.3, y: 50.2 }, font: 'body', size: 16, color: BLUE });
			api.popTransform();
		}), 0);
		// The top-left corner (10.3, 38.2) rotated a quarter turn.
		expect(close(glyph.corners[0])).toEqual(close([-38.2, 10.3]));
		expect(glyph.sigma).toBe(0);
		// The unit range the shader's derivative path needs, range over atlas
		// size, in the radii lanes.
		expect(glyph.radii.slice(0, 2)).toEqual([8 / 512, 8 / 64]);
	});

	it('places lines by the placement rules, one after another', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawText({
				text: 'A\nbb',
				box: { x: 0, y: 0, width: 100, height: 60 },
				align: 'right',
				verticalAlign: 'middle',
				font: 'body',
				size: 16,
				color: BLUE,
			});
		});
		// Block of 20 + 16 + 4 centred in 60: baselines 26 and 46. Right-aligned lines of 10 and 16.
		expect(quadsOf(upload, 3)).toEqual([
			[90, 14, 100, 14, 100, 26, 90, 26],
			[84, 34, 92, 34, 92, 46, 84, 46],
			[92, 34, 100, 34, 100, 46, 92, 46],
		]);
	});

	it('draws the measured width: a string drawn twice end to end lands its second copy one width later (R6.8)', () => {
		const { draw, text } = setup();
		const options: Omit<DrawTextOptions, 'position'> = { text: 'AbA', font: 'body', size: 16, color: RED, letterSpacing: 0.125 };
		const { width } = text.measure(options);
		const upload = draw((api) => {
			api.drawText({ ...options, position: { x: 0, y: 20 } });
			api.drawText({ ...options, position: { x: width, y: 20 } });
		});
		const quads = quadsOf(upload, 6);
		// The last glyph's right edge (its plane ends at its advance) is the measured width.
		expect(quads[2][2]).toBe(width);
		expect(quads[3][0]).toBe(width);
		expect(quads[5][0] - quads[3][0]).toBe(quads[2][0] - quads[0][0]);
	});

	it('draws the shadow run first with its blur in device pixels, from the mtsdf alpha (R6.6)', () => {
		const { draw } = setup(2);
		const upload = draw((api) => {
			api.drawText({
				text: 'A',
				position: { x: 0, y: 20 },
				font: 'body',
				size: 16,
				color: RED,
				shadow: { color: BLUE, offset: { x: 1, y: 1 }, blur: 1.5 },
			});
		});
		// The blur rides in the first shape lane.
		expect(instance(upload, 0).borderWidth).toBe(3);
		expect(instance(upload, 0).corners[0]).toEqual([1, 9]);
		expect(instance(upload, 1).borderWidth).toBe(0);
		expect(instance(upload, 1).corners[0]).toEqual([0, 8]);
	});

	it('draws a decoration per line after the glyphs, as a rect-mode quad on whole device rows (R12.4)', () => {
		const { draw } = setup(2);
		const upload = draw((api) => {
			api.drawText({ text: 'AA\n\nA', position: { x: 0, y: 20 }, font: 'body', size: 16, color: RED, decoration: 'underline' });
		});
		// Three glyphs and two decorations: the empty line has none.
		expect(upload.count).toBe(5);
		const rule = instance(upload, 3);
		expect(rule.mode).toBe(UBER_MODE.rect);
		// Nothing of the glyphs' text lanes is left on it.
		expect(rule.radii).toEqual([0, 0, 0, 0]);
		expect([rule.borderWidth, rule.outset, rule.sigma]).toEqual([0, 0, 0]);
		// The underline is centred 2 px below the baseline at 20, one pixel thick.
		expect(rule.halfSize).toEqual([10, 0.5]);
		expect(rule.corners[0]).toEqual([-0.5, 21]);
		expect(rule.corners[2]).toEqual([20.5, 23]);
	});

	it('reports an ink extent that contains every quad it draws, within the cull\'s one-pixel outset (R5.7)', () => {
		const { encoder, draw } = setup();
		const options: DrawTextOptions = {
			text: 'bA b\nAA',
			position: { x: 60.3, y: 40.7 },
			font: 'body',
			size: 21,
			color: RED,
			align: 'center',
			decoration: 'strike',
		};
		const upload = draw((api) => api.drawText(options));
		const ink = encoder.textInk(options);
		if (!ink) throw new Error('a run with glyphs has an extent');
		// A decoration quad is inflated by R5.7's device pixel like any rect;
		// the draw API's cull adds that pixel to every extent.
		for (let n = 0; n < upload.count; n++) {
			for (const [x, y] of instance(upload, n).corners) {
				expect(x).toBeGreaterThanOrEqual(ink.x - 1);
				expect(y).toBeGreaterThanOrEqual(ink.y - 1);
				expect(x).toBeLessThanOrEqual(ink.x + ink.width + 1);
				expect(y).toBeLessThanOrEqual(ink.y + ink.height + 1);
			}
		}
	});

	it('has no extent for a run it would not draw', () => {
		const { encoder } = setup();
		expect(encoder.textInk({ text: '   ', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED })).toBeNull();
		expect(encoder.textInk({ text: 'A', position: { x: 0, y: 0 }, font: 'mono', size: 12, color: RED })).toBeNull();
	});

	it('samples the atlas texture its font role registered, which is resident', () => {
		const { encoder } = setup();
		const [command] = record((api) => {
			api.drawText({ text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
		});
		const shape: GroupShape = { instances: 0, texture: null };
		expect(encoder.shape(command, shape)).toBe(true);
		expect(shape.texture).toBe(ATLAS_TEXTURE);
	});

	it('refuses a run whose font has no atlas, and says so', () => {
		const { encode, unpaintable } = setup();
		const commands = record((api) => {
			api.drawText({ text: 'A', position: { x: 0, y: 0 }, font: 'mono', size: 12, color: RED });
		}, 1, undefined, false);
		const { uploads } = encode(commands);
		expect(uploads).toEqual([]);
		expect(unpaintable).toEqual(["text: drawText with font 'mono', which has no atlas"]);
	});
});

/** A canvas that draws nothing: the encoder tests care where cells go, not what is in them. */
function blankGlyphCanvas(): GlyphCanvasContext {
	const noop = () => undefined;
	const canvas = { width: 0, height: 0 };
	return {
		canvas,
		font: '',
		fillStyle: '',
		textBaseline: 'alphabetic',
		textAlign: 'left',
		setTransform: noop,
		clearRect: noop,
		fillText: noop,
		getImageData: (x, y, width, height) => ({ data: new Uint8Array(width * height * 4) }),
	};
}

const RASTER_PAGE_ID = 90;

/** A real `RasterGlyphPage` over a blank canvas, recording each request and the run it returned by size. */
function rasterSource(): RasterGlyphSource & { requests: string[]; runs: Map<number, RasterGlyphRun> } {
	const page = new RasterGlyphPage({
		textures: {
			create: (options) => ({ id: RASTER_PAGE_ID, width: options.width, height: options.height, label: options.label ?? null }),
			writeRegion: () => undefined,
		},
		familyOf: () => 'ddb-test',
		createCanvas: blankGlyphCanvas,
		now: () => 0,
	});
	const requests: string[] = [];
	const runs = new Map<number, RasterGlyphRun>();
	return {
		requests,
		runs,
		glyphs(font: string, layout: TextLayout, pixelSize: number) {
			requests.push(`${font} ${pixelSize}`);
			const run = page.glyphs(font, layout, pixelSize);
			if (run) runs.set(pixelSize, run);
			return run;
		},
	};
}

function cellOf(source: ReturnType<typeof rasterSource>, pixelSize: number, codePoint: number): { cell: RasterGlyphCell; run: RasterGlyphRun } {
	const run = source.runs.get(pixelSize);
	const cell = run?.cells.get(codePoint);
	if (!run || !cell) throw new Error(`no raster cell for ${codePoint} at ${pixelSize}`);
	return { cell, run };
}

/** Where a raster quad's glyph pen is, in device pixels: its corner less the cell's left, plus its phase. */
function drawnPen(quad: ReturnType<typeof instance>, cell: RasterGlyphCell, run: RasterGlyphRun, ratio = 1): number {
	const phase = Math.round((quad.texCoords[0] * run.width - cell.x) / cell.stride);
	return quad.corners[0][0] * ratio - cell.left + phase / RASTER_PHASES;
}

describe('UberGeometryEncoder: small text from raster glyphs (R6.4a)', () => {
	it('draws a run under the threshold as image quads from its raster atlas, one texel to one pixel', () => {
		const source = rasterSource();
		const { draw } = setup(1, source);
		const upload = draw((api) => {
			api.drawText({ text: 'Ab', position: { x: 10.3, y: 20.4 }, font: 'body', size: 8, color: BLUE });
		});
		expect(source.requests).toEqual(['body 8']);
		expect(upload.count).toBe(2);
		const { cell: a, run } = cellOf(source, 8, 0x41);
		const [first, second] = [instance(upload, 0), instance(upload, 1)];
		// Origin (10.3, 20.4) snaps to (10, 20); A's cell is 5 by 6 above the
		// baseline plus the phases' column, b follows at 5 less 1 of kerning.
		expect(first.corners).toEqual([[10, 14], [16, 14], [16, 20], [10, 20]]);
		expect(second.corners).toEqual([[14, 14], [19, 14], [19, 20], [14, 20]]);
		expect(first.texCoords).toEqual(f32([a.x / run.width, a.y / run.height, (a.x + a.width) / run.width, (a.y + a.height) / run.height]));
		for (const glyph of [first, second]) {
			expect(glyph.mode).toBe(UBER_MODE.image);
			// The atlas is resident on unit 0; the raster page is a dynamic unit.
			expect(glyph.slot).toBe(1);
			expect(glyph.colors).toEqual([0, 1, 2, 3].map(() => pm(BLUE)));
		}
	});

	it('reports the raster atlas as the group\'s texture', () => {
		const { encoder } = setup(1, rasterSource());
		const [command] = record((api) => {
			api.drawText({ text: 'A', position: { x: 0, y: 20 }, font: 'body', size: 8, color: RED });
		});
		const shape: GroupShape = { instances: 0, texture: null };
		expect(encoder.shape(command, shape)).toBe(true);
		expect(shape.texture).toMatchObject({ id: RASTER_PAGE_ID });
	});

	it('draws each pen at its nearest quarter pixel, as a whole-pixel cell in that phase', () => {
		const source = rasterSource();
		const { draw } = setup(1, source);
		// At 7 px A advances 4.375: pens 10, 14.375 and 18.75, which are pixels
		// 10, 14 and 18 in phases 0, 2 and 3.
		const upload = draw((api) => {
			api.drawText({ text: 'AAA', position: { x: 10, y: 20 }, font: 'body', size: 7, color: RED });
		});
		expect([0, 1, 2].map((n) => instance(upload, n).corners[0][0])).toEqual([10, 14, 18]);
		const { cell: a, run } = cellOf(source, 7, 0x41);
		expect([0, 1, 2].map((n) => instance(upload, n).texCoords[0])).toEqual(f32([0, 2, 3].map((phase) => (a.x + phase * a.stride) / run.width)));
	});

	it('keeps the distance field at 9 px, which sits on the threshold, and at 8 px at ratio 2', () => {
		const source = rasterSource();
		const atOne = setup(1, source).draw((api) => {
			api.drawText({ text: 'A', position: { x: 0, y: 20 }, font: 'body', size: 9, color: RED });
		});
		expect(instance(atOne, 0).mode).toBe(UBER_MODE.text);
		const atTwo = setup(2, source).draw((api) => {
			api.drawText({ text: 'A', position: { x: 0, y: 20 }, font: 'body', size: 8, color: RED });
		});
		expect(instance(atTwo, 0).mode).toBe(UBER_MODE.text);
		expect(source.requests).toEqual([]);
	});

	it('rasterises a run under a uniform scale at its device size, placed through the scale', () => {
		const source = rasterSource();
		const { draw } = setup(1, source);
		// A 16 px run on a half-scale stage is 8 device px: under the threshold.
		const upload = draw((api) => {
			api.pushTransform([0.5, 0, 0, 0.5, 3, 1]);
			api.drawText({ text: 'Ab', position: { x: 10, y: 40 }, font: 'body', size: 16, color: RED });
			api.popTransform();
		});
		expect(source.requests).toEqual(['body 8']);
		// Pen (10, 40) is (8, 21) on screen; A's cell is 6 by 6 at 8 px, and b
		// follows at (10 - 2) / 2 = 4 device px.
		expect(instance(upload, 0).mode).toBe(UBER_MODE.image);
		expect(instance(upload, 0).corners).toEqual([[8, 15], [14, 15], [14, 21], [8, 21]]);
		expect(instance(upload, 1).corners[0]).toEqual([12, 15]);
	});

	it('keeps the distance field for rotated or unevenly scaled text and for a blurred shadow run', () => {
		const source = rasterSource();
		const { draw } = setup(1, source);
		const upload = draw((api) => {
			api.pushTransform([0, 1, -1, 0, 0, 0]);
			api.drawText({ text: 'A', position: { x: 0, y: 20 }, font: 'body', size: 8, color: RED });
			api.popTransform();
			api.pushTransform([0.5, 0, 0, 0.75, 0, 0]);
			api.drawText({ text: 'A', position: { x: 0, y: 20 }, font: 'body', size: 8, color: RED });
			api.popTransform();
			api.drawText({ text: 'A', position: { x: 0, y: 40 }, font: 'body', size: 8, color: RED, shadow: { color: BLUE, blur: 2 } });
		});
		// The rotated run, the uneven one, the blurred shadow run, then the
		// shadow's owner, which is sharp and small.
		expect(upload.count).toBe(4);
		expect([0, 1, 2, 3].map((n) => instance(upload, n).mode)).toEqual([UBER_MODE.text, UBER_MODE.text, UBER_MODE.text, UBER_MODE.image]);
		expect(source.requests).toEqual(['body 8']);
	});

	it('keeps the distance field while the source has no atlas to give', () => {
		const { draw } = setup(1, { glyphs: () => null });
		const upload = draw((api) => {
			api.drawText({ text: 'A', position: { x: 0, y: 20 }, font: 'body', size: 8, color: RED });
		});
		expect(instance(upload, 0).mode).toBe(UBER_MODE.text);
	});

	it('keeps equal advances equal, where whole-pixel pens would alternate', () => {
		const source = rasterSource();
		const { draw } = setup(1, source);
		// At 4 px A advances 2.5: the As land 2.5 px apart.
		const upload = draw((api) => {
			api.drawText({ text: 'AAA', position: { x: 10, y: 20 }, font: 'body', size: 4, color: RED });
		});
		const { cell: a, run } = cellOf(source, 4, 0x41);
		expect([0, 1, 2].map((n) => drawnPen(instance(upload, n), a, run))).toEqual([10, 12.5, 15]);
	});

	it('keeps a size on the raster until its range passes the threshold by the hysteresis', () => {
		const source = rasterSource();
		const { encoder } = setup(1, source);
		const modeAt = (scale: number) => {
			const [command] = record((api) => {
				api.pushTransform([scale, 0, 0, scale, 0, 0]);
				api.drawText({ text: 'A', position: { x: 0, y: 20 }, font: 'body', size: 8, color: RED });
				api.popTransform();
			});
			const shape: GroupShape = { instances: 0, texture: null };
			encoder.shape(command, shape);
			return (shape.texture as TextureHandle | null)?.id === RASTER_PAGE_ID ? 'raster' : 'field';
		};
		// Range 1.5 at 9 device px, 1.6 at 9.6.
		expect(modeAt(9.1 / 8)).toBe('field');
		expect(modeAt(8.9 / 8)).toBe('raster');
		expect(modeAt(9.4 / 8)).toBe('raster');
		expect(modeAt(9.7 / 8)).toBe('field');
		expect(modeAt(9.4 / 8)).toBe('field');
	});

	it('still draws decorations after the glyphs, as rect-mode rules', () => {
		const { draw } = setup(1, rasterSource());
		const upload = draw((api) => {
			api.drawText({ text: 'Ab', position: { x: 0, y: 20 }, font: 'body', size: 8, color: RED, decoration: 'underline' });
		});
		expect(upload.count).toBe(3);
		expect(instance(upload, 1).mode).toBe(UBER_MODE.image);
		expect(instance(upload, 2).mode).toBe(UBER_MODE.rect);
	});
});

describe('UberGeometryEncoder: raster text measures as it draws (R6.8, 6.9)', () => {
	const atlas = committedFontAtlas('body');
	const texture: TextureHandle = { id: 1, width: atlas.width, height: atlas.height, label: 'body atlas' };

	function committed() {
		const text = new TextMetricsService();
		text.addAtlas({ name: 'body', atlas });
		const source = rasterSource();
		const encoder = new UberGeometryEncoder({
			text,
			onUnpaintable: (kind, detail) => {
				throw new Error(`${kind}: ${detail}`);
			},
			smallText: source,
		});
		encoder.registerFontTexture('body', texture);
		encoder.ratio = 1;
		const batcher = new Batcher({ encoder, textures: new ResidentTextureSet({ units: 4, resident: [texture] }) });
		function draw(build: (api: DrawApi) => void): Encoded {
			const backend = new RecordingBackend({ maxFrames: 1 });
			backend.loadFontAtlas({ name: 'body', atlas, texture });
			const api = new DrawApi({ backend, strict: true });
			api.beginFrame({ viewport: { width: 800, height: 600 }, ratio: 1 });
			build(api);
			api.endFrame();
			const uploads: Encoded[] = [];
			batcher.flush([...backend.commands], (upload) => {
				uploads.push({ data: upload.bytes.slice(0, upload.byteCount), count: upload.instanceCount, upload });
			});
			if (uploads.length !== 1) throw new Error(`expected one upload, got ${uploads.length}`);
			return uploads[0];
		}
		return { text, source, draw };
	}

	/** Each drawn glyph's pen, read back from the upload, and the layout's, for one run at the origin (x, y). */
	function pens(options: Omit<DrawTextOptions, 'position' | 'font' | 'color'>, x: number) {
		const { text, source, draw } = committed();
		const run = { ...options, font: 'body', color: RED, position: { x, y: 40 } };
		const upload = draw((api) => api.drawText(run));
		const layout = text.layout(run);
		if (!layout) throw new Error('no layout');
		const glyphs = layout.lines[0].glyphs.filter((placed) => placed.glyph.plane);
		expect(upload.count).toBe(glyphs.length);
		const drawn = glyphs.map((placed, n) => {
			const { cell, run: page } = cellOf(source, options.size, placed.glyph.codePoint);
			return drawnPen(instance(upload, n), cell, page);
		});
		const last = glyphs[glyphs.length - 1];
		return {
			drawn,
			layout: glyphs.map((placed) => x + placed.x),
			width: text.measure(run).width,
			lastEnd: drawn[drawn.length - 1] + last.glyph.advance * options.size,
		};
	}

	const cases: { name: string; options: Omit<DrawTextOptions, 'position' | 'font' | 'color'> }[] = [
		{ name: 'kerned pairs', options: { text: 'AVAWAY Tokyo', size: 7 } },
		{ name: 'letter spacing', options: { text: 'attack, ranged', size: 7, letterSpacing: 0.12 } },
		{ name: 'an uppercase transform', options: { text: 'utility heal', size: 8, textTransform: 'uppercase' } },
	];
	for (const { name, options } of cases) {
		it(`puts every glyph within an eighth of a pixel of the layout, and ends the run at the measured width, with ${name}`, () => {
			const result = pens(options, 10);
			result.drawn.forEach((pen, index) => expect(Math.abs(pen - result.layout[index])).toBeLessThanOrEqual(1 / 8));
			// The measured width is the pen after the last glyph, with no letter spacing after it (R6.9).
			expect(Math.abs(result.lastEnd - (10 + result.width))).toBeLessThanOrEqual(1 / 8);
		});
	}

	it('lands a doubled string\'s second copy one measured width after the first', () => {
		const first = pens({ text: 'heal utility', size: 7 }, 10);
		const second = pens({ text: 'heal utility', size: 7 }, 10 + first.width);
		expect(Math.abs(second.drawn[0] - first.drawn[0] - first.width)).toBeLessThanOrEqual(1 / 4);
	});
});

describe('UberGeometryEncoder: one program for everything (R5.1)', () => {
	it('marks additive draws for the shader and leaves over alone (R5.22a)', () => {
		const { draw } = setup();
		const upload = draw((api) => {
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 }, blend: 'additive' });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } });
		});
		expect(instance(upload, 0).flags).toBe(UBER_FLAGS.additive);
		expect(instance(upload, 1).flags).toBe(0);
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
		expect(borderOutset(undefined, 4)).toBe(0);
		expect(borderOutset('center', 4)).toBe(2);
		expect(borderOutset('outside', 4)).toBe(4);
		expect(premultiply([0.5, 1, 0, 0.5], [0, 0, 0, 0])).toEqual([0.25, 0.5, 0, 0.5]);
	});
});
