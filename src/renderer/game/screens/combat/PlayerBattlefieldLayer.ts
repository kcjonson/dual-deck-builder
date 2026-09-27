import { BattlefieldLayer, BattlefieldLayerOptions, LaneDecor } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';

/**
 * Player-specific vehicle UI component
 */
class PlayerVehicle extends VehicleUI {
  protected getPortraitColor(): string {
    return '#4a5a4a'; // Player green tint
  }

  protected getBorderColor(): string {
    return '#6a8a6a'; // Player green border
  }
}

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

  /**
   * Get card dimensions for player vehicles
   */
  protected getCardWidth(): number {
    return 160;
  }

  protected getCardHeight(): number {
    return Math.floor(this.getHeight() * 0.6);
  }

  /**
   * Create a vehicle display component
   */
  protected createVehicleCard(vehicle: VehicleData): VehicleUI {
    return new PlayerVehicle({
      id: `player_vehicle_${this.slotId(vehicle)}`,
      x: 0,
      y: 0,
      width: this.getCardWidth(),
      height: this.getCardHeight(),
      vehicleData: vehicle,
      combatData: this.combatData || undefined,
      onClick: (v) => {
        // When clicked, attempt to target this vehicle
        this.combatData?.targetVehicle(v);
      }
    });
  }

  /**
   * Update an existing vehicle display
   */
  protected updateVehicleCard(vehicle: VehicleData, card: VehicleUI): void {
    // Just update the data, the Vehicle component handles the rest
    card.data = vehicle;
  }
}
