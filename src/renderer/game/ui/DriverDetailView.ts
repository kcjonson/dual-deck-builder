import { Component } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions } from '../../engine/draw/commands';
import type { Rect } from '../../engine/draw/geometry';
import { resolveColor } from '../../engine/style/styleObject';
import { shadowExtent } from '../../engine/style/look';
import type { CardCounts } from '../campaign/CardCounts';
import type { Card as GameCard } from '../mechanics/Card';
import { Card as UICard, CardSize, MINI_GRID, miniGridHeight, miniGridWidth } from './Card';
import { FlowWrap } from './FlowWrap';
import { DETAIL_SHADOW, pinHint } from './CardDetailView';
import { CARD_LINE_FAINT, CARD_MUTED, CARD_NAME, CARD_RULES } from './cardStyle';
import type { DriverCardData } from './driverCardData';
import { StatBarDraws, drawStatBar, placeStatBar, statBarDraws } from './statBar';
import {
	DRIVER_HP_FILLS,
	PortraitDraws,
	RivetedFrameDraws,
	drawPortrait,
	drawRivetedFrame,
	hpFraction,
	portraitDraws,
	resizeRivetedFrame,
	rivetedFrameDraws,
} from './driverCardStyle';

/** A card type looked up in the game's cards; null for a type they don't have. */
export type CardLookup = (type: string) => GameCard | null;

const MINI_SIZE = UICard.getDimensions(CardSize.MINI);

/**
 * A driver's detail view, in its own pixels: the person at the top (the
 * portrait beside the name, and their vehicle and specialty under it),
 * their stats under them, then their deck as mini cards, and a foot with a
 * note and how to pin it, in the riveted double frame their card wears and
 * the play card detail view's shadow.
 */
export const DRIVER_DETAIL = {
	/** From the outer edge to the content: the frame and its rivets, then room. */
	pad: 16,
	portrait: 56,
	/** Between the portrait and the column beside it, and between the view's sections. */
	gap: 10,
	name: { size: 20, lineHeight: 22, lines: 2 },
	/** The vehicle and specialty on one line, as the Crew screen's header writes them. */
	identity: { size: 13, height: 18 },
	/**
	 * One row of mono: a label's muted capitals (a note, the deck's heading,
	 * the pin hint), tracked wider than a stat's brighter figures.
	 */
	mono: { size: 11, height: 14, labelSpacing: 0.06, figureSpacing: 0.04 },
	/** The hand limit and the skills, flowed in rows. */
	stats: { gap: 14, rowGap: 4 },
	bar: { height: 6, gap: 10 },
	rule: 1,
	/** Between the deck and the foot, and between a note and the pin hint in it. */
	foot: { gap: 6, between: 16 },
	/** As few rows as seven columns allow, spread evenly, never fewer than four columns. */
	columns: { min: 4, max: 7 },
	/** The most rows the deck takes; past that the columns grow. */
	rows: 3,
} as const;

/**
 * How the detail view lays out a deck of `kinds` kinds of card: as few rows
 * as seven columns allow, the kinds spread evenly across them, never fewer
 * than four columns, so the stats above have room. A run deck can reach 24
 * cards, its 20 and the signature cards of up to four escorts (Game Flow
 * 1.2), so past 21 kinds the columns grow rather than take a fourth row,
 * which a 600-tall screen couldn't hold: 24 kinds are three rows of eight.
 */
export function driverDeckGrid(kinds: number): { columns: number; rows: number } {
	const { min, max } = DRIVER_DETAIL.columns;
	const rows = Math.min(DRIVER_DETAIL.rows, Math.ceil(kinds / max));
	return { columns: rows > 0 ? Math.max(min, Math.ceil(kinds / rows)) : min, rows };
}

/**
 * Cheapest first and then by name, the order the Crew screen, its locker,
 * and load out show cards in, names compared as a pile's are (`drawPileOrder`).
 */
export function deckOrder(a: GameCard, b: GameCard): number {
	return a.cost - b.cost || a.displayName.localeCompare(b.displayName);
}

/** The deck's cards the lookup knows, in `deckOrder`. */
function deckEntries(deck: CardCounts, cards: CardLookup): { card: GameCard; copies: number }[] {
	const entries: { card: GameCard; copies: number }[] = [];
	for (const [type, copies] of Object.entries(deck)) {
		if (copies < 1) continue;
		const card = cards(type);
		if (card) entries.push({ card, copies });
	}
	return entries.sort((a, b) => deckOrder(a.card, b.card));
}

/**
 * One row of a detail view's mono: a label's muted capitals, or a stat's
 * brighter figures, hugging its words. With `ellipsis` it's cut short once
 * layout gives it a width. The escort detail view's rows are the same.
 */
