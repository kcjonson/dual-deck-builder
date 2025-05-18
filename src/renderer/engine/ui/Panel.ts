import { Rectangle } from '../components/Rectangle';

/**
 * Panel UI component for creating UI containers with backgrounds
 */
export class Panel extends Rectangle {
	/**
	 * Create a new panel
	 * @param id Unique identifier for this component
	 */
	constructor(id: string) {
		super(id);

		// Set default appearance
		this.setFillColor([0.2, 0.2, 0.2, 0.8]);
		this.setBorderColor([0.3, 0.3, 0.3, 1]);
		this.setBorderWidth(1);
		this.setCornerRadius(5);
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
