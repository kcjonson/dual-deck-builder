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
 * Combat model interface for the class
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
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
			// Check if the card needs targeting
			const needsTarget = card.targetType !== 'self' && 
			                   card.targetType !== 'both_drivers' && 
			                   card.targetType !== 'enemy_all';
			this.isTargeting = needsTarget;
			// targetableVehicleIds will be set by CombatScreen
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
		console.log(`targetVehicle called:`, { 
			vehicleId: vehicle.id, 
			vehicleName: vehicle.name,
			isTargeting: this.isTargeting,
			isTargetable: this.isVehicleTargetable(vehicle.id),
			targetableIds: this.targetableVehicleIds
		});
		
		// Only allow targeting if we're in targeting mode and the vehicle is targetable
		if (!this.isTargeting || !this.isVehicleTargetable(vehicle.id)) {
			console.log('Target validation failed');
			return;
		}
		
		// Set using the auto-generated setter - this will emit the change event
		this.targetedVehicle = vehicle;
		console.log('Vehicle targeted successfully');
		
		// Manually emit the targetedVehicle event that CombatScreen is listening for
		this.emit('targetedVehicle', vehicle);
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
		// Cards that don't need targeting
		if (card.targetType === 'self' || 
		    card.targetType === 'both_drivers' || 
		    card.targetType === 'enemy_all') {
			return [];
		}
		
		// For other target types, we need actual vehicle IDs
		// This should be set by CombatScreen when it calls selectCard
		// Return empty for now, will be populated by CombatScreen
		return [];
	}
}