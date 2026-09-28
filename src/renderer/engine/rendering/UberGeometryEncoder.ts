import {
	Border,
	CircleCommand,
	CornerColors,
	CornerRadii,
	DrawCommand,
	DrawCommandKind,
	ImageCommand,
	Mat2D,
	PolygonCommand,
	PolylineCommand,
	RGBA,
	Rect,
	RectCommand,
	ShadowCommand,
	TextAlign,
	TextCommand,
	Vec2,
	VerticalAlign,
	clipRectOf,
} from '../draw';
import { GeometryEncoder, GeometrySink, GroupShape } from '../draw/Batcher';
import { FEATHER_MITER_LIMIT } from '../draw/bounds';
import { isSingleOutline } from '../draw/triangulate';
import { snapToDevice } from '../coords/snapping';
import type { CharacterInfo } from './FontAtlas';

/**
 * Chapter 5's geometry: every draw command as vertices for the uber shader
 * (`src/assets/shaders/uber.vert` and `uber.frag`).
 *
 * R5.4 leaves the per-draw layout open and allows four vertices per quad with
 * per-vertex data. That is what this is: the batcher merges groups into one
 * shared vertex and index buffer, and a quad's four vertices carry the same
 * per-draw values except position, local position, texture coordinate and
 * fill (which varies per corner for R5.9's gradients). It costs upload
 * bandwidth against an instanced layout, and keeps one vertex format for quads
 * and for R5.17's flat polygons, which are not quads.
 *
 * What is resolved here, on the CPU, at submission (R5.28): the transform
 * (positions are screen space, logical pixels, R5.3), premultiplied colours
 * (R5.9, R5.22), corner radii clamped to the half extent (R5.5), the border's
 * outset from its position (R5.7), quad inflation by one device pixel
 * (R5.7), R5.11's shadow geometry, line quads (R5.16) and the polygon feather
 * ring (R5.17). What is left to the shader is coverage: the SDFs, the ramp,
 * the border compositing (R5.8), the shadow falloff (R5.12) and the clip test
 * (R4.4).
 *
 * The clip is per-draw data (R4.1): every vertex carries its draw's clip rect
 * in logical pixels, so a clip change never splits a GPU draw.
 */

/** Vertex layout, in floats: 32 floats, 128 bytes, ten attributes. */
export const UBER_VERTEX = {
	position: 0,
	local: 2,
	halfSize: 4,
	texCoord: 6,
	radii: 8,
	fill: 12,
	border: 16,
	clip: 20,
	/** Border width, border outset, sigma (shadow) or pixel range (text), opacity. */
	shape: 24,
	/** Mode, texture slot, additive flag, unused. */
	mode: 28,
	floats: 32,
} as const;

/** R5.2's modes, as the fragment shader's constants. */
export const UBER_MODE = {
	flat: 0,
	rect: 1,
	shadow: 2,
	circle: 3,
	image: 4,
	text: 5,
	/** The canvas-rasterised bitmap atlas until chapter 6's distance fields (DDB-70). */
	mask: 6,
} as const;

/** Attribute location, float offset and size; the locations are `uber.vert`'s. */
export const UBER_ATTRIBUTES = [
	{ location: 0, offset: UBER_VERTEX.position, size: 2 },
	{ location: 1, offset: UBER_VERTEX.local, size: 2 },
	{ location: 2, offset: UBER_VERTEX.halfSize, size: 2 },
	{ location: 3, offset: UBER_VERTEX.texCoord, size: 2 },
	{ location: 4, offset: UBER_VERTEX.radii, size: 4 },
	{ location: 5, offset: UBER_VERTEX.fill, size: 4 },
	{ location: 6, offset: UBER_VERTEX.border, size: 4 },
	{ location: 7, offset: UBER_VERTEX.clip, size: 4 },
	{ location: 8, offset: UBER_VERTEX.shape, size: 4 },
	{ location: 9, offset: UBER_VERTEX.mode, size: 4 },
] as const;

/** `TEXTURE_UNITS` in `uber.frag`. */
export const UBER_TEXTURE_UNITS = 8;

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

export interface UberGeometryEncoderOptions {
	glyphs: GlyphSource;
	onUnpaintable: (kind: DrawCommandKind, detail: string) => void;
}

const WHITE: RGBA = [1, 1, 1, 1];
const TRANSPARENT: RGBA = [0, 0, 0, 0];

