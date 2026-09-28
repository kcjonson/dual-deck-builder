import { mat4 } from 'gl-matrix';
import {
	BeginFrameOptions,
	ClipRect,
	DrawApi,
	DrawBackend,
	DrawBatch,
	DrawCommandKind,
	DrawTextOptions,
	FrameDescription,
	GpuWork,
	Rect,
	ResolvedClip,
	clipRectOf,
} from '../draw';
import { Batcher, GeometryUpload, GpuDraw } from '../draw/Batcher';
import { ResidentTextureSet } from '../draw/ResidentTextureSet';
import vertexSource from '../../../assets/shaders/vertex.glsl';
import fragmentSource from '../../../assets/shaders/fragment.glsl';
import { FontAtlas } from './FontAtlas';
import { FrameTimer } from './FrameTimer';
import { LEGACY_VERTEX, LegacyGeometryEncoder } from './LegacyGeometryEncoder';
import { LegacyPaintOrder } from './LegacyPaintOrder';
import { Renderer } from './Renderer';
import { StreamRing } from './StreamRing';
import { compileProgram } from './program';
import { DEFAULT_FONT } from './fonts';

/**
 * Chapter 15's backend: a WebGL2 context, fed by the batcher.
 *
 * What is chapter 15's here, and permanent:
 *
 * - Stream storage is one fixed-capacity vertex buffer and one index buffer,
 *   each written at an advancing offset that wraps only onto a region at least
 *   two frames old (R5.27, R15.11, `StreamRing`). `bufferData` runs once per
 *   buffer at creation; a frame issues one `bufferSubData` per stream per
 *   upload, with a source offset and length, so an upload allocates nothing.
 *   A frame that outgrows the ring grows it once, and says so, rather than
 *   overwriting a region the GPU may still read.
 * - Per-frame uniform state (the projection and view) is a `std140` block in a
 *   ring of three 256-byte-aligned slots, written once per frame and selected
 *   with `bindBufferRange` (R15.15). Nothing is set per draw.
 * - One vertex array object, bound once per upload; attribute locations are
 *   fixed in the source, so nothing is looked up.
 * - No synchronous call in the frame (R15.22). The only queries this file
 *   makes (compile and link status, the uniform offset alignment, the block
 *   index) happen at creation and at context restore.
 * - Context loss (R15.5): `Renderer` stops the loop and this backend rebuilds
 *   its program, buffers, vertex array and uniform ring from their CPU-side
 *   descriptions on restore.
 * - Indices are 32-bit (R5.4); the upload cap is the ring's, not 65536.
 *
 * What is still the legacy program's, and goes with DDB-64: the shaders under
 * `src/assets/shaders/` (ported to GLSL ES 3.00 line for line, so the goldens
 * did not move), `LegacyGeometryEncoder`'s 22-float vertex, `LEGACY_PROGRAM`
 * below, the scissor clip (`clipIsState`), and SRC_ALPHA blending rather than
 * premultiplied (R15.25). The uber shader replaces the encoder, the program
 * and the attribute table; the rings, the uniform ring, the vertex array, the
 * loss handling and the batcher stay. `LegacyPaintOrder` and the
 * `legacyTextOrder` barrier go earlier, with the ordering re-baseline.
 *
 * Textures other than the one font atlas arrive with the resource layer
 * (DDB-66), which is where R15.18's `texStorage2D` for everything else lives;
 * `FontAtlas` already uploads that way.
 */

export interface WebGL2BackendOptions {
	renderer: Renderer;
	frameTimer: FrameTimer;
	/** Initial vertex ring capacity in bytes. */
	vertexRingBytes?: number;
	/** Initial index ring capacity in bytes. */
	indexRingBytes?: number;
}

/**
 * The legacy program's vertex layout, as attribute location, float offset and
 * size. The locations are the `layout(location = n)` in `vertex.glsl`.
 */
