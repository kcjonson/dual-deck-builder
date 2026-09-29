import type { DrawApi } from '../draw/DrawApi';
import { Component, ComponentOptions, PointerEvents, ResolvedColors } from './Component';

export type LayerOptions = ComponentOptions;

/**
 * A plain container: children, an optional background fill, and a clip when
 * its overflow is hidden. Hit tests pass through it to its children (R8.29).
 */
export class Layer extends Component {
	private backgroundColor: [number, number, number, number] | null = null;

	constructor(options?: LayerOptions) {
		super(options);
		this.componentType = 'Layer';
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'passthrough';
	}

	/**
	 * Set the background color of the layer
	 * @param color RGBA color array [r, g, b, a] with values from 0-1
	 */
	public setBackgroundColor(color: [number, number, number, number] | null): this {
		// Gaining or losing the background changes how many groups it draws.
		if ((color === null) !== (this.backgroundColor === null)) this.invalidateInk();
		this.backgroundColor = color;
		return this;
	}

	/** Null without a background, and while the zero-sized box draws nothing. */
	public get resolvedColors(): ResolvedColors | null {
		if (this.backgroundColor === null || this.width <= 0 || this.height <= 0) return null;
		return { fill: this.backgroundColor };
	}

	public render(draw: DrawApi): void {
		if (this.backgroundColor === null || this.width <= 0 || this.height <= 0) return;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: this.backgroundColor,
		});
	}
}
