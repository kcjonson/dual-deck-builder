import { mat4 } from 'gl-matrix';
import {
	CircleCommand,
	DrawCommand,
	DrawCommandKind,
	Mat2D,
	PolygonCommand,
	PolylineCommand,
	RGBA,
	Rect,
	RectCommand,
	TextAlign,
	TextCommand,
	Vec2,
	VerticalAlign,
} from '../draw';
import { GeometryEncoder, GeometrySink, GroupShape } from '../draw/Batcher';
import type { CharacterInfo } from './FontAtlas';

/**
 * The legacy GL backend's vertex format, and the arithmetic that fills it.
 *
 * Every number written here is the number the pre-batcher backend handed the
 * GPU, by the same expressions in the same order, only moved from a per-draw
 * uniform into a per-vertex attribute so that many draws can share one
 * `drawElements`. That is the whole claim this file makes, and the reason the
 * screenshot goldens do not move:
 *
 * - A rect still reaches the vertex shader as the unit quad times a model
 *   matrix built by `gl-matrix` from the resolved transform, the rect centre
 *   and the half size. The matrix is computed exactly as before (Float32Array,
 *   translate then scale) and its six non-trivial entries ride on each vertex;
 *   the shader rebuilds the same 4x4 and multiplies `P * V * M * p` in the same
 *   order, so the GPU does the same float work it did with the uniform.
 * - Fill, border colour, border width and the shape size the border branch
 *   divides by are the old `uColor`, `uStrokeColor`, `uStrokeWidth` and
 *   `uShapeSize`, now constant across the four vertices of their quad.
 * - A glyph is the quad `TextRenderer.buildVertexBufferForColor` wrote, from
 *   the pen position the pre-batch text path computed (`pen` below), with an identity
 *   model, which is what `TextRenderer.flush` uploaded.
 *
 * The one deliberate difference: circles and polygons now carry a border width
 * of zero. The old path never set `uStrokeWidth` for them, so they inherited
 * whatever the previous rect left in the uniform and drew in that rect's
 * border colour. Nothing that draws a circle or polygon is in a committed
 * golden (only the developer screen's primitive shapes section, below the
 * fold), so fixing it moves no captured pixel.
 *
 * Dies with the uber shader (DDB-64), which has its own layout (R5.4). Indices
 * are 32-bit since the WebGL2 backend (R5.4), so an upload is capped by the
 * backend's ring rather than by 65536 vertices.
 */

/** Vertex layout, in floats. 22 floats is 88 bytes and seven attributes. */
export const LEGACY_VERTEX = {
	position: 0,
	texCoord: 2,
	/** Model matrix entries 0, 1, 4, 5. */
	modelLinear: 4,
	/** Model matrix entries 12, 13, then border width, then mode. */
	modelTranslate: 8,
	strokeWidth: 10,
	mode: 11,
	color: 12,
	strokeColor: 16,
	shapeSize: 20,
	floats: 22,
} as const;

/** Mode 0 is a flat or bordered shape; mode 1 + n samples texture unit n as a glyph mask. */
export const LEGACY_MODE_SHAPE = 0;
export const LEGACY_MODE_GLYPH = 1;

/** The parts of a text run its placement depends on; a `TextCommand` and `DrawTextOptions` both fit. */
export interface TextRun {
	readonly text: string;
	readonly position?: Vec2 | null;
	readonly size: number;
	readonly align?: TextAlign;
	readonly verticalAlign?: VerticalAlign;
}

/** What the encoder needs from a font atlas. `FontAtlas` satisfies it; a test's fake does too. */
export interface GlyphSource {
	getCharacter(char: string): CharacterInfo | null;
	getFontSize(): number;
	getAtlasSize(): number;
	measureText(text: string): { width: number; height: number };
}

export interface LegacyGeometryEncoderOptions {
	glyphs: GlyphSource;
	onUnpaintable: (kind: DrawCommandKind, detail: string) => void;
}

const WHITE: RGBA = [1, 1, 1, 1];
const BLACK: RGBA = [0, 0, 0, 1];
const NO_STROKE: RGBA = [0, 0, 0, 0];

const CIRCLE_SEGMENTS = 32;
/** `Renderer.drawCircle`'s fan: the centre, then 33 rim points (the first repeated). */
const CIRCLE_VERTICES = CIRCLE_SEGMENTS + 2;
const CIRCLE_INDICES = CIRCLE_SEGMENTS * 3;