const LEGACY_PROGRAM = {
	sources: { vertex: vertexSource, fragment: fragmentSource },
	strideBytes: LEGACY_VERTEX.floats * 4,
	attributes: [
		{ location: 0, offset: LEGACY_VERTEX.position, size: 2 },
		{ location: 1, offset: LEGACY_VERTEX.texCoord, size: 2 },
		{ location: 2, offset: LEGACY_VERTEX.modelLinear, size: 4 },
		{ location: 3, offset: LEGACY_VERTEX.modelTranslate, size: 4 },
		{ location: 4, offset: LEGACY_VERTEX.color, size: 4 },
		{ location: 5, offset: LEGACY_VERTEX.strokeColor, size: 4 },
		{ location: 6, offset: LEGACY_VERTEX.shapeSize, size: 2 },
	],
} as const;

/**
 * The card showcase, the heaviest screen, uploads about 1.2 MB a frame at the
 * legacy vertex's 88 bytes; R5.27 wants three frames resident, and this is
 * twice that. A frame that needs more grows the ring once, and says so.
 */
const DEFAULT_VERTEX_RING_BYTES = 8 * 1024 * 1024;
/**
 * Indices run at most three per vertex (a circle fan, a triangulated polygon)
 * at four bytes each, so the index ring holds as many vertices' worth as the
 * vertex ring does and neither grows first.
 */
const DEFAULT_INDEX_RING_BYTES = Math.ceil(DEFAULT_VERTEX_RING_BYTES / LEGACY_PROGRAM.strideBytes) * 3 * 4;

/** `Frame` in `vertex.glsl`: two mat4s. */
const FRAME_BLOCK_FLOATS = 32;
const FRAME_BLOCK_BYTES = FRAME_BLOCK_FLOATS * 4;
const FRAME_BLOCK_BINDING = 0;
/** A slot is rewritten three frames after it was last written, past R5.27's two. */
const FRAME_SLOTS = 3;

const NO_CLIP: ResolvedClip = { kind: 'none' };

/**
 * A screen-space clip rect as a WebGL scissor box, in device pixels from the
 * bottom left.
 *
 * Lifted expression for expression out of the block deleted from `Layer.ts`,
 * which read `screenX`, `screenY + height` and `canvas.height / dpr` where this
 * reads `minX`, `maxY` and `canvasHeightDevicePx / ratio`. It takes the
 * drawing buffer's height rather than `FrameDescription.viewport.height`
 * because the scissor is measured from the bottom of the drawing buffer, and
 * at a fractional ratio `innerHeight * dpr` truncates: the buffer height is
 * the one the box has to agree with.
 */
export function scissorBox(
	rect: ClipRect,
	ratio: number,
	canvasHeightDevicePx: number,
): { x: number; y: number; width: number; height: number } {
	const logicalHeight = canvasHeightDevicePx / ratio;
	return {
		x: Math.floor(rect.minX * ratio),
		y: Math.floor((logicalHeight - rect.maxY) * ratio),
		width: Math.floor((rect.maxX - rect.minX) * ratio),
		height: Math.floor((rect.maxY - rect.minY) * ratio),
	};
}

/**
 * The frame description both entry points open with. One function so the game
 * page and the gallery cannot disagree about the viewport or the ratio; it
 * moves to chapter 7's mount context when that exists.
 */
export function windowFrame(): BeginFrameOptions {
	return {
		viewport: { width: window.innerWidth, height: window.innerHeight },
		ratio: window.devicePixelRatio || 1,
	};
}

/**
 * The seam, built the same way on both pages. Neither bootstrap spells the
 * options itself, so `legacyTextOrder` cannot be on in one and off in the
 * other, which is the failure mode that would show up as a screenshot diff on
 * seven gallery scenes and nowhere else.
 *
 * Diagnostics go to `console.error` in a development build, which turns any
 * R2.1 finding into a red screenshot spec through the harness's
 * `expectCleanConsole`.
 *
 * `legacyTextOrder` is the one temporary option and this is its only caller;
 * see `DrawApiOptions.legacyTextOrder` for what it does and when it dies.
 */
