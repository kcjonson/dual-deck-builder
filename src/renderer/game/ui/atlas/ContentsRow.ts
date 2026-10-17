import type { ClickCallback, ComponentOptions } from '../../../engine/components/Component';
import { Text } from '../../../engine/components/Text';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { Pressable } from '../../../engine/ui/Pressable';
import { ATLAS, AtlasInks, atlasInks } from './atlasStyle';
import { DECK_GLYPH, DeckGlyphGeometry } from './deck';
import { GlyphPaint, MapGlyphGeometry, glyphPaint, glyphWidth } from './mapGlyphs';

/**
 * `primary` is the one row the page leads with (Continue, or New campaign):
 * a highway shield, a larger label, ink rules above and below. `standard`
 * leads with a circled number or letter. `compact` is the appendix list's.
 */
export type ContentsRowVariant = 'primary' | 'standard' | 'compact';

/** What leads the row: a glyph's label (a number, a letter, the day), the deck glyph, or nothing. */
export type ContentsLead = { glyph: string } | 'deck' | null;

export interface ContentsRowOptions extends Omit<ComponentOptions, 'style'> {
	label: string;
	/** Mono, at the right end of the leaders. */
	value?: string;
	/** A line under a primary row's label: the save's summary, or why there's nothing to continue. */
	subtitle?: string;
	lead?: ContentsLead;
	variant?: ContentsRowVariant;
	/** Faded print: shown in its place, but not available. Not focusable or pressable. */
	faded?: boolean;
	onClick?: ClickCallback;
}

interface RowMetrics {
	height: number;
	label: number;
	value: number;
	glyph: number;
	/** The lead's column, the same whatever leads the row (or nothing), so labels line up down the page. Zero for compact rows, whose deck glyph runs inline. */
	leadSlot: number;
	padX: number;
	gap: number;
	/** The rule above and below, or below only, and its weight. */
	ruleAbove: boolean;
	rule: number;
}

/** The canvas's 46 px lead column. */
const LEAD_SLOT = 46;

/** From the menu canvas, a step smaller so the contents page fits a 1024 by 600 window. */
const METRICS: Readonly<Record<ContentsRowVariant, RowMetrics>> = {
	primary: { height: 72, label: 32, value: 14, glyph: 46, leadSlot: LEAD_SLOT, padX: 12, gap: 16, ruleAbove: true, rule: ATLAS.legendBorder },
	standard: { height: 56, label: 26, value: 14, glyph: 30, leadSlot: LEAD_SLOT, padX: 12, gap: 16, ruleAbove: false, rule: 1 },
	compact: { height: 44, label: 20, value: 12, glyph: 0, leadSlot: 0, padX: 4, gap: 8, ruleAbove: false, rule: 1 },
};

