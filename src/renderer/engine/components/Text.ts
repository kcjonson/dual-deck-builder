import { Component, ComponentOptions } from './Component';
import { RendererContext } from '../rendering/RendererContext';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';
import { Style, StyleParser } from '../types/Style';

/**
 * Text-specific options
 */
export type TextOptions = ComponentOptions;

/**
 * Text component for rendering text
 */
export class Text extends Component {
	private text: string;
	private fontSize = 16;
	private fontFamily = 'Arial';
	private color: [number, number, number, number] = [1, 1, 1, 1];
	private align: 'left' | 'center' | 'right' = 'left';
	private baseline: 'top' | 'middle' | 'bottom' = 'top';
	private lineHeight = 1.2;
	private whiteSpace: 'normal' | 'nowrap' = 'normal';
	private textOverflow: 'visible' | 'hidden' | 'ellipsis' = 'visible';
	private wrappedText = '';

	/**
	 * Create a new text component
	 * @param text Text content
	 * @param options Optional configuration including style
	 */
	constructor(text = '', options?: TextOptions) {
		super(options);
		this.text = text;
		this.componentType = 'Text';

		if (options?.style) {
			this.applyTextStyle(options.style);
		}

		// Initialize wrapped text after dimensions and styles are set
		this.updateWrappedText();
	}

	/**
	 * Apply text-specific style properties
	 */
	private applyTextStyle(style: Style): void {
		if (style.fontSize !== undefined) {
			this.fontSize = this.parseSize(style.fontSize);
		}
		if (style.fontFamily !== undefined) {
			this.fontFamily = style.fontFamily;
		}
		if (style.color !== undefined) {
			this.color = StyleParser.parseColor(style.color);
		}
		if (style.textAlign !== undefined) {
			this.align = style.textAlign;
		}
		if (style.verticalAlign !== undefined) {
			this.baseline = style.verticalAlign;
		}
		if (style.lineHeight !== undefined) {
			this.lineHeight = style.lineHeight;
		}
		if (style.whiteSpace !== undefined) {
			this.whiteSpace = style.whiteSpace;
		}
		if (style.textOverflow !== undefined) {
			this.textOverflow = style.textOverflow;
		}
	}

	/**
	 * Set the text content
	 * @param text Text content
	 */
	public setText(text: string): this {
		this.text = text;
		this.updateWrappedText();
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
	 * @param color Color value (hex string or RGBA array)
	 */
	public setColor(color: string | [number, number, number, number]): this {
		this.color = StyleParser.parseColor(color);
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
	 * Get the font size
	 */
	public getFontSize(): number {
		return this.fontSize;
	}

	/**
	 * Update wrapped text based on current settings
	 */
	private updateWrappedText(): void {
		// Default to original text if no wrapping needed
		if (this.whiteSpace === 'nowrap' || this.width <= 0) {
			this.wrappedText = this.text;
			return;
		}

		// Estimate character width for wrapping (more conservative estimate)
		const charWidth = this.fontSize * 0.5; // Reduced from 0.6 to be more aggressive with wrapping
		const maxCharsPerLine = Math.floor(this.width / charWidth);
		
		// If width is too small, just use original text
		if (maxCharsPerLine <= 5) {
			this.wrappedText = this.text;
			return;
		}

		const words = this.text.split(' ');
		const lines: string[] = [];
		let currentLine = '';

		for (const word of words) {
			const testLine = currentLine ? `${currentLine} ${word}` : word;
			
			if (testLine.length <= maxCharsPerLine) {
				currentLine = testLine;
			} else {
				if (currentLine) {
					lines.push(currentLine);
				}
				// Handle very long words by just adding them
				currentLine = word;
			}
		}

		if (currentLine) {
			lines.push(currentLine);
		}

		// Handle text overflow with ellipsis
		if (this.textOverflow === 'ellipsis' && this.height > 0) {
			const maxLines = Math.floor(this.height / (this.fontSize * this.lineHeight));
			if (lines.length > maxLines && maxLines > 0) {
				lines.splice(maxLines);
				if (lines.length > 0) {
					lines[lines.length - 1] += '...';
				}
			}
		}

		this.wrappedText = lines.join('\n');
	}

	/**
	 * Layout method to calculate text dimensions
	 */
	public layout(): void {
		// For existing text without explicit dimensions, calculate based on original text first
		if (this.width === 0 || this.height === 0) {
			const charWidth = this.fontSize * 0.6;
			const lines = this.text.split('\n');
			const maxLineLength = Math.max(...lines.map(line => line.length));
			
			const estimatedWidth = maxLineLength * charWidth;
			const estimatedHeight = lines.length * this.fontSize * this.lineHeight;

			if (this.width === 0) this.setWidth(estimatedWidth);
			if (this.height === 0) this.setHeight(estimatedHeight);
		}

		// Now update wrapped text based on final dimensions
		this.updateWrappedText();

		// Call parent layout for children
		super.layout();
	}

	/**
	 * Render the text
	 * @param context Render context with coordinate transforms
	 */
	public render(context?: RenderContext): void {
		if (!this.visible) return;

		// Use default context if none provided
		const ctx = context || DEFAULT_RENDER_CONTEXT;

		// Get the renderer instance
		const renderer = RendererContext.getInstance().getRenderer();

		// Calculate screen position
		const screenX = ctx.offsetX + this.x;
		const screenY = ctx.offsetY + this.y;

		// Calculate position based on alignment and bounding box
		let xPos = screenX;
		if (this.align === 'center' && this.width > 0) {
			xPos = screenX + this.width / 2;
		} else if (this.align === 'right' && this.width > 0) {
			xPos = screenX + this.width;
		}

		let yPos = screenY;
		if (this.baseline === 'middle' && this.height > 0) {
			yPos = screenY + this.height / 2;
		} else if (this.baseline === 'bottom' && this.height > 0) {
			yPos = screenY + this.height;
		}

		// Handle multi-line text rendering
		const textToRender = this.wrappedText || this.text;
		const lines = textToRender.split('\n');
		const lineHeight = this.fontSize * this.lineHeight;
		
		// Render each line separately
		for (let i = 0; i < lines.length; i++) {
			const lineY = yPos + (i * lineHeight);
			renderer.drawText(lines[i], xPos, lineY, this.color, this.fontSize, this.align, this.baseline);
		}

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
}
