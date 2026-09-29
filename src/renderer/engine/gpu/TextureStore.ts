import type { TextureHandle } from '../draw/commands';

/**
 * The resource layer of R5.30 to R5.35, for textures: who owns a texture, when
 * its texels reach the GPU, and how it comes back after a lost context.
 *
 * It sits below the batcher and knows nothing about GL. A `TextureDevice` does
 * the three things only a GPU can (allocate, upload, release); the WebGL2 one
 * is `rendering/WebGL2TextureDevice.ts`, and the null and recording backends
 * use `NULL_TEXTURE_DEVICE`, so R5.30's "the null backend counts them" is this
 * same class with nothing underneath.
 *
 * Ownership. A handle starts with one reference; `retain` adds one and
 * `release` drops one, and the texture is freed when the count reaches zero.
 * Components hold handles only (R2.17). Releasing a texture while a frame is
 * open defers the GPU release to `endFrame`, because commands already
 * submitted may still name it and the batcher flushes them later.
 *
 * Metered uploads (R5.32). A texture created with a source is queued, not
 * uploaded; `beginFrame` drains the queue oldest request first until the
 * frame's byte budget is spent. The first upload of a frame always goes, so a
 * texture larger than the whole budget still arrives, one per frame. Until
 * then `isResident` is false and the component draws its placeholder (R12.5).
 * The GPU storage is allocated at upload, not at create, so a queued texture
 * costs no GPU memory. `immediate` skips the queue for the UI atlases that
 * R2.18 wants loaded before the first frame.
 *
 * Context loss (R5.33, R15.5). `lose` forgets every GPU object; `restore`
 * rebuilds each texture from what it was told to keep: the source itself when
 * `keepSource` is set, a fresh decode through `reload`, or nothing at all for
 * a texture that never had contents. A texture with contents and neither of
 * the first two cannot come back, and says so. An upload that throws loses
 * that one texture (and releases its storage); the rest of the queue goes on,
 * and a restore retries it if it kept its source or can reload. Keeping CPU copies is opt-in:
 * the art a card game carries is too large to hold twice by default.
 *
 * Deferred, with the reason in the decision record: the card-art texture array
 * and its residency budget (R5.31, phase 6), render targets and their pool
 * (R5.34, no consumer until group opacity), and eviction, which is why
 * `evictions` is a measured zero rather than null.
 */

/** Premultiplied RGBA8 texels (R5.18), or a DOM source the device premultiplies on upload (R15.19). */
export type TexelSource = Uint8Array | TexImageSource;

/**
 * `color` is premultiplied on upload. `mask` is uploaded raw: coverage in a
 * channel, or a distance field, where premultiplying would corrupt the value
 * (R15.19, R6.4b).
 */
export type TextureContent = 'color' | 'mask';

export interface TextureOptions {
	width: number;
	height: number;
	label?: string;
	/** The texels. Absent, the texture is allocated with undefined contents. */
	source?: TexelSource;
	/** Defaults to `color`. */
	content?: TextureContent;
	/**
	 * Keep the source after upload so a restored context can upload it again.
	 * Off by default (R5.33).
	 */
	keepSource?: boolean;
	/** Decodes the source again after a context loss (R5.33). */
	reload?: () => Promise<TexelSource>;
	/**
	 * Upload at creation instead of through the metered queue. For the UI
	 * atlases loaded before the first frame (R2.18); never for art.
	 */
	immediate?: boolean;
}