export function createDrawApi({ renderer, frameTimer }: WebGL2BackendOptions): DrawApi {
	return new DrawApi({
		backend: new WebGL2Backend({ renderer, frameTimer }),
		development: __DEV_TOOLS__,
		legacyTextOrder: true,
		onDiagnostic: (diagnostic) => {
			console.error(`draw: ${diagnostic.code}: ${diagnostic.message}`);
		},
	});
}

/** Everything a lost context takes with it, rebuilt together on restore. */
interface GpuResources {
	program: WebGLProgram;
	vertexArray: WebGLVertexArrayObject;
	vertexBuffer: WebGLBuffer;
	indexBuffer: WebGLBuffer;
	uniformBuffer: WebGLBuffer;
	/** Bytes between frame uniform slots, from `UNIFORM_BUFFER_OFFSET_ALIGNMENT`. */
	uniformStride: number;
}

export class WebGL2Backend implements DrawBackend {
	readonly name = 'webgl2';

	private readonly renderer: Renderer;
	private readonly frameTimer: FrameTimer;
	private readonly gl: WebGL2RenderingContext;
	private readonly fontAtlas: FontAtlas;
	private readonly encoder: LegacyGeometryEncoder;
	private readonly batcher: Batcher;
	private readonly paintOrder = new LegacyPaintOrder();

	private readonly vertexRing: StreamRing;
	private readonly indexRing: StreamRing;
	private resources: GpuResources;

	/** The frame block's CPU copy, and the matrices that fill it. */
	private readonly frameBlock = new Float32Array(FRAME_BLOCK_FLOATS);
	private readonly projection = mat4.create();
	private readonly view = mat4.create();
	private projectionWidth = NaN;
	private projectionHeight = NaN;
	private frameSlotOffset = 0;

	/**
	 * State this backend set and has not had reason to doubt. Each is reset by
	 * `invalidateState` (R2.15) and by a restored context, so the next use
	 * binds again instead of asking the GPU what it holds.
	 */
	private pipelineBound = false;
	/** Blend and clear colour, which only a foreign pass or a new context changes. */
	private fixedStateBound = false;
	/** The byte offset the vertex array's attribute pointers were last set at, or -1. */
	private attributeBase = -1;
	/**
	 * The clip the scissor box currently holds, or null for "unknown". Compared
	 * by reference: the draw API stamps one resolved clip object on every
	 * command in a scope (R2.5), and the batcher splits a GPU draw where that
	 * object changes.
	 */
	private appliedClip: ResolvedClip | null = null;
	/** Whether the resident texture is on its unit for this frame (R5.20). */
	private residentBound = false;

	private frame: FrameDescription | null = null;
	private readonly unpaintable = new Set<DrawCommandKind>();
	private warnedBlend = false;

	constructor({
		renderer,
		frameTimer,
		vertexRingBytes = DEFAULT_VERTEX_RING_BYTES,
		indexRingBytes = DEFAULT_INDEX_RING_BYTES,
	}: WebGL2BackendOptions) {
		this.renderer = renderer;
		this.frameTimer = frameTimer;
		this.gl = renderer.getContext();
		this.fontAtlas = renderer.getFontAtlas();

		this.encoder = new LegacyGeometryEncoder({
			glyphs: this.fontAtlas,
			onUnpaintable: (kind, detail) => this.reportUnpaintable(kind, detail),
		});
		this.vertexRing = new StreamRing({ capacity: vertexRingBytes });
		this.indexRing = new StreamRing({ capacity: indexRingBytes });
		this.batcher = new Batcher({
			encoder: this.encoder,
			// One sampler in the legacy program, holding the one atlas. Nothing
			// submits an image, so there is no dynamic unit to hand out.
			textures: new ResidentTextureSet({ units: 1, resident: [this.encoder.glyphTexture] }),
			// An upload never exceeds a third of the vertex ring, so three
			// frames of one upload each fit without growth.
			maxVertices: Math.floor(vertexRingBytes / LEGACY_PROGRAM.strideBytes / 3),
			onDrop: (command, reason) => this.reportUnpaintable(command.kind, reason),
			// A development build checks every group the encoder writes; the
			// console error fails the screenshot harness's clean-console check.
			verify: __DEV_TOOLS__
				? (command, problem) => console.error(`WebGL2Backend: ${command.kind} group: ${problem}`)
				: undefined,
		});

		mat4.identity(this.view);
		this.resources = this.createResources();
		renderer.addContextListener({ restored: () => this.restore() });
	}

