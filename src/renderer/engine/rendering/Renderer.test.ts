/**
 * @jest-environment jsdom
 */
import { Renderer } from './Renderer';

jest.mock('./FontAtlas', () => ({
	FontAtlas: jest.fn().mockImplementation(() => ({ upload: jest.fn() })),
}));

/** Enough of a WebGL2 context for the device: it only sizes the viewport. */
function mountCanvas(): HTMLCanvasElement {
	document.body.innerHTML = '<canvas id="game-canvas"></canvas>';
	const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
	const gl = { viewport: jest.fn(), drawingBufferColorSpace: 'srgb' };
	canvas.getContext = jest.fn().mockReturnValue(gl) as unknown as HTMLCanvasElement['getContext'];
	return canvas;
}

function status(): string | null {
	return document.getElementById('gpu-status')?.textContent ?? null;
}

describe('Renderer context loss (R15.5)', () => {
	it('says the device is lost, then clears the status once every listener has rebuilt', () => {
		const canvas = mountCanvas();
		const renderer = new Renderer('game-canvas');
		const order: string[] = [];
		renderer.addContextListener({ lost: () => order.push('lost'), restored: () => order.push(`restored, status ${status() === null ? 'gone' : 'up'}`) });

		canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
		expect(renderer.contextLost).toBe(true);
		expect(status()).toMatch(/lost/);

		canvas.dispatchEvent(new Event('webglcontextrestored'));
		expect(order).toEqual(['lost', 'restored, status up']);
		expect(status()).toBeNull();
		expect(renderer.contextLost).toBe(false);
	});

	it('keeps an error on screen when a rebuild throws', () => {
		const canvas = mountCanvas();
		const renderer = new Renderer('game-canvas');
		const resumed = jest.fn();
		renderer.addContextListener({
			restored: () => {
				throw new Error('link failed');
			},
		});
		renderer.addContextListener({ restored: resumed });

		// jsdom reports a listener's exception rather than throwing it out of
		// dispatchEvent; silence that report, the status line is the assertion.
		const reported = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		const onError = (event: ErrorEvent) => event.preventDefault();
		window.addEventListener('error', onError);
		try {
			canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
			canvas.dispatchEvent(new Event('webglcontextrestored'));
		} finally {
			window.removeEventListener('error', onError);
			reported.mockRestore();
		}

		expect(status()).toMatch(/could not rebuild/);
		// The loop's listener comes after the failed one and never runs.
		expect(resumed).not.toHaveBeenCalled();
	});
});
