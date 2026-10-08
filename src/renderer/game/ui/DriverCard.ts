import { Component, PointerEvents } from '../../engine/components/Component';
import type { Cursor, ResolvedColors } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions } from '../../engine/draw/commands';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import type { AnyUiEvent } from '../../engine/input/events';
import { resolveColor } from '../../engine/style/styleObject';
import { tokens } from '../../engine/theme/tokens';
import { totalCards } from '../campaign/CardCounts';
import { CARD_GROUND_FILLS, CARD_MUTED, CARD_NAME, CARD_RULES, dimHex } from './cardStyle';
import type { DriverCardData } from './driverCardData';
import {
	FRAME_LINE_FILLS,
	HpBarDraws,
	PortraitDraws,
	RIVETED_FRAME,
	RivetedFrameDraws,
	drawHpBar,
	drawPortrait,
	drawRivetedFrame,
	hpBarDraws,
	hpBarFilled,
	hpFraction,
	placeHpBar,
	portraitDraws,
	rivetedFrameDraws,
	toneHpBar,
	tonePortrait,
	toneRivetedFrame,
} from './driverCardStyle';
import { STATUS_TAG_HEIGHT, StatusTagDraw } from './statusTag';

/**
 * A driver card's size (Game Flow 7.0): a little bigger than a mini card,
 * since it's a person and sits beside their deck.
 */
export const DRIVER_CARD_SIZE: Readonly<{ width: number; height: number }> = Object.freeze({ width: 104, height: 146 });

/**
 * Where a driver stands, as their card's tag says it: injured, lost on a
 * run, new to the pool, or in a seat at load out. A lost driver's card is
 * always faded. A customized run deck is a tag of its own (`customDeck`),
 * since it can go with a seat.
 */
export type DriverCardStatus = 'injured' | 'lost' | 'new' | 'seat1' | 'seat2';

const STATUS_TAGS: Readonly<Record<DriverCardStatus, string>> = {
	injured: 'INJURED',
	lost: 'LOST',
	new: 'NEW',
	seat1: 'SEAT 1',
	seat2: 'SEAT 2',
};
const CUSTOM_TAG = 'CUSTOM';

/**
 * The face, from the "Card sizes" board, in its own pixels from the outer
 * edge: everything sits inside the frame's corner rivets. The name has two
 * lines whatever it needs, so a row of cards keeps the specialty, the HP
 * bar, and the foot level; the HP figures have a box sized for "40/40",
 * so the bars line up too.
 */
const FACE = {
	content: { x: 11, width: 82 },
	portrait: { y: 10, height: 60 },
	name: { y: 74, size: 13, lineHeight: 1.05, lines: 2 },
	/** How tall each row under the name is: the specialty, HP, and the foot. */
	row: 11,
	/**
	 * The board's mono doesn't fit SUPPORT SPECIALIST in 82 px at a size
	 * anyone can read (106 px at the tag's 9), so the specialty is the
	 * condensed display face, tracked.
	 */
	specialty: { y: 102, size: 10, letterSpacing: 0.04 },
	hp: { y: 114, bar: 5, figures: 30, gap: 4 },
	/** The hand limit at the left, the deck size at the right, two digits each and room between. */
	foot: { y: 126, width: 40 },
	/** The HP figures and the foot: mono, lightly tracked. */
	mono: { size: 9, letterSpacing: 0.04 },
	/**
	 * The tags straddle the top edge and hang past the right one, as a mini
	 * card's does; a CUSTOM tag stands left of a status tag, this far apart.
	 */
	tag: { right: 108, y: -Math.ceil(STATUS_TAG_HEIGHT / 2), gap: 3 },
	selectedBorder: 3,
} as const;

/** The HP bar's box: from the content's left edge up to the figures. */
const HP_BAR: Readonly<Rect> = Object.freeze({
	x: FACE.content.x,
	y: FACE.hp.y + (FACE.row - FACE.hp.bar) / 2,
	width: FACE.content.width - FACE.hp.figures - FACE.hp.gap,
	height: FACE.hp.bar,
});

/**
 * How far past its 104x146 box a driver card draws, on any side: its tags
 * up and right. Nothing else leaves the box, so cards spaced by `MINI_GRID`
 * clear each other's tags, as minis do.
 */
export const DRIVER_CARD_INK = Math.max(-FACE.tag.y, FACE.tag.right - DRIVER_CARD_SIZE.width);

const HOVER_OUTLINE: RGBA = [...tokens.color.accent];
const SELECTED_OUTLINE: RGBA = [...tokens.color.accent_bright];

