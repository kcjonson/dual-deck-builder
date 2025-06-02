import { Layer, LayerOptions } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';
import { Interactive, InputSystem } from '../input/InputSystem';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';
import { RendererContext } from '../rendering/RendererContext';

/**
 * Custom content layer that handles scroll offset for child hit testing
 */
class ScrollableContentLayer extends Layer {
	private panel: Panel;

	constructor(panel: Panel, options?: LayerOptions) {
		super(options);
		this.panel = panel;
	}

	/**
	 * Override globalToLocal to account for panel's scroll offset
	 */
	public globalToLocal(globalX: number, globalY: number): { x: number; y: number } {
		// Get the local coordinates from parent's perspective
		const localCoords = super.globalToLocal(globalX, globalY);
		
		// Add the scroll offset to account for scrolled content
		const scrollOffset = this.panel.getScrollOffset();
		return {
			x: localCoords.x + scrollOffset.x,
			y: localCoords.y + scrollOffset.y
		};
	}
}

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
		this.contentLayer = new ScrollableContentLayer(this, {
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


		if (this.scrollDirection === 'vertical' || this.scrollDirection === 'both') {
			const maxScrollY = this.contentHeight - this.height;
			const newScrollY = this.scrollOffsetY + deltaY;
			const clampedY = Math.max(0, Math.min(maxScrollY, newScrollY));
			this.scrollOffsetY = clampedY;
		}
		if (this.scrollDirection === 'horizontal' || this.scrollDirection === 'both') {
			const maxScrollX = this.contentWidth - this.width;
			const newScrollX = this.scrollOffsetX + deltaX;
			const clampedX = Math.max(0, Math.min(maxScrollX, newScrollX));
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

		// Apply overflow clipping specifically for the content layer if overflow is hidden
		const renderer = this.contentLayer ? RendererContext.getInstance().getRenderer() : null;
		let wasScissorEnabled = false;
		let previousScissorBox: Int32Array | null = null;

		if (this.getOverflow() === 'hidden' && this.width > 0 && this.height > 0 && renderer) {
			// Save current scissor state
			wasScissorEnabled = renderer.isScissorEnabled();
			if (wasScissorEnabled) {
				previousScissorBox = renderer.getContext().getParameter(renderer.getContext().SCISSOR_BOX);
			}

			// Convert from top-left UI coordinates to bottom-left WebGL coordinates
			const canvas = renderer.getContext().canvas as HTMLCanvasElement;
			const webglX = Math.floor(screenX);
			const webglY = Math.floor(canvas.height - screenY - this.height);
			const webglWidth = Math.floor(this.width);
			const webglHeight = Math.floor(this.height);

			// Enable scissor testing for the content area
			renderer.enableScissor(webglX, webglY, webglWidth, webglHeight);
		}

		// Render content layer with scrolled context (and clipping if enabled)
		if (this.contentLayer) {
			this.contentLayer.render(contentContext);
		}

		// Restore previous scissor state
		if (this.getOverflow() === 'hidden' && this.width > 0 && this.height > 0 && renderer) {
			if (wasScissorEnabled && previousScissorBox) {
				// Restore previous scissor box
				renderer.enableScissor(
					previousScissorBox[0],
					previousScissorBox[1], 
					previousScissorBox[2],
					previousScissorBox[3]
				);
			} else {
				// Disable scissor testing
				renderer.disableScissor();
			}
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
			// Convert wheel delta to scroll amount
			const scrollAmount = 30; // pixels per wheel notch
			this.scroll(deltaX * scrollAmount, deltaY * scrollAmount);
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