/** Unit-quad corners and texture coordinates, in the order the old quad buffer held them. */
const QUAD_CORNERS = [-1, -1, 0, 0, 1, -1, 1, 0, 1, 1, 1, 1, -1, 1, 0, 1] as const;
const QUAD_INDICES = [0, 1, 2, 0, 2, 3] as const;

export class LegacyGeometryEncoder implements GeometryEncoder {
	readonly floatsPerVertex = LEGACY_VERTEX.floats;
	readonly indexType = 'uint32' as const;
	/** The scissor stays GPU state until DDB-64's shader carries the clip per draw (R4.1). */
	readonly clipIsState = true;

	private readonly glyphs: GlyphSource;
	private readonly onUnpaintable: (kind: DrawCommandKind, detail: string) => void;
	/** Reused for every model matrix, so a rect costs no allocation. */
	private readonly model = mat4.create();
	private readonly translate: [number, number, number] = [0, 0, 0];
	private readonly scale: [number, number, number] = [1, 1, 1];
	/** `fade`'s output for the fill and the stroke, so opacity costs no allocation. */
	private readonly fadedFill: [number, number, number, number] = [0, 0, 0, 0];
	private readonly fadedStroke: [number, number, number, number] = [0, 0, 0, 0];
	private readonly penScratch = { startX: 0, startY: 0, scale: 1 };

	constructor({ glyphs, onUnpaintable }: LegacyGeometryEncoderOptions) {
		this.glyphs = glyphs;
		this.onUnpaintable = onUnpaintable;
	}

	/** The texture key text groups report; the backend makes it its one resident texture. */
	get glyphTexture(): GlyphSource {
		return this.glyphs;
	}

	shape(command: DrawCommand, out: GroupShape): boolean {
		switch (command.kind) {
			case 'rect':
				out.vertices = 4;
				out.indices = 6;
				return true;
			case 'circle':
				out.vertices = CIRCLE_VERTICES;
				out.indices = CIRCLE_INDICES;
				return true;
			case 'polygon':
				return this.shapePolygon(command, out);
			case 'polyline':
				if (command.points.length < 2) return false;
				out.vertices = command.points.length;
				out.indices = (command.points.length - 1 + (command.closed ? 1 : 0)) * 2;
				// `width` is not read: GL lines are one pixel wide on every
				// WebGL implementation this ships on (ANGLE's
				// ALIASED_LINE_WIDTH_RANGE is [1, 1]), so a lineWidth call
				// would only split draws for nothing. Capsules arrive with R2.10.
				out.topology = 'lines';
				return true;
			case 'text':
				return this.shapeText(command, out);
			default:
				this.onUnpaintable(command.kind, `no legacy body for '${command.kind}' commands`);
				return false;
		}
	}

	encode(command: DrawCommand, sink: GeometrySink, slot: number): void {
		switch (command.kind) {
			case 'rect':
				this.encodeRect(command, sink);
				return;
			case 'circle':
				this.encodeCircle(command, sink);
				return;
			case 'polygon':
				this.encodePolygon(command, sink);
				return;
			case 'polyline':
				this.encodePolyline(command, sink);
				return;
			case 'text':
				this.encodeText(command, sink, slot);
				return;
			default:
				// `shape` refused it, so the batcher never asks.
				return;
		}
	}

	// -- rect -------------------------------------------------------------

	private encodeRect(command: RectCommand, sink: GeometrySink): void {
		const { rect, border } = command;
		const model = this.modelMatrix(
			command.transform,
			rect.x + rect.width / 2,
			rect.y + rect.height / 2,
			rect.width / 2,
			rect.height / 2,
		);
		const fill = fade(command.fill ?? WHITE, command.opacity, this.fadedFill);
		// A width with no colour strokes black, which is what `drawQuad` did.
		const strokeWidth = border ? border.width : 0;
		const stroke = strokeWidth > 0 ? fade(border?.color ?? BLACK, command.opacity, this.fadedStroke) : NO_STROKE;

		for (let corner = 0; corner < 4; corner++) {
			writeVertex(
				sink.vertices,
				sink.floatOffset + corner * LEGACY_VERTEX.floats,
				QUAD_CORNERS[corner * 4],
				QUAD_CORNERS[corner * 4 + 1],
				QUAD_CORNERS[corner * 4 + 2],
				QUAD_CORNERS[corner * 4 + 3],
				model,
				strokeWidth,
				LEGACY_MODE_SHAPE,
				fill,
				stroke,
				rect.width,
				rect.height,
			);
		}
		writeIndices(sink, QUAD_INDICES);
	}

	// -- circle -----------------------------------------------------------

