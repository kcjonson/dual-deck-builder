import { ResolvedClip } from './clip';
import { BlendMode, DrawCommand } from './commands';
import { ResidentTextureSet, TextureKey } from './ResidentTextureSet';
import { GpuWork, SplitCounts, SplitReason } from './stats';

/**
 * The back half of chapter 3's batcher: geometry merging and GPU submission
 * planning for one sort domain.
 *
 * The front half is `DrawApi`: it captures state into each draw (R2.4 to
 * R2.7), culls against the clip (R4.2a), and orders the domain with R3.10's
 * per-layer partition. What reaches a backend's `submit` is therefore already
 * the emit order, one draw group per draw call. This class turns that list into
 * as few GPU draws as the backend's pipeline allows:
 *
 * - Every group's vertices and indices are written into one shared buffer, in
 *   emit order, as one contiguous range per group, which is chapter 3.1's
 *   definition of a draw group.
 * - Consecutive groups share a GPU draw unless something forces a split, and
 *   every split carries its reason (R13.13): a texture outside the resident set
 *   with every dynamic unit taken (R5.20), a blend change, or, for as long as
 *   the legacy backend exists, a GL topology change or a scissor clip change.
 * - When a domain's geometry outgrows the backend's buffer the batcher uploads
 *   what it has and starts again, counted as a `bufferFull` flush. Emit order is
 *   preserved across the boundary because uploads are drawn in order.
 *
 * WHY IT SITS BEHIND THE SEAM rather than in `DrawApi`. What a group's geometry
 * looks like is the backend's vertex format, and R5.4 leaves that layout open:
 * the legacy backend writes 22-float vertices for its WebGL1 program, the uber
 * shader will write instances. So the backend owns a `Batcher` and hands it a
 * `GeometryEncoder`; the batcher owns everything that is the same for every
 * backend, which is buffer growth, ranges, split decisions, slot selection and
 * the counters, so no two backends can count a split differently.
 *
 * THE CLIP SEAM. R4.1 makes the clip per-draw data, so under the uber shader
 * it is written into each vertex or instance by the encoder and never splits
 * anything (`clipIsState: false`). The legacy backend cannot do that until
 * DDB-64's shader exists, so it declares `clipIsState: true` and the batcher
 * splits wherever the resolved clip changes, reporting each split as a
 * `clipChange`, which R13.13 says must read zero under the final design. The
 * encoder flag is the one line that changes when the shader lands.
 *
 * Allocation: the typed arrays grow by doubling and are reused across flushes,
 * and GPU draw records are pooled, so a steady-state frame allocates nothing
 * here beyond the one `GpuWork` it returns.
 */

export type Topology = 'triangles' | 'lines';

/** What an encoder reports about a group before it is written. Reused; never retained. */
export interface GroupShape {
	vertices: number;
	indices: number;
	topology: Topology;
	/** GL line width for `lines`; ignored for triangles. */
	lineWidth: number;
	/** The one texture the group samples, or null for texture-agnostic modes (R5.20). */
	texture: TextureKey | null;
}

/**
 * Where an encoder writes one group. `indices` are absolute within the upload,
 * so a group's local index `i` is written as `baseVertex + i`.
 */
export interface GeometrySink {
	readonly vertices: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	/** Float offset of the group's first vertex in `vertices`. */
	readonly floatOffset: number;
	/** Index of the group's first vertex within the upload. */
	readonly baseVertex: number;
	/** Offset of the group's first index in `indices`. */
	readonly indexOffset: number;
}

export interface GeometryEncoder {
	readonly floatsPerVertex: number;
	/** WebGL1 has only 16-bit indices; R5.4 requires 32-bit on WebGL2. */
	readonly indexType: 'uint16' | 'uint32';
	/**
	 * True while a backend lowers the clip to GPU state (scissor) instead of
	 * carrying it per draw (R4.1). See the class comment.
	 */
	readonly clipIsState: boolean;
	/**
	 * Fills `out` and returns true, or returns false when the backend cannot
	 * draw this command at all. A false return is the encoder's to report; the
	 * batcher skips the command and counts nothing for it.
	 */
	shape(command: DrawCommand, out: GroupShape): boolean;
	/** Writes exactly the vertex and index counts `shape` reported. */
	encode(command: DrawCommand, sink: GeometrySink, slot: number): void;
}

/** One GPU submission within an upload. */
export interface GpuDraw {
	/** In indices, from the start of the upload's index buffer. */
	firstIndex: number;
	indexCount: number;
	vertexCount: number;
	topology: Topology;
	lineWidth: number;
	blend: BlendMode;
	/** The clip a scissor-based backend applies; null when the clip is per-draw data. */
	scissor: ResolvedClip | null;
	/** Unit bindings this draw needs, resident units first (R5.20). */
	readonly textures: (TextureKey | null)[];
	/** Why this draw is not part of the one before it; null for an upload's first draw. */
	split: SplitReason | 'clipChange' | null;
}

