import { Component, ComponentOptions } from '../../../engine/components/Component';
import type { BoxShadow } from '../../../engine/draw/commands';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { drawAtlasArt } from './atlasArt';
import { AtlasInks, Driver, atlasInks } from './atlasStyle';
import { GlyphPaint, MapGlyphGeometry, glyphBox } from './mapGlyphs';

const CLEAR: RGBA = [0, 0, 0, 0];
const QUAD_INDICES: readonly number[] = [0, 1, 2, 0, 2, 3];

/** The deck glyph's box: an icon-atlas entry at 20 by 18 (UI Art Direction, Card hints). */
export const DECK_GLYPH = { width: 20, height: 18 } as const;

/** A card outline of the glyph, from the canvas: its rect and the turn about its centre. */
interface GlyphCard {
	x: number;
	y: number;
	turn: number;
}

/** Deck A turned back 10 degrees, deck B over it turned forward 8. */
const GLYPH_CARDS: readonly [GlyphCard, GlyphCard] = [
	{ x: 1, y: 3, turn: -10 },
	{ x: 8, y: 1, turn: 8 },
];
const GLYPH_CARD_W = 10;
const GLYPH_CARD_H = 14;
const GLYPH_STROKE = 1.6;

function turnedCorners(card: GlyphCard): Vec2[] {
	const cx = card.x + GLYPH_CARD_W / 2;
	const cy = card.y + GLYPH_CARD_H / 2;
	const angle = (card.turn * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return [
		[card.x, card.y],
		[card.x + GLYPH_CARD_W, card.y],
		[card.x + GLYPH_CARD_W, card.y + GLYPH_CARD_H],
		[card.x, card.y + GLYPH_CARD_H],
	].map(([x, y]) => ({ x: cx + (x - cx) * cos - (y - cy) * sin, y: cy + (x - cx) * sin + (y - cy) * cos }));
}

const GLYPH_OUTLINES: readonly [readonly Vec2[], readonly Vec2[]] = [turnedCorners(GLYPH_CARDS[0]), turnedCorners(GLYPH_CARDS[1])];

/**
 * The deck glyph's geometry: two overlapping card outlines in the two
 * casing colours, placed once at layout so a frame draws it as is.
 */
export class DeckGlyphGeometry {
	private readonly cards: [Vec2[], Vec2[]] = [
		GLYPH_OUTLINES[0].map(() => ({ x: 0, y: 0 })),
		GLYPH_OUTLINES[1].map(() => ({ x: 0, y: 0 })),
	];
	private readonly rect: Rect = { x: 0, y: 0, width: DECK_GLYPH.width, height: DECK_GLYPH.height };

	public place(x: number, y: number): void {
		this.rect.x = x;
		this.rect.y = y;
		for (let card = 0; card < 2; card++) {
			GLYPH_OUTLINES[card].forEach((point, index) => {
				this.cards[card][index].x = x + point.x;
				this.cards[card][index].y = y + point.y;
			});
		}
	}

	/** `faded` prints both outlines in faded print, for a disabled tab or row. */
	public draw(draw: DrawApi, inks: AtlasInks, faded = false): void {
		if (!faded && drawAtlasArt(draw, { name: 'icon_deck', rect: this.rect })) return;
		for (let card = 0; card < 2; card++) {
			const points = this.cards[card];
			const stroke = faded ? inks.fadedPrint : inks.drivers[card === 0 ? 'a' : 'b'].casing;
			draw.drawPolygon({ points, indices: QUAD_INDICES, fill: inks.freshPaper });
			draw.drawPolyline({ points, closed: true, color: stroke, width: GLYPH_STROKE });
		}
	}
}

/** The deck glyph as a component: an icon beside a line about decks. */
export class DeckGlyph extends Component {
	private readonly geometry = new DeckGlyphGeometry();
	private inks: AtlasInks;
	private isFaded: boolean;

	constructor({ faded = false, ...options }: Omit<ComponentOptions, 'width' | 'height'> & { faded?: boolean } = {}) {
		super({ ...options, width: DECK_GLYPH.width, height: DECK_GLYPH.height });
		this.componentType = 'DeckGlyph';
		this.inks = atlasInks(this.themeTokens);
		this.isFaded = faded;
		this.geometry.place(0, 0);
	}

	public get faded(): boolean {
		return this.isFaded;
	}

	public set faded(faded: boolean) {
		this.isFaded = faded;
	}

	public get inkExtent(): number {
		return 2;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	public render(draw: DrawApi): void {
		this.geometry.draw(draw, this.inks, this.isFaded);
	}
}

/** The card back's geometry in a 100 by 140 card, from the canvas's `cardBackA`. */
const BACK = {
	width: 100,
	height: 140,
	radius: 7,
	edge: 1.2,
	band: { inset: 5, radius: 4, stroke: 2.5 },
	inner: { inset: 11, radius: 2 },
	rule: { inset: 14, stroke: 0.8 },
	shield: { x: 33, y: 47, height: 53, stroke: 2.6 },
	w: [[41, 61], [45.5, 87], [50, 70], [54.5, 87], [59, 61]] as const,
	wStroke: 4,
} as const;

export interface DeckStackOptions extends Omit<ComponentOptions, 'width' | 'height'> {
	driver: Driver;
	/** The top card's width; the card is 5:7. Default 64. */
	width?: number;
	/** Card edges showing under the top card: three or four. Default 3. */
	edges?: 3 | 4;
}

/**
 * A deck set down on the page (UI Art Direction, Card hints): the driver's
 * card back on top of three or four card edges, with a drop shadow. Deck A
 * is always the highway orange, B the route teal; deck objects are W1 and
 * stay out of reading windows, which is the caller's to keep. The card back
 * and edges draw flat until the UI art atlas's card stock lands.
 */
export class DeckStack extends Component {
	public readonly driver: Driver;
	public readonly edges: 3 | 4;
	private readonly cardWidth: number;
	private readonly step: number;
	private inks: AtlasInks;
	private readonly edgeRects: Rect[];
	private readonly card: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly band: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly inner: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly rule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly shield = new MapGlyphGeometry('shield');
	private readonly w: Vec2[] = BACK.w.map(() => ({ x: 0, y: 0 }));
	private readonly shadow: BoxShadow;
	private readonly scale: number;
	private shieldPaint: GlyphPaint;

	constructor({ driver, width = 64, edges = 3, ...options }: DeckStackOptions) {
		const scale = width / BACK.width;
		const step = Math.max(1.5, Math.round(width * 0.025 * 2) / 2);
		super({ ...options, width: Math.ceil(width + step * edges), height: Math.ceil(width * (BACK.height / BACK.width) + step * edges) });
		this.componentType = 'DeckStack';
		this.driver = driver;
		this.edges = edges;
		this.cardWidth = width;
		this.step = step;
		this.scale = scale;
		this.inks = atlasInks(this.themeTokens);
		this.shadow = { color: this.inks.shadow, blur: 8, offset: { x: 0, y: 4 } };
		this.shieldPaint = this.backShieldPaint();
		this.edgeRects = Array.from({ length: edges }, () => ({ x: 0, y: 0, width: 0, height: 0 }));
		this.placeGeometry();
	}

	/** The drop shadow under the bottom edge. */
	public get inkExtent(): number {
		return 16;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.shadow.color = this.inks.shadow;
		this.shieldPaint = this.backShieldPaint();
	}

	/** The back's shield: paper on the driver's casing. */
	private backShieldPaint(): GlyphPaint {
		const { casing } = this.inks.drivers[this.driver];
		return { fill: this.inks.paper, stroke: casing, text: casing };
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		const scale = this.scale;
		const radius = BACK.radius * scale;
		for (let index = 0; index < this.edgeRects.length; index++) {
			draw.drawRect({ rect: this.edgeRects[index], fill: inks.index, radius, border: { color: inks.ink, width: 1 }, shadow: index === 0 ? this.shadow : undefined });
		}
		const name = this.driver === 'a' ? 'card_back_a' : 'card_back_b';
		if (drawAtlasArt(draw, { name, rect: this.card })) return;
		const { fill, casing } = inks.drivers[this.driver];
		draw.drawRect({ id: this.id ?? undefined, rect: this.card, fill: inks.paper, radius, border: { color: inks.ink, width: BACK.edge * scale } });
		draw.drawRect({ rect: this.band, fill, radius: BACK.band.radius * scale, border: { color: casing, width: BACK.band.stroke * scale } });
		draw.drawRect({ rect: this.inner, fill: inks.paper, radius: BACK.inner.radius * scale });
		draw.drawRect({ rect: this.rule, fill: CLEAR, border: { color: casing, width: Math.max(0.6, BACK.rule.stroke * scale) } });
		this.shield.draw(draw, this.shieldPaint);
		draw.drawPolyline({ points: this.w, color: fill, width: BACK.wStroke * scale, cap: 'round' });
	}

	/** The edges stack down and right under the top card, the deepest first. */
	private placeGeometry(): void {
		const scale = this.scale;
		const width = this.cardWidth;
		const height = width * (BACK.height / BACK.width);
		this.edgeRects.forEach((rect, index) => {
			const offset = (this.edges - index) * this.step;
			setRect(rect, offset, offset, width, height);
		});
		setRect(this.card, 0, 0, width, height);
		const inset = (value: number): number => value * scale;
		setRect(this.band, inset(BACK.band.inset), inset(BACK.band.inset), width - inset(BACK.band.inset) * 2, height - inset(BACK.band.inset) * 2);
		setRect(this.inner, inset(BACK.inner.inset), inset(BACK.inner.inset), width - inset(BACK.inner.inset) * 2, height - inset(BACK.inner.inset) * 2);
		setRect(this.rule, inset(BACK.rule.inset), inset(BACK.rule.inset), width - inset(BACK.rule.inset) * 2, height - inset(BACK.rule.inset) * 2);
		const shieldHeight = BACK.shield.height * scale;
		const shieldWidth = glyphBox('shield', shieldHeight).width;
		this.shield.place((width - shieldWidth) / 2, BACK.shield.y * scale, shieldHeight);
		BACK.w.forEach(([x, y], index) => {
			this.w[index].x = x * scale;
			this.w[index].y = y * scale;
		});
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
