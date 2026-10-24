import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Container } from '../../../engine/components/Container';
import type { Driver } from '../../mechanics/Driver';
import type { Vehicle } from '../../mechanics/Vehicle';
import { RoadLane, RoadRow, RoadSlot, slotRange } from '../../mechanics/Road';
import type { AimPreview } from '../../mechanics/AimPreview';
import { cardRange } from '../../mechanics/BoardProjection';
import { Card as UICard } from '../../ui/Card';
import type { RangeLabel } from '../../ui/RangeChip';
import { COMBAT_REFERENCE_HEIGHT, COMBAT_REFERENCE_WIDTH, DOCK_HEIGHT, TOP_BAR_HEIGHT } from '../combat/CombatLayout';
import { CombatModel } from '../combat/CombatModel';
import { RoadView } from '../combat/RoadView';
import { AimReticle, HitCheckChip, TargetingArrow, hitCheckText } from '../combat/CombatFxLayer';
import { ScaledFrame, targetingVehicle } from './CombatTargetingSection';
import { sampleCard } from './CardDetailSection';

/** The road band at the 1280x720 reference, with the aimed card standing past its right end. */
const ROAD_WIDTH = COMBAT_REFERENCE_WIDTH;
const ROAD_HEIGHT = COMBAT_REFERENCE_HEIGHT - TOP_BAR_HEIGHT - DOCK_HEIGHT;
const { width: CARD_WIDTH, height: CARD_HEIGHT } = UICard.getDimensions();
const CARD_GAP = 32;
const CARD_X = ROAD_WIDTH + CARD_GAP;
const CARD_Y = ROAD_HEIGHT - CARD_HEIGHT - 12;
/** Room past the card for the hit check, which is wider than it. */
const FRAME_WIDTH = CARD_X + CARD_WIDTH + 64;
const FRAME_HEIGHT = ROAD_HEIGHT;
const { PLAYER_SHOULDER, PLAYER_OUTSIDE, PLAYER_INSIDE, ENEMY_INSIDE, ENEMY_OUTSIDE } = RoadLane;
const { AHEAD, CENTER, BEHIND } = RoadRow;

export type SlotTargetingMode = 'move' | 'shove';

/** A readout as the screen's hover gives it: "R1" or "R2" within `reach`, "OUT" past it. */
function readout(from: RoadSlot, at: RoadSlot, reach: number, legal: boolean): RangeLabel {
	const range = slotRange(from, at);
	return { text: range <= reach ? `R${range}` : 'OUT', legal: legal && range <= reach };
}

/**
 * Slot targeting held still (DDB-548, Battle Screen Design section 6),
 * one step a scene so each fits 1024x600:
 *
 * - `move`: Strafe dragged over the road, waiting for its slot. The Rig's
 *   two swerves that put a raider at Range 1 (the ambusher on your
 *   shoulder from outside center, the Crawler from inside ahead) are
 *   dashed in your yellow, the hovered one solid with the line and the
 *   reticle on it; the slot behind it (the Bike's) and the diagonals show
 *   nothing. Every raider reads its range from the hovered slot against
 *   Strafe's Range 1, red-edged where it could then be shot. The Buggy's
 *   pills are empty: the Ram it planned at the Rig can't reach the hovered
 *   slot, so the preview has dropped it.
 * - `shove`: Shoulder Check's second step. The Buggy it rams holds its
 *   solid outline and damage ghost, the hit check rides with the card,
 *   and the two rows it can be shoved into are dashed in the raiders' red,
 *   the hovered one solid and the Buggy's readout taken from there.
 *
 * The aimed card is the real one from cards.json (DDB-551), and its range
 * sets the readouts' reach. Model state is set by hand, as the targeting
 * scene's is; the readouts come from the road's own `slotRange`.
 */
