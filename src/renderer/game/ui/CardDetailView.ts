import { Component } from '../../engine/components/Component';
import { Icon } from '../../engine/components/Icon';
import { Text } from '../../engine/components/Text';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { BoxShadow, DrawPolygonOptions, DrawRectOptions, DrawTextOptions } from '../../engine/draw/commands';
import { shadowExtent } from '../../engine/style/look';
import { resolveColor } from '../../engine/style/styleObject';
import type { Card as GameCard } from '../mechanics/Card';
import { KEYWORDS, cardKeywords, cardRange } from '../data/keywords';
import { hexRgba } from '../screens/combat/combatStyle';
import { MARK_OUTLINES, seatMark } from './targetMarks';
import { KeywordText } from './KeywordText';
import {
	CARD_DETAIL_RULES,
	CARD_DIM,
	CARD_GROUND,
	CARD_KEYWORD,
	CARD_LINE_FAINT,
	CARD_MUTED,
	CARD_NAME,
	COST_DIGITS,
	artGradient,
	cardArtIcon,
	cardTypeLabel,
	costHexDraws,
	driverMarkDraw,
	rarityGemDraw,
	frameColor,
} from './cardStyle';

/**
 * The detail view, from the mock's `.cdetail`, in its own pixels. 250 wide;
 * its height is what the content needs, up to 440, the art giving way
 * first (Battle Screen Design, section 5).
 */
export const DETAIL = {
	width: 250,
	maxHeight: 440,
	radius: 8,
	border: 2,
	pad: { top: 12, side: 12, bottom: 10 },
	gap: 8,
	hex: { size: 34, digits: 21 },
	name: { size: 22, lineHeight: 23, lines: 2 },
	type: { size: 12, mark: 12, gap: 5 },
	art: { height: 64, min: 20, radius: 4, icon: 48, inset: { right: 10, bottom: 6 } },
	rules: { size: 15, lineHeight: 21 },
	foot: { rule: 1, gap: 8, height: 12, gem: 9, size: 11 },
} as const;

/** The keyword boxes beside the view, from the mock's `.kwpanel` and `.kw`. */
export const KEYWORD_PANEL = {
	width: 230,
	gap: 6,
	/** Between the detail view and the boxes. */
	offset: 10,
	pad: { x: 10, y: 8 },
	title: { size: 15, lineHeight: 18 },
	body: { size: 13, lineHeight: 18 },
	max: 3,
} as const;

/** Inside the border and padding, as the mock's border-box lays it out. */
const INSET = { top: DETAIL.border + DETAIL.pad.top, side: DETAIL.border + DETAIL.pad.side, bottom: DETAIL.border + DETAIL.pad.bottom };
const INNER_WIDTH = DETAIL.width - INSET.side * 2;
/** The mock's `0 16px 40px rgba(0,0,0,0.8)`, lifting the view off the road; a driver's detail view takes it too. */
export const DETAIL_SHADOW: BoxShadow = { offset: { x: 0, y: 16 }, blur: 40, color: [0, 0, 0, 0.8] };

/** What a detail view's foot says about pinning: how to, or that it is. */
export function pinHint(pinned: boolean): string {
	return pinned ? 'PINNED' : 'RMB / I: PIN';
}

export interface CardDetailViewOptions {
	id?: string;
	card: GameCard;
	driver?: 1 | 2 | null;
	/** Pinned open: the foot says so instead of how to pin it. */
	pinned?: boolean;
}

/**
 * Section 5's detail view: the cost hex, the name on up to two lines, the
 * card's type and driver mark, the art, the full text at 15px with its
 * keywords highlighted, and a foot with the rarity gem, the range, and
 * whether it is pinned. It sizes itself in layout from its measured text,
 * so its owner places it once it has laid out.
 */