	/** R2.18's precondition, answered by the atlas the `Renderer` builds in its constructor. */
	get fontAtlasNames(): readonly string[] {
		return [DEFAULT_FONT];
	}

	/** R4.2a per run, from the same glyph walk `encodeText` takes. */
	textInk(options: DrawTextOptions): Rect | null {
		return this.encoder.textInk(options);
	}

	/**
	 * Opens the frame's one render pass: rings advanced, the frame block
	 * written into this frame's slot, the scissor off, the target cleared.
	 */
	beginFrame(frame: FrameDescription): void {
		this.frame = frame;
		this.vertexRing.beginFrame(frame.frame);
		this.indexRing.beginFrame(frame.frame);
		this.residentBound = false;
		this.writeFrameUniforms(frame);
		this.bindPipeline();

		this.applyClip(NO_CLIP);
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}

	submit(batch: DrawBatch): GpuWork {
		const ordered = this.paintOrder.apply(batch.commands);
		for (let index = 0; index < ordered.length; index++) {
			const command = ordered[index];
			if (command.kind === 'text') this.frameTimer.recordTextCharacters(command.text.length);
		}

		let residentBinds = 0;
		const work = this.batcher.flush(ordered, (upload) => {
			residentBinds += this.execute(upload);
		});
		work.textureBinds += residentBinds;
		return work;
	}

	endFrame(): void {
		this.applyClip(NO_CLIP);
		this.frame = null;
	}

	invalidateState(): void {
		this.pipelineBound = false;
		this.fixedStateBound = false;
		this.attributeBase = -1;
		this.appliedClip = null;
		this.residentBound = false;
	}

	createTexture(): never {
		throw new Error('WebGL2Backend: R2.17 textures arrive with the resource layer (DDB-66)');
	}

	destroyTexture(): never {
		throw new Error('WebGL2Backend: R2.17 textures arrive with the resource layer (DDB-66)');
	}

	loadFontAtlas(): never {
		throw new Error(
			`WebGL2Backend: the only atlas is '${DEFAULT_FONT}', built by the Renderer; R11.8's roles arrive in phase 2`,
		);
	}

	// -- resources ----------------------------------------------------------

