import type { ClickCallback, ComponentOptions, ResolvedColors } from '../../engine/components/Component';
import type { SizeMode } from '../../engine/components/layoutTypes';
import { Text } from '../../engine/components/Text';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { RGBA } from '../../engine/draw/geometry';
import { Look, LookLayers, resolveLook } from '../../engine/style/look';
import { LookTransition } from '../../engine/style/LookTransition';
import { rowLayers } from '../../engine/style/variants';
import { tokens } from '../../engine/theme/tokens';
import { Pressable } from '../../engine/ui/Pressable';

export interface RouteCardOptions extends Omit<ComponentOptions, 'style'> {
	/** The route's name. */
	title: string;
	/** What's known of it, mono, up to two lines: "charted / 4 stops / 5.2 h out / fuel 4 / risk 2 of 3". */
	detail: string;
	/** A line under the detail in the warning colour (past dark, or fuel the stores can't pay); none when null. */
	note?: string | null;
	/** The parent list's pick, shown with the selected wash and the accent bar. */
	selected?: boolean;
	/** The unavailable look: the route can't be taken now, though it can still be picked and read. */
	dim?: boolean;
	onClick?: ClickCallback;
}

const { space, fontSize, lineHeight, color, borderWidth, control } = tokens;
const PAD_X = space.space_3;
const PAD_Y = space.space_2;
const GAP = space.space_0_5;
const TITLE_SIZE = fontSize.fs_base;
const DETAIL_SIZE = fontSize.fs_xs;
const TITLE_HEIGHT = TITLE_SIZE * lineHeight.lh;
const DETAIL_LINE = DETAIL_SIZE * lineHeight.lh;
const DETAIL_LINES = 2;

/**
 * One of a POI's routes on the run route screen (Game Flow 3.4): its name,
 * a mono line of what's known of it, and a warning when it has one. A
 * list row grown to three lines (R12.8's look: a hover wash, the selected
 * wash with a 2 px accent bar, the focus ring inside), pressed like a
 * button, and picked by its focus group (R12.34), which owns the selection.
 * Its height is fixed by what it holds, so picking one never moves the
 * others.
 */
export class RouteCard extends Pressable {
	private readonly title: Text;
	private readonly detail: Text;
	private readonly note: Text | null;
	private isDim: boolean;
	private layers: LookLayers;
	private readonly transition: LookTransition;

	constructor({ title, detail, note = null, selected = false, dim = false, onClick, ...options }: RouteCardOptions) {
		super({ focusable: true, ...options, height: options.height ?? cardHeight(note !== null) });
		this.componentType = 'RouteCard';
		this.isDim = dim;
		this.layers = rowLayers({ dim });
		this.selected = selected;
		if (onClick) this.onClick = onClick;

		this.title = new Text({ text: title, style: { fontRole: 'body', fontSize: 'fs_base' }, wrap: 'none', textOverflow: 'ellipsis' });
		this.addPart(this.title);
		this.detail = new Text({ text: detail, style: { fontRole: 'mono', fontSize: 'fs_xs', color: 'text_dim' }, lineHeight: lineHeight.lh, textOverflow: 'ellipsis' });
		this.addPart(this.detail);
		this.note = note === null ? null : new Text({ text: note, style: { fontSize: 'fs_xs', color: 'status_warn' }, wrap: 'none', textOverflow: 'ellipsis' });
		if (this.note) this.addPart(this.note);

		this.transition = new LookTransition({ owner: this, look: this.targetLook, onChange: (look) => this.followLook(look) });
		this.followLook(this.transition.look);
		this.placeParts();
	}

	/** A card spans its list unless it is given a width. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'fill';
	}

	public get titleText(): string {
		return this.title.text;
	}

	public get detailText(): string {
		return this.detail.text;
	}

	public get noteText(): string | null {
		return this.note?.text ?? null;
	}

	public get dim(): boolean {
		return this.isDim;
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
		const box = { x: 0, y: 0, width, height };
		if (look.fill[3] > 0) draw.drawRect({ id: this.id ?? undefined, rect: box, fill: look.fill });
		draw.drawRect({ rect: box, fill: CLEAR, border: { color: color.line_edge, width: borderWidth.bw, position: 'inside' } });
		if (this.selected) draw.drawRect({ rect: { x: 0, y: 0, width: borderWidth.bw_thick, height }, fill: color.accent });
		if (look.focusRing) {
			draw.drawRect({ rect: box, fill: CLEAR, border: { color: look.focusRing, width: control.focus_ring_width, position: 'inside' } });
		}
	}

	private get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}

	private followLook(look: Look): void {
		this.title.color = [...look.text] as [number, number, number, number];
		this.detail.color = this.isDim ? color.text_faint : color.text_dim;
	}

	/** The title, the detail's two lines, and the note, top to bottom inside the padding. */
	private placeParts(): void {
		const inner = Math.max(0, this.width - PAD_X * 2);
		let y = PAD_Y;
		this.title.setPosition(PAD_X, y);
		this.title.setSize(inner, TITLE_HEIGHT);
		y += TITLE_HEIGHT + GAP;
		this.detail.setPosition(PAD_X, y);
		this.detail.setSize(inner, DETAIL_LINE * DETAIL_LINES);
		y += DETAIL_LINE * DETAIL_LINES + GAP;
		if (this.note) {
			this.note.setPosition(PAD_X, y);
			this.note.setSize(inner, DETAIL_LINE);
		}
	}
}

/** Padding, the title, two lines of detail, and a note's line when there is one. */
function cardHeight(withNote: boolean): number {
	return Math.ceil(PAD_Y * 2 + TITLE_HEIGHT + GAP + DETAIL_LINE * DETAIL_LINES + (withNote ? GAP + DETAIL_LINE : 0));
}

const CLEAR: RGBA = [0, 0, 0, 0];
