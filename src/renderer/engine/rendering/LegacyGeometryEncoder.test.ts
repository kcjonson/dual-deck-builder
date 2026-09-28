import { mat4 } from 'gl-matrix';
import { DrawApi, DrawCommand, RecordingBackend, RGBA } from '../draw';
import { Batcher, GeometryUpload, GroupShape } from '../draw/Batcher';
import { ResidentTextureSet } from '../draw/ResidentTextureSet';
import type { CharacterInfo } from './FontAtlas';
import { LEGACY_VERTEX, LegacyGeometryEncoder, GlyphSource } from './LegacyGeometryEncoder';
import { LegacyPaintOrder } from './LegacyPaintOrder';

/** A fresh orderer's output, copied, since `apply` reuses its list. */
function legacyPaintOrder(commands: readonly DrawCommand[]): DrawCommand[] {
	return [...new LegacyPaintOrder().apply(commands)];
}

/**
 * The claim `LegacyGeometryEncoder` makes is that every float it writes is the
 * float the per-draw path handed the GPU. So the expected values here are the
 * deleted code's expressions written out longhand (`Renderer.drawQuad`'s model
 * matrix, `LegacyGLBackend.paintText`'s pen, `TextRenderer`'s glyph loop), not
 * calls into the code under test.
 */

const RED: RGBA = [1, 0, 0, 1];
const BLUE: RGBA = [0.2, 0.4, 0.6, 0.8];
const V = LEGACY_VERTEX;

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

function record(build: (api: DrawApi) => void): DrawCommand[] {
	const backend = new RecordingBackend({ maxFrames: 1 });
	backend.loadFontAtlas({ name: 'body', metrics: null, texture: { id: 1, width: 1, height: 1, label: null } });
	const api = new DrawApi({ backend, strict: true });
	api.beginFrame({ viewport: { width: 800, height: 600 } });
	build(api);
	api.endFrame();
	return [...backend.commands];
}

function setup() {
	const glyphs = new FakeGlyphs();
	const unpaintable: string[] = [];
	const encoder = new LegacyGeometryEncoder({
		glyphs,
		onUnpaintable: (kind, detail) => unpaintable.push(`${kind}: ${detail}`),
	});
	// Every encoding in this file runs under the contract check, so an encoder
	// that writes a count other than the one it reported fails here.
	const batcher = new Batcher({
		encoder,
		textures: new ResidentTextureSet({ units: 1, resident: [glyphs] }),
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

	return { encoder, encode, unpaintable, glyphs };
}

/** The floats of vertex `n` of an upload, by field. */
function vertex(floats: Float32Array, n: number) {
	const base = n * V.floats;
	const read = (offset: number, size: number) => Array.from(floats.slice(base + offset, base + offset + size));
	return {
		position: read(V.position, 2),
		texCoord: read(V.texCoord, 2),
		model: [...read(V.modelLinear, 4), floats[base + V.modelTranslate], floats[base + V.modelTranslate + 1]],
		strokeWidth: floats[base + V.strokeWidth],
		mode: floats[base + V.mode],
		color: read(V.color, 4),
		strokeColor: read(V.strokeColor, 4),
		shapeSize: read(V.shapeSize, 2),
	};
}

const f32 = (values: readonly number[]) => Array.from(new Float32Array(values));

/** `Renderer.drawQuad`'s model: identity, then translate to the centre, then scale by the half size. */
function oldModel(cx: number, cy: number, sx: number, sy: number, transform = [1, 0, 0, 1, 0, 0]): number[] {
	const m = mat4.create();
	m[0] = transform[0];
	m[1] = transform[1];
	m[4] = transform[2];
	m[5] = transform[3];
	m[12] = transform[4];
	m[13] = transform[5];
	mat4.translate(m, m, [cx, cy, 0]);
	mat4.scale(m, m, [sx, sy, 1]);
	return [m[0], m[1], m[4], m[5], m[12], m[13]];
}

describe('LegacyGeometryEncoder: rect', () => {
	it('writes the unit quad, the old model matrix and the old uniforms on each vertex', () => {
		const { encode } = setup();
		const commands = record((api) => {
			api.drawRect({ rect: { x: 10.5, y: 20, width: 101, height: 33 }, fill: BLUE, border: { color: RED, width: 2 } });
		});
		const [{ floats, indices }] = encode(commands).uploads;

		expect(indices).toEqual([0, 1, 2, 0, 2, 3]);
		const corners = [0, 1, 2, 3].map((n) => vertex(floats, n));
		expect(corners.map((corner) => corner.position)).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
		expect(corners.map((corner) => corner.texCoord)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
		for (const corner of corners) {
			expect(corner.model).toEqual(oldModel(10.5 + 101 / 2, 20 + 33 / 2, 101 / 2, 33 / 2));
			expect(corner.color).toEqual(f32(BLUE));
			expect(corner.strokeColor).toEqual(f32(RED));
			expect(corner.strokeWidth).toBe(2);
			expect(corner.shapeSize).toEqual([101, 33]);
			expect(corner.mode).toBe(0);
		}
	});

	it('draws white with no stroke when a rect has neither fill nor border', () => {
		const { encode } = setup();
		const [{ floats }] = encode(record((api) => api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 } }))).uploads;
		expect(vertex(floats, 0).color).toEqual([1, 1, 1, 1]);
		expect(vertex(floats, 0).strokeWidth).toBe(0);
	});

	it('multiplies the opacity stack into fill and border alpha (R3.25)', () => {
		const { encode } = setup();
		const commands = record((api) => {
			api.pushOpacity(0.5);
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 }, fill: RED, border: { color: BLUE, width: 1 } });
			api.popOpacity();
		});
		const first = vertex(encode(commands).uploads[0].floats, 0);
		expect(first.color[3]).toBe(0.5);
		expect(first.strokeColor[3]).toBe(Math.fround(0.8 * 0.5));
	});

	it('carries a pushed transform into the model exactly as toMat4 did', () => {
		const { encode } = setup();
		const commands = record((api) => {
			api.pushTranslate(7, 9);
			api.drawRect({ rect: { x: 1, y: 2, width: 10, height: 20 }, fill: RED });
			api.popTransform();
		});
		const first = vertex(encode(commands).uploads[0].floats, 0);
		expect(first.model).toEqual(oldModel(6, 12, 5, 10, [1, 0, 0, 1, 7, 9]));
	});
});

