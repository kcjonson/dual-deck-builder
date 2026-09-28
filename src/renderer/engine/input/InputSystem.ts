type MouseHandler = () => void;
type WheelHandler = (deltaX: number, deltaY: number) => void;
type KeyboardHandler = (key: string) => void;

// Interface for components that can receive input events
export interface Interactive {
	/** Whether a viewport point, in logical pixels, lands on this target. */
	containsScreenPoint(x: number, y: number): boolean;
	onWheel?(deltaX: number, deltaY: number): void;
}

export interface InputSystemOptions {
	/**
	 * Runs before every hit test, so a pointer is tested against geometry laid
	 * out after the last change rather than before it (R8.16's layout on
	 * demand). The shell passes the mount context's `frame.layout`.
	 */
	beforeHitTest?: () => void;
}

/**
 * Mouse and keyboard input for one canvas, reached through the mount context
 * (R1.6): components register in `onMount`, and the base class unregisters
 * them on unmount. DDB-75's dispatcher replaces it; the global key table
 * survives as the root hotkey table.
 */
export class InputSystem {
	private static DEBUG = false;

	private readonly beforeHitTest: () => void;

	// Mouse position tracking
	private mouseX = 0;
	private mouseY = 0;
	private mouseDown = false;

	// Registered components and their handlers
	private mouseOverComponents: Map<Interactive, MouseHandler> = new Map();
	private mouseOutComponents: Map<Interactive, MouseHandler> = new Map();
	private mouseDownComponents: Map<Interactive, MouseHandler> = new Map();
	private mouseUpComponents: Map<Interactive, MouseHandler> = new Map();
	private wheelComponents: Map<Interactive, WheelHandler> = new Map();
	private keyDownComponents: Map<Interactive, KeyboardHandler> = new Map();

	// Global keyboard handlers (work without focus)
	private globalKeyDownHandlers: Map<string, KeyboardHandler> = new Map();

	// Currently hovered components
	private hoveredComponents: Set<Interactive> = new Set();

	// Currently focused component for keyboard input
	private focusedComponent: Interactive | null = null;

	// Canvas element for event handling
	private canvas: HTMLCanvasElement | null = null;

	// Development-only input gate for R13.32's pause. See the accessor below.
	private inputPaused = false;

	constructor({ beforeHitTest }: InputSystemOptions = {}) {
		this.beforeHitTest = beforeHitTest ?? (() => undefined);
	}

	/**
	 * Whether input dispatch is suspended (R13.32's pause, R13.35's "injected
	 * input is ignored while paused").
	 *
	 * The gate lives here rather than in a frame loop because this system
	 * dispatches straight from DOM listeners: a loop that skipped its update
	 * call would still see buttons pressed and text typed. Every handler reads
	 * it behind `__DEV_TOOLS__ &&`, so a production build folds the check away
	 * and carries no per-event cost (R13.2).
	 */
	public get paused(): boolean {
		return this.inputPaused;
	}

	public set paused(value: boolean) {
		this.inputPaused = value;
	}

	/**
	 * Listen on `canvas` for pointer input and on `window` for keys.
	 * @param canvas The canvas element to attach event listeners to
	 */
	public setup(canvas: HTMLCanvasElement): void {
		if (this.canvas) this.detach();

		this.canvas = canvas;
		canvas.addEventListener('mousemove', this.handleMouseMove);
		canvas.addEventListener('mousedown', this.handleMouseDown);
		canvas.addEventListener('mouseup', this.handleMouseUp);
		canvas.addEventListener('wheel', this.handleWheel);
		canvas.addEventListener('mouseleave', this.handleMouseLeave);
		// On window, to capture all keyboard input
		window.addEventListener('keydown', this.handleKeyDown);
	}

	/**
	 * Remove the listeners and forget every registration. The handlers are
	 * bound once, as fields, so removal finds the functions `setup` added.
	 */
	public detach(): void {
		if (this.canvas) {
			this.canvas.removeEventListener('mousemove', this.handleMouseMove);
			this.canvas.removeEventListener('mousedown', this.handleMouseDown);
			this.canvas.removeEventListener('mouseup', this.handleMouseUp);
			this.canvas.removeEventListener('wheel', this.handleWheel);
			this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
			this.canvas = null;
			window.removeEventListener('keydown', this.handleKeyDown);
		}

		this.mouseOverComponents.clear();
		this.mouseOutComponents.clear();
		this.mouseDownComponents.clear();
		this.mouseUpComponents.clear();
		this.wheelComponents.clear();
		this.keyDownComponents.clear();
		this.globalKeyDownHandlers.clear();
		this.hoveredComponents.clear();
		this.focusedComponent = null;
	}