export class CardDetailView extends Component {
	private readonly card: GameCard;
	private readonly driverNumber: 1 | 2 | null;
	private readonly name: Text;
	private readonly typeLabel: Text;
	private readonly rules: KeywordText;
	private readonly footLabel: Text;
	private readonly pinLabel: Text;
	private readonly artIcon: Icon;
	private readonly frameDraw: DrawRectOptions;
	private readonly artDraw: DrawRectOptions;
	private readonly ruleDraw: DrawRectOptions;
	private readonly digitsDraw: DrawTextOptions;
	private markDraw: DrawPolygonOptions | null = null;
	private hexDraws: { edge: DrawPolygonOptions; face: DrawPolygonOptions } | null = null;
	private gemDraw: DrawPolygonOptions | null = null;
	private hexY: number = INSET.top;
	private artHeightValue: number = DETAIL.art.height as number;

	constructor({ id, card, driver = null, pinned = false }: CardDetailViewOptions) {
		super({ id, width: DETAIL.width, height: DETAIL.maxHeight });
		this.componentType = 'CardDetailView';
		this.card = card;
		this.driverNumber = driver;
		const childId = (suffix: string) => (id ? `${id}_${suffix}` : undefined);

		this.frameDraw = {
			id,
			shadow: DETAIL_SHADOW,
			rect: { x: 0, y: 0, width: DETAIL.width, height: DETAIL.maxHeight },
			fill: resolveColor(CARD_GROUND),
			radius: DETAIL.radius,
			border: { color: resolveColor(frameColor(driver)), width: DETAIL.border },
		};
		this.artDraw = { rect: { x: INSET.side, y: 0, width: INNER_WIDTH, height: DETAIL.art.height }, radius: DETAIL.art.radius, gradient: artGradient(driver) };
		this.ruleDraw = { rect: { x: INSET.side, y: 0, width: INNER_WIDTH, height: DETAIL.foot.rule }, fill: resolveColor(CARD_LINE_FAINT) };
		this.digitsDraw = {
			text: `${card.cost}`,
			box: { x: INSET.side, y: INSET.top, width: DETAIL.hex.size, height: DETAIL.hex.size },
			font: 'display',
			size: DETAIL.hex.digits,
			color: resolveColor(COST_DIGITS),
			align: 'center',
			verticalAlign: 'middle',
		};

		this.typeLabel = new Text({
			id: childId('type'),
			text: cardTypeLabel(card),
			height: DETAIL.type.size,
			style: { fontRole: 'mono', fontSize: DETAIL.type.size, color: CARD_MUTED, letterSpacing: 0.08 },
			lineHeight: 1,
			verticalAlign: 'middle',
			wrap: 'none',
		});
		this.name = new Text({
			id: childId('name'),
			text: card.displayName,
			x: INSET.side + DETAIL.hex.size + DETAIL.gap,
			style: { fontRole: 'display', fontSize: DETAIL.name.size, color: CARD_NAME },
			lineHeight: DETAIL.name.lineHeight / DETAIL.name.size,
			textOverflow: 'ellipsis',
		});
		this.artIcon = new Icon({
			id: childId('art'),
			glyph: cardArtIcon(card),
			size: DETAIL.art.icon,
			x: INSET.side + INNER_WIDTH - DETAIL.art.inset.right - DETAIL.art.icon,
			tint: hexRgba(CARD_NAME, 0.35),
		});
		this.rules = new KeywordText({
			id: childId('rules'),
			text: card.displayDescription,
			mode: 'auto',
			x: INSET.side,
			width: INNER_WIDTH,
			fontSize: DETAIL.rules.size,
			lineHeight: DETAIL.rules.lineHeight,
			color: CARD_DETAIL_RULES,
			keywordColor: CARD_KEYWORD,
		});
		const range = cardRange(card);
		this.footLabel = new Text({
			id: childId('rarity'),
			text: `${card.rarity.toUpperCase()}${range !== null ? ` · R${range}` : ''}`,
			x: INSET.side + DETAIL.foot.gem + DETAIL.foot.gap,
			height: DETAIL.foot.height,
			style: { fontRole: 'mono', fontSize: DETAIL.foot.size, color: CARD_DIM, letterSpacing: 0.06 },
			lineHeight: DETAIL.foot.height / DETAIL.foot.size,
			verticalAlign: 'middle',
			wrap: 'none',
		});
		this.pinLabel = new Text({
			id: childId('pin'),
			text: pinHint(pinned),
			height: DETAIL.foot.height,
			style: { fontRole: 'mono', fontSize: DETAIL.foot.size, color: CARD_MUTED, letterSpacing: 0.06 },
			lineHeight: DETAIL.foot.height / DETAIL.foot.size,
			verticalAlign: 'middle',
			wrap: 'none',
		});
		for (const child of [this.typeLabel, this.name, this.artIcon, this.rules, this.footLabel, this.pinLabel]) this.addChild(child);
	}