/** Quad corners in the order top-left, top-right, bottom-right, bottom-left. */
const CORNER_X = [-1, 1, 1, -1] as const;
const CORNER_Y = [-1, -1, 1, 1] as const;
const QUAD_INDICES = [0, 1, 2, 0, 2, 3] as const;


export class UberGeometryEncoder implements GeometryEncoder {
	readonly floatsPerVertex = UBER_VERTEX.floats;
	readonly indexType = 'uint32' as const;

	private readonly glyphs: GlyphSource;
	private readonly onUnpaintable: (kind: DrawCommandKind, detail: string) => void;
	/** The per-draw floats every vertex of a group shares; copied, then patched per vertex. */
	private readonly template = new Float32Array(UBER_VERTEX.floats);
	/** Premultiplied scratch colours, read before the next call overwrites them. */
	private readonly fillScratch: [number, number, number, number] = [0, 0, 0, 0];
	private readonly cornerScratch: [number, number, number, number] = [0, 0, 0, 0];
	private readonly gradientScratch: number[] = new Array(16).fill(0);
	private readonly penScratch = { startX: 0, startY: 0, scale: 1 };
	private readonly pointScratch = { x: 0, y: 0 };
	/** R5.17: screen-space outline and outward offsets, grown and reused. */
	private outline = new Float64Array(0);
	private devicePixel = 1;
	private ratioValue = 1;

	constructor({ glyphs, onUnpaintable }: UberGeometryEncoderOptions) {
		this.glyphs = glyphs;
		this.onUnpaintable = onUnpaintable;
	}

	/**
	 * `dpr * uiScale` for the frame being encoded (R7.2), set by the backend
	 * at `beginFrame`. It sizes R5.7's inflation and R5.17's feather, and
	 * places glyphs on the device grid.
	 */
	get ratio(): number {
		return this.ratioValue;
	}

	set ratio(ratio: number) {
		this.ratioValue = ratio;
		this.devicePixel = ratio > 0 ? 1 / ratio : 1;
	}

	/** The texture key text groups report; the backend makes it resident on unit 0. */
	get glyphTexture(): GlyphSource {
		return this.glyphs;
	}

	shape(command: DrawCommand, out: GroupShape): boolean {
		switch (command.kind) {
			case 'shadow':
				// A negative spread that consumes the box leaves nothing to blur (R5.11).
				if (command.rect.width + 2 * command.shadow.spread <= 0) return true;
				if (command.rect.height + 2 * command.shadow.spread <= 0) return true;
				if (isDegenerate(command.transform)) return true;
				out.vertices = 4;
				out.indices = 6;
				return true;
			case 'rect':
			case 'circle':
				if (isDegenerate(command.transform)) return true;
				out.vertices = 4;
				out.indices = 6;
				return true;
			case 'line':
				if (command.width <= 0 || isDegenerate(command.transform)) return true;
				out.vertices = 4;
				out.indices = 6;
				return true;
			case 'polyline': {
				const segments = polylineSegments(command);
				if (segments === 0 || command.width <= 0 || isDegenerate(command.transform)) return true;
				out.vertices = segments * 4;
				out.indices = segments * 6;
				return true;
			}
			case 'polygon':
				return this.shapePolygon(command, out);
			case 'image':
				return this.shapeImage(command, out);
			case 'text':
				return this.shapeText(command, out);
		}
	}

	encode(command: DrawCommand, sink: GeometrySink, slot: number): void {
		switch (command.kind) {
			case 'rect':
				this.encodeRect(command, sink);
				return;
			case 'shadow':
				this.encodeShadow(command, sink);
				return;
			case 'circle':
				this.encodeCircle(command, sink);
				return;
			case 'line':
				this.begin(command, UBER_MODE.rect, -1);
				this.segment(sink, 0, command.transform, command.from, command.to, command.width / 2,
					command.cap === 'round', command.cap === 'round', command.color);
				return;
			case 'polyline':
				this.encodePolyline(command, sink);
				return;
			case 'polygon':
				this.encodePolygon(command, sink);
				return;
			case 'image':
				this.encodeImage(command, sink, slot);
				return;
			case 'text':
				this.encodeText(command, sink, slot);
				return;
		}
	}

	// -- rect -------------------------------------------------------------

