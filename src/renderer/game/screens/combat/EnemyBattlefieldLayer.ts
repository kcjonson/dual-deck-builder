import { BattlefieldLayer, BattlefieldLayerOptions, LaneDecor } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';

/**
 * Enemy intent indicator types
 */
export type IntentType = 'attack' | 'defend' | 'repair' | 'special';

export interface EnemyIntent {
	type: IntentType;
	value?: number; // Damage amount, armor gain, etc.
	description: string;
}

/**
 * Enemy-specific vehicle UI component
 */
class EnemyVehicle extends VehicleUI {
	private intentIndicator!: Rectangle;
	private intentText!: Text;
	private intent: EnemyIntent | null = null;

	protected createElements(): void {
		super.createElements();

		// Add intent indicator
		const width = this.getWidth();
		const height = this.getHeight();

		this.intentIndicator = new Rectangle({
			x: Math.floor(width * 0.7),
			y: Math.floor(height * 0.05),
			width: 30,
			height: 30,
			style: {
				backgroundColor: '#aa4a4a',
				borderColor: '#cc6a6a',
				borderWidth: 2,
				borderRadius: 15,
			},
		});
		this.addChild(this.intentIndicator);

		// Centred in the indicator
		this.intentText = new Text('!', {
			x: this.intentIndicator.getX(),
			y: this.intentIndicator.getY(),
			width: this.intentIndicator.getWidth(),
			height: this.intentIndicator.getHeight(),
			style: {
				fontSize: 16,
				color: '#ffffff',
				textAlign: 'center',
				verticalAlign: 'middle',
				whiteSpace: 'nowrap',
				fontWeight: 'bold',
			},
		});
		this.addChild(this.intentText);
	}

	protected getPortraitColor(): string {
		return '#4a3a3a'; // Enemy red tint
	}

	protected getBorderColor(): string {
		return '#6a5a5a'; // Enemy red border
	}

	protected getDisplayName(): string {
		// Enemies just show vehicle name, not driver name
		return this.vehicleData.name;
	}

	/**
	 * Set enemy intent
	 */
	public setIntent(intent: EnemyIntent | null): void {
		this.intent = intent;
		this.updateIntent();
	}

	/**
	 * A resize rebuilds the plate, intent marker included, so show the intent again
	 */
	protected onResized(): void {
		super.onResized();
		this.updateIntent();
	}

	/**
	 * Update intent display
	 */
	private updateIntent(): void {
		if (!this.intent) {
			this.intentIndicator.setVisible(false);
			this.intentText.setVisible(false);
			return;
		}

		this.intentIndicator.setVisible(true);
		this.intentText.setVisible(true);
		this.intentIndicator.setFillColor(this.getIntentColor(this.intent.type));
		this.intentText.setText(this.getIntentDisplay(this.intent));
	}

	/**
	 * Get color for intent type
	 */
	private getIntentColor(intentType: IntentType): string {
		switch (intentType) {
			case 'attack':
				return '#cc4444';
			case 'defend':
				return '#4444cc';
			case 'repair':
				return '#44cc44';
			case 'special':
				return '#cc8844';
			default:
				return '#666666';
		}
	}

	/**
	 * Get display text for intent
	 */
	private getIntentDisplay(intent: EnemyIntent): string {
		switch (intent.type) {
			case 'attack':
				return intent.value ? intent.value.toString() : '?';
			// The shield and wrench symbols are not text the atlas covers
			// (R6.3); the badge colour carries the intent until DDB-72's icons.
			case 'defend':
			case 'repair':
				return '';
			case 'special':
				return '!';
			default:
				return '?';
		}
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