	private handleMouseMove = (event: MouseEvent): void => {
		if (__DEV_TOOLS__ && this.inputPaused) return;

		// Get mouse position relative to canvas
		if (this.canvas) {
			const rect = this.canvas.getBoundingClientRect();
			this.mouseX = event.clientX - rect.left;
			this.mouseY = event.clientY - rect.top;

			// Process mouse over/out events
			this.processMouseOverOut();
		}

		if (InputSystem.DEBUG) {
			console.log(`Mouse Move: (${this.mouseX}, ${this.mouseY})`);
		}
	};

	private handleMouseDown = (_event: MouseEvent): void => {
		if (__DEV_TOOLS__ && this.inputPaused) return;

		this.mouseDown = true;

		if (InputSystem.DEBUG) {
			console.log(
				`[InputSystem] Mouse down at (${this.mouseX}, ${this.mouseY}), hovered components:`,
				this.hoveredComponents.size,
			);
		}

		// Check if we clicked outside of the currently focused component
		if (this.focusedComponent && !this.hoveredComponents.has(this.focusedComponent)) {
			// Clicked outside the focused component - need to blur it
			if ('onMouseDownOutside' in this.focusedComponent && typeof (this.focusedComponent as { onMouseDownOutside?: () => void }).onMouseDownOutside === 'function') {
				(this.focusedComponent as { onMouseDownOutside: () => void }).onMouseDownOutside();
			}
		}

		// Trigger mouseDown handlers for hovered components
		for (const component of this.hoveredComponents) {
			const handler = this.mouseDownComponents.get(component);
			if (handler) {
				if (InputSystem.DEBUG) {
					console.log(
						`[InputSystem] Triggering mouseDown for component:`,
						component.constructor.name,
					);
				}
				handler();
			}
		}
	};

	private handleMouseUp = (_event: MouseEvent): void => {
		if (__DEV_TOOLS__ && this.inputPaused) return;

		this.mouseDown = false;

		// Trigger mouseUp handlers for hovered components
		for (const component of this.hoveredComponents) {
			const handler = this.mouseUpComponents.get(component);
			if (handler) {
				handler();
			}
		}

		if (InputSystem.DEBUG) {
			console.log(`Mouse Up at (${this.mouseX}, ${this.mouseY})`);
		}
	};

	/** The mouse left the canvas. */
	private handleMouseLeave = (_event: MouseEvent): void => {
		if (__DEV_TOOLS__ && this.inputPaused) return;

		// Trigger mouseOut for all currently hovered components
		for (const component of this.hoveredComponents) {
			const handler = this.mouseOutComponents.get(component);
			if (handler) {
				handler();
			}
		}

		// Clear the set of hovered components
		this.hoveredComponents.clear();

		if (InputSystem.DEBUG) {
			console.log('Mouse Leave');
		}
	};

	private handleWheel = (event: WheelEvent): void => {
		if (__DEV_TOOLS__ && this.inputPaused) return;

		// Prevent default scrolling behavior
		event.preventDefault();

		const deltaX = event.deltaX;
		const deltaY = event.deltaY;

		if (InputSystem.DEBUG) {
			console.log(
				`[InputSystem] Wheel event at (${this.mouseX}, ${this.mouseY}), deltaX: ${deltaX}, deltaY: ${deltaY}, registered components: ${this.wheelComponents.size}`,
			);
		}

		this.beforeHitTest();

		// Find components under mouse that can handle wheel events
		let foundComponent = false;
		for (const [component, handler] of this.wheelComponents) {
			if (component.containsScreenPoint(this.mouseX, this.mouseY)) {
				if (InputSystem.DEBUG) {
					console.log(
						`[InputSystem] Wheel event handled by component:`,
						component.constructor.name,
					);
				}
				handler(deltaX, deltaY);
				foundComponent = true;
			}
		}

		if (InputSystem.DEBUG && !foundComponent) {
			console.log(`[InputSystem] No component found to handle wheel event`);
		}

		// A scroll moves content under a pointer that did not move. The hover
		// set is what mousedown dispatches to, so it is recomputed here rather
		// than at the next mousemove, or a click right after a scroll lands on a
		// row that just left the clip (R4.12) and misses the one that entered.
		this.processMouseOverOut();
	};