	private encodeRect(command: RectCommand, sink: GeometrySink): void {
		const { rect, border } = command;
		const halfWidth = rect.width / 2;
		const halfHeight = rect.height / 2;
		const width = border && border.width > 0 ? border.width : 0;
		const outset = width > 0 ? borderOutset(border as Border) : 0;

		this.begin(command, UBER_MODE.rect, -1);
		this.setHalfSize(halfWidth, halfHeight);
		this.setRadii(command.radius, halfWidth, halfHeight);
		this.setBorder(width > 0 ? (border as Border).color : TRANSPARENT, width, outset);

		const fill = command.gradient ? null : premultiply(command.fill ?? WHITE, this.fillScratch);
		const gradient = command.gradient ? this.premultiplyCorners(command.gradient) : null;
		this.quad(sink, command.transform, rect.x + halfWidth, rect.y + halfHeight, halfWidth + outset, halfHeight + outset,
			fill, gradient, halfWidth, halfHeight);
	}

	// -- shadow -----------------------------------------------------------

	/**
	 * R5.11: the owner's rect offset by `offset` and grown by `spread`, radii
	 * grown by CSS's cubic (or shrunk, clamped at zero), padded by three sigma
	 * so the Gaussian of R5.12 has room. `bounds.shadowInk` is the same box.
	 */
	private encodeShadow(command: ShadowCommand, sink: GeometrySink): void {
		const { rect, shadow } = command;
		const spread = shadow.spread;
		const sigma = Math.max(0, shadow.blur) / 2;
		const halfWidth = Math.max(0, rect.width / 2 + spread);
		const halfHeight = Math.max(0, rect.height / 2 + spread);
		const centerX = rect.x + rect.width / 2 + shadow.offset.x;
		const centerY = rect.y + rect.height / 2 + shadow.offset.y;

		this.begin(command, UBER_MODE.shadow, -1);
		this.setHalfSize(halfWidth, halfHeight);
		this.setRadii(command.radius, rect.width / 2, rect.height / 2);
		const radii = this.template;
		const limit = Math.min(halfWidth, halfHeight);
		for (let corner = 0; corner < 4; corner++) {
			const index = UBER_VERTEX.radii + corner;
			radii[index] = Math.min(limit, spreadRadius(radii[index], spread));
		}
		this.template[UBER_VERTEX.shape + 2] = sigma;

		const fill = premultiply(shadow.color, this.fillScratch);
		const pad = 3 * sigma;
		this.quad(sink, command.transform, centerX, centerY, halfWidth + pad, halfHeight + pad, fill, null, halfWidth, halfHeight);
	}

	// -- circle -----------------------------------------------------------

	private encodeCircle(command: CircleCommand, sink: GeometrySink): void {
		const { border, radius } = command;
		const width = border && border.width > 0 ? border.width : 0;
		const outset = width > 0 ? borderOutset(border as Border) : 0;

		this.begin(command, UBER_MODE.circle, -1);
		this.setHalfSize(radius, radius);
		this.setBorder(width > 0 ? (border as Border).color : TRANSPARENT, width, outset);
		const fill = premultiply(command.fill ?? WHITE, this.fillScratch);
		this.quad(sink, command.transform, command.center.x, command.center.y, radius + outset, radius + outset,
			fill, null, radius, radius);
	}

	// -- lines ------------------------------------------------------------

	/**
	 * R5.16: each segment is a quad in `rect` mode, oriented along the segment,
	 * so its edges get the same coverage ramp as a rectangle. Interior joints
	 * are round (each segment's end at a joint has a radius of half the width,
	 * which fills the wedge between segments); the two ends of an open
	 * polyline take its cap. Joints overlap, so a translucent stroke is darker
	 * at its joints.
	 */
	private encodePolyline(command: PolylineCommand, sink: GeometrySink): void {
		this.begin(command, UBER_MODE.rect, -1);
		const points = command.points;
		const segments = polylineSegments(command);
		const round = command.cap === 'round';
		const halfWidth = command.width / 2;
		for (let index = 0; index < segments; index++) {
			const from = points[index];
			const to = points[(index + 1) % points.length];
			const capFrom = command.closed || index > 0 ? true : round;
			const capTo = command.closed || index < segments - 1 ? true : round;
			this.segment(sink, index, command.transform, from, to, halfWidth, capFrom, capTo, command.color);
		}
	}

