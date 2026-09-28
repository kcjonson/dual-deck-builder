import { mat4 } from 'gl-matrix';
import {
	BlendMode,
	DrawApi,
	DrawBackend,
	DrawBatch,
	DrawCommandKind,
	DrawTextOptions,
	FontAtlasHandle,
	FontAtlasOptions,
	FrameDescription,
	GpuWork,
	MeasureTextOptions,
	Rect,
	TextMetrics,
	TextureHandle,
} from '../draw';
import { Batcher, GeometryUpload, GpuDraw } from '../draw/Batcher';
import { ResidentTextureSet, TextureKey } from '../draw/ResidentTextureSet';
import vertexSource from '../../../assets/shaders/uber.vert';
import fragmentSource from '../../../assets/shaders/uber.frag';
import type { TextureStore } from '../gpu/TextureStore';
import type { LoadedFontAtlas } from '../text/loadFontAtlases';
import { PlatformFaces, documentFaceLoader } from '../text/platformFaces';
import { TextMetricsService } from '../text/TextMetricsService';
import { FrameTimer } from './FrameTimer';
import type { GpuTimer } from './GpuTimer';
import { Renderer } from './Renderer';
import { GlyphCanvas, SmallTextAtlases, createDocumentGlyphCanvas } from './SmallTextAtlases';
import { StreamRing } from './StreamRing';
import {
	UBER_ATTRIBUTES,
	UBER_STRIDE,
	UBER_TEXTURE_UNITS,
	UBER_VERTICES_PER_INSTANCE,
	UberAttributeType,
	UberGeometryEncoder,
} from './UberGeometryEncoder';
import { compileProgram } from './program';

/**
 * Chapter 15's backend: a WebGL2 context, one uber shader (chapter 5), fed by
 * the batcher.
 *
 * - One program for every primitive (R5.1). The mode, the colours, the
 *   border, the radii, the clip and the opacity are instance data written by
 *   `UberGeometryEncoder`, so none of them is GPU state and none splits a
 *   draw. The clip in particular is tested per fragment (R4.1, R4.4); there
 *   is no scissor.
 * - Instanced quads (R5.4, R15.13): every attribute has a divisor of one and
 *   the vertex stage builds each quad's six vertices from `gl_VertexID`, so a
 *   GPU draw is one `drawArraysInstanced` and there is no index buffer at
 *   all. That also retires DDB-195's element-buffer cost on ANGLE Metal,
 *   since nothing is ever read through an element buffer.
 * - Output is premultiplied and blended `ONE, ONE_MINUS_SRC_ALPHA` (R5.22,
 *   R15.25). `additive` shares that state (the shader zeroes the alpha);
 *   `multiply` and `screen` are the only blend modes that change it, and the
 *   batcher splits a draw where they start and end (R5.22a).
 * - Textures sit on fixed units selected per draw by slot (R5.20): the font
 *   role atlases on the first units for the whole frame (R6.4), images on the
 *   dynamic units the batcher hands out. Every unit the shader declares holds
 *   a texture, a 1x1 transparent placeholder when nothing else, so no sampler
 *   ever reads an empty unit.
 * - Text is laid out by one `TextMetricsService`, which answers
 *   `measureText`, `textInk` and the encoder's glyph quads from the same
 *   layout (R6.8).
 * - Instance storage is one fixed-capacity buffer written at an advancing
 *   offset that wraps only onto a region at least two frames old (R5.27,
 *   R15.11, `StreamRing`). A frame that outgrows it grows it once, and says
 *   so, rather than overwriting a region the GPU may still read.
 * - `bufferData` runs once per buffer at creation. A frame issues one
 *   `bufferSubData` per upload, with a source offset and length, so an upload
 *   allocates nothing.
 * - Per-frame uniform state (the projection) is a `std140` block in a ring of
 *   three 256-byte-aligned slots, written once per frame and selected with
 *   `bindBufferRange` (R15.15). Nothing is set per draw.
 * - One vertex array object, bound once per upload; attribute locations are
 *   fixed in the source, so nothing is looked up. The attribute pointers move
 *   with the upload's offset in the ring, and within an upload only at a
 *   split: WebGL2 has no base instance, so a draw that starts partway through
 *   an upload points the attributes at its first instance (R15.14's intent,
 *   nothing re-specified per draw group, holds).
 * - No synchronous call in the frame (R15.22). The only queries this file
 *   makes (compile and link status, the uniform offset alignment, the block
 *   index, the sampler location) happen at creation and at context restore.
 * - Context loss (R15.5): `Renderer` stops the loop and this backend rebuilds
 *   its program, buffers, vertex array and uniform ring from their CPU-side
 *   descriptions on restore.
 * - Commands paint in the order the batch holds them (chapter 3): nothing
 *   here moves text after shapes.
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
	/** Initial instance ring capacity in bytes. */
	instanceRingBytes?: number;
	/**
	 * The platform faces R6.4a's raster fallback draws small text with
	 * (`PlatformFaces`). Absent, every size draws from the distance field.
	 */
	rasterFaces?: { familyOf(role: string): string | null } | null;
	/** The canvas the fallback rasterises into; the DOM's by default. */
	createGlyphCanvas?: (width: number, height: number) => GlyphCanvas | null;
}

