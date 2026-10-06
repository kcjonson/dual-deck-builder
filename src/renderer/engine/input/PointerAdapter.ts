import type { Dispatcher, WheelDeltaMode } from './Dispatcher';
import type { Modifiers, PointerType } from './events';

export interface PointerAdapterOptions {
	dispatcher: Dispatcher;
	/**
	 * R7.14: logical pixels are CSS pixels divided by the UI scale. 1 until
	 * the scale setting exists (R7.5).
	 */
	uiScale?: number;
}

/** The DOM fields the adapter reads; a `MouseEvent` carrying a pointer type name lacks the pointer ones. */
type DomPointerEvent = MouseEvent & Partial<Pick<PointerEvent, 'pointerId' | 'pointerType' | 'isPrimary' | 'pressure'>>;

/**
 * The web platform's half of chapter 9: DOM Pointer Events, wheel, and keys
 * turned into the dispatcher's queue entries (R9.2), in viewport logical
 * pixels. It dispatches nothing itself; the frame loop drains the queue.
 *
 * Pointer Events carry `pointerId`, `pointerType`, `isPrimary` and
 * `pressure` for mouse, touch, and pen alike (R9.1), and already deliver
 * chorded buttons as moves (R9.30). The canvas gets `touch-action: none` so a
 * touch is a pointer rather than a page pan, `user-select: none` so a drag
 * never selects page text, and no browser context menu; detach restores both
 * styles. It captures each pressed pointer at the DOM level so a release
 * outside the canvas still arrives.
 * Keys are read on `window`, where a key event ends up wherever focus is.
 */
export class PointerAdapter {
	private readonly dispatcher: Dispatcher;
	private readonly uiScale: number;
	private canvas: HTMLCanvasElement | null = null;
	private previousTouchAction = '';
	private previousUserSelect = '';

	constructor({ dispatcher, uiScale = 1 }: PointerAdapterOptions) {
		this.dispatcher = dispatcher;
		this.uiScale = uiScale;
	}

	public attach(canvas: HTMLCanvasElement): void {
		if (this.canvas) this.detach();
		this.canvas = canvas;
		this.previousTouchAction = canvas.style.touchAction ?? '';
		canvas.style.touchAction = 'none';
		this.previousUserSelect = canvas.style.userSelect ?? '';
		canvas.style.userSelect = 'none';
		canvas.addEventListener('contextmenu', this.handleContextMenu);
		canvas.addEventListener('pointerdown', this.handlePointerDown);
		canvas.addEventListener('pointermove', this.handlePointerMove);
		canvas.addEventListener('pointerup', this.handlePointerUp);
		canvas.addEventListener('pointercancel', this.handlePointerCancel);
		canvas.addEventListener('pointerleave', this.handlePointerLeave);
		canvas.addEventListener('wheel', this.handleWheel, { passive: false });
		window.addEventListener('keydown', this.handleKeyDown);
		window.addEventListener('keyup', this.handleKeyUp);
		window.addEventListener('blur', this.handleBlur);
	}

	public detach(): void {
		const canvas = this.canvas;
		if (!canvas) return;
		canvas.style.touchAction = this.previousTouchAction;
		canvas.style.userSelect = this.previousUserSelect;
		canvas.removeEventListener('contextmenu', this.handleContextMenu);
		canvas.removeEventListener('pointerdown', this.handlePointerDown);
		canvas.removeEventListener('pointermove', this.handlePointerMove);
		canvas.removeEventListener('pointerup', this.handlePointerUp);
		canvas.removeEventListener('pointercancel', this.handlePointerCancel);
		canvas.removeEventListener('pointerleave', this.handlePointerLeave);
		canvas.removeEventListener('wheel', this.handleWheel);
		window.removeEventListener('keydown', this.handleKeyDown);
		window.removeEventListener('keyup', this.handleKeyUp);
		window.removeEventListener('blur', this.handleBlur);
		this.canvas = null;
	}

	private handleContextMenu = (event: Event): void => {
		// R15.39: the dispatcher synthesises its own contextmenu from a secondary
		// press, so the browser's menu never opens over the game.
		event.preventDefault();
	};

