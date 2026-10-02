import { BattlefieldLayer, BattlefieldLayerOptions, LaneDecor } from './BattlefieldLayer';
import { Vehicle as VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';
import { EnemyIntent, IntentRow } from '../../ui/IntentMarker';

export type { EnemyIntent, IntentType } from '../../ui/IntentMarker';

const INTENT_MARKER_SIZE = 30;
const INTENT_INSET = 6;

/**
 * Enemy-specific vehicle UI component
 */
class EnemyVehicle extends VehicleUI {
	protected getPortraitColor(): string {
		return '#4a3a3a'; // Enemy red tint
	}

	protected getBorderColor(): string {
		return '#6a5a5a'; // Enemy red border
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
	/**
	 * Each raider's plan beside its plate. Siblings of the plates, not their
	 * children: a plate is one hit target (`unit`), so nothing inside it is
	 * ever hovered, and the discs need their tooltips.
	 */
	private intentRows: Map<string, IntentRow> = new Map();

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
		return new EnemyVehicle({
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
	}

	/**
	 * Update an existing vehicle display
	 */
	protected updateVehicleCard(vehicle: VehicleData, card: VehicleUI): void {
		card.data = vehicle;
	}

	/** A row per plate, made and dropped with the plates. */
	protected updateVehicleCards(): void {
		super.updateVehicleCards();
		for (const [vehicleId, row] of this.intentRows) {
			if (this.vehicleCards.has(vehicleId)) continue;
			this.removeChild(row);
			this.intentRows.delete(vehicleId);
		}
		for (const [vehicleId, plate] of this.vehicleCards) {
			if (this.intentRows.has(vehicleId)) continue;
			const row = new IntentRow({ id: plate.id ? `${plate.id}_intents` : undefined, markerSize: INTENT_MARKER_SIZE, zIndex: 1 });
			row.intents = this.vehicleIntents.get(vehicleId) ?? [];
			this.intentRows.set(vehicleId, row);
			this.addChild(row);
		}
	}

	/** Beside each plate's top right corner, outside it, so a plan of three never covers the driver's name or the lane label. */
	protected layoutVehicles(): void {
		super.layoutVehicles();
		for (const [vehicleId, row] of this.intentRows) {
			const plate = this.vehicleCards.get(vehicleId);
			if (!plate) continue;
			const { x, y, width } = plate.bounds;
			row.setPosition(x + width + INTENT_INSET, y);
		}
	}

	/** A raider's plan for the enemy turn, in order; empty clears it. */
	public setVehicleIntents(vehicleId: string, intents: readonly EnemyIntent[]): void {
		if (intents.length === 0) this.vehicleIntents.delete(vehicleId);
		else this.vehicleIntents.set(vehicleId, intents);
		const row = this.intentRows.get(vehicleId);
		if (row) row.intents = intents;
	}

	/** The row showing a raider's plan, while the raider is on the road. */
	public intentRowOf(vehicleId: string): IntentRow | null {
		return this.intentRows.get(vehicleId) ?? null;
	}
}