export interface CreateDrawApiOptions {
	renderer: Renderer;
	frameTimer: FrameTimer;
	gpuTimer?: GpuTimer | null;
	/** The font role atlases, loaded and validated, given to the backend before the first frame (R2.18). */
	fontAtlases?: readonly LoadedFontAtlas[];
}

/**
 * The card showcase, the heaviest screen, uploads about 210 KB a frame at 104
 * bytes an instance; R5.27 wants three frames resident, and this is several
 * times that, which leaves one upload room for 13,000 instances. A frame that
 * needs more grows the ring once, and says so.
 */
const DEFAULT_INSTANCE_RING_BYTES = 4 * 1024 * 1024;

/** `Frame` in `uber.vert`: the projection. */
const FRAME_BLOCK_FLOATS = 16;
const FRAME_BLOCK_BYTES = FRAME_BLOCK_FLOATS * 4;
const FRAME_BLOCK_BINDING = 0;
/** A slot is rewritten three frames after it was last written, past R5.27's two. */
const FRAME_SLOTS = 3;

/**
 * The seam, built the same way on both pages. Neither bootstrap spells the
 * options itself, so the two cannot drift, which is the failure mode that
 * would show up as a screenshot diff on the gallery scenes and nowhere else.
 *
 * Each font atlas is uploaded raw (R6.4b) as an immediate texture that keeps
 * its image for a context restore, then handed to the backend under its role,
 * all before the draw API exists, so no frame can precede an atlas (R2.18).
 *
 * Diagnostics go to `console.error` in a development build, which turns any
 * R2.1 finding into a red screenshot spec through the harness's
 * `expectCleanConsole`.
 */
export function createDrawApi({ renderer, frameTimer, gpuTimer, fontAtlases = [] }: CreateDrawApiOptions): DrawApi {
	// Small text draws from the distance field until its face loads (R6.4a).
	const rasterFaces = new PlatformFaces({
		load: documentFaceLoader(),
		onError: (face, error) => console.error(`draw: the ${face} font file failed to load, so its small text stays soft:`, error),
	});
	const backend = new WebGL2Backend({ renderer, frameTimer, gpuTimer, rasterFaces });
	for (const { role, face, atlas, image } of fontAtlases) {
		const texture = renderer.textures.create({
			width: atlas.width,
			height: atlas.height,
			label: `font atlas ${face}`,
			source: image,
			content: 'mask',
			keepSource: true,
			immediate: true,
		});
		backend.loadFontAtlas({ name: role, atlas, texture });
	}
	return new DrawApi({
		backend,
		development: __DEV_TOOLS__,
		onDiagnostic: (diagnostic) => {
			console.error(`draw: ${diagnostic.code}: ${diagnostic.message}`);
		},
	});
}

/** Everything a lost context takes with it, rebuilt together on restore. */
interface GpuResources {
	program: WebGLProgram;
	vertexArray: WebGLVertexArrayObject;
	instanceBuffer: WebGLBuffer;
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
	private readonly text = new TextMetricsService();
	/** Font role to atlas texture, in load order; the resident set is these (R6.4). */
	private readonly fontTextures = new Map<string, TextureHandle>();
	private readonly encoder: UberGeometryEncoder;
	/** R6.4a's raster atlases, or null without platform faces. */
	private readonly smallText: SmallTextAtlases | null;
	private readonly residentTextures: ResidentTextureSet;
	private readonly batcher: Batcher;
	/** What every unit holds when nothing else is bound to it; the store restores it with the rest. */
	private readonly placeholder: TextureHandle;

	private readonly instanceRing: StreamRing;
	private resources: GpuResources;
	/** `UBER_ATTRIBUTES`' component types as GL enums, by attribute. */
	private readonly attributeTypes: number[];

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
	/** The ring byte offset the vertex array's attribute pointers were last set at, or -1. */
	private attributeBase = -1;
	/** The texture each unit holds, as this backend last bound it; null for unknown. */
	private readonly boundUnits: (WebGLTexture | null)[] = new Array(UBER_TEXTURE_UNITS).fill(null);