/** Texels, from the top-left corner. */
export interface TextureRegion {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface TextureDescription {
	readonly width: number;
	readonly height: number;
	readonly content: TextureContent;
	readonly label: string | null;
}

/** The part of the resource layer that talks to a GPU. */
export interface TextureDevice<Native> {
	/** Immutable storage of the described size (R15.18); contents undefined. */
	allocate(description: TextureDescription): Native;
	/** The whole texture, from `source`. Never re-specifies the storage. */
	upload(texture: Native, description: TextureDescription, source: TexelSource): void;
	/** `region` of the texture from tightly packed RGBA8 `texels`, as given (premultiplied already for colour). */
	uploadRegion(texture: Native, region: TextureRegion, texels: Uint8Array): void;
	release(texture: Native): void;
}

/** The device of the null and recording backends: every call succeeds and nothing exists. */
export const NULL_TEXTURE_DEVICE: TextureDevice<true> = {
	allocate: () => true,
	upload: () => undefined,
	uploadRegion: () => undefined,
	release: () => undefined,
};

/** R5.32's default per-frame upload budget. */
export const DEFAULT_UPLOAD_BUDGET_BYTES = 2 * 1024 * 1024;

export interface TextureStoreOptions<Native> {
	device: TextureDevice<Native>;
	uploadBudgetBytes?: number;
	/** A texture that could not be recovered or reloaded. Once per texture. */
	onDiagnostic?: (message: string) => void;
}

/** R5.35's resource counters, plus the two this layer can also answer. */
export interface TextureStoreStats {
	/** Texels uploaded by this frame's `beginFrame`. */
	bytesUploaded: number;
	/** GPU bytes held by textures that have storage. RGBA8, no mips. */
	residentTextureBytes: number;
	/** Uploads waiting in the queue. A texture still being re-decoded is not yet a request. */
	pendingUploads: number;
	/** Nothing is evicted until the phase 6 residency budget, so this is a measured zero. */
	evictions: number;
	liveTextures: number;
	/** Textures a lost context took that nothing could rebuild. */
	lostTextures: number;
}

type TextureState = 'pending' | 'resident' | 'reloading' | 'lost';

interface TextureRecord<Native> {
	readonly handle: TextureHandle;
	readonly description: TextureDescription;
	readonly bytes: number;
	readonly keepSource: boolean;
	readonly reload: (() => Promise<TexelSource>) | null;
	readonly immediate: boolean;
	/** Whether a source was ever given, which is what separates "empty" from "lost". */
	readonly hasContents: boolean;
	references: number;
	native: Native | null;
	state: TextureState;
	/** The upload waiting to happen, or the copy kept for a restore. */
	source: TexelSource | null;
}

export class TextureStore<Native> {
	private readonly device: TextureDevice<Native>;
	private readonly uploadBudgetBytes: number;
	private readonly onDiagnostic: (message: string) => void;

	/** Insertion order is creation order, which is the order a restore re-queues in. */
	private readonly records = new Map<number, TextureRecord<Native>>();
	/** Oldest request first (R5.32). */
	private readonly queue: TextureRecord<Native>[] = [];
	/** Released while a frame was open; freed at `endFrame`. */
	private readonly doomed: Native[] = [];

	private nextId = 1;
	private frameOpen = false;
	private deviceLost = false;
	/** Bumped by every loss, so a reload that resolves after a second loss is dropped. */
	private generation = 0;
	private uploadedThisFrame = 0;
	private residentBytes = 0;
	private lost = 0;

	constructor({ device, uploadBudgetBytes = DEFAULT_UPLOAD_BUDGET_BYTES, onDiagnostic }: TextureStoreOptions<Native>) {
		if (!(uploadBudgetBytes > 0)) {
			throw new Error(`TextureStore: the upload budget must be positive, got ${uploadBudgetBytes}`);
		}
		this.device = device;
		this.uploadBudgetBytes = uploadBudgetBytes;
		this.onDiagnostic = onDiagnostic ?? (() => undefined);
	}

	create({
		width,
		height,
		label,
		source,
		content = 'color',
		keepSource = false,
		reload,
		immediate = false,
	}: TextureOptions): TextureHandle {
		if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
			throw new Error(`TextureStore: a texture needs a positive integer size, got ${width} by ${height}`);
		}
		if (source instanceof Uint8Array && source.length !== width * height * 4) {
			throw new Error(
				`TextureStore: ${width} by ${height} RGBA8 is ${width * height * 4} bytes, the source has ${source.length}`,
			);
		}

		const handle: TextureHandle = { id: this.nextId++, width, height, label: label ?? null };
		const record: TextureRecord<Native> = {
			handle,
			description: { width, height, content, label: handle.label },
			bytes: width * height * 4,
			keepSource,
			reload: reload ?? null,
			immediate,
			hasContents: source !== undefined,
			references: 1,
			native: null,
			state: 'pending',
			source: source ?? null,
		};
		this.records.set(handle.id, record);
		this.schedule(record);
		return handle;
	}

	/** Adds a reference. Returns the handle so a holder can write `this.art = store.retain(art)`. */
	retain(handle: TextureHandle): TextureHandle {
		this.recordOf(handle).references += 1;
		return handle;
	}

