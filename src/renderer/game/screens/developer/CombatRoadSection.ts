import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Component, ComponentOptions } from '../../../engine/components/Component';
import { Vehicle } from '../../mechanics/Vehicle';
import type { Driver } from '../../mechanics/Driver';
import { createEscort } from '../../mechanics/Escort';
import { galleryDriver } from './VehicleTokensSection';
import { RoadLane, RoadRow, RoadSlot } from '../../mechanics/Road';
import { COMBAT_REFERENCE_HEIGHT, COMBAT_REFERENCE_WIDTH, DOCK_HEIGHT, TOP_BAR_HEIGHT } from '../combat/CombatLayout';
import { RoadView } from '../combat/RoadView';

/** The road band at the 1280x720 reference. */
const ROAD_WIDTH = COMBAT_REFERENCE_WIDTH;
const ROAD_HEIGHT = COMBAT_REFERENCE_HEIGHT - TOP_BAR_HEIGHT - DOCK_HEIGHT;

/** A driven vehicle; its driver's name is the vehicle's, which only the tooltip shows. */
function vehicle(name: string, slot: RoadSlot, structure: number): Vehicle {
	return new Vehicle({
		name,
		structure,
		maxStructure: 40,
		armor: 4,
		maxArmor: 4,
		baseSpeed: 3,
		slot,
		flank: null,
		velocity: 0,
		driver: galleryDriver(name, [30, 30]),
		passenger: null,
		statusEffects: [],
	});
}

/** An escort at a slot, as the convoy places one. */
function escort(name: string, slot: RoadSlot): Vehicle {
	const truck = createEscort({ type: 'fuel_hauler' });
	truck.set({ name, slot });
	return truck;
}

/**
 * The road at the reference size in a frame as tall, scaled down to the
 * width it's given and never up, as the combat stage scales the whole
 * screen: the gallery shows it at x1, the developer screen's narrower
 * column shrinks it whole rather than squeezing its slots.
 */
class ScaledRoad extends Component {
	private readonly road: RoadView;

	constructor({ road, ...options }: ComponentOptions & { road: RoadView }) {
		super({ ...options, height: ROAD_HEIGHT, pointerEvents: 'passthrough' });
		this.road = road;
		this.addChild(road);
	}

	protected onResized(): void {
		this.road.transform = { scale: Math.min(1, this.width / ROAD_WIDTH), origin: [0, 0] };
	}
}

/**
 * The battle screen's road held still for a golden (DDB-134): the lane
 * header, the row gutter, both shoulders' tints with a flanker on each,
 * the yellow centre line, and faint dashed outlines in the empty slots.
 * Your Rig holds the inside lane and an escort the outside; the Interceptor
 * has outrun the raider in the centre row onto the raiders' shoulder, and a
 * raider has done the same to your escort in the behind row.
 */
export class CombatRoadSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_combat_road', title: 'Combat Road', ...options });

		const seats = new Map<Driver, 1 | 2>();
		const road = new RoadView({ id: 'dev_combat_road', width: ROAD_WIDTH, height: ROAD_HEIGHT, seatOf: (driver) => seats.get(driver) ?? null });
		const rig = vehicle('Apocalypse Rig', { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER }, 40);
		const bike = vehicle('Lightning Bike', { lane: RoadLane.ENEMY_SHOULDER, row: RoadRow.CENTER }, 25);
		if (rig.driver) seats.set(rig.driver, 1);
		if (bike.driver) seats.set(bike.driver, 2);
		const looter = vehicle('Rust Buggy', { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER }, 30);
		const brute = vehicle('Scrap Hauler', { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.AHEAD }, 40);
		const flanker = vehicle('Dust Crawler', { lane: RoadLane.PLAYER_SHOULDER, row: RoadRow.BEHIND }, 22);
		road.showVehicles({
			player: [rig, escort('Convoy Truck', { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.BEHIND }), bike],
			enemy: [looter, brute, flanker],
		});
		road.setVehicleIntents(looter.id, [
			{ type: 'attack', value: 8, description: 'Ram', target: 'driver1' },
			{ type: 'defend', value: 5, description: 'Brace' },
			{ type: 'attack', value: 4, description: 'Shoot', target: 'driver2' },
		]);
		road.setVehicleIntents(brute.id, [{ type: 'attack', value: 15, description: 'Ram', target: 'both' }]);
		road.setVehicleIntents(flanker.id, [{ type: 'debuff', description: 'Spikes', target: 'escort' }]);

		this.addRow(
			'six lanes by three rows, a flanker on each shoulder, empty slots outlined',
			new ScaledRoad({ id: 'dev_combat_road_frame', widthMode: 'fill', road }),
			{ fill: true },
		);
	}
}