/** One upload: a vertex range, an index range, and the draws over them. */
export interface GeometryUpload {
	readonly vertices: Float32Array;
	readonly floatCount: number;
	readonly vertexCount: number;
	readonly indices: Uint16Array | Uint32Array;
	readonly indexCount: number;
	readonly draws: readonly GpuDraw[];
	/** Draw groups written into this upload. */
	readonly groups: number;
}

export interface BatcherOptions {
	encoder: GeometryEncoder;
	textures: ResidentTextureSet;
	/**
	 * Vertex capacity of one upload. Defaults to the index type's range, since
	 * a 16-bit index cannot address past 65536 vertices.
	 */
	maxVertices?: number;
	/** A group larger than an upload, or a texture with no unit to go on. */
	onDrop?: (command: DrawCommand, reason: string) => void;
}

interface SinkState extends GeometrySink {
	vertices: Float32Array;
	indices: Uint16Array | Uint32Array;
	floatOffset: number;
	baseVertex: number;
	indexOffset: number;
}

const INITIAL_VERTICES = 1024;

interface DomainWork extends GpuWork {
	splits: SplitCounts;
	flushes: { bufferFull: number };
	clipChanges: number;
}

export class Batcher {
	private readonly encoder: GeometryEncoder;
	private readonly textures: ResidentTextureSet;
	private readonly maxVertices: number;
	private readonly onDrop?: (command: DrawCommand, reason: string) => void;

	private readonly sink: SinkState;
	private readonly shape: GroupShape = {
		vertices: 0,
		indices: 0,
		topology: 'triangles',
		lineWidth: 1,
		texture: null,
	};

	private readonly drawPool: GpuDraw[] = [];
	private readonly draws: GpuDraw[] = [];
	private groups = 0;
	private current: GpuDraw | null = null;

	constructor({ encoder, textures, maxVertices, onDrop }: BatcherOptions) {
		this.encoder = encoder;
		this.textures = textures;
		const addressable = encoder.indexType === 'uint16' ? 65536 : 2 ** 32;
		this.maxVertices = Math.min(maxVertices ?? addressable, addressable);
		if (this.maxVertices < 1) throw new Error('Batcher: maxVertices must be at least 1');
		this.onDrop = onDrop;

		const vertices = Math.min(INITIAL_VERTICES, this.maxVertices);
		this.sink = {
			vertices: new Float32Array(vertices * encoder.floatsPerVertex),
			indices: this.allocateIndices(vertices * 6),
			floatOffset: 0,
			baseVertex: 0,
			indexOffset: 0,
		};
	}

	/**
	 * Encodes one domain, already in emit order, and hands each upload to
	 * `execute` as soon as it is complete. The upload's arrays are reused by the
	 * next one, so `execute` must consume them before returning.
	 *
	 * Returns the GPU-side counters of R13.12 to R13.14 for this domain. Resident
	 * texture binds are the backend's to add: they happen once per frame, not
	 * once per domain (R5.20).
	 */
	flush(commands: readonly DrawCommand[], execute: (upload: GeometryUpload) => void): GpuWork {
		const work: DomainWork = {
			gpuDraws: 0,
			vertices: 0,
			triangles: 0,
			instances: 0,
			textureBinds: 0,
			bytesUploaded: 0,
			splits: { textureSlotsExhausted: 0, blendChange: 0, stencilLevel: 0, topologyChange: 0 },
			flushes: { bufferFull: 0 },
			clipChanges: 0,
		};

		this.resetUpload();
		this.textures.releaseDynamic();
		const shape = this.shape;
		const floatsPerVertex = this.encoder.floatsPerVertex;

		for (const command of commands) {
			shape.vertices = 0;
			shape.indices = 0;
			shape.topology = 'triangles';
			shape.lineWidth = 1;
			shape.texture = null;
			if (!this.encoder.shape(command, shape)) continue;
			if (shape.vertices === 0 || shape.indices === 0) continue;

			if (shape.vertices > this.maxVertices) {
				this.onDrop?.(
					command,
					`a ${command.kind} group of ${shape.vertices} vertices is larger than one upload (${this.maxVertices})`,
				);
				continue;
			}

			if (this.sink.baseVertex + shape.vertices > this.maxVertices) {
				this.emitUpload(execute, work);
				work.flushes.bufferFull += 1;
				this.resetUpload();
				this.textures.releaseDynamic();
			}

			// The split decision, in a fixed order so a group that changes two
			// things at once always reports the same reason (R3.4).
			const texture = shape.texture;
			const needsUnit = texture !== null && this.textures.slotOf(texture) === -1;
			const exhausted = needsUnit && !this.textures.hasFreeUnit;
			const scissor = this.encoder.clipIsState ? command.clip : null;
			const reason = this.current === null ? null : this.splitReason(command.blend, shape, scissor, exhausted);

			if (this.current === null || reason !== null) {
				if (exhausted) {
					if (this.textures.dynamicUnits === 0) {
						this.onDrop?.(command, 'its texture is not resident and the backend has no dynamic texture units');
						continue;
					}
					this.closeDraw();
					this.textures.releaseDynamic();
				} else {
					this.closeDraw();
				}
				this.openDraw(command.blend, shape, scissor, reason);
				if (reason === 'clipChange') work.clipChanges += 1;
				else if (reason !== null) work.splits[reason] += 1;
			}

			let slot = -1;
			if (texture !== null) {
				slot = this.textures.slotOf(texture);
				if (slot === -1) {
					slot = this.textures.bind(texture);
					work.textureBinds += 1;
				}
			}

			this.ensureCapacity(
				(this.sink.baseVertex + shape.vertices) * floatsPerVertex,
				this.sink.indexOffset + shape.indices,
			);
			this.encoder.encode(command, this.sink, slot);

			const draw = this.current as GpuDraw;
			draw.indexCount += shape.indices;
			draw.vertexCount += shape.vertices;
			this.sink.baseVertex += shape.vertices;
			this.sink.floatOffset += shape.vertices * floatsPerVertex;
			this.sink.indexOffset += shape.indices;
			this.groups += 1;
		}

		this.emitUpload(execute, work);
		return work;
	}

