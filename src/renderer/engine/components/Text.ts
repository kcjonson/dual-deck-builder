import { Component } from './Component';
import { RendererContext } from '../rendering/RendererContext';

/**
 * Text component for rendering text
 */
export class Text extends Component {
  private text: string;
  private fontSize: number = 16;
  private fontFamily: string = 'Arial';
  private color: [number, number, number, number] = [1, 1, 1, 1];
  private align: 'left' | 'center' | 'right' = 'left';
  private baseline: 'top' | 'middle' | 'bottom' = 'top';

  /**
   * Create a new text component
   * @param id Unique identifier for this component
   * @param text Initial text content
   */
  constructor(id: string, text: string = '') {
    super(id);
    this.text = text;
  }

  /**
   * Set the text content
   * @param text Text content
   */
  public setText(text: string): this {
    this.text = text;
    return this;
  }

  /**
   * Get the text content
   */
  public getText(): string {
    return this.text;
  }

  /**
   * Set the font size
   * @param size Font size in pixels
   */
  public setFontSize(size: number): this {
    this.fontSize = size;
    return this;
  }

  /**
   * Set the font family
   * @param family Font family name
   */
  public setFontFamily(family: string): this {
    this.fontFamily = family;
    return this;
  }

  /**
   * Set the text color
   * @param color RGBA color array [r, g, b, a] with values from 0-1
   */
  public setColor(color: [number, number, number, number]): this {
    this.color = color;
    return this;
  }

  /**
   * Set the text alignment
   * @param align Text alignment (left, center, right)
   */
  public setAlign(align: 'left' | 'center' | 'right'): this {
    this.align = align;
    return this;
  }

  /**
   * Set the text baseline
   * @param baseline Text baseline (top, middle, bottom)
   */
  public setBaseline(baseline: 'top' | 'middle' | 'bottom'): this {
    this.baseline = baseline;
    return this;
  }

  /**
   * Render the text
   */
  public render(): void {
    if (!this.visible) return;

    // Get the renderer instance
    const renderer = RendererContext.getInstance().getRenderer();
    
    // Draw the text
    renderer.drawText(this.text, this.x, this.y, this.color, this.fontSize);
    
    // Render children
    for (const child of this.children) {
      if (child.isVisible()) {
        child.render();
      }
    }
  }
}
