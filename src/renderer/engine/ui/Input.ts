import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../components/Component';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import type { AnyUiEvent } from '../input/events';

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
		this.addPart(this.background);

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
				whiteSpace: 'nowrap',
			},
		});
		this.addPart(this.text);

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
				whiteSpace: 'nowrap',
			},
		});
		this.placeholderText = placeholder;
		this.addPart(this.placeholder);
		
		// Placed and sized from the text's metrics by updateCursorPosition
		this.cursor = new Rectangle({
			width: 2,
			style: {
				backgroundColor: '#ffffff',
			},
		});
		this.cursor.setVisible(false);
		this.addPart(this.cursor);
	}

	/** The field's fill and border and the value's colour, as they are drawn now. */
	public get resolvedColors(): ResolvedColors {
		return { ...this.background.resolvedColors, ...this.text.resolvedColors };
	}

	/** R8.29: the text, placeholder and caret are internals, not targets. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/**
	 * The caret follows the text's measured layout, which exists once the text
	 * has mounted and measured; its size change lays this out again (R8.18).
	 */
	protected layoutChildren(): void {
		this.updateCursorPosition();
	}

	/**
	 * A press focuses the field through the dispatcher's focus seam, and a
	 * press anywhere else blurs it (R9.23's fallback until DDB-76). Keys reach
	 * it only while focused; the ones it handles are consumed, so they never
	 * reach the hotkey table (R9.15).
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'pointerdown':
				this.context?.dispatcher.focus(this);
				return;
			case 'keydown':
				// R9.15: bound modifier chords (copy, a menu shortcut) are not text.
				if (event.modifiers.ctrl || event.modifiers.meta) return;
				if (this.handleKey(event.key)) event.consume();
				return;
		}
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
	 * Set the font size
	 * @param size Font size in pixels
	 */
	public setFontSize(size: number): this {
		this.text.setFontSize(size);
		this.placeholder.setFontSize(size);
		this.updateCursorPosition();
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
		this.updateCursorPosition();

		return this;
	}

	/**
	 * Update the visibility of the placeholder text based on input value
	 */
	private updatePlaceholderVisibility(): void {
		this.placeholder.setVisible(this.value.length === 0);
	}
	
	/**
	 * The caret sits after the last code point, at the pen position the text's
	 * own layout reports (R2.14), and spans the text's line box, which the
	 * text centres in the field.
	 */
	private updateCursorPosition(): void {
		if (!this.text || !this.cursor) return;
		const measured = this.text.measured;
		if (!measured) return;

		const textOffset = 10; // Same as text offset
		const advances = measured.advances;
		const lineHeight = measured.height / Math.max(1, measured.lines);
		this.cursor.setX(textOffset + (advances.length > 0 ? advances[advances.length - 1] : 0));
		this.cursor.setY((this.text.getHeight() - lineHeight) / 2);
		this.cursor.setHeight(lineHeight);
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

	protected onFocus(): void {
		this.background.setFillColor(this.focusedColor);
		this.background.setBorderColor([0.4, 0.4, 0.8, 1]);
		this.cursor.setVisible(true);
		this.cursorBlinkTimer = 0;
		this.requestUpdate();
	}

	protected onBlur(): void {
		this.background.setFillColor(this.normalColor);
		this.background.setBorderColor([0.3, 0.3, 0.3, 1]);
		this.cursor.setVisible(false);
	}

	/** Edits the value for one key; false for a key the field does not use. */
	private handleKey(key: string): boolean {
		if (!this.focused || !this.enabled) return false;

		if (key === 'Backspace') {
			if (this.value.length > 0) {
				this.setValue(this.value.substring(0, this.value.length - 1));
			}
			return true;
		}
		if (key === 'Enter') {
			this.context?.dispatcher.focus(null);
			return true;
		}
		if (key.length === 1) {
			if (this.value.length < this.maxLength) {
				this.setValue(this.value + key);
			}
			return true;
		}
		return false;
	}

	/**
	 * Update the input component (for cursor blinking)
	 * @param dt Delta time since last update
	 */
	public update(dt: number): void {
		// Blink only while focused; an unfocused input stops asking (R8.17).
		if (this.focused && this.cursor) {
			this.cursorBlinkTimer += dt;

			// Blink every 500ms
			const blinkInterval = 0.5;
			const visible = Math.floor(this.cursorBlinkTimer / blinkInterval) % 2 === 0;
			this.cursor.setVisible(visible);
			this.requestUpdate();
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
}
