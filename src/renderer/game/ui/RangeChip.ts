import { Component, ComponentOptions } from '../../engine/components/Component';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions, DrawTextOptions } from '../../engine/draw/commands';
import { resolveColor } from '../../engine/style/styleObject';
import { tokens } from '../../engine/theme/tokens';

/** What a raider's range chip says while a card is aimed: "R1", "R2", or "OUT", and whether the card can land there. */
export interface RangeLabel {
	text: string;
	legal: boolean;
}

/** The mock's `.slotchip`: 11 px mono, 2 by 4 padding, a 1 px border. */
const FONT_SIZE = 11;
/** JetBrains Mono's advance is 0.6 em, so the chip is sized from its text's length rather than measured. */
const MONO_ADVANCE = 0.6;
const PAD_X = 4;
const PAD_Y = 2;
const BORDER = 1;
export const RANGE_CHIP_HEIGHT = FONT_SIZE + PAD_Y * 2 + BORDER * 2;

const BACKGROUND = resolveColor('#0d0e0f');
const LEGAL_BORDER = resolveColor('#ff6a55');
const LEGAL_TEXT = resolveColor('#ffb3a8');

/**
 * A raider's range from the slot the aimed card acts from (Battle Screen
 * Design section 6): red-edged where the card can land, faint where it
 * can't. It draws its own box and text from options it keeps, so an aimed
 * frame allocates nothing; a new label resizes it once.
 */
export class RangeChip extends Component {
	private label: RangeLabel | null = null;
	private readonly boxDraw: DrawRectOptions = { rect: { x: 0, y: 0, width: 0, height: RANGE_CHIP_HEIGHT }, fill: BACKGROUND, radius: 2, border: { color: tokens.color.line_edge, width: BORDER } };
	private readonly textDraw: DrawTextOptions = { text: '', box: { x: 0, y: 0, width: 0, height: RANGE_CHIP_HEIGHT }, font: 'mono', size: FONT_SIZE, color: tokens.color.text_faint, align: 'center', verticalAlign: 'middle', wrap: 'none' };

	constructor(options: ComponentOptions = {}) {
		super({ pointerEvents: 'none', ...options, height: RANGE_CHIP_HEIGHT });
		this.componentType = 'RangeChip';
		this.visible = false;
	}

	/** The width a chip saying `text` takes. */
	static widthOf(text: string): number {
		return Math.ceil(text.length * FONT_SIZE * MONO_ADVANCE) + (PAD_X + BORDER) * 2;
	}

	public get range(): RangeLabel | null {
		return this.label;
	}

	/** Null hides it. */
	public set range(label: RangeLabel | null) {
		const same = label === this.label || (label !== null && this.label !== null && label.text === this.label.text && label.legal === this.label.legal);
		if (same) return;
		this.label = label;
		this.visible = label !== null;
		if (!label) return;
		const width = RangeChip.widthOf(label.text);
		if (width !== this.width) this.setSize(width, RANGE_CHIP_HEIGHT);
		(this.boxDraw.rect as { width: number }).width = width;
		(this.textDraw.box as { width: number }).width = width;
		this.textDraw.text = label.text;
		this.textDraw.color = label.legal ? LEGAL_TEXT : tokens.color.text_faint;
		if (this.boxDraw.border) this.boxDraw.border.color = label.legal ? LEGAL_BORDER : tokens.color.line_edge;
	}

	public get drawnText(): readonly string[] | null {
		return this.label ? [this.label.text] : null;
	}

	public render(draw: DrawApi): void {
		if (!this.label) return;
		draw.drawRect(this.boxDraw);
		draw.drawText(this.textDraw);
	}
}
