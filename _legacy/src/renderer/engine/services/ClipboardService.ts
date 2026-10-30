/**
 * Where the text goes: the Electron main process, the browser's async
 * clipboard, or nowhere outside the page.
 */
export type ClipboardSource = 'electron' | 'navigator' | 'memory';

export interface ClipboardBackend {
	readonly source: ClipboardSource;
	readText(): Promise<string>;
	writeText(text: string): Promise<void>;
}

/** The bridge `electron/preload.ts` exposes as `window.electron.clipboard`. */
export interface ElectronClipboardBridge {
	readText(): Promise<string>;
	writeText(text: string): Promise<void>;
}

/** The part of `window` detection reads, so tests pass a plain object. */
export interface ClipboardScope {
	electron?: { clipboard?: ElectronClipboardBridge };
	navigator?: { clipboard?: Partial<Pick<Clipboard, 'readText' | 'writeText'>> };
}

/** Text held in the page only: tests, and a browser with no async clipboard. */
export function memoryClipboard(): ClipboardBackend {
	let held = '';
	return {
		source: 'memory',
		readText: async () => held,
		writeText: async (text: string) => {
			held = text;
		},
	};
}

/**
 * Picks the platform's clipboard (R12.32). Electron's renderer is sandboxed
 * with context isolation, so its clipboard is the main process's, reached
 * through the preload bridge; a browser has `navigator.clipboard` in a secure
 * context, which reads only with permission; anything else keeps the text in
 * the page.
 */
export function detectClipboard(scope: ClipboardScope | undefined): ClipboardBackend {
	const bridge = scope?.electron?.clipboard;
	if (bridge && typeof bridge.readText === 'function' && typeof bridge.writeText === 'function') {
		return {
			source: 'electron',
			readText: () => bridge.readText(),
			writeText: (text: string) => bridge.writeText(text),
		};
	}
	const clipboard = scope?.navigator?.clipboard;
	if (clipboard && typeof clipboard.readText === 'function' && typeof clipboard.writeText === 'function') {
		const readText = clipboard.readText.bind(clipboard);
		const writeText = clipboard.writeText.bind(clipboard);
		return { source: 'navigator', readText: () => readText(), writeText: (text: string) => writeText(text) };
	}
	return memoryClipboard();
}

/**
 * The mount context's clipboard (R9.17, R12.10, R12.32): text in and out, for
 * cut, copy, and paste in text fields.
 *
 * It also keeps the last text copied through it, so paste inside the game
 * still works when the platform refuses: a browser denies `readText` without
 * a permission grant, and a write can fail outside a user gesture. Neither
 * call rejects; a refused write reports false, a refused read answers with
 * the kept text.
 */
export class ClipboardService {
	private readonly backend: ClipboardBackend;
	private kept = '';

	constructor({ backend = memoryClipboard() }: { backend?: ClipboardBackend } = {}) {
		this.backend = backend;
	}

	public get source(): ClipboardSource {
		return this.backend.source;
	}

	/** Copies `text`; false when the platform refused and only the game can paste it. */
	public async writeText(text: string): Promise<boolean> {
		this.kept = text;
		try {
			await this.backend.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	/** The clipboard's text, or the last text copied here when the platform will not say. */
	public async readText(): Promise<string> {
		try {
			return await this.backend.readText();
		} catch {
			return this.kept;
		}
	}
}