const SUBTITLE_SIZE = 14;
const SUBTITLE_GAP = 2;
const LEADER_DOT = 2;
const LEADER_STEP = 4;
const LEADER_MARGIN = 8;
const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * A row of the atlas's contents page (UI Art Direction, Components): a
 * leading glyph, the label in display 700, dotted leaders, and a mono value
 * at the right, for destinations, menu entries, and history. Pressed like a
 * button (R12.7's press machine), with a hover wash and an ink focus ring
 * inside the row, since rows abut. Selection is the hand's to mark (a
 * HandMarkLayer's highlighter), never the row's own fill.
 */
export class ContentsRow extends Pressable {
	public readonly variant: ContentsRowVariant;
	private readonly metrics: RowMetrics;
	private readonly labelText: Text;
	private readonly valueText: Text | null;
	private readonly subtitleText: Text | null;
	private readonly glyph: MapGlyphGeometry | null;
	private readonly glyphLabel: string | null;
	private readonly deck: DeckGlyphGeometry | null;
	private isFaded: boolean;
	private inks: AtlasInks;
	private paint: GlyphPaint;
	private readonly box: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly ruleTop: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly ruleBottom: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly ring: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly leaders: Rect[] = [];
	private leaderCount = 0;

	constructor({ label, value, subtitle, lead = null, variant = 'standard', faded = false, onClick, ...options }: ContentsRowOptions) {
		const metrics = METRICS[variant];
		super({ focusable: true, widthMode: 'fill', height: metrics.height, ...options, ...(faded ? { enabled: false } : {}) });
		this.componentType = 'ContentsRow';
		this.variant = variant;
		this.metrics = metrics;
		this.isFaded = faded;
		this.inks = atlasInks(this.themeTokens);
		const kind = variant === 'primary' ? 'shield' : 'circled';
		const glyphLead = lead !== null && lead !== 'deck' && metrics.glyph > 0;
		this.glyph = glyphLead ? new MapGlyphGeometry(kind) : null;
		this.glyphLabel = glyphLead ? (lead as { glyph: string }).glyph : null;
		this.deck = lead === 'deck' ? new DeckGlyphGeometry() : null;
		this.paint = glyphPaint(kind, this.inks, { faded });
		// A named row names its parts after itself, so a test or the lint can find each line.
		const partId = (part: string): string | undefined => (options.id ? `${options.id}_${part}` : undefined);
		this.labelText = new Text({
			id: partId('label'),
			text: label,
			style: { fontRole: 'display', fontWeight: 700, fontSize: metrics.label, color: faded ? 'text_disabled' : 'text' },
			wrap: 'none',
			textOverflow: 'ellipsis',
			verticalAlign: 'middle',
		});
		this.addPart(this.labelText);
		this.subtitleText = subtitle !== undefined
			? new Text({ id: partId('subtitle'), text: subtitle, style: { fontSize: SUBTITLE_SIZE, color: 'text_dim' }, wrap: 'none', textOverflow: 'ellipsis' })
			: null;
		if (this.subtitleText) this.addPart(this.subtitleText);
		this.valueText = value !== undefined
			? new Text({
				id: partId('value'),
				text: value,
				style: { fontRole: 'mono', fontSize: metrics.value, color: faded ? 'text_disabled' : variant === 'compact' ? 'text_dim' : 'text' },
				wrap: 'none',
				verticalAlign: 'middle',
			})
			: null;
		if (this.valueText) this.addPart(this.valueText);
		if (onClick) this.onClick = onClick;
	}

	public get label(): string {
		return this.labelText.text;
	}

	public set label(label: string) {
		this.labelText.text = label;
		this.invalidateLayout();
	}

	public get value(): string | null {
		return this.valueText?.text ?? null;
	}

	public set value(value: string | null) {
		if (!this.valueText) throw new Error('ContentsRow: a row built without a value has no place for one');
		this.valueText.text = value ?? '';
		this.invalidateLayout();
	}

	public get subtitle(): string | null {
		return this.subtitleText?.text ?? null;
	}

	public get faded(): boolean {
		return this.isFaded;
	}

	/** Fades the row and takes it out of reach, or brings it back. */
	public set faded(faded: boolean) {
		if (faded === this.isFaded) return;
		this.isFaded = faded;
		this.enabled = !faded;
		this.paint = glyphPaint(this.glyph?.kind ?? 'circled', this.inks, { faded });
		this.labelText.color = faded ? 'text_disabled' : 'text';
		if (this.valueText) this.valueText.color = faded ? 'text_disabled' : this.variant === 'compact' ? 'text_dim' : 'text';
	}

	/** Rows abut, so the ring is drawn inside, as a list row's is. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** The glyph's halo of stroke past its box. */
	public get inkExtent(): number {
		return 2;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.paint = glyphPaint(this.glyph?.kind ?? 'circled', this.inks, { faded: this.isFaded });
	}

	protected layoutChildren(): void {
		const { width, height } = this;
		const m = this.metrics;
		setRect(this.box, 0, 0, width, height);
		setRect(this.ruleTop, 0, 0, width, m.rule);
		setRect(this.ruleBottom, 0, height - m.rule, width, m.rule);
		setRect(this.ring, m.rule, m.rule, width - m.rule * 2, height - m.rule * 2);

		let x = m.padX;
		if (m.leadSlot > 0) {
			if (this.glyph) this.glyph.place(x + (m.leadSlot - glyphWidth(this.glyph.kind, m.glyph)) / 2, (height - m.glyph) / 2, m.glyph);
			else if (this.deck) this.deck.place(x + (m.leadSlot - DECK_GLYPH.width) / 2, (height - DECK_GLYPH.height) / 2);
			x += m.leadSlot + m.gap;
		} else if (this.deck) {
			this.deck.place(x, (height - DECK_GLYPH.height) / 2);
			x += DECK_GLYPH.width + m.gap / 2;
		}

		const valueWidth = Math.ceil(this.valueText?.measured?.width ?? 0);
		const labelLine = Math.ceil(this.labelText.measured?.height ?? m.label);
		const subtitleLine = this.subtitleText ? Math.ceil(this.subtitleText.measured?.height ?? SUBTITLE_SIZE) : 0;
		const block = labelLine + (this.subtitleText ? SUBTITLE_GAP + subtitleLine : 0);
		const top = Math.round((height - block) / 2);
		const valueX = width - m.padX - valueWidth;
		if (this.valueText) {
			const valueLine = Math.ceil(this.valueText.measured?.height ?? m.value);
			this.valueText.setPosition(valueX, Math.round(top + (labelLine - valueLine) / 2));
			this.valueText.setSize(valueWidth, valueLine);
		}
		const room = Math.max(0, valueX - LEADER_MARGIN * 2 - x);
		const labelWidth = Math.min(Math.ceil(this.labelText.measured?.width ?? 0), room);
		this.labelText.setPosition(x, top);
		this.labelText.setSize(labelWidth, labelLine);
		if (this.subtitleText) {
			this.subtitleText.setPosition(x, top + labelLine + SUBTITLE_GAP);
			this.subtitleText.setSize(Math.max(0, valueX - LEADER_MARGIN - x), subtitleLine);
		}
		this.placeLeaders(x + labelWidth + LEADER_MARGIN, valueX - LEADER_MARGIN, Math.round(top + labelLine / 2));
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		const flags = this.stateFlags;
		const wash = (flags.pressed || flags.hovered) && flags.enabled ? inks.hover : CLEAR;
		draw.drawRect({ id: this.id ?? undefined, rect: this.box, fill: wash });
		if (flags.pressed) draw.drawRect({ rect: this.box, fill: inks.hover });
		const ruleColor = this.variant === 'primary' ? inks.ink : inks.hairline;
		if (this.metrics.ruleAbove) draw.drawRect({ rect: this.ruleTop, fill: ruleColor });
		draw.drawRect({ rect: this.ruleBottom, fill: ruleColor });
		if (this.glyph) this.glyph.draw(draw, this.paint, this.glyphLabel);
		if (this.deck) this.deck.draw(draw, inks, this.isFaded);
		for (let index = 0; index < this.leaderCount; index++) draw.drawRect({ rect: this.leaders[index], fill: inks.fadedPrint });
		if (flags.focusVisible && flags.enabled) {
			draw.drawRect({ rect: this.ring, fill: CLEAR, border: { color: inks.focusRing, width: ATLAS.focusRingWidth, position: 'inside' } });
		}
	}

	/** Dots from `start` to `end` on the label's middle line. */
	private placeLeaders(start: number, end: number, y: number): void {
		let count = 0;
		for (let x = start; x + LEADER_DOT <= end; x += LEADER_STEP) {
			if (count === this.leaders.length) this.leaders.push({ x: 0, y: 0, width: 0, height: 0 });
			setRect(this.leaders[count], x, y, LEADER_DOT, LEADER_DOT);
			count++;
		}
		this.leaderCount = count;
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
