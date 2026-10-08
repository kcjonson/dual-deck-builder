import { Component } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions } from '../../engine/draw/commands';
import type { Rect } from '../../engine/draw/geometry';
import { resolveColor } from '../../engine/style/styleObject';
import { shadowExtent } from '../../engine/style/look';
import type { EscortDividend } from '../mechanics/Escort';
import { Card as UICard, CardSize } from './Card';
import { DETAIL_SHADOW, pinHint } from './CardDetailView';
import { CARD_LINE_FAINT, CARD_MUTED, CARD_NAME } from './cardStyle';
import { CardLookup, DRIVER_DETAIL, detailMono } from './DriverDetailView';
import type { EscortCardData } from './escortCardData';
import {
	ESCORT_FRAME,
	EscortFrameDraws,
	HAZARD_HEADER,
	STRUCTURE_FILLS,
	VehicleArtDraws,
	drawEscortFrame,
	drawVehicleArt,
	escortFrameDraws,
	resizeEscortFrame,
	shapeVehicleArt,
	vehicleArtDraws,
} from './escortCardStyle';
import { FlowWrap } from './FlowWrap';
import { StatBarDraws, barFraction, drawStatBar, placeStatBar, statBarDraws } from './statBar';
import { spriteKindOf } from './vehicleSprites';

const FACE_SIZE = UICard.getDimensions(CardSize.NORMAL);

/**
 * An escort's detail view, in its own pixels: its profile on the left (the
 * art beside the name and its role, then its structure, its stats, and what
 * it pays), the signature card it brings on the right as a full card face,
 * a rule between them, and a foot saying how to pin it. It wears the escort
 * card's frame and header and the play card detail view's shadow, and the
 * driver detail view's type and spacing, so the two read as one family.
 */
export const ESCORT_DETAIL = {
	pad: DRIVER_DETAIL.pad,
	/** From the outer top edge to the content: the line, the header, then room. */
	top: ESCORT_FRAME.border + HAZARD_HEADER.height + 12,
	art: { width: 88, height: 52, radius: 3, inset: { x: 14, y: 8 } },
	/** The profile's width; its stats wrap inside it. */
	profile: 232,
	/** The rule between the profile and the card, with this much room either side. */
	rule: { width: 1, gap: 12 },
	/** Between the card's heading and the top of its cost hex. */
	heading: 4,
} as const;

/** What a hauler's dividend pays, as the profile says it. */
function dividendText({ kind, amount }: EscortDividend): string {
	switch (kind) {
		case 'fuel': return `AFTER A WIN +${amount} FUEL`;
		case 'scrap': return `AFTER A WIN +${amount} SCRAP`;
		case 'heal': return `AFTER A WIN EVERY DRIVER +${amount} HP`;
	}
}

/** What kind of escort it is: a hauler or a gun escort, or a driven vehicle carrying on unmanned, which is always a gun. */
function roleText({ type, role }: Pick<EscortCardData, 'type' | 'role'>): string {
	if (type === null) return 'UNMANNED';
	return role === 'hauler' ? 'HAULER' : 'GUN ESCORT';
}

export interface EscortDetailViewOptions {
	id?: string;
	data: EscortCardData;
	/** Where its signature card's type is looked up: the screen's loaded cards. */
	cards: CardLookup;
	/** Pinned open: the foot says so instead of how to pin it. */
	pinned?: boolean;
}

/**
 * An escort card's detail view (Game Flow 7.0): its profile and its
 * signature card. The profile heads with the art, the name on up to two
 * lines, and its role; then its structure as figures and a bar, its armor,
 * speed, and crew skills flowed in rows, and a hauler's dividend. Beside it,
 * past a rule, the signature card it brings, as a face (Battle Screen
 * Design, section 5) a reader can take in whole; an escort that brings none
 * says so in its profile instead and the view is the profile alone.
 *
 * Its width is set by whether it has a card, so its owner can place it
 * before it has laid out; its height comes from its measured text, as the
 * driver detail view's does.
 */
