import type { Component } from '../components/Component';
import { Layer } from '../components/Layer';
import type { MountContext, ViewportSource } from '../components/MountContext';
import { renderTree } from '../components/renderTree';
import type { DrawApi } from '../draw/DrawApi';
import { LayerName, layerOrdinal } from '../draw/layers';
import type { InputObserver, PointerPress } from '../input/Dispatcher';
import type { HotkeyTable, KeyStroke } from '../input/HotkeyTable';

export type OverlayDismissReason = 'outside-press' | 'escape';

export interface OverlayOptions {
	/** The layer the root paints and is hit-tested in (R3.5, R3.9). */
	layer: LayerName;
	/**
	 * A modal root is the root's `modal` (hotkeys of roots beneath it and the
	 * scene's never fire, R9.15), traps focus in a scope (R9.20), consumes an
	 * outside press, and closes exclusive popups when it opens (R3.6a).
	 * Defaults to true in the `modal` layer.
	 */
	modal?: boolean;
	/** A press outside `inside` dismisses it (R12.21, R12.33). */
	dismissOnOutsidePress?: boolean;
	/**
	 * The surface a press has to land in to count as inside: the dialog panel
	 * of content that also holds a full-viewport scrim, so a press on the
	 * scrim is outside (R12.21). The content or a descendant of it; defaults
	 * to the content.
	 */
	inside?: Component;
	/** The dismissing press stops there. Defaults to `modal`: non-modal overlays never consume (R9.13). */
	consumeOutsidePress?: boolean;
	/** Escape dismisses it, topmost first (R9.24). */
	closeOnEscape?: boolean;
	/**
	 * Asked to go instead of being closed at once, so a dialog can run its
	 * closing fade and close the handle when it reports finished (R8.21).
	 */
	onDismiss?: (reason: OverlayDismissReason) => void;
	/** Heard once, whatever closed it. */
	onClose?: () => void;
	/** Names the root in the tree snapshot. */
	id?: string;
	/**
	 * The content takes the viewport's size, at open and on every resize: a
	 * dialog whose own box is its scrim, a screen transition's quad.
	 */
	fill?: boolean;
}

/**
 * One open overlay: a viewport-sized root in its layer with the content
 * under it, so the content is positioned in viewport logical pixels and a
 * viewport change resizes the root with no code in the content (R8.21).
 */
export class OverlayHandle {
	public readonly root: Layer;
	public readonly content: Component;
	/** What a press must land in to be inside (`OverlayOptions.inside`). */
	public readonly inside: Component;
	public readonly layer: LayerName;
	public readonly modal: boolean;
	public readonly dismissOnOutsidePress: boolean;
	public readonly consumeOutsidePress: boolean;
	public readonly closeOnEscape: boolean;
	public readonly fill: boolean;
	private readonly service: OverlayService;
	private readonly onDismiss: ((reason: OverlayDismissReason) => void) | null;
	private readonly onClose: (() => void) | null;
	private open = true;

	constructor({ service, root, content, options }: { service: OverlayService; root: Layer; content: Component; options: OverlayOptions }) {
		this.service = service;
		this.root = root;
		this.content = content;
		this.inside = options.inside ?? content;
		this.layer = options.layer;
		this.modal = options.modal ?? options.layer === 'modal';
		this.dismissOnOutsidePress = options.dismissOnOutsidePress ?? false;
		this.consumeOutsidePress = options.consumeOutsidePress ?? this.modal;
		this.closeOnEscape = options.closeOnEscape ?? false;
		this.fill = options.fill ?? false;
		this.onDismiss = options.onDismiss ?? null;
		this.onClose = options.onClose ?? null;
	}

	public get isOpen(): boolean {
		return this.open;
	}

	/** R9.15's per-root table: the root's own, searched by the dispatcher (DDB-76). */
	public get hotkeys(): HotkeyTable {
		return this.root.hotkeys;
	}

	/** Unmounts the root and gives the content back unmounted, so it can be opened again. */
	public close(): void {
		if (!this.open) return;
		this.open = false;
		this.service.remove(this);
		this.onClose?.();
	}

	/** Paints and hits over every other root of its layer (R3.6a). */
	public bringToFront(): void {
		if (this.open) this.service.bringToFront(this);
	}

	/** Escape or an outside press: the content's own `onDismiss`, or an immediate close. */
	public dismiss(reason: OverlayDismissReason): void {
		if (!this.open) return;
		if (this.onDismiss) this.onDismiss(reason);
		else this.close();
	}
}

/**
 * R8.21's overlay service: owns the roots opened through
 * `context.overlays.open(component, { layer })` (dialogs, popovers, popups
 * opened as roots, the tooltip, toast stacks, transitions), mounts each as a
 * root after the scene's in open order, and removes it on close.
 *
 * The pages render these roots after the scene's (`render`) and the
 * dispatcher hit-tests them in the same order, since both read one list: the
 * dispatcher's `overlay` tier is kept in step with it (R3.15, R3.28).
 *
 * As an input observer it dismisses: an outside press dismisses the topmost
 * roots that ask for it down to the first root the press is inside, stopping
 * at a modal (R9.13); Escape goes topmost first to the first root that closes
 * on it, stopping at a modal. Per-root hotkeys are the root's own
 * `hotkeys`, which the dispatcher searches after this (R9.15, DDB-76).
 */