	private handleKeyDown = (event: KeyboardEvent): void => {
		if (__DEV_TOOLS__ && this.inputPaused) return;

		// Check global handlers first
		const globalHandler = this.globalKeyDownHandlers.get(event.key);
		if (globalHandler) {
			globalHandler(event.key);
			event.preventDefault();
			return;
		}

		// Send to focused component if any
		if (this.focusedComponent) {
			const handler = this.keyDownComponents.get(this.focusedComponent);
			if (handler) {
				handler(event.key);
				// Prevent default behavior for handled keys
				event.preventDefault();
			}
		}

		if (InputSystem.DEBUG) {
			console.log(`Key Down: ${event.key}, focused component:`, this.focusedComponent?.constructor.name);
		}
	};

	/**
	 * Process mouse over and out events based on current mouse position
	 */
	private processMouseOverOut(): void {
		this.beforeHitTest();

		// Check which components the mouse is currently over
		const currentlyHovered = new Set<Interactive>();

		// We need to check ALL components that have any mouse handlers, not just mouseOver
		const allInteractiveComponents = new Set<Interactive>();

		// Collect all components that have any mouse handlers
		for (const [component] of this.mouseOverComponents) allInteractiveComponents.add(component);
		for (const [component] of this.mouseDownComponents) allInteractiveComponents.add(component);
		for (const [component] of this.mouseUpComponents) allInteractiveComponents.add(component);

		// Check all interactive components
		for (const component of allInteractiveComponents) {
			if (component.containsScreenPoint(this.mouseX, this.mouseY)) {
				currentlyHovered.add(component);

				// If this is a new hover and has mouseOver handler, trigger it
				if (!this.hoveredComponents.has(component)) {
					const handler = this.mouseOverComponents.get(component);
					if (handler) {
						handler();
					}

					if (InputSystem.DEBUG) {
						console.log(`Mouse Over: ${component}`);
					}
				}
			}
		}

		// Check for components that are no longer hovered
		for (const component of this.hoveredComponents) {
			if (!currentlyHovered.has(component)) {
				// Component is no longer hovered, trigger mouseOut
				const handler = this.mouseOutComponents.get(component);
				if (handler) {
					handler();
				}

				if (InputSystem.DEBUG) {
					console.log(`Mouse Out: ${component}`);
				}
			}
		}

		// Update the set of hovered components
		this.hoveredComponents = currentlyHovered;
	}

	public registerMouseOver(component: Interactive, handler: MouseHandler): void {
		this.mouseOverComponents.set(component, handler);
	}

	public registerMouseOut(component: Interactive, handler: MouseHandler): void {
		this.mouseOutComponents.set(component, handler);
	}

	public registerMouseDown(component: Interactive, handler: MouseHandler): void {
		this.mouseDownComponents.set(component, handler);
	}

	public registerMouseUp(component: Interactive, handler: MouseHandler): void {
		this.mouseUpComponents.set(component, handler);
	}

	public registerWheel(component: Interactive, handler: WheelHandler): void {
		this.wheelComponents.set(component, handler);
	}

	/** Keys delivered while `component` holds focus. */
	public registerKeyDown(component: Interactive, handler: KeyboardHandler): void {
		this.keyDownComponents.set(component, handler);
	}

	/** A key handled whatever has focus: the root hotkey table's ancestor (R9.15). */
	public registerGlobalKeyDown(key: string, handler: KeyboardHandler): void {
		this.globalKeyDownHandlers.set(key, handler);
	}

	public unregisterGlobalKeyDown(key: string): void {
		this.globalKeyDownHandlers.delete(key);
	}

	/** Set the focused component for keyboard input. */
	public setFocus(component: Interactive | null): void {
		this.focusedComponent = component;

		if (InputSystem.DEBUG) {
			console.log(`[InputSystem] Focus set to:`, component?.constructor.name || 'null');
		}
	}

	public getFocus(): Interactive | null {
		return this.focusedComponent;
	}

	/** Drop every registration `component` made, its hover, and its focus. */
	public unregisterComponent(component: Interactive): void {
		this.mouseOverComponents.delete(component);
		this.mouseOutComponents.delete(component);
		this.mouseDownComponents.delete(component);
		this.mouseUpComponents.delete(component);
		this.wheelComponents.delete(component);
		this.keyDownComponents.delete(component);
		this.hoveredComponents.delete(component);

		if (this.focusedComponent === component) {
			this.focusedComponent = null;
		}
	}
}
