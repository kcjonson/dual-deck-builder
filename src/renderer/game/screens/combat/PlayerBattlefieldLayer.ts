import { BattlefieldLayer, BattlefieldLayerOptions, LaneDecor } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';

const PLAYER_LANE_DECOR: LaneDecor = {
	backgroundColor: '#3a2a1a', // Dusty battlefield color
	dividerColor: '#4a3a2a',
	labelColor: '#8a7a6a',
	labels: ['FLANKING', 'BACK', 'FRONT'],
};

/**
 * Player battlefield display layer
 * Shows player vehicles with targeting support
 */
export class PlayerBattlefieldLayer extends BattlefieldLayer {
	constructor(options: BattlefieldLayerOptions) {
		super({ ...options, laneDecor: PLAYER_LANE_DECOR });
	}

	protected createVehicleCard(vehicle: VehicleData): VehicleUI {
		return new VehicleUI({
			id: `player_vehicle_${this.slotId(vehicle)}`,
			vehicleData: vehicle,
			side: 'player',
			seatOf: this.seatOf,
			combatData: this.combatData || undefined,
			onClick: (v) => {
				this.combatData?.targetVehicle(v);
			}
		});
	}

	protected updateVehicleCard(vehicle: VehicleData, card: VehicleUI): void {
		card.data = vehicle;
	}
}
