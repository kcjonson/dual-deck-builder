import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions, DrawTextOptions } from '../../engine/draw/commands';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import { resolveColor } from '../../engine/style/styleObject';
import { CARD_GROUND_FILLS, CARD_MUTED_FILLS, CARD_NAME, dimHex } from './cardStyle';

/** Mono capitals in a box of the card's ground with a muted outline. */
const TAG = { height: 13, size: 9, padding: 4, letterSpacing: 0.06, radius: 2 } as const;
const TAG_TEXT = { full: resolveColor(CARD_NAME), dimmed: resolveColor(dimHex(CARD_NAME)) } as const;

/** How tall a status tag is, so an owner can say how far one reaches past its edge. */
export const STATUS_TAG_HEIGHT = TAG.height;

/**
 * The status tag a card wears across its top edge, its right side at
 * `right`: a mini's +1, HOME, or LOCKED, the driver card's INJURED or
 * SEAT 1, and the escort card's STAYING (Game Flow 7.0). It is its owner's
 * own draws rather than a part, since it straddles the owner's edge and a
 * part may not reach outside its parent (R13.25.2). Built once; the text
 * is measured only when it changes, and an empty one draws nothing.
 */
export class StatusTagDraw {
	private readonly right: number;
	private readonly rect: Rect;
	private readonly border: { color: RGBA; width: number } = { color: CARD_MUTED_FILLS.full, width: 1 };
	private readonly box: DrawRectOptions;
	private readonly label: DrawTextOptions;
	/** The text the box was last sized for; null before the first measure. */
	private measuredText: string | null = null;

	constructor({ right, y }: { right: number; y: number }) {
		this.right = right;
		this.rect = { x: right, y, width: 0, height: TAG.height };
		this.box = { rect: this.rect, radius: TAG.radius, fill: CARD_GROUND_FILLS.full, border: this.border };
		this.label = {
			text: '',
			box: this.rect,
			font: 'mono',
			size: TAG.size,
			color: TAG_TEXT.full,
			align: 'center',
			verticalAlign: 'middle',
			letterSpacing: TAG.letterSpacing,
		};
	}

	/** What the tag says; empty for no tag. */
	public get text(): string {
		return this.label.text;
	}

	public set text(text: string) {
		this.label.text = text;
	}

	/** The faded card's tone, or the full one. */
	public set dimmed(dimmed: boolean) {
		const tone = dimmed ? 'dimmed' : 'full';
		this.box.fill = CARD_GROUND_FILLS[tone];
		this.border.color = CARD_MUTED_FILLS[tone];
		this.label.color = TAG_TEXT[tone];
	}

	/** Sized to its text, measured only when the text changed; a no-op until the draw API can measure. */
	public place(draw: DrawApi | undefined): void {
		const text = this.label.text;
		if (text === this.measuredText || !draw?.canMeasureText('mono')) return;
		const width = text ? draw.measureText({ text, font: 'mono', size: TAG.size, letterSpacing: TAG.letterSpacing, wrap: 'none' }).width + TAG.padding * 2 : 0;
		this.rect.x = this.right - width;
		this.rect.width = width;
		this.measuredText = text;
	}

	/** Whether it draws: it has text, and its box has been sized for it. */
	public get shown(): boolean {
		return this.label.text !== '' && this.label.text === this.measuredText;
	}

	/** Whether a point in the owner's space is on the tag while it shows, for the owner's hit test. */
	public contains(x: number, y: number): boolean {
		const rect = this.rect;
		return this.shown && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
	}

	public render(draw: DrawApi): void {
		if (!this.shown) return;
		draw.drawRect(this.box);
		draw.drawText(this.label);
	}
}
