import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Component, ComponentOptions } from '../../../engine/components/Component';
import { Container } from '../../../engine/components/Container';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Vehicle } from '../../mechanics/Vehicle';
import type { Driver } from '../../mechanics/Driver';
import { RoadLane, RoadRow, RoadSlot, slotRange } from '../../mechanics/Road';
import type { AimPreview } from '../../mechanics/AimPreview';
import type { RangeLabel } from '../../ui/RangeChip';
import { galleryDriver } from './VehicleTokensSection';
import { COMBAT_REFERENCE_HEIGHT, COMBAT_REFERENCE_WIDTH, DOCK_HEIGHT, TOP_BAR_HEIGHT } from '../combat/CombatLayout';
import { CombatModel } from '../combat/CombatModel';
import { RoadView } from '../combat/RoadView';
import { AimReticle, HitCheckChip, TargetingArrow, hitCheckText } from '../combat/CombatFxLayer';

/** The road band at the 1280x720 reference, with a hand card standing beside it. */
const ROAD_WIDTH = COMBAT_REFERENCE_WIDTH;
const ROAD_HEIGHT = COMBAT_REFERENCE_HEIGHT - TOP_BAR_HEIGHT - DOCK_HEIGHT;
const CARD_WIDTH = 128;
const CARD_HEIGHT = 180;
const CARD_X = ROAD_WIDTH + 32;
const CARD_Y = ROAD_HEIGHT - CARD_HEIGHT - 12;
/** Room past the card for the hit check, which is wider than it. */
const FRAME_WIDTH = CARD_X + CARD_WIDTH + 64;
const FRAME_HEIGHT = ROAD_HEIGHT;
/** Headshot and Far Shoot reach two. */
const REACH = 2;

function vehicle(name: string, slot: RoadSlot, structure: [number, number], hp: [number, number]): Vehicle {
	return new Vehicle({
		name,
		structure: structure[0],
		maxStructure: structure[1],
		armor: 2,
		maxArmor: 2,
		baseSpeed: 3,
		slot,
		flank: null,
		velocity: 0,
		driver: galleryDriver(name, hp),
		passenger: null,
		statusEffects: [],
	});
}

/**
 * The frame at its reference size, scaled down to the width it's given
 * and never up, its height following, as the combat stage scales the whole
 * screen.
 */
class ScaledFrame extends Component {
	private readonly content: Component;

	constructor({ content, ...options }: ComponentOptions & { content: Component }) {
		super({ ...options, height: FRAME_HEIGHT, pointerEvents: 'passthrough' });
		this.content = content;
		this.addChild(content);
	}

	protected onResized(): void {
		const scale = Math.min(1, this.width / FRAME_WIDTH);
		this.content.transform = { scale, origin: [0, 0] };
		const height = Math.ceil(FRAME_HEIGHT * scale);
		if (height !== this.height) this.setSize(this.width, height);
	}
}

/**
 * A card dragged onto a raider, held still for a golden (DDB-138, Battle
 * Screen Design section 6): every raider's range chip from the Rig's slot,
 * the raiders out of reach dimmed, the ones in reach outlined in red
 * dashes, the one under the pointer in a solid outline with its glow and a
 * striped ghost on the bars the hit takes from, and the hit check riding
 * with the card, which stands beside the road here rather than in a dock.
 * The ranges come from the road's own `slotRange`, the chip's text from the
 * screen's own `hitCheckText`.
 */
