/**
 * @jest-environment jsdom
 */
import { installPerfHooks, PerfApi } from './hooks';
import { FrameTimer } from '../rendering/FrameTimer';

interface PerfWindow extends Window {
	__perf?: PerfApi;
}

function perf(): PerfApi {
	const installed = (window as PerfWindow).__perf;
	if (!installed) throw new Error('window.__perf was not installed');
	return installed;
}

afterEach(() => {
	delete (window as PerfWindow).__perf;
});

describe('window.__perf.gpuTimer, R13.2\'s runtime toggle', () => {
	it('answers null on a page without a GPU timer', () => {
		installPerfHooks({ snapshot: () => new FrameTimer().snapshot() });

		expect(perf().gpuTimer()).toBeNull();
		expect(perf().gpuTimer(true)).toBeNull();
	});

	it('reads and sets the timer the page handed over', () => {
		const gpuTimer = { enabled: true };
		installPerfHooks({ snapshot: () => new FrameTimer().snapshot(), gpuTimer });

		expect(perf().gpuTimer()).toBe(true);
		expect(perf().gpuTimer(false)).toBe(false);
		expect(gpuTimer.enabled).toBe(false);
	});
});
