import type { Modifiers } from './events';

/** A keydown as the table sees it: the table is reached with no focused target to carry. */
export interface KeyStroke {
	readonly key: string;
	readonly repeat: boolean;
	readonly modifiers: Modifiers;
}

export type HotkeyHandler = (stroke: KeyStroke) => void;

/**
 * R9.15's hotkey table: keys handled whatever holds focus, reached after the
 * focused component and its ancestors have declined the key. It is the one
 * part of the old InputSystem that survives (its global key map).
 *
 * The dispatcher holds one, the scene's table. Each overlay root has its own
 * on its handle, searched topmost first and stopping at a modal root, before
 * the scene's (`OverlayService.keyDown`).
 */
export class HotkeyTable {
	private readonly handlers = new Map<string, HotkeyHandler>();

	/** Binds `key` (a `KeyboardEvent.key` name) to `handler`, replacing any earlier binding. */
	public register(key: string, handler: HotkeyHandler): void {
		this.handlers.set(key, handler);
	}

	public unregister(key: string): void {
		this.handlers.delete(key);
	}

	public get size(): number {
		return this.handlers.size;
	}

	public has(key: string): boolean {
		return this.handlers.has(key);
	}

	/** Runs the binding for the stroke's key; false when unbound. */
	public handle(stroke: KeyStroke): boolean {
		const handler = this.handlers.get(stroke.key);
		if (!handler) return false;
		handler(stroke);
		return true;
	}

	public clear(): void {
		this.handlers.clear();
	}
}
