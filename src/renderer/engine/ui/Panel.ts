import type { Vec2 } from '../draw/geometry';
import type { DrawApi } from '../draw/DrawApi';
import { Layer, LayerOptions } from '../components/Layer';
import { BoxStyle, drawBox, resolveBoxStyle } from '../components/Rectangle';
import type { Interactive } from '../input/InputSystem';
import type { MountContext } from '../components/MountContext';

/**
 * Panel creation options
 */
export interface PanelOptions extends LayerOptions {
	scrollable?: boolean;
	scrollDirection?: 'vertical' | 'horizontal' | 'both';
}

const DEFAULT_BOX: BoxStyle = {
	fill: [0.2, 0.2, 0.2, 0.8],
	borderColor: [0x4d / 255, 0x4d / 255, 0x4d / 255, 1],
	borderWidth: 1,
	cornerRadius: 5,
};

/**
 * A container with a background box, optionally scrolling its children.
 *
 * The background is the panel's own draw (R8.1) and the children are exactly
 * what callers added (R8.6): there is no background child and no content
 * layer. Scrolling is R4.9's pair, a clip at the panel's box and a
 * `contentOffset` the walk applies inside it, so the clip stays fixed on
 * screen while the content moves (R4.10), and rows scrolled out of view are
 * dropped by the draw API's cull against that clip (R4.2a).
 */
export class Panel extends Layer implements Interactive {
	public scrollable = false;
	private box: BoxStyle;
	private scrollDirection: 'vertical' | 'horizontal' | 'both' = 'vertical';
	private scrollOffsetX = 0;
	private scrollOffsetY = 0;
	private scrollExtentWidth = 0;
	private scrollExtentHeight = 0;

	/**
	 * Create a new panel
	 * @param options Optional configuration including style
	 */
	constructor(options?: PanelOptions) {
		super(options);
		this.componentType = 'Panel';

		// A zero is no value here, as it was when the background was a child
		// Rectangle built with `||` defaults.
		const style = options?.style;
		this.box = resolveBoxStyle({
			backgroundColor: style?.backgroundColor || '#333333cc',
			borderColor: style?.borderColor || '#4d4d4d',
			borderWidth: style?.borderWidth || 1,
			borderRadius: style?.borderRadius || 5,
			border: style?.border,
		}, DEFAULT_BOX);

		// Set scroll properties
		if (options?.scrollable !== undefined) {
			this.scrollable = options.scrollable;
			// Automatically set overflow to hidden for scrollable panels
			if (this.scrollable) {
				this.setOverflow('hidden');
			}
		}
		if (options?.scrollDirection !== undefined) {
			this.scrollDirection = options.scrollDirection;
		}
	}

	protected onMount({ input }: MountContext): void {
		if (this.scrollable) {
			input.registerWheel(this, (deltaX, deltaY) => this.onWheel(deltaX, deltaY));
		}
	}

	public render(draw: DrawApi): void {
		drawBox(draw, this.id, this.width, this.height, this.box);
	}

	/** R4.9: the scroll position, which the walk and the hit test both subtract from children. */
	public get contentOffset(): Vec2 {
		return { x: this.scrollOffsetX, y: this.scrollOffsetY };
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
			const maxScrollY = this.scrollExtentHeight - this.height;
			const newScrollY = this.scrollOffsetY + deltaY;
			this.scrollOffsetY = Math.max(0, Math.min(maxScrollY, newScrollY));
		}
		if (this.scrollDirection === 'horizontal' || this.scrollDirection === 'both') {
			const maxScrollX = this.scrollExtentWidth - this.width;
			const newScrollX = this.scrollOffsetX + deltaX;
			this.scrollOffsetX = Math.max(0, Math.min(maxScrollX, newScrollX));
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
			this.scrollExtentWidth = width;
		}
		if (height !== undefined) {
			this.scrollExtentHeight = height;
		}
		return this;
	}

	/** A scrollable panel clips its content whatever its overflow says. */
	public get clipsChildren(): boolean {
		return (this.scrollable || this.getOverflow() === 'hidden') && this.width > 0 && this.height > 0;
	}

	public onWheel(deltaX: number, deltaY: number): void {
		if (this.scrollable) {
			// Convert wheel delta to scroll amount
			const scrollAmount = 30; // pixels per wheel notch
			this.scroll(deltaX * scrollAmount, deltaY * scrollAmount);
		}
	}
}