	/** The card it shows. */
	public get data(): GameCard {
		return this.card;
	}

	/** The art strip's height after fitting: 64, less whatever the cap took. */
	public get artHeight(): number {
		return this.artHeightValue;
	}

	/** Lines of full text the view holds. */
	public get ruleLines(): number {
		return this.rules.lineCount;
	}

	protected layoutChildren(): void {
		this.arrange();
	}

	/**
	 * Lays the view out top to bottom from its measured text and takes the
	 * height that needs: the head (the hex beside a name of one or two
	 * lines), the art, the rules, the foot. Past the 440 cap the art
	 * shrinks to 20, then the rules lose lines, which the card data check
	 * keeps from happening.
	 */
	public arrange(): void {
		const { gap } = DETAIL;
		const pad = INSET;
		// The head: type and mark at the right, the name between them and the hex
		const typeWidth = this.typeLabel.width;
		const markLeft = DETAIL.width - pad.side - DETAIL.type.mark;
		this.typeLabel.x = markLeft - DETAIL.type.gap - typeWidth;
		const nameWidth = Math.max(0, this.typeLabel.x - gap - this.name.x);
		this.name.width = nameWidth;
		const nameLines = Math.min(DETAIL.name.lines, Math.max(1, this.name.measured?.lines ?? 1));
		this.name.height = nameLines * DETAIL.name.lineHeight;
		const headHeight = Math.max(DETAIL.hex.size, this.name.height);
		const headMid = pad.top + headHeight / 2;
		this.hexY = headMid - DETAIL.hex.size / 2;
		this.name.y = headMid - this.name.height / 2;
		this.typeLabel.y = headMid - DETAIL.type.size / 2;
		// The draws are built here, where layout places them, and only drawn in render
		const driver = this.driverNumber;
		this.markDraw = driver ? driverMarkDraw(driver, MARK_OUTLINES[seatMark(driver) as 'driver1' | 'driver2'], markLeft + DETAIL.type.mark / 2, headMid, DETAIL.type.mark) : null;
		this.hexDraws = costHexDraws(pad.side, this.hexY, DETAIL.hex.size);
		this.digitsDraw.box = { x: pad.side, y: this.hexY, width: DETAIL.hex.size, height: DETAIL.hex.size };

		const lines = this.rules.reflow();
		const rulesHeight = lines * DETAIL.rules.lineHeight;
		const footHeight = DETAIL.foot.rule + DETAIL.foot.gap + DETAIL.foot.height;
		const fixed = pad.top + headHeight + gap + gap + gap + footHeight + INSET.bottom;
		const room = DETAIL.maxHeight - fixed;
		const art = Math.max(DETAIL.art.min, Math.min(DETAIL.art.height, room - rulesHeight));
		this.artHeightValue = art;
		const shownRules = Math.min(rulesHeight, Math.max(0, room - art));

		let y = pad.top + headHeight + gap;
		this.artDraw.rect = { x: pad.side, y, width: INNER_WIDTH, height: art };
		const iconSize = Math.min(DETAIL.art.icon, art - DETAIL.art.inset.bottom);
		this.artIcon.size = Math.max(0, iconSize);
		this.artIcon.y = y + art - DETAIL.art.inset.bottom - this.artIcon.size;
		this.artIcon.x = pad.side + INNER_WIDTH - DETAIL.art.inset.right - this.artIcon.size;
		y += art + gap;
		this.rules.y = y;
		this.rules.height = shownRules;
		y += shownRules + gap;
		this.ruleDraw.rect = { x: pad.side, y, width: INNER_WIDTH, height: DETAIL.foot.rule };
		const footTextY = y + DETAIL.foot.rule + DETAIL.foot.gap;
		this.footLabel.y = footTextY;
		this.pinLabel.y = footTextY;
		this.pinLabel.x = DETAIL.width - pad.side - this.pinLabel.width;
		this.gemDraw = rarityGemDraw(this.card.rarity, pad.side + DETAIL.foot.gem / 2, footTextY + DETAIL.foot.height / 2, DETAIL.foot.gem);
		const height = footTextY + DETAIL.foot.height + INSET.bottom;
		this.frameDraw.rect = { x: 0, y: 0, width: DETAIL.width, height };
		if (this.height !== height) this.height = height;
	}

