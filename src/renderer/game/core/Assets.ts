import { loadImage } from '../../utils/helpers';

/**
 * Asset type enumeration
 */
export enum AssetType {
	IMAGE = 'image',
	AUDIO = 'audio',
	JSON = 'json',
	TEXT = 'text',
	SHADER = 'shader',
}

/**
 * Asset interface
 */
/**
 * Asset data can be various types based on the asset type
 */
export type AssetData =
	| HTMLImageElement
	| HTMLAudioElement
	| ArrayBuffer
	| string
	| AudioBuffer
	| Record<string, unknown>;

/**
 * Asset interface
 */
interface Asset {
	type: AssetType;
	path: string;
	data?: AssetData;
}

/**
 * Asset loader class for handling game assets
 */
export class AssetLoader {
	private assets: Map<string, Asset> = new Map();
	private loaded = false;
	private loadPromise: Promise<void> | null = null;

	/**
	 * Register an asset to be loaded
	 * @param id Unique identifier for the asset
	 * @param path Path to the asset file
	 * @param type Type of asset
	 */
	public register(id: string, path: string, type: AssetType): void {
		if (this.assets.has(id)) {
			console.warn(`Asset with id ${id} already registered. Overwriting.`);
		}

		this.assets.set(id, { type, path });
	}

	/**
	 * Load all registered assets
	 * @returns Promise that resolves when all assets are loaded
	 */
	public load(): Promise<void> {
		if (this.loadPromise) {
			return this.loadPromise;
		}

		this.loadPromise = new Promise<void>((resolve, reject) => {
			const promises: Promise<void>[] = [];

			this.assets.forEach((asset, id) => {
				let promise: Promise<void>;

				switch (asset.type) {
					case AssetType.IMAGE:
						promise = loadImage(asset.path).then((image) => {
							asset.data = image;
						});
						break;

					case AssetType.AUDIO:
						promise = new Promise<void>((audioResolve, audioReject) => {
							const audio = new Audio();
							audio.src = asset.path;

							audio.oncanplaythrough = () => {
								asset.data = audio;
								audioResolve();
							};

							audio.onerror = () => {
								audioReject(new Error(`Failed to load audio: ${asset.path}`));
							};

							// Start loading
							audio.load();
						});
						break;

					case AssetType.JSON:
						promise = fetch(asset.path)
							.then((response) => response.json())
							.then((json) => {
								asset.data = json;
							});
						break;

					case AssetType.TEXT:
					case AssetType.SHADER:
						promise = fetch(asset.path)
							.then((response) => response.text())
							.then((text) => {
								asset.data = text;
							});
						break;

					default:
						console.warn(`Unknown asset type for ${id}`);
						promise = Promise.resolve();
				}

				promises.push(promise);
			});

			Promise.all(promises)
				.then(() => {
					this.loaded = true;
					console.log(`All assets loaded (${this.assets.size} total)`);
					resolve();
				})
				.catch((error) => {
					console.error('Failed to load assets:', error);
					reject(error);
				});
		});

		return this.loadPromise;
	}

	/**
	 * Get a loaded asset by ID
	 * @param id Asset identifier
	 * @returns Asset data or null if not found
	 */
	public get<T extends AssetData = AssetData>(id: string): T | null {
		if (!this.loaded) {
			console.warn('Trying to access assets before loading is complete');
		}

		const asset = this.assets.get(id);
		if (!asset || asset.data === undefined) {
			console.warn(`Asset ${id} not found or not loaded`);
			return null;
		}

		return asset.data as T;
	}

	/**
	 * Check if an asset exists
	 * @param id Asset identifier
	 * @returns Whether the asset exists
	 */
	public has(id: string): boolean {
		return this.assets.has(id);
	}

	/**
	 * Check if all assets have been loaded
	 * @returns Whether all assets are loaded
	 */
	public isLoaded(): boolean {
		return this.loaded;
	}

	/**
	 * Get the number of registered assets
	 * @returns Number of assets
	 */
	public count(): number {
		return this.assets.size;
	}
}
