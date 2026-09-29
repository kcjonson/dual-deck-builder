import { Clock } from '../animation/Clock';
import { Layer } from '../components/Layer';
import type { MountContext } from '../components/MountContext';
import { createTestContext } from '../components/testing';
import { advance, click, key, send } from '../services/testing';
import { tokens } from '../theme/tokens';
import { Button } from './Button';
import { Popover } from './Popover';
import { Rectangle } from '../components/Rectangle';
import { ScreenTransition } from './ScreenTransition';

/** R12.38 and R8.22: fade out, swap, one layout, fade in, input blocked throughout. */

const FADE_MS = tokens.motion.dur + 32;

let context: MountContext;
let scene: Layer;
let clicks: number;
let transition: ScreenTransition;

function mountScene(id: string): Layer {
	const layer = new Layer({ id, width: 800, height: 600 });
	layer.addChild(new Button('Go', { id: `${id}_go`, x: 20, y: 20, width: 100, height: 40, onClick: () => { clicks += 1; } }));
	layer.mount(context);
	return layer;
}

beforeEach(() => {
	context = createTestContext({ viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	clicks = 0;
	scene = mountScene('menu');
	context.frame.layout();
	transition = new ScreenTransition();
});

/** What ScreenManager.navigate does inside the swap: out with the old, close overlays, in with the new. */
function navigate(to: string): () => void {
	return () => {
		scene.unmount();
		context.popups.close();
		context.overlays.closeAll();
		scene = mountScene(to);
	};
}

describe('ScreenTransition (R12.38)', () => {
	it('fades out, swaps once, lays out, fades in, and settles its promise', async () => {
		let swaps = 0;
		let settled = false;
		const done = transition.run(context, () => {
			swaps += 1;
			navigate('combat')();
		});
		void done.then(() => { settled = true; });
		expect(transition.phase).toBe('out');
		expect(transition.overlay?.layer).toBe('transition');

		advance(context, tokens.motion.dur / 2);
		expect(transition.progress).toBeGreaterThan(0);
		expect(swaps).toBe(0);

		advance(context, tokens.motion.dur / 2 + 32);
		expect(swaps).toBe(1);
		expect(transition.phase).toBe('in');
		expect(scene.id).toBe('combat');

		advance(context, FADE_MS);
		await done;
		expect(settled).toBe(true);
		expect(transition.phase).toBe('idle');
		expect(context.overlays.roots).toHaveLength(0);
		expect(swaps).toBe(1);
	});

	it('blocks presses from its first frame and keeps scene hotkeys quiet', () => {
		const heard: string[] = [];
		context.dispatcher.hotkeys.register('h', () => {
			heard.push('scene');
			return true;
		});
		void transition.run(context, navigate('combat'));
		expect(transition.progress).toBe(0);
		click(context, 70, 40);
		send(context, [key('h')]);
		expect(clicks).toBe(0);
		expect(heard).toEqual([]);
	});

	it('survives the closeAll a scene change runs, while what the old scene opened does not', () => {
		const popover = new Popover({ content: new Rectangle({ width: 50, height: 50 }), anchor: { x: 200, y: 200 } });
		popover.show(context);
		void transition.run(context, navigate('combat'));
		advance(context, FADE_MS);
		expect(popover.isOpen).toBe(false);
		expect(transition.overlay?.isOpen).toBe(true);
		expect(transition.phase).toBe('in');
	});

	it('takes the newest swap while fading out', () => {
		const ran: string[] = [];
		void transition.run(context, () => ran.push('first'));
		advance(context, tokens.motion.dur / 2);
		void transition.run(context, () => ran.push('second'));
		advance(context, FADE_MS * 2);
		expect(ran).toEqual(['second']);
		expect(transition.phase).toBe('idle');
	});

	it('heads back out from where it is when asked again while fading in', () => {
		const ran: string[] = [];
		void transition.run(context, () => ran.push('first'));
		advance(context, FADE_MS + tokens.motion.dur / 2);
		expect(transition.phase).toBe('in');
		const reached = transition.progress;
		void transition.run(context, () => ran.push('second'));
		expect(transition.phase).toBe('out');
		advance(context, 16);
		expect(transition.progress).toBeGreaterThan(reached);
		advance(context, FADE_MS * 2);
		expect(ran).toEqual(['first', 'second']);
		expect(transition.phase).toBe('idle');
	});

	it('runs the whole sequence at once under reduced motion or the harness\'s settle', () => {
		const ran: string[] = [];
		void transition.run(context, () => ran.push('swap'));
		expect(context.animator.settle()).toBeGreaterThan(0);
		expect(ran).toEqual(['swap']);
		expect(transition.phase).toBe('idle');

		context.animator.reducedMotion = true;
		void transition.run(context, () => ran.push('again'));
		advance(context, 48);
		expect(ran).toEqual(['swap', 'again']);
		expect(transition.phase).toBe('idle');
	});

	it('ends uncovered and released when the swap throws, rejecting the run and logging', async () => {
		const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		const failure = new Error('screen constructor threw');
		const done = transition.run(context, () => {
			throw failure;
		});
		advance(context, FADE_MS);
		expect(transition.phase).toBe('idle');
		expect(transition.progress).toBe(0);
		expect(context.overlays.roots).toHaveLength(0);
		await expect(done).rejects.toBe(failure);
		expect(logged).toHaveBeenCalled();
		click(context, 70, 40);
		expect(clicks).toBe(1);

		// And the next run works as normal.
		const ran: string[] = [];
		const next = transition.run(context, () => ran.push('next'));
		advance(context, FADE_MS * 2);
		await next;
		expect(ran).toEqual(['next']);
		logged.mockRestore();
	});

	it('runs a run queued from inside the swap straight after it, still covered', async () => {
		const ran: string[] = [];
		const first = transition.run(context, () => {
			ran.push('first');
			void transition.run(context, () => ran.push('redirect'));
		});
		advance(context, FADE_MS);
		expect(ran).toEqual(['first', 'redirect']);
		expect(transition.phase).toBe('in');
		advance(context, FADE_MS);
		await first;
		expect(transition.phase).toBe('idle');
	});

	it('gives up on a swap that keeps queueing itself', async () => {
		const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		const loop = (): void => {
			void transition.run(context, loop);
		};
		const done = transition.run(context, loop);
		advance(context, FADE_MS);
		await expect(done).rejects.toThrow(/keeps redirecting/);
		expect(transition.phase).toBe('idle');
		logged.mockRestore();
	});

	it('keeps keys from the incoming scene until it is done, then focuses what the scene asked for', () => {
		let pressed = 0;
		void transition.run(context, () => {
			navigate('combat')();
			const go = scene.findById('combat_go') as Button;
			go.onClick = () => { pressed += 1; };
			context.focus.focus(go, 'keyboard');
		});
		advance(context, FADE_MS);
		expect(transition.phase).toBe('in');
		expect(context.focus.focused).toBeNull();
		send(context, [key('Enter')]);
		expect(pressed).toBe(0);
		advance(context, FADE_MS);
		expect(transition.phase).toBe('idle');
		expect(context.focus.focused?.id).toBe('combat_go');
		send(context, [key('Enter')]);
		expect(pressed).toBe(1);
	});
});
