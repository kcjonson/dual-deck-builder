import type { TextureHandle } from '../draw/commands';
import type { TexelSource } from '../gpu/TextureStore';
import type { DrawApi } from '../draw/DrawApi';

/** A decoded image: texels and their size. */
export interface LoadedImage {
	source: TexelSource;
	width: number;
	height: number;
}

/** Decodes the image a key names. */
export type AssetLoader = (key: string) => Promise<LoadedImage>;

/** The part of the draw API the cache needs: textures are created and freed through it (R2.17). */
export type TextureOwner = Pick<DrawApi, 'createTexture' | 'destroyTexture'>;

/** One holder's claim on a keyed image. */
export interface AssetRef {
	readonly key: string;
	/** The texture once decoded and created; null before, and after a failed load or `release`. */
	readonly texture: TextureHandle | null;
	/** Settles with the texture, or rejects with the load's error. */
	readonly ready: Promise<TextureHandle>;
	/** Drops this claim; the texture is freed with the last one. Idempotent. */
	release(): void;
}

export interface AssetStats {
	entries: number;
	loading: number;
	loaded: number;
	failed: number;
}

type EntryState = 'loading' | 'loaded' | 'failed';

interface Entry {
	references: number;
	state: EntryState;
	texture: TextureHandle | null;
	ready: Promise<TextureHandle>;
}

/**
 * A loader for keys that are image URLs, through an `<img>` decode. Browser
 * only: the shells pass it, tests pass their own.
 */
export function imageUrlLoader(resolve: (key: string) => string = (key) => key): AssetLoader {
	return async (key: string) => {
		const image = new Image();
		image.src = resolve(key);
		await image.decode();
		return { source: image, width: image.naturalWidth, height: image.naturalHeight };
	};
}

/**
 * The asset cache of R12.32: images by key over the texture store (R5.30).
 *
 * The first `acquire` of a key starts its decode; every later one shares the
 * same texture until the last holder releases it, which frees it. A key
 * released before its decode finishes is never uploaded. Textures are created
 * with a `reload` that decodes again, so a lost context brings them back
 * without the cache keeping a CPU copy (R5.33). A failed decode is kept as
 * failed while anything holds the key, so a screen asking for a missing image
 * each frame does not refetch it each frame; releasing every claim forgets
 * the failure.
 *
 * Decodes resolve in a microtask after the frame that asked, never inside
 * one, so `createTexture` never meets an open frame (R2.17).
 */
export class AssetService {
	private readonly textures: TextureOwner;
	private readonly loader: AssetLoader;
	private readonly entries = new Map<string, Entry>();

	constructor({ textures, loader }: { textures: TextureOwner; loader?: AssetLoader }) {
		this.textures = textures;
		this.loader = loader ?? (async (key: string) => {
			throw new Error(`AssetService: no loader, so "${key}" cannot be decoded`);
		});
	}

	public acquire(key: string): AssetRef {
		let entry = this.entries.get(key);
		if (!entry) {
			entry = this.load(key);
			this.entries.set(key, entry);
		}
		entry.references += 1;
		const owned = entry;
		let released = false;
		return {
			key,
			get texture() {
				return released ? null : owned.texture;
			},
			ready: owned.ready,
			release: () => {
				if (released) return;
				released = true;
				this.release(key, owned);
			},
		};
	}

	/** The texture for `key` if it is loaded and held, without claiming it. */
	public peek(key: string): TextureHandle | null {
		return this.entries.get(key)?.texture ?? null;
	}

	public get stats(): AssetStats {
		const stats: AssetStats = { entries: this.entries.size, loading: 0, loaded: 0, failed: 0 };
		for (const entry of this.entries.values()) stats[entry.state] += 1;
		return stats;
	}

	private load(key: string): Entry {
		// The callbacks run after this returns, by which time `entry` is set.
		let entry: Entry | null = null;
		const ready = this.loader(key).then(
			(image) => {
				// Released while decoding: nothing holds it, nothing is uploaded.
				if (!entry || this.entries.get(key) !== entry) throw new Error(`AssetService: "${key}" was released before it loaded`);
				const texture = this.textures.createTexture({
					width: image.width,
					height: image.height,
					label: key,
					source: image.source,
					reload: () => this.loader(key).then((again) => again.source),
				});
				entry.texture = texture;
				entry.state = 'loaded';
				return texture;
			},
			(error: unknown) => {
				if (entry && this.entries.get(key) === entry) entry.state = 'failed';
				throw error instanceof Error ? error : new Error(String(error));
			},
		);
		// Handled here, so a holder that never reads `ready` leaves no unhandled rejection.
		ready.catch(() => undefined);
		entry = { references: 0, state: 'loading', texture: null, ready };
		return entry;
	}

	private release(key: string, entry: Entry): void {
		entry.references -= 1;
		if (entry.references > 0) return;
		if (this.entries.get(key) === entry) this.entries.delete(key);
		if (entry.texture) {
			this.textures.destroyTexture(entry.texture);
			entry.texture = null;
		}
	}
}
