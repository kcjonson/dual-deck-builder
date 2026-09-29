import type { ClickCallback, ComponentOptions, ResolvedColors } from '../components/Component';
import type { SizeMode } from '../components/layoutTypes';
import { Text } from '../components/Text';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { Look, LookLayers, resolveLook } from '../style/look';
import { LookTransition } from '../style/LookTransition';
import { rowLayers } from '../style/variants';
import { tokens } from '../theme/tokens';
import { Pressable } from './Pressable';

export interface ListRowOptions extends Omit<ComponentOptions, 'style'> {
	label: string;
	/** Right-aligned secondary text in the mono role (a count, a cost, a hotkey). */
	trailing?: string;
	/** The parent list's selection, shown with the selected wash and the accent bar. */
	selected?: boolean;
	/** The unavailable look: dim text, still clickable (a disabled row is `enabled: false`). */
	dim?: boolean;
	/** Extra left inset for the label, for nesting. */
	indent?: number;
	onClick?: ClickCallback;
}

const { color } = tokens;

/**
 * R12.8's list row: a left-aligned label, an optional trailing mono text,
 * a hover wash, a selected wash with a 2 px accent bar on the left, and a
 * bottom hairline. It is pressed like a button (`Pressable`) and never
 * uppercases. Selection belongs to the parent list (a focus group, R12.34):
 * the row reports clicks and draws `selected`, it never selects itself.
 *
 * Rows abut in a list and are clipped by a scroll container, so the focus
 * ring is drawn inside the row rather than outside it, and the row reports
 * no ink beyond its box.
 */
export class ListRow extends Pressable {
	private readonly label: Text;
	private readonly trailingText: Text | null;
	private rowIndent: number;
	private isDim: boolean;
	private layers: LookLayers;
	private readonly transition: LookTransition;

	constructor({ label, trailing, selected = false, dim = false, indent = 0, onClick, ...options }: ListRowOptions) {
		super({ focusable: true, ...options, height: options.height ?? tokens.control.control_h_sm });
		this.componentType = 'ListRow';
		this.rowIndent = indent;
		this.isDim = dim;
		this.layers = rowLayers({ dim });
		this.selected = selected;
		if (onClick) this.onClick = onClick;

		this.label = new Text(label, {
			style: { fontFamily: 'body', fontSize: tokens.fontSize.fs_base, verticalAlign: 'middle', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
		});
		this.addPart(this.label);
		this.trailingText = trailing !== undefined
			? new Text(trailing, {
				style: { fontFamily: 'monospace', fontSize: tokens.fontSize.fs_xs, color: [...color.text_dim] as [number, number, number, number], verticalAlign: 'middle', whiteSpace: 'nowrap' },
			})
			: null;
		if (this.trailingText) this.addPart(this.trailingText);

		this.transition = new LookTransition({ owner: this, look: this.targetLook, onChange: (look) => this.followLook(look) });
		this.followLook(this.transition.look);
		this.placeParts();
	}

	/** A row spans its list unless it is given a width (R10.1's `fill` on a column's cross axis). */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'fill';
	}

	public get labelText(): string {
		return this.label.getText();
	}

	public set labelText(text: string) {
		this.label.setText(text);
	}

	public get trailing(): string | null {
		return this.trailingText?.getText() ?? null;
	}

	public get dim(): boolean {
		return this.isDim;
	}

	public set dim(dim: boolean) {
		if (dim === this.isDim) return;
		this.isDim = dim;
		this.layers = rowLayers({ dim });
		this.onStateChange();
	}

	public get indent(): number {
		return this.rowIndent;
	}

	public set indent(indent: number) {
		if (indent === this.rowIndent) return;
		this.rowIndent = indent;
		this.invalidateLayout();
	}

	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	public get look(): Look {
		return this.transition.look;
	}

	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, text: look.text };
	}

	protected layoutChildren(): void {
		this.placeParts();
	}

	protected onMount(): void {
		this.transition.moveTo(this.targetLook, null);
	}

	protected onUnmount(): void {
		super.onUnmount();
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		super.onStateChange();
		// `selected` is set in the constructor before the transition exists.
		if (this.transition) this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const { width, height } = this;
		if (look.fill[3] > 0) draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: 0, width, height }, fill: look.fill });
		const hairline = tokens.borderWidth.bw_hair;
		draw.drawRect({ rect: { x: 0, y: height - hairline, width, height: hairline }, fill: color.line_hairline });
		if (this.selected) {
			draw.drawRect({ rect: { x: 0, y: 0, width: tokens.borderWidth.bw_thick, height }, fill: color.accent });
		}
		if (look.focusRing) {
			draw.drawRect({
				rect: { x: 0, y: 0, width, height },
				fill: CLEAR,
				border: { color: look.focusRing, width: tokens.control.focus_ring_width, position: 'inside' },
			});
		}
	}

	private get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}

	private followLook(look: Look): void {
		this.label.setColor([...look.text] as [number, number, number, number]);
	}

	/**
	 * The label from the row inset plus the indent to the trailing text (or
	 * the right inset), ellipsised when it runs out of room; the trailing
	 * text hugs at the right inset.
	 */
	private placeParts(): void {
		const inset = tokens.control.inset_row;
		let right = this.width - inset;
		const trailing = this.trailingText;
		if (trailing) {
			trailing.setHeight(this.height);
			trailing.setPosition(right - trailing.width, 0);
			right -= trailing.width + inset;
		}
		const left = inset + this.rowIndent;
		this.label.setPosition(left, 0);
		this.label.setSize(Math.max(0, right - left), this.height);
	}
}

const CLEAR: RGBA = [0, 0, 0, 0];
