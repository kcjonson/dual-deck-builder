import { Component, PointerEvents } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import type { ResolvedColors } from '../../engine/components/Component';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions } from '../../engine/draw/commands';
import type { AnyUiEvent } from '../../engine/input/events';
import { resolveColor } from '../../engine/style/styleObject';
import type { TweenHandle } from '../../engine/animation/Animator';
import { tokens } from '../../engine/theme/tokens';
import { normalizeTransform, transformMatrix } from '../../engine/components/componentGeometry';
import { Rect, concat, invert, transformPoint } from '../../engine/draw/geometry';
import { CardRarity, Card as GameCard } from '../mechanics/Card';

/**
 * Card size variants for different UI contexts
 */
export enum CardSize {
	MINI = 'mini',       // For deck previews, small displays
	NORMAL = 'normal',   // Standard card size for hand and battlefield
	LARGE = 'large'      // For detailed view/inspection
}

/**
 * Card dimensions for each size variant
 */
const CARD_DIMENSIONS = {
	[CardSize.MINI]: { width: 50, height: 70 },
	[CardSize.NORMAL]: { width: 150, height: 210 },
	[CardSize.LARGE]: { width: 240, height: 336 }
} as const;

/** A card title gets up to two lines, at the display face's own line height. */
const TITLE_LINES = 2;
const TITLE_LINE_HEIGHT = 1.2;
/** Space between the title slot and the cost's digits. */
const TITLE_COST_GAP = 4;
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

const FACE_COLOR = '#2a2a3a';
const DISABLED_FACE_COLOR = '#1a1a2a';
const RARITY_COLORS: Record<CardRarity, string> = {
	starter: '#666666',
	common: '#ffffff',
	uncommon: '#00aa00',
	rare: '#0088ff',
	legendary: '#ff8800',
	signature: '#cc66ff',
};
const HOVER_OUTLINE = resolveColor('#ffffff');
const SELECTED_OUTLINE = resolveColor('#00aaff');

const UNFANNED: FanPose = Object.freeze({ rotate: 0, drop: 0, order: 0 });

/**
 * Visual component for displaying a card. One composite target (R8.29):
 * its frame and text are parts, and every state it shows (hovered,
 * selected, disabled, pressed) comes from the framework's flags.
 */
export class Card extends Component {
	private model: GameCard;
	private cardSize: CardSize;
	private name: Text;
	private cost: Text;
	/** Where the cost's digits are centred, and where the title starts and stops short of them. */
	private readonly costCentre: number;
	private readonly titleX: number;
	private readonly titleGap: number;
	private description: Text | null = null;
	private rarity: Text | null = null;
	private tags: Text | null = null;
	/**
	 * The frame, face and driver badge are the card's own draws rather than
	 * child rectangles (R8.1's composite), so its text sits on the card and
	 * not over a sibling. The options are built once and recoloured in place;
	 * the draw API copies what it is given.
	 */
	private readonly frameDraw: DrawRectOptions;
	private readonly faceDraw: DrawRectOptions;
	private readonly badgeDraw: DrawRectOptions | null = null;
	private readonly frameBorder = { color: resolveColor('#ffffff'), width: 3 };
	private readonly rarityColor: string;
	private driverIndicator: Text | null = null;
	private driverNumber: 1 | 2 | null = null;

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

