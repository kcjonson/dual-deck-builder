import type { Component, PointerEvents } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { UiArtName, drawAtlasArt, paperPiece } from './atlasArt';
import { ATLAS, AtlasInks, atlasInks } from './atlasStyle';
import { MapGlyph } from './mapGlyphs';

export interface LegendBoxOptions extends Omit<StackOptions, 'style' | 'padding'> {
	/** The head, set in display 700 spaced capitals. Absent, the box has no head. */
	title?: string;
	/** Fresh paper (W0) for the thing in focus, such as the selected building; paper (W1) otherwise. */
	fresh?: boolean;
	/** Inside the ink border. Default 16. */
	padding?: number;
}

const CLEAR: RGBA = [0, 0, 0, 0];
/** The head's line: 20 px display over its own line height. */
const HEAD_LINE = 24;
/** Rows in a box sit this far apart by default, a hairline centred in the gap. */
const ROW_GAP = 8;

/**
 * The legend box, the atlas's panel (UI Art Direction, Components): paper
 * (W1) with a 1.4 px ink border and a 0.6 px inner rule 6 px in, 16 px of
 * padding, an optional display 700 head in spaced capitals, and its
 * LegendRows split by hairlines. The content is a stack (R12.18); the head
 * is the box's own part, as a Panel's title is (R12.19), and anything else
 * the caller adds (a description, a button) flows without a rule.
 */
export class LegendBox extends Stack {
	private readonly head: Text | null;
	private readonly boxPadding: number;
	private readonly fresh: boolean;
	private inks: AtlasInks;
	private readonly box: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly rule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly rowRules: Rect[] = [];
	private ruleCount = 0;
	private surface: UiArtName = 'paper_w1_a';

	constructor({ title, fresh = false, padding = ATLAS.legendPadding, gap = ROW_GAP, ...options }: LegendBoxOptions = {}) {
		const headSpace = title !== undefined ? HEAD_LINE + gap : 0;
		super({ ...options, gap, padding: { top: padding + headSpace, right: padding, bottom: padding, left: padding } });
		this.componentType = 'LegendBox';
		this.boxPadding = padding;
		this.fresh = fresh;
		this.inks = atlasInks(this.themeTokens);
		this.head = title !== undefined
			? new Text({
				text: title,
				style: { fontRole: 'display', fontWeight: 700, fontSize: ATLAS.headSize, letterSpacing: ATLAS.headTracking, textTransform: 'uppercase', color: 'text' },
				wrap: 'none',
				textOverflow: 'ellipsis',
				verticalAlign: 'middle',
			})
			: null;
		if (this.head) this.addPart(this.head);
	}

	public get title(): string | null {
		return this.head?.text ?? null;
	}

	public set title(title: string | null) {
		if (!this.head) throw new Error('LegendBox: a box built without a title has no head to put one in');
		this.head.text = title ?? '';
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public flows(child: Component): boolean {
		return !child.isPart && super.flows(child);
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		const { width, height } = this;
		const padding = this.boxPadding;
		setRect(this.box, 0, 0, width, height);
		this.surface = paperPiece(1, this.box);
		const inset = ATLAS.legendRuleInset;
		setRect(this.rule, inset, inset, width - inset * 2, height - inset * 2);
		if (this.head) {
			this.head.setPosition(padding, padding);
			this.head.setSize(Math.max(0, width - padding * 2), HEAD_LINE);
		}
		this.placeRowRules();
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		// Fresh paper is W0, clean: a flat tone with no art (UI Art Direction, Wear). Paper is W1.
		if (this.fresh) draw.drawRect({ id: this.id ?? undefined, rect: this.box, fill: inks.freshPaper });
		else drawAtlasArt(draw, { id: this.id ?? undefined, name: this.surface, rect: this.box, tint: inks.paper });
		draw.drawRect({ rect: this.box, fill: CLEAR, border: { color: inks.ink, width: ATLAS.legendBorder } });
		draw.drawRect({ rect: this.rule, fill: CLEAR, border: { color: inks.ink, width: ATLAS.legendRule, position: 'center' } });
		for (let index = 0; index < this.ruleCount; index++) draw.drawRect({ rect: this.rowRules[index], fill: inks.hairline });
	}

	/** A hairline across the content above every LegendRow, centred in the gap before it. */
	private placeRowRules(): void {
		const padding = this.boxPadding;
		const half = this.gap / 2;
		let count = 0;
		for (const child of this.children) {
			if (!(child instanceof LegendRow) || !child.visible) continue;
			if (count === this.rowRules.length) this.rowRules.push({ x: 0, y: 0, width: 0, height: 0 });
			setRect(this.rowRules[count], padding, Math.round(child.placedY - half), Math.max(0, this.width - padding * 2), 1);
			count++;
		}
		this.ruleCount = count;
	}
}

/** The map-legend symbol that leads a row: a shortfall, a pending item, nothing to report. */
export type LegendSymbol = 'diamond' | 'ring' | 'dash';

export interface LegendRowOptions extends Omit<StackOptions, 'style' | 'direction'> {
	text: string;
	symbol?: LegendSymbol;
	/** Faint ink, for nothing to report. Default on with the dash. */
	faint?: boolean;
}

const SYMBOL_SIZE = 14;
const BODY_SIZE = 14;

/**
 * One row of a legend box: a map-legend symbol where it helps (a stronghold
 * diamond for a shortfall, an open ring for a pending item, a dashed line
 * for nothing to report) and a body line that wraps to the box.
 */
export class LegendRow extends Stack {
	private readonly line: Text;

	constructor({ text, symbol, faint = symbol === 'dash', ...options }: LegendRowOptions) {
		super({ widthMode: 'fill', ...options, direction: 'horizontal', gap: 10, crossAlign: 'center' });
		this.componentType = 'LegendRow';
		if (symbol) this.addChild(new MapGlyph({ kind: symbol, size: SYMBOL_SIZE }));
		this.line = new Text({ text, widthMode: 'fill', wrap: 'word', style: { fontSize: BODY_SIZE, color: faint ? 'text_faint' : 'text' } });
		this.addChild(this.line);
	}

	public get text(): string {
		return this.line.text;
	}

	public set text(text: string) {
		this.line.text = text;
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
