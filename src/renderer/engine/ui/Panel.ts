import { Rectangle } from '../components/Rectangle';
import { ComponentOptions } from '../types/Style';

/**
 * Panel UI component for creating UI containers with backgrounds
 */
export class Panel extends Rectangle {
	/**
	 * Create a new panel
	 * @param options Optional configuration including style
	 */
	constructor(options?: ComponentOptions) {
		super(options);
		this.componentType = 'Panel';

		// Set default appearance if no style provided
		if (!options?.style?.backgroundColor) {
			this.setFillColor('#333333cc');  // cc = 80% alpha
		}
		if (!options?.style?.borderColor && !options?.style?.border) {
			this.setBorderColor('#4d4d4d');
			this.setBorderWidth(1);
		}
		if (!options?.style?.borderRadius) {
			this.setCornerRadius(5);
		}
	}

	/**
	 * Add padding to all child components
	 * @param _padding Padding amount in pixels
	 */
	public setPadding(_padding: number): this {
		// This could be implemented by adjusting the positions of children
		// For now, it's just stored as a property
		return this;
	}

	/**
	 * Render the panel and all its children
	 */
	public render(): void {
		super.render();

		// Panel-specific rendering logic could be added here if needed
	}
}
