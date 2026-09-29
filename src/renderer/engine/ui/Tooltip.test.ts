import { Clock } from '../animation/Clock';
import { Layer } from '../components/Layer';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { createTestContext } from '../components/testing';
import { treeSnapshot } from '../debug/treeSnapshot';
import { advance, pointer, send } from '../services/testing';
import { createMeasuringDrawApi } from '../text/testing';
import { tokens } from '../theme/tokens';
import { KeyCap } from './KeyCap';
import { DEFAULT_TOOLTIP_MAX_WIDTH, Tooltip } from './Tooltip';

/**
 * R12.22's text surface and R12.29's key cap, measured with the committed
 * font metrics so the sizes are the real ones.
 */

const LONG = 'Refills every mounted weapon on the active vehicle, spends the driver\'s remaining fuel, and ends the turn at once.';

let context: MountContext;
let scene: Layer;

beforeEach(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api, viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	scene = new Layer({ id: 'scene', width: 800, height: 600 });
	scene.mount(context);
});

function mountAlone(tooltip: Tooltip): Tooltip {
	scene.addChild(tooltip);
	tooltip.layoutSubtree();
	return tooltip;
}

describe('KeyCap (R12.29)', () => {
	it('is a square for one character and grows with a longer label', () => {
		const short = new KeyCap({ label: 'R' });
		const long = new KeyCap({ label: 'Shift' });
		scene.addChild(short);
		scene.addChild(long);
		context.frame.layout();
		expect(short.width).toBe(short.height);
		expect(long.width).toBeGreaterThan(short.width);
		expect(long.width).toBe(Math.ceil(long.getChildren()[0].width) + tokens.space.space_1 * 2);
	});

	it('follows a new label', () => {
		const cap = new KeyCap({ label: 'R' });
		scene.addChild(cap);
		context.frame.layout();
		const before = cap.width;
		cap.labelText = 'Enter';
		context.frame.layout();
		expect(cap.width).toBeGreaterThan(before);
	});
});

describe('Tooltip surface (R12.22)', () => {
	it('hugs a short title and its key cap on one line', () => {
		const tooltip = mountAlone(new Tooltip({ spec: { title: 'Save', hotkey: 'S' } }));
		expect(tooltip.width).toBeGreaterThan(0);
		expect(tooltip.width).toBeLessThan(120);
		expect(tooltip.hotkey).toBe('S');
		const snapshot = treeSnapshot([scene], { width: 800, height: 600 });
		expect(JSON.stringify(snapshot)).toContain('tooltip_hotkey');
	});

	it('wraps a long description at maxWidth and grows in height instead', () => {
		const tooltip = mountAlone(new Tooltip({ spec: { title: 'Reload', description: LONG } }));
		expect(tooltip.width).toBeLessThanOrEqual(DEFAULT_TOOLTIP_MAX_WIDTH);
		expect(tooltip.width).toBeGreaterThan(DEFAULT_TOOLTIP_MAX_WIDTH - 40);
		const description = tooltip.findById('tooltip_description');
		expect(description?.height).toBeGreaterThan(tokens.fontSize.fs_sm * 2);
		expect((description?.x ?? 0) + (description?.width ?? 0)).toBeLessThanOrEqual(tooltip.width - tokens.space.space_3 + 0.5);
	});

	it('takes a narrower maxWidth from the spec', () => {
		const tooltip = mountAlone(new Tooltip({ spec: { description: LONG, maxWidth: 160 } }));
		expect(tooltip.width).toBeLessThanOrEqual(160);
	});

	it('is the service\'s surface for text content, sized before it is placed', () => {
		const owner = new Rectangle({ id: 'owner', x: 100, y: 100, width: 100, height: 40 });
		owner.tooltip = { title: 'Reload', hotkey: 'R', description: LONG };
		scene.addChild(owner);
		send(context, [pointer('move', 120, 110)]);
		advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 32);
		const surface = context.tooltips.surface;
		expect(surface).toBeInstanceOf(Tooltip);
		expect(surface?.width).toBeLessThanOrEqual(DEFAULT_TOOLTIP_MAX_WIDTH);
		expect(surface?.height).toBeGreaterThan(40);
		expect(surface?.pointerEvents).toBe('none');
	});
});
