import type { Component } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { ATLAS, AtlasInks, atlasInks } from './atlasStyle';

export interface PlateFrameOptions extends Omit<StackOptions, 'style' | 'padding'> {
	/** The mono caption under the plate ("PLATE 1 · THE COMPOUND FROM ABOVE, AT DAWN"). */
	caption?: string;
}

const CLEAR: RGBA = [0, 0, 0, 0];
const CAPTION_GAP = 8;
const CAPTION_LINE = 14;
/** The art sits inside both rules: the fine rule, its gap, and the main rule. */
const ART_INSET = Math.ceil(ATLAS.plateOuterRule + ATLAS.plateOuterGap + ATLAS.plateRule);

/**
 * An atlas plate (UI Art Direction, Components): an illustrated view framed
 * by a 1.6 px ink rule with a 0.6 px rule 4 px outside it, and a mono
 * caption below. The art is the caller's, laid out as a stack inside the
 * rules (R12.18).
 */
export class PlateFrame extends Stack {
	private readonly captionText: Text | null;
	private inks: AtlasInks;
	private readonly outer: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly main: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly art: Rect = { x: 0, y: 0, width: 0, height: 0 };

	constructor({ caption, ...options }: PlateFrameOptions = {}) {
		const captionSpace = caption !== undefined ? CAPTION_GAP + CAPTION_LINE : 0;
		super({ ...options, padding: { top: ART_INSET, right: ART_INSET, bottom: ART_INSET + captionSpace, left: ART_INSET } });
		this.componentType = 'PlateFrame';
		this.inks = atlasInks(this.themeTokens);
		this.captionText = caption !== undefined
			? new Text({
				text: caption,
				style: { fontRole: 'mono', fontSize: ATLAS.captionSize, letterSpacing: ATLAS.captionTracking, textTransform: 'uppercase', color: 'text_dim' },
				wrap: 'none',
				textOverflow: 'ellipsis',
			})
			: null;
		if (this.captionText) this.addPart(this.captionText);
	}

	public get caption(): string | null {
		return this.captionText?.text ?? null;
	}

	public set caption(caption: string | null) {
		if (!this.captionText) throw new Error('PlateFrame: a plate built without a caption has no line for one');
		this.captionText.text = caption ?? '';
	}

	/** Where the art shows, inside both rules. */
	public get artRect(): Readonly<Rect> {
		return this.art;
	}

	public flows(child: Component): boolean {
		return !child.isPart && super.flows(child);
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		const { width } = this;
		const frameHeight = this.height - (this.captionText ? CAPTION_GAP + CAPTION_LINE : 0);
		setRect(this.outer, 0, 0, width, frameHeight);
		const gap = ATLAS.plateOuterRule + ATLAS.plateOuterGap;
		setRect(this.main, gap, gap, width - gap * 2, frameHeight - gap * 2);
		setRect(this.art, ART_INSET, ART_INSET, width - ART_INSET * 2, frameHeight - ART_INSET * 2);
		if (this.captionText) {
			this.captionText.setPosition(0, frameHeight + CAPTION_GAP);
			this.captionText.setSize(width, CAPTION_LINE);
		}
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		draw.drawRect({ id: this.id ?? undefined, rect: this.outer, fill: CLEAR, border: { color: inks.ink, width: ATLAS.plateOuterRule } });
		draw.drawRect({ rect: this.main, fill: CLEAR, border: { color: inks.ink, width: ATLAS.plateRule } });
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