	private segment(
		sink: GeometrySink,
		segmentIndex: number,
		transform: Mat2D,
		from: Vec2,
		to: Vec2,
		halfWidth: number,
		roundFrom: boolean,
		roundTo: boolean,
		color: RGBA,
	): void {
		let dirX = to.x - from.x;
		let dirY = to.y - from.y;
		const length = Math.hypot(dirX, dirY);
		if (length > 1e-9) {
			dirX /= length;
			dirY /= length;
		} else {
			dirX = 1;
			dirY = 0;
		}
		const startX = from.x - (roundFrom ? dirX * halfWidth : 0);
		const startY = from.y - (roundFrom ? dirY * halfWidth : 0);
		const endX = to.x + (roundTo ? dirX * halfWidth : 0);
		const endY = to.y + (roundTo ? dirY * halfWidth : 0);
		const halfLength = Math.hypot(endX - startX, endY - startY) / 2;
		const centerX = (startX + endX) / 2;
		const centerY = (startY + endY) / 2;

		const template = this.template;
		template[UBER_VERTEX.halfSize] = halfLength;
		template[UBER_VERTEX.halfSize + 1] = halfWidth;
		const fromRadius = roundFrom ? Math.min(halfWidth, halfLength) : 0;
		const toRadius = roundTo ? Math.min(halfWidth, halfLength) : 0;
		// Along the segment is local x, so the `from` end holds the left corners.
		template[UBER_VERTEX.radii] = fromRadius;
		template[UBER_VERTEX.radii + 1] = toRadius;
		template[UBER_VERTEX.radii + 2] = toRadius;
		template[UBER_VERTEX.radii + 3] = fromRadius;

		const pad = this.localPixel(transform);
		const extentX = halfLength + pad;
		const extentY = halfWidth + pad;
		const fill = premultiply(color, this.fillScratch);
		const base = segmentIndex * 4;
		for (let corner = 0; corner < 4; corner++) {
			const localX = CORNER_X[corner] * extentX;
			const localY = CORNER_Y[corner] * extentY;
			// Local x along the segment, local y along its normal (-dirY, dirX).
			const x = centerX + dirX * localX - dirY * localY;
			const y = centerY + dirY * localX + dirX * localY;
			this.vertex(sink, base + corner, transform, x, y, localX, localY, 0, 0, fill);
		}
		writeQuadIndices(sink, segmentIndex * 6, base);
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
				// Out of range would address a neighbouring group's vertices in
				// the shared buffer.
				if (index < 0 || index >= count || !Number.isInteger(index)) {
					this.onUnpaintable('polygon', `polygon index ${index} is outside its ${count} points`);
					return false;
				}
			}
		}
		if (command.colors && command.colors.length !== count) {
			this.onUnpaintable('polygon', `a polygon with ${count} points has ${command.colors.length} colours`);
			return false;
		}
		const triangles = Math.floor((indices ? indices.length : count) / 3) * 3;
		const feather = hasOutline(command);
		out.vertices = count + (feather ? count : 0);
		out.indices = triangles + (feather ? count * 6 : 0);
		return true;
	}

	/**
	 * R5.17: `flat` triangles, then a feather ring one device pixel wide
	 * around the outline, its inner edge the polygon's own vertices and its
	 * outer vertices transparent. The ring is built on the whole outline, not
	 * per triangle, so shared interior edges have no seam. It needs `points` to
	 * be that outline (`DrawPolygonOptions`); an indexed list that is not one is
	 * drawn unfeathered rather than with a ring across its interior, and a bare
	 * triangle list is feathered only when it is one triangle.
	 */
	private encodePolygon(command: PolygonCommand, sink: GeometrySink): void {
		this.begin(command, UBER_MODE.flat, -1);
		const { points, colors, transform } = command;
		const count = points.length;
		const fill = colors ? null : premultiply(command.fill ?? WHITE, this.fillScratch);

		if (this.outline.length < count * 4) this.outline = new Float64Array(count * 8);
		const outline = this.outline;
		for (let index = 0; index < count; index++) {
			const point = points[index];
			const x = transform[0] * point.x + transform[2] * point.y + transform[4];
			const y = transform[1] * point.x + transform[3] * point.y + transform[5];
			outline[index * 2] = x;
			outline[index * 2 + 1] = y;
			const color = fill ?? premultiply((colors as readonly RGBA[])[index], this.cornerScratch);
			this.screenVertex(sink, index, x, y, color);
		}

		const triangles = Math.floor((command.indices ? command.indices.length : count) / 3) * 3;
		for (let index = 0; index < triangles; index++) {
			sink.indices[sink.indexOffset + index] = sink.baseVertex + (command.indices ? command.indices[index] : index);
		}
		if (!hasOutline(command)) return;

		this.featherOffsets(count);
		for (let index = 0; index < count; index++) {
			const x = outline[index * 2] + outline[count * 2 + index * 2];
			const y = outline[index * 2 + 1] + outline[count * 2 + index * 2 + 1];
			this.screenVertex(sink, count + index, x, y, TRANSPARENT);
		}
		let offset = sink.indexOffset + triangles;
		for (let index = 0; index < count; index++) {
			const next = (index + 1) % count;
			const inner = sink.baseVertex + index;
			const innerNext = sink.baseVertex + next;
			const outer = sink.baseVertex + count + index;
			const outerNext = sink.baseVertex + count + next;
			sink.indices[offset++] = inner;
			sink.indices[offset++] = innerNext;
			sink.indices[offset++] = outerNext;
			sink.indices[offset++] = inner;
			sink.indices[offset++] = outerNext;
			sink.indices[offset++] = outer;
		}
	}

	/**
	 * Outward miter offsets of one device pixel for the outline in
	 * `outline[0 .. count * 2)`, written after it. Outward is decided by the
	 * outline's signed area, so either winding works.
	 */
	private featherOffsets(count: number): void {
		const outline = this.outline;
		let area = 0;
		for (let index = 0; index < count; index++) {
			const next = (index + 1) % count;
			area += outline[index * 2] * outline[next * 2 + 1] - outline[next * 2] * outline[index * 2 + 1];
		}
		const outward = area >= 0 ? 1 : -1;
		const width = this.devicePixel;

		for (let index = 0; index < count; index++) {
			const previous = (index + count - 1) % count;
			const next = (index + 1) % count;
			const normal = this.pointScratch;
			edgeNormal(outline, previous, index, outward, normal);
			const inX = normal.x;
			const inY = normal.y;
			edgeNormal(outline, index, next, outward, normal);
			const outX = normal.x;
			const outY = normal.y;
			let miterX = inX + outX;
			let miterY = inY + outY;
			const miterLength = Math.hypot(miterX, miterY);
			let scale = width;
			if (miterLength > 1e-9) {
				miterX /= miterLength;
				miterY /= miterLength;
				const cosine = miterX * outX + miterY * outY;
				scale = width * Math.min(FEATHER_MITER_LIMIT, cosine > 1e-9 ? 1 / cosine : FEATHER_MITER_LIMIT);
			} else {
				miterX = outX;
				miterY = outY;
			}
			outline[count * 2 + index * 2] = miterX * scale;
			outline[count * 2 + index * 2 + 1] = miterY * scale;
		}
	}

	// -- image ------------------------------------------------------------

	private shapeImage(command: ImageCommand, out: GroupShape): boolean {
		if (command.slice) {
			// R5.19 is a SHOULD with no caller yet; drawing the image unsliced
			// would stretch its corners, which is the one thing a slice is for.
			this.onUnpaintable('image', 'nine-slice images are not drawn yet');
			return false;
		}
		if (isDegenerate(command.transform)) return true;
		out.vertices = 4;
		out.indices = 6;
		out.texture = command.texture;
		return true;
	}

	private encodeImage(command: ImageCommand, sink: GeometrySink, slot: number): void {
		const { rect, texture, transform } = command;
		this.begin(command, UBER_MODE.image, slot);
		const source = command.sourceRect;
		let u0 = 0;
		let v0 = 0;
		let u1 = 1;
		let v1 = 1;
		if (source) {
			const scaleU = command.sourceSpace === 'uv' ? 1 : 1 / Math.max(1, texture.width);
			const scaleV = command.sourceSpace === 'uv' ? 1 : 1 / Math.max(1, texture.height);
			u0 = source.x * scaleU;
			v0 = source.y * scaleV;
			u1 = (source.x + source.width) * scaleU;
			v1 = (source.y + source.height) * scaleV;
		}
		const tint = premultiply(command.tint ?? WHITE, this.fillScratch);
		for (let corner = 0; corner < 4; corner++) {
			const right = CORNER_X[corner] > 0;
			const bottom = CORNER_Y[corner] > 0;
			this.vertex(sink, corner, transform,
				right ? rect.x + rect.width : rect.x,
				bottom ? rect.y + rect.height : rect.y,
				0, 0, right ? u1 : u0, bottom ? v1 : v0, tint);
		}
		writeQuadIndices(sink, 0, 0);
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
	 * The bitmap atlas's glyph quads in `mask` mode. Placement is unchanged
	 * from the legacy path: the transform moves the anchor only, the pen
	 * starts where the alignment puts it, and each glyph is snapped to the
	 * device grid. `blur` is not read: R3.17's shadow run needs a blurred
	 * glyph pass the bitmap atlas cannot give, and nothing asks for one.
	 * Chapter 6 replaces all of this with `text` mode (DDB-70).
	 */
	private encodeText(command: TextCommand, sink: GeometrySink, slot: number): void {
		const position = command.position;
		if (!position) return;
		const glyphs = this.glyphs;
		this.begin(command, UBER_MODE.mask, slot);
		const color = premultiply(command.color, this.fillScratch);

		const matrix = command.transform;
		const anchorX = matrix[0] * position.x + matrix[2] * position.y + matrix[4];
		const anchorY = matrix[1] * position.x + matrix[3] * position.y + matrix[5];
		const { startX, startY, scale } = this.pen(command, anchorX, anchorY);

		const atlasSize = glyphs.getAtlasSize();
		let currentX = startX;
		let glyph = 0;
		for (let i = 0; i < command.text.length; i++) {
			const info = glyphs.getCharacter(command.text[i]);
			if (!info) continue;

			const charWidth = info.width * atlasSize * scale;
			const charHeight = info.height * atlasSize * scale;
			const pixelX = snapToDevice(currentX + info.offsetX * scale, this.ratioValue);
			const pixelY = snapToDevice(startY + info.offsetY * scale, this.ratioValue);
			const u0 = info.x;
			const v0 = info.y;
			const u1 = info.x + info.width;
			const v1 = info.y + info.height;

			const base = glyph * 4;
			this.screenVertex(sink, base, pixelX, pixelY, color, u0, v0);
			this.screenVertex(sink, base + 1, pixelX + charWidth, pixelY, color, u1, v0);
			this.screenVertex(sink, base + 2, pixelX + charWidth, pixelY + charHeight, color, u1, v1);
			this.screenVertex(sink, base + 3, pixelX, pixelY + charHeight, color, u0, v1);
			writeQuadIndices(sink, glyph * 6, base);

			currentX += info.advance * scale;
			glyph += 1;
		}
	}

	/**
	 * R4.2a's per-run extent, in the run's local space: the union of the glyph
	 * quads `encodeText` would write for a pen anchored at `position`, grown by
	 * one pixel because each glyph is snapped to device pixels after the
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
			const pixelX = snapToDevice(currentX + info.offsetX * scale, this.ratioValue);
			const pixelY = snapToDevice(startY + info.offsetY * scale, this.ratioValue);
			minX = Math.min(minX, pixelX);
			minY = Math.min(minY, pixelY);
			maxX = Math.max(maxX, pixelX + info.width * atlasSize * scale);
			maxY = Math.max(maxY, pixelY + info.height * atlasSize * scale);
			currentX += info.advance * scale;
		}

		if (minX === Infinity) return null;
		return { x: minX - 1, y: minY - 1, width: maxX - minX + 2, height: maxY - minY + 2 };
	}

	/** Where the pen starts and the atlas scale, in a reused object read before the next call. */
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

	// -- vertex writing ---------------------------------------------------

	/** Resets the shared floats for a new group: clip, opacity, mode, slot, additive. */
	private begin(command: DrawCommand, mode: number, slot: number): void {
		const template = this.template;
		template.fill(0);
		const clip = clipRectOf(command.clip);
		template[UBER_VERTEX.clip] = clip.minX;
		template[UBER_VERTEX.clip + 1] = clip.minY;
		template[UBER_VERTEX.clip + 2] = clip.maxX;
		template[UBER_VERTEX.clip + 3] = clip.maxY;
		template[UBER_VERTEX.shape + 3] = command.opacity;
		template[UBER_VERTEX.mode] = mode;
		template[UBER_VERTEX.mode + 1] = Math.max(0, slot);
		template[UBER_VERTEX.mode + 2] = command.blend === 'additive' ? 1 : 0;
	}

	private setHalfSize(halfWidth: number, halfHeight: number): void {
		this.template[UBER_VERTEX.halfSize] = halfWidth;
		this.template[UBER_VERTEX.halfSize + 1] = halfHeight;
	}

	/** R5.5 and R5.7a: four radii, each clamped to the smaller half extent. */
	private setRadii(radius: CornerRadii | null, halfWidth: number, halfHeight: number): void {
		const limit = Math.max(0, Math.min(halfWidth, halfHeight));
		for (let corner = 0; corner < 4; corner++) {
			const value = radius === null ? 0 : typeof radius === 'number' ? radius : radius[corner];
			this.template[UBER_VERTEX.radii + corner] = Math.min(limit, Math.max(0, value));
		}
	}

	private setBorder(color: RGBA, width: number, outset: number): void {
		const template = this.template;
		const alpha = color[3];
		template[UBER_VERTEX.border] = color[0] * alpha;
		template[UBER_VERTEX.border + 1] = color[1] * alpha;
		template[UBER_VERTEX.border + 2] = color[2] * alpha;
		template[UBER_VERTEX.border + 3] = alpha;
		template[UBER_VERTEX.shape] = width;
		template[UBER_VERTEX.shape + 1] = outset;
	}

	/**
	 * A quad centred at (`centerX`, `centerY`) in the command's local space,
	 * covering `extentX` by `extentY` either side of it plus R5.7's device
	 * pixel, with local coordinates measured from the centre. A gradient's
	 * corner colours sit on the shape's own corners (`halfWidth`,
	 * `halfHeight`) and are extrapolated out to the inflated ones.
	 */
	private quad(
		sink: GeometrySink,
		transform: Mat2D,
		centerX: number,
		centerY: number,
		extentX: number,
		extentY: number,
		fill: RGBA | null,
		gradient: number[] | null,
		halfWidth: number,
		halfHeight: number,
	): void {
		const padX = this.devicePixel / Math.hypot(transform[0], transform[1]);
		const padY = this.devicePixel / Math.hypot(transform[2], transform[3]);
		const outerX = extentX + padX;
		const outerY = extentY + padY;
		for (let corner = 0; corner < 4; corner++) {
			const localX = CORNER_X[corner] * outerX;
			const localY = CORNER_Y[corner] * outerY;
			const color = gradient
				? bilinear(gradient, halfWidth > 0 ? 0.5 + localX / (2 * halfWidth) : 0.5,
					halfHeight > 0 ? 0.5 + localY / (2 * halfHeight) : 0.5, this.cornerScratch)
				: (fill as RGBA);
			this.vertex(sink, corner, transform, centerX + localX, centerY + localY, localX, localY, 0, 0, color);
		}
		writeQuadIndices(sink, 0, 0);
	}

	/** One vertex from a local-space point, through the command's transform. */
	private vertex(
		sink: GeometrySink,
		index: number,
		transform: Mat2D,
		x: number,
		y: number,
		localX: number,
		localY: number,
		u: number,
		v: number,
		fill: RGBA,
	): void {
		const point = this.pointScratch;
		point.x = transform[0] * x + transform[2] * y + transform[4];
		point.y = transform[1] * x + transform[3] * y + transform[5];
		const out = sink.vertices;
		const offset = sink.floatOffset + index * UBER_VERTEX.floats;
		out.set(this.template, offset);
		out[offset] = point.x;
		out[offset + 1] = point.y;
		out[offset + UBER_VERTEX.local] = localX;
		out[offset + UBER_VERTEX.local + 1] = localY;
		out[offset + UBER_VERTEX.texCoord] = u;
		out[offset + UBER_VERTEX.texCoord + 1] = v;
		out[offset + UBER_VERTEX.fill] = fill[0];
		out[offset + UBER_VERTEX.fill + 1] = fill[1];
		out[offset + UBER_VERTEX.fill + 2] = fill[2];
		out[offset + UBER_VERTEX.fill + 3] = fill[3];
	}

	/** One vertex already in screen space. */
	private screenVertex(sink: GeometrySink, index: number, x: number, y: number, fill: RGBA, u = 0, v = 0): void {
		const out = sink.vertices;
		const offset = sink.floatOffset + index * UBER_VERTEX.floats;
		out.set(this.template, offset);
		out[offset] = x;
		out[offset + 1] = y;
		out[offset + UBER_VERTEX.texCoord] = u;
		out[offset + UBER_VERTEX.texCoord + 1] = v;
		out[offset + UBER_VERTEX.fill] = fill[0];
		out[offset + UBER_VERTEX.fill + 1] = fill[1];
		out[offset + UBER_VERTEX.fill + 2] = fill[2];
		out[offset + UBER_VERTEX.fill + 3] = fill[3];
	}

	/** One device pixel in local units, on the transform's tighter axis. */
	private localPixel(transform: Mat2D): number {
		const scale = Math.min(Math.hypot(transform[0], transform[1]), Math.hypot(transform[2], transform[3]));
		return this.devicePixel / scale;
	}

	/** R5.9: the four corner colours premultiplied before interpolation, into scratch. */
	private premultiplyCorners(colors: CornerColors): number[] {
		const out = this.gradientScratch;
		for (let corner = 0; corner < 4; corner++) {
			const color = colors[corner];
			const alpha = color[3];
			out[corner * 4] = color[0] * alpha;
			out[corner * 4 + 1] = color[1] * alpha;
			out[corner * 4 + 2] = color[2] * alpha;
			out[corner * 4 + 3] = alpha;
		}
		return out;
	}
}

