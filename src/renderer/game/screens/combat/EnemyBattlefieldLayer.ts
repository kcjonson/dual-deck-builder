import { BattlefieldLayer, BattlefieldLayerOptions, LaneDecor } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI, VehicleOptions } from '../../ui/Vehicle';
import { EnemyIntent, IntentRow } from '../../ui/IntentMarker';

export type { EnemyIntent, IntentType } from '../../ui/IntentMarker';

const INTENT_MARKER_SIZE = 30;
const INTENT_INSET = 6;

/**
 * Enemy-specific vehicle UI component
 */
class EnemyVehicle extends VehicleUI {
	private readonly intentRow: IntentRow;

	constructor(options: VehicleOptions) {
		super(options);
		// Beside the plate's top right corner, outside it, so a plan of
		// three never covers the driver's name or the lane label above
		this.intentRow = new IntentRow({
			id: options.id ? `${options.id}_intents` : undefined,
			markerSize: INTENT_MARKER_SIZE,
			positioned: 'absolute',
			anchor: 'topRight',
			pivot: 'topLeft',
			x: INTENT_INSET,
			zIndex: 1,
		});
		this.addChild(this.intentRow);
	}

	protected getPortraitColor(): string {
		return '#4a3a3a'; // Enemy red tint
	}

	protected getBorderColor(): string {
		return '#6a5a5a'; // Enemy red border
	}

	/** Everything the raider plans this turn, in order. */
	public setIntents(intents: readonly EnemyIntent[]): void {
		this.intentRow.intents = intents;
	}
}

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
	// Each raider's planned intents, by vehicle id
	private vehicleIntents: Map<string, readonly EnemyIntent[]> = new Map();

	constructor(options: BattlefieldLayerOptions) {
		super({ ...options, laneDecor: ENEMY_LANE_DECOR });
	}

	/**
	 * Get card dimensions for enemy vehicles
	 */
	protected getCardWidth(): number {
		return 140; // Slightly smaller than player vehicles
	}

	protected getCardHeight(): number {
		return Math.floor(this.getHeight() * 0.55); // Slightly smaller
	}

	/**
	 * Create a vehicle display component
	 */
	protected createVehicleCard(vehicle: VehicleData): VehicleUI {
		const enemyVehicle = new EnemyVehicle({
			id: `enemy_vehicle_${this.slotId(vehicle)}`,
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
		enemyVehicle.setIntents(this.vehicleIntents.get(vehicle.id) ?? []);
		return enemyVehicle;
	}

	/**
	 * Update an existing vehicle display
	 */
	protected updateVehicleCard(vehicle: VehicleData, card: VehicleUI): void {
		card.data = vehicle;
		if (card instanceof EnemyVehicle) card.setIntents(this.vehicleIntents.get(vehicle.id) ?? []);
	}

	/** A raider's plan for the enemy turn, in order; empty clears it. */
	public setVehicleIntents(vehicleId: string, intents: readonly EnemyIntent[]): void {
		if (intents.length === 0) this.vehicleIntents.delete(vehicleId);
		else this.vehicleIntents.set(vehicleId, intents);
		const card = this.vehicleCards.get(vehicleId);
		if (card instanceof EnemyVehicle) card.setIntents(intents);
	}
}
