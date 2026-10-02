import { Clock } from '../animation/Clock';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { Rectangle } from '../components/Rectangle';
import { createTestContext } from '../components/testing';
import { tokens } from '../theme/tokens';
import { advance, key, pointer, send } from './testing';

const DELAY = tokens.control.tooltip_delay;

let context: MountContext;
let scene: Container;
let save: Rectangle;
let load: Rectangle;

beforeEach(() => {
	context = createTestContext({ viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	scene = new Container({ id: 'scene', width: 800, height: 600 });
	save = new Rectangle({ id: 'save', x: 100, y: 100, width: 100, height: 40 });
	save.tooltip = { title: 'Save', description: 'Writes the run to disk' };
	load = new Rectangle({ id: 'load', x: 300, y: 100, width: 100, height: 40 });
	load.tooltip = 'Load';
	scene.addChild(save);
	scene.addChild(load);
	scene.mount(context);
});

/**
 * DDB-137: section 5's "pins it open so you can read while looking at the
 * road", on the tooltip service the card detail view is shown through.
 */
describe('TooltipService pinning', () => {
	it('keeps a pinned tooltip through the pointer leaving, a press elsewhere, and focus moving', () => {
		context.tooltips.pin(save);
		expect(context.tooltips.pinned).toBe(save);
		const surface = context.tooltips.surface;
		expect(surface).not.toBeNull();

		send(context, [pointer('move', 320, 110), pointer('move', 700, 500)]);
		send(context, [pointer('down', 700, 500), pointer('up', 700, 500)]);
		context.tooltips.focusVisibleChange(load);
		advance(context, DELAY + tokens.motion.dur_tooltip_hide + 32);
		expect(context.tooltips.surface).toBe(surface);
		expect(context.tooltips.owner).toBe(save);
	});

	it('lets go on unpin, on Escape, and on hide', () => {
		context.tooltips.pin(save);
		context.tooltips.unpin();
		expect(context.tooltips.pinned).toBeNull();
		advance(context, tokens.motion.dur_tooltip_hide + 32);
		expect(context.tooltips.state).toBe('idle');

		context.tooltips.pin(save);
		send(context, [key('Escape')]);
		expect(context.tooltips.pinned).toBeNull();
		expect(context.tooltips.surface).toBeNull();

		context.tooltips.pin(load);
		context.tooltips.hide();
		expect(context.tooltips.pinned).toBeNull();
	});

	it('builds the content again on pin, without a fade when one was showing, so it can say it is pinned', () => {
		let builds = 0;
		save.tooltip = { factory: () => { builds++; return new Rectangle({ width: 40, height: 20 }); } };
		context.tooltips.show(save, { fade: false });
		expect(builds).toBe(1);
		context.tooltips.pin(save);
		expect(builds).toBe(2);
		expect(context.tooltips.state).toBe('visible');
		expect(context.tooltips.surface?.opacity).toBe(1);
	});

	it('fades in when nothing was showing, unless asked not to', () => {
		context.tooltips.pin(save);
		expect(context.tooltips.state).toBe('showing');
		context.tooltips.hide();
		advance(context, tokens.motion.dur_tooltip_hide + 32);
		context.tooltips.pin(save, { fade: false });
		expect(context.tooltips.state).toBe('visible');
	});

	it('pins another owner in place of the first', () => {
		context.tooltips.pin(save);
		context.tooltips.pin(load);
		expect(context.tooltips.pinned).toBe(load);
		expect(context.tooltips.owner).toBe(load);
	});

	it('drops the pin when its owner unmounts', () => {
		context.tooltips.pin(save);
		scene.removeChild(save);
		advance(context, 32);
		expect(context.tooltips.pinned).toBeNull();
		expect(context.tooltips.surface).toBeNull();
	});

	it('keeps a pinnable tooltip showing through a secondary press on its owner, for the pin on release', () => {
		save.tooltip = { title: 'Save', pinnable: true };
		send(context, [pointer('move', 120, 110)]);
		advance(context, DELAY + tokens.motion.dur_fast + 32);
		const surface = context.tooltips.surface;
		expect(surface).not.toBeNull();
		send(context, [pointer('down', 120, 110, { button: 2 })]);
		expect(context.tooltips.surface).toBe(surface);

		// One that isn't pinnable hides on any press, as before
		send(context, [pointer('up', 120, 110, { button: 2 }), pointer('move', 320, 110)]);
		advance(context, tokens.motion.dur_fast + 32);
		expect(context.tooltips.owner).toBe(load);
		send(context, [pointer('down', 320, 110, { button: 2 })]);
		expect(context.tooltips.surface).toBeNull();
	});
});