	private readonly unpaintable = new Set<DrawCommandKind>();

	constructor({
		renderer,
		frameTimer,
		gpuTimer = null,
		instanceRingBytes = DEFAULT_INSTANCE_RING_BYTES,
		rasterFaces = null,
		createGlyphCanvas = createDocumentGlyphCanvas,
	}: WebGL2BackendOptions) {
		this.renderer = renderer;
		this.frameTimer = frameTimer;
		this.gpuTimer = gpuTimer;
		this.gl = renderer.getContext();

		this.smallText = rasterFaces
			? new SmallTextAtlases({
				textures: renderer.textures,
				familyOf: (role) => rasterFaces.familyOf(role),
				createCanvas: createGlyphCanvas,
			})
			: null;
		this.encoder = new UberGeometryEncoder({
			text: this.text,
			onUnpaintable: (kind, detail) => this.reportUnpaintable(kind, detail),
			smallText: this.smallText,
		});
		// The font atlases join as they load (`loadFontAtlas`); the rest of the
		// units are dynamic, handed to images as they arrive (R5.20).
		this.residentTextures = new ResidentTextureSet({ units: UBER_TEXTURE_UNITS });
		this.instanceRing = new StreamRing({ capacity: instanceRingBytes });
		this.attributeTypes = UBER_ATTRIBUTES.map((attribute) => glType(this.gl, attribute.type));
		this.batcher = new Batcher({
			encoder: this.encoder,
			textures: this.residentTextures,
			// An upload never exceeds a third of the ring, so three frames of
			// one upload each fit without growth.
			maxInstances: Math.floor(instanceRingBytes / UBER_STRIDE / 3),
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

	/** R2.18's precondition: the roles `loadFontAtlas` has been given. */
	get fontAtlasNames(): readonly string[] {
		return this.text.names;
	}

	/** R2.14 from the layout `encodeText` draws (R6.8). */
	measureText(options: MeasureTextOptions): TextMetrics {
		return this.text.measure(options);
	}

	/** R4.2a per run, from the same layout `encodeText` draws. */
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
		this.smallText?.beginFrame();
		this.instanceRing.beginFrame(frame.frame);
		this.writeFrameUniforms(frame);
		this.bindPipeline();
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
		this.gpuTimer?.endPass();
	}

	submit(batch: DrawBatch): GpuWork {
		const commands = batch.commands;
		for (let index = 0; index < commands.length; index++) {
			const command = commands[index];
			if (command.kind === 'text') this.frameTimer.recordTextCharacters(command.text.length);
		}

		let binds = 0;
		// One sort domain is one GPU pass (R13.16).
		this.gpuTimer?.beginPass();
		const work = this.batcher.flush(commands, (upload) => {
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
		for (let unit = this.residentTextures.residentUnits; unit < UBER_TEXTURE_UNITS; unit++) {
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

	/**
	 * A font role's metrics and atlas texture, between frames (R2.17). The
	 * texture joins the resident set, so every role shares every flush (R6.4);
	 * loading a role again replaces it and drops every cached layout (R6.12).
	 */
	loadFontAtlas({ name, atlas, texture }: FontAtlasOptions): FontAtlasHandle {
		this.text.addAtlas({ name, atlas });
		this.fontTextures.set(name, texture);
		this.encoder.registerFontTexture(name, texture);
		this.residentTextures.resident = [...this.fontTextures.values()];
		this.boundUnits.fill(null);
		return { id: texture.id, name };
	}

	// -- resources ----------------------------------------------------------

	/**
	 * Program, vertex array, the instance buffer at its ring capacity, and the
	 * frame uniform ring. The synchronous queries here (link status, block
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

		// Every flat varying is constant across an instance, so the convention
		// cannot change a pixel. With the last-vertex default, the instanced
		// draw cost about 1 ms more GPU time a frame on ANGLE Metal (Radeon Pro
		// 560X) whatever its size, which fits ANGLE emulating that convention
		// (DDB-191). Context state, so it is set again on a restored context.
		const provoking = gl.getExtension('WEBGL_provoking_vertex') as ProvokingVertexExtension | null;
		provoking?.provokingVertexWEBGL(provoking.FIRST_VERTEX_CONVENTION_WEBGL);

		const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
		const uniformStride = alignUp(FRAME_BLOCK_BYTES, Math.max(256, alignment));
		const uniformBuffer = createBuffer(gl);
		gl.bindBuffer(gl.UNIFORM_BUFFER, uniformBuffer);
		gl.bufferData(gl.UNIFORM_BUFFER, uniformStride * FRAME_SLOTS, gl.DYNAMIC_DRAW);

		const vertexArray = gl.createVertexArray();
		if (!vertexArray) throw new Error('WebGL2Backend: could not create a vertex array');
		gl.bindVertexArray(vertexArray);
		const instanceBuffer = createBuffer(gl);
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.instanceRing.capacity, gl.DYNAMIC_DRAW);
		// Enables and divisors are vertex array state, set once (R15.13, R15.14).
		for (const attribute of UBER_ATTRIBUTES) {
			gl.enableVertexAttribArray(attribute.location);
			gl.vertexAttribDivisor(attribute.location, 1);
		}
		gl.bindVertexArray(null);

		return { program, vertexArray, instanceBuffer, uniformBuffer, uniformStride };
	}

	/**
	 * R15.5. Everything created against the old context is gone, so the rings
	 * start empty and every cached binding is forgotten. The textures, the
	 * font atlases and the placeholder among them, were restored by the store
	 * before this runs.
	 */
	private restore(): void {
		this.instanceRing.reset();
		this.resources = this.createResources();
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

	/**
	 * Uploads once, the upload's instances into the ring, and issues its draws
	 * in order. Returns texture binds made.
	 */
	private execute(upload: GeometryUpload): number {
		const gl = this.gl;
		const ringOffset = this.reserve(upload.byteCount);

		this.bindPipeline();
		gl.bindVertexArray(this.resources.vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.instanceBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, ringOffset, upload.bytes, 0, upload.byteCount);

		let binds = 0;
		for (let draw = 0; draw < upload.draws.length; draw++) binds += this.issue(upload.draws[draw], ringOffset);
		gl.bindVertexArray(null);
		return binds;
	}

	private issue(draw: GpuDraw, ringOffset: number): number {
		const gl = this.gl;
		const binds = this.bindTextures(draw.textures);
		this.applyBlend(draw.blend);
		this.pointAttributes(ringOffset + draw.firstInstance * UBER_STRIDE);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, UBER_VERTICES_PER_INSTANCE, draw.instanceCount);
		this.frameTimer.recordDrawCall(draw.instanceCount * UBER_VERTICES_PER_INSTANCE);
		return binds;
	}

	/**
	 * Points every attribute at the instance starting at byte `base` of the
	 * ring. Once per upload, and again only for a draw that starts partway
	 * through one, since WebGL2 has no base instance; never per draw group.
	 */
	private pointAttributes(base: number): void {
		if (base === this.attributeBase) return;
		const gl = this.gl;
		for (let index = 0; index < UBER_ATTRIBUTES.length; index++) {
			const { location, size, type, offset } = UBER_ATTRIBUTES[index];
			if (type === 'uint8') {
				gl.vertexAttribIPointer(location, size, this.attributeTypes[index], UBER_STRIDE, base + offset);
			} else {
				gl.vertexAttribPointer(location, size, this.attributeTypes[index], type === 'unorm8', UBER_STRIDE, base + offset);
			}
		}
		this.attributeBase = base;
	}

	/**
	 * Each unit to the texture the draw's bindings name, or the placeholder.
	 * A unit already holding it is left alone, so the resident atlases bind
	 * once and stay (R5.20), and a run of draws on the same images binds
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
	 * An instance ring offset for `bytes`, growing the stream once when the ring
	 * cannot place it without overwriting a region the GPU may still be
	 * reading (R5.27). Growth replaces the buffer (a fresh `bufferData` on a
	 * new object, so nothing in flight is touched) and is reported, since a
	 * ring that grows in steady state is a ring sized wrong.
	 */
	private reserve(bytes: number): number {
		const ring = this.instanceRing;
		const offset = ring.allocate(bytes, 4);
		if (offset >= 0) return offset;

		const gl = this.gl;
		const previous = ring.capacity;
		const capacity = Math.max(previous * 2, bytes * 3);
		ring.reset(capacity);
		const buffer = createBuffer(gl);
		gl.deleteBuffer(this.resources.instanceBuffer);
		this.resources.instanceBuffer = buffer;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
		this.attributeBase = -1;
		console.warn(`WebGL2Backend: instance ring grew from ${previous} to ${capacity} bytes`);
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

interface ProvokingVertexExtension {
	readonly FIRST_VERTEX_CONVENTION_WEBGL: number;
	provokingVertexWEBGL(mode: number): void;
}

function glType(gl: WebGL2RenderingContext, type: UberAttributeType): number {
	switch (type) {
		case 'float':
			return gl.FLOAT;
		case 'half':
			return gl.HALF_FLOAT;
		case 'unorm8':
		case 'uint8':
			return gl.UNSIGNED_BYTE;
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
