import type { PointerEvents } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { uiArtSize } from '../../art/uiArt';
import { UiArtName, drawAtlasArt, paperPiece } from './atlasArt';
import { ATLAS, AtlasInks, atlasInks } from './atlasStyle';
import { damagePiece } from './DamageMark';

export interface AtlasTagOptions extends Omit<StackOptions, 'style' | 'padding' | 'direction'> {
	/** The name on the tag, in display 700. */
	label: string;
	/** A mono line under it: a role, a state, a count. */
	caption?: string;
	/** Stronghold red on the caption, for a state that costs something (injured). */
	warn?: boolean;
	/** The tag has picked up a tear (UI Art Direction, Wear: an injured driver's tag). */
	torn?: boolean;
	/** Ids for the label and caption, so a screen's tests can read each. */
	labelId?: string;
	captionId?: string;
}

const CLEAR: RGBA = [0, 0, 0, 0];
const PAD_X = 12;
const PAD_Y = 8;
const LABEL_SIZE = 18;
const CAPTION_SIZE = 11;
const TEAR: UiArtName = damagePiece('tear');
const TEAR_SIZE = uiArtSize(TEAR);
/** The tear runs in from the top edge this far from the tag's right side. */
const TEAR_IN = 6;

/**
 * A tag: a small W1 paper label for a person or a vehicle, its name in
 * display 700 and a mono caption under it, in a 1 px ink border. A tag can
 * pick up a tear, run in from its top edge at the right; the label's
 * column stops short of the tear, so the damage never sits on what's read.
 */
export class AtlasTag extends Stack {
	private readonly labelText: Text;
	private readonly captionText: Text | null;
	private isTorn: boolean;
	private inks: AtlasInks;
	private surface: UiArtName = 'paper_w1_a';
	private readonly box: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly tearRect: Rect = { x: 0, y: 0, width: TEAR_SIZE.width, height: TEAR_SIZE.height };

	constructor({ label, caption, warn = false, torn = false, labelId, captionId, ...options }: AtlasTagOptions) {
		// The right padding always leaves room for a tear, so tearing a tag never moves its text.
		super({ ...options, direction: 'vertical', gap: 2, padding: { top: PAD_Y, bottom: PAD_Y, left: PAD_X, right: TEAR_SIZE.width + TEAR_IN } });
		this.componentType = 'AtlasTag';
		this.isTorn = torn;
		this.inks = atlasInks(this.themeTokens);
		this.labelText = new Text({ id: labelId, text: label, widthMode: 'fill', wrap: 'none', textOverflow: 'ellipsis', style: { fontRole: 'display', fontWeight: 700, fontSize: LABEL_SIZE, color: 'text' } });
		this.addChild(this.labelText);
		this.captionText = caption !== undefined
			? new Text({ id: captionId, text: caption, widthMode: 'fill', wrap: 'word', style: { fontRole: 'mono', fontWeight: 500, fontSize: CAPTION_SIZE, letterSpacing: ATLAS.captionTracking, textTransform: 'uppercase', color: warn ? 'status_crit' : 'text_dim' } })
			: null;
		if (this.captionText) this.addChild(this.captionText);
	}

	public get label(): string {
		return this.labelText.text;
	}

	public get caption(): string | null {
		return this.captionText?.text ?? null;
	}

	public get torn(): boolean {
		return this.isTorn;
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		this.box.width = this.width;
		this.box.height = this.height;
		this.surface = paperPiece(1, this.box);
		this.tearRect.x = this.width - TEAR_IN - TEAR_SIZE.width;
		this.tearRect.height = Math.min(TEAR_SIZE.height, this.height);
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		drawAtlasArt(draw, { id: this.id ?? undefined, name: this.surface, rect: this.box, tint: inks.paper });
		draw.drawRect({ rect: this.box, fill: CLEAR, border: { color: inks.ink, width: 1 } });
		if (this.isTorn) drawAtlasArt(draw, { name: TEAR, rect: this.tearRect });
	}
}
