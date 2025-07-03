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
			const wasHovered = this.hovered;
			this.hovered = hovered;
			
			if (hovered && !wasHovered) {
				this.onHover();
			} else if (!hovered && wasHovered) {
				this.onUnhover();
			}
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
			const wasFocused = this.focused;
			this.focused = focused;
			
			if (focused && !wasFocused) {
				this.onFocus();
			} else if (!focused && wasFocused) {
				this.onBlur();
			}
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
			const wasEnabled = this.enabled;
			this.enabled = enabled;
			
			if (!enabled) {
				// Clear interaction states when disabled
				this.setHovered(false);
				this.setFocused(false);
			}
			
			if (enabled && !wasEnabled) {
				this.onEnabled();
			} else if (!enabled && wasEnabled) {
				this.onDisabled();
			}
		}
	}

	/**
	 * Lifecycle methods - override these in subclasses to respond to state changes
	 */
	protected onHover(): void {
		// Override in subclasses
	}

	protected onUnhover(): void {
		// Override in subclasses
	}

	protected onFocus(): void {
		// Override in subclasses
	}

	protected onBlur(): void {
		// Override in subclasses
	}

	protected onEnabled(): void {
		// Override in subclasses
	}

	protected onDisabled(): void {
		// Override in subclasses
	}

	/**
	 * Semantic event methods - these represent high-level user intentions
	 * Override these in subclasses for component-specific behavior
	 */
	
	/**
	 * Called when the component is selected (could be click, keyboard, controller)
	 */
	protected onSelect(): void {
		// Override in subclasses
	}

	/**
	 * Called when the component is deselected
	 */
	protected onDeselect(): void {
		// Override in subclasses
	}

	/**
	 * Called when the component is activated/confirmed (double-click, enter, A button)
	 */
	protected onActivate(): void {
		// Override in subclasses
	}

	/**
	 * Called when the component becomes a target for another action
	 */
	protected onTarget(): void {
		// Override in subclasses
	}

	/**
	 * Called when the component is no longer a target
	 */
	protected onUntarget(): void {
		// Override in subclasses
	}

	/**
	 * Called when the component action is cancelled
	 */
	protected onCancel(): void {
		// Override in subclasses
	}

	/**
	 * Public methods to trigger semantic events
	 * These can be called by input systems or other components
	 */
	
	/**
	 * Trigger select event
	 */
	public select(): void {
		if (this.enabled) {
			this.onSelect();
		}
	}

	/**
	 * Trigger deselect event
	 */
	public deselect(): void {
		if (this.enabled) {
			this.onDeselect();
		}
	}

	/**
	 * Trigger activate event
	 */
	public activate(): void {
		if (this.enabled) {
			this.onActivate();
		}
	}

	/**
	 * Trigger target event
	 */
	public target(): void {
		if (this.enabled) {
			this.onTarget();
		}
	}

	/**
	 * Trigger untarget event
	 */
	public untarget(): void {
		if (this.enabled) {
			this.onUntarget();
		}
	}

	/**
	 * Trigger cancel event
	 */
	public cancel(): void {
		this.onCancel();
	}

	/**
	 * Unmount the component and unregister from InputSystem
	 */
	public unmount(): void {
		// Unregister from input system
		InputSystem.unregisterComponent(this);
		
		// Call parent unmount
		super.unmount();
	}
}
