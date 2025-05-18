import { Component } from '../components/Component';

// Define types for event handlers
type MouseHandler = () => void;
type MouseMoveHandler = (x: number, y: number) => void;

// Interface for components that can receive input events
export interface Interactive {
  containsPoint(x: number, y: number): boolean;
}

/**
 * Global input system to handle mouse and keyboard events
 */
export class InputSystem {
  private static instance: InputSystem;
  
  // Mouse position tracking
  private mouseX: number = 0;
  private mouseY: number = 0;
  private mouseDown: boolean = false;
  
  // Registered components and their handlers
  private mouseOverComponents: Map<Component, MouseHandler> = new Map();
  private mouseOutComponents: Map<Component, MouseHandler> = new Map();
  private mouseDownComponents: Map<Component, MouseHandler> = new Map();
  private mouseUpComponents: Map<Component, MouseHandler> = new Map();
  
  // Currently hovered components
  private hoveredComponents: Set<Component> = new Set();
  
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
      this.canvas.removeEventListener('mouseleave', this.handleMouseLeave.bind(this));
      this.canvas = null;
    }
    
    // Clear all registered handlers
    this.mouseOverComponents.clear();
    this.mouseOutComponents.clear();
    this.mouseDownComponents.clear();
    this.mouseUpComponents.clear();
    this.hoveredComponents.clear();
  }
  
  /**
   * Handle mouse movement events
   */
  private handleMouseMove(event: MouseEvent): void {
    // Get mouse position relative to canvas
    const rect = this.canvas!.getBoundingClientRect();
    this.mouseX = event.clientX - rect.left;
    this.mouseY = event.clientY - rect.top;
    
    // Process mouse over/out events
    this.processMouseOverOut();
  }
  
  /**
   * Handle mouse button down events
   */
  private handleMouseDown(event: MouseEvent): void {
    this.mouseDown = true;
    
    // Trigger mouseDown handlers for hovered components
    for (const component of this.hoveredComponents) {
      const handler = this.mouseDownComponents.get(component);
      if (handler) {
        handler();
      }
    }
  }
  
  /**
   * Handle mouse button up events
   */
  private handleMouseUp(event: MouseEvent): void {
    this.mouseDown = false;
    
    // Trigger mouseUp handlers for hovered components
    for (const component of this.hoveredComponents) {
      const handler = this.mouseUpComponents.get(component);
      if (handler) {
        handler();
      }
    }
  }
  
  /**
   * Handle mouse leave events (when mouse leaves the canvas)
   */
  private handleMouseLeave(event: MouseEvent): void {
    // Trigger mouseOut for all currently hovered components
    for (const component of this.hoveredComponents) {
      const handler = this.mouseOutComponents.get(component);
      if (handler) {
        handler();
      }
    }
    
    // Clear the set of hovered components
    this.hoveredComponents.clear();
  }
  
  /**
   * Process mouse over and out events based on current mouse position
   */
  private processMouseOverOut(): void {
    // Check which components the mouse is currently over
    const currentlyHovered = new Set<Component>();
    
    // Check all components with mouseOver handlers
    for (const [component, _] of this.mouseOverComponents) {
      if (component.containsPoint(this.mouseX, this.mouseY)) {
        currentlyHovered.add(component);
        
        // If this is a new hover, trigger the mouseOver handler
        if (!this.hoveredComponents.has(component)) {
          const handler = this.mouseOverComponents.get(component);
          if (handler) {
            handler();
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
      }
    }
    
    // Update the set of hovered components
    this.hoveredComponents = currentlyHovered;
  }
  
  /**
   * Register a component for mouse over events
   */
  public static registerMouseOver(component: Component, handler: MouseHandler): void {
    InputSystem.getInstance().mouseOverComponents.set(component, handler);
  }
  
  /**
   * Register a component for mouse out events
   */
  public static registerMouseOut(component: Component, handler: MouseHandler): void {
    InputSystem.getInstance().mouseOutComponents.set(component, handler);
  }
  
  /**
   * Register a component for mouse down events
   */
  public static registerMouseDown(component: Component, handler: MouseHandler): void {
    InputSystem.getInstance().mouseDownComponents.set(component, handler);
  }
  
  /**
   * Register a component for mouse up events
   */
  public static registerMouseUp(component: Component, handler: MouseHandler): void {
    InputSystem.getInstance().mouseUpComponents.set(component, handler);
  }
  
  /**
   * Unregister a component from all mouse events
   */
  public static unregisterComponent(component: Component): void {
    const instance = InputSystem.getInstance();
    instance.mouseOverComponents.delete(component);
    instance.mouseOutComponents.delete(component);
    instance.mouseDownComponents.delete(component);
    instance.mouseUpComponents.delete(component);
    instance.hoveredComponents.delete(component);
  }
}
