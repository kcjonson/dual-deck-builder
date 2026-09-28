/**
 * @jest-environment jsdom
 */
import { Renderer } from './Renderer';

jest.mock('./FontAtlas', () => ({
	FontAtlas: jest.fn().mockImplementation(() => ({ upload: jest.fn() })),
}));

/** jsdom has no `matchMedia`; `CanvasViewport` registers one resolution query. */
window.matchMedia = jest.fn().mockReturnValue({
	addEventListener: jest.fn(),
	removeEventListener: jest.fn(),
}) as unknown as typeof window.matchMedia;

/**
 * Enough of a WebGL2 context for the device: it sizes the viewport and
 * detects features, and finds none.
 */
function mountCanvas(): HTMLCanvasElement {
	document.body.innerHTML = '<canvas id="game-canvas"></canvas>';
	const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
	const gl = {
		viewport: jest.fn(),
		drawingBufferColorSpace: 'srgb',
		getExtension: jest.fn().mockReturnValue(null),
		getParameter: jest.fn().mockReturnValue('Test GL'),
		VENDOR: 0x1f00,
		RENDERER: 0x1f01,
	};
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

	it('forgets every texture on loss and rebuilds them before any listener runs', () => {
		const canvas = mountCanvas();
		const renderer = new Renderer('game-canvas');
		const lose = jest.spyOn(renderer.textures, 'lose');
		const restore = jest.spyOn(renderer.textures, 'restore');
		const order: string[] = [];
		restore.mockImplementation(() => order.push('textures'));
		renderer.addContextListener({ restored: () => order.push('backend') });

		canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
		expect(lose).toHaveBeenCalledTimes(1);
		canvas.dispatchEvent(new Event('webglcontextrestored'));
		expect(order).toEqual(['textures', 'backend']);
	});
});

describe('Renderer device detection (R15.3)', () => {
	it('reports the backend and whatever identity the context gives', () => {
		mountCanvas();
		const renderer = new Renderer('game-canvas');
		expect(renderer.device).toEqual({
			backend: 'webgl2',
			vendor: 'Test GL',
			renderer: 'Test GL',
			features: { timerQuery: false, parallelShaderCompile: false, debugRendererInfo: false },
		});
	});
});