export function detailMono({ id, text, kind, x = 0, ellipsis = false }: { id: string; text: string; kind: 'label' | 'figures'; x?: number; ellipsis?: boolean }): Text {
	const label = kind === 'label';
	return new Text({
		id,
		text,
		x,
		height: DRIVER_DETAIL.mono.height,
		style: {
			fontRole: 'mono',
			fontSize: DRIVER_DETAIL.mono.size,
			color: label ? CARD_MUTED : CARD_RULES,
			letterSpacing: label ? DRIVER_DETAIL.mono.labelSpacing : DRIVER_DETAIL.mono.figureSpacing,
			textTransform: label ? 'uppercase' : 'none',
		},
		lineHeight: DRIVER_DETAIL.mono.height / DRIVER_DETAIL.mono.size,
		verticalAlign: 'middle',
		wrap: 'none',
		textOverflow: ellipsis ? 'ellipsis' : undefined,
	});
}

export interface DriverDetailViewOptions {
	id?: string;
	data: DriverCardData;
	/** Where the deck's card types are looked up: the screen's loaded cards. */
	cards: CardLookup;
	/** Pinned open: the foot says so instead of how to pin it. */
	pinned?: boolean;
}

/**
 * A driver card's detail view (Game Flow 7.0): their full stats and their
 * deck. The person heads it: the portrait, the name on up to two lines,
 * and the vehicle and specialty on one line under it. Then HP as figures
 * and a bar, the hand limit, and their skills; then the deck as mini cards
 * stacked to their copies, spaced as every grid of minis is (`MINI_GRID`),
 * cheapest first; then a foot with the card's note, if it has one, and how
 * to pin the view. Nothing optional adds a row, so a run deck's three rows
 * fit a 600-tall screen.
 *
 * Its width is set by the deck, so its owner can place it before it has
 * laid out; its height comes from its measured text, as the play card's
 * detail view's does.
 */
export class DriverDetailView extends Component {
	private readonly model: DriverCardData;
	private readonly grid: { columns: number; rows: number };
	private readonly name: Text;
	/** The vehicle and specialty, under the name. */
	private readonly identity: Text;
	private readonly hp: Text;
	/** The hand limit and the skills, flowed in rows across the view. */
	private readonly stats: FlowWrap;
	private readonly heading: Text;
	/** How a lost driver went, at the left of the foot; null without a note. */
	private readonly note: Text | null;
	private readonly pin: Text;
	private readonly minis: UICard[];
	private readonly frame: RivetedFrameDraws;
	private readonly portrait: PortraitDraws;
	private readonly hpBar: StatBarDraws = statBarDraws(DRIVER_HP_FILLS);
	private readonly ruleDraw: DrawRectOptions & { rect: Rect };

	constructor({ id = 'driver_detail_view', data, cards, pinned = false }: DriverDetailViewOptions) {
		const entries = deckEntries(data.deck, cards);
		const grid = driverDeckGrid(entries.length);
		const { pad, portrait: portraitSize, gap } = DRIVER_DETAIL;
		const width = pad * 2 + MINI_GRID.margin * 2 + miniGridWidth(grid.columns);
		super({ id, width, height: pad * 2 });
		this.componentType = 'DriverDetailView';
		this.model = data;
		this.grid = grid;
		const childId = (suffix: string): string => `${id}_${suffix}`;

		this.frame = rivetedFrameDraws({ id, width, height: pad * 2, shadow: DETAIL_SHADOW });
		this.portrait = portraitDraws({ x: pad, y: pad, width: portraitSize, height: portraitSize });
		this.ruleDraw = { rect: { x: pad, y: 0, width: width - pad * 2, height: DRIVER_DETAIL.rule }, fill: resolveColor(CARD_LINE_FAINT) };

		const columnX = pad + portraitSize + gap;
		const columnWidth = width - pad - columnX;
		this.name = new Text({
			id: childId('name'),
			text: data.name,
			x: columnX,
			y: pad,
			width: columnWidth,
			height: DRIVER_DETAIL.name.lineHeight * DRIVER_DETAIL.name.lines,
			style: { fontRole: 'display', fontSize: DRIVER_DETAIL.name.size, color: CARD_NAME },
			lineHeight: DRIVER_DETAIL.name.lineHeight / DRIVER_DETAIL.name.size,
			verticalAlign: 'top',
			wrap: 'word',
			textOverflow: 'ellipsis',
		});
		const specialty = data.specialty.toUpperCase();
		this.identity = new Text({
			id: childId('identity'),
			text: data.vehicle ? `${data.vehicle} / ${specialty}` : specialty,
			x: columnX,
			width: columnWidth,
			height: DRIVER_DETAIL.identity.height,
			style: { fontSize: DRIVER_DETAIL.identity.size, color: CARD_MUTED },
			lineHeight: DRIVER_DETAIL.identity.height / DRIVER_DETAIL.identity.size,
			verticalAlign: 'middle',
			wrap: 'none',
			textOverflow: 'ellipsis',
		});

		this.hp = detailMono({ id: childId('hp'), text: `HP ${data.hitpoints}/${data.maxHitpoints}`, kind: 'figures', x: pad });
		this.stats = new FlowWrap({ id: childId('stats'), x: pad, width: width - pad * 2, gap: DRIVER_DETAIL.stats.gap, rowGap: DRIVER_DETAIL.stats.rowGap });
		const stats: [string, string][] = [['hand_limit', `HAND LIMIT ${data.handLimit}`]];
		const skills = data.skills;
		if (skills) {
			stats.push(
				['ramming', `RAMMING ${skills.ramming}`],
				['gunnery', `GUNNERY ${skills.gunnery}`],
				['evade', `EVADE ${skills.evade}`],
				// A driver's speed adds to whatever vehicle they drive (Combat Rules)
				['speed', `SPEED +${skills.speed}`],
			);
		}
		for (const [suffix, text] of stats) this.stats.addChild(detailMono({ id: childId(suffix), text, kind: 'figures' }));
		// What it shows, so a type the lookup doesn't know leaves the count and the minis agreeing
		const size = entries.reduce((total, { copies }) => total + copies, 0);
		this.heading = detailMono({ id: childId('deck'), text: `DECK / ${size} ${size === 1 ? 'CARD' : 'CARDS'}`, kind: 'label', x: pad });
		// Its width is the room the pin hint leaves, set in layout
		this.note = data.note ? detailMono({ id: childId('note'), text: data.note, kind: 'label', x: pad, ellipsis: true }) : null;
		this.pin = detailMono({ id: childId('pin'), text: pinHint(pinned), kind: 'label' });
		this.minis = entries.map(({ card, copies }) => {
			const mini = new UICard({ id: childId(`card_${card.type}`), x: 0, y: 0, data: card, size: CardSize.MINI, copies });
			// A view to read, not a deck to work: its cards take no pointer of their own
			mini.pointerEvents = 'none';
			return mini;
		});

		for (const child of [this.name, this.identity, this.hp, this.stats, this.heading, ...this.minis]) this.addChild(child);
		if (this.note) this.addChild(this.note);
		this.addChild(this.pin);
	}

