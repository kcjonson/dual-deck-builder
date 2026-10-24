import { Model } from '../../core/Model';
import { Card } from '../../mechanics/Card';
import { Driver } from '../../mechanics/Driver';
import { pickedMoveOf } from '../../mechanics/Movement';
import { RoadSlot, sameSlot } from '../../mechanics/Road';
import { Vehicle } from '../../mechanics/Vehicle';

/**
 * What a card waits for before it plays: a vehicle, a slot, or one then the
 * other (DDB-548). Read from the card's effects, never its name.
 */
export type AimStep = 'vehicle' | 'slot';

/** Target types that land without a vehicle being chosen: the caster's own, every raider, both drivers. */
const NO_TARGET_TYPES = new Set(['self', 'both_drivers', 'enemy_all']);

/**
 * The picks a card takes, in order (Battle Screen Design section 6). A
 * card that moves a vehicle to a slot the player picks adds a slot step:
 * before the vehicle step when the caster moves first and its other
 * effects reach from where it lands (Strafe), after it when the move is
 * the target's (Fall In's escort, Shoulder Check's raider), and alone when
 * the card takes no target (Juke, Bootlegger Turn). Whether a slot step
 * is still needed once its target is known is the battle's call
 * (`needsDestination`).
 */
export function aimStepsOf(card: Card): AimStep[] {
	const takesVehicle = !NO_TARGET_TYPES.has(card.targetType);
	const picked = pickedMoveOf(card);
	if (!picked) return takesVehicle ? ['vehicle'] : [];
	if (picked.mover === 'target') return ['vehicle', 'slot'];
	return takesVehicle ? ['slot', 'vehicle'] : ['slot'];
}

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
	carrierVehicleId: string | null;  // The escort that would carry out the selected attack order on the focused raider
	targetedVehicle: Vehicle | null;  // The actually selected target vehicle

	// Slot targeting (DDB-548): a card's picked move waiting for its slot
	targetableSlots: RoadSlot[];  // Where the move can go now; empty unless a slot step is waiting
	focusedSlot: RoadSlot | null;  // The destination under the pointer or focus, previewed
	targetedSlot: RoadSlot | null;  // The destination just chosen
	pickedSlot: RoadSlot | null;  // A destination chosen at an earlier step, held while the card waits for its vehicle
	pickedVehicleId: string | null;  // A vehicle chosen at an earlier step, held while the card waits for its slot
	
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
		'carrierVehicleId',
		'targetedVehicle',
		'targetableSlots',
		'focusedSlot',
		'targetedSlot',
		'pickedSlot',
		'pickedVehicleId',
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
			carrierVehicleId: null,
			targetedVehicle: null,
			targetableSlots: [],
			focusedSlot: null,
			targetedSlot: null,
			pickedSlot: null,
			pickedVehicleId: null,
			combatPhase: 'player_turn',
			isProcessing: false
		});
	}
	
	/**
	 * Select a card for play
	 */
	public selectCard(card: Card | null, driver: Driver | null): void {
		if (!card) {
			this.cancelSelection();
			return;
		}
		// A card waits while it has a vehicle or a slot to pick, starting
		// clean of whatever a card picked before it chose. CombatScreen sets
		// targetableVehicleIds and targetableSlots for each step
		this.set({
			selectedCard: card,
			selectedDriver: driver,
			isTargeting: aimStepsOf(card).length > 0,
			targetableVehicleIds: [],
			focusedVehicleId: null,
			carrierVehicleId: null,
			targetedVehicle: null,
			targetableSlots: [],
			focusedSlot: null,
			targetedSlot: null,
			pickedSlot: null,
			pickedVehicleId: null,
		});
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
		this.carrierVehicleId = null;
		this.targetedVehicle = null;
		this.targetableSlots = [];
		this.focusedSlot = null;
		this.targetedSlot = null;
		this.pickedSlot = null;
		this.pickedVehicleId = null;
	}
	
	/** A slot step is waiting: the card's move needs its destination, and vehicles aren't targets now. */
	public get isPickingSlot(): boolean {
		return this.isTargeting && this.targetableSlots.length > 0;
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
		
		// Only a vehicle the selected card can land on: a target while
		// targeting, or one a dragged card with no target is dropped on
		if (!this.isVehicleTargetable(vehicle.id)) {
			console.log('Target validation failed');
			return;
		}
		
		// The auto-generated setter emits the 'targetedVehicle' and 'change' events
		this.targetedVehicle = vehicle;
		console.log('Vehicle targeted successfully');
	}
	
	/**
	 * Check if a vehicle is targetable
	 */
	public isVehicleTargetable(vehicleId: string): boolean {
		return this.targetableVehicleIds.includes(vehicleId);
	}

	/** Whether a slot is one the waiting move can go to. */
	public isSlotTargetable(slot: RoadSlot): boolean {
		return this.targetableSlots.some(candidate => sameSlot(candidate, slot));
	}

	/** Preview a destination under the pointer or focus; null clears it. Only a slot the move can go to. */
	public focusSlot(slot: RoadSlot | null): void {
		if (slot && !this.isSlotTargetable(slot)) return;
		if (slot && sameSlot(slot, this.focusedSlot)) return;
		this.focusedSlot = slot;
	}

	/** Choose a destination: sets `targetedSlot`, which the screen plays or moves on from. Only a slot the move can go to. */
	public targetSlot(slot: RoadSlot): void {
		if (!this.isSlotTargetable(slot)) return;
		this.targetedSlot = slot;
	}
}