	private handlePointerDown = (event: DomPointerEvent): void => {
		this.enqueuePointer(event, 'down');
		// Keeps the rest of the gesture on the canvas when it leaves the
		// element. Synthetic events have no active pointer to capture.
		try {
			this.canvas?.setPointerCapture?.(event.pointerId ?? 1);
		} catch {
			// Not an active pointer (an injected event): nothing to capture.
		}
	};

	private handlePointerMove = (event: DomPointerEvent): void => {
		this.enqueuePointer(event, 'move');
	};

	private handlePointerUp = (event: DomPointerEvent): void => {
		this.enqueuePointer(event, 'up');
	};

	private handlePointerCancel = (event: DomPointerEvent): void => {
		this.enqueuePointer(event, 'cancel');
	};

	private handlePointerLeave = (event: DomPointerEvent): void => {
		this.dispatcher.enqueue({ kind: 'leave', pointerId: event.pointerId ?? 1 });
	};

	private handleWheel = (event: WheelEvent): void => {
		// The page never scrolls under the game.
		event.preventDefault();
		const { x, y } = this.toLogical(event);
		this.dispatcher.enqueue({
			kind: 'wheel',
			x,
			y,
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			deltaMode: event.deltaMode as WheelDeltaMode,
			modifiers: modifiersOf(event),
		});
	};

	private handleKeyDown = (event: KeyboardEvent): void => {
		this.enqueueKey(event, 'down');
	};

	private handleKeyUp = (event: KeyboardEvent): void => {
		this.enqueueKey(event, 'up');
	};

	private handleBlur = (): void => {
		this.dispatcher.enqueue({ kind: 'blur' });
	};

	private enqueueKey(event: KeyboardEvent, phase: 'down' | 'up'): void {
		if (this.dispatcher.paused) return;
		// R15.39: an input method owns a keydown while it composes. Delivered,
		// Safari's (the typed letter, keyCode 229) would insert raw letters and a
		// committing Enter or Backspace would submit or delete. Keyups still go,
		// so nothing waits on a release that never arrives.
		if (phase === 'down' && isComposition(event)) return;
		// Dispatch waits for the frame, so the default is prevented on whether
		// the key would be handled now: a hotkey binding or a focused field.
		if (this.dispatcher.claimsKey(event.key, modifiersOf(event))) event.preventDefault();
		this.dispatcher.enqueue({
			kind: 'key',
			phase,
			key: event.key,
			repeat: event.repeat,
			modifiers: modifiersOf(event),
		});
	}

	private enqueuePointer(event: DomPointerEvent, phase: 'down' | 'move' | 'up' | 'cancel'): void {
		const { x, y } = this.toLogical(event);
		const buttons = event.buttons ?? 0;
		this.dispatcher.enqueue({
			kind: 'pointer',
			phase,
			x,
			y,
			pointerId: event.pointerId ?? 1,
			pointerType: pointerTypeOf(event.pointerType),
			isPrimary: event.isPrimary ?? true,
			button: event.button,
			buttons,
			// R9.1: a platform without pressure reports 0.5 while pressed.
			pressure: event.pressure ?? (buttons !== 0 ? 0.5 : 0),
			modifiers: modifiersOf(event),
		});
	}

	/** CSS pixels relative to the canvas, divided by the UI scale (R7.14). */
	private toLogical(event: MouseEvent): { x: number; y: number } {
		const rect = this.canvas?.getBoundingClientRect();
		const left = rect?.left ?? 0;
		const top = rect?.top ?? 0;
		return { x: (event.clientX - left) / this.uiScale, y: (event.clientY - top) / this.uiScale };
	}
}

/** Chrome names the key `Process`; every browser flags `isComposing` or the legacy keyCode 229. */
function isComposition(event: KeyboardEvent): boolean {
	return event.isComposing || event.keyCode === 229 || event.key === 'Process';
}

function pointerTypeOf(type: string | undefined): PointerType {
	return type === 'touch' || type === 'pen' ? type : 'mouse';
}

function modifiersOf(event: MouseEvent | KeyboardEvent): Modifiers {
	return { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey };
}
