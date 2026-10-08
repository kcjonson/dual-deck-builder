import type { ResolvedColors } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import { CardBase } from './CardBase';
import { CARD_DIM_FILLS, CARD_GROUND_FILLS, CARD_MUTED, CARD_NAME, CARD_RULES, HOVER_OUTLINE, SELECTED_OUTLINE, textTones } from './cardStyle';
import type { CardLookup } from './DriverDetailView';
import { EscortCardData, sameEscortCardData } from './escortCardData';
import {
	ESCORT_FRAME,
	EscortFrameDraws,
	HAZARD_HEADER,
	STRUCTURE_FILLS,
	VehicleArtDraws,
	drawEscortFrame,
	drawVehicleArt,
	escortFrameDraws,
	shapeVehicleArt,
	toneEscortFrame,
	toneVehicleArt,
	vehicleArtDraws,
} from './escortCardStyle';
import { StatBarDraws, barFraction, drawStatBar, placeStatBar, statBarDraws, toneStatBar } from './statBar';
import { STATUS_TAG_HEIGHT, StatusTagDraw } from './statusTag';
import { spriteKindOf } from './vehicleSprites';

/**
 * An escort card's size (Game Flow 7.0): a mini card's, so it lines up with
 * the play cards it adds to a deck.
 */
export const ESCORT_CARD_SIZE: Readonly<{ width: number; height: number }> = Object.freeze({ width: 80, height: 112 });

const STAYING_TAG = 'STAYING';

/**
 * The face, from the "Card sizes" board, in its own pixels from the outer
 * edge: the header, the art, the name with two lines' room whatever it
 * needs, so a row of cards keeps its bars level, the structure bar with its
 * figures, and the signature card it brings.
 */
const FACE = {
	content: { x: 6, width: 68 },
	art: { y: ESCORT_FRAME.border + HAZARD_HEADER.height + 4, height: 33, radius: 3, inset: { x: 10, y: 5 } },
	name: { y: 51, size: 13, lineHeight: 1.05, lines: 2 },
	/** How tall the structure row and the signature row are. */
	row: 10,
	/** Five mono figures at 9 px are 27 px, which every escort's structure fits ("80/80" is an Apocalypse Rig's, carrying on unmanned). */
	structure: { y: 81, bar: 5, figures: 28, gap: 4 },
	signature: { y: 93 },
	mono: { size: 9 },
	/** STAYING straddles the top edge and hangs past the right one, as a mini's tag does. */
	tag: { right: 84, y: -Math.ceil(STATUS_TAG_HEIGHT / 2) },
	/** A selected card's line, as a selected mini's: the bright yellow, a pixel heavier. */
	selected: 3,
} as const;

/** The structure bar's box: from the content's left edge up to the figures. */
const STRUCTURE_BAR: Readonly<Rect> = Object.freeze({
	x: FACE.content.x,
	y: FACE.structure.y + (FACE.row - FACE.structure.bar) / 2,
	width: FACE.content.width - FACE.structure.figures - FACE.structure.gap,
	height: FACE.structure.bar,
});

/**
 * How far past its 80x112 box an escort card draws, on any side: its tag up
 * and right, no further than a mini's, so escort cards and minis share
 * `MINI_GRID`.
 */
export const ESCORT_CARD_INK = Math.max(-FACE.tag.y, FACE.tag.right - ESCORT_CARD_SIZE.width);

const NAME_TONES = textTones(CARD_NAME);
const MUTED_TONES = textTones(CARD_MUTED);
const FIGURE_TONES = textTones(CARD_RULES);

/**
 * An escort card (Game Flow 7.0, "Drivers and escorts are cards too"): an
 * 80x112 card of a vehicle in the convoy, set apart from play cards of the
 * same size by a hazard-stripe header, with its art, name, structure bar,
 * and the signature card it brings. Used in load out's escort row, the
 * garage's convoy strip, and escort offers in events.
 *
 * It shows `EscortCardData`, which each screen maps its own model onto,
 * and looks up its signature card's name in the screen's cards. A card
 * left at home for this run is `staying`: faded, with a STAYING tag, and
 * still enabled, focusable, and inspectable, as a faded mini is. Hover,
 * focus, and a touch hold open its detail view, and a secondary click or I
 * pins it, on the same path as every card's (`makeEscortInspectable`).
 *
 * One composite target (R8.29): the frame, header, art, bar, focus ring,
 * and tag are the card's own draws, built once and recoloured in place;
 * its words are parts.
 */
