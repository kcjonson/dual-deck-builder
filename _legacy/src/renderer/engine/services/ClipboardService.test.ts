import { ClipboardService, detectClipboard, memoryClipboard } from './ClipboardService';

describe('detectClipboard (R12.32)', () => {
	it('prefers the Electron bridge', async () => {
		const written: string[] = [];
		const backend = detectClipboard({
			electron: { clipboard: { readText: async () => 'from main', writeText: async (text) => { written.push(text); } } },
			navigator: { clipboard: { readText: async () => 'from navigator', writeText: async () => undefined } },
		});
		expect(backend.source).toBe('electron');
		expect(await backend.readText()).toBe('from main');
		await backend.writeText('copied');
		expect(written).toEqual(['copied']);
	});

	it('uses navigator.clipboard when both halves exist, bound to it', async () => {
		const clipboard = {
			held: 'nav',
			async readText(this: { held: string }) {
				return this.held;
			},
			async writeText(this: { held: string }, text: string) {
				this.held = text;
			},
		};
		const backend = detectClipboard({ navigator: { clipboard } });
		expect(backend.source).toBe('navigator');
		await backend.writeText('x');
		expect(await backend.readText()).toBe('x');
	});

	it('falls back to the page when the async clipboard is missing or partial', () => {
		expect(detectClipboard({ navigator: {} }).source).toBe('memory');
		expect(detectClipboard({ navigator: { clipboard: { writeText: async () => undefined } } }).source).toBe('memory');
		expect(detectClipboard(undefined).source).toBe('memory');
	});
});

describe('ClipboardService', () => {
	it('round-trips through its backend', async () => {
		const service = new ClipboardService({ backend: memoryClipboard() });
		expect(await service.writeText('hello')).toBe(true);
		expect(await service.readText()).toBe('hello');
	});

	it('reports a refused write and still pastes it inside the game', async () => {
		const service = new ClipboardService({
			backend: {
				source: 'navigator',
				readText: async () => {
					throw new Error('NotAllowedError');
				},
				writeText: async () => {
					throw new Error('NotAllowedError');
				},
			},
		});
		expect(await service.writeText('kept')).toBe(false);
		expect(await service.readText()).toBe('kept');
	});

	it('defaults to the page clipboard', async () => {
		const service = new ClipboardService();
		expect(service.source).toBe('memory');
		await service.writeText('a');
		expect(await service.readText()).toBe('a');
	});
});
