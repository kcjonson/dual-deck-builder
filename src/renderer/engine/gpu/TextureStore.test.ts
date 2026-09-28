import { TexelSource, TextureDescription, TextureDevice, TextureStore } from './TextureStore';

interface FakeTexture {
	id: number;
	label: string | null;
	uploads: number;
	released: boolean;
}

/** A device that records what the store asked of it. */
class FakeDevice implements TextureDevice<FakeTexture> {
	readonly log: string[] = [];
	readonly textures: FakeTexture[] = [];

	allocate(description: TextureDescription): FakeTexture {
		const texture = { id: this.textures.length + 1, label: description.label, uploads: 0, released: false };
		this.textures.push(texture);
		this.log.push(`allocate ${description.label}`);
		return texture;
	}

	upload(texture: FakeTexture, description: TextureDescription): void {
		texture.uploads += 1;
		this.log.push(`upload ${description.label} ${description.content}`);
	}

	release(texture: FakeTexture): void {
		texture.released = true;
		this.log.push(`release ${texture.label}`);
	}
}

const KB = 1024;

/** A square RGBA8 source of `bytes` bytes, rounded to whole texels. */
function texels(side: number): Uint8Array {
	return new Uint8Array(side * side * 4);
}

function setup(uploadBudgetBytes?: number) {
	const device = new FakeDevice();
	const diagnostics: string[] = [];
	const store = new TextureStore({ device, uploadBudgetBytes, onDiagnostic: (message) => diagnostics.push(message) });
	return { device, store, diagnostics };
}

describe('ownership (R5.30)', () => {
	it('frees a texture when its last reference is released', () => {
		const { device, store } = setup();
		const handle = store.create({ width: 4, height: 4, label: 'a' });
		store.retain(handle);

		store.release(handle);
		expect(store.isLive(handle)).toBe(true);
		expect(device.textures[0].released).toBe(false);

		store.release(handle);
		expect(store.isLive(handle)).toBe(false);
		expect(device.textures[0].released).toBe(true);
		expect(store.stats).toMatchObject({ liveTextures: 0, residentTextureBytes: 0 });
	});

	it('throws on a release past zero rather than freeing something else', () => {
		const { store } = setup();
		const handle = store.create({ width: 1, height: 1, label: 'twice' });
		store.release(handle);
		expect(() => store.release(handle)).toThrow(/'twice'.*not live/);
		expect(() => store.retain(handle)).toThrow(/not live/);
	});

	it('defers the GPU release of a texture freed inside a frame to endFrame', () => {
		const { device, store } = setup();
		const handle = store.create({ width: 2, height: 2, label: 'mid' });
		store.beginFrame();
		store.release(handle);
		expect(device.textures[0].released).toBe(false);
		expect(store.isLive(handle)).toBe(false);
		store.endFrame();
		expect(device.textures[0].released).toBe(true);
	});

	it('allocates an empty texture at once, since there is nothing to upload', () => {
		const { device, store } = setup();
		const handle = store.create({ width: 8, height: 8, label: 'empty' });
		expect(store.isResident(handle)).toBe(true);
		expect(device.log).toEqual(['allocate empty']);
		expect(store.stats).toMatchObject({ residentTextureBytes: 256, bytesUploaded: 0, pendingUploads: 0 });
	});

	it('rejects a source that does not match the size', () => {
		const { store } = setup();
		expect(() => store.create({ width: 2, height: 2, source: new Uint8Array(4) })).toThrow(/16 bytes, the source has 4/);
		expect(() => store.create({ width: 0, height: 2 })).toThrow(/positive integer/);
	});
});

describe('metered uploads (R5.32)', () => {
	it('queues a texture with a source and uploads it at beginFrame', () => {
		const { device, store } = setup();
		const handle = store.create({ width: 16, height: 16, label: 'art', source: texels(16) });

		expect(store.isResident(handle)).toBe(false);
		expect(store.native(handle)).toBeNull();
		expect(device.log).toEqual([]);
		expect(store.stats.pendingUploads).toBe(1);

		store.beginFrame();
		expect(store.isResident(handle)).toBe(true);
		expect(store.native(handle)).toBe(device.textures[0]);
		expect(device.log).toEqual(['allocate art', 'upload art color']);
		expect(store.stats).toMatchObject({ bytesUploaded: 1 * KB, pendingUploads: 0, residentTextureBytes: 1 * KB });
		store.endFrame();

		store.beginFrame();
		expect(store.stats.bytesUploaded).toBe(0);
	});

	it('spends the budget oldest request first and carries the rest to later frames', () => {
		// 64 KB budget; each 128-square texture is 64 KB.
		const { device, store } = setup(64 * KB);
		const first = store.create({ width: 128, height: 128, label: 'first', source: texels(128) });
		const second = store.create({ width: 64, height: 64, label: 'second', source: texels(64) });
		const third = store.create({ width: 64, height: 64, label: 'third', source: texels(64) });

		store.beginFrame();
		expect([store.isResident(first), store.isResident(second), store.isResident(third)]).toEqual([true, false, false]);
		expect(store.stats).toMatchObject({ bytesUploaded: 64 * KB, pendingUploads: 2 });
		store.endFrame();

		store.beginFrame();
		// 16 KB each: both fit in one frame's budget.
		expect([store.isResident(second), store.isResident(third)]).toEqual([true, true]);
		expect(store.stats).toMatchObject({ bytesUploaded: 32 * KB, pendingUploads: 0 });
		expect(device.log.filter((line) => line.startsWith('upload'))).toEqual([
			'upload first color',
			'upload second color',
			'upload third color',
		]);
	});

	it('always uploads one texture a frame, even one larger than the whole budget', () => {
		const { store } = setup(1 * KB);
		const big = store.create({ width: 64, height: 64, source: texels(64) });
		const next = store.create({ width: 1, height: 1, source: texels(1) });
		store.beginFrame();
		expect(store.isResident(big)).toBe(true);
		expect(store.isResident(next)).toBe(false);
	});

	it('uploads an immediate texture at creation, outside the queue', () => {
		const { device, store } = setup();
		const handle = store.create({ width: 4, height: 4, label: 'atlas', source: texels(4), content: 'mask', immediate: true });
		expect(store.isResident(handle)).toBe(true);
		expect(device.log).toEqual(['allocate atlas', 'upload atlas mask']);
		expect(store.stats.pendingUploads).toBe(0);
	});

	it('drops a queued upload whose texture was released before it ran', () => {
		const { device, store } = setup();
		const handle = store.create({ width: 4, height: 4, label: 'gone', source: texels(4) });
		store.release(handle);
		store.beginFrame();
		expect(device.log).toEqual([]);
		expect(store.stats.pendingUploads).toBe(0);
	});
});