/** A text colour at full strength and as a faded card's words take it (the mock's `.cant`). */
function textTones(hex: string): { full: RGBA; dimmed: RGBA } {
	return { full: resolveColor(hex), dimmed: resolveColor(dimHex(hex)) };
}

const NAME_TONES = textTones(CARD_NAME);
const MUTED_TONES = textTones(CARD_MUTED);
const FIGURE_TONES = textTones(CARD_RULES);

/**
 * A driver card (Game Flow 7.0, "Drivers and escorts are cards too"): the
 * 104x146 card of a person, with a riveted double frame no play card has,
 * a portrait, the name on up to two lines, the specialty, an HP bar, the
 * hand limit, the deck size, and the tags that say where they stand. Used
 * on the Crew roster, load out's seats and pool, the debrief, and a find.
 *
 * It shows `DriverCardData`, which each screen maps its own model onto.
 * A faded card (`unavailable`, or lost) stays enabled, focusable, and
 * inspectable, as a faded mini does; why it can't be picked is the
 * consumer's to say, on the control under it. Hover, focus, and a touch
 * hold open its detail view, and a secondary click or I pins it, on the
 * same path as a play card's (`makeDriverInspectable`).
 *
 * One composite target (R8.29): the frame, rivets, portrait, HP bar, focus
 * ring, and tags are the card's own draws, built once and recoloured or
 * moved in place; its words are parts.
 */
export class DriverCard extends Component {
	private model: DriverCardData;
	private standing: DriverCardStatus | null = null;
	private custom = false;
	private unusable = false;
	private dimmed = false;

	private readonly name: Text;
	private readonly specialty: Text;
	private readonly hpFigures: Text;
	private readonly hand: Text;
	private readonly deck: Text;

	private readonly frame: RivetedFrameDraws;
	private readonly portrait: PortraitDraws;
	private readonly hpBar: HpBarDraws = hpBarDraws();
	private readonly focusRingDraw: DrawRectOptions;
	private readonly statusTag = new StatusTagDraw({ right: FACE.tag.right, y: FACE.tag.y });
	private readonly deckTag = new StatusTagDraw({ right: FACE.tag.right, y: FACE.tag.y });

	/** A click or `activate` on the card, with the data it shows (R8.25). */
	public onSelect: ((data: DriverCardData) => void) | null = null;

