import { Component, PointerEvents } from '../../engine/components/Component';
import { Icon } from '../../engine/components/Icon';
import { Text } from '../../engine/components/Text';
import type { Cursor, ResolvedColors } from '../../engine/components/Component';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawPolygonOptions, DrawRectOptions, DrawTextOptions } from '../../engine/draw/commands';
import type { AnyUiEvent } from '../../engine/input/events';
import { resolveColor } from '../../engine/style/styleObject';
import type { TweenHandle } from '../../engine/animation/Animator';
import { tokens } from '../../engine/theme/tokens';
import { normalizeTransform, transformMatrix } from '../../engine/components/componentGeometry';
import { RGBA, Rect, Vec2, concat, invert, transformPoint } from '../../engine/draw/geometry';
import { CardRarity, Card as GameCard } from '../mechanics/Card';
import { cardRange } from '../data/keywords';
import { hexRgba } from '../screens/combat/combatStyle';
import { MARK_OUTLINES, seatMark } from './targetMarks';
import { KeywordText } from './KeywordText';
import { dashedOutlineTriangles } from './stripes';
import {
	CARD_DIM,
	CARD_GROUND,
	CARD_GROUND_FILLS,
	CARD_KEYWORD,
	CARD_LINE,
	CARD_MUTED,
	CARD_MUTED_FILLS,
	CARD_NAME,
	CARD_RULES,
	COST_DIGITS,
	COST_DIGITS_UNPAYABLE,
	DIM_BRIGHTNESS,
	RARITY_GEMS,
	artGradient,
	cardArtIcon,
	cardTypeLabel,
	dimHex,
	COST_HEX_FILLS,
	DRIVER_MARK_FILLS,
	GEM_FILLS,
	costHexDraws,
	driverMarkDraw,
	rarityGemDraw,
	frameColor,
	scale,
} from './cardStyle';

/**
 * The sizes of one card (Game Flow 7.0). The full text has its own view,
 * `CardDetailView`, rather than a bigger face.
 */
export enum CardSize {
	/** Deck building, and anywhere many cards share a screen. */
	MINI = 'mini',
	/** The face: the hand, piles, rewards, the card browser. */
	NORMAL = 'normal',
}

/**
 * Card dimensions for each size variant: the face is 128x180 (Battle Screen
 * Design, section 4), the mini 80x112 (Game Flow 7.0).
 */
const CARD_DIMENSIONS = {
	[CardSize.MINI]: { width: 80, height: 112 },
	[CardSize.NORMAL]: { width: 128, height: 180 },
} as const;

/**
 * The face, from the mock's `.card`: every box in the card's own pixels,
 * measured from its outer edge.
 */
const FACE = {
	radius: 6,
	border: 2,
	/** The cost hex hangs off the top-left corner. */
	hex: { x: -7, y: -7, size: 30, digits: 19 },
	mark: { x: 110, y: 6, size: 12 },
	/** The type's right edge, left of the driver mark. */
	type: { right: 106, y: 5, height: 14, size: 11 },
	name: { x: 8, y: 24, width: 112, height: 18, sizes: [16, 14] },
	art: { x: 6, y: 45, width: 116, height: 52, radius: 3, icon: 38, inset: { right: 6, bottom: 4 } },
	/** Three lines of 12 over 17 in 114 (section 5's short text). */
	rules: { x: 7, y: 101, width: 114, size: 12, lineHeight: 17, lines: 3 },
	foot: { x: 8, right: 120, y: 158, height: 16, gem: 8, size: 11 },
} as const;

/**
 * The mini card, from the "Card sizes" board (Game Flow 7.0): the face's
 * parts less the summary, in its own pixels from the outer edge. The hex
 * hangs off the top-left corner as the face's does, the name sits beside
 * it on up to two lines, and the type and the rarity gem share the foot.
 */
const MINI = {
	radius: 5,
	border: 2,
	hex: { x: -5, y: -5, size: 22, digits: 14 },
	/** Two lines of 13 in 56, which every card's name fits whole. */
	name: { x: 20, y: 5, width: 56, size: 13, lineHeight: 1.05, lines: 2 },
	art: { x: 6, y: 35, width: 68, height: 48, radius: 3, icon: 28, inset: { right: 4, bottom: 3 } },
	type: { x: 7, y: 88, height: 14, size: 10 },
	gem: { x: 68, y: 95, size: 7 },
	/**
	 * Copies past the first show as card edges behind the front one, a step
	 * down and right each, two at most, outlined a little darker than the frame.
	 */
	stack: { step: 3, edges: 2, brightness: 0.7 },
	/** The "x5" pill: across the bottom edge, flush with the stack's last edge. */
	count: { height: 14, size: 11, padding: 5 },
	/** A state's tag: across the top edge, hanging past the right one like a sticker. */
	tag: { right: 84, y: -7, height: 13, size: 9, padding: 4, letterSpacing: 0.06 },
	/** A borrowed copy's frame: the border in dashes, clear of the rounded corners. */
	dash: { length: 5, gap: 3 },
} as const;

/**
 * How far past its 80x112 box a mini draws, on any side: the cost hex up
 * and left, a state tag up and right, a stack's edges and count right and
 * down. None of it takes layout space, so minis in a grid sit at least
 * twice this apart, or one's stack runs into the next one's hex.
 */
