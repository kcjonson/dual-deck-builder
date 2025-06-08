import { Layer } from '../../../engine/components/Layer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { Vehicle, VehiclePosition } from '../../mechanics/Vehicle';
import { CombatModel } from './CombatModel';

/**
 * Base class for displaying vehicles in combat
 * Manages vehicle cards and lane positioning
 */
export abstract class BattlefieldLayer extends Layer {
	protected vehicles: Vehicle[] = [];
	protected vehicleCards: Map<string, Layer> = new Map();
	
	// Lane containers
	protected lanes: Map<VehiclePosition, {
		x: number;
		y: number;
		width: number;
		height: number;
	}> = new Map();
	
	// Combat model reference
	protected combatData: CombatModel | null = null;
	
	constructor(options: { 
		x: number; 
		y: number; 
		width: number; 
		height: number;
		combatData?: CombatModel;
	}) {
		super(options);
		this.combatData = options.combatData || null;
		
		// Initialize lane positions
		this.initializeLanes();
	}
	
	/**
	 * Initialize lane layout
	 */
	protected initializeLanes(): void {
		const laneWidth = Math.floor(this.getWidth() / 3);
		const laneHeight = this.getHeight();
		
		// Define lanes from left to right: Flanking, Back, Front
		this.lanes.set(VehiclePosition.FLANKING, {
			x: 0,
			y: 0,
			width: laneWidth,
			height: laneHeight
		});
		
		this.lanes.set(VehiclePosition.BACK, {
			x: laneWidth,
			y: 0,
			width: laneWidth,
			height: laneHeight
		});
		
		this.lanes.set(VehiclePosition.FRONT, {
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
				this.updateVehicleCard(vehicle, this.vehicleCards.get(vehicle.id)!);
			}
		}
	}
	
	/**
	 * Layout vehicles in their lanes
	 */
	protected layoutVehicles(): void {
		// Group vehicles by position
		const vehiclesByPosition = new Map<VehiclePosition, Vehicle[]>();
		for (const position of [VehiclePosition.FLANKING, VehiclePosition.BACK, VehiclePosition.FRONT]) {
			vehiclesByPosition.set(position, []);
		}
		
		for (const vehicle of this.vehicles) {
			const vehicles = vehiclesByPosition.get(vehicle.position);
			if (vehicles) {
				vehicles.push(vehicle);
			}
		}
		
		// Layout each lane
		vehiclesByPosition.forEach((vehicles, position) => {
			const lane = this.lanes.get(position);
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