	/** Drops a reference, and frees the texture when it was the last. */
	release(handle: TextureHandle): void {
		const record = this.recordOf(handle);
		record.references -= 1;
		if (record.references > 0) return;

		this.records.delete(handle.id);
		const queued = this.queue.indexOf(record);
		if (queued >= 0) this.queue.splice(queued, 1);
		if (record.state === 'lost') this.lost -= 1;
		record.source = null;
		this.freeStorage(record);
	}

	isLive(handle: TextureHandle): boolean {
		return this.records.has(handle.id);
	}

	/** True once the texels are on the GPU; a component draws its placeholder until then (R12.5). */
	isResident(handle: TextureHandle): boolean {
		return this.records.get(handle.id)?.state === 'resident';
	}

	references(handle: TextureHandle): number {
		return this.records.get(handle.id)?.references ?? 0;
	}

	/** The device's object for a resident texture, or null. For the backend, never a component. */
	native(handle: TextureHandle): Native | null {
		const record = this.records.get(handle.id);
		return record?.state === 'resident' ? record.native : null;
	}

	/**
	 * Rewrites `region` of a live texture from tightly packed RGBA8 `texels`
	 * now, for a texture that is filled a piece at a time (R6.4a's raster
	 * glyph page). The write lands in the kept source too, when the texture
	 * keeps a `Uint8Array` one, so a restored context uploads the texture as
	 * it stands. A texture not yet resident, or a lost device, gets only that.
	 * Uploads bind a unit no draw samples, so a write between two flushes
	 * disturbs nothing the backend has bound, and draws already issued keep
	 * the texels they were issued with.
	 */
	writeRegion(handle: TextureHandle, region: TextureRegion, texels: Uint8Array): void {
		const record = this.recordOf(handle);
		const { width, height } = record.description;
		if (!Number.isInteger(region.x) || !Number.isInteger(region.y) || !Number.isInteger(region.width) || !Number.isInteger(region.height)
			|| region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1
			|| region.x + region.width > width || region.y + region.height > height) {
			throw new Error(`TextureStore: region ${JSON.stringify(region)} is not inside the ${width} by ${height} texture`);
		}
		if (texels.length !== region.width * region.height * 4) {
			throw new Error(`TextureStore: a ${region.width} by ${region.height} region is ${region.width * region.height * 4} bytes, the texels have ${texels.length}`);
		}
		const kept = record.source;
		if (kept instanceof Uint8Array) {
			for (let row = 0; row < region.height; row++) {
				kept.set(
					texels.subarray(row * region.width * 4, (row + 1) * region.width * 4),
					((region.y + row) * width + region.x) * 4,
				);
			}
		}
		if (this.deviceLost || record.state !== 'resident' || record.native === null) return;
		try {
			this.device.uploadRegion(record.native, region, texels);
		} catch (error) {
			this.onDiagnostic(`texture ${record.handle.label ?? record.handle.id} region could not be uploaded: ${String(error)}`);
			return;
		}
		this.uploadedThisFrame += texels.length;
	}

	/** Drains the upload queue under the byte budget (R5.32). A lost device uploads nothing. */
	beginFrame(): void {
		this.frameOpen = true;
		this.uploadedThisFrame = 0;
		if (this.deviceLost || this.queue.length === 0) return;

		// Each record leaves the queue before its upload runs, so a failure
		// cannot leave uploaded records queued or retry itself every frame.
		while (this.queue.length > 0) {
			const record = this.queue[0];
			if (this.uploadedThisFrame > 0 && this.uploadedThisFrame + record.bytes > this.uploadBudgetBytes) break;
			this.queue.shift();
			this.upload(record);
		}
	}

	/** Frees what was released during the frame, now that nothing can name it. */
	endFrame(): void {
		this.frameOpen = false;
		for (let index = 0; index < this.doomed.length; index++) this.device.release(this.doomed[index]);
		this.doomed.length = 0;
	}

	/**
	 * The context is gone and every GPU object with it. Nothing is released:
	 * the objects belonged to a context that no longer exists.
	 */
	lose(): void {
		this.deviceLost = true;
		this.generation += 1;
		this.queue.length = 0;
		this.doomed.length = 0;
		this.residentBytes = 0;
		for (const record of this.records.values()) {
			record.native = null;
			if (record.state === 'resident') record.state = 'pending';
		}
	}