export const MINI_CARD_INK = Math.max(
	-MINI.hex.x + Math.ceil(MINI.hex.size / 15),
	-MINI.tag.y,
	MINI.tag.right - CARD_DIMENSIONS[CardSize.MINI].width,
	MINI.stack.step * MINI.stack.edges,
	MINI.count.height / 2,
);

/**
 * Where a mini's copies stand against the deck being built (Game Flow 7.0):
 * borrowed from the locker for this run (a dashed frame, "+1"), left at
 * home for it (faded, HOME), an escort's locked card (LOCKED), or
 * unavailable (faded; why is the consumer's to say, on the control under
 * the card, not the card's).
 */
export type MiniCardState = 'borrowed' | 'home' | 'locked' | 'unavailable';

/** The face's short text box, which the card data check measures against. */
export const FACE_RULES = { width: FACE.rules.width, fontSize: FACE.rules.size, lineHeight: FACE.rules.lineHeight, maxLines: FACE.rules.lines } as const;

/** How far a hovered or selected card rises, through its transform so layout never sees it (R8.26). */
export const CARD_LIFT = 14;
/** A lifted card grows a little, about its bottom edge, so it reads as picked up. */
const LIFT_SCALE = 1.04;
const BOTTOM_CENTRE: readonly [number, number] = [0.5, 1];
/** The pose a lift settles at, whatever the fan pose it rose from. */
const LIFTED_TRANSFORM = normalizeTransform({ translate: [0, -CARD_LIFT], scale: LIFT_SCALE, origin: BOTTOM_CENTRE });

/**
 * Where a card rests in a fan: turned about its bottom centre by `rotate`
 * radians and dropped by `drop`, in its own units. Lifting straightens it.
 * `order` is its place in the fan's stacking and becomes the card's
 * `zIndex`: each card covers the one before it, which is the overlap the
 * fan declares (R13.25.1).
 */
export interface FanPose {
	rotate: number;
	drop: number;
	order: number;
}

const HOVER_OUTLINE: RGBA = [...tokens.color.accent];
const SELECTED_OUTLINE: RGBA = [...tokens.color.accent_bright];
const SELECTED_BORDER = 3;

const UNFANNED: FanPose = Object.freeze({ rotate: 0, drop: 0, order: 0 });

const TAG_TEXT = { full: resolveColor(CARD_NAME), dimmed: resolveColor(dimHex(CARD_NAME)) } as const;
const COUNT_TEXT = resolveColor(COST_DIGITS);

/** The dashed frame's triangles, the same on every mini, built the first time one is borrowed. */
let miniDashes: Vec2[] | null = null;

function miniDashPoints(): readonly Vec2[] {
	if (!miniDashes) {
		const { width, height } = CARD_DIMENSIONS[CardSize.MINI];
		miniDashes = dashedOutlineTriangles(
			{ x: 0, y: 0, width, height },
			{ width: MINI.border, dash: MINI.dash.length, gap: MINI.dash.gap, corner: MINI.radius },
			[],
		);
	}
	return miniDashes;
}

/** A state's tag; unavailable has none. A borrowed stack counts every copy it adds. */
function stateTag(state: MiniCardState | null, copies: number): string {
	switch (state) {
		case 'borrowed': return `+${copies}`;
		case 'home': return 'HOME';
		case 'locked': return 'LOCKED';
		default: return '';
	}
}

/**
 * What only a mini draws: the card edges behind a stack and its count, a
 * borrowed copy's dashed frame, and a state's tag. The card's own draws
 * rather than parts, as the cost hex is, since they reach past its box and
 * a part may not (R13.25.2). Built once and recoloured or re-placed in
 * place; the tag and the count are measured only when their text changes.
 */
class MiniParts {
	private copyCount = 1;
	private standing: MiniCardState | null = null;
	private readonly cardWidth: number;
	/** The edges behind the front card, the back one first. */
	private readonly edges: DrawRectOptions[] = [];
	private readonly edgeBorders: { color: RGBA; width: number }[] = [];
	private readonly dashDraw: DrawPolygonOptions & { fill: RGBA } = { points: [], fill: [0, 0, 0, 0] };
	private showDashes = false;
	private readonly tagRect: Rect = { x: 0, y: MINI.tag.y, width: 0, height: MINI.tag.height };
	private readonly tagBorder: { color: RGBA; width: number } = { color: CARD_MUTED_FILLS.full, width: 1 };
	private readonly tagDraw: DrawRectOptions = { rect: this.tagRect, radius: 2, fill: CARD_GROUND_FILLS.full, border: this.tagBorder };
	private readonly tagText: DrawTextOptions;
	private readonly countRect: Rect;
	private readonly countDraw: DrawRectOptions;
	private readonly countText: DrawTextOptions;
	private countWidth = 0;
	/** The texts the tag and the count were last measured for. */
	private measuredTag: string | null = null;
	private measuredCount: string | null = null;