export class EscortDetailView extends Component {
	private readonly model: EscortCardData;
	private readonly name: Text;
	private readonly role: Text;
	private readonly structure: Text;
	/** Armor, speed, and the crew skills, flowed in rows across the profile. */
	private readonly stats: FlowWrap;
	private readonly dividend: Text | null;
	/** Says it brings no card, in place of one; null when it brings one. */
	private readonly noCard: Text | null;
	private readonly heading: Text | null;
	private readonly face: UICard | null;
	private readonly pin: Text;
	private readonly frame: EscortFrameDraws;
	private readonly art: VehicleArtDraws;
	private readonly structureBar: StatBarDraws = statBarDraws(STRUCTURE_FILLS);
	private readonly ruleDraw: (DrawRectOptions & { rect: Rect }) | null;

	constructor({ id = 'escort_detail_view', data, cards, pinned = false }: EscortDetailViewOptions) {
		const childId = (suffix: string): string => `${id}_${suffix}`;
		const card = data.signatureCard ? cards(data.signatureCard) : null;
		const face = card ? new UICard({ id: childId('signature'), x: 0, y: 0, data: card }) : null;
		const { pad, top, art, profile, rule } = ESCORT_DETAIL;
		// The face's cost hex hangs off its corner, so the card sits that far in from the rule and the heading
		const faceInk = face?.inkExtent ?? 0;
		const width = pad * 2 + profile + (face ? rule.gap * 2 + rule.width + faceInk + FACE_SIZE.width : 0);
		super({ id, width, height: top + pad });
		this.componentType = 'EscortDetailView';
		this.model = data;

		this.frame = escortFrameDraws({ id, width, height: top + pad, shadow: DETAIL_SHADOW });
		this.art = vehicleArtDraws({ x: pad, y: top, width: art.width, height: art.height, inset: art.inset, radius: art.radius });
		shapeVehicleArt(this.art, spriteKindOf({ name: data.name, maxStructure: data.maxStructure, escort: true }));

		const columnX = pad + art.width + DRIVER_DETAIL.gap;
		const columnWidth = pad + profile - columnX;
		this.name = new Text({
			id: childId('name'),
			text: data.name,
			x: columnX,
			y: top,
			width: columnWidth,
			height: DRIVER_DETAIL.name.lineHeight * DRIVER_DETAIL.name.lines,
			style: { fontRole: 'display', fontSize: DRIVER_DETAIL.name.size, color: CARD_NAME },
			lineHeight: DRIVER_DETAIL.name.lineHeight / DRIVER_DETAIL.name.size,
			verticalAlign: 'top',
			wrap: 'word',
			textOverflow: 'ellipsis',
		});
		this.role = new Text({
			id: childId('role'),
			text: roleText(data),
			x: columnX,
			width: columnWidth,
			height: DRIVER_DETAIL.identity.height,
			style: { fontSize: DRIVER_DETAIL.identity.size, color: CARD_MUTED },
			lineHeight: DRIVER_DETAIL.identity.height / DRIVER_DETAIL.identity.size,
			verticalAlign: 'middle',
			wrap: 'none',
			textOverflow: 'ellipsis',
		});

		this.structure = detailMono({ id: childId('structure'), text: `STRUCTURE ${data.structure}/${data.maxStructure}`, kind: 'figures', x: pad });
		this.stats = new FlowWrap({ id: childId('stats'), x: pad, width: profile, gap: DRIVER_DETAIL.stats.gap, rowGap: DRIVER_DETAIL.stats.rowGap });
		const stats: [string, string][] = [
			['armor', `ARMOR ${data.armor}`],
			// An escort's speed is its own; nobody at the wheel adds to it (Combat Rules)
			['speed', `SPEED ${data.speed}`],
			['gunnery', `GUNNERY ${data.gunnery}`],
			['evade', `EVADE ${data.evade}`],
			['ramming', `RAMMING ${data.ramming}`],
		];
		for (const [suffix, text] of stats) this.stats.addChild(detailMono({ id: childId(suffix), text, kind: 'figures' }));
		this.dividend = data.dividend ? detailMono({ id: childId('dividend'), text: dividendText(data.dividend), kind: 'figures', x: pad }) : null;
		this.noCard = face ? null : detailMono({ id: childId('no_card'), text: 'BRINGS NO CARD', kind: 'label', x: pad });

		this.face = face;
		if (face) {
			const cardX = pad + profile + rule.gap * 2 + rule.width;
			this.heading = detailMono({ id: childId('signature_heading'), text: 'SIGNATURE CARD', kind: 'label', x: cardX });
			face.x = cardX + faceInk;
			// A view to read: its card takes no pointer of its own
			face.pointerEvents = 'none';
			this.ruleDraw = { rect: { x: pad + profile + rule.gap, y: top, width: rule.width, height: 0 }, fill: resolveColor(CARD_LINE_FAINT) };
		} else {
			this.heading = null;
			this.ruleDraw = null;
		}
		this.pin = detailMono({ id: childId('pin'), text: pinHint(pinned), kind: 'label' });

		for (const child of [this.name, this.role, this.structure, this.stats, this.dividend, this.noCard, this.heading, this.face, this.pin]) {
			if (child) this.addChild(child);
		}
	}

