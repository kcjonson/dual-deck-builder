import {
	Border,
	BorderPosition,
	CircleCommand,
	CornerColors,
	CornerRadii,
	DrawCommand,
	DrawCommandKind,
	DrawTextOptions,
	ImageCommand,
	Mat2D,
	NineSlice,
	PolygonCommand,
	PolylineCommand,
	RGBA,
	Rect,
	RectCommand,
	ShadowCommand,
	TextCommand,
	Vec2,
	clipRectOf,
} from '../draw';
import { GeometryEncoder, GeometrySink, GroupShape } from '../draw/Batcher';
import type { TextureKey } from '../draw/ResidentTextureSet';
import { FEATHER_MITER_LIMIT } from '../draw/bounds';
import { NineSliceGrid, createNineSliceGrid, nineSliceCellCount, nineSliceGrid } from '../draw/nineSlice';
import { isSingleOutline } from '../draw/triangulate';
import { HairlineRectOptions, SnappedHairlineRect, snapHairlineRect, snapTextOrigin, snapToDevice } from '../coords/snapping';
import type { TextLayout } from '../text/TextLayout';
import { TextMetricsService } from '../text/TextMetricsService';
import { DECORATION_THICKNESS, LineOrigin, decorationOffset, lineOrigin, runInk } from '../text/textPlacement';
import {
	RasterGlyphCell,
	RasterGlyphRun,
	RasterGlyphSource,
	rasterPen,
	rasterPixelSize,
	wantsRasterGlyphs,
} from '../text/rasterGlyphs';
import { toHalf, toUnorm8 } from './packing';

/**
 * Chapter 5's geometry: every draw command as packed instances for the uber
 * shader (`src/assets/shaders/uber.vert` and `uber.frag`).
 *
 * R5.4's instanced shape. Every instance is one quad, drawn as six vertices
 * from `gl_VertexID` with no index buffer: its four screen-space corners, the
 * per-draw values the fragment stage needs, and a colour per corner. A
 * rectangle, circle, shadow, image, glyph, line segment or decoration is one
 * instance; a flat triangle of R5.17 is an instance whose last two corners are
 * the same point (the quad's second triangle has no area), and each quad of
 * its feather ring is an instance with four free corners. So flat polygons and
 * SDF quads share one format, one buffer and one GPU draw, and the batcher's
 * ranges are instance ranges.
 *
 * Corners, local extents and the clip stay float32, so every position the
 * rasteriser and the SDF see is the float the per-vertex layout wrote before
 * (DDB-191 moved no pixel through geometry). Colours are normalised bytes,
 * radii and the shape values half floats, as R5.4 asks; `packing.ts` has the
 * conversions. The clip is inline rather than in a per-flush table, which
 * R5.4 also allows.
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
 * The clip is per-draw data (R4.1): every instance carries its draw's clip
 * rect in logical pixels, so a clip change never splits a GPU draw.
 */

/** Instance layout, in 32-bit words: 26 words, 104 bytes, twelve attributes. */
export const UBER_INSTANCE = {
	/** f32 x8: the screen-space corners, top-left, top-right, bottom-right, bottom-left, x then y. */
	corners: 0,
	/**
	 * f32 x4: half size, then the quad's extent from the shape centre in local
	 * units, for the SDF modes; u0, v0, u1, v1 for `image` and `text`.
	 */
	geometry: 8,
	/** f32 x4: minX, minY, maxX, maxY in logical pixels (R4.1). */
	clip: 12,
	/** f16 x4: corner radii, top-left, top-right, bottom-right, bottom-left; the atlas unit range for `text`. */
	radii: 16,
	/** rgba8 x4: the premultiplied fill at each corner. */
	colors: 18,
	/** rgba8: the premultiplied border. */
	border: 22,
	/**
	 * f16 x4: border width (for `text`, the shadow run's blur in device
	 * pixels), border outset, sigma (`shadow`) or screen distance range
	 * (`text`), opacity.
	 */
	shape: 23,
	/** u8 x4: mode, texture slot, flags (`UBER_FLAGS`), unused. */
	mode: 25,
	words: 26,
	/** Words 0 to 15 are float32; the contract check reads them for NaN. */
	floatWords: 16,
} as const;

/** R5.2's modes, as the shaders' constants. */
export const UBER_MODE = {
	flat: 0,
	rect: 1,
	shadow: 2,
	circle: 3,
	image: 4,
	text: 5,
} as const;

/** Bits of the instance's flags byte. */
export const UBER_FLAGS = {
	/** R5.22a: the fragment's alpha is zeroed. */
	additive: 1,
} as const;

export type UberAttributeType = 'float' | 'half' | 'unorm8' | 'uint8';

export interface UberAttribute {
	/** The `in` in `uber.vert`. */
	name: string;
	location: number;
	/** Components; every attribute is a four-vector. */
	size: 4;
	type: UberAttributeType;
	/** Bytes from the start of the instance. */
	offset: number;
}

const attribute = (name: string, location: number, type: UberAttributeType, word: number): UberAttribute => ({
	name,
	location,
	size: 4,
	type,
	offset: word * 4,
});

/**
 * Every attribute is per instance (divisor 1). `uint8` is an integer
 * attribute (`vertexAttribIPointer`); the rest go through
 * `vertexAttribPointer`, `unorm8` normalised. The locations are `uber.vert`'s.
 */
