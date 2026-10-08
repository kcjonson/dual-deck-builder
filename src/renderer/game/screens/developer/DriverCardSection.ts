import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { tokens } from '../../../engine/theme/tokens';
import { addCards, startingDeckCounts } from '../../campaign/CardCounts';
import { Card as GameCard, CardData } from '../../mechanics/Card';
import cardsFile from '../../data/cards.json';
import { MINI_GRID } from '../../ui/Card';
import { DRIVER_CARD_INK, DriverCard, DriverCardStatus } from '../../ui/DriverCard';
import { CardLookup, DriverDetailView } from '../../ui/DriverDetailView';
import { inspectOnContextMenu, makeDriverInspectable } from '../../ui/cardInspect';
import { DriverCardData, driverCardData } from '../../ui/driverCardData';

const cards = (cardsFile as unknown as { cards: CardData[] }).cards;

/** The gallery's cards by type, as a screen's loaded cards would answer. */
const galleryCards: CardLookup = (type) => {
	const data = cards.find((entry) => entry.type === type);
	return data ? new GameCard({ ...data }) : null;
};

/** A caption under each card, wrapping inside this. */
const CAPTION_WIDTH = 112;

interface DriverCase {
	id: string;
	data: DriverCardData;
	caption: string;
	status?: DriverCardStatus;
	customDeck?: boolean;
	unavailable?: boolean;
}

/** The "Card sizes" board's four. */
const BOARD: readonly DriverCase[] = [
	{ id: 'ready', data: driverCardData({ archetype: 'road_warrior' }), caption: 'Ready' },
	{ id: 'hurt', data: driverCardData({ archetype: 'interceptor', hitpoints: 22 }), caption: 'Hurt, still able' },
	{ id: 'injured', data: driverCardData({ archetype: 'mechanic', hitpoints: 18 }), status: 'injured', unavailable: true, caption: 'Injured, can\'t go' },
	{ id: 'lost', data: driverCardData({ archetype: 'raider', hitpoints: 0, note: 'Killed day 9' }), status: 'lost', caption: 'Lost on a run' },
];

/** A seated Interceptor whose run deck borrowed a Medical Kit from the locker. */
const CUSTOMIZED = driverCardData({ archetype: 'interceptor', hitpoints: 22, deck: addCards(startingDeckCounts('interceptor'), 'medical_kit') });

/** The other tags, as the Crew roster, load out, and the debrief use them. */
const TAGS: readonly DriverCase[] = [
	{ id: 'new', data: driverCardData({ archetype: 'road_warrior', name: 'Road Warrior 2' }), status: 'new', caption: 'Found on a run' },
	{ id: 'crew_injured', data: driverCardData({ archetype: 'mechanic', hitpoints: 18 }), status: 'injured', caption: 'Injured, at the compound' },
	{ id: 'seat1', data: driverCardData({ archetype: 'raider' }), status: 'seat1', caption: 'In seat 1' },
	{ id: 'seat2_custom', data: CUSTOMIZED, status: 'seat2', customDeck: true, caption: 'In seat 2, customized' },
	{ id: 'custom', data: CUSTOMIZED, customDeck: true, caption: 'Seat 2\'s own card' },
	{ id: 'unavailable', data: driverCardData({ archetype: 'road_warrior' }), unavailable: true, caption: 'Same archetype as a seated driver' },
];

/**
 * The driver card (Game Flow 7.0, "Drivers and escorts are cards too") at
 * its real size in every state: the board's ready, hurt, injured, and lost,
 * then new, injured where they can still be worked on, seated, a seated
 * driver with a customized run deck, that seat's own card, and unavailable.
 * Each opens its detail view on hover, focus, or a touch hold, as every
 * card does.
 */
export class DriverCardsSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_driver_cards', title: 'Driver Cards', ...options });
		this.addRow('the "Card sizes" board: ready, hurt but able, injured where they can\'t go (faded), lost on a run (faded, how they went in the specialty\'s place)', this.row('dev_driver_cards_board', BOARD));
		this.addRow('tags: new, injured at the compound (not faded), seat 1, seat 2 with CUSTOM beside it, that seat\'s own card, unavailable (faded, no tag)', this.row('dev_driver_cards_tags', TAGS));
		inspectOnContextMenu(this);
	}

	/** Captioned cards side by side, spaced as a grid of minis is, which clears their tags. */
	private row(id: string, cases: readonly DriverCase[]): Stack {
		const row = new Stack({ id, direction: 'horizontal', gap: MINI_GRID.gap, margin: MINI_GRID.margin, focusGroup: { orientation: 'horizontal' } });
		for (const entry of cases) {
			const card = new DriverCard({
				id: `dev_driver_card_${entry.id}`,
				data: entry.data,
				status: entry.status ?? null,
				customDeck: entry.customDeck ?? false,
				unavailable: entry.unavailable ?? false,
			});
			card.focusable = true;
			makeDriverInspectable(card, { cards: galleryCards });
			const cell = new Stack({ gap: DRIVER_CARD_INK + tokens.space.space_2 });
			cell.addChild(card);
			cell.addChild(new Text({
				text: entry.caption,
				width: CAPTION_WIDTH,
				style: { fontSize: tokens.fontSize.fs_sm, color: 'text_dim' },
				wrap: 'word',
			}));
			row.addChild(cell);
		}
		return row;
	}
}

/**
 * A driver card's detail view as hover, focus, or a touch hold opens it:
 * full stats, then a starting deck of six kinds in one row.
 */
export class DriverDetailSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_driver_detail', title: 'Driver Detail View', ...options });
		this.addRow('full stats, then the deck as mini cards, cheapest first: a starting deck of six kinds in one row', new DriverDetailView({
			id: 'dev_driver_detail',
			data: driverCardData({ archetype: 'interceptor', hitpoints: 22 }),
			cards: galleryCards,
		}));
	}
}

/**
 * Pinned by a secondary click or I, for a campaign driver whose default
 * deck has grown to nine kinds: two rows, five and four.
 */
export class DriverDetailPinnedSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_driver_detail_pinned', title: 'Driver Detail View, Pinned', ...options });
		this.addRow('pinned; a campaign deck of nine kinds in two rows', new DriverDetailView({
			id: 'dev_driver_detail_pinned',
			data: driverCardData({
				archetype: 'road_warrior',
				name: 'Road Warrior 2',
				hitpoints: 31,
				deck: { ramming_speed: 4, armor_plating: 3, repair_kit: 2, nitro_boost: 2, ram: 1, medical_kit: 1, point_blank: 2, oil_slick: 1, caltrops: 1 },
			}),
			cards: galleryCards,
			pinned: true,
		}));
	}
}
