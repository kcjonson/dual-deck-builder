import { BattlefieldLayer, BattlefieldLayerOptions, LaneDecor } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI, VehicleOptions } from '../../ui/Vehicle';
import { EnemyIntent, IntentMarker } from '../../ui/IntentMarker';

export type { EnemyIntent, IntentType } from '../../ui/IntentMarker';

/**
 * Enemy-specific vehicle UI component
 */
class EnemyVehicle extends VehicleUI {
	private intentMarker: IntentMarker;

	constructor(options: VehicleOptions) {
		super(options);
		this.intentMarker = new IntentMarker({ size: 30 });
		this.addChild(this.intentMarker);
	}

	protected placeElements(): void {
		super.placeElements();
		this.intentMarker.setPosition(Math.floor(this.getWidth() * 0.7), Math.floor(this.getHeight() * 0.05));
	}

	protected getPortraitColor(): string {
		return '#4a3a3a'; // Enemy red tint
	}

	protected getBorderColor(): string {
		return '#6a5a5a'; // Enemy red border
	}

	/**
	 * Set enemy intent
	 */
	public setIntent(intent: EnemyIntent | null): void {
		this.intentMarker.intent = intent;
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
	// Map of vehicle IDs to their intents
	private vehicleIntents: Map<string, EnemyIntent> = new Map();

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

		// Set intent if we have one for this vehicle
		const intent = this.vehicleIntents.get(vehicle.id);
		if (intent) {
			enemyVehicle.setIntent(intent);
		}

		return enemyVehicle;
	}

	/**
	 * Update an existing vehicle display
	 */
	protected updateVehicleCard(vehicle: VehicleData, card: VehicleUI): void {
		// Update the data
		card.data = vehicle;

		// Update intent if it's an enemy vehicle
		if (card instanceof EnemyVehicle) {
			const intent = this.vehicleIntents.get(vehicle.id);
			card.setIntent(intent || null);
		}
	}

	/**
	 * Set intent for a specific vehicle
	 */
	public setVehicleIntent(vehicleId: string, intent: EnemyIntent): void {
		this.vehicleIntents.set(vehicleId, intent);
		
		// Update the vehicle card if it exists
		const card = this.vehicleCards.get(vehicleId);
		if (card && card instanceof EnemyVehicle) {
			card.setIntent(intent);
		}
	}

	/**
	 * Clear intent for a specific vehicle
	 */
	public clearVehicleIntent(vehicleId: string): void {
		this.vehicleIntents.delete(vehicleId);
		
		// Update the vehicle card if it exists
		const card = this.vehicleCards.get(vehicleId);
		if (card && card instanceof EnemyVehicle) {
			card.setIntent(null);
		}
	}
}