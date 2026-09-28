import { mat4 } from 'gl-matrix';
import {
	BlendMode,
	DrawApi,
	DrawBackend,
	DrawBatch,
	DrawCommandKind,
	DrawTextOptions,
	FrameDescription,
	GpuWork,
	Rect,
	TextureHandle,
} from '../draw';
import { Batcher, GeometryUpload, GpuDraw } from '../draw/Batcher';
import { ResidentTextureSet, TextureKey } from '../draw/ResidentTextureSet';
import vertexSource from '../../../assets/shaders/uber.vert';
import fragmentSource from '../../../assets/shaders/uber.frag';
import type { TextureStore } from '../gpu/TextureStore';
import { FontAtlas } from './FontAtlas';
import { FrameTimer } from './FrameTimer';
import type { GpuTimer } from './GpuTimer';
import { LegacyPaintOrder } from './LegacyPaintOrder';
import { Renderer } from './Renderer';
import { StreamRing } from './StreamRing';
import { UBER_ATTRIBUTES, UBER_TEXTURE_UNITS, UBER_VERTEX, UberGeometryEncoder } from './UberGeometryEncoder';
import { compileProgram } from './program';
import { DEFAULT_FONT } from './fonts';

/**
 * Chapter 15's backend: a WebGL2 context, one uber shader (chapter 5), fed by
 * the batcher.
 *
 * - One program for every primitive (R5.1). The mode, the colours, the
 *   border, the radii, the clip and the opacity are vertex data written by
 *   `UberGeometryEncoder`, so none of them is GPU state and none splits a
 *   draw. The clip in particular is tested per fragment (R4.1, R4.4); there
 *   is no scissor.
 * - Output is premultiplied and blended `ONE, ONE_MINUS_SRC_ALPHA` (R5.22,
 *   R15.25). `additive` shares that state (the shader zeroes the alpha);
 *   `multiply` and `screen` are the only blend modes that change it, and the
 *   batcher splits a draw where they start and end (R5.22a).
 * - Textures sit on fixed units selected per draw by slot (R5.20): the font
 *   atlas on unit 0 for the whole frame, images on the dynamic units the
 *   batcher hands out. Every unit the shader declares holds a texture, a 1x1
 *   transparent placeholder when nothing else, so no sampler ever reads an
 *   empty unit.
 * - Stream storage is one fixed-capacity vertex buffer and one index buffer,
 *   each written at an advancing offset that wraps only onto a region at least
 *   two frames old (R5.27, R15.11, `StreamRing`). `bufferData` runs once per
 *   buffer at creation; a frame issues one `bufferSubData` per stream per
 *   upload, with a source offset and length, so an upload allocates nothing.
 *   A frame that outgrows the ring grows it once, and says so, rather than
 *   overwriting a region the GPU may still read.
 * - Per-frame uniform state (the projection) is a `std140` block in a ring of
 *   three 256-byte-aligned slots, written once per frame and selected with
 *   `bindBufferRange` (R15.15). Nothing is set per draw.
 * - One vertex array object, bound once per upload; attribute locations are
 *   fixed in the source, so nothing is looked up.
 * - No synchronous call in the frame (R15.22). The only queries this file
 *   makes (compile and link status, the uniform offset alignment, the block
 *   index, the sampler location) happen at creation and at context restore.
 * - Context loss (R15.5): `Renderer` stops the loop and this backend rebuilds
 *   its program, buffers, vertex array and uniform ring from their CPU-side
 *   descriptions on restore.
 * - Indices are 32-bit (R5.4); the upload cap is the ring's, not 65536.
 *
 * `LegacyPaintOrder` and the `legacyTextOrder` barrier are the ordering
 * re-baseline's to delete, not this backend's.
 */

export interface WebGL2BackendOptions {
	renderer: Renderer;
	frameTimer: FrameTimer;
	/**
	 * R13.16's per-pass GPU timer, development builds only. The backend's whole
	 * contract with it is to bracket the frame and each GPU submission; it
	 * never reads a result.
	 */
	gpuTimer?: GpuTimer | null;
	/** Initial vertex ring capacity in bytes. */
	vertexRingBytes?: number;
	/** Initial index ring capacity in bytes. */
	indexRingBytes?: number;
}