export class CombatTargetingSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_combat_targeting', title: 'Combat Targeting', ...options });

		const seats = new Map<Driver, 1 | 2>();
		const model = new CombatModel();
		const road = new RoadView({ id: 'dev_targeting_road', width: ROAD_WIDTH, height: ROAD_HEIGHT, combatData: model, seatOf: (driver) => seats.get(driver) ?? null });

		const rig = vehicle('Apocalypse Rig', { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER }, [40, 40], [30, 30]);
		const bike = vehicle('Lightning Bike', { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.BEHIND }, [25, 25], [24, 24]);
		if (rig.driver) seats.set(rig.driver, 1);
		if (bike.driver) seats.set(bike.driver, 2);
		const buggy = vehicle('Rust Buggy', { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER }, [30, 30], [20, 20]);
		const crawler = vehicle('Dust Crawler', { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.BEHIND }, [22, 25], [20, 20]);
		const hauler = vehicle('Scrap Hauler', { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.AHEAD }, [40, 40], [35, 35]);
		const flanker = vehicle('Chain Hauler', { lane: RoadLane.PLAYER_SHOULDER, row: RoadRow.BEHIND }, [28, 30], [22, 22]);
		const raiders = [buggy, crawler, hauler, flanker];
		road.showVehicles({ player: [rig, bike], enemy: raiders });
		road.setVehicleIntents(buggy.id, [{ type: 'attack', value: 8, description: 'Ram', target: 'driver1' }]);
		road.setVehicleIntents(hauler.id, [{ type: 'attack', value: 12, description: 'Ram', target: 'driver2' }]);

		// Aimed from the Rig: in reach is a target, past it dims
		const source = rig.slot as RoadSlot;
		const labels = new Map<string, RangeLabel>();
		const targets: string[] = [];
		for (const raider of raiders) {
			const range = slotRange(source, raider.slot as RoadSlot);
			const inReach = range <= REACH;
			if (inReach) targets.push(raider.id);
			labels.set(raider.id, { text: inReach ? `R${range}` : 'OUT', legal: inReach });
		}
		model.isTargeting = true;
		model.targetableVehicleIds = targets;
		model.focusedVehicleId = buggy.id;
		road.showRanges(labels);

		// Headshot on the Buggy's driver: Gunnery 7 against Evade 4, harder by 2
		const preview: AimPreview = {
			actor: rig,
			range: slotRange(source, buggy.slot as RoadSlot),
			reach: REACH,
			lands: true,
			check: { skill: 'gunnery', attack: 7, evade: 4, modifier: 2, hits: true },
			losses: { structure: 0, driver: 6, passenger: 0 },
		};
		road.showDamageGhost(buggy.id, preview.losses);

		const frame = new Container({ id: 'dev_targeting_frame', width: FRAME_WIDTH, height: FRAME_HEIGHT });
		const card = new Rectangle({
			id: 'dev_targeting_card',
			x: CARD_X,
			y: CARD_Y,
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			style: { backgroundColor: '#1d1f22', borderColor: '#3cc3c9', borderWidth: 2, borderRadius: 6 },
		});
		const layer = new Container({ id: 'dev_targeting_fx', width: FRAME_WIDTH, height: FRAME_HEIGHT, pointerEvents: 'none', zIndex: 1 });
		const reticle = new AimReticle({ id: 'dev_targeting_reticle' });
		reticle.pinnedOnTarget = true;
		const token = road.vehicleView(buggy.id);
		// The pointer at the plate's top right, past the short name, so the
		// line and the ring leave the bars and their ghost in view
		if (token) {
			const plate = token.plateRect;
			const scale = token.tokenScale;
			reticle.setPosition(
				token.x + (plate.x + plate.width - 16) * scale - reticle.centre.x,
				token.y + (plate.y + 13) * scale - reticle.centre.y,
			);
		}
		const arrow = new TargetingArrow({ id: 'dev_targeting_line', reticle, width: FRAME_WIDTH, height: FRAME_HEIGHT });
		arrow.pinnedOnTarget = true;
		arrow.source = card;
		const hitCheck = new HitCheckChip({ id: 'dev_targeting_hit_check', width: FRAME_WIDTH, height: FRAME_HEIGHT });
		hitCheck.show(card, hitCheckText(preview));
		layer.addChild(arrow);
		layer.addChild(reticle);
		layer.addChild(hitCheck);
		frame.addChild(road);
		frame.addChild(card);
		frame.addChild(layer);

		this.addRow(
			'a card dragged onto a raider: ranges, out of reach dimmed, legal dashed, the target solid with its damage ghost, the hit check',
			new ScaledFrame({ id: 'dev_targeting_scaled', widthMode: 'fill', content: frame }),
			{ fill: true },
		);
	}
}
