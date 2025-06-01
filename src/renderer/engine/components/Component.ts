import { Layer, LayerOptions } from './Layer';
import { Interactive } from '../input/InputSystem';

/**
 * Component creation options (extends layer options)
 */
export interface ComponentOptions extends LayerOptions {
	// Additional component-specific options can be added here
}

/**
 * Base Component class that all interactive components will inherit from
 */
export abstract class Component extends Layer implements Interactive {
	/**
	 * Create a new component
	 * @param options Optional configuration options
	 */
	constructor(options?: ComponentOptions) {
		super(options);
		this.componentType = 'Component';
	}


	/**
	 * Render method to draw the component
	 * This should be implemented by each subclass
	 */
	public abstract render(): void;
}