	private encodeCircle(command: CircleCommand, sink: GeometrySink): void {
		const model = this.modelMatrix(
			command.transform,
			command.center.x,
			command.center.y,
			command.radius,
			command.radius,
		);
		const fill = fade(command.fill ?? WHITE, command.opacity, this.fadedFill);
		const angleStep = (2 * Math.PI) / CIRCLE_SEGMENTS;

		writeVertex(sink.vertices, sink.floatOffset, 0, 0, 0, 0, model, 0, LEGACY_MODE_SHAPE, fill, NO_STROKE, 0, 0);
		for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
			const angle = i * angleStep;
			writeVertex(
				sink.vertices,
				sink.floatOffset + (i + 1) * LEGACY_VERTEX.floats,
				Math.cos(angle),
				Math.sin(angle),
				0,
				0,
				model,
				0,
				LEGACY_MODE_SHAPE,
				fill,
				NO_STROKE,
				0,
				0,
			);
		}

		let offset = sink.indexOffset;
		for (let i = 1; i <= CIRCLE_SEGMENTS; i++) {
			sink.indices[offset++] = sink.baseVertex;
			sink.indices[offset++] = sink.baseVertex + i;
			// The old fan closed its last triangle on rim point 1 rather than 33.
			sink.indices[offset++] = sink.baseVertex + (i === CIRCLE_SEGMENTS ? 1 : i + 1);
		}
	}

	// -- polygon ----------------------------------------------------------

	private shapePolygon(command: PolygonCommand, out: GroupShape): boolean {
		const count = command.points.length;
		if (count < 3) {
			this.onUnpaintable('polygon', 'a polygon needs at least three points');
			return false;
		}
		const indices = command.indices;
		if (indices) {
			for (const index of indices) {
				// Out of range would address a neighbouring group's vertices in a
				// shared buffer; the old per-draw upload only read garbage.
				if (index < 0 || index >= count || !Number.isInteger(index)) {
					this.onUnpaintable('polygon', `polygon index ${index} is outside its ${count} points`);
					return false;
				}
			}
		}
		out.vertices = count;
		// `drawElements(TRIANGLES, n)` ignored a trailing partial triangle; in a
		// merged draw it would pair with the next group, so it is dropped here.
		out.indices = Math.floor((indices ? indices.length : count) / 3) * 3;
		return true;
	}

	private encodePolygon(command: PolygonCommand, sink: GeometrySink): void {
		const fill = fade(command.fill ?? WHITE, command.opacity, this.fadedFill);
		const model = this.linearModel(command.transform);
		for (let index = 0; index < command.points.length; index++) {
			const point = command.points[index];
			writeVertex(
				sink.vertices,
				sink.floatOffset + index * LEGACY_VERTEX.floats,
				point.x,
				point.y,
				0,
				0,
				model,
				0,
				LEGACY_MODE_SHAPE,
				fill,
				NO_STROKE,
				0,
				0,
			);
		}
		const count = Math.floor((command.indices ? command.indices.length : command.points.length) / 3) * 3;
		for (let index = 0; index < count; index++) {
			sink.indices[sink.indexOffset + index] = sink.baseVertex + (command.indices ? command.indices[index] : index);
		}
	}

	// -- polyline ---------------------------------------------------------

	/**
	 * `LINE_STRIP` and `LINE_LOOP` as indexed `LINES`, so several polylines
	 * share a draw. Each segment is rasterised half-open either way.
	 */
	private encodePolyline(command: PolylineCommand, sink: GeometrySink): void {
		const color = fade(command.color, command.opacity, this.fadedFill);
		const model = this.linearModel(command.transform);
		for (let index = 0; index < command.points.length; index++) {
			const point = command.points[index];
			writeVertex(
				sink.vertices,
				sink.floatOffset + index * LEGACY_VERTEX.floats,
				point.x,
				point.y,
				0,
				0,
				model,
				0,
				LEGACY_MODE_SHAPE,
				color,
				NO_STROKE,
				0,
				0,
			);
		}
		let offset = sink.indexOffset;
		const last = command.points.length - 1;
		for (let index = 0; index < last; index++) {
			sink.indices[offset++] = sink.baseVertex + index;
			sink.indices[offset++] = sink.baseVertex + index + 1;
		}
		if (command.closed) {
			sink.indices[offset++] = sink.baseVertex + last;
			sink.indices[offset++] = sink.baseVertex;
		}
	}

	// -- text -------------------------------------------------------------

	private shapeText(command: TextCommand, out: GroupShape): boolean {
		if (!command.position) {
			// R2.13's alignment box needs chapter 6's line breaking to place a
			// pen inside it; `Text` passes a position and this path is unused.
			this.onUnpaintable('text', "drawText with a box and no position needs chapter 6's layout");
			return false;
		}
		let glyphs = 0;
		for (let i = 0; i < command.text.length; i++) {
			if (this.glyphs.getCharacter(command.text[i])) glyphs += 1;
		}
		out.vertices = glyphs * 4;
		out.indices = glyphs * 6;
		out.texture = this.glyphs;
		return true;
	}

	/**
	 * The pre-batch alignment (`pen`), then
	 * `TextRenderer.buildVertexBufferForColor`'s glyph loop, fused. The pen
	 * starts where the old alignment put it and each glyph is rounded to whole pixels
	 * exactly as before. `blur` is not read: R3.17's shadow run needs a blurred
	 * glyph pass this shader does not have, and nothing asks for one.
	 */
	private encodeText(command: TextCommand, sink: GeometrySink, slot: number): void {
		const position = command.position;
		if (!position) return;
		const glyphs = this.glyphs;
		const color = fade(command.color, command.opacity, this.fadedFill);

		// `transformPoint`, inlined so a run allocates no point. `measureText`
		// still returns an object: it is `FontAtlas`'s, which chapter 6
		// replaces, and it is the one allocation per text run left here.
		const matrix = command.transform;
		const anchorX = matrix[0] * position.x + matrix[2] * position.y + matrix[4];
		const anchorY = matrix[1] * position.x + matrix[3] * position.y + matrix[5];
		const { startX, startY, scale } = this.pen(command, anchorX, anchorY);

		const model = IDENTITY_MODEL;
		const mode = LEGACY_MODE_GLYPH + slot;
		const atlasSize = glyphs.getAtlasSize();
		let currentX = startX;
		let glyph = 0;

		for (let i = 0; i < command.text.length; i++) {
			const info = glyphs.getCharacter(command.text[i]);
			if (!info) continue;

			const charWidth = info.width * atlasSize * scale;
			const charHeight = info.height * atlasSize * scale;
			const pixelX = Math.round(currentX + info.offsetX * scale);
			const pixelY = Math.round(startY + info.offsetY * scale);
			const u1 = info.x;
			const v1 = info.y;
			const u2 = info.x + info.width;
			const v2 = info.y + info.height;

			const base = sink.floatOffset + glyph * 4 * LEGACY_VERTEX.floats;
			const step = LEGACY_VERTEX.floats;
			// Bottom left, bottom right, top right, top left, with v flipped.
			writeVertex(sink.vertices, base, pixelX, pixelY + charHeight, u1, v2, model, 0, mode, color, NO_STROKE, 0, 0);
			writeVertex(sink.vertices, base + step, pixelX + charWidth, pixelY + charHeight, u2, v2, model, 0, mode, color, NO_STROKE, 0, 0);
			writeVertex(sink.vertices, base + step * 2, pixelX + charWidth, pixelY, u2, v1, model, 0, mode, color, NO_STROKE, 0, 0);
			writeVertex(sink.vertices, base + step * 3, pixelX, pixelY, u1, v1, model, 0, mode, color, NO_STROKE, 0, 0);

			const indexBase = sink.indexOffset + glyph * 6;
			const vertexBase = sink.baseVertex + glyph * 4;
			for (let index = 0; index < 6; index++) sink.indices[indexBase + index] = vertexBase + QUAD_INDICES[index];

			currentX += info.advance * scale;
			glyph += 1;
		}
	}

	/**
	 * R4.2a's per-run extent, in the run's local space: the union of the glyph
	 * quads `encodeText` would write for a pen anchored at `position`, grown by
	 * one pixel because each glyph is rounded to whole pixels after the
	 * transform's translation is added, which can move it by up to one. Null
	 * when the run has no position or no glyph, which leaves it uncullable
	 * rather than guessed at.
	 */
	textInk(run: TextRun): Rect | null {
		if (!run.position) return null;
		const glyphs = this.glyphs;
		const { startX, startY, scale } = this.pen(run, run.position.x, run.position.y);
		const atlasSize = glyphs.getAtlasSize();
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let currentX = startX;

		for (let i = 0; i < run.text.length; i++) {
			const info = glyphs.getCharacter(run.text[i]);
			if (!info) continue;
			const pixelX = Math.round(currentX + info.offsetX * scale);
			const pixelY = Math.round(startY + info.offsetY * scale);
			minX = Math.min(minX, pixelX);
			minY = Math.min(minY, pixelY);
			maxX = Math.max(maxX, pixelX + info.width * atlasSize * scale);
			maxY = Math.max(maxY, pixelY + info.height * atlasSize * scale);
			currentX += info.advance * scale;
		}

		if (minX === Infinity) return null;
		return { x: minX - 1, y: minY - 1, width: maxX - minX + 2, height: maxY - minY + 2 };
	}

	/**
	 * The alignment the pre-batch text path applied: where the pen starts, and the
	 * atlas scale, in a reused object that is read before the next call.
	 */
	private pen(run: TextRun, anchorX: number, anchorY: number): { startX: number; startY: number; scale: number } {
		const scale = run.size / this.glyphs.getFontSize();
		const metrics = this.glyphs.measureText(run.text);
		const scaledWidth = metrics.width * scale;
		const scaledHeight = metrics.height * scale;

		let startX = anchorX;
		if (run.align === 'center') {
			startX = anchorX - scaledWidth / 2;
		} else if (run.align === 'right') {
			startX = anchorX - scaledWidth;
		}

		let startY = anchorY;
		if (run.verticalAlign === 'middle') {
			startY = anchorY - scaledHeight / 2;
		} else if (run.verticalAlign === 'bottom') {
			startY = anchorY - scaledHeight;
		}

		const pen = this.penScratch;
		pen.startX = startX;
		pen.startY = startY;
		pen.scale = scale;
		return pen;
	}

	// -- matrices ---------------------------------------------------------

	/**
	 * The translate-then-scale every legacy draw built, into a reused matrix.
	 * `mat4.identity` then the six assignments is the same Float32Array state
	 * `mat4.create()` plus `toMat4` produced, so translate and scale see the
	 * same inputs and store the same floats.
	 */
	private modelMatrix(transform: Mat2D, centerX: number, centerY: number, scaleX: number, scaleY: number): mat4 {
		const out = this.linearModel(transform);
		this.translate[0] = centerX;
		this.translate[1] = centerY;
		this.scale[0] = scaleX;
		this.scale[1] = scaleY;
		mat4.translate(out, out, this.translate);
		mat4.scale(out, out, this.scale);
		return out;
	}

	/** `toMat4`: R2.4's 2x3 as the shader's 4x4. */
	private linearModel(transform: Mat2D): mat4 {
		const out = mat4.identity(this.model);
		out[0] = transform[0];
		out[1] = transform[1];
		out[4] = transform[2];
		out[5] = transform[3];
		out[12] = transform[4];
		out[13] = transform[5];
		return out;
	}
}