	constructor({ id, x, y, data, size = CardSize.NORMAL, driverNumber, fullText = false }: {
		id?: string;
		x: number;
		y: number;
		data: GameCard;
		size?: CardSize;
		driverNumber?: 1 | 2 | null;
		/** The full rules text in place of the summary: a preview, which has the room. */
		fullText?: boolean;
	}) {
		const dimensions = CARD_DIMENSIONS[size];
		super({
			id,
			x,
			y,
			width: dimensions.width,
			height: dimensions.height,
		});
		this.componentType = 'Card';

		this.model = data;
		this.cardSize = size;
		this.driverNumber = driverNumber || null;

		// The rarity rim, with the face inset inside it
		this.rarityColor = Card.colorForRarity(data.rarity);
		const borderWidth = size === CardSize.MINI ? 2 : 4;
		this.frameDraw = {
			id: id ?? undefined,
			rect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
			fill: resolveColor(this.rarityColor),
			radius: size === CardSize.MINI ? 4 : 8,
		};
		this.faceDraw = {
			rect: { x: borderWidth, y: borderWidth, width: dimensions.width - borderWidth * 2, height: dimensions.height - borderWidth * 2 },
			fill: resolveColor(FACE_COLOR),
			radius: size === CardSize.MINI ? 3 : 6,
		};

		// Scale factors for different card sizes
		const scaleFactor = size === CardSize.MINI ? 0.35 : size === CardSize.LARGE ? 1.2 : 1;
		const padding = Math.floor(12 * scaleFactor);
		const hasDriverBadge = this.driverNumber !== null && size !== CardSize.MINI;
		const badgeX = Math.floor(10 * scaleFactor);
		const badgeSize = Math.floor(25 * scaleFactor);
		// The badge paints over anything submitted before it (chapter 3), so the
		// title starts past it rather than under it.
		const titleX = hasDriverBadge ? badgeX + badgeSize + Math.floor(6 * scaleFactor) : padding;
		const headerY = Math.floor(20 * scaleFactor);
		const titleSize = Math.floor(14 * scaleFactor);

		// Cost: hugs its digits, centred 30 px in from the right edge
		this.cost = new Text(`${data.cost}`, {
			id: this.childId('cost'),
			y: headerY,
			style: {
				fontSize: Math.floor(20 * scaleFactor),
				color: '#ffaa00',
				fontWeight: 'bold',
			},
			wrap: 'none',
		});
		this.costCentre = dimensions.width - Math.floor(30 * scaleFactor);
		this.titleX = titleX;
		this.titleGap = TITLE_COST_GAP * scaleFactor;

		// Card name: runs up to the cost's measured left edge, wraps to a second
		// line rather than under it, and a name that needs a third is cut with
		// an ellipsis. Two line boxes end above the description. Both are
		// placed by placeHeader once the cost has measured.
		this.name = new Text(data.displayName, {
			id: this.childId('title'),
			x: titleX,
			y: headerY,
			height: Math.ceil(TITLE_LINES * titleSize * TITLE_LINE_HEIGHT),
			style: {
				fontSize: titleSize,
				color: '#ffffff',
				fontWeight: 'bold',
			},
			lineHeight: TITLE_LINE_HEIGHT,
			textOverflow: 'ellipsis',
		});
		this.addChild(this.name);
		this.addChild(this.cost);
		this.placeHeader();

		// Description with automatic text wrapping
		// Skip description for mini cards
		if (size !== CardSize.MINI) {
			// The face shows the summary (Card System Design 1.1); the full rules
			// text is for the detail view. Keyword brackets become highlights
			// with DDB-137, plain until then. The box ends above the rarity line
			// and the ellipsis is only a backstop: no summary reaches it.
			const descriptionY = Math.floor(60 * scaleFactor);
			this.description = new Text(fullText ? data.displayDescription : Card.faceText(data.displaySummary), {
				id: this.childId('description'),
				x: padding,
				y: descriptionY,
				width: dimensions.width - padding * 2,
				height: dimensions.height - Math.floor(60 * scaleFactor) - Math.floor(4 * scaleFactor) - descriptionY,
				style: {
					fontSize: Math.floor(11 * scaleFactor),
					color: '#cccccc',
				},
				lineHeight: 1.4,
				textOverflow: 'ellipsis',
			});
			this.addChild(this.description);
		}

		// Rarity - only show on normal and large cards
		if (size !== CardSize.MINI) {
			this.rarity = new Text(data.rarity.toUpperCase(), {
				id: this.childId('rarity'),
				x: padding,
				y: dimensions.height - Math.floor(60 * scaleFactor),
				style: {
					fontSize: Math.floor(10 * scaleFactor),
					color: Card.colorForRarity(data.rarity),
					fontWeight: 'bold',
				},
			});
			this.addChild(this.rarity);

			// Tags
			const tagsStr = data.tags.join(', ');
			this.tags = new Text(tagsStr, {
				id: this.childId('tags'),
				x: padding,
				y: dimensions.height - Math.floor(35 * scaleFactor),
				width: dimensions.width - padding * 2,
				style: {
					fontSize: Math.floor(8 * scaleFactor),
					color: '#888888',
				},
				textOverflow: 'ellipsis',
				wrap: 'none',
			});
			this.addChild(this.tags);

			// Target type
			const targetText = new Text(data.targetType, {
				id: this.childId('target_type'),
				x: padding,
				y: dimensions.height - Math.floor(20 * scaleFactor),
				style: {
					fontSize: Math.floor(8 * scaleFactor),
					color: '#666666',
				},
			});
			this.addChild(targetText);
		}

		// Driver indicator (if specified)
		if (hasDriverBadge) {
			this.badgeDraw = {
				rect: { x: badgeX, y: badgeX, width: badgeSize, height: badgeSize },
				fill: resolveColor(this.driverNumber === 1 ? '#4a4a8a' : '#4a8a4a'),
				radius: Math.floor(12.5 * scaleFactor),
				border: { color: resolveColor(this.driverNumber === 1 ? '#6a6aaa' : '#6aaa6a'), width: 2 },
			};

			// Centred in the badge
			this.driverIndicator = new Text(`D${this.driverNumber}`, {
				id: this.childId('driver_badge'),
				x: badgeX,
				y: badgeX,
				width: badgeSize,
				height: badgeSize,
				style: {
					fontSize: Math.floor(10 * scaleFactor),
					color: '#ffffff',
					textAlign: 'center',
					fontWeight: 'bold',
				},
				verticalAlign: 'middle',
				wrap: 'none',
			});
			this.addChild(this.driverIndicator);
		}
	}

