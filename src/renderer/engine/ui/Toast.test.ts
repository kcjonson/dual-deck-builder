import { Clock } from '../animation/Clock';
import { Container } from '../components/Container';
import type { MountContext } from '../components/MountContext';
import { createTestContext } from '../components/testing';
import { advance, click, pointer, send } from '../services/testing';
import { tokens } from '../theme/tokens';
import { TOAST_SLIDE, TOAST_WIDTH, Toast, ToastDismissReason, ToastOptions, ToastStack } from './Toast';

/** R12.23's toast lifecycle and stack, on the overlay service and the frame clock. */

const APPEAR_MS = tokens.motion.dur + 32;
const DISMISS_MS = tokens.motion.dur_slow + 32;
const MARGIN = tokens.space.space_4;

let context: MountContext;
let scene: Container;
let stack: ToastStack;

beforeEach(() => {
	context = createTestContext({ viewport: { logical: { width: 800, height: 600 } }, clock: new Clock() });
	scene = new Container({ id: 'scene', width: 800, height: 600 });
	scene.mount(context);
	stack = new ToastStack();
	stack.attach(context);
	context.frame.layout();
});

function push(options: Partial<ToastOptions> = {}): Toast {
	const toast = stack.push({ title: 'Fuel low', message: 'The lead vehicle has two turns of fuel left.', ...options });
	context.frame.layout();
	return toast;
}

function centre(toast: Toast): [number, number] {
	const box = toast.screenBounds;
	return [box.x + box.width / 2, box.y + box.height / 2];
}

describe('Toast lifecycle (R12.23)', () => {
	it('appears over dur, sliding in from the corner\'s edge, then is visible', () => {
		const toast = push();
		expect(toast.state).toBe('appearing');
		advance(context, tokens.motion.dur / 2);
		expect(toast.opacity).toBeGreaterThan(0);
		expect(toast.opacity).toBeLessThan(1);
		expect(toast.transform.translate[0]).toBeGreaterThan(0);
		expect(toast.transform.translate[0]).toBeLessThan(TOAST_SLIDE);
		advance(context, APPEAR_MS);
		expect(toast.state).toBe('visible');
		expect(toast.opacity).toBe(1);
		expect(toast.transform.translate[0]).toBe(0);
	});

	it('dismisses itself after autoDismiss seconds, fades over dur_slow, and reports once', () => {
		const reasons: ToastDismissReason[] = [];
		const toast = push({ autoDismiss: 1, onDismiss: (reason) => reasons.push(reason) });
		advance(context, APPEAR_MS + 900);
		expect(toast.state).toBe('visible');
		advance(context, 200);
		expect(toast.state).toBe('dismissing');
		advance(context, DISMISS_MS);
		expect(toast.state).toBe('finished');
		expect(toast.parent).toBeNull();
		expect(reasons).toEqual(['timeout']);
	});

	it('pauses the countdown while hovered', () => {
		const toast = push({ autoDismiss: 1 });
		advance(context, APPEAR_MS);
		send(context, [pointer('move', ...centre(toast))]);
		advance(context, 3000);
		expect(toast.state).toBe('visible');
		send(context, [pointer('move', 20, 500)]);
		advance(context, 1100);
		expect(toast.state).toBe('dismissing');
	});

	it('stays until dismissed when autoDismiss is 0', () => {
		const toast = push({ autoDismiss: 0 });
		advance(context, 60000);
		expect(toast.state).toBe('visible');
		expect(toast.remaining).toBe(Infinity);
	});

	it('dismisses from its X without firing onClick', () => {
		const clicks: number[] = [];
		const reasons: ToastDismissReason[] = [];
		const toast = push({ onClick: () => clicks.push(1), onDismiss: (reason) => reasons.push(reason) });
		advance(context, APPEAR_MS);
		const close = toast.closeControl.screenBounds;
		click(context, close.x + close.width / 2, close.y + close.height / 2);
		expect(toast.state).toBe('dismissing');
		advance(context, DISMISS_MS);
		expect(clicks).toEqual([]);
		expect(reasons).toEqual(['close']);
	});

	it('fires onClick on a click anywhere else on it, then dismisses', () => {
		const clicks: number[] = [];
		const reasons: ToastDismissReason[] = [];
		const toast = push({ onClick: () => clicks.push(1), onDismiss: (reason) => reasons.push(reason) });
		advance(context, APPEAR_MS);
		click(context, toast.screenBounds.x + 30, toast.screenBounds.y + 12);
		expect(clicks).toEqual([1]);
		advance(context, DISMISS_MS);
		expect(reasons).toEqual(['click']);
	});

	it('ignores a second dismiss while fading', () => {
		const reasons: ToastDismissReason[] = [];
		const toast = push({ onDismiss: (reason) => reasons.push(reason) });
		toast.dismiss();
		toast.dismiss('close');
		advance(context, DISMISS_MS);
		expect(reasons).toEqual(['programmatic']);
	});
});

