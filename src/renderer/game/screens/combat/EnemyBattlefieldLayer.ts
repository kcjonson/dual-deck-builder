import { BattlefieldLayer, BattlefieldLayerOptions, LaneDecor } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';
import type { EnemyIntent, IntentRow } from '../../ui/IntentMarker';

export type { EnemyIntent, IntentType } from '../../ui/IntentMarker';

// Columns mirrored from the player's
const ENEMY_LANE_DECOR: LaneDecor = {
	backgroundColor: '#2a1a1a', // Dark enemy battlefield
	dividerColor: '#3a2a2a',
	labelColor: '#8a6a6a',
	labels: ['FRONT', 'BACK', 'FLANKING'],
};

/**
 * Enemy battlefield display layer
 * Shows enemy vehicles with intent indicators
 */
export class EnemyBattlefieldLayer extends BattlefieldLayer {
	// Each raider's planned intents, by vehicle id, kept for a token made after the plan
	private vehicleIntents: Map<string, readonly EnemyIntent[]> = new Map();

	constructor(options: BattlefieldLayerOptions) {
		super({ ...options, laneDecor: ENEMY_LANE_DECOR });
	}

	protected createVehicleCard(vehicle: VehicleData): VehicleUI {
		const token = new VehicleUI({
			id: `enemy_vehicle_${this.slotId(vehicle)}`,
			vehicleData: vehicle,
			side: 'raider',
			combatData: this.combatData || undefined,
			onClick: (v) => {
				this.combatData?.targetVehicle(v);
			}
		});
		token.intents = this.vehicleIntents.get(vehicle.id) ?? [];
		return token;
	}

	protected updateVehicleCard(vehicle: VehicleData, card: VehicleUI): void {
		card.data = vehicle;
	}

	/** A raider's plan for the enemy turn, in order; empty clears it. */
	public setVehicleIntents(vehicleId: string, intents: readonly EnemyIntent[]): void {
		if (intents.length === 0) this.vehicleIntents.delete(vehicleId);
		else this.vehicleIntents.set(vehicleId, intents);
		const token = this.vehicleCards.get(vehicleId);
		if (token) token.intents = intents;
	}

	/** The row showing a raider's plan, inside its token, while the raider is on the road. */
	public intentRowOf(vehicleId: string): IntentRow | null {
		return this.vehicleCards.get(vehicleId)?.intentsRow ?? null;
	}
}