export class EscortCard extends CardBase<EscortCardData> {
	private model: EscortCardData;
	private readonly lookup: CardLookup;
	private dimmed = false;

	private readonly name: Text;
	private readonly structureFigures: Text;
	private readonly signature: Text;

	private readonly frame: EscortFrameDraws;
	private readonly art: VehicleArtDraws;
	private readonly structureBar: StatBarDraws = statBarDraws(STRUCTURE_FILLS);
	private readonly tag = new StatusTagDraw({ right: FACE.tag.right, y: FACE.tag.y });

	constructor({ id, x = 0, y = 0, data, cards, staying = false }: {
		id?: string;
		x?: number;
		y?: number;
		data: EscortCardData;
		/** Where its signature card's type is looked up: the screen's loaded cards. A type it doesn't know shows no card. */
		cards: CardLookup;
		/** Left at home for this run: faded, with a STAYING tag. */
		staying?: boolean;
	}) {
		const { width, height } = ESCORT_CARD_SIZE;
		super({ id, x, y, width, height });
		this.componentType = 'EscortCard';
		this.model = data;
		this.lookup = cards;

		this.frame = escortFrameDraws({ id, width, height });
		const { x: left, width: contentWidth } = FACE.content;
		this.art = vehicleArtDraws({ x: left, y: FACE.art.y, width: contentWidth, height: FACE.art.height, inset: FACE.art.inset, radius: FACE.art.radius });

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
		this.structureFigures = this.monoLine({ id: 'structure', x: left + contentWidth - FACE.structure.figures, y: FACE.structure.y, width: FACE.structure.figures, color: FIGURE_TONES.full, align: 'right' });
		this.signature = this.monoLine({ id: 'signature', x: left, y: FACE.signature.y, width: contentWidth, color: MUTED_TONES.full, align: 'left' });
		for (const part of [this.name, this.structureFigures, this.signature]) this.addChild(part);

		this.showData();
		this.staying = staying;
	}