describe('ToastStack (R12.23)', () => {
	it('is an overlay root in the toast layer, invisible while empty', () => {
		expect(stack.overlay?.layer).toBe('toast');
		expect(stack.visible).toBe(false);
		const toast = push();
		expect(stack.visible).toBe(true);
		toast.dismiss();
		advance(context, DISMISS_MS);
		expect(stack.visible).toBe(false);
	});

	it('sits in its corner, the newest toast nearest it, and reports their envelope as its bounds', () => {
		const first = push({ title: 'First' });
		const second = push({ title: 'Second' });
		advance(context, APPEAR_MS);
		expect(second.screenBounds.y).toBeLessThan(first.screenBounds.y);
		expect(stack.screenBounds.x + stack.width).toBe(800 - MARGIN);
		expect(stack.screenBounds.y).toBe(MARGIN);
		expect(stack.width).toBe(TOAST_WIDTH);
		expect(stack.height).toBe(first.height + second.height + tokens.space.space_2);
	});

	it('grows upward from a bottom corner with the newest at the bottom, and slides from the left on the left', () => {
		stack.corner = 'bottomLeft';
		const first = push({ title: 'First' });
		const second = push({ title: 'Second' });
		expect(second.transform.translate[0]).toBeLessThan(0);
		advance(context, APPEAR_MS);
		expect(second.screenBounds.y).toBeGreaterThan(first.screenBounds.y);
		expect(stack.screenBounds.x).toBe(MARGIN);
		expect(stack.screenBounds.y + stack.height).toBe(600 - MARGIN);
	});

	it('moves and re-orders its toasts when the corner changes', () => {
		const first = push({ title: 'First' });
		const second = push({ title: 'Second' });
		stack.corner = 'bottomRight';
		context.frame.layout();
		expect(second.screenBounds.y).toBeGreaterThan(first.screenBounds.y);
		expect(stack.screenBounds.y + stack.height).toBe(600 - MARGIN);
	});

	it('paints oldest first and so hits newest first, from any corner', () => {
		const first = push({ title: 'First' });
		const second = push({ title: 'Second' });
		expect(stack.renderOrder).toEqual([first, second]);
		stack.corner = 'bottomLeft';
		expect(stack.renderOrder).toEqual([first, second]);
		expect(stack.toasts).toEqual([first, second]);
	});

	it('dismisses the oldest live toast past its capacity', () => {
		const reasons: string[] = [];
		const toasts = [1, 2, 3, 4].map((index) => push({ title: `Toast ${index}`, onDismiss: (reason) => reasons.push(`${index}:${reason}`) }));
		expect(toasts.every((toast) => toast.live)).toBe(true);
		const fifth = push({ title: 'Toast 5' });
		expect(toasts[0].state).toBe('dismissing');
		expect(fifth.live).toBe(true);
		advance(context, DISMISS_MS);
		expect(reasons).toEqual(['1:capacity']);
		expect(stack.toasts).toHaveLength(4);
	});

	it('counts live toasts by severity', () => {
		push({ severity: 'info' });
		push({ severity: 'critical' });
		const warning = push({ severity: 'warning' });
		push({ severity: 'critical' });
		warning.dismiss();
		expect(stack.counts).toEqual({ info: 1, warning: 0, critical: 2 });
	});

	it('closes up once a toast has faded, not while it fades', () => {
		const first = push({ title: 'First' });
		const second = push({ title: 'Second' });
		advance(context, APPEAR_MS);
		const firstY = first.screenBounds.y;
		second.dismiss();
		advance(context, tokens.motion.dur_slow / 2);
		expect(first.screenBounds.y).toBe(firstY);
		advance(context, DISMISS_MS);
		expect(first.screenBounds.y).toBe(MARGIN);
	});

	it('detaches, taking its toasts with it', () => {
		push();
		stack.detach();
		expect(context.overlays.roots).toHaveLength(0);
		expect(stack.overlay).toBeNull();
	});
});
