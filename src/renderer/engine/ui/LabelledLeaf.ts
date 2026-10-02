import { Component, ComponentOptions } from '../components/Component';
import type { Axis, Size, SizeMode } from '../components/layoutTypes';
import type { Text } from '../components/Text';

/**
 * A leaf drawn around one measured label (a key cap, a badge): the label is
 * its part (R8.8), and the leaf hugs the label's measured width plus its own
 * padding (`hugWidth`) unless given a width. Outside a stack it sizes itself
 * in its layout; inside one the stack measures and assigns it (R10.5).
 *
 * The label hugs its own width too, so its measure on mount changes its
 * size, which invalidates this leaf's layout and re-sizes it (R8.18).
 */
export abstract class LabelledLeaf extends Component {
	protected readonly label: Text;

	constructor(options: ComponentOptions, label: Text) {
		super(options);
		this.label = label;
		this.addPart(label);
	}

	/** The width this leaf takes when it hugs: the label and whatever frames it. */
	public abstract get hugWidth(): number;

	/** Places the label in the current box. */
	protected abstract placeLabel(): void;

	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		return {
			width: definite === 'width' ? availableWidth : this.widthMode === 'fixed' ? this.width : this.hugWidth,
			height: definite === 'height' ? availableHeight : this.height,
		};
	}

	protected layoutChildren(): void {
		if (this.widthMode === 'hug' && !this.parent?.sizesChildren) this.resizeInLayout(this.hugWidth, this.height);
		this.placeLabel();
	}

	protected onResized(): void {
		super.onResized();
		// A size set by the base constructor arrives before the label exists.
		if (this.label) this.placeLabel();
	}
}
