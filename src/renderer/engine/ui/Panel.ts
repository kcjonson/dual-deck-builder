import { Layer, LayerOptions } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';
import { Interactive, InputSystem } from '../input/InputSystem';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';

/**
 * Panel creation options
 */
export interface PanelOptions extends LayerOptions {
	scrollable?: boolean;
	scrollDirection?: 'vertical' | 'horizontal' | 'both';
}

/**
 * Panel UI component for creating UI containers with backgrounds
 * Panels are non-interactive containers that provide visual grouping
 */
export class Panel extends Layer implements Interactive {
	private background: Rectangle;
	private contentLayer: Layer;
	private scrollable = false;
	private scrollDirection: 'vertical' | 'horizontal' | 'both' = 'vertical';
	private scrollOffsetX = 0;
	private scrollOffsetY = 0;
	private contentWidth = 0;
	private contentHeight = 0;

	/**
	 * Create a new panel
	 * @param options Optional configuration including style
	 */
	constructor(options?: PanelOptions) {
		super(options);
		this.componentType = 'Panel';

		// Set scroll properties
		if (options?.scrollable !== undefined) {
			this.scrollable = options.scrollable;
		}
		if (options?.scrollDirection !== undefined) {
			this.scrollDirection = options.scrollDirection;
		}

		// Create background rectangle as UI element (at local origin)
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: this.width || 200,
			height: this.height || 100,
			style: {
				backgroundColor: options?.style?.backgroundColor || '#333333cc',
				borderColor: options?.style?.borderColor || '#4d4d4d',
				borderWidth: options?.style?.borderWidth || 1,
				borderRadius: options?.style?.borderRadius || 5,
				border: options?.style?.border,
			},
		});
		super.addChild(this.background);

		// Create content layer for user-added children (at local origin)
		this.contentLayer = new Layer({
			x: 0,
			y: 0,
			width: this.width || 200,
			height: this.height || 100,
		});
		super.addChild(this.contentLayer);

		// Register for wheel events if scrollable
		if (this.scrollable) {
			InputSystem.registerWheel(this as Interactive, (deltaX, deltaY) =>
				this.onWheel(deltaX, deltaY),
			);
		}
	}

	/**
	 * Override setSize to update background and content layer size
	 */
	public setSize(width: number, height: number): this {
		super.setSize(width, height);
		if (this.background) {
			this.background.setSize(width, height);
		}
		if (this.contentLayer) {
			this.contentLayer.setSize(width, height);
		}
		return this;
	}

	/**
	 * Override addChild to add to content layer instead of directly to panel
	 */
	public addChild(child: Layer): this {
		this.contentLayer.addChild(child);
		return this;
	}

	/**
	 * Override removeChild to remove from content layer
	 */
	public removeChild(child: Layer): boolean {
		const result = this.contentLayer.removeChild(child);
		return result;
	}

	/**
	 * Override getChildren to return content layer children
	 */
	public getChildren(): Layer[] {
		return this.contentLayer.getChildren();
	}

	/**
	 * Get the content layer (for advanced use cases)
	 */
	public getContentLayer(): Layer {
		return this.contentLayer;
	}

	/**
	 * Set scroll offset
	 */
	public setScrollOffset(x: number, y: number): this {
		if (!this.scrollable) return this;

		this.scrollOffsetX = x;
		this.scrollOffsetY = y;
		return this;
	}

	/**
	 * Get scroll offset
	 */
	public getScrollOffset(): { x: number; y: number } {
		return { x: this.scrollOffsetX, y: this.scrollOffsetY };
	}

	/**
	 * Scroll by delta amount
	 */
	public scroll(deltaX: number, deltaY: number): this {
		if (!this.scrollable) return this;

		console.log(
			`[Panel] Scroll called: deltaX=${deltaX}, deltaY=${deltaY}, contentSize=(${this.contentWidth}, ${this.contentHeight}), panelSize=(${this.width}, ${this.height})`,
		);

		if (this.scrollDirection === 'vertical' || this.scrollDirection === 'both') {
			const maxScrollY = this.contentHeight - this.height;
			const newScrollY = this.scrollOffsetY + deltaY;
			const clampedY = Math.max(0, Math.min(maxScrollY, newScrollY));
			console.log(
				`[Panel] Vertical scroll: maxScrollY=${maxScrollY}, newScrollY=${newScrollY}, clamped=${clampedY}`,
			);
			this.scrollOffsetY = clampedY;
		}
		if (this.scrollDirection === 'horizontal' || this.scrollDirection === 'both') {
			const maxScrollX = this.contentWidth - this.width;
			const newScrollX = this.scrollOffsetX + deltaX;
			const clampedX = Math.max(0, Math.min(maxScrollX, newScrollX));
			console.log(
				`[Panel] Horizontal scroll: maxScrollX=${maxScrollX}, newScrollX=${newScrollX}, clamped=${clampedX}`,
			);
			this.scrollOffsetX = clampedX;
		}

		return this;
	}

	/**
	 * Set the content dimensions for scrolling
	 * @param width Content width (defaults to panel width if not set)
	 * @param height Content height (defaults to panel height if not set)
	 */
	public setContentSize(width?: number, height?: number): this {
		if (width !== undefined) {
			this.contentWidth = width;
		}
		if (height !== undefined) {
			this.contentHeight = height;
		}
		console.log(
			`[Panel] Content size set: width=${this.contentWidth}, height=${this.contentHeight}, panel size=(${this.width}, ${this.height})`,
		);
		return this;
	}

	/**
	 * Get the content dimensions
	 */
	public getContentSize(): { width: number; height: number } {
		return { width: this.contentWidth, height: this.contentHeight };
	}

	/**
	 * Layout method to position background and children
	 */
	public layout(): void {
		// In local coordinates, background and content layer are at (0, 0)
		// Background always at panel origin
		if (this.background) {
			this.background.setPosition(0, 0);
			this.background.setSize(this.width, this.height);
		}

		// Content layer also at panel origin (scroll offset applied during render)
		if (this.contentLayer) {
			this.contentLayer.setPosition(0, 0);
			this.contentLayer.setSize(this.width, this.height);
		}

		// Call parent layout for children (this will layout UI elements and content layer)
		super.layout();
	}

	/**
	 * Override render to handle scrolling transformation
	 * @param context Render context with coordinate transforms
	 */
	public render(context?: RenderContext): void {
		if (!this.visible) return;

		// Use default context if none provided
		const ctx = context || DEFAULT_RENDER_CONTEXT;

		// Calculate screen position
		const screenX = ctx.offsetX + this.x;
		const screenY = ctx.offsetY + this.y;

		// Create context for this panel's children (background and content layer)
		const panelContext: RenderContext = {
			offsetX: screenX,
			offsetY: screenY,
		};

		// Render background at panel position (doesn't scroll)
		if (this.background) {
			this.background.render(panelContext);
		}

		// Create context for content layer with scroll offset
		const contentContext: RenderContext = {
			offsetX: screenX - this.scrollOffsetX,
			offsetY: screenY - this.scrollOffsetY,
		};

		// Render content layer with scrolled context
		if (this.contentLayer) {
			this.contentLayer.render(contentContext);
		}

		// TODO: Render scrollbars here (they don't scroll)
	}

	// Interactive interface implementation
	public onMouseDown(_x: number, _y: number): void {
		// No-op for now
	}

	public onMouseUp(_x: number, _y: number): void {
		// No-op for now
	}

	public onMouseMove(_x: number, _y: number): void {
		// No-op for now
	}

	public onWheel(deltaX: number, deltaY: number): void {
		if (this.scrollable) {
			console.log(
				`[Panel] Wheel event: deltaX=${deltaX}, deltaY=${deltaY}, current offset: (${this.scrollOffsetX}, ${this.scrollOffsetY})`,
			);
			// Convert wheel delta to scroll amount
			const scrollAmount = 30; // pixels per wheel notch
			this.scroll(deltaX * scrollAmount, deltaY * scrollAmount);
			console.log(
				`[Panel] After scroll, new offset: (${this.scrollOffsetX}, ${this.scrollOffsetY})`,
			);
		}
	}

	public onKeyDown(_key: string): void {
		// No-op for now
	}

	public onKeyUp(_key: string): void {
		// No-op for now
	}

	/**
	 * Clean up resources and event handlers
	 */
	public cleanup(): void {
		// Unregister from input system if scrollable
		if (this.scrollable) {
			InputSystem.unregisterComponent(this as Interactive);
		}

		// Call parent cleanup
		super.cleanup();
	}
}
