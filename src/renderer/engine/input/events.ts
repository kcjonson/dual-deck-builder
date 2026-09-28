import type { Vec2 } from '../draw/geometry';
import type { Component } from '../components/Component';

/** R9.1. `virtual` is the controller's free cursor and the injection API's default is `mouse`. */
export type PointerType = 'mouse' | 'touch' | 'pen' | 'virtual';

export interface Modifiers {
	readonly shift: boolean;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly meta: boolean;
}

export const NO_MODIFIERS: Modifiers = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false });

export type PointerEventType =
	| 'pointerdown'
	| 'pointerup'
	| 'pointermove'
	| 'pointerenter'
	| 'pointerleave'
	| 'pointercancel'
	| 'click'
	| 'contextmenu'
	| 'lostpointercapture';

export type KeyEventType = 'keydown' | 'keyup';

/** R9.22: delivered to the one component whose focus changed, never bubbling. */
export type FocusEventType = 'focus' | 'blur';

/** R9.27's abstract actions: confirm and back, whatever produced them. */
export type ActionEventType = 'activate' | 'cancel';

export type UiEventType = PointerEventType | 'wheel' | KeyEventType | FocusEventType | ActionEventType;

/**
 * R9.1's common fields. `target` is where dispatch started; `currentTarget`
 * is the component whose `handleEvent` is running, which moves as the event
 * bubbles (R9.6). `consume()` stops the bubble (R8.25).
 */
export abstract class UiEvent {
	public abstract readonly type: UiEventType;
	public readonly timestamp: number;
	public readonly target: Component;
	public currentTarget: Component;
	private isConsumed = false;

	constructor({ timestamp, target }: { timestamp: number; target: Component }) {
		this.timestamp = timestamp;
		this.target = target;
		this.currentTarget = target;
	}

	public get consumed(): boolean {
		return this.isConsumed;
	}

	public consume(): void {
		this.isConsumed = true;
	}
}

export interface PointerEventInit {
	type: PointerEventType;
	timestamp: number;
	target: Component;
	screen: Vec2;
	pointerId: number;
	pointerType: PointerType;
	isPrimary: boolean;
	pressure: number;
	button: number;
	buttons: number;
	modifiers: Modifiers;
	/** Positions a coalesced move skipped, oldest first (R9.2). */
	coalesced?: readonly Vec2[];
	/** The dispatcher's half of `capturePointer`; absent on events that cannot capture. */
	capture?: (component: Component) => void;
}

/**
 * R9.1's pointer event. The position is in viewport logical pixels; `local`
 * is the same point in `currentTarget`'s content box, through every inverse
 * transform and content offset above it, so it follows the bubble.
 */
export class UiPointerEvent extends UiEvent {
	public readonly type: PointerEventType;
	public readonly screen: Vec2;
	public readonly pointerId: number;
	public readonly pointerType: PointerType;
	public readonly isPrimary: boolean;
	public readonly pressure: number;
	public readonly button: number;
	public readonly buttons: number;
	public readonly modifiers: Modifiers;
	public readonly coalesced: readonly Vec2[];
	private readonly captureHook: ((component: Component) => void) | null;
	private focusPrevented = false;

	constructor(init: PointerEventInit) {
		super(init);
		this.type = init.type;
		this.screen = init.screen;
		this.pointerId = init.pointerId;
		this.pointerType = init.pointerType;
		this.isPrimary = init.isPrimary;
		this.pressure = init.pressure;
		this.button = init.button;
		this.buttons = init.buttons;
		this.modifiers = init.modifiers;
		this.coalesced = init.coalesced ?? [];
		this.captureHook = init.capture ?? null;
	}

	/** The pointer in `currentTarget`'s content box; null under a collapsed transform. */
	public get local(): Vec2 | null {
		return this.currentTarget.screenToLocal(this.screen);
	}