	/**
	 * Program, vertex array, the two stream buffers at their ring capacity, and
	 * the frame uniform ring. The synchronous queries here (link status, block
	 * index, offset alignment) are why this runs only at construction and on a
	 * restored context.
	 */
	private createResources(): GpuResources {
		const gl = this.gl;
		const program = compileProgram(gl, LEGACY_PROGRAM.sources);

		gl.useProgram(program);
		// Samplers cannot live in a uniform block, and GLSL ES 3.00 has no
		// `layout(binding)`, so the one sampler is pointed at unit 0 here, once.
		gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);
		gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'Frame'), FRAME_BLOCK_BINDING);

		const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
		const uniformStride = alignUp(FRAME_BLOCK_BYTES, Math.max(256, alignment));
		const uniformBuffer = createBuffer(gl);
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer);
		gl.bufferData(gl.UNIFORM_BUFFER, uniformStride * FRAME_SLOTS, gl.DYNAMIC_DRAW);

		const vertexArray = gl.createVertexArray();
		if (!vertexArray) throw new Error('WebGL2Backend: could not create a vertex array');
		gl.bindVertexArray(vertexArray);
		const vertexBuffer = createBuffer(gl);
		gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.vertexRing.capacity, gl.DYNAMIC_DRAW);
		for (const attribute of LEGACY_PROGRAM.attributes) gl.enableVertexAttribArray(attribute.location);
		// The element buffer binding is vertex array state: bound once, here.
		const indexBuffer = createBuffer(gl);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indexRing.capacity, gl.DYNAMIC_DRAW);
		gl.bindVertexArray(null);

		return { program, vertexArray, vertexBuffer, indexBuffer, uniformBuffer, uniformStride };
	}

	/**
	 * R15.5. Everything created against the old context is gone, so the rings
	 * start empty and every cached binding is forgotten. The atlas texture was
	 * re-uploaded by `Renderer` before this runs.
	 */
	private restore(): void {
		this.resources = this.createResources();
		this.vertexRing.reset();
		this.indexRing.reset();
		this.invalidateState();
	}

	private writeFrameUniforms(frame: FrameDescription): void {
		const { width, height } = frame.viewport;
		if (width !== this.projectionWidth || height !== this.projectionHeight) {
			// The projection the WebGL1 renderer built in `resize`, from the
			// same logical size, so the shader multiplies the same floats.
			mat4.ortho(this.projection, 0, width, height, 0, -1.0, 1.0);
			this.projectionWidth = width;
			this.projectionHeight = height;
		}
		this.frameBlock.set(this.projection, 0);
		this.frameBlock.set(this.view, 16);

		const gl = this.gl;
		const { uniformBuffer, uniformStride } = this.resources;
		this.frameSlotOffset = (frame.frame % FRAME_SLOTS) * uniformStride;
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer);
		gl.bufferSubData(gl.UNIFORM_BUFFER, this.frameSlotOffset, this.frameBlock);
		this.pipelineBound = false;
	}

	/** The program and this frame's uniform slot; again after `invalidateState`. */
	private bindPipeline(): void {
		if (this.pipelineBound) return;
		const gl = this.gl;
		if (!this.fixedStateBound) {
			// SRC_ALPHA over until DDB-64's premultiplied output (R15.25), and
			// the opaque clear R15.2 asks for. Set here rather than once at
			// creation so a foreign pass that changed them and called
			// `invalidateState` (R2.15) gets them back before the next draw.
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.clearColor(0.0, 0.0, 0.0, 1.0);
			this.fixedStateBound = true;
		}
		gl.useProgram(this.resources.program);
		gl.bindBufferRange(
			gl.UNIFORM_BUFFER,
			FRAME_BLOCK_BINDING,
			this.resources.uniformBuffer,
			this.frameSlotOffset,
			FRAME_BLOCK_BYTES,
		);
		this.pipelineBound = true;
	}

	// -- execution ----------------------------------------------------------

	/** Uploads once into the rings and issues the upload's draws in order. Returns resident texture binds made. */
	private execute(upload: GeometryUpload): number {
		const gl = this.gl;
		const vertexBytes = upload.floatCount * 4;
		const indexBytes = upload.indexCount * 4;
		const vertexOffset = this.reserve(this.vertexRing, vertexBytes, 'vertex');
		const indexOffset = this.reserve(this.indexRing, indexBytes, 'index');

		this.bindPipeline();
		const { vertexArray, vertexBuffer } = this.resources;
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, vertexOffset, upload.vertices, 0, upload.floatCount);
		gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, indexOffset, upload.indices, 0, upload.indexCount);

		// Indices are relative to the upload's first vertex, so the pointers
		// move with the upload. Once per upload, never per draw (R15.14).
		if (vertexOffset !== this.attributeBase) {
			const stride = LEGACY_PROGRAM.strideBytes;
			for (const attribute of LEGACY_PROGRAM.attributes) {
				gl.vertexAttribPointer(
					attribute.location,
					attribute.size,
					gl.FLOAT,
					false,
					stride,
					vertexOffset + attribute.offset * 4,
				);
			}
			this.attributeBase = vertexOffset;
		}

		let binds = 0;
		if (!this.residentBound) {
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.fontAtlas.getTexture());
			this.residentBound = true;
			binds = 1;
		}

		for (let index = 0; index < upload.draws.length; index++) this.issue(upload.draws[index], indexOffset);
		gl.bindVertexArray(null);
		return binds;
	}

	private issue(draw: GpuDraw, indexOffset: number): void {
		const gl = this.gl;
		if (draw.blend !== 'over' && !this.warnedBlend) {
			// The legacy program is SRC_ALPHA over; nothing submits another
			// mode, and premultiplied blending arrives with the uber shader.
			this.warnedBlend = true;
			console.error(`WebGL2Backend: blend '${draw.blend}' is drawn as 'over' by the legacy program`);
		}
		this.applyClip(draw.scissor ?? NO_CLIP);
		gl.drawElements(
			draw.topology === 'lines' ? gl.LINES : gl.TRIANGLES,
			draw.indexCount,
			gl.UNSIGNED_INT,
			indexOffset + draw.firstIndex * 4,
		);
		this.frameTimer.recordDrawCall(draw.vertexCount);
	}

	/**
	 * A ring offset for `bytes`, growing the stream once when the ring cannot
	 * place it without overwriting a region the GPU may still be reading
	 * (R5.27). Growth replaces the buffer (a fresh `bufferData` on a new
	 * object, so nothing in flight is touched) and is reported, since a ring
	 * that grows in steady state is a ring sized wrong.
	 */
	private reserve(ring: StreamRing, bytes: number, stream: 'vertex' | 'index'): number {
		const offset = ring.allocate(bytes, 4);
		if (offset >= 0) return offset;

		const gl = this.gl;
		const previous = ring.capacity;
		const capacity = Math.max(previous * 2, bytes * 3);
		ring.reset(capacity);
		const buffer = createBuffer(gl);
		if (stream === 'vertex') {
			gl.deleteBuffer(this.resources.vertexBuffer);
			this.resources.vertexBuffer = buffer;
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
			this.attributeBase = -1;
		} else {
			gl.deleteBuffer(this.resources.indexBuffer);
			this.resources.indexBuffer = buffer;
			gl.bindVertexArray(this.resources.vertexArray);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
		}
		console.warn(`WebGL2Backend: ${stream} ring grew from ${previous} to ${capacity} bytes`);
		return ring.allocate(bytes, 4);
	}

	/**
	 * Once per kind per backend. A silent drop is what R2.1 and R2.18 keep
	 * banning, and a message per command would be a flood; nothing in this
	 * codebase submits a shadow, a line or an image, so this is the report that
	 * says so when someone starts.
	 */
	private reportUnpaintable(kind: DrawCommandKind, detail: string): void {
		if (this.unpaintable.has(kind)) return;
		this.unpaintable.add(kind);
		console.error(`WebGL2Backend: ${detail}; nothing was drawn`);
	}

	private applyClip(clip: ResolvedClip): void {
		if (this.appliedClip === clip) return;
		this.appliedClip = clip;

		if (clip.kind === 'none') {
			this.gl.disable(this.gl.SCISSOR_TEST);
			return;
		}

		const box = scissorBox(clipRectOf(clip), this.frame?.ratio ?? 1, this.renderer.canvas.height);
		this.gl.enable(this.gl.SCISSOR_TEST);
		this.gl.scissor(box.x, box.y, box.width, box.height);
	}
}

function createBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
	const buffer = gl.createBuffer();
	if (!buffer) throw new Error('WebGL2Backend: could not create a buffer');
	return buffer;
}

function alignUp(value: number, alignment: number): number {
	return Math.ceil(value / alignment) * alignment;
}