	constructor({ width, height }: { width: number; height: number }) {
		this.cardWidth = width;
		for (let depth = MINI.stack.edges; depth >= 1; depth--) {
			const border = { color: CARD_MUTED_FILLS.full, width: 1 };
			const offset = depth * MINI.stack.step;
			this.edgeBorders.push(border);
			this.edges.push({ rect: { x: offset, y: offset, width, height }, radius: MINI.radius, fill: CARD_GROUND_FILLS.full, border });
		}
		this.tagText = {
			text: '',
			box: this.tagRect,
			font: 'mono',
			size: MINI.tag.size,
			color: TAG_TEXT.full,
			align: 'center',
			verticalAlign: 'middle',
			letterSpacing: MINI.tag.letterSpacing,
		};
		this.countRect = { x: 0, y: height - MINI.count.height / 2, width: 0, height: MINI.count.height };
		this.countDraw = { rect: this.countRect, radius: MINI.count.height / 2, fill: COST_HEX_FILLS.full };
		this.countText = {
			text: '',
			box: this.countRect,
			font: 'display',
			size: MINI.count.size,
			color: COUNT_TEXT,
			align: 'center',
			verticalAlign: 'middle',
		};
	}

	get copies(): number {
		return this.copyCount;
	}

	set copies(copies: number) {
		this.copyCount = copies;
		this.countText.text = copies > 1 ? `x${copies}` : '';
		this.tagText.text = stateTag(this.standing, copies);
	}

	get state(): MiniCardState | null {
		return this.standing;
	}

	set state(state: MiniCardState | null) {
		this.standing = state;
		this.tagText.text = stateTag(state, this.copyCount);
	}

	/** Left at home and unavailable fade the card. */
	get faded(): boolean {
		return this.standing === 'home' || this.standing === 'unavailable';
	}

	/** A borrowed copy's resting frame is dashed. */
	get dashed(): boolean {
		return this.standing === 'borrowed';
	}

	/** Whether the dashes stand in for the frame's border, which the card decides from its state. */
	set dashesShown(shown: boolean) {
		this.showDashes = shown;
		if (shown && this.dashDraw.points.length === 0) this.dashDraw.points = miniDashPoints();
	}

	/** The tag and the count, for the snapshot's labels (R13.22); null when it shows neither. */
	get labels(): string[] | null {
		const labels: string[] = [];
		if (this.tagText.text) labels.push(this.tagText.text);
		if (this.countText.text) labels.push(this.countText.text);
		return labels.length > 0 ? labels : null;
	}

	private get edgesShown(): number {
		return Math.min(this.copyCount - 1, MINI.stack.edges);
	}

	/**
	 * Recoloured for the card's resting frame and tone: the dashes are the
	 * frame, the edges a step darker, the tag and the count dimmed with
	 * the card.
	 */
	recolour(frame: RGBA, dimmed: boolean): void {
		const tone = dimmed ? 'dimmed' : 'full';
		const edge = scale(frame, MINI.stack.brightness);
		for (const draw of this.edges) draw.fill = CARD_GROUND_FILLS[tone];
		for (const border of this.edgeBorders) border.color = edge;
		this.dashDraw.fill = frame;
		this.tagDraw.fill = CARD_GROUND_FILLS[tone];
		this.tagBorder.color = CARD_MUTED_FILLS[tone];
		this.tagText.color = TAG_TEXT[tone];
		this.countDraw.fill = COST_HEX_FILLS[tone];
	}

	/**
	 * Sizes the tag and the count to their text, measuring only a text that
	 * changed since the last time, and puts the count in the corner of
	 * however many edges show. A no-op until the context can measure.
	 */
	place(draw: DrawApi | undefined): void {
		const tag = this.tagText.text;
		if (tag !== this.measuredTag && draw?.canMeasureText('mono')) {
			const width = tag ? draw.measureText({ text: tag, font: 'mono', size: MINI.tag.size, letterSpacing: MINI.tag.letterSpacing, wrap: 'none' }).width + MINI.tag.padding * 2 : 0;
			this.tagRect.x = MINI.tag.right - width;
			this.tagRect.width = width;
			this.measuredTag = tag;
		}
		const count = this.countText.text;
		if (count !== this.measuredCount && draw?.canMeasureText('display')) {
			this.countWidth = count ? draw.measureText({ text: count, font: 'display', size: MINI.count.size, wrap: 'none' }).width + MINI.count.padding * 2 : 0;
			this.measuredCount = count;
		}
		this.countRect.width = this.countWidth;
		this.countRect.x = this.cardWidth + MINI.stack.step * this.edgesShown - this.countWidth;
	}

	/** The edges, under everything the front card draws. */
	renderBehind(draw: DrawApi): void {
		for (let index = this.edges.length - this.edgesShown; index < this.edges.length; index++) draw.drawRect(this.edges[index]);
	}

	/** The dashes, over the frame's ground. */
	renderFrame(draw: DrawApi): void {
		if (this.showDashes) draw.drawPolygon(this.dashDraw);
	}

	/** The tag and the count, over the card, once measured. */
	renderFront(draw: DrawApi): void {
		const tag = this.tagText.text;
		if (tag && tag === this.measuredTag) {
			draw.drawRect(this.tagDraw);
			draw.drawText(this.tagText);
		}
		const count = this.countText.text;
		if (count && count === this.measuredCount) {
			draw.drawRect(this.countDraw);
			draw.drawText(this.countText);
		}
	}
}