/** R5.7: how far a border's outer edge sits outside the shape edge. */
export function borderOutset(border: Border): number {
	if (border.position === 'outside') return border.width;
	if (border.position === 'center') return border.width / 2;
	return 0;
}

/**
 * R5.11: a corner radius grown by `spread`. CSS Backgrounds 3 section 6.1.1:
 * a radius at least the spread grows by it, a smaller one by the cubic that
 * keeps a square corner square; a negative spread shrinks, clamped at zero.
 */
export function spreadRadius(radius: number, spread: number): number {
	if (spread < 0) return Math.max(0, radius + spread);
	if (spread === 0 || radius >= spread) return radius + spread;
	const ratio = radius / spread - 1;
	return radius + spread * (1 + ratio * ratio * ratio);
}

/** Straight RGBA to premultiplied (R5.22), into `out`. */
export function premultiply(color: RGBA, out: [number, number, number, number]): RGBA {
	const alpha = color[3];
	out[0] = color[0] * alpha;
	out[1] = color[1] * alpha;
	out[2] = color[2] * alpha;
	out[3] = alpha;
	return out;
}

/**
 * The premultiplied corner colours (top-left, top-right, bottom-right,
 * bottom-left, four floats each) at (`u`, `v`), where the shape's corners are
 * 0 and 1. Outside that range it extrapolates, clamped to a valid
 * premultiplied colour, which is exact along any axis-aligned gradient.
 */
