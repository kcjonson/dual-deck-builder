import { Component, ComponentOptions } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import type { FontRole } from '../text/fontFaces';
import { resolveFontRole } from '../text/fontRoles';
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
	/** R11.8's role, from the style's `fontFamily` and `fontWeight` through the theme table. */
	private fontRole: FontRole = 'body';
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
		if (style.fontFamily !== undefined || style.fontWeight !== undefined) {
			this.fontRole = resolveFontRole({ family: style.fontFamily, weight: style.fontWeight });
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
		if (this.text === text) return this;
		this.text = text;
		this.updateWrappedText();
		// Content drives measurement (R8.18).
		this.invalidateLayout();
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
		if (this.fontSize === size) return this;
		this.fontSize = size;
		this.invalidateLayout();
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

	/** The font role this text draws with (R11.8). */
	get font(): FontRole {
		return this.fontRole;
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

	public render(draw: DrawApi): void {
		// Position based on alignment and bounding box
		let xPos = 0;
		if (this.align === 'center' && this.width > 0) {
			xPos = this.width / 2;
		} else if (this.align === 'right' && this.width > 0) {
			xPos = this.width;
		}

		let yPos = 0;
		if (this.baseline === 'middle' && this.height > 0) {
			yPos = this.height / 2;
		} else if (this.baseline === 'bottom' && this.height > 0) {
			yPos = this.height;
		}

		// Handle multi-line text rendering
		const textToRender = this.wrappedText || this.text;
		const lines = textToRender.split('\n');
		const lineHeight = this.fontSize * this.lineHeight;
		
		// Render each line separately. `position` and not `box`: `xPos` is
		// already the alignment anchor this component computed from its own
		// bounds, and `verticalAlign` puts that edge of the line box on
		// `lineY`. Real line boxes, and R2.13's `box`, are DDB-71's.
		for (let i = 0; i < lines.length; i++) {
			const lineY = yPos + (i * lineHeight);
			draw.drawText({
				id: this.id ?? undefined,
				text: lines[i],
				position: { x: xPos, y: lineY },
				font: this.fontRole,
				size: this.fontSize,
				color: this.color,
				align: this.align,
				verticalAlign: this.baseline,
			});
		}
	}
}