	/**
	 * Composite internals derive their ids from the card's own, so a caller
	 * names the card once and the lint can still address `<card>_title` and
	 * `<card>_driver_badge`. Unnamed cards leave their children unnamed too.
	 */
	private childId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}

	/**
	 * The cost hugs its digits and the title runs up to their left edge, so
	 * both are placed from the cost's measured width: on construction, and in
	 * the layout phase once the cost has measured through the mount context
	 * (R1.6, R8.18).
	 */
	private placeHeader(): void {
		this.cost.x = this.costCentre - this.cost.width / 2;
		this.name.width = Math.floor(this.cost.x - this.titleGap - this.titleX);
	}

	protected layoutChildren(): void {
		this.placeHeader();
	}

	/** R8.29: a card is one target; its text and frame are internals. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/** A card acts on press and click in handleEvent, with or without a caller callback. */
	public get handlesPointer(): boolean {
		return true;
	}

	/**
	 * Hover arrives through `onHover` and `onUnhover`, which the dispatcher
	 * drives (R9.8); the press shades the frame, and the click is the
	 * dispatcher's, synthesised when press and release both land on this card
	 * (R9.31). A disabled card receives none of these (R9.5). A focused card
	 * treats `activate` (Enter or Space) as a click (R9.27); only the hand
	 * makes its cards focusable.
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'activate':
				event.consume();
				this.activate();
				return;
			case 'pointerdown':
				if (event.button === 0) {
					this.frameDraw.fill = resolveColor(this.adjustBrightness(this.rarityColor, -20));
				}
				return;
			case 'pointerup':
			case 'pointerleave':
			case 'pointercancel':
				this.frameDraw.fill = resolveColor(this.rarityColor);
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
	 * played, rises, and all but focus take a glow; a disabled card dims. The dispatcher keeps `hovered` true over a
	 * disabled card (R9.8), so the glow checks enabled itself.
	 */
	protected onStateChange(): void {
		const enabled = this.effectivelyEnabled;
		if (this.selected) {
			this.frameBorder.color = SELECTED_OUTLINE;
			this.frameDraw.border = this.frameBorder;
		} else if (this.hovered && enabled) {
			this.frameBorder.color = HOVER_OUTLINE;
			this.frameDraw.border = this.frameBorder;
		} else {
			this.frameDraw.border = undefined;
		}
		// Keyboard focus lifts a card as the pointer does, so its ring clears its neighbours
		this.liftTo(this.selected || ((this.hovered || this.focusVisible) && enabled) ? 1 : 0);
		this.faceDraw.fill = resolveColor(enabled ? FACE_COLOR : DISABLED_FACE_COLOR);
	}

	public render(draw: DrawApi): void {
		draw.drawRect(this.frameDraw);
		draw.drawRect(this.faceDraw);
		if (this.badgeDraw) draw.drawRect(this.badgeDraw);
	}

	/** The face is the card's fill and the rarity rim its border (R13.22). */
	public get resolvedColors(): ResolvedColors {
		return { fill: this.faceDraw.fill ?? resolveColor(FACE_COLOR), border: this.frameDraw.fill ?? resolveColor(this.rarityColor) };
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
	 * its way up: anything placed against it (the preview) clears the card
	 * where it will settle, not where the tween has it this frame.
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
	 * The fan pose blended toward the lifted one. A card that is up at all
	 * paints and hit-tests on the `raised` layer, over its neighbours and
	 * the driver tab above it; a higher layer is hit first whatever the
	 * siblings' `zIndex`, so the lift leaves the fan's order alone.
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
	 * again.
	 */
	public containsPoint(localX: number, localY: number): boolean {
		const reach = this.liftAmount > 0 ? CARD_LIFT : 0;
		return localX >= 0 && localX < this.width && localY >= 0 && localY < this.height + reach;
	}

	/** Drops the lift tween with the card: the base cancels it on unmount. */
	protected onUnmount(): void {
		this.liftTween = null;
		super.onUnmount();
	}

	/**
	 * Adjust color brightness
	 */
	private adjustBrightness(color: string, amount: number): string {
		// Simple brightness adjustment for hex colors
		if (color.startsWith('#')) {
			const hex = color.slice(1);
			const r = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) + amount));
			const g = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) + amount));
			const b = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) + amount));
			return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
		}
		return color;
	}

	/** A summary as the face draws it: `[keyword]` brackets stripped. */
	public static faceText(summary: string): string {
		return summary.replace(/\[(.+?)\]/g, '$1');
	}

	/** A rarity's colour: the card's rim and its rarity line, and the card showcase's group headings. */
	public static colorForRarity(rarity: CardRarity): string {
		return RARITY_COLORS[rarity];
	}

	/** The card this shows. */
	public get data(): GameCard {
		return this.model;
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
	
	/** The driver seat the badge shows; null for none. */
	public get driver(): 1 | 2 | null {
		return this.driverNumber;
	}

	public set driver(driverNumber: 1 | 2 | null) {
		if (this.driverNumber === driverNumber) return;
		this.driverNumber = driverNumber;
		if (this.driverIndicator) {
			this.driverIndicator.text = driverNumber ? `D${driverNumber}` : '';
		}
	}
}