	/** The frame's drop shadow. */
	public get inkExtent(): number {
		return shadowExtent(DETAIL_SHADOW);
	}

	public render(draw: DrawApi): void {
		draw.drawRect(this.frameDraw);
		if (this.hexDraws) {
			draw.drawPolygon(this.hexDraws.edge);
			draw.drawPolygon(this.hexDraws.face);
		}
		draw.drawText(this.digitsDraw);
		if (this.markDraw) draw.drawPolygon(this.markDraw);
		draw.drawRect(this.artDraw);
		draw.drawRect(this.ruleDraw);
		if (this.gemDraw) draw.drawPolygon(this.gemDraw);
	}
}

/**
 * The keyword boxes beside the detail view: each keyword the card uses,
 * its name in yellow capitals over what it means, at most three.
 */
export class KeywordPanel extends Component {
	private readonly boxes: { title: Text; body: Text; draw: DrawRectOptions }[] = [];

	constructor({ id, keywords }: { id?: string; keywords: readonly string[] }) {
		super({ id, width: KEYWORD_PANEL.width, height: 1 });
		this.componentType = 'KeywordPanel';
		const inner = KEYWORD_PANEL.width - KEYWORD_PANEL.pad.x * 2;
		keywords.slice(0, KEYWORD_PANEL.max).forEach((keyword, index) => {
			const title = new Text({
				id: id ? `${id}_${index}_name` : undefined,
				text: keyword.toUpperCase(),
				x: KEYWORD_PANEL.pad.x,
				width: inner,
				height: KEYWORD_PANEL.title.lineHeight,
				style: { fontRole: 'display', fontSize: KEYWORD_PANEL.title.size, color: CARD_KEYWORD, letterSpacing: 0.04 },
				lineHeight: KEYWORD_PANEL.title.lineHeight / KEYWORD_PANEL.title.size,
				wrap: 'none',
				textOverflow: 'ellipsis',
			});
			const body = new Text({
				id: id ? `${id}_${index}_text` : undefined,
				text: KEYWORDS[keyword] ?? '',
				x: KEYWORD_PANEL.pad.x,
				width: inner,
				style: { fontSize: KEYWORD_PANEL.body.size, color: '#d9d4c6' },
				lineHeight: KEYWORD_PANEL.body.lineHeight / KEYWORD_PANEL.body.size,
			});
			this.addChild(title);
			this.addChild(body);
			this.boxes.push({
				title,
				body,
				draw: {
					rect: { x: 0, y: 0, width: KEYWORD_PANEL.width, height: 0 },
					fill: resolveColor('#0d0e0f'),
					radius: 3,
					border: { color: resolveColor('rgba(233, 228, 214, 0.2)'), width: 1 },
				},
			});
		});
	}

