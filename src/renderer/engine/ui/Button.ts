import { Component, ComponentOptions, PointerEvents } from '../components/Component';
import { Icon } from '../components/Icon';
import type { AnyUiEvent } from '../input/events';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import type { IconName } from '../text/icons';
import { tokens } from '../theme/tokens';

export interface ButtonOptions extends ComponentOptions {
	/** R12.7's leading icon, drawn before the label; the pair is centred together. */
	icon?: IconName;
}

/** The leading icon's em square and its gap to the label, as multiples of the label size. */
const ICON_SCALE = 1.25;
const ICON_GAP = 0.375;

/**
 * Button UI component
 */
export class Button extends Component {
	private background: Rectangle;
	private text: Text;
	private icon: Icon | null = null;
	/** The icon and gap the label's box gives up on its left. */
	private labelInset = 0;
	private pressed = false;

	// Button appearance states
	private normalColor = '#3333cc';
	private hoverColor = '#4d4de6';
	private pressedColor = '#1a1ab3';
	private disabledColor = '#808080';

	/**
	 * Create a new button
	 * @param label Text to display on the button
	 * @param options Optional configuration including style
	 */
	constructor(label = '', options?: ButtonOptions) {
		super(options);
		this.componentType = 'Button';

		// Create background rectangle at local origin
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: this.width,
			height: this.height,
			style: {
				backgroundColor: this.normalColor,
				border: '2px solid #1a1a1a',
				borderRadius: '5px',
			},
		});
		this.addPart(this.background);

		// Create text child component for the label at local origin
		this.text = new Text(label, {
			x: 0,
			y: 0,
			width: this.width,
			height: this.height,
			style: {
				color: '#ffffff',
				textAlign: 'center',
				verticalAlign: 'middle',
				whiteSpace: 'nowrap',
			},
		});
		this.addPart(this.text);

		if (options?.icon) {
			this.icon = new Icon({ glyph: options.icon, size: this.iconSize, tint: tokens.color.text_bright });
			this.addPart(this.icon);
		}
	}

	/** R8.29: the label and background are internals, not targets. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/**
	 * The icon sits against the label's measured width, which exists from
	 * mount (R1.6); the layout phase places it before the first render, and a
	 * new label, font size, or size lays it out again (R8.18).
	 */
	protected layoutChildren(): void {
		if (this.icon) this.placeIcon(this.icon);
	}

	/**
	 * R9.11's press, without capture: the click itself is the dispatcher's,
	 * synthesised only when the press and the release both land on this
	 * button (R9.31), and never while disabled (R9.5). The callbacks run
	 * first, so `onClick` is the base class's callback property.
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'pointerenter':
				if (this.enabled) this.background.setFillColor(this.pressed ? this.pressedColor : this.hoverColor);
				return;
			case 'pointerleave':
				this.pressed = false;
				if (this.enabled) this.background.setFillColor(this.normalColor);
				return;
			case 'pointerdown':
				if (event.button !== 0) return;
				this.pressed = true;
				this.background.setFillColor(this.pressedColor);
				return;
			case 'pointerup':
			case 'pointercancel':
				if (!this.pressed) return;
				this.pressed = false;
				if (this.enabled) this.background.setFillColor(this.hovered ? this.hoverColor : this.normalColor);
				return;
		}
	}

	/**
	 * Set the button's label text
	 * @param text Button label text
	 */
	public setLabel(text: string): this {
		this.text.setText(text);
		return this;
	}

	/**
	 * Set the font size
	 * @param size Font size in pixels
	 */
	public setFontSize(size: number): this {
		this.text.setFontSize(size);
		return this;
	}

	/**
	 * Set the button's size and update the text position
	 */
	public setSize(width: number, height: number): this {
		super.setSize(width, height);

		// Update the text position and size to match button
		this.updateTextPosition();

		return this;
	}

	/**
	 * Set the button's position and update the text position
	 */
	public setPosition(x: number, y: number): this {
		super.setPosition(x, y);

		// Update text position based on button position
		this.updateTextPosition();

		return this;
	}

	/**
	 * Update the positions of all child components
	 */
	private updateTextPosition(): void {
		// Children should be positioned relative to button's local origin (0,0)
		// Background at button origin
		this.background.setPosition(0, 0);
		this.background.setSize(this.width, this.height);

		// Text centred in what the icon leaves (all of it without one)
		this.text.setPosition(this.labelInset, 0);
		this.text.setSize(this.width - this.labelInset, this.height);
	}

	private get iconSize(): number {
		return Math.round(this.text.getFontSize() * ICON_SCALE);
	}

	/**
	 * Icon, gap and label are centred as one group: the label's box gives up
	 * the icon and gap on its left, which moves its centre right by half of
	 * them, and the icon sits just before the label's left edge. The width is
	 * the label's own measure, so its tracking and transform count (R12.7);
	 * nothing moves while the label cannot be measured.
	 */
	private placeIcon(icon: Icon): void {
		const labelWidth = this.text.measured?.width;
		if (labelWidth === undefined) return;
		const iconSize = this.iconSize;
		const gap = Math.round(this.text.getFontSize() * ICON_GAP);
		const groupLeft = (this.width - (iconSize + gap + labelWidth)) / 2;
		icon.size = iconSize;
		icon.setPosition(Math.round(groupLeft), Math.round((this.height - iconSize) / 2));
		this.labelInset = iconSize + gap;
		this.updateTextPosition();
	}

	/**
	 * Set whether the button is enabled
	 * @param enabled Enabled state
	 */
	public setEnabled(enabled: boolean): this {
		super.setEnabled(enabled);

		// Update appearance based on enabled state
		if (!this.enabled) {
			this.background.setFillColor(this.disabledColor);
		} else {
			this.background.setFillColor(this.normalColor);
		}

		return this;
	}

	/**
	 * Set the fill color of the button background
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: string | [number, number, number, number]): this {
		this.background.setFillColor(color);
		return this;
	}

	/**
	 * Set the border color of the button background
	 * @param color Color value (hex string or RGBA array)
	 */
	public setBorderColor(color: string | [number, number, number, number]): this {
		this.background.setBorderColor(color);
		return this;
	}

	/**
	 * Set the border width of the button background
	 * @param width Border width in pixels
	 */
	public setBorderWidth(width: number): this {
		this.background.setBorderWidth(width);
		return this;
	}

	/**
	 * Set the corner radius of the button background
	 * @param radius Corner radius in pixels
	 */
	public setCornerRadius(radius: number): this {
		this.background.setCornerRadius(radius);
		return this;
	}
}