	/** The escort it shows. */
	public get data(): EscortCardData {
		return this.model;
	}

	/** The signature card's face; null when it brings none. */
	public get signatureCard(): UICard | null {
		return this.face;
	}

	protected layoutChildren(): void {
		this.arrange();
	}

	/**
	 * Lays the view out top to bottom from its measured text and takes the
	 * height that needs, moving the draws built with the view in place.
	 */
	public arrange(): void {
		const { pad, top, art, profile, heading } = ESCORT_DETAIL;
		const { gap, mono } = DRIVER_DETAIL;

		// The head: the name on one line or two, the role under it, beside the art
		const nameLines = Math.min(DRIVER_DETAIL.name.lines, Math.max(1, this.name.measured?.lines ?? 1));
		this.name.height = nameLines * DRIVER_DETAIL.name.lineHeight;
		this.role.y = top + this.name.height + 2;
		let y = Math.max(top + art.height, this.role.y + this.role.height) + gap;

		// Structure as figures, its bar running to the profile's right edge
		this.structure.y = y;
		const barX = pad + this.structure.width + DRIVER_DETAIL.bar.gap;
		placeStatBar(
			this.structureBar,
			{ x: barX, y: y + (mono.height - DRIVER_DETAIL.bar.height) / 2, width: Math.max(0, pad + profile - barX), height: DRIVER_DETAIL.bar.height },
			barFraction(this.model.structure, this.model.maxStructure),
		);
		y += mono.height + DRIVER_DETAIL.stats.rowGap;

		// Armor, speed, and the skills, wrapping at the profile's edge; then what it pays, or that it brings no card
		this.stats.y = y;
		y += this.stats.measure(this.stats.width, Infinity).height;
		for (const line of [this.dividend, this.noCard]) {
			if (!line) continue;
			y += DRIVER_DETAIL.stats.rowGap;
			line.y = y;
			y += mono.height;
		}

		// The card beside it, its hex clear of the heading
		if (this.heading && this.face && this.ruleDraw) {
			this.heading.y = top;
			this.face.y = top + mono.height + heading + this.face.inkExtent;
			const bottom = this.face.y + this.face.height;
			this.ruleDraw.rect.height = Math.max(y, bottom) - top;
			y = Math.max(y, bottom);
		}

		// The foot: how to pin it, at the right
		y += gap;
		this.pin.y = y;
		this.pin.x = this.width - pad - this.pin.width;
		const height = y + mono.height + pad;
		resizeEscortFrame(this.frame, height);
		if (this.height !== height) this.height = height;
	}

	/** The frame's drop shadow. */
	public get inkExtent(): number {
		return shadowExtent(DETAIL_SHADOW);
	}

	public render(draw: DrawApi): void {
		drawEscortFrame(draw, this.frame);
		drawVehicleArt(draw, this.art);
		drawStatBar(draw, this.structureBar);
		if (this.ruleDraw) draw.drawRect(this.ruleDraw);
	}
}
