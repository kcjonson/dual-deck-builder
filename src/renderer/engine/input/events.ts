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

/** R9.12's drag events, synthesised by the drag service. */
export type DragEventType = 'dragenter' | 'dragover' | 'dragleave' | 'drop' | 'dragend';

export type UiEventType = PointerEventType | 'wheel' | KeyEventType | DragEventType;

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

export interface DragEventInit {
	type: DragEventType;
	timestamp: number;
	target: Component;
	screen: Vec2;
	/** The component the drag started from (R9.12a). */
	source: Component;
	/** What `drag.start` was given, handed to every target. */
	data: unknown;
	pointerId: number;
	pointerType: PointerType;
	/** `dragend` only: whether an accepting target took the drop (R9.12c). */
	dropped?: boolean;
	/** `dragend` only: the component that accepted the drop, null when nothing did. */
	dropTarget?: Component | null;
}

/**
 * R9.12's drag event. `dragenter`, `dragover`, `dragleave` and `drop` go to
 * the component under the pointer with the ghost excluded and bubble;
 * `dragend` goes to the source. A component takes the drop by calling
 * `accept()` while a `dragenter` or `dragover` passes through it (R9.12c).
 */
export class UiDragEvent extends UiEvent {
	public readonly type: DragEventType;
	public readonly screen: Vec2;
	public readonly source: Component;
	public readonly data: unknown;
	public readonly pointerId: number;
	public readonly pointerType: PointerType;
	public readonly dropped: boolean;
	public readonly dropTarget: Component | null;
	private acceptingComponent: Component | null = null;

	constructor(init: DragEventInit) {
		super(init);
		this.type = init.type;
		this.screen = init.screen;
		this.source = init.source;
		this.data = init.data;
		this.pointerId = init.pointerId;
		this.pointerType = init.pointerType;
		this.dropped = init.dropped ?? false;
		this.dropTarget = init.dropTarget ?? null;
	}

	public get local(): Vec2 | null {
		return this.currentTarget.screenToLocal(this.screen);
	}

	/**
	 * R9.12c: `currentTarget` will take the drop. Only a `dragenter` or
	 * `dragover` can accept, and the innermost component to accept wins; it
	 * shows `dropActive` until the pointer leaves it or the drag ends.
	 */
	public accept(): void {
		if (this.type !== 'dragenter' && this.type !== 'dragover') return;
		if (this.acceptingComponent === null) this.acceptingComponent = this.currentTarget;
	}

	/** The component that called `accept()`, or null. */
	public get acceptedBy(): Component | null {
		return this.acceptingComponent;
	}
}

export type AnyUiEvent = UiPointerEvent | UiWheelEvent | UiKeyEvent | UiDragEvent;
