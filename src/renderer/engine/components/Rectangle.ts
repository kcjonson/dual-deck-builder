import { Component } from './Component';

/**
 * Rectangle component for rendering rectangles
 */
export class Rectangle extends Component {
  private fillColor: [number, number, number, number] = [1, 1, 1, 1];
  private borderColor: [number, number, number, number] | null = null;
  private borderWidth: number = 0;
  private cornerRadius: number = 0;

  /**
   * Create a new rectangle
   * @param id Unique identifier for this component
   */
  constructor(id: string) {
    super(id);
  }

  /**
   * Set the fill color of the rectangle
   * @param color RGBA color array [r, g, b, a] with values from 0-1
   */
  public setFillColor(color: [number, number, number, number]): this {
    this.fillColor = color;
    return this;
  }

  /**
   * Set the border color of the rectangle
   * @param color RGBA color array [r, g, b, a] with values from 0-1
   */
  public setBorderColor(color: [number, number, number, number] | null): this {
    this.borderColor = color;
    return this;
  }

  /**
   * Set the border width of the rectangle
   * @param width Border width in pixels
   */
  public setBorderWidth(width: number): this {
    this.borderWidth = width;
    return this;
  }

  /**
   * Set the corner radius of the rectangle
   * @param radius Corner radius in pixels
   */
  public setCornerRadius(radius: number): this {
    this.cornerRadius = radius;
    return this;
  }

  /**
   * Render the rectangle
   */
  public render(): void {
    if (!this.visible) return;

    // Will be implemented when connected with the renderer
    // Would use renderer.drawRectangle(this.x, this.y, this.width, this.height, this.fillColor);
    
    // If there is a border, draw it
    // Would check for border and draw it
    
    // Render children
    for (const child of this.children) {
      if (child.isVisible()) {
        child.render();
      }
    }
  }
}