/**
 * Visual component for displaying a card, at either of its sizes (Game
 * Flow 7.0): the face of Battle Screen Design section 5, or the mini card,
 * which drops the summary and can stand for a stack of copies or show its
 * state against a deck being built (`copies`, `miniState`). One composite
 * target (R8.29): the frame, art ground, cost hex, driver mark, rarity gem,
 * and a mini's stack, tag and dashes are the card's own draws, its words
 * are parts, and every state it shows (hovered, selected, disabled) comes
 * from the framework's flags. Driver colour is the frame; rarity is the gem.
 */
export class Card extends Component {
	private model: GameCard;
	private cardSize: CardSize;
	private driverNumber: 1 | 2 | null;
	private readonly name: Text;
	private readonly typeLabel: Text;
	private readonly rules: KeywordText | null = null;
	private readonly rarityLabel: Text | null = null;
	private readonly rangeLabel: Text | null = null;
	private readonly artIcon: Icon;
	/** The name's size once fitted: 16, else 14, else 14 with an ellipsis. */
	private nameFitted = false;

	/**
	 * The card's own draws, built once and recoloured in place; the draw API
	 * copies what it is given.
	 */
	private readonly frameDraw: DrawRectOptions;
	private readonly frameBorder: { color: RGBA; width: number } = { color: resolveColor(CARD_LINE), width: FACE.border };
	private readonly artDraw: DrawRectOptions;
	private readonly chipDraw: DrawRectOptions | null = null;
	private readonly digitsDraw: DrawTextOptions;
	private readonly hexEdgeDraw: DrawPolygonOptions;
	private readonly hexFaceDraw: DrawPolygonOptions;
	private readonly gemDraw: DrawPolygonOptions;
	private markDraw: DrawPolygonOptions | null = null;
	/** A mini's stack, tag and dashes; null on a face. */
	private readonly mini: MiniParts | null;

	private dimmed = false;
	private cannotPay = false;
	private rises: boolean;

	private pose: FanPose = UNFANNED;
	/** 0 resting in its pose, 1 lifted; tweened on the animator while mounted. */
	private liftAmount = 0;
	private liftTween: TweenHandle<number> | null = null;
	private readonly liftInput: { rotate: number; translate: readonly [number, number]; scale: number; origin: readonly [number, number] } = {
		rotate: 0,
		translate: [0, 0],
		scale: 1,
		origin: BOTTOM_CENTRE,
	};

	// Event callbacks
	/** A click or `activate` on the card, with the card it shows (R8.25). */
	public onSelect: ((card: GameCard) => void) | null = null;

