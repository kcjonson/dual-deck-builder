import { Component, ComponentOptions } from '../components/Component';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';
import { InputSystem } from '../input/InputSystem';
import { RendererContext } from '../rendering/RendererContext';

/**
 * Input UI component for text input
 */
export class Input extends Component {
	private background: Rectangle;
	private text: Text;
	private placeholder: Text;
	private cursor: Rectangle;
	private value = '';
	private placeholderText = '';
	private maxLength = 100;
	private onChangeCallback: ((value: string) => void) | null = null;
	private onFocusCallback: (() => void) | null = null;
	private onBlurCallback: (() => void) | null = null;
	private cursorBlinkTimer = 0;

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

		// Create background rectangle at local origin
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: this.width || 200,
			height: this.height || 40,
			style: {
				backgroundColor: this.normalColor,
				borderColor: '#4d4d4d',
				borderWidth: 2,
				borderRadius: 3,
			},
		});
		this.addChild(this.background);

		// Create text child component for the input value at local origin
		const textOffset = 10; // Padding from left edge
		this.text = new Text('', {
			x: textOffset,
			y: 0,
			width: this.width - textOffset * 2,
			height: this.height,
			style: {
				color: '#ffffff',
				textAlign: 'left',
				verticalAlign: 'middle',
			},
		});
		this.text.setAlign('left');
		this.text.setBaseline('middle');
		this.addChild(this.text);

		// Create placeholder text at same position
		this.placeholder = new Text(placeholder, {
			x: textOffset,
			y: 0,
			width: this.width - textOffset * 2,
			height: this.height,
			style: {
				color: '#808080',
				textAlign: 'left',
				verticalAlign: 'middle',
			},
		});
		this.placeholder.setAlign('left');
		this.placeholder.setBaseline('middle');
		this.placeholderText = placeholder;
		this.addChild(this.placeholder);
		
		// Create cursor (initially hidden)
		this.cursor = new Rectangle({
			x: textOffset,
			y: this.height * 0.2,
			width: 2,
			height: this.height * 0.6,
			style: {
				backgroundColor: '#ffffff',
			},
		});
		this.cursor.setVisible(false);
		this.addChild(this.cursor);

		// Setup event handling (this would be connected to the input system)
		this.setupEvents();
	}

	/**
	 * Setup input event handling for the input field
	 */
	private setupEvents(): void {
		// Register mouse down handler for focusing
		InputSystem.registerMouseDown(this, () => this.onMouseDown());
		
		// Register keyboard handler
		InputSystem.registerKeyDown(this, (key: string) => this.onKeyPress(key));
	}

	/**
	 * Set the input's value
	 * @param value Input value
	 */
	public setValue(value: string): this {
		this.value = value.substring(0, this.maxLength);
		this.text.setText(this.value);
		this.updatePlaceholderVisibility();
		this.updateCursorPosition();

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
	 * Set the input's size and update child sizes
	 */
	public setSize(width: number, height: number): this {
		super.setSize(width, height);

		// Update background size
		if (this.background) {
			this.background.setSize(width, height);
		}

		// Update text sizes
		const textOffset = 10;
		if (this.text) {
			this.text.setSize(width - textOffset * 2, height);
		}
		if (this.placeholder) {
			this.placeholder.setSize(width - textOffset * 2, height);
		}

		return this;
	}

	/**
	 * Update the visibility of the placeholder text based on input value
	 */
	private updatePlaceholderVisibility(): void {
		this.placeholder.setVisible(this.value.length === 0);
	}
	
	/**
	 * Update the cursor position based on text width
	 */
	private updateCursorPosition(): void {
		if (!this.text || !this.cursor) return;
		
		// Get the renderer from the global context
		const renderer = RendererContext.getInstance().getRenderer();
		if (!renderer) return;
		
		// Get the font atlas to measure text
		const fontAtlas = renderer.getFontAtlas();
		if (!fontAtlas) return;
		
		// Measure the text width
		const measurement = fontAtlas.measureText(this.value);
		
		// Position cursor after the text with the same offset as the text
		const textOffset = 10; // Same as text offset
		this.cursor.setX(textOffset + measurement.width);
	}

	/**
	 * Set whether the input is enabled
	 * @param enabled Enabled state
	 */
	public setEnabled(enabled: boolean): this {
		super.setEnabled(enabled);

		// Update appearance based on enabled state
		this.text.setVisible(enabled);

		if (!this.enabled) {
			this.background.setFillColor(this.disabledColor);
		} else {
			this.background.setFillColor(this.focused ? this.focusedColor : this.normalColor);
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
	public setOnFocus(callback: () => void): this {
		this.onFocusCallback = callback;
		return this;
	}

	/**
	 * Set the onBlur callback
	 * @param callback Function to call when the input loses focus
	 */
	public setOnBlur(callback: () => void): this {
		this.onBlurCallback = callback;
		return this;
	}

	/**
	 * Override lifecycle methods to trigger callbacks
	 */
	protected onFocus(): void {
		super.onFocus();
		if (this.onFocusCallback) {
			this.onFocusCallback();
		}
	}

	protected onBlur(): void {
		super.onBlur();
		if (this.onBlurCallback) {
			this.onBlurCallback();
		}
	}

	/**
	 * Handle mouse down event
	 */
	private onMouseDown(): void {
		if (this.enabled) {
			// First check if we need to blur another input
			const currentFocus = InputSystem.getFocus();
			if (currentFocus && currentFocus !== this && 'onMouseDownOutside' in currentFocus) {
				(currentFocus as any).onMouseDownOutside();
			}
			
			this.setFocused(true);
			InputSystem.setFocus(this);
			this.background.setFillColor(this.focusedColor);
			this.background.setBorderColor([0.4, 0.4, 0.8, 1]);
			this.cursor.setVisible(true);
			this.cursorBlinkTimer = 0;

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
			this.setFocused(false);
			InputSystem.setFocus(null);
			this.background.setFillColor(this.normalColor);
			this.background.setBorderColor([0.3, 0.3, 0.3, 1]);
			this.cursor.setVisible(false);

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

	/**
	 * Update the input component (for cursor blinking)
	 * @param dt Delta time since last update
	 */
	public update(dt: number): void {
		super.update(dt);
		
		// Handle cursor blinking when focused
		if (this.focused && this.cursor) {
			this.cursorBlinkTimer += dt;
			
			// Blink every 500ms
			const blinkInterval = 0.5;
			const visible = Math.floor(this.cursorBlinkTimer / blinkInterval) % 2 === 0;
			this.cursor.setVisible(visible);
		}
	}
	
	/**
	 * Render this component
	 * @param context Render context with coordinate transforms
	 */
	public render(context?: RenderContext): void {
		if (!this.visible) return;

		// Use default context if none provided
		const ctx = context || DEFAULT_RENDER_CONTEXT;

		// Calculate screen position
		const screenX = ctx.offsetX + this.x;
		const screenY = ctx.offsetY + this.y;

		// Create child context with our position added
		const childContext: RenderContext = {
			offsetX: screenX,
			offsetY: screenY,
		};

		// Render children with transformed context
		for (const child of this.children) {
			if (child.isVisible()) {
				child.render(childContext);
			}
		}
	}

	/**
	 * Set the fill color of the input background
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: string | [number, number, number, number]): this {
		this.background.setFillColor(color);
		return this;
	}

	/**
	 * Set the border color of the input background
	 * @param color Color value (hex string or RGBA array)
	 */
	public setBorderColor(color: string | [number, number, number, number]): this {
		this.background.setBorderColor(color);
		return this;
	}

	/**
	 * Set the border width of the input background
	 * @param width Border width in pixels
	 */
	public setBorderWidth(width: number): this {
		this.background.setBorderWidth(width);
		return this;
	}

	/**
	 * Set the corner radius of the input background
	 * @param radius Corner radius in pixels
	 */
	public setCornerRadius(radius: number): this {
		this.background.setCornerRadius(radius);
		return this;
	}

	/**
	 * Clean up resources and event handlers
	 */
	public cleanup(): void {
		// Unregister from input system
		InputSystem.unregisterComponent(this);

		// Call parent cleanup
		super.cleanup();
	}
}