	/** A line of mono, one row of the face tall; a value too long for its box ends in an ellipsis. */
	private monoLine({ id, x, y, width, color, align }: { id: string; x: number; y: number; width: number; color: RGBA; align: 'left' | 'right' }): Text {
		return new Text({
			id: this.childId(id),
			x,
			y,
			width,
			height: FACE.row,
			style: { fontRole: 'mono', fontSize: FACE.mono.size, color, textAlign: align },
			lineHeight: FACE.row / FACE.mono.size,
			verticalAlign: 'middle',
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
	}

	/** The escort it shows. */
	public get data(): EscortCardData {
		return this.model;
	}

	/**
	 * Shows another escort, or the same one changed (structure after a fight
	 * or a repair), in place. A pinned detail view follows the data unless
	 * the new data shows the same (`refreshPinnedView`).
	 */
	public set data(data: EscortCardData) {
		if (data === this.model) return;
		const same = sameEscortCardData(data, this.model);
		this.model = data;
		if (same) return;
		this.showData();
		this.refreshPinnedView();
	}

	/** Where its signature card's type is looked up, which its detail view uses too. */
	public get cards(): CardLookup {
		return this.lookup;
	}

	/** The words, the bar, and the vehicle for the data; texts measure only what changed. */
	private showData(): void {
		const data = this.model;
		this.name.text = data.name;
		this.structureFigures.text = `${data.structure}/${data.maxStructure}`;
		const card = data.signatureCard ? this.lookup(data.signatureCard) : null;
		this.signature.text = card ? `+ ${card.displayName}` : '';
		// An emptied bar leaves its fill out, but only structure can empty it, and
		// new figures invalidate layout, which forgets the walked group count
		placeStatBar(this.structureBar, STRUCTURE_BAR, barFraction(data.structure, data.maxStructure));
		const before = this.art.sprite.kind;
		shapeVehicleArt(this.art, spriteKindOf({ name: data.name, maxStructure: data.maxStructure, escort: true }));
		// A different vehicle draws a different number of shapes
		if (before !== null && before !== this.art.sprite.kind) this.invalidateInk();
	}

	/** Left at home for this run (load out): faded, with a STAYING tag. */
	public get staying(): boolean {
		return this.tag.text !== '';
	}

	public set staying(staying: boolean) {
		if (staying === this.staying) return;
		this.tag.text = staying ? STAYING_TAG : '';
		this.tag.place(this.context?.draw);
		this.updateLook();
		// The tag comes and goes as draws of its own
		this.invalidateInk();
	}

	/** Staying: darker and greyer, as a faded mini is. */
	public get faded(): boolean {
		return this.staying;
	}

	/** Sizes the tag to its text once the context can measure; a no-op after that until the text changes. */
	protected layoutChildren(): void {
		this.tag.place(this.context?.draw);
	}

	/** The tag, which reaches past the top and right edges. */
	public get inkExtent(): number {
		return ESCORT_CARD_INK;
	}

	/** Faded while staying or disabled, then the line for the card's state. */
	protected updateLook(): void {
		this.dim(!this.effectivelyEnabled || this.faded);
		this.applyBorder();
	}

	/**
	 * The line: selection's, as a selected mini's, then hover's or keyboard
	 * focus's on a card that can be used, else the frame's own dim line. The
	 * dispatcher keeps `hovered` true over a disabled card (R9.8), so the
	 * outline checks enabled itself.
	 */
	private applyBorder(): void {
		const border = this.frame.outline.border;
		if (this.selected) {
			border.color = SELECTED_OUTLINE;
			border.width = FACE.selected;
		} else if ((this.hovered || this.focusVisible) && this.effectivelyEnabled) {
			border.color = HOVER_OUTLINE;
			border.width = ESCORT_FRAME.border;
		} else {
			border.color = CARD_DIM_FILLS[this.dimmed ? 'dimmed' : 'full'];
			border.width = ESCORT_FRAME.border;
		}
	}

	/**
	 * The mock's `.cant`, through colours rather than opacity, as every card
	 * fades: its own draws darken and its words take dimmed colours, picked
	 * from tones resolved once.
	 */
	private dim(dimmed: boolean): void {
		if (dimmed === this.dimmed) return;
		this.dimmed = dimmed;
		const tone = dimmed ? 'dimmed' : 'full';
		toneEscortFrame(this.frame, tone);
		toneVehicleArt(this.art, tone);
		toneStatBar(this.structureBar, tone);
		this.tag.dimmed = dimmed;
		this.name.color = NAME_TONES[tone];
		this.structureFigures.color = FIGURE_TONES[tone];
		this.signature.color = MUTED_TONES[tone];
	}

	/**
	 * Everything here is built once and recoloured on state changes, so a
	 * frame allocates nothing. The focus ring goes after the card's body and
	 * before its tag, so the tag sits on top of it.
	 */
	public render(draw: DrawApi): void {
		drawEscortFrame(draw, this.frame);
		drawVehicleArt(draw, this.art);
		drawStatBar(draw, this.structureBar);
		this.drawFocusRing(draw);
		this.tag.render(draw);
	}

	/** The ground is the card's fill and its line its border (R13.22). */
	public get resolvedColors(): ResolvedColors {
		return { fill: this.frame.ground.fill ?? CARD_GROUND_FILLS.full, border: this.frame.outline.border.color };
	}

	/** The tag, which the card draws itself, for the snapshot's labels and the text record (DDB-206). */
	public get drawnText(): readonly string[] | null {
		return this.tag.text ? [this.tag.text] : null;
	}

	/** The tag is part of the card, so the pointer can travel onto it without leaving it. */
	public containsPoint(localX: number, localY: number): boolean {
		if (localX >= 0 && localX < this.width && localY >= 0 && localY < this.height) return true;
		return this.tag.contains(localX, localY);
	}
}
