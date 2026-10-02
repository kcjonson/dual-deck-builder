import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { sampleCard } from './CardDetailSection';
import type { Card as GameCard } from '../../mechanics/Card';
import type { VehicleMod } from '../../mechanics/Vehicle';
import { COMBAT_REFERENCE_WIDTH } from '../combat/CombatLayout';
import { CombatDock } from '../combat/CombatDock';
import type { DriverResourceData } from '../combat/DriverTab';
import type { DriverSeat } from '../combat/PlayerHandView';

const SIX_MODS: VehicleMod[] = [
	{ name: 'Reactive Armor', kind: 'defense' },
	{ name: 'Spiked Bumper', kind: 'offense' },
	{ name: 'Expanded Tank', kind: 'utility' },
	{ name: 'Flamethrower', kind: 'offense' },
	{ name: 'Nitrous System', kind: 'utility' },
	{ name: 'Card Printer', kind: 'utility' },
];

const FOUR_MODS: VehicleMod[] = [
	{ name: 'Shield Generator', kind: 'defense' },
	{ name: 'Turret Mount', kind: 'offense' },
	{ name: 'Auto-Repair', kind: 'defense' },
	{ name: 'Nitrous System', kind: 'utility' },
];

interface GalleryHalf {
	cards: string[];
	tab: Partial<DriverResourceData>;
	/** Card types its driver can't play now: a passenger's attacks. */
	blocked?: string[];
}

/**
 * The real dock at x1, the column's width up to the 1280 reference, with
 * each driver's tab and hand dealt as a fight would deal them. Cards cost
 * more than their driver has dim with a red cost (section 6).
 */
function galleryDock({ id, halves, turn }: { id: string; halves: Record<DriverSeat, GalleryHalf>; turn: number }): CombatDock {
	const dock = new CombatDock({ id, widthMode: 'fill', maxSize: { width: COMBAT_REFERENCE_WIDTH }, onEndTurn: () => undefined });
	const cards: GameCard[] = [];
	const seatOf = new Map<string, DriverSeat>();
	const playable = new Set<string>();
	const unaffordable = new Set<string>();
	let unspent = 0;
	for (const seat of [1, 2] as const) {
		const { cards: types, tab, blocked = [] } = halves[seat];
		const adrenaline = tab.adrenaline ?? 0;
		if (!tab.crashedOut) unspent += adrenaline;
		for (const type of types) {
			const card = sampleCard(type);
			cards.push(card);
			seatOf.set(card.id, seat);
			if (card.cost > adrenaline) unaffordable.add(card.id);
			else if (!blocked.includes(type)) playable.add(card.id);
		}
		dock.hand.setDriverData(seat, tab);
	}
	dock.hand.hand = { cards, seatOf, playable, unaffordable };
	dock.endTurnColumn.show({ turn, playerTurn: true, waiting: false, unspentAdrenaline: unspent });
	return dock;
}

/**
 * Section 4's worst case for the dock (DDB-136): both hands at the cap of
 * seven, overlapping to about 68 px a card; driver 1 with six mods (three
 * icons and "+3") and a maximum past six (one bolt and the count); driver 2
 * with four mods and two of five bolts lit, so their dearer cards dim.
 */
export class CombatDockSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_combat_dock', title: 'Combat Dock', ...options });
		const dock = galleryDock({
			id: 'dev_combat_dock',
			turn: 4,
			halves: {
				1: {
					cards: ['coordinated_attack', 'point_blank', 'headshot', 'armor_plating', 'nitro_boost', 'ramming_speed', 'precision_shot'],
					tab: { name: 'The Road Warrior', adrenaline: 7, maxAdrenaline: 8, drawPileCount: 24, discardPileCount: 17, mods: SIX_MODS },
				},
				2: {
					cards: ['far_shoot', 'oil_slick', 'caltrops', 'repair_kit', 'emp_blast', 'flanking_maneuver', 'medical_kit'],
					tab: { name: 'The Interceptor', adrenaline: 2, maxAdrenaline: 5, drawPileCount: 9, discardPileCount: 3, mods: FOUR_MODS },
				},
			},
		});
		this.addRow('both hands at the cap of seven; six mods as three and +3, adrenaline past six as one bolt; four mods, two of five bolts lit', dock, { fill: true });
	}
}

/**
 * The dock after a wreck (DDB-136, DDB-167): driver 1 rides on as a
 * passenger, with no mods and their attacks unplayable; driver 2 had no
 * free seat and crashed out, so their half has no hand.
 */
export class CombatDockCrashedOutSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_combat_dock_crashed_out', title: 'Combat Dock: Passenger and Crashed Out', ...options });
		const dock = galleryDock({
			id: 'dev_combat_dock_crashed_out',
			turn: 6,
			halves: {
				1: {
					cards: ['ramming_speed', 'armor_plating', 'medical_kit', 'repair_kit', 'point_blank'],
					blocked: ['ramming_speed', 'point_blank'],
					tab: { name: 'The Road Warrior', adrenaline: 5, maxAdrenaline: 5, drawPileCount: 12, discardPileCount: 8, passenger: true, mods: SIX_MODS },
				},
				2: {
					cards: [],
					tab: { name: 'The Interceptor', adrenaline: 3, maxAdrenaline: 5, drawPileCount: 11, discardPileCount: 6, crashedOut: true, mods: FOUR_MODS },
				},
			},
		});
		this.addRow('a passenger tab with no mods and their attacks blocked; a driver crashed out with no hand', dock, { fill: true });
	}
}