	/**
	 * R9.10: route every later event of this pointer to `currentTarget` until
	 * release, the pointer's `pointerup`, or a cancel. Only a `pointerdown`
	 * handler can capture; elsewhere this does nothing.
	 */
	public capturePointer(): void {
		this.captureHook?.(this.currentTarget);
	}

	/**
	 * R9.23: a `pointerdown` handler that owns the press (a scrollbar, a drag
	 * handle) leaves focus where it is instead of moving it to the pressed
	 * component or clearing it.
	 */
	public preventFocus(): void {
		this.focusPrevented = true;
	}

	public get isFocusPrevented(): boolean {
		return this.focusPrevented;
	}
}

export interface WheelEventInit extends Omit<PointerEventInit, 'type' | 'capture'> {
	/** Logical pixels per axis, already normalised (R9.3). */
	deltaX: number;
	deltaY: number;
}

/** R9.3 and R9.32: deltas in logical pixels, used directly as scroll distances. */
export class UiWheelEvent extends UiEvent {
	public readonly type = 'wheel' as const;
	public readonly screen: Vec2;
	public readonly deltaX: number;
	public readonly deltaY: number;
	public readonly pointerId: number;
	public readonly pointerType: PointerType;
	public readonly modifiers: Modifiers;

	constructor(init: WheelEventInit) {
		super(init);
		this.screen = init.screen;
		this.deltaX = init.deltaX;
		this.deltaY = init.deltaY;
		this.pointerId = init.pointerId;
		this.pointerType = init.pointerType;
		this.modifiers = init.modifiers;
	}

	public get local(): Vec2 | null {
		return this.currentTarget.screenToLocal(this.screen);
	}
}

export interface KeyEventInit {
	type: KeyEventType;
	timestamp: number;
	target: Component;
	key: string;
	repeat: boolean;
	modifiers: Modifiers;
}

/** R9.1's keyboard event: the key name as the platform reports it, and `repeat`. */
export class UiKeyEvent extends UiEvent {
	public readonly type: KeyEventType;
	public readonly key: string;
	public readonly repeat: boolean;
	public readonly modifiers: Modifiers;

	constructor(init: KeyEventInit) {
		super(init);
		this.type = init.type;
		this.key = init.key;
		this.repeat = init.repeat;
		this.modifiers = init.modifiers;
	}
}

export interface FocusEventInit {
	type: FocusEventType;
	timestamp: number;
	target: Component;
	/** The component losing focus on a `focus`, gaining it on a `blur`; null when there is none. */
	relatedTarget: Component | null;
	/** Whether the ring shows for this focus (R9.23); false on every `blur`. */
	focusVisible: boolean;
}

/** R9.22: `blur` on the component losing focus, then `focus` on the one gaining it. */
export class UiFocusEvent extends UiEvent {
	public readonly type: FocusEventType;
	public readonly relatedTarget: Component | null;
	public readonly focusVisible: boolean;

	constructor(init: FocusEventInit) {
		super(init);
		this.type = init.type;
		this.relatedTarget = init.relatedTarget;
		this.focusVisible = init.focusVisible;
	}
}

/** Where an action came from; components treat them all alike (R9.27). */
export type ActionSource = 'keyboard' | 'controller' | 'injection';

export interface ActionEventInit {
	type: ActionEventType;
	timestamp: number;
	target: Component;
	source: ActionSource;
}

/**
 * R9.27: `activate` from the first Enter or Space of a press, `cancel` from
 * Escape. Delivered to the focused component and bubbling, so a component
 * handles confirm and back instead of checking key names. A held key never
 * repeats an `activate`.
 */
export class UiActionEvent extends UiEvent {
	public readonly type: ActionEventType;
	public readonly source: ActionSource;

	constructor(init: ActionEventInit) {
		super(init);
		this.type = init.type;
		this.source = init.source;
	}
}

export type AnyUiEvent = UiPointerEvent | UiWheelEvent | UiKeyEvent | UiFocusEvent | UiActionEvent;
