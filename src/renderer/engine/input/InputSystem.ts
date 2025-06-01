// Define types for event handlers
type MouseHandler = () => void;
type WheelHandler = (deltaX: number, deltaY: number) => void;
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
	private static DEBUG = true; // Add debug flag

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

	// Currently hovered components
	private hoveredComponents: Set<Interactive> = new Set();

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
			this.cleanup();
		}

		this.canvas = canvas;

		// Set up event listeners
		canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
		canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
		canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
		canvas.addEventListener('wheel', this.handleWheel.bind(this));

		// Handle mouse leaving the canvas
		canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
	}

	/**
	 * Clean up the input system, removing all event listeners
	 */
	public cleanup(): void {
		if (this.canvas) {
			this.canvas.removeEventListener('mousemove', this.handleMouseMove.bind(this));
			this.canvas.removeEventListener('mousedown', this.handleMouseDown.bind(this));
			this.canvas.removeEventListener('mouseup', this.handleMouseUp.bind(this));
			this.canvas.removeEventListener('wheel', this.handleWheel.bind(this));
			this.canvas.removeEventListener('mouseleave', this.handleMouseLeave.bind(this));
			this.canvas = null;
		}

		// Clear all registered handlers
		this.mouseOverComponents.clear();
		this.mouseOutComponents.clear();
		this.mouseDownComponents.clear();
		this.mouseUpComponents.clear();
		this.wheelComponents.clear();
		this.hoveredComponents.clear();
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
	 * Process mouse over and out events based on current mouse position
	 */
	private processMouseOverOut(): void {
		// Check which components the mouse is currently over
		const currentlyHovered = new Set<Interactive>();

		// Check all components with mouseOver handlers
		for (const [component] of this.mouseOverComponents) {
			if (component.containsPoint(this.mouseX, this.mouseY)) {
				currentlyHovered.add(component);

				// If this is a new hover, trigger the mouseOver handler
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
	 * Unregister a component from all mouse events
	 */
	public static unregisterComponent(component: Interactive): void {
		const instance = InputSystem.getInstance();
		instance.mouseOverComponents.delete(component);
		instance.mouseOutComponents.delete(component);
		instance.mouseDownComponents.delete(component);
		instance.mouseUpComponents.delete(component);
		instance.wheelComponents.delete(component);
		instance.hoveredComponents.delete(component);
	}
}