const STRIDE_BYTES = UBER_VERTEX.floats * 4;

/**
 * The card showcase, the heaviest screen, uploads about 1.6 MB a frame at 128
 * bytes a vertex; R5.27 wants three frames resident, and this is more than
 * that. A frame that needs more grows the ring once, and says so.
 */
const DEFAULT_VERTEX_RING_BYTES = 8 * 1024 * 1024;
/**
 * Indices run at most three per vertex (a feathered polygon is under two) at
 * four bytes each, so the index ring holds as many vertices' worth as the
 * vertex ring does and neither grows first.
 */
const DEFAULT_INDEX_RING_BYTES = Math.ceil(DEFAULT_VERTEX_RING_BYTES / STRIDE_BYTES) * 3 * 4;

/** `Frame` in `uber.vert`: the projection. */
const FRAME_BLOCK_FLOATS = 16;
const FRAME_BLOCK_BYTES = FRAME_BLOCK_FLOATS * 4;
const FRAME_BLOCK_BINDING = 0;
/** A slot is rewritten three frames after it was last written, past R5.27's two. */
const FRAME_SLOTS = 3;

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
export function createDrawApi({ renderer, frameTimer, gpuTimer }: WebGL2BackendOptions): DrawApi {
	return new DrawApi({
		backend: new WebGL2Backend({ renderer, frameTimer, gpuTimer }),
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
	private readonly gpuTimer: GpuTimer | null;
	private readonly gl: WebGL2RenderingContext;
	private readonly fontAtlas: FontAtlas;
	private readonly encoder: UberGeometryEncoder;
	private readonly batcher: Batcher;
	private readonly paintOrder = new LegacyPaintOrder();
	/** What every unit holds when nothing else is bound to it; the store restores it with the rest. */
	private readonly placeholder: TextureHandle;

	private readonly vertexRing: StreamRing;
	private readonly indexRing: StreamRing;
	private resources: GpuResources;

	/** The frame block's CPU copy, which is the projection. */
	private readonly frameBlock = new Float32Array(FRAME_BLOCK_FLOATS);
	private projectionWidth = NaN;
	private projectionHeight = NaN;
	private frameSlotOffset = 0;

	/**
	 * State this backend set and has not had reason to doubt. Each is reset by
	 * `invalidateState` (R2.15) and by a restored context, so the next use
	 * binds again instead of asking the GPU what it holds.
	 */
	private pipelineBound = false;
	/** Blend enable and clear colour, which only a foreign pass or a new context changes. */
	private fixedStateBound = false;
	/** The blend function set, or null for "unknown". */
	private appliedBlend: BlendMode | null = null;
	/** The byte offset the vertex array's attribute pointers were last set at, or -1. */
	private attributeBase = -1;
	/** The texture each unit holds, as this backend last bound it; null for unknown. */
	private readonly boundUnits: (WebGLTexture | null)[] = new Array(UBER_TEXTURE_UNITS).fill(null);

	private readonly unpaintable = new Set<DrawCommandKind>();

	constructor({
		renderer,
		frameTimer,
		gpuTimer = null,
		vertexRingBytes = DEFAULT_VERTEX_RING_BYTES,
		indexRingBytes = DEFAULT_INDEX_RING_BYTES,
	}: WebGL2BackendOptions) {
		this.renderer = renderer;
		this.frameTimer = frameTimer;
		this.gpuTimer = gpuTimer;
		this.gl = renderer.getContext();
		this.fontAtlas = renderer.getFontAtlas();

		this.encoder = new UberGeometryEncoder({
			glyphs: this.fontAtlas,
			onUnpaintable: (kind, detail) => this.reportUnpaintable(kind, detail),
		});
		this.vertexRing = new StreamRing({ capacity: vertexRingBytes });
		this.indexRing = new StreamRing({ capacity: indexRingBytes });
		this.batcher = new Batcher({
			encoder: this.encoder,
			// The atlas on unit 0 for the whole frame; the rest are dynamic,
			// handed to images as they arrive (R5.20).
			textures: new ResidentTextureSet({ units: UBER_TEXTURE_UNITS, resident: [this.encoder.glyphTexture] }),
			// An upload never exceeds a third of the vertex ring, so three
			// frames of one upload each fit without growth.
			maxVertices: Math.floor(vertexRingBytes / STRIDE_BYTES / 3),
			onDrop: (command, reason) => this.reportUnpaintable(command.kind, reason),
			// A development build checks every group the encoder writes; the
			// console error fails the screenshot harness's clean-console check.
			verify: __DEV_TOOLS__
				? (command, problem) => console.error(`WebGL2Backend: ${command.kind} group: ${problem}`)
				: undefined,
		});

		this.placeholder = renderer.textures.create({
			width: 1,
			height: 1,
			label: 'empty texture unit',
			source: new Uint8Array(4),
			content: 'color',
			keepSource: true,
			immediate: true,
		});
		this.resources = this.createResources();
		renderer.addContextListener({ restored: () => this.restore() });
	}

	/** R5.30's resource layer, the `Renderer`'s. */
	get textures(): TextureStore<WebGLTexture> {
		return this.renderer.textures;
	}

	/** R2.18's precondition, answered by the atlas the `Renderer` builds in its constructor. */
	get fontAtlasNames(): readonly string[] {
		return [DEFAULT_FONT];
	}

	/** R4.2a per run, from the same glyph walk `encodeText` takes. */
	textInk(options: DrawTextOptions): Rect | null {
		return this.encoder.textInk(options);
	}

	/** Opens the frame's one render pass: rings advanced, the frame block written into this frame's slot, the target cleared. */
	beginFrame(frame: FrameDescription): void {
		// The clear is the frame's first GPU pass (R13.16).
		this.gpuTimer?.beginFrame();
		this.gpuTimer?.beginPass();
		// R7.2: the ratio reaches the encoder per frame, for inflation, the
		// feather and glyph snapping.
		this.encoder.ratio = frame.ratio;
		this.vertexRing.beginFrame(frame.frame);
		this.indexRing.beginFrame(frame.frame);
		this.writeFrameUniforms(frame);
		this.bindPipeline();
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
		this.gpuTimer?.endPass();
	}

	submit(batch: DrawBatch): GpuWork {
		const ordered = this.paintOrder.apply(batch.commands);
		for (let index = 0; index < ordered.length; index++) {
			const command = ordered[index];
			if (command.kind === 'text') this.frameTimer.recordTextCharacters(command.text.length);
		}

		let binds = 0;
		// One sort domain is one GPU pass (R13.16).
		this.gpuTimer?.beginPass();
		const work = this.batcher.flush(ordered, (upload) => {
			binds += this.execute(upload);
		});
		this.gpuTimer?.endPass();
		// The batcher counted the dynamic units it handed out; what the GPU
		// was actually asked to bind is this backend's count.
		work.textureBinds = binds;
		return work;
	}

	/**
	 * Puts the placeholder back on every dynamic unit an image used, so a
	 * texture released at the end of this frame is never left bound to a
	 * unit the shader declares.
	 */
	endFrame(): void {
		const placeholder = this.textures.native(this.placeholder);
		for (let unit = 1; unit < UBER_TEXTURE_UNITS; unit++) {
			if (this.boundUnits[unit] !== placeholder) this.bindUnit(unit, placeholder);
		}
		this.gpuTimer?.endFrame();
	}

	invalidateState(): void {
		this.pipelineBound = false;
		this.fixedStateBound = false;
		this.appliedBlend = null;
		this.attributeBase = -1;
		this.boundUnits.fill(null);
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
	 * index, offset alignment, the sampler location) are why this runs only at
	 * construction and on a restored context.
	 */
	private createResources(): GpuResources {
		const gl = this.gl;
		const program = compileProgram(gl, { vertex: vertexSource, fragment: fragmentSource });

		gl.useProgram(program);
		// Samplers cannot live in a uniform block, and GLSL ES 3.00 has no
		// `layout(binding)`, so sampler n is pointed at unit n here, once.
		const units = new Int32Array(UBER_TEXTURE_UNITS);
		for (let unit = 0; unit < UBER_TEXTURE_UNITS; unit++) units[unit] = unit;
		gl.uniform1iv(gl.getUniformLocation(program, 'uTextures[0]'), units);
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
		for (const attribute of UBER_ATTRIBUTES) gl.enableVertexAttribArray(attribute.location);
		// The element buffer binding is vertex array state: bound once, here.
		const indexBuffer = createBuffer(gl);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indexRing.capacity, gl.DYNAMIC_DRAW);
		gl.bindVertexArray(null);

		return { program, vertexArray, vertexBuffer, indexBuffer, uniformBuffer, uniformStride };
	}

	/**
	 * R15.5. Everything created against the old context is gone, so the rings
	 * start empty and every cached binding is forgotten. The textures, the
	 * atlas and the placeholder among them, were restored by the store before
	 * this runs.
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
			// Logical pixels, y down, origin top left (R7.1).
			mat4.ortho(this.frameBlock, 0, width, height, 0, -1.0, 1.0);
			this.projectionWidth = width;
			this.projectionHeight = height;
		}

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
			// Set here rather than once at creation so a foreign pass that
			// changed them and called `invalidateState` (R2.15) gets them back
			// before the next draw. The clear is opaque (R15.2).
			gl.enable(gl.BLEND);
			gl.clearColor(0.0, 0.0, 0.0, 1.0);
			this.fixedStateBound = true;
		}
		this.applyBlend('over');
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

	/** Uploads once into the rings and issues the upload's draws in order. Returns texture binds made. */
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
			for (const attribute of UBER_ATTRIBUTES) {
				gl.vertexAttribPointer(
					attribute.location,
					attribute.size,
					gl.FLOAT,
					false,
					STRIDE_BYTES,
					vertexOffset + attribute.offset * 4,
				);
			}
			this.attributeBase = vertexOffset;
		}

		let binds = 0;
		for (let index = 0; index < upload.draws.length; index++) binds += this.issue(upload.draws[index], indexOffset);
		gl.bindVertexArray(null);
		return binds;
	}

	private issue(draw: GpuDraw, indexOffset: number): number {
		const gl = this.gl;
		const binds = this.bindTextures(draw.textures);
		this.applyBlend(draw.blend);
		gl.drawElements(gl.TRIANGLES, draw.indexCount, gl.UNSIGNED_INT, indexOffset + draw.firstIndex * 4);
		this.frameTimer.recordDrawCall(draw.vertexCount);
		return binds;
	}

	/**
	 * Each unit to the texture the draw's bindings name, or the placeholder.
	 * A unit already holding it is left alone, so the resident atlas binds
	 * once and stays (R5.20), and a run of draws on the same images binds
	 * nothing.
	 */
	private bindTextures(bindings: readonly (TextureKey | null)[]): number {
		const placeholder = this.textures.native(this.placeholder);
		let binds = 0;
		for (let unit = 0; unit < UBER_TEXTURE_UNITS; unit++) {
			const key = bindings[unit] ?? null;
			let native: WebGLTexture | null;
			if (key === null) {
				// Nothing samples this unit in this draw; it only has to hold something.
				if (this.boundUnits[unit] !== null) continue;
				native = placeholder;
			} else if (key === this.encoder.glyphTexture) {
				native = this.fontAtlas.getTexture();
			} else {
				// A handle whose upload is still queued draws as the placeholder (R5.32).
				native = this.textures.native(key as TextureHandle);
			}
			binds += this.bindUnit(unit, native ?? placeholder);
		}
		return binds;
	}

	private bindUnit(unit: number, texture: WebGLTexture | null): number {
		if (this.boundUnits[unit] === texture) return 0;
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		this.boundUnits[unit] = texture;
		return 1;
	}

	/** R5.22 and R5.22a: premultiplied `over` unless the draw asks for `multiply` or `screen`. */
	private applyBlend(blend: BlendMode): void {
		const state = blend === 'additive' ? 'over' : blend;
		if (this.appliedBlend === state) return;
		const gl = this.gl;
		if (state === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
		else if (state === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
		else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		this.appliedBlend = state;
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
	 * banning, and a message per command would be a flood.
	 */
	private reportUnpaintable(kind: DrawCommandKind, detail: string): void {
		if (this.unpaintable.has(kind)) return;
		this.unpaintable.add(kind);
		console.error(`WebGL2Backend: ${detail}; nothing was drawn`);
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
