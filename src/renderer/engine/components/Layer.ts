import { Component } from './Component';

/**
 * Layer component for grouping and organizing other components
 */
export class Layer extends Component {
  private backgroundColor: [number, number, number, number] | null = null;

  /**
   * Create a new layer
   * @param id Unique identifier for this component
   */
  constructor(id: string) {
    super(id);
  }

  /**
   * Set the background color of the layer
   * @param color RGBA color array [r, g, b, a] with values from 0-1
   */
  public setBackgroundColor(color: [number, number, number, number] | null): this {
    this.backgroundColor = color;
    return this;
  }

  /**
   * Get the background color of the layer
   */
  public getBackgroundColor(): [number, number, number, number] | null {
    return this.backgroundColor;
  }

  /**
   * Render the layer and all its children
   */
  public render(): void {
    if (!this.visible) return;

    // If this layer has a renderer attached (via the game instance)
    // and a background color, render the background
    if (this.backgroundColor && this.width > 0 && this.height > 0) {
      // This would use the renderer to draw the background
      // To be implemented when connecting with the renderer
    }

    // Render all children
    for (const child of this.children) {
      if (child.isVisible()) {
        child.render();
      }
    }
  }
}
