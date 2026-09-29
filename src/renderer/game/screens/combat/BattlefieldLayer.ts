import { Container, ContainerOptions } from '../../../engine/components/Container';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { Vehicle, VehicleData } from '../../mechanics/Vehicle';
import { Vehicle as VehicleUI } from '../../ui/Vehicle';
import { LaneKind, ROW_ORDER, laneKind } from '../../mechanics/Road';
import { CombatModel } from './CombatModel';

/**
 * A team's battlefield colors and its three column labels, left to right
 */
export interface LaneDecor {
	backgroundColor: string;
	dividerColor: string;
	labelColor: string;
	labels: [string, string, string];
}

export type BattlefieldLayerOptions = ContainerOptions & { combatData?: CombatModel };

const LANE_LABEL_Y = 20;
const LANE_DIVIDER_TOP = 40;
const LANE_DIVIDER_WIDTH = 2;

/**
 * Base class for displaying vehicles in combat
 * Manages vehicle cards and lane positioning. Draws each team's vehicles in
 * three columns (shoulder, outside, inside), a stand-in until the road view
 * (DDB-134) draws the real grid.
 */
export abstract class BattlefieldLayer extends Container {
	protected vehicles: Vehicle[] = [];
	protected vehicleCards: Map<string, VehicleUI> = new Map();

	// Lane containers
	protected lanes: Map<LaneKind, {
		x: number;
		y: number;
		width: number;
		height: number;
	}> = new Map();

	// Combat model reference
	protected combatData: CombatModel | null = null;

	// Drawn behind the vehicles, created once and moved by layoutLanes
	private background: Rectangle;
	private laneDividers: Rectangle[];
	private laneLabels: Text[];

	constructor(options: BattlefieldLayerOptions & { laneDecor: LaneDecor }) {
		super(options);
		this.combatData = options.combatData || null;

		const decor = options.laneDecor;
		this.background = new Rectangle({ style: { backgroundColor: decor.backgroundColor } });
		this.addChild(this.background);
		this.laneDividers = [0, 1].map(() => {
			const divider = new Rectangle({ style: { backgroundColor: decor.dividerColor } });
			this.addChild(divider);
			return divider;
		});
		this.laneLabels = decor.labels.map(label => {
			const text = new Text(label, {
				style: {
					fontSize: 14,
					color: decor.labelColor,
					textAlign: 'center',
					fontWeight: 'bold',
				},
				wrap: 'none',
			});
			this.addChild(text);
			return text;
		});

		this.layoutLanes();
	}

	/**
	 * Lay out the lanes, their dividers and labels, and the background for
	 * the layer's current size, on construction and on every resize
	 */
	protected layoutLanes(): void {
		const laneWidth = Math.floor(this.getWidth() / 3);
		const laneHeight = this.getHeight();

		// Keeps content within layer bounds; a layer can only clip once it has a size
		if (this.getWidth() > 0 && laneHeight > 0) {
			this.setOverflow('hidden');
		}

		this.background.setSize(this.getWidth(), laneHeight);
		this.laneDividers.forEach((divider, index) => {
			divider.setPosition(laneWidth * (index + 1) - LANE_DIVIDER_WIDTH / 2, LANE_DIVIDER_TOP);
			divider.setSize(LANE_DIVIDER_WIDTH, laneHeight - LANE_DIVIDER_TOP);
		});
		this.laneLabels.forEach((label, index) => {
			// Centred across its lane
			label.setPosition(laneWidth * index, LANE_LABEL_Y);
			label.setWidth(laneWidth);
		});

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
		// Two side by side narrow to share a lane that is too slim for both
		const sideBySideSpacing = 20;
		const cardWidth = count === 2
			? Math.min(this.getCardWidth(), Math.floor((lane.width - sideBySideSpacing) / 2))
			: this.getCardWidth();
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
				const totalWidth = 2 * cardWidth + sideBySideSpacing;
				const startX = lane.x + Math.floor((lane.width - totalWidth) / 2);
				x = startX + index * (cardWidth + sideBySideSpacing);
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
	protected abstract createVehicleCard(vehicle: Vehicle): VehicleUI;
	
	/**
	 * Update an existing vehicle card with new data
	 */
	protected abstract updateVehicleCard(vehicle: Vehicle, card: VehicleUI): void;
	
	/**
	 * Handle resize
	 */
	protected onResized(): void {
		this.layoutLanes();
		this.layoutVehicles();
	}
}