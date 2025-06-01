import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import { ComponentOptions } from '../types/Style';

/**
 * Input UI component for text input
 */
export class Input extends Rectangle {
	private text: Text;
	private placeholder: Text;
	private value = '';
	private placeholderText = '';
	private focused = false;
	private enabled = true;
	private maxLength = 100;
	private onChangeCallback: ((value: string) => void) | null = null;
	private onFocusCallback: (() => void) | null = null;
	private onBlurCallback: (() => void) | null = null;

	// Input appearance states
	private normalColor: [number, number, number, number] = [0.1, 0.1, 0.1, 1.0];
	private focusedColor: [number, number, number, number] = [0.15, 0.15, 0.15, 1.0];
	private disabledColor: [number, number, number, number] = [0.05, 0.05, 0.05, 0.5];

	/**
	 * Create a new input field
	 * @param placeholder Placeholder text to show when input is empty
	 * @param options Optional configuration including style
	 */
	constructor(placeholder = '', options?: ComponentOptions) {
		super(options);
		this.componentType = 'Input';

		// Create text child component for the input value
		this.text = new Text('', {
			style: {
				color: '#ffffff',
				textAlign: 'left',
				verticalAlign: 'middle'
			}
		});

		// Create placeholder text
		this.placeholder = new Text(placeholder, {
			style: {
				color: '#808080',
				textAlign: 'left',
				verticalAlign: 'middle'
			}
		});
		this.placeholderText = placeholder;

		// Add the text components as children
		this.addChild(this.text);
		this.addChild(this.placeholder);

		// Set default appearance
		this.setFillColor(this.normalColor);
		this.setBorderColor([0.3, 0.3, 0.3, 1]);
		this.setBorderWidth(2);
		this.setCornerRadius(3);

		// Setup event handling (this would be connected to the input system)
		this.setupEvents();
	}

	/**
	 * Setup input event handling for the input field
	 * This is a placeholder that would be implemented when connected to the input system
	 */
	private setupEvents(): void {
		// This would register event handlers with a global input system
		// For example:
		// InputSystem.registerMouseDown(this, () => this.onMouseDown());
		// InputSystem.registerKeyPress(this, (key) => this.onKeyPress(key));
	}

	/**
	 * Set the input's value
	 * @param value Input value
	 */
	public setValue(value: string): this {
		this.value = value.substring(0, this.maxLength);
		this.text.setText(this.value);
		this.updatePlaceholderVisibility();

		// Call onChange callback if defined
		if (this.onChangeCallback) {
			this.onChangeCallback(this.value);
		}

		return this;
	}

	/**
	 * Get the input's value
	 */
	public getValue(): string {
		return this.value;
	}

	/**
	 * Set the placeholder text
	 * @param placeholder Placeholder text
	 */
	public setPlaceholder(placeholder: string): this {
		this.placeholderText = placeholder;
		this.placeholder.setText(placeholder);
		this.updatePlaceholderVisibility();
		return this;
	}

	/**
	 * Set the maximum length for the input value
	 * @param length Maximum number of characters
	 */
	public setMaxLength(length: number): this {
		this.maxLength = length;

		// Trim existing value if necessary
		if (this.value.length > this.maxLength) {
			this.setValue(this.value.substring(0, this.maxLength));
		}

		return this;
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
	 * Set the placeholder text color
	 * @param color RGBA color array [r, g, b, a] with values from 0-1
	 */
	public setPlaceholderColor(color: [number, number, number, number]): this {
		this.placeholder.setColor(color);
		return this;
	}

	/**
	 * Set the font size
	 * @param size Font size in pixels
	 */
	public setFontSize(size: number): this {
		this.text.setFontSize(size);
		this.placeholder.setFontSize(size);
		return this;
	}

	/**
	 * Set the input's size and update the text positions
	 */
	public setSize(width: number, height: number): this {
		super.setSize(width, height);
		this.updateTextPositions();
		return this;
	}

	/**
	 * Set the input's position and update the text positions
	 */
	public setPosition(x: number, y: number): this {
		super.setPosition(x, y);
		this.updateTextPositions();
		return this;
	}

	/**
	 * Update the text positions within the input
	 */
	private updateTextPositions(): void {
		const padding = 10; // Padding from the left edge
		this.text.setPosition(this.x + padding, this.y + this.height / 2);
		this.placeholder.setPosition(this.x + padding, this.y + this.height / 2);
	}

	/**
	 * Update the visibility of the placeholder text based on input value
	 */
	private updatePlaceholderVisibility(): void {
		this.placeholder.setVisible(this.value.length === 0);
	}

	/**
	 * Set whether the input is enabled
	 * @param enabled Enabled state
	 */
	public setEnabled(enabled: boolean): this {
		this.enabled = enabled;

		// Update appearance based on enabled state
		this.text.setVisible(enabled);

		if (!this.enabled) {
			this.setFillColor(this.disabledColor);
		} else {
			this.setFillColor(this.focused ? this.focusedColor : this.normalColor);
		}

		return this;
	}

	/**
	 * Set the onChange callback
	 * @param callback Function to call when the input value changes
	 */
	public onChange(callback: (value: string) => void): this {
		this.onChangeCallback = callback;
		return this;
	}

	/**
	 * Set the onFocus callback
	 * @param callback Function to call when the input gains focus
	 */
	public onFocus(callback: () => void): this {
		this.onFocusCallback = callback;
		return this;
	}

	/**
	 * Set the onBlur callback
	 * @param callback Function to call when the input loses focus
	 */
	public onBlur(callback: () => void): this {
		this.onBlurCallback = callback;
		return this;
	}

	/**
	 * Handle mouse down event
	 */
	private onMouseDown(): void {
		if (this.enabled) {
			this.focused = true;
			this.setFillColor(this.focusedColor);
			this.setBorderColor([0.4, 0.4, 0.8, 1]);

			// Call onFocus callback if defined
			if (this.onFocusCallback) {
				this.onFocusCallback();
			}
		}
	}

	/**
	 * Handle mouse down outside the input (to lose focus)
	 */
	private onMouseDownOutside(): void {
		if (this.focused) {
			this.focused = false;
			this.setFillColor(this.normalColor);
			this.setBorderColor([0.3, 0.3, 0.3, 1]);

			// Call onBlur callback if defined
			if (this.onBlurCallback) {
				this.onBlurCallback();
			}
		}
	}

	/**
	 * Handle key press event
	 * @param key The key that was pressed
	 */
	private onKeyPress(key: string): void {
		if (!this.focused || !this.enabled) return;

		if (key === 'Backspace') {
			// Handle backspace
			if (this.value.length > 0) {
				this.setValue(this.value.substring(0, this.value.length - 1));
			}
		} else if (key === 'Enter') {
			// Handle enter key (lose focus)
			this.onMouseDownOutside();
		} else if (key.length === 1) {
			// Handle regular character input
			if (this.value.length < this.maxLength) {
				this.setValue(this.value + key);
			}
		}
	}
}
