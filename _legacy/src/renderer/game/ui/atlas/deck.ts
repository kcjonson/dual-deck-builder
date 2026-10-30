import { Component, ComponentOptions } from '../../../engine/components/Component';
import type { BoxShadow, DrawRectOptions } from '../../../engine/draw/commands';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { Mat2D, RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { DrawAtlasArtOptions, drawAtlasArt } from './atlasArt';
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


/** The card back's height for a width: the card is 5:7. */
function backHeight(width: number): number {
	return width * (BACK.height / BACK.width);
}

/** The back's shield: paper on the driver's casing. */
function backShieldPaint(inks: AtlasInks, driver: Driver): GlyphPaint {
	const { casing } = inks.drivers[driver];
	return { fill: inks.paper, stroke: casing, text: casing };
}

/** A deck object's drop shadow, cast by each card or stack. */
function deckShadow(inks: AtlasInks): BoxShadow {
	return { color: inks.shadow, blur: 8, offset: { x: 0, y: 4 } };
}

/**
 * One driver's card back at a card width, placed once so a frame draws it as
 * is: the baked card stock, or its flat stand-in when the art isn't resident.
 */
class CardBackGeometry {
	public readonly driver: Driver;
	private readonly scale: number;
	private readonly card: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly band: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly inner: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly rule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly shield = new MapGlyphGeometry('shield');
	private readonly w: Vec2[] = BACK.w.map(() => ({ x: 0, y: 0 }));
	private shieldPaint: GlyphPaint;
	/** The card stock's draw, built once so a frame allocates nothing. */
	private readonly art: DrawAtlasArtOptions;

	constructor({ driver, width, inks }: { driver: Driver; width: number; inks: AtlasInks }) {
		this.driver = driver;
		this.art = { name: driver === 'a' ? 'card_back_a' : 'card_back_b', rect: this.card };
		this.scale = width / BACK.width;
		this.shieldPaint = backShieldPaint(inks, driver);
		const scale = this.scale;
		const height = backHeight(width);
		const inset = (value: number): number => value * scale;
		setRect(this.card, 0, 0, width, height);
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

	public get rect(): Readonly<Rect> {
		return this.card;
	}

	public get radius(): number {
		return BACK.radius * this.scale;
	}

	public retheme(inks: AtlasInks): void {
		this.shieldPaint = backShieldPaint(inks, this.driver);
	}

	public draw(draw: DrawApi, inks: AtlasInks, id?: string): void {
		this.art.id = id;
		if (drawAtlasArt(draw, this.art)) return;
		const scale = this.scale;
		const { fill, casing } = inks.drivers[this.driver];
		draw.drawRect({ id, rect: this.card, fill: inks.paper, radius: this.radius, border: { color: inks.ink, width: BACK.edge * scale } });
		draw.drawRect({ rect: this.band, fill, radius: BACK.band.radius * scale, border: { color: casing, width: BACK.band.stroke * scale } });
		draw.drawRect({ rect: this.inner, fill: inks.paper, radius: BACK.inner.radius * scale });
		draw.drawRect({ rect: this.rule, fill: CLEAR, border: { color: casing, width: Math.max(0.6, BACK.rule.stroke * scale) } });
		this.shield.draw(draw, this.shieldPaint);
		draw.drawPolyline({ points: this.w, color: fill, width: BACK.wStroke * scale, cap: 'round' });
	}
}

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
 * and edges draw flat when the UI art atlas isn't resident.
 */
export class DeckStack extends Component {
	public readonly driver: Driver;
	public readonly edges: 3 | 4;
	private inks: AtlasInks;
	private readonly back: CardBackGeometry;
	/** The edges' and shadow's draws, built once so a frame allocates nothing. */
	private readonly edgeDraws: DrawAtlasArtOptions[];
	private readonly shadow: BoxShadow;
	private readonly stackShadow: DrawRectOptions;

	constructor({ driver, width = 64, edges = 3, ...options }: DeckStackOptions) {
		const step = Math.max(1.5, Math.round(width * 0.025 * 2) / 2);
		const height = backHeight(width);
		super({ ...options, width: Math.ceil(width + step * edges), height: Math.ceil(height + step * edges) });
		this.componentType = 'DeckStack';
		this.driver = driver;
		this.edges = edges;
		this.inks = atlasInks(this.themeTokens);
		this.shadow = deckShadow(this.inks);
		this.back = new CardBackGeometry({ driver, width, inks: this.inks });
		// The edges stack down and right under the top card, the deepest first.
		this.edgeDraws = Array.from({ length: edges }, (_, index) => {
			const offset = (edges - index) * step;
			return { name: 'card_edge', rect: { x: offset, y: offset, width, height } };
		});
		this.stackShadow = { rect: this.edgeDraws[0].rect, fill: CLEAR, radius: this.back.radius, shadow: this.shadow };
	}

	/** The drop shadow under the bottom edge. */
	public get inkExtent(): number {
		return 16;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.shadow.color = this.inks.shadow;
		this.back.retheme(this.inks);
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		const radius = this.back.radius;
		// The art can't carry a shadow, so the stack's drop shadow goes down first on its own.
		draw.drawRect(this.stackShadow);
		for (let index = 0; index < this.edgeDraws.length; index++) {
			const edge = this.edgeDraws[index];
			if (!drawAtlasArt(draw, edge)) draw.drawRect({ rect: edge.rect, fill: inks.index, radius, border: { color: inks.ink, width: 1 } });
		}
		this.back.draw(draw, inks, this.id ?? undefined);
	}
}

export interface DeckFanOptions extends Omit<ComponentOptions, 'width' | 'height'> {
	driver: Driver;
	/** Each card's width; the card is 5:7. Default 64. */
	width?: number;
	/** Default 5. */
	cards?: number;
	/** Degrees between neighbouring cards. Default 8. */
	spread?: number;
}

/** Where the fan's cards turn, in card widths and heights: just under the bottom edge's centre (FinalSplash). */
const FAN_PIVOT = { x: 0.5, y: 150 / 140 } as const;
const CARD_CORNERS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * A deck fanned out on the table, the splash's deck A (UI Art Direction,
 * Card hints): the driver's card backs turned about a point under their
 * bottom edge, the last on top, each casting the deck objects' shadow. The
 * box is the fan's bounds; `cardOrigin` is where the unturned card's corner
 * sits in it, for a caller placing the fan by its card.
 */
export class DeckFan extends Component {
	public readonly driver: Driver;
	private inks: AtlasInks;
	private readonly back: CardBackGeometry;
	private readonly turns: Mat2D[];
	private readonly origin: Vec2;
	private readonly shadow: BoxShadow;
	private readonly cardShadow: DrawRectOptions;

	constructor({ driver, width = 64, cards = 5, spread = 8, ...options }: DeckFanOptions) {
		const height = backHeight(width);
		const pivotX = width * FAN_PIVOT.x;
		const pivotY = height * FAN_PIVOT.y;
		const count = Math.max(1, Math.round(cards));
		const turns: Mat2D[] = Array.from({ length: count }, (_, index) => {
			const angle = ((index - (count - 1) / 2) * spread * Math.PI) / 180;
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			return [cos, sin, -sin, cos, pivotX - pivotX * cos + pivotY * sin, pivotY - pivotX * sin - pivotY * cos];
		});
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const [a, b, c, d, e, f] of turns) {
			for (const [u, v] of CARD_CORNERS) {
				const x = a * u * width + c * v * height + e;
				const y = b * u * width + d * v * height + f;
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}
		}
		super({ ...options, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) });
		this.componentType = 'DeckFan';
		this.driver = driver;
		this.inks = atlasInks(this.themeTokens);
		this.shadow = deckShadow(this.inks);
		this.back = new CardBackGeometry({ driver, width, inks: this.inks });
		this.cardShadow = { rect: this.back.rect, fill: CLEAR, radius: this.back.radius, shadow: this.shadow };
		this.turns = turns.map(([a, b, c, d, e, f]): Mat2D => [a, b, c, d, e - minX, f - minY]);
		this.origin = { x: -minX, y: -minY };
	}

	public get cards(): number {
		return this.turns.length;
	}

	/** The unturned card's top-left corner in this box. */
	public get cardOrigin(): Readonly<Vec2> {
		return this.origin;
	}

	public get inkExtent(): number {
		return 16;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.shadow.color = this.inks.shadow;
		this.back.retheme(this.inks);
	}

	public render(draw: DrawApi): void {
		const inks = this.inks;
		const top = this.turns.length - 1;
		for (let index = 0; index <= top; index++) {
			draw.pushTransform(this.turns[index]);
			draw.drawRect(this.cardShadow);
			this.back.draw(draw, inks, index === top ? this.id ?? undefined : undefined);
			draw.popTransform();
		}
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