describe('LegacyGeometryEncoder: text', () => {
	/**
	 * `paintText` then `TextRenderer.buildVertexBufferForColor`, longhand, for
	 * a run anchored at (x, y) with the given alignment.
	 */
	function oldGlyphQuads(
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
			const charPixelWidth = info.width * 512;
			const charPixelHeight = info.height * 512;
			const charWidth = charPixelWidth * scale;
			const charHeight = charPixelHeight * scale;
			const pixelX = Math.round(currentX + info.offsetX * scale);
			const pixelY = Math.round(startY + info.offsetY * scale);
			quads.push([
				pixelX, pixelY + charHeight, info.x, info.y + info.height,
				pixelX + charWidth, pixelY + charHeight, info.x + info.width, info.y + info.height,
				pixelX + charWidth, pixelY, info.x + info.width, info.y,
				pixelX, pixelY, info.x, info.y,
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

	it('snaps glyphs to the device grid of the frame\'s ratio, not to whole logical pixels (R7.2)', () => {
		const { encode, encoder } = setup();
		encoder.ratio = 2;
		const commands = record((api) => {
			api.drawText({ text: 'AA', position: { x: 100.3, y: 50.2 }, font: 'body', size: 32, color: BLUE });
		});
		const [{ floats }] = encode(commands).uploads;
		const [first] = quadsOf(floats, 1);
		// The top-left corner is the fourth vertex. 'A' is offset (1.5, 2.25),
		// so it starts at (101.8, 52.45): whole-pixel rounding gave (102, 52),
		// the half-pixel grid of ratio 2 gives (102, 52.5).
		const [x, y] = first.slice(12, 14);
		expect([x, y]).toEqual([102, 52.5]);
	});

	it.each([
		['left', 'top'],
		['center', 'middle'],
		['right', 'bottom'],
	] as const)('places glyphs where the old path did (%s, %s)', (align, verticalAlign) => {
		const { encode, glyphs } = setup();
		const commands = record((api) => {
			api.pushTranslate(3, 4);
			api.drawText({ text: 'Ab?A', position: { x: 100.25, y: 50 }, font: 'body', size: 18, color: BLUE, align, verticalAlign });
			api.popTransform();
		});
		const [{ floats, indices }] = encode(commands).uploads;

		// '?' has no glyph and is skipped, as TextRenderer skipped it.
		expect(quadsOf(floats, 3)).toEqual(
			oldGlyphQuads(glyphs, 'Ab?A', 103.25, 54, 18, align, verticalAlign).map(f32),
		);
		expect(indices).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
		for (let n = 0; n < 12; n++) {
			expect(vertex(floats, n).color).toEqual(f32(BLUE));
			expect(vertex(floats, n).mode).toBe(1);
			expect(vertex(floats, n).model).toEqual([1, 0, 0, 1, 0, 0]);
		}
	});

	it.each([
		[0, 0, 'left', 'top'],
		[0.4, 0.6, 'center', 'middle'],
		[3.5, -2.5, 'right', 'bottom'],
	] as const)('reports an ink extent that contains every glyph it draws (translate %s, %s)', (dx, dy, align, verticalAlign) => {
		const { encoder, encode } = setup();
		const options = { text: 'bAb?A', position: { x: 60.3, y: 40.7 }, font: 'body', size: 21, color: RED, align, verticalAlign };
		const [{ floats }] = encode(record((api) => {
			api.pushTranslate(dx, dy);
			api.drawText(options);
			api.popTransform();
		})).uploads;

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
		// Contains what was drawn, and is no more than the rounding slack wider.
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
		const shape: GroupShape = { vertices: 0, indices: 0, topology: 'triangles', texture: null };
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

	it('draws nothing for a run with no glyphs in the atlas', () => {
		const { encode } = setup();
		expect(encode(record((api) => {
			api.drawText({ text: '??', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
		})).uploads).toEqual([]);
	});
});

describe('LegacyGeometryEncoder: circle, polygon, polyline', () => {
	it('writes the old 32-segment fan, closing on rim point 1', () => {
		const { encode } = setup();
		const [{ floats, indices }] = encode(record((api) => {
			api.drawCircle({ center: { x: 50, y: 60 }, radius: 10, fill: RED });
		})).uploads;

		expect(floats.length / V.floats).toBe(34);
		expect(vertex(floats, 0).position).toEqual([0, 0]);
		expect(vertex(floats, 9).position).toEqual(f32([Math.cos((8 * 2 * Math.PI) / 32), Math.sin((8 * 2 * Math.PI) / 32)]));
		expect(vertex(floats, 0).model).toEqual(oldModel(50, 60, 10, 10));
		expect(indices.slice(0, 3)).toEqual([0, 1, 2]);
		expect(indices.slice(-3)).toEqual([0, 32, 1]);
		// Not the stale border of whatever rect drew before it.
		expect(vertex(floats, 0).strokeWidth).toBe(0);
	});

	it('writes a polygon with its transform as the model and drops a trailing partial triangle', () => {
		const { encode } = setup();
		const [{ floats, indices }] = encode(record((api) => {
			api.pushTransform([2, 0, 0, 3, 5, 6]);
			api.drawPolygon({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], indices: [0, 1, 2, 1, 3], fill: RED });
			api.popTransform();
		})).uploads;
		expect(indices).toEqual([0, 1, 2]);
		expect(vertex(floats, 3).position).toEqual([1, 1]);
		expect(vertex(floats, 0).model).toEqual([2, 0, 0, 3, 5, 6]);
	});

	it('refuses a polygon index that would reach a neighbouring group', () => {
		const { encode, unpaintable } = setup();
		const { uploads } = encode(record((api) => {
			api.drawPolygon({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], indices: [0, 1, 3], fill: RED });
		}));
		expect(uploads).toEqual([]);
		expect(unpaintable).toEqual(['polygon: polygon index 3 is outside its 3 points']);
	});

	it('turns an open and a closed polyline into indexed line pairs', () => {
		const { encode } = setup();
		const points = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
		const { uploads } = encode(record((api) => {
			api.drawPolyline({ points, color: RED, width: 1 });
			api.drawPolyline({ points, color: RED, width: 1, closed: true });
		}));
		expect(uploads[0].indices).toEqual([0, 1, 1, 2, 3, 4, 4, 5, 5, 3]);
		expect(uploads[0].upload.draws).toHaveLength(1);
		expect(uploads[0].upload.draws[0].topology).toBe('lines');
	});

	it('reports the kinds the legacy program has no body for', () => {
		const { encode, unpaintable } = setup();
		const { uploads } = encode(record((api) => {
			api.drawLine({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: RED, width: 1 });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 }, fill: RED, shadow: { color: RED, blur: 2 } });
		}));
		expect(unpaintable).toEqual(["line: no legacy body for 'line' commands", "shadow: no legacy body for 'shadow' commands"]);
		// The shadow's owner still draws.
		expect(uploads[0].upload.groups).toBe(1);
	});
});

describe('legacyPaintOrder (TEMPORARY, dies with the ordering re-baseline)', () => {
	it('paints a domain as its shapes, then its text grouped by colour in first-seen order', () => {
		const commands = record((api) => {
			api.drawText({ id: 't1', text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
			api.drawRect({ id: 'r1', rect: { x: 0, y: 0, width: 4, height: 4 }, fill: RED });
			api.drawText({ id: 't2', text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: BLUE });
			api.drawRect({ id: 'r2', rect: { x: 0, y: 0, width: 4, height: 4 }, fill: BLUE });
			api.drawText({ id: 't3', text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
			api.pushOpacity(0.5);
			// Faded red is its own colour, as it was TextRenderer's own key.
			api.drawText({ id: 't4', text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
			api.popOpacity();
		});
		expect(legacyPaintOrder(commands).map((command) => command.id)).toEqual(['r1', 'r2', 't1', 't3', 't2', 't4']);
	});

	it('hoists text within each layer, never above a later layer', () => {
		const commands = record((api) => {
			api.drawText({ id: 'label', text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
			api.drawRect({ id: 'card', rect: { x: 0, y: 0, width: 4, height: 4 }, fill: RED });
			api.pushLayer('popup');
			api.drawText({ id: 'item', text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
			api.drawRect({ id: 'menu', rect: { x: 0, y: 0, width: 4, height: 4 }, fill: BLUE });
			api.popLayer();
			api.drawText({ id: 'late', text: 'A', position: { x: 0, y: 0 }, font: 'body', size: 12, color: BLUE });
		});
		// The partition already put popup after base; each layer is then
		// shapes-then-text on its own.
		expect(legacyPaintOrder(commands).map((command) => command.id)).toEqual([
			'card', 'label', 'late', 'menu', 'item',
		]);
	});

	it('reuses its list and outlines, so a result is only valid until the next apply', () => {
		const order = new LegacyPaintOrder();
		const commands = record((api) => {
			api.drawCircle({ center: { x: 0, y: 0 }, radius: 3, fill: RED, border: { color: BLUE, width: 1 } });
		});
		const first = order.apply(commands);
		const outline = first[1];
		const second = order.apply(commands);
		expect(second).toBe(first);
		expect(second[1]).toBe(outline);
	});

	it('follows a bordered circle with its outline, and leaves a borderless one alone', () => {
		const commands = record((api) => {
			api.drawCircle({ id: 'plain', center: { x: 0, y: 0 }, radius: 3, fill: RED });
			api.drawCircle({ id: 'ringed', center: { x: 5, y: 6 }, radius: 3, fill: RED, border: { color: BLUE, width: 2 } });
		});
		const ordered = legacyPaintOrder(commands);
		expect(ordered.map((command) => `${command.id}:${command.kind}`)).toEqual([
			'plain:circle',
			'ringed:circle',
			'ringed:polyline',
		]);
		const outline = ordered[2];
		if (outline.kind !== 'polyline') throw new Error('expected an outline');
		expect(outline.points).toHaveLength(33);
		expect(outline.closed).toBe(false);
		expect(outline.color).toEqual(BLUE);
		expect(outline.width).toBe(2);
		expect(outline.transform).toEqual([3, 0, 0, 3, 5, 6]);
		expect(outline.clip).toBe(ordered[1].clip);
	});

	it('merges a whole mixed domain into one GPU draw', () => {
		const { encode } = setup();
		const commands = record((api) => {
			api.drawText({ text: 'Ab', position: { x: 0, y: 0 }, font: 'body', size: 12, color: RED });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 }, fill: RED, border: { color: BLUE, width: 1 } });
			api.drawRect({ rect: { x: 0, y: 0, width: 4, height: 4 }, fill: BLUE });
			api.drawCircle({ center: { x: 0, y: 0 }, radius: 3, fill: RED });
		});
		const { uploads, work } = encode(legacyPaintOrder(commands));
		expect(uploads[0].upload.draws).toHaveLength(1);
		expect(uploads[0].upload.groups).toBe(4);
		expect(work.gpuDraws).toBe(1);
	});
});
