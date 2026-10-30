/**
 * @jest-environment jsdom
 */
import { ERROR_OVERLAY_ID, ErrorOverlay } from './ErrorOverlay';

const BUILD = 'build 142 - 2f8d7a7';
const HINT = 'Send this to the team.';

function thrown(message: string, frames: string[]): Error {
	const error = new Error(message);
	error.stack = [`Error: ${message}`, ...frames.map((frame) => `    at ${frame}`)].join('\n');
	return error;
}

function fireError(error: unknown): void {
	window.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }));
}

function fireRejection(reason: unknown): void {
	window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
}

function overlayText(): string {
	return document.getElementById(ERROR_OVERLAY_ID)?.textContent ?? '';
}

function buttonNamed(name: string): HTMLButtonElement {
	const found = [...document.querySelectorAll<HTMLButtonElement>(`#${ERROR_OVERLAY_ID} button`)].find((node) => node.textContent === name);
	if (!found) throw new Error(`no ${name} button`);
	return found;
}

describe('ErrorOverlay', () => {
	let overlay: ErrorOverlay;
	let uninstall: () => void;

	beforeEach(() => {
		overlay = new ErrorOverlay({ build: BUILD, hint: HINT });
		uninstall = overlay.install();
	});

	afterEach(() => {
		uninstall();
		document.body.innerHTML = '';
	});

	it('shows an uncaught error with its first stack lines, the build and the hint', () => {
		fireError(thrown('screen exploded', ['a (main.js:1:1)', 'b (main.js:1:2)', 'c', 'd', 'e', 'f', 'g', 'h']));
		expect(overlay.visible).toBe(true);
		const text = overlayText();
		expect(text).toContain('Uncaught error');
		expect(text).toContain('Error: screen exploded');
		expect(text).toContain('at a (main.js:1:1)');
		expect(text).toContain('at f');
		expect(text).not.toContain('at g');
		expect(text).toContain('...');
		expect(text).toContain(BUILD);
		expect(text).toContain(HINT);
	});

	it('shows an unhandled rejection', () => {
		fireRejection(new Error('map failed'));
		expect(overlayText()).toContain('Unhandled promise rejection');
		expect(overlayText()).toContain('Error: map failed');
	});

	it('shows a failure the caller reports', () => {
		overlay.report({ error: new Error('no WebGL2'), source: 'startup' });
		expect(overlayText()).toContain('The game failed to start');
		expect(overlayText()).toContain('Error: no WebGL2');
	});

	it('keeps the first failure up, counting repeats and later ones', () => {
		const first = thrown('first', ['a (main.js:1:1)']);
		fireError(first);
		fireError(thrown('first', ['a (main.js:1:1)']));
		fireError(thrown('second', ['b (main.js:2:2)']));
		fireRejection('third');
		const text = overlayText();
		expect(text).toContain('Error: first');
		expect(text).toContain('(x2)');
		expect(text).not.toContain('Error: second');
		expect(text).toContain('2 more errors after this one');
		expect(document.querySelectorAll(`#${ERROR_OVERLAY_ID}`)).toHaveLength(1);
	});

	it('closes, and the next failure opens it again with that failure', () => {
		fireError(thrown('first', ['a']));
		buttonNamed('Close').click();
		expect(overlay.visible).toBe(false);
		expect(document.getElementById(ERROR_OVERLAY_ID)).toBeNull();
		fireError(thrown('second', ['b']));
		expect(overlayText()).toContain('Error: second');
		expect(overlayText()).not.toContain('more error');
	});

	it('copies every failure, the build and the page', async () => {
		const writeText = jest.fn(() => Promise.resolve());
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		fireError(thrown('first', ['a (main.js:1:1)']));
		fireRejection('second');
		const copy = buttonNamed('Copy details');
		copy.click();
		await Promise.resolve();
		const copied = (writeText.mock.calls[0] as unknown as [string])[0];
		expect(copied).toContain('Error: first');
		expect(copied).toContain('second');
		expect(copied).toContain(`Build: ${BUILD}`);
		expect(copied).toContain(`Page: ${window.location.href}`);
		expect(copy.textContent).toBe('Copied');
		Reflect.deleteProperty(navigator, 'clipboard');
	});

	it('focuses Copy details, and keeps the panel\'s keys from the game', () => {
		const gameKeys = jest.fn();
		window.addEventListener('keydown', gameKeys);
		fireError(new Error('boom'));
		expect(document.activeElement).toBe(buttonNamed('Copy details'));
		buttonNamed('Close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(gameKeys).not.toHaveBeenCalled();
		window.removeEventListener('keydown', gameKeys);
	});

	it('stops listening once uninstalled', () => {
		uninstall();
		// jest-environment-jsdom fails the test on an error event no listener hears.
		const bystander = jest.fn();
		window.addEventListener('error', bystander);
		fireError(new Error('boom'));
		fireRejection('nope');
		window.removeEventListener('error', bystander);
		expect(bystander).toHaveBeenCalledTimes(1);
		expect(overlay.visible).toBe(false);
	});
});
