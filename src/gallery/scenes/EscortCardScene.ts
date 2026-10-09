import { CatalogSection } from '../../renderer/game/screens/developer/CatalogSection';
import { sampleCard } from '../../renderer/game/screens/developer/CardDetailSection';
import type { Stack } from '../../renderer/engine/components/Stack';
import { EscortType, createEscort } from '../../renderer/game/mechanics/Escort';
import type { CardLookup } from '../../renderer/game/ui/DriverDetailView';
import { ESCORT_CARD_INK, EscortCard } from '../../renderer/game/ui/EscortCard';
import { EscortDetailView } from '../../renderer/game/ui/EscortDetailView';
import { inspectOnContextMenu, makeEscortInspectable } from '../../renderer/game/ui/cardInspect';
import { EscortCardData, escortCardData, escortCardDataOf } from '../../renderer/game/ui/escortCardData';
import type { SceneFactoryOptions } from '../registry';

/** The gallery's cards by type; a type it doesn't have is a typo here, so it throws rather than leaving a card out. */
const galleryCards: CardLookup = sampleCard;

/** A caption under each card, wrapping inside this, as a mini's does. */
const CAPTION_WIDTH = 96;

interface EscortCase {
	id: string;
	data: EscortCardData;
	caption: string;
	staying?: boolean;
	selected?: boolean;
}

/** A convoy escort that ended a fight on this much structure, mapped as load out and the garage will. */
function damaged(type: EscortType, structure: number): EscortCardData {
	const escort = createEscort({ type });
	escort.structure = structure;
	return escortCardDataOf(escort);
}

/** The "Card sizes" board's two, then each other type, and one selected. */
const CONVOY: readonly EscortCase[] = [
	{ id: 'coming', data: damaged('fuel_hauler', 18), caption: 'Coming on this run' },
	{ id: 'staying', data: damaged('outrider', 9), staying: true, caption: 'Left at home' },
	{ id: 'pilot_car', data: escortCardData({ type: 'pilot_car' }), caption: 'Pilot Car, whole' },
	{ id: 'med_truck', data: damaged('med_truck', 12), caption: 'Med Truck, hurt' },
	{ id: 'selected', data: escortCardData({ type: 'pilot_car' }), selected: true, caption: 'Selected' },
];

export type EscortCardSceneMode = 'cards' | 'detail' | 'detail-pinned';

const TITLES: Readonly<Record<EscortCardSceneMode, string>> = { 'cards': 'Escort Cards', 'detail': 'Escort Detail View', 'detail-pinned': 'Escort Detail View, Pinned' };

/**
 * The escort card (Game Flow 7.0, "Drivers and escorts are cards too") and
 * its detail view, one scene a state so each fits 1024x600: the cards
 * every way load out, the garage's convoy strip, and an event's offer show
 * them; the detail view as hover, focus, or a touch hold opens it; and
 * pinned.
 */
export class EscortCardScene extends CatalogSection {
	constructor({ mode, x, y, width }: SceneFactoryOptions & { mode: EscortCardSceneMode }) {
		super({ id: `gallery_scene_escort_${mode.replace(/-/g, '_')}`, title: TITLES[mode], x, y, width });
		switch (mode) {
			case 'cards':
				this.addRow('the board: coming on this run, left at home (faded, STAYING); a Pilot Car whole, a Med Truck hurt, and one selected', this.convoy());
				inspectOnContextMenu(this);
				break;
			case 'detail':
				this.addRow('the profile, and the signature card it brings', new EscortDetailView({ id: 'gallery_escort_detail', data: damaged('fuel_hauler', 18), cards: galleryCards }));
				break;
			case 'detail-pinned':
				this.addRow('pinned: a gun escort, hurt', new EscortDetailView({ id: 'gallery_escort_detail_pinned', data: damaged('outrider', 9), cards: galleryCards, pinned: true }));
				break;
		}
	}

	/** Every case, captioned and inspectable, spaced as a grid of minis is. */
	private convoy(): Stack {
		const cells = CONVOY.map((entry) => {
			const card = new EscortCard({ id: `gallery_escort_card_${entry.id}`, data: entry.data, cards: galleryCards, staying: entry.staying ?? false });
			card.focusable = true;
			card.selected = entry.selected ?? false;
			makeEscortInspectable(card);
			return { item: card, caption: entry.caption };
		});
		return this.captionedRow({ id: 'gallery_escort_cards', cells, ink: ESCORT_CARD_INK, captionWidth: CAPTION_WIDTH });
	}
}
