import { Layer, LayerOptions } from '../../../engine/components/Layer';
import { Vehicle, VehicleData } from '../../mechanics/Vehicle';
import { LaneKind, ROW_ORDER, laneKind } from '../../mechanics/Road';
import { CombatModel } from './CombatModel';

/**
 * Base class for displaying vehicles in combat
 * Manages vehicle cards and lane positioning. Draws each team's vehicles in
 * three columns (shoulder, outside, inside), a stand-in until the road view
 * (DDB-134) draws the real grid.
 */
export abstract class BattlefieldLayer extends Layer {
	protected vehicles: Vehicle[] = [];
	protected vehicleCards: Map<string, Layer> = new Map();
	
	// Lane containers
	protected lanes: Map<LaneKind, {
		x: number;
		y: number;
		width: number;
		height: number;
	}> = new Map();
	
	// Combat model reference
	protected combatData: CombatModel | null = null;
	
	constructor(options: LayerOptions & { x: number; y: number; width: number; height: number; combatData?: CombatModel }) {
		super(options);
		this.combatData = options.combatData || null;
		
		// Set overflow hidden to ensure content stays within layer bounds
		this.setOverflow('hidden');
		
		// Initialize lane positions
		this.initializeLanes();
	}
	
	/**
	 * Initialize lane layout
	 */
	protected initializeLanes(): void {
		const laneWidth = Math.floor(this.getWidth() / 3);
		const laneHeight = this.getHeight();
		
		// Define lanes from left to right: shoulder, outside, inside
		this.lanes.set('shoulder', {
			x: 0,
			y: 0,
			width: laneWidth,
			height: laneHeight
		});
		
		this.lanes.set('outside', {
			x: laneWidth,
			y: 0,
			width: laneWidth,
			height: laneHeight
		});
		
		this.lanes.set('inside', {
			x: laneWidth * 2,
			y: 0,
			width: laneWidth,
			height: laneHeight
		});
	}
	
	/**
	 * Set vehicles to display
	 * Receives pure Vehicle models from game state
	 */
	public setVehicles(vehicles: Vehicle[]): void {
		this.vehicles = vehicles;
		this.updateVehicleCards();
		this.layoutVehicles();
	}
	
	/**
	 * Update vehicle cards - create new ones, remove old ones
	 */
	protected updateVehicleCards(): void {
		// Remove cards for vehicles that no longer exist
		const currentVehicleIds = new Set(this.vehicles.map(v => v.id));
		for (const [vehicleId, card] of this.vehicleCards) {
			if (!currentVehicleIds.has(vehicleId)) {
				this.removeChild(card);
				this.vehicleCards.delete(vehicleId);
			}
		}
		
		// Create cards for new vehicles
		for (const vehicle of this.vehicles) {
			if (!this.vehicleCards.has(vehicle.id)) {
				const card = this.createVehicleCard(vehicle);
				this.vehicleCards.set(vehicle.id, card);
				this.addChild(card);
			} else {
				// Update existing card with latest vehicle data
				const existingCard = this.vehicleCards.get(vehicle.id);
				if (existingCard) {
					this.updateVehicleCard(vehicle, existingCard);
				}
			}
		}
	}
	
	/**
	 * Stable element id suffix from the slot a vehicle is created in. Model.id
	 * is random per load, and slots are unique on the road.
	 */
	protected slotId(vehicle: VehicleData): string {
		return vehicle.slot ? `${vehicle.slot.lane}_${vehicle.slot.row}` : 'off_road';
	}
	
	/**
	 * Layout vehicles in their lanes
	 */
	protected layoutVehicles(): void {
		// Group vehicles by lane, ahead to behind within each
		const vehiclesByLane = new Map<LaneKind, Vehicle[]>([['shoulder', []], ['outside', []], ['inside', []]]);
		const rowOrder = (vehicle: Vehicle): number => (vehicle.slot ? ROW_ORDER.indexOf(vehicle.slot.row) : 0);
		
		for (const vehicle of [...this.vehicles].sort((a, b) => rowOrder(a) - rowOrder(b))) {
			if (!vehicle.slot) continue;
			vehiclesByLane.get(laneKind(vehicle.slot.lane))?.push(vehicle);
		}
		
		// Layout each lane
		vehiclesByLane.forEach((vehicles, kind) => {
			const lane = this.lanes.get(kind);
			if (!lane || vehicles.length === 0) return;
			
			this.layoutVehiclesInLane(vehicles, lane);
		});
	}
	
	/**
	 * Layout vehicles within a specific lane
	 */
	protected layoutVehiclesInLane(vehicles: Vehicle[], lane: { x: number; y: number; width: number; height: number }): void {
		const count = vehicles.length;
		const cardWidth = this.getCardWidth();
		const cardHeight = this.getCardHeight();
		
		vehicles.forEach((vehicle, index) => {
			const card = this.vehicleCards.get(vehicle.id);
			if (!card) return;
			
			let x: number, y: number;
			
			if (count === 1) {
				// Center single vehicle
				x = lane.x + Math.floor((lane.width - cardWidth) / 2);
				y = lane.y + Math.floor((lane.height - cardHeight) / 2);
			} else if (count === 2) {
				// Side by side
				const spacing = 20;
				const totalWidth = 2 * cardWidth + spacing;
				const startX = lane.x + Math.floor((lane.width - totalWidth) / 2);
				x = startX + index * (cardWidth + spacing);
				y = lane.y + Math.floor((lane.height - cardHeight) / 2);
			} else {
				// Stack with overlap (max 3 per lane)
				const overlap = 40;
				const totalWidth = cardWidth + (count - 1) * overlap;
				const startX = lane.x + Math.floor((lane.width - totalWidth) / 2);
				x = startX + index * overlap;
				y = lane.y + Math.floor((lane.height - cardHeight) / 2);
			}
			
			card.setPosition(x, y);
			card.setSize(cardWidth, cardHeight);
		});
	}
	
	/**
	 * Get card dimensions
	 */
	protected abstract getCardWidth(): number;
	protected abstract getCardHeight(): number;
	
	/**
	 * Create a vehicle card display component
	 */
	protected abstract createVehicleCard(vehicle: Vehicle): Layer;
	
	/**
	 * Update an existing vehicle card with new data
	 */
	protected abstract updateVehicleCard(vehicle: Vehicle, card: Layer): void;
	
	/**
	 * Handle resize
	 */
	protected onResized(): void {
		// Reinitialize lanes with new dimensions
		this.initializeLanes();
		
		// Re-layout all vehicles
		this.layoutVehicles();
	}
}