const IDENTITY_MODEL = mat4.create();

function writeIndices(sink: GeometrySink, local: readonly number[]): void {
	for (let index = 0; index < local.length; index++) {
		sink.indices[sink.indexOffset + index] = sink.baseVertex + local[index];
	}
}

function writeVertex(
	out: Float32Array,
	offset: number,
	x: number,
	y: number,
	u: number,
	v: number,
	model: mat4,
	strokeWidth: number,
	mode: number,
	color: RGBA,
	stroke: RGBA,
	shapeWidth: number,
	shapeHeight: number,
): void {
	out[offset] = x;
	out[offset + 1] = y;
	out[offset + 2] = u;
	out[offset + 3] = v;
	out[offset + 4] = model[0];
	out[offset + 5] = model[1];
	out[offset + 6] = model[4];
	out[offset + 7] = model[5];
	out[offset + 8] = model[12];
	out[offset + 9] = model[13];
	out[offset + 10] = strokeWidth;
	out[offset + 11] = mode;
	out[offset + 12] = color[0];
	out[offset + 13] = color[1];
	out[offset + 14] = color[2];
	out[offset + 15] = color[3];
	out[offset + 16] = stroke[0];
	out[offset + 17] = stroke[1];
	out[offset + 18] = stroke[2];
	out[offset + 19] = stroke[3];
	out[offset + 20] = shapeWidth;
	out[offset + 21] = shapeHeight;
}

/**
 * R2.6 and R3.25: the opacity stack multiplies every alpha, borders included.
 * Writes into `out` rather than allocating; the result is read before the
 * scratch is used again.
 */
function fade(color: RGBA, opacity: number, out: [number, number, number, number]): RGBA {
	if (opacity === 1) return color;
	out[0] = color[0];
	out[1] = color[1];
	out[2] = color[2];
	out[3] = color[3] * opacity;
	return out;
}
