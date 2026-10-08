import { CatalogSection } from '../../renderer/game/screens/developer/CatalogSection';
import { sampleCard } from '../../renderer/game/screens/developer/CardDetailSection';
import { Stack } from '../../renderer/engine/components/Stack';
import { tokens } from '../../renderer/engine/theme/tokens';
import { DRIVER_CONFIGS } from '../../renderer/game/mechanics/Driver';
import { EscortType, convertToEscort, createEscort } from '../../renderer/game/mechanics/Escort';
import { Vehicle } from '../../renderer/game/mechanics/Vehicle';
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

/**
 * The Road Warrior's Apocalypse Rig after its driver died with nobody to
 * take the wheel, carrying on in the convoy (escorts.md, decisions 11 and
 * 33): it keeps its name and structure and brings no card.
 */
function unmannedRig(structure: number): EscortCardData {
	const { metadata, vehicleStats } = DRIVER_CONFIGS.road_warrior;
	const rig = new Vehicle({
		name: metadata.vehicleName,
		armor: vehicleStats.armor,
		maxArmor: vehicleStats.armor,
		structure,
		maxStructure: vehicleStats.maxStructure,
		baseSpeed: vehicleStats.speed,
		slot: null,
		flank: null,
		velocity: 0,
		driver: null,
		passenger: null,
		statusEffects: [],
	});
	convertToEscort(rig);
	return escortCardDataOf(rig);
}

/** A convoy escort that ended a fight on this much structure, mapped as load out and the garage will. */
function damaged(type: EscortType, structure: number): EscortCardData {
	const escort = createEscort({ type });
	escort.structure = structure;
	return escortCardDataOf(escort);
}

/** The "Card sizes" board's two, then each other type, an unmanned vehicle, and one selected. */
const CONVOY: readonly EscortCase[] = [
	{ id: 'coming', data: damaged('fuel_hauler', 18), caption: 'Coming on this run' },
	{ id: 'staying', data: damaged('outrider', 9), staying: true, caption: 'Left at home' },
	{ id: 'pilot_car', data: escortCardData({ type: 'pilot_car' }), caption: 'Pilot Car, whole' },
	{ id: 'med_truck', data: damaged('med_truck', 12), caption: 'Med Truck, hurt' },
	{ id: 'unmanned', data: unmannedRig(31), caption: 'Unmanned, brings no card' },
	{ id: 'selected', data: escortCardData({ type: 'pilot_car' }), selected: true, caption: 'Selected' },
];

export type EscortCardSceneMode = 'cards' | 'detail' | 'detail-pinned';

/**
 * The escort card (Game Flow 7.0, "Drivers and escorts are cards too") and
 * its detail view, one scene a state so each fits 1024x600: the cards
 * every way load out, the garage's convoy strip, and an event's offer show
 * them; the detail view as hover, focus, or a touch hold opens it, with a
 * signature card and without one; and pinned.
 *
 * Gallery only: the developer sections list is another task's to edit, and
 * a scene here is the same panel the developer screen would host.
 */
export class EscortCardScene extends CatalogSection {
	constructor({ mode, x, y, width }: SceneFactoryOptions & { mode: EscortCardSceneMode }) {
		const titles: Record<EscortCardSceneMode, string> = { 'cards': 'Escort Cards', 'detail': 'Escort Detail View', 'detail-pinned': 'Escort Detail View, Pinned' };
		super({ id: `gallery_scene_escort_${mode.replace('-', '_')}`, title: titles[mode], x, y, width });
		switch (mode) {
			case 'cards':
				this.addRow('the board: coming on this run, left at home (faded, STAYING); a Pilot Car whole, a Med Truck hurt, an unmanned vehicle carrying on, and one selected', this.convoy());
				inspectOnContextMenu(this);
				break;
			case 'detail':
			{
				const views = new Stack({ direction: 'horizontal', gap: tokens.space.space_6 });
				views.addChild(new EscortDetailView({ id: 'gallery_escort_detail', data: damaged('fuel_hauler', 18), cards: galleryCards }));
				views.addChild(new EscortDetailView({ id: 'gallery_escort_detail_unmanned', data: unmannedRig(31), cards: galleryCards }));
				this.addRow('the profile and the signature card it brings; a vehicle carrying on unmanned brings none', views);
				break;
			}
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
