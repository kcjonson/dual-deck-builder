import { Layer, LayerOptions } from './Layer';
import { Interactive, InputSystem } from '../input/InputSystem';
import { RenderContext } from '../rendering/RenderContext';

/**
 * Component creation options (extends layer options)
 */
export type ComponentOptions = LayerOptions;

/**
 * Base Component class that all interactive components will inherit from
 */
export abstract class Component extends Layer implements Interactive {
	// Standard interaction states
	protected hovered = false;
	protected focused = false;
	protected enabled = true;

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

	/**
	 * Get hover state
	 */
	public isHovered(): boolean {
		return this.hovered;
	}

	/**
	 * Set hover state (typically managed by InputSystem)
	 */
	public setHovered(hovered: boolean): void {
		if (this.hovered !== hovered) {
			this.hovered = hovered;
			this.onHoverChanged(hovered);
		}
	}

	/**
	 * Get focus state
	 */
	public isFocused(): boolean {
		return this.focused;
	}

	/**
	 * Set focus state
	 */
	public setFocused(focused: boolean): void {
		if (this.focused !== focused) {
			this.focused = focused;
			this.onFocusChanged(focused);
		}
	}

	/**
	 * Get enabled state
	 */
	public isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Set enabled state
	 */
	public setEnabled(enabled: boolean): void {
		if (this.enabled !== enabled) {
			this.enabled = enabled;
			if (!enabled) {
				// Clear interaction states when disabled
				this.setHovered(false);
				this.setFocused(false);
			}
			this.onEnabledChanged(enabled);
		}
	}

	/**
	 * Override these methods in subclasses to respond to state changes
	 */
	protected onHoverChanged(hovered: boolean): void {
		// Override in subclasses
	}

	protected onFocusChanged(focused: boolean): void {
		// Override in subclasses
	}

	protected onEnabledChanged(enabled: boolean): void {
		// Override in subclasses
	}

	/**
	 * Clean up the component and unregister from InputSystem
	 */
	public cleanup(): void {
		// Unregister from input system
		InputSystem.unregisterComponent(this);
		
		// Call parent cleanup
		super.cleanup();
	}
}
