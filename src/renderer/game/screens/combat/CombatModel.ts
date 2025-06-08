import { Model } from '../../core/Model';
import { Card } from '../../mechanics/Card';
import { Driver } from '../../mechanics/Driver';
import { Vehicle } from '../../mechanics/Vehicle';

/**
 * Combat UI state data interface
 */
export interface CombatModelData {
	// Card selection state
	selectedCard: Card | null;
	selectedDriver: Driver | null;
	
	// Targeting state
	isTargeting: boolean;
	targetableVehicleIds: string[];
	focusedVehicleId: string | null;  // Currently focused/highlighted vehicle during targeting
	targetedVehicle: Vehicle | null;  // The actually selected target vehicle
	
	// UI state
	combatPhase: string;
	isProcessing: boolean;
}

/**
 * Interface that merges with the class
 */
export interface CombatModel extends CombatModelData {}

/**
 * Model for managing combat UI state
 * Separate from Battle (game state) to handle UI-specific concerns
 */
export class CombatModel extends Model<CombatModelData> {
	// Runtime property list - MUST match CombatModelData interface
	static properties = new Set<keyof CombatModelData>([
		'selectedCard',
		'selectedDriver',
		'isTargeting',
		'targetableVehicleIds',
		'focusedVehicleId',
		'targetedVehicle',
		'combatPhase',
		'isProcessing'
	]);
	
	/**
	 * Create a new combat model
	 */
	constructor() {
		super({
			selectedCard: null,
			selectedDriver: null,
			isTargeting: false,
			targetableVehicleIds: [],
			focusedVehicleId: null,
			targetedVehicle: null,
			combatPhase: 'player_turn',
			isProcessing: false
		});
	}
	
	/**
	 * Select a card for play
	 */
	public selectCard(card: Card | null, driver: Driver | null): void {
		this.selectedCard = card;
		this.selectedDriver = driver;
		
		if (card) {
			// Determine which vehicles are targetable based on card
			const targetableIds = this.determineTargetableVehicles(card);
			this.targetableVehicleIds = targetableIds;
			this.isTargeting = targetableIds.length > 0;
		} else {
			this.cancelSelection();
		}
	}
	
	/**
	 * Cancel current selection
	 */
	public cancelSelection(): void {
		this.selectedCard = null;
		this.selectedDriver = null;
		this.isTargeting = false;
		this.targetableVehicleIds = [];
		this.focusedVehicleId = null;
		this.targetedVehicle = null;
	}
	
	/**
	 * Focus on a vehicle (for targeting preview)
	 */
	public focusVehicle(vehicleId: string | null): void {
		if (vehicleId && !this.isVehicleTargetable(vehicleId)) {
			return; // Can't focus non-targetable vehicles
		}
		this.focusedVehicleId = vehicleId;
	}
	
	/**
	 * Target a vehicle (validates and sets targetedVehicle)
	 */
	public targetVehicle(vehicle: Vehicle): void {
		// Only allow targeting if we're in targeting mode and the vehicle is targetable
		if (!this.isTargeting || !this.isVehicleTargetable(vehicle.id)) {
			return;
		}
		
		// Set using the auto-generated setter - this will emit the change event
		this.targetedVehicle = vehicle;
	}
	
	/**
	 * Check if a vehicle is targetable
	 */
	public isVehicleTargetable(vehicleId: string): boolean {
		return this.targetableVehicleIds.includes(vehicleId);
	}
	
	/**
	 * Determine which vehicles can be targeted by a card
	 * This will be expanded based on actual game rules
	 */
	private determineTargetableVehicles(card: Card): string[] {
		// TODO: Implement based on card.targetType and game state
		// For now, return empty array (no targeting needed)
		return [];
	}
}