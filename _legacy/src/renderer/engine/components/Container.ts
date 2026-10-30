import { Component, ComponentOptions, PointerEvents } from './Component';

export type ContainerOptions = ComponentOptions;

/**
 * R12.18's container: children, a clip when its overflow is hidden, a
 * content offset for a subclass that scrolls, and no visuals of its own.
 * Hit tests pass through it to its children (`passthrough`, R8.29).
 * `children` is exactly what the caller added, in insertion order.
 *
 * A box behind children is a Rectangle, or a Stack's `style`.
 */
export class Container extends Component {
	constructor(options?: ContainerOptions) {
		super(options);
		this.componentType = 'Container';
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'passthrough';
	}
}