	/**
	 * A new context: every live texture is rebuilt from its CPU-side
	 * description, in creation order. Immediate textures (the UI atlases) are
	 * back before this returns, so the first frame after a restore has text.
	 */
	restore(): void {
		this.deviceLost = false;
		for (const record of this.records.values()) {
			if (record.state === 'lost') {
				// A texture whose upload failed still has a way back if it kept
				// its source or can reload; one lost with the context does not.
				if (record.source === null && !record.reload) continue;
				this.lost -= 1;
			}
			// A texture still decoding from the previous restore decodes again:
			// that result carries the old generation and will be dropped.
			if (record.source !== null || !record.hasContents) {
				this.schedule(record);
			} else if (record.reload) {
				this.reloadSource(record);
			} else {
				this.markLost(record, 'was lost with the context and had no kept source and no reload');
			}
		}
	}

	get stats(): TextureStoreStats {
		return {
			bytesUploaded: this.uploadedThisFrame,
			residentTextureBytes: this.residentBytes,
			pendingUploads: this.queue.length,
			evictions: 0,
			liveTextures: this.records.size,
			lostTextures: this.lost,
		};
	}

	// -- internals ----------------------------------------------------------

	/**
	 * Puts a record where it belongs: storage now for an empty texture, an
	 * upload now for an immediate one, otherwise the back of the queue. While
	 * the device is lost everything waits for `restore`.
	 */
	private schedule(record: TextureRecord<Native>): void {
		record.state = 'pending';
		if (this.deviceLost) return;
		if (record.source === null) {
			try {
				record.native = this.device.allocate(record.description);
			} catch (error) {
				this.markLost(record, `could not be allocated: ${String(error)}`);
				return;
			}
			this.residentBytes += record.bytes;
			record.state = 'resident';
		} else if (record.immediate) {
			this.upload(record);
		} else {
			this.queue.push(record);
		}
	}

	/**
	 * A failure is contained to the one texture: `allocate` throws between a
	 * real context loss and its event, and `texSubImage2D` throws on a closed
	 * `ImageBitmap` or a tainted canvas. The storage is released, the texture
	 * is reported lost, and the source stays so a restore can try again.
	 */
	private upload(record: TextureRecord<Native>): void {
		const source = record.source;
		if (source === null) return;
		let native: Native | null = null;
		try {
			native = this.device.allocate(record.description);
			this.device.upload(native, record.description, source);
		} catch (error) {
			if (native !== null) this.device.release(native);
			this.markLost(record, `could not be uploaded: ${String(error)}`);
			return;
		}
		record.native = native;
		record.state = 'resident';
		if (!record.keepSource) record.source = null;
		this.residentBytes += record.bytes;
		this.uploadedThisFrame += record.bytes;
	}

	private reloadSource(record: TextureRecord<Native>): void {
		const reload = record.reload;
		if (!reload) return;
		const generation = this.generation;
		record.state = 'reloading';
		let decoding: Promise<TexelSource>;
		try {
			decoding = reload();
		} catch (error) {
			this.markLost(record, `was lost with the context and could not be reloaded: ${String(error)}`);
			return;
		}
		decoding.then(
			(source) => {
				// Released, or lost again, while it decoded: this result belongs to nobody.
				if (this.records.get(record.handle.id) !== record || generation !== this.generation) return;
				record.source = source;
				this.schedule(record);
			},
			(error: unknown) => {
				if (this.records.get(record.handle.id) !== record || generation !== this.generation) return;
				this.markLost(record, `was lost with the context and could not be reloaded: ${String(error)}`);
			},
		);
	}

	private markLost(record: TextureRecord<Native>, what: string): void {
		record.state = 'lost';
		this.lost += 1;
		const name = record.handle.label ? `'${record.handle.label}'` : `${record.handle.id}`;
		this.onDiagnostic(`texture ${name} ${what}`);
	}

	private freeStorage(record: TextureRecord<Native>): void {
		const native = record.native;
		record.native = null;
		if (native === null) return;
		this.residentBytes -= record.bytes;
		if (this.frameOpen) this.doomed.push(native);
		else this.device.release(native);
	}

	private recordOf(handle: TextureHandle): TextureRecord<Native> {
		const record = this.records.get(handle.id);
		if (!record) {
			throw new Error(
				`TextureStore: texture ${handle.id}${handle.label ? ` ('${handle.label}')` : ''} is not live; it was released already or never created here`,
			);
		}
		return record;
	}
}