	constructor({ id, x = 0, y = 0, data, status = null, customDeck = false, unavailable = false }: {
		id?: string;
		x?: number;
		y?: number;
		data: DriverCardData;
		/** The tag at the card's corner; none when null. */
		status?: DriverCardStatus | null;
		/** A run deck customized for this run (load out): a CUSTOM tag. */
		customDeck?: boolean;
		/** Faded: they can't be picked here, for a reason the consumer gives. */
		unavailable?: boolean;
	}) {
		const { width, height } = DRIVER_CARD_SIZE;
		super({ id, x, y, width, height });
		this.componentType = 'DriverCard';
		this.model = data;

		this.frame = rivetedFrameDraws({ id, width, height });
		const { x: left, width: contentWidth } = FACE.content;
		this.portrait = portraitDraws({ x: left, y: FACE.portrait.y, width: contentWidth, height: FACE.portrait.height });
		const ringOffset = tokens.control.focus_ring_offset;
		this.focusRingDraw = {
			id: id !== undefined ? `${id}.focus_ring` : undefined,
			rect: { x: -ringOffset, y: -ringOffset, width: width + ringOffset * 2, height: height + ringOffset * 2 },
			radius: tokens.radius.radius_ui + ringOffset,
			// A rect with no fill is white (R2.8's default); the ring is border only.
			fill: [0, 0, 0, 0],
			border: { color: tokens.color.accent, width: tokens.control.focus_ring_width, position: 'outside' },
		};

		this.name = new Text({
			id: this.childId('name'),
			x: left,
			y: FACE.name.y,
			width: contentWidth,
			height: FACE.name.size * FACE.name.lineHeight * FACE.name.lines,
			style: { fontRole: 'display', fontSize: FACE.name.size, color: NAME_TONES.full },
			lineHeight: FACE.name.lineHeight,
			verticalAlign: 'top',
			wrap: 'word',
			textOverflow: 'ellipsis',
		});
		this.specialty = new Text({
			id: this.childId('specialty'),
			x: left,
			y: FACE.specialty.y,
			width: contentWidth,
			height: FACE.row,
			style: { fontRole: 'display', fontSize: FACE.specialty.size, color: MUTED_TONES.full, letterSpacing: FACE.specialty.letterSpacing, textTransform: 'uppercase' },
			lineHeight: FACE.row / FACE.specialty.size,
			verticalAlign: 'middle',
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.hpFigures = this.monoLine({ id: 'hp', x: left + contentWidth - FACE.hp.figures, y: FACE.hp.y, width: FACE.hp.figures, color: FIGURE_TONES.full, align: 'right' });
		this.hand = this.monoLine({ id: 'hand', x: left, y: FACE.foot.y, width: FACE.foot.width, color: MUTED_TONES.full, align: 'left' });
		this.deck = this.monoLine({ id: 'deck', x: left + contentWidth - FACE.foot.width, y: FACE.foot.y, width: FACE.foot.width, color: MUTED_TONES.full, align: 'right' });
		for (const part of [this.name, this.specialty, this.hpFigures, this.hand, this.deck]) this.addChild(part);

		this.showData();
		this.status = status;
		this.customDeck = customDeck;
		this.unavailable = unavailable;
	}

	/** A line of mono figures, one row of the face tall; a value too long for its box ends in an ellipsis. */
	private monoLine({ id, x, y, width, color, align }: { id: string; x: number; y: number; width: number; color: RGBA; align: 'left' | 'right' }): Text {
		return new Text({
			id: this.childId(id),
			x,
			y,
			width,
			height: FACE.row,
			style: { fontRole: 'mono', fontSize: FACE.mono.size, color, letterSpacing: FACE.mono.letterSpacing, textAlign: align },
			lineHeight: FACE.row / FACE.mono.size,
			verticalAlign: 'middle',
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
	}

	/** Parts derive their ids from the card's own, as a play card's do. */
	private childId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}

	/** The driver it shows. */
	public get data(): DriverCardData {
		return this.model;
	}

	/**
	 * Shows another driver, or the same one changed (HP after a fight, a
	 * deck rebuilt), in place. A pinned detail view was built from the old
	 * data when it opened, so it's pinned again, which builds it anew.
	 */
	public set data(data: DriverCardData) {
		if (data === this.model) return;
		this.model = data;
		this.showData();
		const tooltips = this.context?.tooltips;
		if (tooltips?.pinned === this) tooltips.pin(this, { fade: false });
	}

	/** The words and the HP bar for the data; texts measure only what changed. */
	private showData(): void {
		const data = this.model;
		this.name.text = data.name;
		this.specialty.text = data.note ?? data.specialty;
		this.hpFigures.text = `${data.hitpoints}/${data.maxHitpoints}`;
		this.hand.text = `HAND ${data.handLimit}`;
		this.deck.text = `DECK ${totalCards(data.deck)}`;
		const filled = hpBarFilled(this.hpBar);
		placeHpBar(this.hpBar, HP_BAR, hpFraction(data));
		// An empty bar leaves its fill out, so the draws change with it
		if (hpBarFilled(this.hpBar) !== filled) this.invalidateInk();
	}

	/** The tag at the card's corner, null for none. A lost driver's card is faded. */
	public get status(): DriverCardStatus | null {
		return this.standing;
	}

	public set status(status: DriverCardStatus | null) {
		if (status === this.standing) return;
		this.standing = status;
		this.statusTag.text = status ? STATUS_TAGS[status] : '';
		this.placeTags();
		this.updateLook();
		// A tag comes and goes as draws of its own
		this.invalidateInk();
	}

	/**
	 * A run deck customized for this run: a CUSTOM tag, left of the status
	 * tag when there is one (a seated driver in load out's pool), else at
	 * the corner (the seat's own card).
	 */
	public get customDeck(): boolean {
		return this.custom;
	}

	public set customDeck(customDeck: boolean) {
		if (customDeck === this.custom) return;
		this.custom = customDeck;
		this.deckTag.text = customDeck ? CUSTOM_TAG : '';
		this.placeTags();
		this.invalidateInk();
	}

	/**
	 * They can't be picked here: injured at load out, or the same archetype
	 * as a seated driver. Faded, with no tag of its own; the reason goes on
	 * the consumer's control under the card.
	 */
	public get unavailable(): boolean {
		return this.unusable;
	}

	public set unavailable(unavailable: boolean) {
		if (unavailable === this.unusable) return;
		this.unusable = unavailable;
		this.updateLook();
	}

	/** Unavailable or lost: darker and greyer, as a faded mini is. */
	public get faded(): boolean {
		return this.unusable || this.standing === 'lost';
	}

	/**
	 * Sizes the tags to their text, measuring only a text that changed, and
	 * stands a CUSTOM tag beside the status tag. A no-op until the context
	 * can measure; layout places them again once it can.
	 */
	private placeTags(): void {
		const draw = this.context?.draw;
		this.statusTag.place(draw);
		this.deckTag.place(draw);
		const status = this.statusTag;
		this.deckTag.right = status.shown ? status.right - status.width - FACE.tag.gap : FACE.tag.right;
	}

	protected layoutChildren(): void {
		this.placeTags();
	}

	/** R8.29: one target; its words and frame are internals. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/** A card someone listens to is clickable. */
	protected get defaultCursor(): Cursor | null {
		return this.onSelect ? 'pointer' : null;
	}

	public get handlesPointer(): boolean {
		return true;
	}

	/** The walk's fallback ring, drawn by the card so its tags sit on top of it. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** The tags, which reach past the top and right edges. */
	public get inkExtent(): number {
		return DRIVER_CARD_INK;
	}

	/** A click, or `activate` (Enter or Space) on a focused card, selects it (R9.27, R9.31). */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'activate':
				event.consume();
				this.onSelect?.(this.model);
				return;
			case 'click':
				this.onSelect?.(this.model);
				return;
		}
	}

	protected onStateChange(): void {
		this.updateLook();
	}

	/** Faded while unavailable, lost, or disabled, then the frame for the card's state. */
	private updateLook(): void {
		this.dim(!this.effectivelyEnabled || this.faded);
		this.applyBorder();
	}

	/**
	 * The outer line: selection's outline (the Crew roster's chosen driver),
	 * then hover's or keyboard focus's on a card that can be used, else the
	 * frame's own line. The inner line and the rivets stay, so a selected
	 * card still reads as a driver's.
	 */
	private applyBorder(): void {
		const border = this.frame.frame.border;
		if (this.selected) {
			border.color = SELECTED_OUTLINE;
			border.width = FACE.selectedBorder;
		} else if ((this.hovered || this.focusVisible) && this.effectivelyEnabled) {
			border.color = HOVER_OUTLINE;
			border.width = RIVETED_FRAME.outer;
		} else {
			border.color = FRAME_LINE_FILLS[this.dimmed ? 'dimmed' : 'full'];
			border.width = RIVETED_FRAME.outer;
		}
	}

	/**
	 * The mock's `.cant`, through colours rather than opacity, as a play
	 * card dims: the card's own draws darken and its words take dimmed
	 * colours, picked from tones resolved once.
	 */
	private dim(dimmed: boolean): void {
		if (dimmed === this.dimmed) return;
		this.dimmed = dimmed;
		const tone = dimmed ? 'dimmed' : 'full';
		toneRivetedFrame(this.frame, tone);
		tonePortrait(this.portrait, tone);
		toneHpBar(this.hpBar, tone);
		this.statusTag.dimmed = dimmed;
		this.deckTag.dimmed = dimmed;
		this.name.color = NAME_TONES[tone];
		this.specialty.color = MUTED_TONES[tone];
		this.hpFigures.color = FIGURE_TONES[tone];
		this.hand.color = MUTED_TONES[tone];
		this.deck.color = MUTED_TONES[tone];
	}

	/**
	 * Everything here is built once and recoloured on state changes, so a
	 * frame allocates nothing. The focus ring goes after the card's body and
	 * before its tags, so the tags sit on top of it.
	 */
	public render(draw: DrawApi): void {
		drawRivetedFrame(draw, this.frame);
		drawPortrait(draw, this.portrait);
		drawHpBar(draw, this.hpBar);
		if (this.focusVisible && this.effectivelyEnabled) draw.drawRect(this.focusRingDraw);
		this.statusTag.render(draw);
		this.deckTag.render(draw);
	}

	/** The ground is the card's fill and the outer line its border (R13.22). */
	public get resolvedColors(): ResolvedColors {
		return { fill: this.frame.frame.fill ?? CARD_GROUND_FILLS.full, border: this.frame.frame.border.color };
	}

	/** The tags, which the card draws itself, for the snapshot's labels and the text record (DDB-206). */
	public get drawnText(): readonly string[] | null {
		const labels: string[] = [];
		if (this.statusTag.text) labels.push(this.statusTag.text);
		if (this.deckTag.text) labels.push(this.deckTag.text);
		return labels.length > 0 ? labels : null;
	}

	/** The tags are part of the card, so the pointer can travel onto one without leaving it. */
	public containsPoint(localX: number, localY: number): boolean {
		if (localX >= 0 && localX < this.width && localY >= 0 && localY < this.height) return true;
		return this.statusTag.contains(localX, localY) || this.deckTag.contains(localX, localY);
	}
}