	constructor({ id, x, y, data, size = CardSize.NORMAL, driverNumber, copies = 1, miniState = null }: {
		id?: string;
		x: number;
		y: number;
		data: GameCard;
		size?: CardSize;
		driverNumber?: 1 | 2 | null;
		/** A mini's copies; past one it shows as a stack. A face is always one. */
		copies?: number;
		/** A mini's state against the deck being built; a face has none. */
		miniState?: MiniCardState | null;
	}) {
		const dimensions = CARD_DIMENSIONS[size];
		super({ id, x, y, width: dimensions.width, height: dimensions.height });
		this.componentType = 'Card';

		this.model = data;
		this.cardSize = size;
		this.driverNumber = driverNumber || null;
		const mini = size === CardSize.MINI;
		// A mini sits in a grid, never a fan, so it stays put unless asked
		this.rises = !mini;

		this.frameDraw = {
			id: id ?? undefined,
			rect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
			fill: resolveColor(CARD_GROUND),
			radius: mini ? MINI.radius : FACE.radius,
			border: this.frameBorder,
		};
		this.frameBorder.width = this.borderWidth;
		this.frameBorder.color = this.restingBorder;

		const hex = this.hexBox;
		const hexDraws = costHexDraws(hex.x, hex.y, hex.size);
		this.hexEdgeDraw = hexDraws.edge;
		this.hexFaceDraw = hexDraws.face;
		this.gemDraw = mini
			? rarityGemDraw(data.rarity, MINI.gem.x, MINI.gem.y, MINI.gem.size)
			: rarityGemDraw(data.rarity, FACE.foot.x + FACE.foot.gem / 2, FACE.foot.y + FACE.foot.height / 2, FACE.foot.gem);
		this.digitsDraw = {
			text: `${data.cost}`,
			box: { x: hex.x, y: hex.y, width: hex.size, height: hex.size },
			font: 'display',
			size: hex.digits,
			color: resolveColor(COST_DIGITS),
			align: 'center',
			verticalAlign: 'middle',
		};

		this.name = mini
			? new Text({
				text: data.displayName,
				id: this.childId('title'),
				x: MINI.name.x,
				y: MINI.name.y,
				width: MINI.name.width,
				height: MINI.name.size * MINI.name.lineHeight * MINI.name.lines,
				style: { fontRole: 'display', fontSize: MINI.name.size, color: CARD_NAME },
				lineHeight: MINI.name.lineHeight,
				verticalAlign: 'top',
				wrap: 'word',
				textOverflow: 'ellipsis',
			})
			: new Text({
				text: data.displayName,
				id: this.childId('title'),
				x: FACE.name.x,
				y: FACE.name.y,
				width: FACE.name.width,
				height: FACE.name.height,
				style: { fontRole: 'display', fontSize: FACE.name.sizes[0], color: CARD_NAME },
				lineHeight: FACE.name.height / FACE.name.sizes[0],
				verticalAlign: 'middle',
				wrap: 'none',
				textOverflow: 'ellipsis',
			});
		this.addChild(this.name);

		const art = mini ? MINI.art : FACE.art;
		this.artDraw = {
			rect: { x: art.x, y: art.y, width: art.width, height: art.height },
			radius: art.radius,
			gradient: artGradient(this.driverNumber),
		};
		this.artIcon = new Icon({
			id: this.childId('art'),
			glyph: cardArtIcon(data),
			size: art.icon,
			x: art.x + art.width - art.inset.right - art.icon,
			y: art.y + art.height - art.inset.bottom - art.icon,
			tint: hexRgba(CARD_NAME, 0.35),
		});
		this.addChild(this.artIcon);

		// The face's type is top right, hugging the mark; the mini's starts the foot
		const type = mini ? MINI.type : FACE.type;
		this.typeLabel = new Text({
			text: cardTypeLabel(data),
			id: this.childId('type'),
			x: mini ? MINI.type.x : 0,
			y: type.y,
			height: type.height,
			style: { fontRole: 'mono', fontSize: type.size, color: CARD_MUTED, letterSpacing: 0.08 },
			lineHeight: type.height / type.size,
			verticalAlign: 'middle',
			wrap: 'none',
		});
		this.addChild(this.typeLabel);

		if (mini) {
			this.mini = new MiniParts(dimensions);
			this.mini.recolour(this.restingBorder, false);
		} else {
			this.mini = null;

			// The summary (Card System Design 1.1), keywords in yellow; the full
			// text is the detail view's. A summary past three lines is a content
			// bug the card data check catches, so nothing here shrinks it.
			this.rules = new KeywordText({
				id: this.childId('description'),
				text: data.displaySummary,
				mode: 'bracketed',
				x: FACE.rules.x,
				y: FACE.rules.y,
				width: FACE.rules.width,
				height: FACE.rules.lineHeight * FACE.rules.lines,
				fontSize: FACE.rules.size,
				lineHeight: FACE.rules.lineHeight,
				maxLines: FACE.rules.lines,
				color: CARD_RULES,
				keywordColor: CARD_KEYWORD,
			});
			this.addChild(this.rules);

			this.rarityLabel = new Text({
				text: data.rarity.toUpperCase(),
				id: this.childId('rarity'),
				x: FACE.foot.x + FACE.foot.gem + 6,
				y: FACE.foot.y,
				height: FACE.foot.height,
				style: { fontRole: 'mono', fontSize: FACE.foot.size, color: CARD_DIM, letterSpacing: 0.06 },
				lineHeight: FACE.foot.height / FACE.foot.size,
				verticalAlign: 'middle',
				wrap: 'none',
			});
			this.addChild(this.rarityLabel);

			const range = cardRange(data);
			if (range !== null) {
				this.rangeLabel = new Text({
					text: `R${range}`,
					id: this.childId('range'),
					y: FACE.foot.y,
					height: FACE.foot.height,
					style: { fontRole: 'mono', fontSize: FACE.foot.size, color: CARD_MUTED },
					lineHeight: FACE.foot.height / FACE.foot.size,
					verticalAlign: 'middle',
					wrap: 'none',
				});
				this.addChild(this.rangeLabel);
				this.chipDraw = {
					rect: { x: 0, y: FACE.foot.y, width: 0, height: FACE.foot.height },
					radius: 2,
					// Outline only, as the mock's `.rng`: an absent fill draws white
					fill: [0, 0, 0, 0],
					border: { color: resolveColor(CARD_LINE), width: 1 },
				};
			}
		}
		this.copies = copies;
		this.miniState = miniState;
		this.placeMark();
		this.placeParts();
	}