export class SlotTargetingSection extends CatalogSection {
	constructor({ mode = 'move', ...options }: DeveloperSectionOptions & { mode?: SlotTargetingMode } = {}) {
		super({
			id: mode === 'move' ? 'dev_section_slot_targeting' : 'dev_section_slot_targeting_shove',
			title: mode === 'move' ? 'Slot Targeting' : 'Slot Targeting: Shove',
			...options,
		});

		const seats = new Map<Driver, 1 | 2>();
		const model = new CombatModel();
		const road = new RoadView({ id: `dev_slot_${mode}_road`, width: ROAD_WIDTH, height: ROAD_HEIGHT, combatData: model, seatOf: (driver) => seats.get(driver) ?? null });

		const rig = targetingVehicle('Apocalypse Rig', { lane: PLAYER_INSIDE, row: CENTER }, [40, 40], [30, 30]);
		const bike = targetingVehicle('Lightning Bike', { lane: PLAYER_INSIDE, row: BEHIND }, [25, 25], [24, 24]);
		if (rig.driver) seats.set(rig.driver, 1);
		if (bike.driver) seats.set(bike.driver, 2);
		const buggy = targetingVehicle('Rust Buggy', { lane: ENEMY_INSIDE, row: CENTER }, [30, 30], [20, 20]);
		const crawler = targetingVehicle('Dust Crawler', mode === 'move' ? { lane: ENEMY_INSIDE, row: AHEAD } : { lane: ENEMY_OUTSIDE, row: AHEAD }, [22, 25], [20, 20]);
		const hauler = targetingVehicle('Scrap Hauler', { lane: ENEMY_OUTSIDE, row: BEHIND }, [40, 40], [35, 35]);
		const raiders = [buggy, crawler, hauler];
		// An ambusher on your shoulder, in reach of Strafe from outside center
		if (mode === 'move') raiders.push(targetingVehicle('Chain Hauler', { lane: PLAYER_SHOULDER, row: CENTER }, [28, 30], [22, 22]));
		road.showVehicles({ player: [rig, bike], enemy: raiders });
		road.setVehicleIntents(crawler.id, [{ type: 'attack', value: 6, description: 'Point Blank', target: 'driver1' }]);
		road.setVehicleIntents(hauler.id, [{ type: 'buff', valueText: 'Fast', description: 'Nitro' }]);

		const frame = new Container({ id: `dev_slot_${mode}_frame`, width: FRAME_WIDTH, height: FRAME_HEIGHT });
		frame.addChild(road);
		const aimed = sampleCard(mode === 'move' ? 'strafe' : 'shoulder_check');
		const reach = cardRange(aimed);
		if (reach === null) throw new Error(`${aimed.name} has no range for its readouts`);
		const card = new UICard({ id: `dev_slot_${mode}_card`, x: CARD_X, y: CARD_Y, data: aimed, driverNumber: 1 });
		frame.addChild(card);
		const layer = new Container({ id: `dev_slot_${mode}_fx`, width: FRAME_WIDTH, height: FRAME_HEIGHT, pointerEvents: 'none', zIndex: 1 });
		frame.addChild(layer);

		if (mode === 'move') this.aimMove({ model, road, raiders, card, reach, layer });
		else this.aimShove({ model, road, rig, buggy, raiders, card, reach, layer });

		this.addRow(
			mode === 'move'
				? 'Strafe waiting for its slot: the swerves that put a raider in reach dashed, the hovered one solid, each raider\'s range from there, and the Buggy\'s pills empty, its Ram out of reach of that slot'
				: 'Shoulder Check\'s second step: the Buggy held with its ghost, the hit check on the card, and the two rows it can be shoved into',
			new ScaledFrame({ id: `dev_slot_${mode}_scaled`, widthMode: 'fill', content: frame, frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT }),
			{ fill: true },
		);
	}

	private aimMove({ model, road, raiders, card, reach, layer }: {
		model: CombatModel;
		road: RoadView;
		raiders: Vehicle[];
		card: UICard;
		reach: number;
		layer: Container;
	}): void {
		const hovered: RoadSlot = { lane: PLAYER_INSIDE, row: AHEAD };
		const slots: RoadSlot[] = [{ lane: PLAYER_OUTSIDE, row: CENTER }, hovered];
		model.isTargeting = true;
		model.targetableSlots = slots;
		model.focusedSlot = hovered;
		road.showSlotTargets({ slots, picked: null });

		// Strafe reaches one from where it lands; only the Crawler, a row ahead across, is in reach
		const labels = new Map<string, RangeLabel>();
		for (const raider of raiders) labels.set(raider.id, readout(hovered, raider.slot as RoadSlot, reach, true));
		road.showRanges(labels);

		// The drag's line and reticle, the reticle in the hovered slot's middle
		const reticle = new AimReticle({ id: 'dev_slot_move_reticle' });
		reticle.pinnedOnTarget = true;
		const cell = road.slotRect(hovered);
		reticle.setPosition(cell.x + cell.width / 2 - reticle.centre.x, cell.y + cell.height / 2 - reticle.centre.y);
		const arrow = new TargetingArrow({ id: 'dev_slot_move_line', reticle, width: FRAME_WIDTH, height: FRAME_HEIGHT });
		arrow.pinnedOnTarget = true;
		arrow.source = card;
		layer.addChild(arrow);
		layer.addChild(reticle);
	}

	private aimShove({ model, road, rig, buggy, raiders, card, reach, layer }: {
		model: CombatModel;
		road: RoadView;
		rig: Vehicle;
		buggy: Vehicle;
		raiders: Vehicle[];
		card: UICard;
		reach: number;
		layer: Container;
	}): void {
		const hovered: RoadSlot = { lane: ENEMY_INSIDE, row: BEHIND };
		const slots: RoadSlot[] = [{ lane: ENEMY_INSIDE, row: AHEAD }, hovered];
		model.isTargeting = true;
		model.targetableSlots = slots;
		model.pickedVehicleId = buggy.id;
		model.focusedSlot = hovered;
		road.showSlotTargets({ slots, picked: null });

		// Read from the Rig, with the Buggy where the shove would put it
		const from = rig.slot as RoadSlot;
		const labels = new Map<string, RangeLabel>();
		for (const raider of raiders) labels.set(raider.id, readout(from, raider === buggy ? hovered : raider.slot as RoadSlot, reach, false));
		road.showRanges(labels);

		// Ramming 5 against Evade 4: the ram lands, so the shove follows
		const preview: AimPreview = {
			actor: rig,
			range: slotRange(from, buggy.slot as RoadSlot),
			reach,
			lands: true,
			check: { skill: 'ramming', attack: 5, evade: 4, modifier: 0, hits: true },
			losses: { structure: 2, driver: 1, passenger: 0 },
		};
		road.showDamageGhost(buggy.id, preview.losses);
		const hitCheck = new HitCheckChip({ id: 'dev_slot_shove_hit_check', width: FRAME_WIDTH, height: FRAME_HEIGHT });
		hitCheck.show(card, hitCheckText(preview));
		layer.addChild(hitCheck);
	}
}
