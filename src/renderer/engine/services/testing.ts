import type { MountContext } from '../components/MountContext';
import type { PlatformInput } from '../input/Dispatcher';
import { NO_MODIFIERS, PointerType } from '../input/events';

/**
 * Service tests drive the dispatcher's queue the way the adapter does
 * (R9.25): one frame per input, so moves are not coalesced away.
 */
export interface TestPointerOptions {
	button?: number;
	pointerId?: number;
	pointerType?: PointerType;
}

export function pointer(phase: 'down' | 'move' | 'up', x: number, y: number, options: TestPointerOptions = {}): PlatformInput {
	const button = options.button ?? (phase === 'move' ? -1 : 0);
	return {
		kind: 'pointer',
		phase,
		x,
		y,
		pointerId: options.pointerId ?? 1,
		pointerType: options.pointerType ?? 'mouse',
		isPrimary: true,
		button,
		buttons: phase === 'down' ? (button === 2 ? 2 : 1) : 0,
		pressure: phase === 'down' ? 0.5 : 0,
		modifiers: NO_MODIFIERS,
	};
}

export function key(name: string, phase: 'down' | 'up' = 'down'): PlatformInput {
	return { kind: 'key', phase, key: name, repeat: false, modifiers: NO_MODIFIERS };
}

/** Each input in its own frame: the input phase, then an update of `frameMs`. */
export function send(context: MountContext, inputs: PlatformInput[], frameMs = 16): void {
	for (const input of inputs) {
		context.dispatcher.enqueue(input);
		context.dispatcher.dispatchPending();
		context.frame.update(frameMs / 1000);
		context.frame.layout();
	}
}

/** Frames with no input, `frameMs` apart, until `ms` have passed. */
export function advance(context: MountContext, ms: number, frameMs = 16): void {
	for (let elapsed = 0; elapsed < ms; elapsed += frameMs) {
		context.dispatcher.dispatchPending();
		context.frame.update(Math.min(frameMs, ms - elapsed) / 1000);
		context.frame.layout();
	}
}

/** A click: press and release at one point, in two frames. */
export function click(context: MountContext, x: number, y: number, options: TestPointerOptions = {}): void {
	send(context, [pointer('down', x, y, options), pointer('up', x, y, options)]);
}