export const UBER_ATTRIBUTES: readonly UberAttribute[] = [
	attribute('aCorners01', 0, 'float', UBER_INSTANCE.corners),
	attribute('aCorners23', 1, 'float', UBER_INSTANCE.corners + 4),
	attribute('aGeometry', 2, 'float', UBER_INSTANCE.geometry),
	attribute('aClip', 3, 'float', UBER_INSTANCE.clip),
	attribute('aRadii', 4, 'half', UBER_INSTANCE.radii),
	attribute('aColor0', 5, 'unorm8', UBER_INSTANCE.colors),
	attribute('aColor1', 6, 'unorm8', UBER_INSTANCE.colors + 1),
	attribute('aColor2', 7, 'unorm8', UBER_INSTANCE.colors + 2),
	attribute('aColor3', 8, 'unorm8', UBER_INSTANCE.colors + 3),
	attribute('aBorder', 9, 'unorm8', UBER_INSTANCE.border),
	attribute('aShape', 10, 'half', UBER_INSTANCE.shape),
	attribute('aMode', 11, 'uint8', UBER_INSTANCE.mode),
];

/** Bytes per instance. */
export const UBER_STRIDE = UBER_INSTANCE.words * 4;

/** Vertices per instance: two triangles from `gl_VertexID`, no index buffer. */
export const UBER_VERTICES_PER_INSTANCE = 6;

/** `TEXTURE_UNITS` in `uber.frag`. */
export const UBER_TEXTURE_UNITS = 8;

export interface UberGeometryEncoderOptions {
	/** The glyph iteration every text group is laid out by (R6.8). */
	text: TextMetricsService;
	onUnpaintable: (kind: DrawCommandKind, detail: string) => void;
	/** R6.4a's raster glyphs for runs too small for the distance field. Absent, every run is `text` mode. */
	smallText?: RasterGlyphSource | null;
}

const WHITE: RGBA = [1, 1, 1, 1];
const TRANSPARENT: RGBA = [0, 0, 0, 0];

/** Quad corners in the order top-left, top-right, bottom-right, bottom-left. */
const CORNER_X = [-1, 1, 1, -1] as const;
const CORNER_Y = [-1, -1, 1, 1] as const;

/** Word offsets of the fields, flattened for the hot path. */
const CORNERS = UBER_INSTANCE.corners;
const GEOMETRY = UBER_INSTANCE.geometry;
const CLIP = UBER_INSTANCE.clip;
const RADII_HALF = UBER_INSTANCE.radii * 2;
const COLORS_BYTE = UBER_INSTANCE.colors * 4;
const BORDER_BYTE = UBER_INSTANCE.border * 4;
const SHAPE_HALF = UBER_INSTANCE.shape * 2;
const MODE_BYTE = UBER_INSTANCE.mode * 4;
const WORDS = UBER_INSTANCE.words;

export class UberGeometryEncoder implements GeometryEncoder {
	readonly instanceWords = UBER_INSTANCE.words;
	readonly floatWords = UBER_INSTANCE.floatWords;
	readonly verticesPerInstance = UBER_VERTICES_PER_INSTANCE;

	private readonly text: TextMetricsService;
	/** Each font role's atlas texture, the key its groups report (R5.20). */
	private readonly fontTextures = new Map<string, TextureKey>();
	private readonly onUnpaintable: (kind: DrawCommandKind, detail: string) => void;
	/**
	 * The per-draw words every instance of a group shares, through the same
	 * four views the sink has; copied into each instance, then patched.
	 */
	private readonly template = new ArrayBuffer(UBER_INSTANCE.words * 4);
	private readonly templateWords = new Uint32Array(this.template);
	private readonly templateFloats = new Float32Array(this.template);
	private readonly templateHalves = new Uint16Array(this.template);
	private readonly templateBytes = new Uint8Array(this.template);
	/** Premultiplied scratch colours, read before the next call overwrites them. */
	private readonly fillScratch: [number, number, number, number] = [0, 0, 0, 0];
	private readonly cornerScratch: [number, number, number, number] = [0, 0, 0, 0];
	private readonly gradientScratch: number[] = new Array(16).fill(0);
	private readonly originScratch: LineOrigin = { x: 0, y: 0 };
	private readonly snapScratch = { x: 0, y: 0 };
	private readonly hairlineScratch: HairlineRectOptions = { rect: { x: 0, y: 0, width: 0, height: 0 }, borderWidth: 0, ratio: 1 };
	private readonly hairlineOut: SnappedHairlineRect = { rect: { x: 0, y: 0, width: 0, height: 0 }, borderWidth: 0 };
	/** `shape` and `encode` see the same command back to back; its layout is looked up once. */
	private layoutCommand: TextCommand | null = null;
	private layoutResult: TextLayout | null = null;
	private readonly smallText: RasterGlyphSource | null;
	/** Likewise the raster glyphs `shape` chose, so `encode` draws from the texture its group reported. */
	private rasterCommand: TextCommand | null = null;
	private rasterResult: RasterGlyphRun | null = null;
	/**
	 * R6.4a's hysteresis: for each font, the frame each raster pixel size
	 * (`rasterPixelSize`, the device size on a quarter-pixel step) was last
	 * drawn from the raster. A run at a size drawn there this frame or the
	 * last stays there until its range passes the threshold by
	 * `RASTER_RANGE_HYSTERESIS`, so a run hovering at the threshold does not
	 * flicker. Keyed on the size the glyphs are built at rather than on the
	 * command, which is new every frame: runs that share the state share the
	 * glyphs, so they look alike, and a run a quarter pixel away (8 px on a
	 * card and 8 px on a slightly larger stage) keeps its own. The threshold
	 * with the committed atlases is 9 device px, the middle of a step, so the
	 * state covers an eighth of a pixel either side of it.
	 */
	private readonly rasterFrames = new Map<string, Map<number, number>>();
	private frame = 0;
	private readonly rasterPenScratch = { pixel: 0, phase: 0 };
	private readonly pointScratch = { x: 0, y: 0 };
	private readonly sliceScratch: NineSliceGrid = createNineSliceGrid();
	/** R5.17: screen-space outline and outward offsets, grown and reused. */
	private outline = new Float64Array(0);
	/** R5.17: each point's premultiplied colour, four per point, grown and reused. */
	private pointColors = new Float64Array(0);
	private devicePixel = 1;
	private ratioValue = 1;

