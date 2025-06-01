import { Layer, LayerOptions } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';

/**
 * Panel creation options
 */
export interface PanelOptions extends LayerOptions {
	// Additional panel-specific options can be added here
}

/**
 * Panel UI component for creating UI containers with backgrounds
 * Panels are non-interactive containers that provide visual grouping
 */
export class Panel extends Layer {
	private background: Rectangle;

	/**
	 * Create a new panel
	 * @param options Optional configuration including style
	 */
	constructor(options?: PanelOptions) {
		super(options);
		this.componentType = 'Panel';

		// Create background rectangle as first child
		this.background = new Rectangle({
			x: this.x,
			y: this.y,
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
		this.addChild(this.background);
	}

	/**
	 * Override setPosition to update background position
	 */
	public setPosition(x: number, y: number): this {
		super.setPosition(x, y);
		if (this.background) {
			this.background.setPosition(x, y);
		}
		return this;
	}

	/**
	 * Override setSize to update background size
	 */
	public setSize(width: number, height: number): this {
		super.setSize(width, height);
		if (this.background) {
			this.background.setSize(width, height);
		}
		return this;
	}

	/**
	 * Layout method to position background and children
	 */
	public layout(): void {
		// Ensure background matches panel position and size
		if (this.background) {
			this.background.setPosition(this.x, this.y);
			this.background.setSize(this.width, this.height);
		}
		
		// Call parent layout for children
		super.layout();
	}
}
