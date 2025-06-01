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
	 * Layout method to calculate text dimensions
	 */
	public layout(): void {
		// Estimate text dimensions based on font size
		const charWidth = this.fontSize * 0.6; // Approximate character width
		const estimatedWidth = this.text.length * charWidth;
		const estimatedHeight = this.fontSize * 1.2; // Line height factor

		this.setSize(estimatedWidth, estimatedHeight);

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

		// Draw the text at screen position
		renderer.drawText(this.text, xPos, yPos, this.color, this.fontSize, this.align, this.baseline);

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
