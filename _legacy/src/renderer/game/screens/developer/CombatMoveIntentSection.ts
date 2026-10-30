import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import type { Driver } from '../../mechanics/Driver';
import { RoadLane, RoadRow } from '../../mechanics/Road';
import { RoadView } from '../combat/RoadView';
import { ROAD_HEIGHT, ROAD_WIDTH, ScaledRoad, roadVehicle } from './CombatRoadSection';

/**
 * A raider's planned swerve on the road (DDB-546, call 288): the move pill
 * with the swerve icon, and its destination slot outlined in the raiders'
 * red. The Rust Buggy plans Lane Change into the inside lane and then a
 * shot at the Rig it lines up; the Scrap Hauler plans a Strafe, whose
 * attack pill leads with the swerve icon and whose slot is outlined too;
 * the Dust Crawler stays put, for contrast.
 */
export class CombatMoveIntentSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_combat_move_intent', title: 'Combat Move Intent', ...options });

		const seats = new Map<Driver, 1 | 2>();
		const road = new RoadView({ id: 'dev_combat_move_road', width: ROAD_WIDTH, height: ROAD_HEIGHT, seatOf: (driver) => seats.get(driver) ?? null });
		const rig = roadVehicle('Apocalypse Rig', { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.CENTER }, 40);
		const bike = roadVehicle('Lightning Bike', { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.BEHIND }, 25);
		if (rig.driver) seats.set(rig.driver, 1);
		if (bike.driver) seats.set(bike.driver, 2);
		const buggy = roadVehicle('Rust Buggy', { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.CENTER }, 30);
		const hauler = roadVehicle('Scrap Hauler', { lane: RoadLane.ENEMY_OUTSIDE, row: RoadRow.BEHIND }, 40);
		const crawler = roadVehicle('Dust Crawler', { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.AHEAD }, 22);
		road.showVehicles({ player: [rig, bike], enemy: [buggy, hauler, crawler] });

		road.setVehicleIntents(buggy.id, [
			{ type: 'move', description: 'Lane Change', detail: 'Swerves to enemy inside, center', destination: { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.CENTER } },
			{ type: 'attack', value: 4, description: 'Point Blank', detail: '4 damage on Apocalypse Rig', target: 'driver1' },
		]);
		road.setVehicleIntents(hauler.id, [
			{
				type: 'attack',
				value: 4,
				description: 'Strafe',
				detail: '4 damage on Lightning Bike, after it swerves to enemy inside, behind',
				target: 'driver2',
				destination: { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.BEHIND },
			},
		]);
		road.setVehicleIntents(crawler.id, [{ type: 'attack', value: 5, description: 'Shoot', target: 'driver1' }]);

		this.addRow(
			'a move pill and a swerving attack, each destination outlined in raider red',
			new ScaledRoad({ id: 'dev_combat_move_road_frame', widthMode: 'fill', road }),
			{ fill: true },
		);
	}
}
