import { Component, ComponentOptions, ResolvedColors } from '../../engine/components/Component';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions, DrawTextOptions } from '../../engine/draw/commands';
import { resolveColor } from '../../engine/style/styleObject';

/**
 * The mock's `.pblock`: 6 in from each side, 64 down, 16 tall, 11 px mono
 * spaced 0.04 em. Its words start at the left, where the mock centres
 * them, since a fanned card shows only its left side.
 */
export const BLOCK_STRIP = { x: 6, y: 64, height: 16, size: 11, letterSpacing: 0.04, radius: 2, padding: 5 } as const;
const BACKGROUND = resolveColor('rgba(90, 31, 24, 0.95)');
const INK = resolveColor('#ffd0c8');

/**
 * Why a card in the hand can't be played now, across its art ("NO
 * TARGET", "NO ATTACKS"), the mock's `.pblock`. A child of the face, after
 * the art icon, so it covers the icon. Drawn at full strength over the
 * dimmed card, since it is the one thing on a dimmed card to read.
 */
export class CardBlockStrip extends Component {
	private readonly box: DrawRectOptions;
	private readonly label: DrawTextOptions;

	constructor({ width, ...options }: ComponentOptions & { width: number }) {
		// Over the art icon it crosses, declared so
		super({ pointerEvents: 'none', zIndex: 1, ...options, width, height: BLOCK_STRIP.height });
		this.componentType = 'CardBlockStrip';
		const rect = { x: 0, y: 0, width, height: BLOCK_STRIP.height };
		this.box = { rect, radius: BLOCK_STRIP.radius, fill: BACKGROUND };
		this.label = {
			text: '',
			box: { x: BLOCK_STRIP.padding, y: 0, width: width - BLOCK_STRIP.padding * 2, height: BLOCK_STRIP.height },
			font: 'mono',
			size: BLOCK_STRIP.size,
			color: INK,
			align: 'left',
			verticalAlign: 'middle',
			letterSpacing: BLOCK_STRIP.letterSpacing,
			wrap: 'none',
			overflow: 'clip',
		};
		this.visible = false;
	}

	/** What it says; null hides it. */
	public get text(): string | null {
		return this.visible ? this.label.text : null;
	}

	public set text(text: string | null) {
		this.visible = text !== null;
		if (text !== null) this.label.text = text;
	}

	public get resolvedColors(): ResolvedColors | null {
		return this.visible ? { fill: BACKGROUND, text: INK } : null;
	}

	public get drawnText(): readonly string[] | null {
		return this.visible ? [this.label.text] : null;
	}

	public render(draw: DrawApi): void {
		draw.drawRect(this.box);
		draw.drawText(this.label);
	}
}