	constructor({ text, onUnpaintable, smallText = null }: UberGeometryEncoderOptions) {
		this.text = text;
		this.onUnpaintable = onUnpaintable;
		this.smallText = smallText;
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

	/** Between frames: ages R6.4a's hysteresis state, so a size that went unused starts over. */
	beginFrame(): void {
		this.frame += 1;
	}

	/** Names the texture a font role's text groups sample; the backend keeps it resident. */
	registerFontTexture(font: string, texture: TextureKey): void {
		this.fontTextures.set(font, texture);
		this.layoutCommand = null;
		this.layoutResult = null;
	}

	shape(command: DrawCommand, out: GroupShape): boolean {
		switch (command.kind) {
			case 'shadow':
				// A negative spread that consumes the box leaves nothing to blur (R5.11).
				if (command.rect.width + 2 * command.shadow.spread <= 0) return true;
				if (command.rect.height + 2 * command.shadow.spread <= 0) return true;
				if (isDegenerate(command.transform)) return true;
				out.instances = 1;
				return true;
			case 'rect':
			case 'circle':
				if (isDegenerate(command.transform)) return true;
				out.instances = 1;
				return true;
			case 'line':
				if (command.width <= 0 || isDegenerate(command.transform)) return true;
				out.instances = 1;
				return true;
			case 'polyline': {
				const segments = polylineSegments(command);
				if (segments === 0 || command.width <= 0 || isDegenerate(command.transform)) return true;
				out.instances = segments;
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
		const border = command.border;
		let rect = command.rect;
		let width = border && border.width > 0 ? border.width : 0;
		const snapped = this.snappedRect(command, width);
		if (snapped) {
			rect = snapped.rect;
			width = snapped.borderWidth;
		}
		const halfWidth = rect.width / 2;
		const halfHeight = rect.height / 2;
		const outset = width > 0 ? borderOutset((border as Border).position, width) : 0;

		this.begin(command, UBER_MODE.rect, -1);
		this.setHalfSize(halfWidth, halfHeight);
		const limit = Math.min(halfWidth, halfHeight);
		for (let corner = 0; corner < 4; corner++) this.setRadius(corner, clampedRadius(command.radius, corner, limit));
		this.setBorder(width > 0 ? (border as Border).color : TRANSPARENT, width, outset);

		const fill = command.gradient ? null : premultiply(command.fill ?? WHITE, this.fillScratch);
		const gradient = command.gradient ? this.premultiplyCorners(command.gradient) : null;
		this.quad(sink, command.transform, rect.x + halfWidth, rect.y + halfHeight, halfWidth + outset, halfHeight + outset,
			fill, gradient, halfWidth, halfHeight);
	}

	/**
	 * R7.8 and R7.8a under a translate-only transform: a square-cornered rect
	 * whose border is a hairline or absent, its edges and border on the device
	 * grid. Snapped in screen space and handed back in local space (the same
	 * delta, under a translation). Null when the rect keeps its own edges.
	 */
	private snappedRect(command: RectCommand, borderWidth: number): SnappedHairlineRect | null {
		if (!command.translateOnly || hasRadius(command.radius)) return null;
		const tx = command.transform[4];
		const ty = command.transform[5];
		const options = this.hairlineScratch;
		options.rect.x = command.rect.x + tx;
		options.rect.y = command.rect.y + ty;
		options.rect.width = command.rect.width;
		options.rect.height = command.rect.height;
		options.borderWidth = borderWidth;
		options.position = command.border?.position ?? 'inside';
		options.ratio = this.ratioValue;
		const snapped = snapHairlineRect(options, this.hairlineOut);
		if (!snapped) return null;
		snapped.rect.x -= tx;
		snapped.rect.y -= ty;
		return snapped;
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
		const ownerLimit = Math.min(rect.width / 2, rect.height / 2);
		const limit = Math.min(halfWidth, halfHeight);
		for (let corner = 0; corner < 4; corner++) {
			const owner = clampedRadius(command.radius, corner, ownerLimit);
			this.setRadius(corner, Math.min(limit, spreadRadius(owner, spread)));
		}
		this.templateHalves[SHAPE_HALF + 2] = toHalf(sigma);

		const fill = premultiply(shadow.color, this.fillScratch);
		const pad = 3 * sigma;
		this.quad(sink, command.transform, centerX, centerY, halfWidth + pad, halfHeight + pad, fill, null, halfWidth, halfHeight);
	}

	// -- circle -----------------------------------------------------------

	private encodeCircle(command: CircleCommand, sink: GeometrySink): void {
		const { border, radius } = command;
		const width = border && border.width > 0 ? border.width : 0;
		const outset = width > 0 ? borderOutset((border as Border).position, width) : 0;

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

		this.setHalfSize(halfLength, halfWidth);
		const fromRadius = roundFrom ? Math.min(halfWidth, halfLength) : 0;
		const toRadius = roundTo ? Math.min(halfWidth, halfLength) : 0;
		// Along the segment is local x, so the `from` end holds the left corners.
		this.setRadius(0, fromRadius);
		this.setRadius(1, toRadius);
		this.setRadius(2, toRadius);
		this.setRadius(3, fromRadius);

		const pad = this.localPixel(transform);
		const extentX = halfLength + pad;
		const extentY = halfWidth + pad;
		const fill = premultiply(color, this.fillScratch);
		const base = this.instance(sink, segmentIndex);
		this.setExtent(sink, base, extentX, extentY);
		for (let corner = 0; corner < 4; corner++) {
			const localX = CORNER_X[corner] * extentX;
			const localY = CORNER_Y[corner] * extentY;
			// Local x along the segment, local y along its normal (-dirY, dirX).
			const x = centerX + dirX * localX - dirY * localY;
			const y = centerY + dirY * localX + dirX * localY;
			this.corner(sink, base, corner, transform, x, y);
			this.color(sink, base, corner, fill);
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
				// Out of range would read past the points; a bare triangle list
				// cannot be out of range.
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
		const triangles = Math.floor((indices ? indices.length : count) / 3);
		out.instances = triangles + (hasOutline(command) ? count : 0);
		return true;
	}

	/**
	 * R5.17: `flat` triangles, then a feather ring one device pixel wide
	 * around the outline, its inner edge the polygon's own points and its
	 * outer edge transparent. Each triangle is an instance with its third
	 * corner repeated, and each quad of the ring an instance of its own, with
	 * the corners and diagonal the indexed triangles had, so the rasteriser
	 * covers the same pixels. The ring is built on the whole outline, not per
	 * triangle, so shared interior edges have no seam. It needs `points` to be
	 * that outline (`DrawPolygonOptions`); an indexed list that is not one is
	 * drawn unfeathered rather than with a ring across its interior, and a bare
	 * triangle list is feathered only when it is one triangle.
	 */
	private encodePolygon(command: PolygonCommand, sink: GeometrySink): void {
		this.begin(command, UBER_MODE.flat, -1);
		const { points, colors, transform, indices } = command;
		const count = points.length;
		const fill = colors ? null : premultiply(command.fill ?? WHITE, this.fillScratch);

		if (this.outline.length < count * 4) this.outline = new Float64Array(count * 8);
		if (this.pointColors.length < count * 4) this.pointColors = new Float64Array(count * 8);
		const outline = this.outline;
		const pointColors = this.pointColors;
		for (let index = 0; index < count; index++) {
			const point = points[index];
			outline[index * 2] = transform[0] * point.x + transform[2] * point.y + transform[4];
			outline[index * 2 + 1] = transform[1] * point.x + transform[3] * point.y + transform[5];
			const color = fill ?? premultiply((colors as readonly RGBA[])[index], this.cornerScratch);
			for (let channel = 0; channel < 4; channel++) pointColors[index * 4 + channel] = color[channel];
		}

		const triangles = Math.floor((indices ? indices.length : count) / 3);
		for (let triangle = 0; triangle < triangles; triangle++) {
			const base = this.instance(sink, triangle);
			for (let corner = 0; corner < 4; corner++) {
				// The fourth corner repeats the third: the quad's second triangle has no area.
				const vertex = triangle * 3 + Math.min(corner, 2);
				const point = indices ? indices[vertex] : vertex;
				this.screenCorner(sink, base, corner, outline[point * 2], outline[point * 2 + 1]);
				this.pointColor(sink, base, corner, point);
			}
		}
		if (!hasOutline(command)) return;

		this.featherOffsets(count);
		for (let index = 0; index < count; index++) {
			const next = (index + 1) % count;
			const base = this.instance(sink, triangles + index);
			// Inner, inner next, outer next, outer: the two triangles the
			// indexed ring drew, (0, 1, 2) and (0, 2, 3).
			this.screenCorner(sink, base, 0, outline[index * 2], outline[index * 2 + 1]);
			this.screenCorner(sink, base, 1, outline[next * 2], outline[next * 2 + 1]);
			this.screenCorner(sink, base, 2, outline[next * 2] + outline[count * 2 + next * 2],
				outline[next * 2 + 1] + outline[count * 2 + next * 2 + 1]);
			this.screenCorner(sink, base, 3, outline[index * 2] + outline[count * 2 + index * 2],
				outline[index * 2 + 1] + outline[count * 2 + index * 2 + 1]);
			this.pointColor(sink, base, 0, index);
			this.pointColor(sink, base, 1, next);
			this.color(sink, base, 2, TRANSPARENT);
			this.color(sink, base, 3, TRANSPARENT);
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
		if (isDegenerate(command.transform)) return true;
		const instances = command.slice ? nineSliceCellCount(this.sliceGrid(command, command.slice)) : 1;
		if (instances === 0) return true;
		out.instances = instances;
		out.texture = command.texture;
		return true;
	}

	/** R5.19's grid for a sliced image, into the encoder's one scratch grid. */
	private sliceGrid(command: ImageCommand, slice: NineSlice): NineSliceGrid {
		return nineSliceGrid(command, slice, this.sliceScratch);
	}

	private encodeImage(command: ImageCommand, sink: GeometrySink, slot: number): void {
		const { rect, texture, transform } = command;
		this.begin(command, UBER_MODE.image, slot);
		if (command.slice) {
			this.encodeSlicedImage(command, command.slice, sink);
			return;
		}
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
		const base = this.instance(sink, 0);
		this.setTexCoords(sink, base, u0, v0, u1, v1);
		for (let corner = 0; corner < 4; corner++) {
			this.corner(sink, base, corner, transform,
				CORNER_X[corner] > 0 ? rect.x + rect.width : rect.x,
				CORNER_Y[corner] > 0 ? rect.y + rect.height : rect.y);
			this.color(sink, base, corner, tint);
		}
	}

	/**
	 * R5.19: one image-mode quad per cell of the grid, in one group, row by
	 * row. Neighbouring cells share their edge coordinates exactly, and image
	 * mode has no edge ramp, so the rasteriser's fill rule leaves no seam and
	 * no double-covered row between them. Each cell also carries half a
	 * texel, for the shader's clamp to its own texels.
	 */
	private encodeSlicedImage(command: ImageCommand, slice: NineSlice, sink: GeometrySink): void {
		const grid = this.sliceGrid(command, slice);
		const { x, y, u, v } = grid;
		const transform = command.transform;
		const tint = premultiply(command.tint ?? WHITE, this.fillScratch);
		// Half a texel in UV: the shader keeps each cell's samples that far
		// inside its own rect, so filtering never reaches a neighbour.
		this.templateHalves[SHAPE_HALF] = toHalf(0.5 / Math.max(1, command.texture.width));
		this.templateHalves[SHAPE_HALF + 1] = toHalf(0.5 / Math.max(1, command.texture.height));
		let instance = 0;
		for (let row = 0; row < grid.rowCount; row++) {
			const r = grid.rows[row];
			for (let column = 0; column < grid.columnCount; column++) {
				const c = grid.columns[column];
				const base = this.instance(sink, instance++);
				this.setTexCoords(sink, base, u[c], v[r], u[c + 1], v[r + 1]);
				this.corner(sink, base, 0, transform, x[c], y[r]);
				this.corner(sink, base, 1, transform, x[c + 1], y[r]);
				this.corner(sink, base, 2, transform, x[c + 1], y[r + 1]);
				this.corner(sink, base, 3, transform, x[c], y[r + 1]);
				for (let corner = 0; corner < 4; corner++) this.color(sink, base, corner, tint);
			}
		}
	}

	// -- text -------------------------------------------------------------

	private shapeText(command: TextCommand, out: GroupShape): boolean {
		const layout = this.layoutOf(command);
		const texture = this.fontTextures.get(command.font);
		if (!layout || !texture) {
			this.onUnpaintable('text', `drawText with font '${command.font}', which has no atlas`);
			return false;
		}
		if (isDegenerate(command.transform)) return true;
		out.instances = layout.quadCount + this.decorationCount(command, layout);
		out.texture = this.rasterOf(command, layout)?.texture ?? texture;
		return true;
	}

	/**
	 * R6.4a: the raster glyphs for a run whose screen range is under the
	 * threshold (with `RASTER_RANGE_HYSTERESIS` for a size already there), or
	 * null for the distance field. A run qualifies under a
	 * translation or a uniform positive scale (a scaled stage, R7.2's
	 * `uiScale` by transform), whose device font size is fixed; a rotated or
	 * skewed run has no pixel grid to rasterise for, and a blurred shadow run
	 * needs the `mtsdf` distance.
	 */
	private rasterOf(command: TextCommand, layout: TextLayout): RasterGlyphRun | null {
		if (command === this.rasterCommand) return this.rasterResult;
		let raster: RasterGlyphRun | null = null;
		const matrix = command.transform;
		const scale = matrix[0];
		if (this.smallText && command.blur <= 0 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === scale && scale > 0) {
			const deviceScale = scale * this.ratioValue;
			const pixelSize = rasterPixelSize(layout.size, deviceScale);
			let frames = this.rasterFrames.get(command.font);
			const last = frames?.get(pixelSize);
			const already = last !== undefined && last >= this.frame - 1;
			if (wantsRasterGlyphs(layout.atlas, layout.size, deviceScale, already)) {
				if (!frames) {
					frames = new Map();
					this.rasterFrames.set(command.font, frames);
				}
				frames.set(pixelSize, this.frame);
				raster = this.smallText.glyphs(command.font, layout, pixelSize);
			}
		}
		this.rasterCommand = command;
		this.rasterResult = raster;
		return raster;
	}

	/**
	 * Chapter 6's glyph quads in `text` mode, from the same `TextLayout` that
	 * `measureText` summarises (R6.8), so a measured width is a drawn width.
	 *
	 * Every corner goes through the whole transform, so rotated and scaled text
	 * rotates and scales. Under a translate-only transform each line's origin
	 * (its first pen position, on the baseline) is snapped to the device grid
	 * and every glyph and decoration on the line moves by that one delta
	 * (R6.16, R6.17): advances and kerning are untouched, and the baseline sits
	 * on a device row. Under anything else nothing is snapped.
	 *
	 * The screen-space distance range (R6.5) is a per-draw constant under a
	 * translate-only transform, written into the third shape lane; otherwise
	 * that lane is zero and the shader derives it from the texture
	 * coordinate's footprint, with the atlas's unit range in the radii lanes.
	 * A shadow run's blur rides in the first shape lane (text has no border),
	 * read from the `mtsdf` alpha channel's true distance (R6.5, R6.6); an
	 * atlas without one draws its shadow sharp.
	 *
	 * Decorations (R12.4) follow the glyphs in the same group, as `rect`-mode
	 * quads one logical pixel thick, so they get the same edge ramp as any
	 * rectangle.
	 */
	private encodeText(command: TextCommand, sink: GeometrySink, slot: number): void {
		const layout = this.layoutOf(command) as TextLayout;
		const raster = this.rasterOf(command, layout);
		if (raster) {
			this.encodeRasterGlyphs(command, layout, raster, sink, slot);
			this.encodeDecorations(command, layout, sink, layout.quadCount);
			return;
		}
		const { atlas, size } = layout;
		const ratio = this.ratioValue;
		const matrix = command.transform;
		const snap = command.translateOnly;

		this.begin(command, UBER_MODE.text, slot);
		const halves = this.templateHalves;
		halves[SHAPE_HALF] = toHalf(command.blur > 0 && atlas.type === 'mtsdf' ? command.blur * ratio : 0);
		halves[SHAPE_HALF + 2] = toHalf(snap ? Math.max(1, (atlas.distanceRange * size * ratio) / atlas.size) : 0);
		halves[RADII_HALF] = toHalf(atlas.distanceRange / atlas.width);
		halves[RADII_HALF + 1] = toHalf(atlas.distanceRange / atlas.height);
		const color = premultiply(command.color, this.fillScratch);

		const origin = this.originScratch;
		const texelU = 1 / atlas.width;
		const texelV = 1 / atlas.height;
		let instance = 0;
		for (let line = 0; line < layout.lines.length; line++) {
			this.snappedOrigin(layout, command, line, origin);
			const glyphs = layout.lines[line].glyphs;
			for (let index = 0; index < glyphs.length; index++) {
				const { glyph, x } = glyphs[index];
				const plane = glyph.plane;
				const bounds = glyph.atlas;
				if (!plane || !bounds) continue;
				const left = origin.x + x + plane.left * size;
				const right = origin.x + x + plane.right * size;
				const top = origin.y + plane.top * size;
				const bottom = origin.y + plane.bottom * size;
				const base = this.instance(sink, instance++);
				this.setTexCoords(sink, base, bounds.left * texelU, bounds.top * texelV, bounds.right * texelU, bounds.bottom * texelV);
				this.corner(sink, base, 0, matrix, left, top);
				this.corner(sink, base, 1, matrix, right, top);
				this.corner(sink, base, 2, matrix, right, bottom);
				this.corner(sink, base, 3, matrix, left, bottom);
				for (let corner = 0; corner < 4; corner++) this.color(sink, base, corner, color);
			}
		}
		this.encodeDecorations(command, layout, sink, instance);
	}

	/**
	 * R6.4a's raster path: each glyph's cell from the shared raster page as an
	 * `image`-mode quad, whose shader multiplies the premultiplied white
	 * coverage by the text colour. Placement is the same layout's (R6.8),
	 * taken to the screen through the run's translation and uniform scale, so
	 * measurement does not change. Each baseline lands on a whole device row;
	 * each pen goes to its nearest quarter pixel, drawn as the whole pixel's
	 * cell in that phase (`rasterPen`), so a cell is one texel to one pixel and
	 * glyphs keep the layout's spacing to within an eighth of a pixel.
	 */
	private encodeRasterGlyphs(command: TextCommand, layout: TextLayout, raster: RasterGlyphRun, sink: GeometrySink, slot: number): void {
		const ratio = this.ratioValue;
		const matrix = command.transform;
		this.begin(command, UBER_MODE.image, slot);
		const color = premultiply(command.color, this.fillScratch);
		const origin = this.originScratch;
		const pen = this.rasterPenScratch;
		let instance = 0;
		for (let line = 0; line < layout.lines.length; line++) {
			this.snappedOrigin(layout, command, line, origin);
			const baseline = Math.round((matrix[3] * origin.y + matrix[5]) * ratio);
			const glyphs = layout.lines[line].glyphs;
			for (let index = 0; index < glyphs.length; index++) {
				const { glyph, x } = glyphs[index];
				if (!glyph.plane || !glyph.atlas) continue;
				rasterPen((matrix[0] * (origin.x + x) + matrix[4]) * ratio, pen);
				this.rasterGlyphQuad(sink, instance++, raster, raster.cells.get(glyph.codePoint), pen.pixel, pen.phase, baseline, ratio, color);
			}
		}
	}

	/** One raster glyph at a whole-pixel pen, in a phase, on a whole-pixel baseline, all in device pixels. */
	private rasterGlyphQuad(
		sink: GeometrySink,
		instance: number,
		raster: RasterGlyphRun,
		cell: RasterGlyphCell | undefined,
		pen: number,
		phase: number,
		baseline: number,
		ratio: number,
		color: RGBA,
	): void {
		const base = this.instance(sink, instance);
		if (!cell) {
			// Every glyph with a plane has a cell; a quad the count promised
			// is still written, empty.
			this.setTexCoords(sink, base, 0, 0, 0, 0);
			for (let corner = 0; corner < 4; corner++) this.screenCorner(sink, base, corner, 0, 0);
			return;
		}
		const left = (pen + cell.left) / ratio;
		const top = (baseline + cell.top) / ratio;
		const right = left + cell.width / ratio;
		const bottom = top + cell.height / ratio;
		const cellX = cell.x + phase * cell.stride;
		this.setTexCoords(sink, base, cellX / raster.width, cell.y / raster.height,
			(cellX + cell.width) / raster.width, (cell.y + cell.height) / raster.height);
		this.screenCorner(sink, base, 0, left, top);
		this.screenCorner(sink, base, 1, right, top);
		this.screenCorner(sink, base, 2, right, bottom);
		this.screenCorner(sink, base, 3, left, bottom);
		for (let corner = 0; corner < 4; corner++) this.color(sink, base, corner, color);
	}

	/** R12.4's rules after a run's glyphs, from instance `first` of its group. */
	private encodeDecorations(command: TextCommand, layout: TextLayout, sink: GeometrySink, first: number): void {
		const offset = decorationOffset(layout, command.decoration);
		if (offset === null) return;
		const ratio = this.ratioValue;
		const matrix = command.transform;
		const snap = command.translateOnly;
		const color = premultiply(command.color, this.fillScratch);
		const origin = this.originScratch;
		const halves = this.templateHalves;
		let instance = first;
		this.templateBytes[MODE_BYTE] = UBER_MODE.rect;
		halves.fill(0, SHAPE_HALF, SHAPE_HALF + 3);
		halves.fill(0, RADII_HALF, RADII_HALF + 4);
		for (let line = 0; line < layout.lines.length; line++) {
			const width = layout.lines[line].width;
			if (width <= 0) continue;
			this.snappedOrigin(layout, command, line, origin);
			let top = origin.y + offset - DECORATION_THICKNESS / 2;
			let height = DECORATION_THICKNESS;
			if (snap) {
				// The rule on whole device rows, at least one thick.
				top = snapToDevice(top, ratio);
				height = Math.max(1, Math.round(DECORATION_THICKNESS * ratio)) / ratio;
			}
			this.decorationQuad(sink, instance++, matrix, origin.x, top, width, height, color);
		}
	}

	/** R4.2a's per-run extent, in the run's local space, from the layout `encodeText` draws. Null when it draws nothing. */
	textInk(options: DrawTextOptions): Rect | null {
		const layout = this.text.layout(options);
		return layout ? runInk(layout, options, options.decoration) : null;
	}

	private layoutOf(command: TextCommand): TextLayout | null {
		if (command !== this.layoutCommand) {
			this.layoutCommand = command;
			this.layoutResult = this.text.layout(command);
		}
		return this.layoutResult;
	}

	private decorationCount(command: TextCommand, layout: TextLayout): number {
		if (decorationOffset(layout, command.decoration) === null) return 0;
		let count = 0;
		for (let line = 0; line < layout.lines.length; line++) if (layout.lines[line].width > 0) count += 1;
		return count;
	}

	/**
	 * A line's origin in local space, moved so that under a translate-only
	 * transform it lands on the device grid (R6.16). One delta per line, applied
	 * in local space, which under a translation is the same delta on screen.
	 */
	private snappedOrigin(layout: TextLayout, command: TextCommand, line: number, out: LineOrigin): void {
		lineOrigin(layout, command, line, out);
		if (!command.translateOnly) return;
		const matrix = command.transform;
		const screenX = out.x + matrix[4];
		const screenY = out.y + matrix[5];
		const snapped = snapTextOrigin(screenX, screenY, this.ratioValue, this.snapScratch);
		out.x += snapped.x - screenX;
		out.y += snapped.y - screenY;
	}

	/** A `rect`-mode quad for a decoration, inflated by R5.7's device pixel, as instance `instance` of the group. */
	private decorationQuad(
		sink: GeometrySink,
		instance: number,
		transform: Mat2D,
		x: number,
		y: number,
		width: number,
		height: number,
		color: RGBA,
	): void {
		const halfWidth = width / 2;
		const halfHeight = height / 2;
		this.setHalfSize(halfWidth, halfHeight);
		const extentX = halfWidth + this.devicePixel / Math.hypot(transform[0], transform[1]);
		const extentY = halfHeight + this.devicePixel / Math.hypot(transform[2], transform[3]);
		const base = this.instance(sink, instance);
		this.setExtent(sink, base, extentX, extentY);
		for (let corner = 0; corner < 4; corner++) {
			const localX = CORNER_X[corner] * extentX;
			const localY = CORNER_Y[corner] * extentY;
			this.corner(sink, base, corner, transform, x + halfWidth + localX, y + halfHeight + localY);
			this.color(sink, base, corner, color);
		}
	}

	// -- instance writing -------------------------------------------------

	/** Resets the shared words for a new group: clip, opacity, mode, slot, flags. */
	private begin(command: DrawCommand, mode: number, slot: number): void {
		this.templateWords.fill(0);
		const floats = this.templateFloats;
		const clip = clipRectOf(command.clip);
		floats[CLIP] = clip.minX;
		floats[CLIP + 1] = clip.minY;
		floats[CLIP + 2] = clip.maxX;
		floats[CLIP + 3] = clip.maxY;
		this.templateHalves[SHAPE_HALF + 3] = toHalf(command.opacity);
		const bytes = this.templateBytes;
		bytes[MODE_BYTE] = mode;
		bytes[MODE_BYTE + 1] = Math.max(0, slot);
		bytes[MODE_BYTE + 2] = command.blend === 'additive' ? UBER_FLAGS.additive : 0;
	}

	private setHalfSize(halfWidth: number, halfHeight: number): void {
		this.templateFloats[GEOMETRY] = halfWidth;
		this.templateFloats[GEOMETRY + 1] = halfHeight;
	}

	private setRadius(corner: number, radius: number): void {
		this.templateHalves[RADII_HALF + corner] = toHalf(radius);
	}

	private setBorder(color: RGBA, width: number, outset: number): void {
		const bytes = this.templateBytes;
		const alpha = color[3];
		bytes[BORDER_BYTE] = toUnorm8(color[0] * alpha);
		bytes[BORDER_BYTE + 1] = toUnorm8(color[1] * alpha);
		bytes[BORDER_BYTE + 2] = toUnorm8(color[2] * alpha);
		bytes[BORDER_BYTE + 3] = toUnorm8(alpha);
		this.templateHalves[SHAPE_HALF] = toHalf(width);
		this.templateHalves[SHAPE_HALF + 1] = toHalf(outset);
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
		const outerX = extentX + this.devicePixel / Math.hypot(transform[0], transform[1]);
		const outerY = extentY + this.devicePixel / Math.hypot(transform[2], transform[3]);
		const base = this.instance(sink, 0);
		this.setExtent(sink, base, outerX, outerY);
		for (let corner = 0; corner < 4; corner++) {
			const localX = CORNER_X[corner] * outerX;
			const localY = CORNER_Y[corner] * outerY;
			const color = gradient
				? bilinear(gradient, halfWidth > 0 ? 0.5 + localX / (2 * halfWidth) : 0.5,
					halfHeight > 0 ? 0.5 + localY / (2 * halfHeight) : 0.5, this.cornerScratch)
				: (fill as RGBA);
			this.corner(sink, base, corner, transform, centerX + localX, centerY + localY);
			this.color(sink, base, corner, color);
		}
	}

	/** Copies the template into instance `index` of the group; returns its first word. */
	private instance(sink: GeometrySink, index: number): number {
		const base = sink.wordOffset + index * WORDS;
		sink.words.set(this.templateWords, base);
		return base;
	}

	/**
	 * The quad's extent from the shape centre in local units: the shader puts
	 * corner `c` at local (`CORNER_X[c] * x`, `CORNER_Y[c] * y`).
	 */
	private setExtent(sink: GeometrySink, base: number, x: number, y: number): void {
		sink.floats[base + GEOMETRY + 2] = x;
		sink.floats[base + GEOMETRY + 3] = y;
	}

	private setTexCoords(sink: GeometrySink, base: number, u0: number, v0: number, u1: number, v1: number): void {
		const floats = sink.floats;
		floats[base + GEOMETRY] = u0;
		floats[base + GEOMETRY + 1] = v0;
		floats[base + GEOMETRY + 2] = u1;
		floats[base + GEOMETRY + 3] = v1;
	}

	/** Corner `corner` from a local-space point, through the command's transform. */
	private corner(sink: GeometrySink, base: number, corner: number, transform: Mat2D, x: number, y: number): void {
		const offset = base + CORNERS + corner * 2;
		sink.floats[offset] = transform[0] * x + transform[2] * y + transform[4];
		sink.floats[offset + 1] = transform[1] * x + transform[3] * y + transform[5];
	}

	/** Corner `corner` already in screen space. */
	private screenCorner(sink: GeometrySink, base: number, corner: number, x: number, y: number): void {
		const offset = base + CORNERS + corner * 2;
		sink.floats[offset] = x;
		sink.floats[offset + 1] = y;
	}

	/** A premultiplied colour into corner `corner`'s bytes. */
	private color(sink: GeometrySink, base: number, corner: number, color: RGBA): void {
		const offset = base * 4 + COLORS_BYTE + corner * 4;
		const bytes = sink.bytes;
		bytes[offset] = toUnorm8(color[0]);
		bytes[offset + 1] = toUnorm8(color[1]);
		bytes[offset + 2] = toUnorm8(color[2]);
		bytes[offset + 3] = toUnorm8(color[3]);
	}

	/** Point `point`'s premultiplied colour (`encodePolygon`) into corner `corner`. */
	private pointColor(sink: GeometrySink, base: number, corner: number, point: number): void {
		const offset = base * 4 + COLORS_BYTE + corner * 4;
		const bytes = sink.bytes;
		const colors = this.pointColors;
		for (let channel = 0; channel < 4; channel++) bytes[offset + channel] = toUnorm8(colors[point * 4 + channel]);
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

/** R5.5 and R5.7a: corner `corner` of a radius, clamped to `limit` (the smaller half extent) and at zero. */
function clampedRadius(radius: CornerRadii | null, corner: number, limit: number): number {
	const value = radius === null ? 0 : typeof radius === 'number' ? radius : radius[corner];
	return Math.min(Math.max(0, limit), Math.max(0, value));
}

/** R5.7: how far a border's outer edge sits outside the shape edge. */
export function borderOutset(position: BorderPosition | undefined, width: number): number {
	if (position === 'outside') return width;
	if (position === 'center') return width / 2;
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

function hasRadius(radius: CornerRadii | null): boolean {
	if (radius === null) return false;
	if (typeof radius === 'number') return radius > 0;
	return radius[0] > 0 || radius[1] > 0 || radius[2] > 0 || radius[3] > 0;
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