export class OverlayService implements InputObserver {
	private readonly viewport: ViewportSource;
	private context: MountContext | null = null;
	private readonly handles: OverlayHandle[] = [];
	private readonly openListeners: ((handle: OverlayHandle) => void)[] = [];
	private opened = 0;

	constructor({ viewport }: { viewport: ViewportSource }) {
		this.viewport = viewport;
	}

	/** The context roots are mounted with. `createMountContext` binds it once the context exists. */
	public bind(context: MountContext): void {
		this.context = context;
	}

	/** Mounts `content` under a new root in `layer`, painted and hit over every open root of that layer. */
	public open(content: Component, options: OverlayOptions): OverlayHandle {
		const context = this.context;
		if (!context) throw new Error('OverlayService.open: the service is not bound to a mount context');
		if (content.parent) throw new Error('OverlayService.open: the content already has a parent');
		if (options.inside && !contains(content, options.inside)) {
			throw new Error('OverlayService.open: `inside` must be the content or a descendant of it');
		}

		const { width, height } = this.viewport.logical;
		this.opened += 1;
		const root = new Layer({
			id: options.id ?? `overlay_${options.layer}_${this.opened}`,
			x: 0,
			y: 0,
			width,
			height,
			layer: options.layer,
		});
		if (options.fill) content.setSize(width, height);
		root.addChild(content);
		const handle = new OverlayHandle({ service: this, root, content, options });
		root.modal = handle.modal;
		this.handles.push(handle);
		root.mount(context, { tier: 'overlay' });
		// R9.20: Tab stays inside a modal, and focus comes back when it closes.
		if (handle.modal) context.focus.pushScope(root);
		for (const listener of [...this.openListeners]) listener(handle);
		return handle;
	}

	/** Open roots in paint order: open order, `bringToFront` moving one to the end. */
	public get roots(): readonly Layer[] {
		return this.handles.map((handle) => handle.root);
	}

	/** The handle whose content is `component` or contains it. */
	public handleOf(component: Component): OverlayHandle | null {
		for (const handle of this.handles) {
			if (contains(handle.root, component)) return handle;
		}
		return null;
	}

	/** Heard after every open, with the new handle: the popup service closes popups when a modal opens (R3.6a). */
	public addOpenListener(listener: (handle: OverlayHandle) => void): () => void {
		this.openListeners.push(listener);
		return () => {
			const index = this.openListeners.indexOf(listener);
			if (index !== -1) this.openListeners.splice(index, 1);
		};
	}

	/** Closes every open root, newest first: a scene change (R8.22). */
	public closeAll(): void {
		for (let index = this.handles.length - 1; index >= 0; index--) this.handles[index]?.close();
	}

	/** Re-sizes every root to the viewport; the shells call it where the viewport change lands (R7.3). */
	public resize(): void {
		const { width, height } = this.viewport.logical;
		for (const handle of this.handles) {
			handle.root.setSize(width, height);
			if (handle.fill) handle.content.setSize(width, height);
		}
	}

	/** The overlay roots' paint, after the scene's own roots and before any diagnostic domain (R3.15, R3.21). */
	public render(draw: DrawApi): void {
		for (const handle of this.handles) renderTree(handle.root, draw);
	}

	/** Called by `OverlayHandle.close`. */
	public remove(handle: OverlayHandle): void {
		const index = this.handles.indexOf(handle);
		if (index === -1) return;
		this.handles.splice(index, 1);
		if (handle.modal) this.context?.focus.popScope(handle.root);
		// Detached first, so the content comes back unmounted and parentless.
		handle.root.removeChild(handle.content);
		handle.root.unmount();
	}

	/** Called by `OverlayHandle.bringToFront`. */
	public bringToFront(handle: OverlayHandle): void {
		const index = this.handles.indexOf(handle);
		if (index === -1 || index === this.handles.length - 1) return;
		this.handles.splice(index, 1);
		this.handles.push(handle);
		this.context?.dispatcher.raiseRoot(handle.root);
	}

	/** Topmost first: by layer, then latest opened (or brought to front) first. */
	private topmostFirst(): OverlayHandle[] {
		const order = this.handles.map((handle, index) => ({ handle, index }));
		order.sort((a, b) => (layerOrdinal(b.handle.layer) - layerOrdinal(a.handle.layer)) || (b.index - a.index));
		return order.map((entry) => entry.handle);
	}

	// -- input (R9.13, R9.15) -------------------------------------------------

	public pointerDown(press: PointerPress, swallowed: boolean): boolean {
		// A press a popup's close already took goes no further (R9.13).
		if (swallowed || this.handles.length === 0) return false;
		for (const handle of this.topmostFirst()) {
			if (press.target && contains(handle.inside, press.target)) return false;
			if (handle.dismissOnOutsidePress) {
				handle.dismiss('outside-press');
				if (handle.consumeOutsidePress) return true;
			}
			if (handle.modal) return handle.consumeOutsidePress;
		}
		return false;
	}

	public keyDown(stroke: KeyStroke): boolean {
		if (this.handles.length === 0 || stroke.key !== 'Escape' || stroke.repeat) return false;
		for (const handle of this.topmostFirst()) {
			if (handle.closeOnEscape) {
				handle.dismiss('escape');
				return true;
			}
			// Nothing beneath a modal closes; its own hotkeys may still want Escape.
			if (handle.modal) return false;
		}
		return false;
	}
}

export function contains(ancestor: Component, node: Component): boolean {
	for (let current: Component | null = node; current; current = current.parent) {
		if (current === ancestor) return true;
	}
	return false;
}
