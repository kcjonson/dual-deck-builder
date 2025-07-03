// Define types for event handlers
type MouseHandler = () => void;
type WheelHandler = (deltaX: number, deltaY: number) => void;
type KeyboardHandler = (key: string) => void;
// Uncomment if needed:
// type MouseMoveHandler = (x: number, y: number) => void;

// Interface for components that can receive input events
export interface Interactive {
	containsPoint(x: number, y: number): boolean;
	onWheel?(deltaX: number, deltaY: number): void;
}

/**
 * Global input system to handle mouse and keyboard events
 */
export class InputSystem {
	private static instance: InputSystem;
	private static DEBUG = false; // Add debug flag

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
	private keyUpComponents: Map<Interactive, KeyboardHandler> = new Map();
	
	// Global keyboard handlers (work without focus)
	private globalKeyDownHandlers: Map<string, KeyboardHandler> = new Map();
	private globalKeyUpHandlers: Map<string, KeyboardHandler> = new Map();

	// Currently hovered components
	private hoveredComponents: Set<Interactive> = new Set();
	
	// Currently focused component for keyboard input
	private focusedComponent: Interactive | null = null;

	// Canvas element for event handling
	private canvas: HTMLCanvasElement | null = null;

	/**
	 * Private constructor to enforce singleton pattern
	 */
	private constructor() {
		// Initialization happens in the setup method
	}

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): InputSystem {
		if (!InputSystem.instance) {
			InputSystem.instance = new InputSystem();
		}
		return InputSystem.instance;
	}

	/**
	 * Setup the input system with the target canvas
	 * @param canvas The canvas element to attach event listeners to
	 */
	public setup(canvas: HTMLCanvasElement): void {
		if (this.canvas) {
			// Remove any existing event listeners before setting up new ones
			this.unmount();
		}

		this.canvas = canvas;

		// Set up event listeners
		canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
		canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
		canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
		canvas.addEventListener('wheel', this.handleWheel.bind(this));

		// Handle mouse leaving the canvas
		canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
		
		// Set up keyboard event listeners on window (to capture all keyboard input)
		window.addEventListener('keydown', this.handleKeyDown.bind(this));
		window.addEventListener('keyup', this.handleKeyUp.bind(this));
	}

	/**
	 * Unmount the input system, removing all event listeners
	 */
	public unmount(): void {
		if (this.canvas) {
			this.canvas.removeEventListener('mousemove', this.handleMouseMove.bind(this));
			this.canvas.removeEventListener('mousedown', this.handleMouseDown.bind(this));
			this.canvas.removeEventListener('mouseup', this.handleMouseUp.bind(this));
			this.canvas.removeEventListener('wheel', this.handleWheel.bind(this));
			this.canvas.removeEventListener('mouseleave', this.handleMouseLeave.bind(this));
			this.canvas = null;
		}
		
		
		// Remove keyboard listeners
		window.removeEventListener('keydown', this.handleKeyDown.bind(this));
		window.removeEventListener('keyup', this.handleKeyUp.bind(this));

		// Clear all registered handlers
		this.mouseOverComponents.clear();
		this.mouseOutComponents.clear();
		this.mouseDownComponents.clear();
		this.mouseUpComponents.clear();
		this.wheelComponents.clear();
		this.keyDownComponents.clear();
		this.keyUpComponents.clear();
		this.globalKeyDownHandlers.clear();
		this.globalKeyUpHandlers.clear();
		this.hoveredComponents.clear();
		this.focusedComponent = null;
	}

	/**
	 * Handle mouse movement events
	 */
	private handleMouseMove(event: MouseEvent): void {
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
	}

	/**
	 * Handle mouse button down events
	 */
	private handleMouseDown(_event: MouseEvent): void {
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
	}

	/**
	 * Handle mouse button up events
	 */
	private handleMouseUp(_event: MouseEvent): void {
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
	}

	/**
	 * Handle mouse leave events (when mouse leaves the canvas)
	 */
	private handleMouseLeave(_event: MouseEvent): void {
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
	}

	/**
	 * Handle wheel events
	 */
	private handleWheel(event: WheelEvent): void {
		// Prevent default scrolling behavior
		event.preventDefault();

		// Normalize wheel delta values
		const deltaX = event.deltaX;
		const deltaY = event.deltaY;

		if (InputSystem.DEBUG) {
			console.log(
				`[InputSystem] Wheel event at (${this.mouseX}, ${this.mouseY}), deltaX: ${deltaX}, deltaY: ${deltaY}, registered components: ${this.wheelComponents.size}`,
			);
		}

		// Find components under mouse that can handle wheel events
		let foundComponent = false;
		for (const [component, handler] of this.wheelComponents) {
			if (component.containsPoint(this.mouseX, this.mouseY)) {
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
	}
	
	/**
	 * Handle keyboard down events
	 */
	private handleKeyDown(event: KeyboardEvent): void {
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
	}
	
	/**
	 * Handle keyboard up events
	 */
	private handleKeyUp(event: KeyboardEvent): void {
		// Check global handlers first
		const globalHandler = this.globalKeyUpHandlers.get(event.key);
		if (globalHandler) {
			globalHandler(event.key);
			return;
		}
		
		// Send to focused component if any
		if (this.focusedComponent) {
			const handler = this.keyUpComponents.get(this.focusedComponent);
			if (handler) {
				handler(event.key);
			}
		}
		
		if (InputSystem.DEBUG) {
			console.log(`Key Up: ${event.key}`);
		}
	}

	/**
	 * Process mouse over and out events based on current mouse position
	 */
	private processMouseOverOut(): void {
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
			if (component.containsPoint(this.mouseX, this.mouseY)) {
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

	/**
	 * Register a component for mouse over events
	 */
	public static registerMouseOver(component: Interactive, handler: MouseHandler): void {
		InputSystem.getInstance().mouseOverComponents.set(component, handler);
	}

	/**
	 * Register a component for mouse out events
	 */
	public static registerMouseOut(component: Interactive, handler: MouseHandler): void {
		InputSystem.getInstance().mouseOutComponents.set(component, handler);
	}

	/**
	 * Register a component for mouse down events
	 */
	public static registerMouseDown(component: Interactive, handler: MouseHandler): void {
		InputSystem.getInstance().mouseDownComponents.set(component, handler);
	}

	/**
	 * Register a component for mouse up events
	 */
	public static registerMouseUp(component: Interactive, handler: MouseHandler): void {
		InputSystem.getInstance().mouseUpComponents.set(component, handler);
	}

	/**
	 * Register a component for wheel events
	 */
	public static registerWheel(component: Interactive, handler: WheelHandler): void {
		InputSystem.getInstance().wheelComponents.set(component, handler);
	}
	
	/**
	 * Register a component for keyboard down events
	 */
	public static registerKeyDown(component: Interactive, handler: KeyboardHandler): void {
		InputSystem.getInstance().keyDownComponents.set(component, handler);
	}
	
	/**
	 * Register a component for keyboard up events
	 */
	public static registerKeyUp(component: Interactive, handler: KeyboardHandler): void {
		InputSystem.getInstance().keyUpComponents.set(component, handler);
	}
	
	/**
	 * Register a global keyboard down handler for a specific key
	 */
	public static registerGlobalKeyDown(key: string, handler: KeyboardHandler): void {
		InputSystem.getInstance().globalKeyDownHandlers.set(key, handler);
	}
	
	/**
	 * Register a global keyboard up handler for a specific key
	 */
	public static registerGlobalKeyUp(key: string, handler: KeyboardHandler): void {
		InputSystem.getInstance().globalKeyUpHandlers.set(key, handler);
	}
	
	/**
	 * Unregister a global keyboard down handler
	 */
	public static unregisterGlobalKeyDown(key: string): void {
		InputSystem.getInstance().globalKeyDownHandlers.delete(key);
	}
	
	/**
	 * Unregister a global keyboard up handler
	 */
	public static unregisterGlobalKeyUp(key: string): void {
		InputSystem.getInstance().globalKeyUpHandlers.delete(key);
	}
	
	/**
	 * Set the focused component for keyboard input
	 */
	public static setFocus(component: Interactive | null): void {
		InputSystem.getInstance().focusedComponent = component;
		
		if (InputSystem.DEBUG) {
			console.log(`[InputSystem] Focus set to:`, component?.constructor.name || 'null');
		}
	}
	
	/**
	 * Get the currently focused component
	 */
	public static getFocus(): Interactive | null {
		return InputSystem.getInstance().focusedComponent;
	}

	/**
	 * Get the current mouse position
	 */
	public static getMousePosition(): { x: number; y: number } {
		const instance = InputSystem.getInstance();
		return { x: instance.mouseX, y: instance.mouseY };
	}

	/**
	 * Unregister a component from all mouse events
	 */
	public static unregisterComponent(component: Interactive): void {
		const instance = InputSystem.getInstance();
		instance.mouseOverComponents.delete(component);
		instance.mouseOutComponents.delete(component);
		instance.mouseDownComponents.delete(component);
		instance.mouseUpComponents.delete(component);
		instance.wheelComponents.delete(component);
		instance.keyDownComponents.delete(component);
		instance.keyUpComponents.delete(component);
		instance.hoveredComponents.delete(component);
		
		// If this was the focused component, clear focus
		if (instance.focusedComponent === component) {
			instance.focusedComponent = null;
		}
	}
}
