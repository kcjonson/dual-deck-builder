import type { PointerEvents } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { drawAtlasArt, paperPiece, UiArtName } from '../../ui/atlas/atlasArt';
import { ATLAS, AtlasInks, atlasInks } from '../../ui/atlas/atlasStyle';

export interface JournalPageOptions extends Omit<StackOptions, 'style' | 'padding' | 'gap'> {
	/** The ruled lines' pitch: the text's line height in pixels, so each line sits on a rule. */
	pitch: number;
}

const CLEAR: RGBA = [0, 0, 0, 0];
const PAD_X = 18;
/** The margin rule sits this far in from the left edge, and the text starts past it. */
const MARGIN_RULE = 12;
/** Where a line's text sits above its rule. */
const RULE_DROP = 0.82;

/**
 * The event's journal (Game Flow 5.2: "a weathered journal style, as if
 * written by someone chronicling their journey"): a ruled page of W1
 * paper in an ink border, a margin rule in grease pencil, and the rules in
 * river blue at the text's own pitch, so the setup and situation read as
 * written on it. Paragraphs are a line apart, which keeps every line after
 * the first paragraph on a rule too. It fills its column; the rules run on
 * past the text to the foot of the page.
 */
export class JournalPage extends Stack {
	private pitchValue: number;
	private inks: AtlasInks;
	private readonly box: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly rules: Rect[] = [];
	private ruleCount = 0;
	private readonly marginRule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private surface: UiArtName = 'paper_w1_a';

	constructor({ pitch, ...options }: JournalPageOptions) {
		super({ ...options, gap: pitch, padding: { top: pitch, right: PAD_X, bottom: pitch, left: PAD_X + MARGIN_RULE } });
		this.componentType = 'JournalPage';
		this.pitchValue = pitch;
		this.inks = atlasInks(this.themeTokens);
	}

	public get pitch(): number {
		return this.pitchValue;
	}

	/** A new pitch for new type: the gap and padding follow it, so the text stays on the rules. */
	public set pitch(pitch: number) {
		if (pitch === this.pitchValue) return;
		this.pitchValue = pitch;
		this.gap = pitch;
		this.padding = { top: pitch, right: PAD_X, bottom: pitch, left: PAD_X + MARGIN_RULE };
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		const { width, height } = this;
		const pitch = this.pitchValue;
		setRect(this.box, 0, 0, width, height);
		this.surface = paperPiece(1, this.box);
		setRect(this.marginRule, PAD_X + MARGIN_RULE / 2 - 1, 0, 1.2, height);
		let count = 0;
		for (let y = pitch + pitch * RULE_DROP + 3; y < height - pitch / 2; y += pitch) {
			if (count === this.rules.length) this.rules.push({ x: 0, y: 0, width: 0, height: 0 });
			setRect(this.rules[count], ATLAS.legendRuleInset, Math.round(y), Math.max(0, width - ATLAS.legendRuleInset * 2), 1);
			count++;
		}
		this.ruleCount = count;
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		drawAtlasArt(draw, { id: this.id ?? undefined, name: this.surface, rect: this.box, tint: inks.paper });
		const rule: RGBA = [inks.river[0], inks.river[1], inks.river[2], 0.28];
		for (let index = 0; index < this.ruleCount; index++) draw.drawRect({ rect: this.rules[index], fill: rule });
		draw.drawRect({ rect: this.marginRule, fill: [inks.grease[0], inks.grease[1], inks.grease[2], 0.55] });
		draw.drawRect({ rect: this.box, fill: CLEAR, border: { color: inks.ink, width: ATLAS.legendBorder } });
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
