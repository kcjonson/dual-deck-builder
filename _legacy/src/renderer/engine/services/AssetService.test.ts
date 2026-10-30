import type { TextureHandle } from '../draw/commands';
import type { TextureOptions } from '../gpu/TextureStore';
import { AssetService, LoadedImage, TextureOwner } from './AssetService';

interface Pending {
	key: string;
	resolve: (image: LoadedImage) => void;
	reject: (error: Error) => void;
}

/** Counts what a draw API would hold. */
class Textures implements TextureOwner {
	public live = new Set<TextureHandle>();
	public created: TextureOptions[] = [];
	private nextId = 1;

	public createTexture(options: TextureOptions): TextureHandle {
		const handle: TextureHandle = { id: this.nextId++, width: options.width, height: options.height, label: options.label ?? null };
		this.created.push(options);
		this.live.add(handle);
		return handle;
	}

	public destroyTexture(handle: TextureHandle): void {
		this.live.delete(handle);
	}
}

let textures: Textures;
let pending: Pending[];
let service: AssetService;

function image(): LoadedImage {
	return { source: new Uint8Array(2 * 2 * 4), width: 2, height: 2 };
}

/** Lets the decode's continuation run. */
async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	textures = new Textures();
	pending = [];
	service = new AssetService({
		textures,
		loader: (key) => new Promise<LoadedImage>((resolve, reject) => pending.push({ key, resolve, reject })),
	});
});

function liveTextures(): number {
	return textures.live.size;
}

describe('AssetService (R12.32)', () => {
	it('decodes a key once and shares its texture between holders', async () => {
		const first = service.acquire('art/ram.png');
		const second = service.acquire('art/ram.png');
		expect(pending.map((entry) => entry.key)).toEqual(['art/ram.png']);
		expect(first.texture).toBeNull();

		pending[0].resolve(image());
		const texture = await first.ready;
		expect(await second.ready).toBe(texture);
		expect(first.texture).toBe(texture);
		expect(texture.label).toBe('art/ram.png');
		expect(service.peek('art/ram.png')).toBe(texture);
		expect(service.stats).toEqual({ entries: 1, loading: 0, loaded: 1, failed: 0 });
	});

	it('creates the texture with a reload that decodes again, for a lost context (R5.33)', async () => {
		const ref = service.acquire('a');
		pending[0].resolve(image());
		await ref.ready;
		const reloaded = textures.created[0].reload?.();
		expect(pending.map((entry) => entry.key)).toEqual(['a', 'a']);
		const again = image();
		pending[1].resolve(again);
		expect(await reloaded).toBe(again.source);
	});

	it('frees the texture with the last release, and a released ref reads null', async () => {
		const first = service.acquire('a');
		const second = service.acquire('a');
		pending[0].resolve(image());
		await first.ready;
		const live = liveTextures();

		first.release();
		first.release();
		expect(first.texture).toBeNull();
		expect(liveTextures()).toBe(live);

		second.release();
		expect(liveTextures()).toBe(live - 1);
		expect(service.stats.entries).toBe(0);
	});

	it('never uploads a key released before its decode finished', async () => {
		const ref = service.acquire('a');
		ref.release();
		const live = liveTextures();
		pending[0].resolve(image());
		await expect(ref.ready).rejects.toThrow('released before it loaded');
		expect(liveTextures()).toBe(live);
	});

	it('keeps a failed load as failed while held, and retries after every claim is gone', async () => {
		const ref = service.acquire('missing');
		pending[0].reject(new Error('404'));
		await expect(ref.ready).rejects.toThrow('404');
		expect(service.stats.failed).toBe(1);

		const again = service.acquire('missing');
		expect(pending).toHaveLength(1);
		again.release();
		ref.release();

		service.acquire('missing');
		expect(pending).toHaveLength(2);
	});

	it('leaves no unhandled rejection when nobody reads ready', async () => {
		service.acquire('quiet');
		pending[0].reject(new Error('nope'));
		await flush();
		expect(service.stats.failed).toBe(1);
	});

	it('fails every acquire without a loader, saying why', async () => {
		const bare = new AssetService({ textures });
		await expect(bare.acquire('x').ready).rejects.toThrow('no loader');
	});
});