	/**
	 * Composite internals derive their ids from the card's own, so a caller
	 * names the card once and the lint can still address `<card>_title`.
	 * Unnamed cards leave their children unnamed too.
	 */
	private childId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}

	/** The cost hex's box, hanging off the top-left corner at either size. */
	private get hexBox(): { x: number; y: number; size: number; digits: number } {
		return this.cardSize === CardSize.MINI ? MINI.hex : FACE.hex;
	}

	/** The resting frame's width, which hover's outline keeps. */
	private get borderWidth(): number {
		return this.cardSize === CardSize.MINI ? MINI.border : FACE.border;
	}

	/** The driver mark's draw, in the face's top-right corner; built when the driver changes. */
	private placeMark(): void {
		const driver = this.driverNumber;
		if (!driver || this.cardSize === CardSize.MINI) {
			this.markDraw = null;
			return;
		}
		const half = FACE.mark.size / 2;
		this.markDraw = driverMarkDraw(driver, MARK_OUTLINES[seatMark(driver) as 'driver1' | 'driver2'], FACE.mark.x + half, FACE.mark.y + half, FACE.mark.size);
		this.markDraw.fill = this.dimmed ? DRIVER_MARK_FILLS[driver].dimmed : DRIVER_MARK_FILLS[driver].full;
	}

	/**
	 * Parts that hug their measured text on the face: the type ends left of
	 * the mark, the range chip at the foot's right edge. Placed on
	 * construction and again in layout once they have measured through the
	 * mount context (R1.6), as a mini's tag and count are.
	 */
	private placeParts(): void {
		if (this.mini) {
			this.mini.place(this.context?.draw);
			return;
		}
		this.typeLabel.x = FACE.type.right - this.typeLabel.width;
		if (this.rangeLabel && this.chipDraw) {
			const width = this.rangeLabel.width + 6;
			this.rangeLabel.x = FACE.foot.right - width + 3;
			this.chipDraw.rect = { x: FACE.foot.right - width, y: FACE.foot.y, width, height: FACE.foot.height };
		}
	}

	/**
	 * "Shrink to 14, then ellipsis" (section 8): a name too wide at 16 drops
	 * to 14, and one too wide at 14 keeps the ellipsis it already has. Done
	 * once, the first time the card can measure. A mini's name wraps to two
	 * lines instead, which every card's fits.
	 */
	private fitName(): void {
		if (this.nameFitted || this.cardSize === CardSize.MINI) return;
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText('display')) return;
		this.nameFitted = true;
		const [large, small] = FACE.name.sizes;
		const natural = draw.measureText({ text: this.name.text, font: 'display', size: large, wrap: 'none' }).width;
		if (natural <= this.name.width) return;
		this.name.style = { ...this.name.style, fontSize: small };
	}

	protected layoutChildren(): void {
		this.fitName();
		this.placeParts();
	}

	/** The name's size after fitting: 16, or 14 for a long one; a mini's is 13. */
	public get nameSize(): number {
		this.fitName();
		const size = this.name.style.fontSize;
		return typeof size === 'number' ? size : FACE.name.sizes[0];
	}

	/**
	 * The cost hex's box reaches past the top-left corner, and its outline
	 * (`drawCostHex`, a fifteenth of its size) and the polygon feather a
	 * little further; a mini's stack and tag reach no further than its hex.
	 */
	public get inkExtent(): number {
		return this.cardSize === CardSize.MINI ? MINI_CARD_INK : -FACE.hex.x + Math.ceil(FACE.hex.size / 15);
	}

	/** R8.29: a card is one target; its text and frame are internals. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/** A card someone listens to is clickable; a disabled one shows the default cursor. */
	protected get defaultCursor(): Cursor | null {
		return this.onSelect ? 'pointer' : null;
	}

	/** A card acts on press and click in handleEvent, with or without a caller callback. */
	public get handlesPointer(): boolean {
		return true;
	}

	/**
	 * A click is the dispatcher's, synthesised when press and release both
	 * land on this card (R9.31). A disabled card receives none of these
	 * (R9.5). A focused card treats `activate` (Enter or Space) as a click
	 * (R9.27); a card is focusable only where a screen opts in.
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'activate':
				event.consume();
				this.activate();
				return;
			case 'click':
				this.activate();
				return;
		}
	}

	/** A click, as the select callback. */
	private activate(): void {
		this.onSelect?.(this.model);
	}

	/**
	 * Hover, focus, selection, and enabled state, the last inherited (R8.3):
	 * a selected card, or a hovered or keyboard-focused one that can be
	 * played, rises; hover and selection outline it in the interaction
	 * yellow (section 7); a disabled card dims.
	 */
	protected onStateChange(): void {
		this.updateLook();
		const enabled = this.effectivelyEnabled;
		// Keyboard focus lifts a card as the pointer does, so its ring clears its neighbours
		this.liftTo(this.rises && (this.selected || ((this.hovered || this.focusVisible) && enabled)) ? 1 : 0);
	}

	/** Dimmed while disabled or faded, then the frame for the card's state. */
	private updateLook(): void {
		this.dim(!this.effectivelyEnabled || this.faded);
		this.applyBorder();
	}

	/**
	 * The frame: selection's outline, then hover's or keyboard focus's on a
	 * card that can be used, else the resting frame in the driver's colour,
	 * which a borrowed mini draws in dashes. The dispatcher keeps `hovered`
	 * true over a disabled card (R9.8), so the outline checks enabled itself.
	 */
	private applyBorder(): void {
		let resting = false;
		if (this.selected) {
			this.frameBorder.color = SELECTED_OUTLINE;
			this.frameBorder.width = SELECTED_BORDER;
		} else if ((this.hovered || this.focusVisible) && this.effectivelyEnabled) {
			this.frameBorder.color = HOVER_OUTLINE;
			this.frameBorder.width = this.borderWidth;
		} else {
			resting = true;
			this.frameBorder.color = this.restingBorder;
			this.frameBorder.width = this.borderWidth;
		}
		const dashed = resting && this.mini !== null && this.mini.dashed;
		this.frameDraw.border = dashed ? undefined : this.frameBorder;
		if (this.mini) this.mini.dashesShown = dashed;
	}

	private get restingBorder(): RGBA {
		return scale(resolveColor(frameColor(this.driverNumber)), this.dimmed ? DIM_BRIGHTNESS : 1);
	}

	/** A mini left at home, or unavailable. */
	private get faded(): boolean {
		return this.mini?.faded ?? false;
	}

	/**
	 * The mock's `.cant`: everything darker and greyer, for a disabled card
	 * and a faded mini alike. The card's own draws darken; its words take
	 * dimmed colours, since a card's opacity would show the fan through it.
	 */
	private dim(dimmed: boolean): void {
		if (dimmed === this.dimmed) return;
		this.dimmed = dimmed;
		const tone = (hex: string) => (dimmed ? dimHex(hex) : hex);
		const brightness = dimmed ? DIM_BRIGHTNESS : 1;
		this.frameDraw.fill = scale(resolveColor(CARD_GROUND), brightness);
		this.artDraw.gradient = artGradient(this.driverNumber, brightness);
		if (this.chipDraw?.border) this.chipDraw.border = { color: scale(resolveColor(CARD_LINE), brightness), width: 1 };
		this.hexFaceDraw.fill = dimmed ? COST_HEX_FILLS.dimmed : COST_HEX_FILLS.full;
		this.gemDraw.fill = dimmed ? GEM_FILLS[this.model.rarity].dimmed : GEM_FILLS[this.model.rarity].full;
		if (this.markDraw && this.driverNumber) this.markDraw.fill = dimmed ? DRIVER_MARK_FILLS[this.driverNumber].dimmed : DRIVER_MARK_FILLS[this.driverNumber].full;
		this.mini?.recolour(this.restingBorder, dimmed);
		this.name.style = { ...this.name.style, color: tone(CARD_NAME) };
		this.typeLabel.style = { ...this.typeLabel.style, color: tone(CARD_MUTED) };
		if (this.rarityLabel) this.rarityLabel.style = { ...this.rarityLabel.style, color: tone(CARD_DIM) };
		if (this.rangeLabel) this.rangeLabel.style = { ...this.rangeLabel.style, color: tone(CARD_MUTED) };
		this.artIcon.tint = hexRgba(tone(CARD_NAME), 0.35);
		this.rules?.setColors(tone(CARD_RULES), tone(CARD_KEYWORD));
	}

	/**
	 * Whether hover, focus and selection lift the card out of its place:
	 * the hand's cards rise out of the fan; a pile's, the card browser's,
	 * and every mini sit in a grid and stay put, unless a screen asks.
	 */
	public get liftable(): boolean {
		return this.rises;
	}

	public set liftable(liftable: boolean) {
		this.rises = liftable;
		if (!liftable) this.liftTo(0);
	}

	/** Whether the driver can't pay its cost: the numeral turns dark red (section 6). */
	public get unaffordable(): boolean {
		return this.cannotPay;
	}

	public set unaffordable(unaffordable: boolean) {
		this.cannotPay = unaffordable;
		this.digitsDraw.color = resolveColor(unaffordable ? COST_DIGITS_UNPAYABLE : COST_DIGITS);
	}

	/**
	 * How many copies of its card this stands for. A mini past one is a
	 * stack: up to two card edges behind it and an "xN" count, so a
	 * 20-card deck reads as a handful of stacks. A face is always one.
	 */
	public get copies(): number {
		return this.mini?.copies ?? 1;
	}

	public set copies(copies: number) {
		if (!Number.isInteger(copies) || copies < 1) throw new Error(`a card stands for a whole number of copies, at least one, not ${copies}`);
		if (!this.mini) {
			if (copies === 1) return;
			throw new Error('only a mini card stacks copies');
		}
		if (copies === this.mini.copies) return;
		this.mini.copies = copies;
		this.mini.place(this.context?.draw);
	}

	/**
	 * A mini's state against the deck being built (`MiniCardState`), null
	 * for an ordinary copy. A faded mini stays focusable and inspectable;
	 * only a disabled card stops taking input. A face has no state.
	 */
	public get miniState(): MiniCardState | null {
		return this.mini?.state ?? null;
	}

	public set miniState(state: MiniCardState | null) {
		if (!this.mini) {
			if (state === null) return;
			throw new Error('only a mini card shows a state against a deck');
		}
		if (state === this.mini.state) return;
		this.mini.state = state;
		this.mini.place(this.context?.draw);
		this.updateLook();
	}

	/** Everything here is built once and recoloured on state changes, so a frame allocates nothing. */
	public render(draw: DrawApi): void {
		this.mini?.renderBehind(draw);
		draw.drawRect(this.frameDraw);
		this.mini?.renderFrame(draw);
		draw.drawRect(this.artDraw);
		if (this.chipDraw) draw.drawRect(this.chipDraw);
		if (this.markDraw) draw.drawPolygon(this.markDraw);
		draw.drawPolygon(this.gemDraw);
		draw.drawPolygon(this.hexEdgeDraw);
		draw.drawPolygon(this.hexFaceDraw);
		draw.drawText(this.digitsDraw);
		this.mini?.renderFront(draw);
	}

	/** The face is the card's fill and the frame its border (R13.22); a borrowed mini's dashes are its border. */
	public get resolvedColors(): ResolvedColors {
		return { fill: this.frameDraw.fill ?? resolveColor(CARD_GROUND), border: this.frameBorder.color };
	}

	/**
	 * A mini's tag and count, which it draws itself, for the snapshot's
	 * labels and so the text record (DDB-206). The cost numeral is the
	 * hex's at either size and is left to the golden.
	 */
	public get drawnText(): readonly string[] | null {
		return this.mini?.labels ?? null;
	}

	/** Where the card rests in its fan; a lifted card straightens out of it. */
	public get fanPose(): FanPose {
		return this.pose;
	}

	public set fanPose(pose: FanPose) {
		this.pose = pose;
		this.zIndex = pose.order;
		this.applyLift(this.liftAmount);
	}

	/**
	 * Where the card is on screen once fully lifted, while it may still be on
	 * its way up: anything placed against it clears the card where it will
	 * settle, not where the tween has it this frame.
	 */
	public get liftedScreenBounds(): Rect {
		let matrix = this.screenMatrix;
		const current = transformMatrix(this.transform, this.width, this.height);
		const inverse = current ? invert(current) : null;
		if (inverse) matrix = concat(matrix, inverse);
		const lifted = transformMatrix(LIFTED_TRANSFORM, this.width, this.height);
		if (lifted) matrix = concat(matrix, lifted);
		const corners = [
			transformPoint(matrix, 0, 0),
			transformPoint(matrix, this.width, 0),
			transformPoint(matrix, this.width, this.height),
			transformPoint(matrix, 0, this.height),
		];
		const xs = corners.map((corner) => corner.x);
		const ys = corners.map((corner) => corner.y);
		const x = Math.min(...xs);
		const y = Math.min(...ys);
		return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
	}

	/** Whether the card is up out of its fan, or on its way up. */
	public get lifted(): boolean {
		return this.liftAmount > 0;
	}

	/**
	 * Rises or settles on the animator (R8.28's retarget, so a quick pass over
	 * the hand never snaps), or at once while unmounted.
	 */
	private liftTo(target: number): void {
		const animator = this.context?.animator;
		if (!animator) {
			this.liftTween?.cancel();
			this.liftTween = null;
			this.applyLift(target);
			return;
		}
		if (this.liftTween) {
			this.liftTween.retarget(target);
			return;
		}
		if (this.liftAmount === target) return;
		this.liftTween = animator.tween({
			from: this.liftAmount,
			to: target,
			duration: tokens.motion.dur_fast,
			owner: this,
			onUpdate: (value) => this.applyLift(value),
		});
	}

	/**
	 * The resting pose and the lifted one are both explicit (DDB-172): the
	 * fan pose blended toward `LIFTED_TRANSFORM` by the lift amount, through
	 * the transform, so the card's position stays layout's. A card that is
	 * up at all paints and hit-tests on the `raised` layer, over its
	 * neighbours and the driver tab above it; a higher layer is hit first
	 * whatever the siblings' `zIndex`, so the lift leaves the fan's order
	 * alone.
	 */
	private applyLift(amount: number): void {
		this.liftAmount = amount;
		const rest = 1 - amount;
		// The setter copies into a frozen transform, so the input can be
		// reused across tween frames; the translate tuple is kept by
		// reference, so it has to be fresh.
		const input = this.liftInput;
		input.rotate = this.pose.rotate * rest;
		input.translate = [0, this.pose.drop * rest - CARD_LIFT * amount];
		input.scale = 1 + (LIFT_SCALE - 1) * amount;
		this.transform = input;
		this.layer = amount > 0 ? 'raised' : null;
	}

	/**
	 * A lifted card keeps the strip it rose out of, so a pointer resting on
	 * its bottom edge doesn't drop it, see it slide back under, and lift it
	 * again. The hex off the top-left corner is part of the card.
	 */
	public containsPoint(localX: number, localY: number): boolean {
		const reach = this.liftAmount > 0 ? CARD_LIFT : 0;
		if (localX >= 0 && localX < this.width && localY >= 0 && localY < this.height + reach) return true;
		const hex = this.hexBox;
		return localX >= hex.x && localX < hex.x + hex.size && localY >= hex.y && localY < hex.y + hex.size;
	}

	/** Drops the lift tween with the card: the base cancels it on unmount. */
	protected onUnmount(): void {
		this.liftTween = null;
		super.onUnmount();
	}

	/** A rarity's gem colour, which the card browser's group headings use too. */
	public static colorForRarity(rarity: CardRarity): string {
		return RARITY_GEMS[rarity];
	}

	/** The card this shows. */
	public get data(): GameCard {
		return this.model;
	}

	/** The summary as the face lays it out, keyword pieces flagged; a mini has none. */
	public get faceWords(): { text: string; keyword: boolean }[][] {
		return this.rules?.words ?? [];
	}

	/** Lines the face's summary needs; zero until it has measured, and on a mini. */
	public get summaryLines(): number {
		return this.rules?.reflow() ?? 0;
	}

	/**
	 * Get card dimensions for a specific size
	 */
	public static getDimensions(size: CardSize = CardSize.NORMAL): { width: number; height: number } {
		return CARD_DIMENSIONS[size];
	}

	/** The size variant this card was built at. */
	public get size(): CardSize {
		return this.cardSize;
	}

	/** The driver whose card it is, by seat; null for none. Their colour is the frame. */
	public get driver(): 1 | 2 | null {
		return this.driverNumber;
	}

	public set driver(driverNumber: 1 | 2 | null) {
		if (this.driverNumber === driverNumber) return;
		this.driverNumber = driverNumber;
		this.placeMark();
		this.artDraw.gradient = artGradient(driverNumber, this.dimmed ? DIM_BRIGHTNESS : 1);
		this.mini?.recolour(this.restingBorder, this.dimmed);
		this.applyBorder();
	}
}