	private splitReason(
		blend: BlendMode,
		shape: GroupShape,
		scissor: ResolvedClip | null,
		exhausted: boolean,
	): SplitReason | 'clipChange' | null {
		const current = this.current as GpuDraw;
		if (blend !== current.blend) return 'blendChange';
		if (shape.topology !== current.topology) return 'topologyChange';
		if (shape.topology === 'lines' && shape.lineWidth !== current.lineWidth) return 'topologyChange';
		if (scissor !== current.scissor) return 'clipChange';
		if (exhausted) return 'textureSlotsExhausted';
		return null;
	}

	private openDraw(
		blend: BlendMode,
		shape: GroupShape,
		scissor: ResolvedClip | null,
		split: SplitReason | 'clipChange' | null,
	): void {
		const draw = this.drawPool[this.draws.length] ?? this.newDraw();
		draw.firstIndex = this.sink.indexOffset;
		draw.indexCount = 0;
		draw.vertexCount = 0;
		draw.topology = shape.topology;
		draw.lineWidth = shape.lineWidth;
		draw.blend = blend;
		draw.scissor = scissor;
		draw.split = split;
		draw.textures.length = 0;
		this.draws.push(draw);
		this.current = draw;
	}

	/** Snapshots the unit bindings, which may have grown since the draw opened. */
	private closeDraw(): void {
		const draw = this.current;
		if (!draw) return;
		const bindings = this.textures.bindings;
		draw.textures.length = 0;
		for (let index = 0; index < bindings.length; index++) draw.textures.push(bindings[index]);
		this.current = null;
	}

	private newDraw(): GpuDraw {
		const draw: GpuDraw = {
			firstIndex: 0,
			indexCount: 0,
			vertexCount: 0,
			topology: 'triangles',
			lineWidth: 1,
			blend: 'over',
			scissor: null,
			textures: [],
			split: null,
		};
		this.drawPool.push(draw);
		return draw;
	}

	private emitUpload(
		execute: (upload: GeometryUpload) => void,
		work: DomainWork,
	): void {
		this.closeDraw();
		if (this.draws.length === 0) return;

		const bytesPerIndex = this.encoder.indexType === 'uint16' ? 2 : 4;
		execute({
			vertices: this.sink.vertices,
			floatCount: this.sink.floatOffset,
			vertexCount: this.sink.baseVertex,
			indices: this.sink.indices,
			indexCount: this.sink.indexOffset,
			draws: this.draws,
			groups: this.groups,
		});

		work.gpuDraws += this.draws.length;
		work.vertices += this.sink.baseVertex;
		for (const draw of this.draws) {
			if (draw.topology === 'triangles') work.triangles += Math.floor(draw.indexCount / 3);
		}
		work.bytesUploaded += this.sink.floatOffset * 4 + this.sink.indexOffset * bytesPerIndex;
	}

	private resetUpload(): void {
		this.sink.floatOffset = 0;
		this.sink.baseVertex = 0;
		this.sink.indexOffset = 0;
		this.draws.length = 0;
		this.groups = 0;
		this.current = null;
	}

	private ensureCapacity(floats: number, indices: number): void {
		if (floats > this.sink.vertices.length) {
			const grown = new Float32Array(Math.max(floats, this.sink.vertices.length * 2));
			grown.set(this.sink.vertices.subarray(0, this.sink.floatOffset));
			this.sink.vertices = grown;
		}
		if (indices > this.sink.indices.length) {
			const grown = this.allocateIndices(Math.max(indices, this.sink.indices.length * 2));
			grown.set(this.sink.indices.subarray(0, this.sink.indexOffset));
			this.sink.indices = grown;
		}
	}

	private allocateIndices(count: number): Uint16Array | Uint32Array {
		return this.encoder.indexType === 'uint16' ? new Uint16Array(count) : new Uint32Array(count);
	}
}