describe('context loss (R5.33, R15.5)', () => {
	it('uploads kept sources again and allocates empty textures again, in creation order', () => {
		const { device, store } = setup();
		const atlas = store.create({ width: 4, height: 4, label: 'atlas', source: texels(4), content: 'mask', keepSource: true, immediate: true });
		const art = store.create({ width: 4, height: 4, label: 'art', source: texels(4), keepSource: true });
		const empty = store.create({ width: 4, height: 4, label: 'empty' });
		store.beginFrame();
		store.endFrame();
		device.log.length = 0;

		store.lose();
		expect([store.isResident(atlas), store.isResident(art), store.isResident(empty)]).toEqual([false, false, false]);
		expect(store.stats.residentTextureBytes).toBe(0);
		// Nothing is released: those objects died with the context.
		expect(device.log).toEqual([]);

		store.restore();
		// The immediate atlas and the empty texture are back before the first frame.
		expect(store.isResident(atlas)).toBe(true);
		expect(store.isResident(empty)).toBe(true);
		expect(store.isResident(art)).toBe(false);
		store.beginFrame();
		expect(store.isResident(art)).toBe(true);
		expect(device.log).toEqual(['allocate atlas', 'upload atlas mask', 'allocate empty', 'allocate art', 'upload art color']);
	});

	it('keeps no CPU copy by default, so a texture with no reload is reported lost', () => {
		const { store, diagnostics } = setup();
		const art = store.create({ width: 2, height: 2, label: 'art', source: texels(2) });
		store.beginFrame();
		store.endFrame();

		store.lose();
		store.restore();
		store.beginFrame();
		expect(store.isResident(art)).toBe(false);
		expect(store.stats.lostTextures).toBe(1);
		expect(diagnostics).toEqual(["texture 'art' was lost with the context and had no kept source and no reload"]);

		store.release(art);
		expect(store.stats.lostTextures).toBe(0);
	});

	it('re-decodes through reload and queues the result', async () => {
		const { store } = setup();
		const reload = jest.fn(async (): Promise<TexelSource> => texels(2));
		const art = store.create({ width: 2, height: 2, label: 'art', source: texels(2), reload });
		store.beginFrame();
		store.endFrame();

		store.lose();
		store.restore();
		expect(reload).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		await Promise.resolve();
		expect(store.stats.pendingUploads).toBe(1);

		store.beginFrame();
		expect(store.isResident(art)).toBe(true);
	});

	it('drops a decode that finishes after a second loss, and decodes again on the next restore', async () => {
		const { store } = setup();
		let resolveFirst!: (source: TexelSource) => void;
		const reload = jest
			.fn<Promise<TexelSource>, []>()
			.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
			.mockImplementation(async () => texels(2));
		const art = store.create({ width: 2, height: 2, source: texels(2), reload });
		store.beginFrame();
		store.endFrame();

		store.lose();
		store.restore();
		store.lose();
		resolveFirst(texels(2));
		await Promise.resolve();
		expect(store.stats.pendingUploads).toBe(0);

		store.restore();
		await Promise.resolve();
		await Promise.resolve();
		store.beginFrame();
		expect(reload).toHaveBeenCalledTimes(2);
		expect(store.isResident(art)).toBe(true);
	});

	it('reports a reload that fails', async () => {
		const { store, diagnostics } = setup();
		const art = store.create({
			width: 2,
			height: 2,
			label: 'art',
			source: texels(2),
			reload: () => Promise.reject(new Error('404')),
		});
		store.beginFrame();
		store.endFrame();
		store.lose();
		store.restore();
		await Promise.resolve();
		await Promise.resolve();

		expect(store.isResident(art)).toBe(false);
		expect(diagnostics).toEqual(["texture 'art' was lost with the context and could not be reloaded: Error: 404"]);
	});

	it('holds a texture created while lost until the restore', () => {
		const { device, store } = setup();
		store.lose();
		const handle = store.create({ width: 2, height: 2, source: texels(2), immediate: true, label: 'late' });
		store.beginFrame();
		expect(store.isResident(handle)).toBe(false);
		expect(device.log).toEqual([]);

		store.restore();
		expect(store.isResident(handle)).toBe(true);
	});
});
