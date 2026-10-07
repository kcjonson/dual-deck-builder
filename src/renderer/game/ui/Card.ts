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
import { RGBA, Rect, concat, invert, transformPoint } from '../../engine/draw/geometry';
import { CardRarity, Card as GameCard } from '../mechanics/Card';
import { cardRange } from '../data/keywords';
import { hexRgba } from '../screens/combat/combatStyle';
import { MARK_OUTLINES, seatMark } from './targetMarks';
import { KeywordText } from './KeywordText';
import {
	CARD_DIM,
	CARD_GROUND,
	CARD_KEYWORD,
	CARD_LINE,
	CARD_MUTED,
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
 * Card size variants for different UI contexts. The full text has its own
 * view, `CardDetailView`, rather than a bigger face.
 */
export enum CardSize {
	MINI = 'mini',       // A deck list's thumbnail
	NORMAL = 'normal',   // The face: hand, piles, the card browser
}

/**
 * Card dimensions for each size variant. A face is 128x180 (Battle Screen
 * Design, section 4).
 */
const CARD_DIMENSIONS = {
	[CardSize.MINI]: { width: 50, height: 70 },
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

const MINI_SCALE = 0.35;

/**
 * Visual component for displaying a card: the face of Battle Screen Design
 * section 5. One composite target (R8.29): the frame, art ground, cost hex,
 * driver mark and rarity gem are the card's own draws, its words are
 * parts, and every state it shows (hovered, selected, disabled) comes from
 * the framework's flags. Driver colour is the frame; rarity is the gem.
 */
export class Card extends Component {
	private model: GameCard;
	private cardSize: CardSize;
	private driverNumber: 1 | 2 | null;
	private readonly name: Text;
	private readonly typeLabel: Text | null = null;
	private readonly rules: KeywordText | null = null;
	private readonly rarityLabel: Text | null = null;
	private readonly rangeLabel: Text | null = null;
	private readonly artIcon: Icon | null = null;
	/** The name's size once fitted: 16, else 14, else 14 with an ellipsis. */
	private nameFitted = false;

	/**
	 * The card's own draws, built once and recoloured in place; the draw API
	 * copies what it is given.
	 */
	private readonly frameDraw: DrawRectOptions;
	private readonly frameBorder: { color: RGBA; width: number } = { color: resolveColor(CARD_LINE), width: FACE.border };
	private readonly artDraw: DrawRectOptions | null = null;
	private readonly chipDraw: DrawRectOptions | null = null;
	private readonly digitsDraw: DrawTextOptions;
	private readonly hexEdgeDraw: DrawPolygonOptions;
	private readonly hexFaceDraw: DrawPolygonOptions;
	private readonly gemDraw: DrawPolygonOptions;
	private markDraw: DrawPolygonOptions | null = null;

	private dimmed = false;
	private cannotPay = false;
	private rises = true;

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

	constructor({ id, x, y, data, size = CardSize.NORMAL, driverNumber }: {
		id?: string;
		x: number;
		y: number;
		data: GameCard;
		size?: CardSize;
		driverNumber?: 1 | 2 | null;
	}) {
		const dimensions = CARD_DIMENSIONS[size];
		super({ id, x, y, width: dimensions.width, height: dimensions.height });
		this.componentType = 'Card';

		this.model = data;
		this.cardSize = size;
		this.driverNumber = driverNumber || null;
		const mini = size === CardSize.MINI;
		const unit = mini ? MINI_SCALE : 1;

		this.frameDraw = {
			id: id ?? undefined,
			rect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
			fill: resolveColor(CARD_GROUND),
			radius: FACE.radius * (mini ? 0.6 : 1),
			border: this.frameBorder,
		};
		this.frameBorder.width = mini ? 1 : FACE.border;
		this.frameBorder.color = this.restingBorder;

		const hex = this.hexBox;
		const hexDraws = costHexDraws(hex.x, hex.y, hex.size);
		this.hexEdgeDraw = hexDraws.edge;
		this.hexFaceDraw = hexDraws.face;
		this.gemDraw = mini
			? rarityGemDraw(data.rarity, dimensions.width - 7, dimensions.height - 7, 5)
			: rarityGemDraw(data.rarity, FACE.foot.x + FACE.foot.gem / 2, FACE.foot.y + FACE.foot.height / 2, FACE.foot.gem);
		this.digitsDraw = {
			text: `${data.cost}`,
			box: { x: hex.x, y: hex.y, width: hex.size, height: hex.size },
			font: 'display',
			size: Math.round(FACE.hex.digits * (hex.size / FACE.hex.size)),
			color: resolveColor(COST_DIGITS),
			align: 'center',
			verticalAlign: 'middle',
		};

		this.name = new Text({
			text: data.displayName,
			id: this.childId('title'),
			x: mini ? 4 : FACE.name.x,
			y: mini ? 18 : FACE.name.y,
			width: mini ? dimensions.width - 8 : FACE.name.width,
			height: mini ? Math.ceil(3 * 14 * unit * 1.2) : FACE.name.height,
			style: { fontRole: 'display', fontSize: mini ? Math.floor(14 * unit) : FACE.name.sizes[0], color: CARD_NAME },
			lineHeight: mini ? 1.2 : FACE.name.height / FACE.name.sizes[0],
			verticalAlign: mini ? 'top' : 'middle',
			wrap: mini ? 'word' : 'none',
			textOverflow: 'ellipsis',
		});
		this.addChild(this.name);

		if (!mini) {
			this.artDraw = {
				rect: { x: FACE.art.x, y: FACE.art.y, width: FACE.art.width, height: FACE.art.height },
				radius: FACE.art.radius,
				gradient: artGradient(this.driverNumber),
			};
			this.artIcon = new Icon({
				id: this.childId('art'),
				glyph: cardArtIcon(data),
				size: FACE.art.icon,
				x: FACE.art.x + FACE.art.width - FACE.art.inset.right - FACE.art.icon,
				y: FACE.art.y + FACE.art.height - FACE.art.inset.bottom - FACE.art.icon,
				tint: hexRgba(CARD_NAME, 0.35),
			});
			this.addChild(this.artIcon);

			this.typeLabel = new Text({
				text: cardTypeLabel(data),
				id: this.childId('type'),
				y: FACE.type.y,
				height: FACE.type.height,
				style: { fontRole: 'mono', fontSize: FACE.type.size, color: CARD_MUTED, letterSpacing: 0.08 },
				lineHeight: FACE.type.height / FACE.type.size,
				verticalAlign: 'middle',
				wrap: 'none',
			});
			this.addChild(this.typeLabel);

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

	/** The cost hex's box: hanging off the corner on a face, tucked inside on a thumbnail. */
	private get hexBox(): { x: number; y: number; size: number } {
		return this.cardSize === CardSize.MINI ? { x: 2, y: 2, size: 14 } : FACE.hex;
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
	 * Parts that hug their measured text: the type ends left of the mark, the
	 * range chip at the foot's right edge. Placed on construction and again
	 * in layout once they have measured through the mount context (R1.6).
	 */
	private placeParts(): void {
		if (this.typeLabel) this.typeLabel.x = FACE.type.right - this.typeLabel.width;
		if (this.rangeLabel && this.chipDraw) {
			const width = this.rangeLabel.width + 6;
			this.rangeLabel.x = FACE.foot.right - width + 3;
			this.chipDraw.rect = { x: FACE.foot.right - width, y: FACE.foot.y, width, height: FACE.foot.height };
		}
	}

	/**
	 * "Shrink to 14, then ellipsis" (section 8): a name too wide at 16 drops
	 * to 14, and one too wide at 14 keeps the ellipsis it already has. Done
	 * once, the first time the card can measure.
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

	/** The name's size after fitting: 16, or 14 for a long one. */
	public get nameSize(): number {
		this.fitName();
		const size = this.name.style.fontSize;
		return typeof size === 'number' ? size : FACE.name.sizes[0];
	}

	/**
	 * The cost hex's box reaches 7 px past the top-left corner, and its
	 * outline (`drawCostHex`, a fifteenth of its size) and the polygon
	 * feather a little further.
	 */
	public get inkExtent(): number {
		return this.cardSize === CardSize.MINI ? 0 : -FACE.hex.x + Math.ceil(FACE.hex.size / 15);
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
	 * yellow (section 7); a disabled card dims. The dispatcher keeps
	 * `hovered` true over a disabled card (R9.8), so the outline checks
	 * enabled itself.
	 */
	protected onStateChange(): void {
		const enabled = this.effectivelyEnabled;
		// Dimmed first, so the resting border below is already the dimmed one
		this.dim(!enabled);
		if (this.selected) {
			this.frameBorder.color = SELECTED_OUTLINE;
			this.frameBorder.width = SELECTED_BORDER;
		} else if ((this.hovered || this.focusVisible) && enabled) {
			this.frameBorder.color = HOVER_OUTLINE;
			this.frameBorder.width = FACE.border;
		} else {
			this.frameBorder.color = this.restingBorder;
			this.frameBorder.width = this.cardSize === CardSize.MINI ? 1 : FACE.border;
		}
		// Keyboard focus lifts a card as the pointer does, so its ring clears its neighbours
		this.liftTo(this.rises && (this.selected || ((this.hovered || this.focusVisible) && enabled)) ? 1 : 0);
	}

	private get restingBorder(): RGBA {
		return scale(resolveColor(frameColor(this.driverNumber)), this.dimmed ? DIM_BRIGHTNESS : 1);
	}

	/**
	 * The mock's `.cant`: everything darker and greyer. The card's own
	 * draws darken; its words take dimmed colours, since a card's opacity
	 * would show the fan through it.
	 */
	private dim(dimmed: boolean): void {
		if (dimmed === this.dimmed) return;
		this.dimmed = dimmed;
		const tone = (hex: string) => (dimmed ? dimHex(hex) : hex);
		const brightness = dimmed ? DIM_BRIGHTNESS : 1;
		this.frameDraw.fill = scale(resolveColor(CARD_GROUND), brightness);
		if (!this.selected && !this.hovered) this.frameBorder.color = this.restingBorder;
		if (this.artDraw) this.artDraw.gradient = artGradient(this.driverNumber, brightness);
		if (this.chipDraw?.border) this.chipDraw.border = { color: scale(resolveColor(CARD_LINE), brightness), width: 1 };
		this.hexFaceDraw.fill = dimmed ? COST_HEX_FILLS.dimmed : COST_HEX_FILLS.full;
		this.gemDraw.fill = dimmed ? GEM_FILLS[this.model.rarity].dimmed : GEM_FILLS[this.model.rarity].full;
		if (this.markDraw && this.driverNumber) this.markDraw.fill = dimmed ? DRIVER_MARK_FILLS[this.driverNumber].dimmed : DRIVER_MARK_FILLS[this.driverNumber].full;
		this.name.style = { ...this.name.style, color: tone(CARD_NAME) };
		if (this.typeLabel) this.typeLabel.style = { ...this.typeLabel.style, color: tone(CARD_MUTED) };
		if (this.rarityLabel) this.rarityLabel.style = { ...this.rarityLabel.style, color: tone(CARD_DIM) };
		if (this.rangeLabel) this.rangeLabel.style = { ...this.rangeLabel.style, color: tone(CARD_MUTED) };
		if (this.artIcon) this.artIcon.tint = hexRgba(tone(CARD_NAME), 0.35);
		this.rules?.setColors(tone(CARD_RULES), tone(CARD_KEYWORD));
	}

	/**
	 * Whether hover, focus and selection lift the card out of its place:
	 * the hand's cards rise out of the fan; a pile's or the card browser's
	 * sit in a grid and stay put.
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

	/** Everything here is built once and recoloured on state changes, so a frame allocates nothing. */
	public render(draw: DrawApi): void {
		draw.drawRect(this.frameDraw);
		if (this.artDraw) draw.drawRect(this.artDraw);
		if (this.chipDraw) draw.drawRect(this.chipDraw);
		if (this.markDraw) draw.drawPolygon(this.markDraw);
		draw.drawPolygon(this.gemDraw);
		draw.drawPolygon(this.hexEdgeDraw);
		draw.drawPolygon(this.hexFaceDraw);
		draw.drawText(this.digitsDraw);
	}

	/** The face is the card's fill and the frame its border (R13.22). */
	public get resolvedColors(): ResolvedColors {
		return { fill: this.frameDraw.fill ?? resolveColor(CARD_GROUND), border: this.frameBorder.color };
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
		// The cost hex hanging off the corner is the card's too
		if (this.cardSize === CardSize.MINI) return false;
		const hex = FACE.hex;
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

	/** The summary as the face lays it out, keyword pieces flagged. */
	public get faceWords(): { text: string; keyword: boolean }[][] {
		return this.rules?.words ?? [];
	}

	/** Lines the face's summary needs; zero until it has measured. */
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
		if (this.artDraw) this.artDraw.gradient = artGradient(driverNumber, this.dimmed ? DIM_BRIGHTNESS : 1);
		if (!this.selected && !this.hovered) this.frameBorder.color = this.restingBorder;
	}
}
