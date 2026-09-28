import type { ComponentOptions, ResolvedColors } from '../components/Component';
import type { Axis, Size, SizeMode } from '../components/layoutTypes';
import type { TextTransform } from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect } from '../draw/geometry';
import type { FontRole } from '../text/fontFaces';
import { Look, LookLayers, resolveLook } from '../style/look';
import { LookTransition } from '../style/LookTransition';
import { Pressable } from './Pressable';

/** How a label is set: the face, size, tracking, and case it is measured and drawn with. */
export interface LabelFace {
	font: FontRole;
	size: number;
	/** Em. */
	letterSpacing: number;
	textTransform: TextTransform;
}

export interface LabelledPressableOptions extends Omit<ComponentOptions, 'style'> {
	label: string;
	face: LabelFace;
	layers: LookLayers;
	/** Horizontal room either side of the label. */
	inset: number;
}

/**
 * A pressable whose content is one label it draws itself, in a look from
 * R11.12's layers: a tab (R12.16) and a segment (R12.17). It hugs the
 * label's measured width plus `inset` either side, measured with the same
 * face, tracking, and case it is drawn with (R12.7), unless given a width.
 */
export abstract class LabelledPressable extends Pressable {
	private labelText: string;
	private readonly face: LabelFace;
	private readonly inset: number;
	protected layers: LookLayers;
	protected readonly transition: LookTransition;

	constructor({ label, face, layers, inset, ...options }: LabelledPressableOptions) {
		super({ focusable: true, ...options });
		this.labelText = label;
		this.face = face;
		this.inset = inset;
		this.layers = layers;
		this.transition = new LookTransition({ owner: this, look: this.targetLook });
	}

	/** Hugs its label on an axis it was given no size on. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	public get label(): string {
		return this.labelText;
	}

	public set label(label: string) {
		this.labelText = label;
		this.invalidateLayout();
	}

	public get look(): Look {
		return this.transition.look;
	}

	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, text: look.text };
	}

	/** The label's measured width with the insets; zero while nothing can measure. */
	public get hugWidth(): number {
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText(this.face.font)) return 0;
		const { font, size, letterSpacing, textTransform } = this.face;
		return Math.ceil(draw.measureText({ text: this.labelText, font, size, letterSpacing, textTransform, wrap: 'none' }).width) + this.inset * 2;
	}

	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		return {
			width: definite === 'width' ? availableWidth : this.widthMode === 'fixed' ? this.width : this.hugWidth,
			height: definite === 'height' ? availableHeight : this.height,
		};
	}

	/** Outside a stack a hugging item sizes itself; inside one, the stack assigns it (R10.5). */
	protected layoutChildren(): void {
		if (this.widthMode === 'hug' && !this.parent?.sizesChildren) this.resizeInLayout(this.hugWidth, this.height);
	}

	protected onMount(): void {
		this.transition.moveTo(this.targetLook, null);
		this.invalidateLayout();
	}

	protected onUnmount(): void {
		super.onUnmount();
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		super.onStateChange();
		// State set in a subclass constructor arrives before the transition exists.
		if (this.transition) this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
	}

	/** The label, centred in `box`, in the look's text colour. */
	protected drawLabel(draw: DrawApi, box: Rect): void {
		const { font, size, letterSpacing, textTransform } = this.face;
		draw.drawText({
			text: this.labelText,
			box,
			font,
			size,
			letterSpacing,
			textTransform,
			color: this.transition.look.text,
			align: 'center',
			verticalAlign: 'middle',
			wrap: 'none',
			overflow: 'ellipsis',
		});
	}

	protected get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}
}