	/** The driver it shows. */
	public get data(): DriverCardData {
		return this.model;
	}

	/** How its deck is laid out: columns across, rows down. */
	public get deckGrid(): { readonly columns: number; readonly rows: number } {
		return this.grid;
	}

	/** The deck's mini cards, in the order they're laid out. */
	public get deckCards(): readonly UICard[] {
		return this.minis;
	}

	protected layoutChildren(): void {
		this.arrange();
	}

	/**
	 * Lays the view out top to bottom from its measured text and takes the
	 * height that needs, moving the draws built with the view in place.
	 */
	public arrange(): void {
		const { pad, portrait: portraitSize, gap, mono } = DRIVER_DETAIL;
		const right = this.width - pad;

		// The head: the name on one line or two, the vehicle and specialty under it, beside the portrait
		const nameLines = Math.min(DRIVER_DETAIL.name.lines, Math.max(1, this.name.measured?.lines ?? 1));
		this.name.height = nameLines * DRIVER_DETAIL.name.lineHeight;
		this.identity.y = pad + this.name.height + 2;
		let y = Math.max(pad + portraitSize, this.identity.y + this.identity.height) + gap;

		// HP as figures, its bar running to the right edge
		this.hp.y = y;
		const barX = pad + this.hp.width + DRIVER_DETAIL.bar.gap;
		placeStatBar(
			this.hpBar,
			{ x: barX, y: y + (mono.height - DRIVER_DETAIL.bar.height) / 2, width: Math.max(0, right - barX), height: DRIVER_DETAIL.bar.height },
			hpFraction(this.model),
		);
		y += mono.height + DRIVER_DETAIL.stats.rowGap;

		// The hand limit and the skills, wrapping at the right edge
		this.stats.y = y;
		y += this.stats.measure(this.stats.width, Infinity).height + gap;

		// A rule between the person and their deck
		this.ruleDraw.rect.y = y;
		y += DRIVER_DETAIL.rule + gap;
		this.heading.y = y;
		y += mono.height;

		// The minis, inside the grid's margin so their hexes and stacks stay in the view
		const { columns, rows } = this.grid;
		this.minis.forEach((mini, index) => {
			mini.x = pad + MINI_GRID.margin + (index % columns) * (MINI_SIZE.width + MINI_GRID.gap);
			mini.y = y + MINI_GRID.margin + Math.floor(index / columns) * (MINI_SIZE.height + MINI_GRID.gap);
		});
		if (rows > 0) y += MINI_GRID.margin * 2 + miniGridHeight(rows);

		// The foot: the note at the left, cut short of the pin hint at the right
		y += DRIVER_DETAIL.foot.gap;
		this.pin.y = y;
		this.pin.x = right - this.pin.width;
		if (this.note) {
			this.note.y = y;
			this.note.width = Math.max(1, this.pin.x - DRIVER_DETAIL.foot.between - pad);
		}
		const height = y + mono.height + pad;
		resizeRivetedFrame(this.frame, { width: this.width, height });
		if (this.height !== height) this.height = height;
	}

	/** The frame's drop shadow. */
	public get inkExtent(): number {
		return shadowExtent(DETAIL_SHADOW);
	}

	public render(draw: DrawApi): void {
		drawRivetedFrame(draw, this.frame);
		drawPortrait(draw, this.portrait);
		drawStatBar(draw, this.hpBar);
		draw.drawRect(this.ruleDraw);
	}
}