function bilinear(corners: number[], u: number, v: number, out: [number, number, number, number]): RGBA {
	const topLeft = (1 - u) * (1 - v);
	const topRight = u * (1 - v);
	const bottomRight = u * v;
	const bottomLeft = (1 - u) * v;
	for (let channel = 0; channel < 4; channel++) {
		out[channel] = topLeft * corners[channel] + topRight * corners[4 + channel]
			+ bottomRight * corners[8 + channel] + bottomLeft * corners[12 + channel];
	}
	out[3] = Math.min(1, Math.max(0, out[3]));
	for (let channel = 0; channel < 3; channel++) out[channel] = Math.min(out[3], Math.max(0, out[channel]));
	return out;
}

function writeQuadIndices(sink: GeometrySink, indexOffset: number, vertexOffset: number): void {
	const first = sink.indexOffset + indexOffset;
	const base = sink.baseVertex + vertexOffset;
	for (let index = 0; index < 6; index++) sink.indices[first + index] = base + QUAD_INDICES[index];
}

/** A transform that collapses an axis draws nothing, and would divide by zero in the inflation. */
function isDegenerate(transform: Mat2D): boolean {
	return transform[0] * transform[3] - transform[1] * transform[2] === 0;
}

function polylineSegments(command: PolylineCommand): number {
	const count = command.points.length;
	if (count < 2) return 0;
	return command.closed && count > 2 ? count : count - 1;
}

/** Whether the points are an outline R5.17 can feather: one outline its indices cover once, or a single triangle. */
function hasOutline(command: PolygonCommand): boolean {
	if (command.indices === null) return command.points.length === 3;
	return isSingleOutline(command.points, command.indices);
}

/** The unit outward normal of the edge from point `a` to point `b` of `outline` into `out`, zero for a degenerate edge. */
function edgeNormal(outline: Float64Array, a: number, b: number, outward: number, out: { x: number; y: number }): void {
	const dx = outline[b * 2] - outline[a * 2];
	const dy = outline[b * 2 + 1] - outline[a * 2 + 1];
	const length = Math.hypot(dx, dy);
	out.x = length < 1e-9 ? 0 : (dy / length) * outward;
	out.y = length < 1e-9 ? 0 : (-dx / length) * outward;
}
