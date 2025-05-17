import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';

/**
 * Button UI component
 */
export class Button extends Rectangle {
  private text: Text;
  private hovered: boolean = false;
  private pressed: boolean = false;
  private enabled: boolean = true;
  private clickHandler: (() => void) | null = null;
  
  // Button appearance states
  private normalColor: [number, number, number, number] = [0.2, 0.2, 0.8, 1.0];
  private hoverColor: [number, number, number, number] = [0.3, 0.3, 0.9, 1.0];
  private pressedColor: [number, number, number, number] = [0.1, 0.1, 0.7, 1.0];
  private disabledColor: [number, number, number, number] = [0.5, 0.5, 0.5, 1.0];

  /**
   * Create a new button
   * @param id Unique identifier for this component
   * @param label Text to display on the button
   */
  constructor(id: string, label: string = '') {
    super(id);
    
    // Create text child component for the label
    this.text = new Text(`${id}_text`, label);
    this.text.setColor([1, 1, 1, 1]);
    this.text.setAlign('center');
    this.text.setBaseline('middle');
    
    // Add the text as a child
    this.addChild(this.text);
    
    // Set default appearance
    this.setFillColor(this.normalColor);
    this.setBorderColor([0.1, 0.1, 0.1, 1]);
    this.setBorderWidth(2);
    this.setCornerRadius(5);

    // Setup event handling (this would be connected to the input system)
    this.setupEvents();
  }

  /**
   * Setup input event handling for the button
   * This is a placeholder that would be implemented when connected to the input system
   */
  private setupEvents(): void {
    // This would register event handlers with a global input system
    // For example:
    // InputSystem.registerMouseOver(this, () => this.onMouseOver());
    // InputSystem.registerMouseOut(this, () => this.onMouseOut());
    // InputSystem.registerMouseDown(this, () => this.onMouseDown());
    // InputSystem.registerMouseUp(this, () => this.onMouseUp());
  }

  /**
   * Set the button's label text
   * @param text Button label text
   */
  public setLabel(text: string): this {
    this.text.setText(text);
    return this;
  }

  /**
   * Get the button's label text
   */
  public getLabel(): string {
    return this.text.getText();
  }

  /**
   * Set the text color
   * @param color RGBA color array [r, g, b, a] with values from 0-1
   */
  public setTextColor(color: [number, number, number, number]): this {
    this.text.setColor(color);
    return this;
  }

  /**
   * Set the font size
   * @param size Font size in pixels
   */
  public setFontSize(size: number): this {
    this.text.setFontSize(size);
    return this;
  }

  /**
   * Set the button's size and update the text position
   */
  public setSize(width: number, height: number): this {
    super.setSize(width, height);
    
    // Center the text in the button
    this.updateTextPosition();
    
    return this;
  }

  /**
   * Set the button's position and update the text position
   */
  public setPosition(x: number, y: number): this {
    super.setPosition(x, y);
    
    // Update text position based on button position
    this.updateTextPosition();
    
    return this;
  }

  /**
   * Center the text within the button
   */
  private updateTextPosition(): void {
    this.text.setPosition(
      this.width / 2,
      this.height / 2
    );
  }

  /**
   * Set whether the button is enabled
   * @param enabled Enabled state
   */
  public setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    
    // Update appearance based on enabled state
    if (!this.enabled) {
      this.setFillColor(this.disabledColor);
    } else {
      this.setFillColor(this.normalColor);
    }
    
    return this;
  }

  /**
   * Set the click handler
   * @param callback Function to call when the button is clicked
   */
  public onClick(callback: () => void): this {
    this.clickHandler = callback;
    return this;
  }

  /**
   * Handle mouse over event
   */
  private onMouseOver(): void {
    if (this.enabled) {
      this.hovered = true;
      this.setFillColor(this.hoverColor);
    }
  }

  /**
   * Handle mouse out event
   */
  private onMouseOut(): void {
    if (this.enabled) {
      this.hovered = false;
      this.pressed = false;
      this.setFillColor(this.normalColor);
    }
  }

  /**
   * Handle mouse down event
   */
  private onMouseDown(): void {
    if (this.enabled) {
      this.pressed = true;
      this.setFillColor(this.pressedColor);
    }
  }

  /**
   * Handle mouse up event
   */
  private onMouseUp(): void {
    if (this.enabled && this.pressed && this.hovered) {
      // Trigger click callback
      if (this.clickHandler) {
        this.clickHandler();
      }
      
      this.setFillColor(this.hoverColor);
    }
    
    this.pressed = false;
  }
}
