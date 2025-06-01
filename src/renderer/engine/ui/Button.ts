import { Component, ComponentOptions } from '../components/Component';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import { InputSystem } from '../input/InputSystem';

/**
 * Button UI component
 */
export class Button extends Component {
	private background: Rectangle;
	private text: Text;
	private hovered = false;
	private pressed = false;
	private enabled = true;
	private clickHandler: (() => void) | null = null;

	// Button appearance states
	private normalColor = '#3333cc';
	private hoverColor = '#4d4de6';
	private pressedColor = '#1a1ab3';
	private disabledColor = '#808080';

	/**
	 * Create a new button
	 * @param label Text to display on the button
	 * @param options Optional configuration including style
	 */
	constructor(label = '', options?: ComponentOptions) {
		super(options);
		this.componentType = 'Button';

		// Create background rectangle
		this.background = new Rectangle({
			style: {
				backgroundColor: this.normalColor,
				border: '2px solid #1a1a1a',
				borderRadius: '5px',
			},
		});
		this.addChild(this.background);

		// Create text child component for the label
		this.text = new Text(label, {
			style: {
				color: '#ffffff',
				textAlign: 'center',
				verticalAlign: 'middle',
			},
		});
		this.text.setColor([1, 1, 1, 1]);
		this.text.setAlign('center');
		this.text.setBaseline('middle');
		this.addChild(this.text);

		// Setup event handling (this would be connected to the input system)
		this.setupEvents();
	}

	/**
	 * Setup input event handling for the button
	 * Registers this button with the global InputSystem for mouse events
	 */
	private setupEvents(): void {
		// Register event handlers with the global input system
		InputSystem.registerMouseOver(this, () => this.onMouseOver());
		InputSystem.registerMouseOut(this, () => this.onMouseOut());
		InputSystem.registerMouseDown(this, () => this.onMouseDown());
		InputSystem.registerMouseUp(this, () => this.onMouseUp());
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
	 * @param color Color value (hex string or RGBA array)
	 */
	public setTextColor(color: string | [number, number, number, number]): this {
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

		// Update the text position and size to match button
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
	 * Update the positions of all child components
	 */
	private updateTextPosition(): void {
		// Update background position and size
		this.background.setPosition(this.x, this.y);
		this.background.setSize(this.width, this.height);

		// Update text position and size to match button
		this.text.setPosition(this.x, this.y);
		this.text.setSize(this.width, this.height);
	}

	/**
	 * Set whether the button is enabled
	 * @param enabled Enabled state
	 */
	public setEnabled(enabled: boolean): this {
		this.enabled = enabled;

		// Update appearance based on enabled state
		if (!this.enabled) {
			this.background.setFillColor(this.disabledColor);
		} else {
			this.background.setFillColor(this.normalColor);
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
			this.background.setFillColor(this.hoverColor);
		}
	}

	/**
	 * Handle mouse out event
	 */
	private onMouseOut(): void {
		if (this.enabled) {
			this.hovered = false;
			this.pressed = false;
			this.background.setFillColor(this.normalColor);
		}
	}

	/**
	 * Handle mouse down event
	 */
	private onMouseDown(): void {
		if (this.enabled) {
			this.pressed = true;
			this.background.setFillColor(this.pressedColor);
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

			this.background.setFillColor(this.hoverColor);
		}

		this.pressed = false;
	}

	/**
	 * Set the fill color of the button background
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: string | [number, number, number, number]): this {
		this.background.setFillColor(color);
		return this;
	}

	/**
	 * Set the border color of the button background
	 * @param color Color value (hex string or RGBA array)
	 */
	public setBorderColor(color: string | [number, number, number, number]): this {
		this.background.setBorderColor(color);
		return this;
	}

	/**
	 * Set the border width of the button background
	 * @param width Border width in pixels
	 */
	public setBorderWidth(width: number): this {
		this.background.setBorderWidth(width);
		return this;
	}

	/**
	 * Set the corner radius of the button background
	 * @param radius Corner radius in pixels
	 */
	public setCornerRadius(radius: number): this {
		this.background.setCornerRadius(radius);
		return this;
	}

	/**
	 * Render this component
	 * This is required by the Component abstract class
	 */
	public render(): void {
		// The rendering will be handled by child components
		// No need to implement any rendering logic here
		for (const child of this.children) {
			if (child.isVisible()) {
				child.render();
			}
		}
	}

	/**
	 * Clean up resources and event handlers
	 * Should be called when the button is removed
	 */
	public cleanup(): void {
		// Unregister from input system to prevent memory leaks
		InputSystem.unregisterComponent(this);
	}
}
