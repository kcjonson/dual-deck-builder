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
 * - Every group's instances are written into one shared buffer, in emit order,
 *   as one contiguous range per group, which is chapter 3.1's definition of a
 *   draw group.
 * - Consecutive groups share a GPU draw unless something forces a split, and
 *   every split carries its reason (R13.13): a texture outside the resident set
 *   with every dynamic unit taken (R5.20), or a blend mode that needs different
 *   blend state (R5.22a: `additive` shares `over`'s state and never splits).
 * - When a domain's geometry outgrows the backend's buffer the batcher uploads
 *   what it has and starts again, counted as a `bufferFull` flush. Emit order is
 *   preserved across the boundary because uploads are drawn in order.
 *
 * WHY IT SITS BEHIND THE SEAM rather than in `DrawApi`. What a group's geometry
 * looks like is the backend's instance format, and R5.4 leaves that layout
 * open: the WebGL2 backend writes the uber shader's packed 104-byte instances.
 * So the backend owns a `Batcher` and hands it a `GeometryEncoder`; the batcher
 * owns everything that is the same for every backend, which is buffer growth,
 * ranges, split decisions, slot selection and the counters, so no two backends
 * can count a split differently.
 *
 * INSTANCES, NOT VERTICES (R5.4). Every group is a run of fixed-size
 * instances, each drawn as one quad; a triangle is a quad with two corners at
 * the same point. The sink hands the encoder four typed views of one buffer
 * (float32, uint32, uint16 and uint8), so an instance can mix full floats,
 * half floats and normalised bytes. There is no index stream.
 *
 * THE CLIP is per-draw data (R4.1): the encoder writes it into each instance,
 * so it is not an input to any split decision here and no clip change can
 * cost a GPU draw.
 *
 * ALLOCATION. A steady-state frame allocates nothing here: the buffer grows by
 * doubling and is reused, GPU draw records are pooled, and the upload handed
 * to `execute` and the `GpuWork` returned from `flush` are the same two
 * objects every time. Both are therefore only valid until the next `flush`,
 * which is how their one consumer each (the backend's upload, and
 * `DrawCounters.addGpuWork`) already uses them. Only a drop or contract report
 * builds a string, and those are error paths.
 *
 * THE ENCODER CONTRACT is checked, not trusted, when `verify` is given. Every
 * group shares one buffer, so an encoder that writes one glyph more than it
 * reported overwrites the next group. With `verify`, each group's words and
 * the word just past it are filled with `FENCE_WORD` before `encode`, and any
 * group that leaves a fenced word in its range, writes the one past it, or
 * writes NaN into a float lane is reported. It costs a pass over the group, so
 * it is a development build's check.
 */

/** What an encoder reports about a group before it is written. Reused; never retained. */
export interface GroupShape {
	instances: number;
	/** The one texture the group samples, or null for texture-agnostic modes (R5.20). */
	texture: TextureKey | null;
}

/**
 * Where an encoder writes one group: four views of the same bytes, and the
 * word the group's first instance starts at. Instance `i` of the group starts
 * at word `wordOffset + i * instanceWords`.
 */
export interface GeometrySink {
	readonly floats: Float32Array;
	readonly words: Uint32Array;
	readonly halves: Uint16Array;
	readonly bytes: Uint8Array;
	readonly wordOffset: number;
}

export interface GeometryEncoder {
	/** Four-byte words per instance. */
	readonly instanceWords: number;
	/**
	 * How many leading words of every instance are float32 lanes, which the
	 * contract check reads for NaN. The rest are packed and read only for the
	 * fence.
	 */
	readonly floatWords: number;
	/** Vertices the GPU runs per instance, for R13.12's `vertices` and `triangles`. */
	readonly verticesPerInstance: number;
	/**
	 * Fills `out` and returns true, or returns false when the backend cannot
	 * draw this command at all. A false return is the encoder's to report; the
	 * batcher skips the command and counts nothing for it.
	 */
	shape(command: DrawCommand, out: GroupShape): boolean;
	/** Writes exactly the instances `shape` reported; `verify` checks it. */
	encode(command: DrawCommand, sink: GeometrySink, slot: number): void;
}

/** One GPU submission within an upload. */
export interface GpuDraw {
	/** In instances, from the start of the upload. */
	firstInstance: number;
	instanceCount: number;
	/**
	 * The blend state this draw needs: `over` for both `over` and `additive`,
	 * which differ only in the fragment's alpha (R5.22a).
	 */
	blend: BlendMode;
	/** Unit bindings this draw needs, resident units first (R5.20). */
	readonly textures: (TextureKey | null)[];
	/** Why this draw is not part of the one before it; null for an upload's first draw. */
	split: SplitReason | null;
}

/** One upload: an instance range and the draws over it. Valid until the next upload. */
export interface GeometryUpload {
	readonly bytes: Uint8Array;
	readonly byteCount: number;
	readonly instanceCount: number;
	readonly draws: readonly GpuDraw[];
	/** Draw groups written into this upload. */
	readonly groups: number;
}

export interface BatcherOptions {
	encoder: GeometryEncoder;
	textures: ResidentTextureSet;
	/** Instance capacity of one upload. */
	maxInstances?: number;
	/** A group larger than an upload, or a texture with no unit to go on. */
	onDrop?: (command: DrawCommand, reason: string) => void;
	/**
	 * Turns on the encoder contract check (see the class comment) and receives
	 * each violation. A development build passes it; production leaves it out.
	 */
	verify?: (command: DrawCommand, problem: string) => void;
}

interface SinkState extends GeometrySink {
	floats: Float32Array;
	words: Uint32Array;
	halves: Uint16Array;
	bytes: Uint8Array;
	wordOffset: number;
}

interface UploadState extends GeometryUpload {
	bytes: Uint8Array;
	byteCount: number;
	instanceCount: number;
	groups: number;
}

interface DomainWork extends GpuWork {
	splits: SplitCounts;
	flushes: { bufferFull: number };
}

const INITIAL_INSTANCES = 256;
const DEFAULT_MAX_INSTANCES = 65536;

/**
 * Written over a group before `encode`. No lane of any instance can hold it:
 * as a float32 it is 2.35e-38, as two half floats it starts with a NaN, and as
 * four bytes it is a premultiplied colour brighter than its alpha.
 */
export const FENCE_WORD = 0x00ffffff;

export class Batcher {
	private readonly encoder: GeometryEncoder;
	private readonly textures: ResidentTextureSet;
	private readonly maxInstances: number;
	private readonly onDrop?: (command: DrawCommand, reason: string) => void;
	private readonly verify?: (command: DrawCommand, problem: string) => void;

	private readonly sink: SinkState;
	/** Instances written into the current upload. */
	private instanceCount = 0;
	private readonly shape: GroupShape = {
		instances: 0,
		texture: null,
	};

	private readonly drawPool: GpuDraw[] = [];
	private readonly draws: GpuDraw[] = [];
	private groups = 0;
	private current: GpuDraw | null = null;
	private readonly upload: UploadState;
	private readonly work: DomainWork = {
		gpuDraws: 0,
		vertices: 0,
		triangles: 0,
		instances: 0,
		textureBinds: 0,
		bytesUploaded: 0,
		splits: { textureSlotsExhausted: 0, blendChange: 0, stencilLevel: 0 },
		flushes: { bufferFull: 0 },
	};

	constructor({ encoder, textures, maxInstances = DEFAULT_MAX_INSTANCES, onDrop, verify }: BatcherOptions) {
		this.encoder = encoder;
		this.textures = textures;
		this.maxInstances = maxInstances;
		if (!(this.maxInstances >= 1)) throw new Error('Batcher: maxInstances must be at least 1');
		if (!(encoder.instanceWords >= 1)) throw new Error('Batcher: an instance is at least one word');
		this.onDrop = onDrop;
		this.verify = verify;

		// One instance of headroom for the contract check's fence.
		this.sink = viewsOf(new ArrayBuffer((Math.min(INITIAL_INSTANCES, this.maxInstances) + 1) * encoder.instanceWords * 4));
		this.upload = {
			bytes: this.sink.bytes,
			byteCount: 0,
			instanceCount: 0,
			draws: this.draws,
			groups: 0,
		};
	}

	/**
	 * Encodes one domain, already in emit order, and hands each upload to
	 * `execute` as soon as it is complete. The upload and its arrays are reused
	 * by the next one, so `execute` must consume them before returning.
	 *
	 * Returns the GPU-side counters of R13.12 to R13.14 for this domain, in an
	 * object this batcher reuses: read it before the next `flush`. Resident
	 * texture binds are the backend's to add: they happen once per frame, not
	 * once per domain (R5.20).
	 */
	flush(commands: readonly DrawCommand[], execute: (upload: GeometryUpload) => void): GpuWork {
		const work = this.resetWork();

		this.resetUpload();
		this.textures.releaseDynamic();
		const shape = this.shape;
		const instanceWords = this.encoder.instanceWords;

		for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
			const command = commands[commandIndex];
			shape.instances = 0;
			shape.texture = null;
			if (!this.encoder.shape(command, shape)) continue;
			if (shape.instances === 0) continue;

			if (shape.instances > this.maxInstances) {
				this.onDrop?.(
					command,
					`a ${command.kind} group of ${shape.instances} instances is larger than one upload (${this.maxInstances})`,
				);
				continue;
			}

			if (this.instanceCount + shape.instances > this.maxInstances) {
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
			const blend = blendState(command.blend);
			const reason = this.current === null ? null : this.splitReason(blend, exhausted);

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
				this.openDraw(blend, reason);
				if (reason !== null) work.splits[reason] += 1;
			}

			let slot = -1;
			if (texture !== null) {
				slot = this.textures.slotOf(texture);
				if (slot === -1) {
					slot = this.textures.bind(texture);
					work.textureBinds += 1;
				}
			}

			// One instance of headroom for the contract check's fence.
			this.ensureCapacity((this.instanceCount + shape.instances + 1) * instanceWords);
			if (this.verify) this.fence(shape);
			this.encoder.encode(command, this.sink, slot);
			if (this.verify) this.checkFence(this.verify, command, shape);

			const draw = this.current as GpuDraw;
			draw.instanceCount += shape.instances;
			this.instanceCount += shape.instances;
			this.sink.wordOffset += shape.instances * instanceWords;
			this.groups += 1;
		}

		this.emitUpload(execute, work);
		return work;
	}

	private splitReason(blend: BlendMode, exhausted: boolean): SplitReason | null {
		const current = this.current as GpuDraw;
		if (blend !== current.blend) return 'blendChange';
		if (exhausted) return 'textureSlotsExhausted';
		return null;
	}

	private openDraw(blend: BlendMode, split: SplitReason | null): void {
		const draw = this.drawPool[this.draws.length] ?? this.newDraw();
		draw.firstInstance = this.instanceCount;
		draw.instanceCount = 0;
		draw.blend = blend;
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
			firstInstance: 0,
			instanceCount: 0,
			blend: 'over',
			textures: [],
			split: null,
		};
		this.drawPool.push(draw);
		return draw;
	}

	private emitUpload(execute: (upload: GeometryUpload) => void, work: DomainWork): void {
		this.closeDraw();
		if (this.draws.length === 0) return;

		const upload = this.upload;
		upload.bytes = this.sink.bytes;
		upload.byteCount = this.sink.wordOffset * 4;
		upload.instanceCount = this.instanceCount;
		upload.groups = this.groups;
		execute(upload);

		const vertices = this.instanceCount * this.encoder.verticesPerInstance;
		work.gpuDraws += this.draws.length;
		work.instances += this.instanceCount;
		work.vertices += vertices;
		work.triangles += Math.floor(vertices / 3);
		work.bytesUploaded += upload.byteCount;
	}

	private resetWork(): DomainWork {
		const work = this.work;
		work.gpuDraws = 0;
		work.vertices = 0;
		work.triangles = 0;
		work.instances = 0;
		work.textureBinds = 0;
		work.bytesUploaded = 0;
		work.splits.textureSlotsExhausted = 0;
		work.splits.blendChange = 0;
		work.splits.stencilLevel = 0;
		work.flushes.bufferFull = 0;
		return work;
	}

	/** `FENCE_WORD` over every word of the group and the one after it. */
	private fence(shape: GroupShape): void {
		const { words, wordOffset } = this.sink;
		words.fill(FENCE_WORD, wordOffset, wordOffset + shape.instances * this.encoder.instanceWords + 1);
	}

	private checkFence(
		verify: (command: DrawCommand, problem: string) => void,
		command: DrawCommand,
		shape: GroupShape,
	): void {
		const { words, floats, wordOffset } = this.sink;
		const { instanceWords, floatWords } = this.encoder;
		const wordCount = shape.instances * instanceWords;
		const wordEnd = wordOffset + wordCount;
		if (words[wordEnd] !== FENCE_WORD) {
			verify(command, `the encoder wrote past the ${shape.instances} instances it reported`);
			return;
		}
		for (let index = wordOffset; index < wordEnd; index++) {
			if (words[index] === FENCE_WORD) {
				verify(command, `the encoder left word ${index - wordOffset} of ${wordCount} unwritten`);
				return;
			}
			if ((index - wordOffset) % instanceWords < floatWords && Number.isNaN(floats[index])) {
				verify(command, `the encoder wrote NaN into word ${index - wordOffset} of ${wordCount}`);
				return;
			}
		}
	}

	private resetUpload(): void {
		this.sink.wordOffset = 0;
		this.instanceCount = 0;
		this.draws.length = 0;
		this.groups = 0;
		this.current = null;
	}

	private ensureCapacity(words: number): void {
		if (words <= this.sink.words.length) return;
		const grown = viewsOf(new ArrayBuffer(Math.max(words, this.sink.words.length * 2) * 4));
		grown.words.set(this.sink.words.subarray(0, this.sink.wordOffset));
		this.sink.floats = grown.floats;
		this.sink.words = grown.words;
		this.sink.halves = grown.halves;
		this.sink.bytes = grown.bytes;
	}
}

function viewsOf(buffer: ArrayBuffer): SinkState {
	return {
		floats: new Float32Array(buffer),
		words: new Uint32Array(buffer),
		halves: new Uint16Array(buffer),
		bytes: new Uint8Array(buffer),
		wordOffset: 0,
	};
}

/** R5.22a: `additive` is `over` with the fragment's alpha zeroed, so it needs no state of its own. */
function blendState(blend: BlendMode): BlendMode {
	return blend === 'additive' ? 'over' : blend;
}
