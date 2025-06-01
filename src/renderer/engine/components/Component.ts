import { Layer, LayerOptions } from './Layer';
import { Interactive } from '../input/InputSystem';
import { RenderContext } from '../rendering/RenderContext';

/**
 * Component creation options (extends layer options)
 */
export type ComponentOptions = LayerOptions;

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
	 * @param context Render context with coordinate transforms
	 */
	public abstract render(context?: RenderContext): void;
}