	/** Whether there is anything to explain. */
	public get empty(): boolean {
		return this.boxes.length === 0;
	}

	protected layoutChildren(): void {
		this.arrange();
	}

	/** Stacks the boxes from the top, each as tall as its wrapped text, and takes their height. */
	public arrange(): void {
		let y = 0;
		for (const box of this.boxes) {
			const bodyHeight = box.body.measured?.height ?? 0;
			const height = KEYWORD_PANEL.pad.y * 2 + KEYWORD_PANEL.title.lineHeight + bodyHeight;
			box.draw.rect = { x: 0, y, width: KEYWORD_PANEL.width, height };
			box.title.y = y + KEYWORD_PANEL.pad.y;
			box.body.y = box.title.y + KEYWORD_PANEL.title.lineHeight;
			y += height + KEYWORD_PANEL.gap;
		}
		const height = Math.max(1, y - KEYWORD_PANEL.gap);
		if (this.height !== height) this.height = height;
	}

	public render(draw: DrawApi): void {
		for (const box of this.boxes) draw.drawRect(box.draw);
	}
}

/** Which side of the detail view the keyword boxes go. */
export type KeywordSide = 'left' | 'right';

export interface CardInspectViewOptions extends CardDetailViewOptions {
	keywordSide?: KeywordSide;
}

/**
 * The detail view with its keyword boxes on one side, both resting on the
 * same bottom edge, so the pair grows upward together. What the card
 * inspector shows, and what the galleries draw.
 */
export class CardInspectView extends Component {
	public readonly detail: CardDetailView;
	public readonly keywords: KeywordPanel;
	private readonly side: KeywordSide;

	constructor({ id = 'card_detail', keywordSide = 'right', ...options }: CardInspectViewOptions) {
		super({ id, width: DETAIL.width, height: DETAIL.maxHeight });
		this.componentType = 'CardInspectView';
		this.side = keywordSide;
		this.detail = new CardDetailView({ id: `${id}_view`, ...options });
		this.keywords = new KeywordPanel({ id: `${id}_keywords`, keywords: cardKeywords(options.card) });
		this.addChild(this.detail);
		if (!this.keywords.empty) this.addChild(this.keywords);
	}

	/** Where the keyword boxes went. */
	public get keywordSide(): KeywordSide {
		return this.side;
	}

	/** The detail view's left edge within this view, which the inspector centres on the card. */
	public get detailX(): number {
		return this.detail.x;
	}

	protected layoutChildren(): void {
		this.arrange();
	}

	public arrange(): void {
		this.detail.arrange();
		const hasKeywords = !this.keywords.empty;
		if (hasKeywords) this.keywords.arrange();
		const height = Math.max(this.detail.height, hasKeywords ? this.keywords.height : 0);
		const width = DETAIL.width + (hasKeywords ? KEYWORD_PANEL.offset + KEYWORD_PANEL.width : 0);
		const left = hasKeywords && this.side === 'left';
		this.detail.x = left ? KEYWORD_PANEL.width + KEYWORD_PANEL.offset : 0;
		this.detail.y = height - this.detail.height;
		if (hasKeywords) {
			this.keywords.x = left ? 0 : DETAIL.width + KEYWORD_PANEL.offset;
			this.keywords.y = height - this.keywords.height;
		}
		if (this.width !== width || this.height !== height) this.setSize(width, height);
	}
}

/** Width of the whole inspect view for a card: the detail view, and the boxes if it has keywords. */
export function inspectViewWidth(card: GameCard): number {
	return DETAIL.width + (cardKeywords(card).length > 0 ? KEYWORD_PANEL.offset + KEYWORD_PANEL.width : 0);
}
