import { Layer } from '../../engine/components/Layer';
import { Rectangle } from '../../engine/components/Rectangle';
import { Text } from '../../engine/components/Text';
import { Vehicle as VehicleData } from '../mechanics/Vehicle';
import type { MountContext } from '../../engine/components/MountContext';
import { CombatModel } from '../screens/combat/CombatModel';
import { ArmorBadge } from './ArmorBadge';

/**
 * Visual representation of a vehicle on the battlefield
 * Can be extended for player/enemy specific styling
 */
export class Vehicle extends Layer {
	protected vehicleData: VehicleData;
	
	// UI elements
	protected portrait!: Rectangle;
	protected nameText!: Text;
	protected driverNameText!: Text;
	protected driverHpText!: Text;
	protected healthBar!: Rectangle;
	protected healthBarFill!: Rectangle;
	protected healthText!: Text;
	protected armorBadge!: ArmorBadge;
	protected driverPortrait: Rectangle | null = null;
	protected statusContainer: Layer | null = null;
	protected spentChip: Text | null = null;
	
	// References
	private combatData: CombatModel | null = null;
	private onClickCallback: ((vehicle: VehicleData) => void) | null = null;
	
	// State
	private builtShape = '';
	private modelUnsubscribers: (() => void)[] = [];
	
	constructor(args: {
		id?: string;
		x: number;
		y: number;
		width: number;
		height: number;
		vehicleData: VehicleData;
		combatData?: CombatModel;
		onClick?: (vehicle: VehicleData) => void;
	}) {
		super(args);
		this.vehicleData = args.vehicleData;
		this.combatData = args.combatData || null;
		this.onClickCallback = args.onClick || null;
		
		this.createElements();
		this.updateVisuals();
		
		if (this.combatData) {
			this.subscribeToModel();
		}
	}
	
	/**
	 * Update the vehicle data and refresh visuals
	 */
	public set data(vehicleData: VehicleData) {
		this.vehicleData = vehicleData;
		if (this.shape !== this.builtShape) {
			this.rebuild();
		} else {
			this.updateVisuals();
		}
	}

	/**
	 * Get the vehicle data
	 */
	public get data(): VehicleData {
		return this.vehicleData;
	}

	/**
	 * What decides which elements the plate has: a driver row, and an
	 * escort's SPENT chip. A driven vehicle that loses its driver becomes an
	 * escort mid-fight, so the plate rebuilds when this changes.
	 */
	private get shape(): string {
		return `${Boolean(this.vehicleData.driver)}/${this.vehicleData.isEscort}`;
	}
	
	/**
	 * Create visual elements
	 */
	/**
	 * Composite internals derive their ids from the vehicle's own id, so a
	 * caller names the vehicle once. Unnamed vehicles leave children unnamed.
	 */
	protected childId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}
	
	protected createElements(): void {
		this.builtShape = this.shape;
		this.driverPortrait = null;
		const width = this.getWidth();
		const height = this.getHeight();
		
		// Vehicle portrait/body
		this.portrait = new Rectangle({
			id: this.childId('portrait'),
			x: 0,
			y: 0,
			width,
			height: Math.floor(height * 0.65),
			style: {
				backgroundColor: this.getPortraitColor(),
				borderColor: this.getBorderColor(),
				borderWidth: 3,
			},
		});
		this.addChild(this.portrait);
		
		// Driver portrait (if driver exists)
		if (this.vehicleData.driver) {
			this.driverPortrait = new Rectangle({
				id: this.childId('driver_portrait'),
				x: Math.floor(width * 0.05),
				y: Math.floor(height * 0.05),
				width: Math.min(20, Math.floor(width * 0.15)),
				height: Math.min(20, Math.floor(width * 0.15)),
				style: {
					backgroundColor: '#6a5a4a',
					borderColor: '#8a7a6a',
					borderWidth: 1,
					borderRadius: 10,
				},
			});
			this.addChild(this.driverPortrait);
			
			// Driver name text
			this.driverNameText = new Text('', {
				id: this.childId('driver_name'),
				style: {
					fontSize: 9,
					color: '#cccccc',
					textAlign: 'left',
				},
			});
			this.driverNameText.setPosition(Math.floor(width * 0.05), Math.floor(height * 0.30));
			this.addChild(this.driverNameText);
			
			// Driver HP text
			this.driverHpText = new Text('', {
				id: this.childId('driver_hp'),
				style: {
					fontSize: 8,
					color: '#aaaaaa',
					textAlign: 'left',
				},
			});
			this.driverHpText.setPosition(Math.floor(width * 0.05), Math.floor(height * 0.42));
			this.addChild(this.driverHpText);
		}
		
		// Vehicle name
		this.nameText = new Text('', {
			id: this.childId('name'),
			width: Math.floor(width * 0.9),
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
				whiteSpace: 'normal',
			},
		});
		this.nameText.setPosition(Math.floor(width * 0.05), Math.floor(height * 0.55));
		this.addChild(this.nameText);
		
		// Health bar background
		this.healthBar = new Rectangle({
			id: this.childId('structure_track'),
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.68),
			width: Math.floor(width * 0.8),
			height: 10,
			style: {
				backgroundColor: '#333333',
				borderColor: '#555555',
				borderWidth: 1,
			},
		});
		this.addChild(this.healthBar);
		
		// Health bar fill
		this.healthBarFill = new Rectangle({
			id: this.childId('structure_fill'),
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.68),
			width: 0,
			height: 10,
			style: {
				backgroundColor: '#4a8a4a',
			},
		});
		this.addChild(this.healthBarFill);
		
		// Health text
		this.healthText = new Text('', {
			id: this.childId('structure_value'),
			x: 0,
			y: Math.floor(height * 0.73),
			width,
			style: {
				fontSize: 9,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		this.addChild(this.healthText);
		
		// Armor display and status container on same line
		this.armorBadge = new ArmorBadge({
			id: this.childId('armor_badge'),
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.82),
			minWidth: Math.floor(width * 0.25),
			height: 16,
		});
		this.addChild(this.armorBadge);
		
		// An escort shows SPENT once it has acted this turn
		this.spentChip = null;
		if (this.vehicleData.isEscort) {
			this.spentChip = new Text('SPENT', {
				id: this.childId('spent_chip'),
				style: {
					fontSize: 9,
					color: '#ffcc66',
					fontWeight: 'bold',
				},
			});
			this.addChild(this.spentChip);
			this.placeSpentChip();
		}

		// Status effect container (for future use)
		this.statusContainer = new Layer({
			id: this.childId('status_container'),
			x: Math.floor(width * 0.4),
			y: Math.floor(height * 0.82),
			width: Math.floor(width * 0.5),
			height: 16,
		});
		this.addChild(this.statusContainer);
	}
	
	/**
	 * Update visual elements with current vehicle data
	 */
	protected updateVisuals(): void {
		// Update vehicle name (just the vehicle name, not driver's)
		this.nameText.setText(this.vehicleData.name);
		
		// Update driver info if present
		if (this.vehicleData.driver) {
			if (this.driverNameText) {
				this.driverNameText.setText(`Driver: ${this.vehicleData.driver.metadata.name}`);
			}
			if (this.driverHpText) {
				this.driverHpText.setText(`HP: ${this.vehicleData.driver.hitpoints}/${this.vehicleData.driver.maxHitpoints}`);
			}
		}
		
		// Update health
		const healthPercentage = this.vehicleData.structure / this.vehicleData.maxStructure;
		const healthBarWidth = Math.floor(this.healthBar.getWidth() * healthPercentage);
		this.healthBarFill.setWidth(healthBarWidth);
		this.healthBarFill.setFillColor(this.getHealthColor(healthPercentage));
		this.healthText.setText(`${this.vehicleData.structure}/${this.vehicleData.maxStructure}`);
		
		// Update armor; shield is temporary armor on top
		this.armorBadge.armor = this.vehicleData.armor;
		this.armorBadge.shield = this.vehicleData.shield ?? 0;

		this.spentChip?.setVisible(Boolean(this.vehicleData.spent));
	}
	
	/**
	 * Get display name - can be overridden
	 */
	protected getDisplayName(): string {
		return this.vehicleData.name;
	}
	
	/**
	 * Get health bar color based on percentage
	 */
	protected getHealthColor(percentage: number): string {
		if (percentage > 0.6) return '#4a8a4a'; // Green
		if (percentage > 0.3) return '#8a8a4a'; // Yellow
		return '#8a4a4a'; // Red
	}
	
	/**
	 * Get portrait background color - can be overridden
	 */
	protected getPortraitColor(): string {
		return '#5a4a3a';
	}
	
	/**
	 * Get border color - can be overridden
	 */
	protected getBorderColor(): string {
		return '#7a6a5a';
	}
	
	/**
	 * Get name font size - can be overridden for different sizes
	 */
	protected getNameFontSize(): number {
		return 10;
	}
	
	/**
	 * Get vehicle ID
	 */
	public get vehicleId(): string {
		return this.vehicleData.id;
	}
	
	/**
	 * Handle resize
	 */
	protected onResized(): void {
		this.rebuild();
	}

	/**
	 * Recreate every element for the current size and shape
	 */
	private rebuild(): void {
		while (this.children.length > 0) {
			this.removeChild(this.children[0]);
		}
		this.createElements();
		this.updateVisuals();
		this.updateVisualState();
	}
	
	/** Right edge at 95 percent of the width, from the chip's measured width. */
	private placeSpentChip(): void {
		if (!this.spentChip) return;
		this.spentChip.setPosition(
			Math.floor(this.getWidth() * 0.95 - this.spentChip.getWidth()),
			Math.floor(this.getHeight() * 0.05),
		);
	}

	/** The chip measures on mount (R1.6); this places it before the first render. */
	protected layoutChildren(): void {
		this.placeSpentChip();
	}

	protected onMount({ input }: MountContext): void {
		// Click handler
		input.registerMouseDown(this, () => {
			if (this.onClickCallback && this.isTargetable()) {
				this.onClickCallback(this.vehicleData);
			}
		});
		
		// Hover handlers for visual feedback
		input.registerMouseOver(this, () => {
			if (!this.hovered) {
				this.setHovered(true);
				if (this.combatData && this.combatData.isTargeting) {
					this.combatData.focusVehicle(this.vehicleData.id);
				}
				this.updateVisualState();
			}
		});
		
		input.registerMouseOut(this, () => {
			if (this.hovered) {
				this.setHovered(false);
				if (this.combatData && this.combatData.focusedVehicleId === this.vehicleData.id) {
					this.combatData.focusVehicle(null);
				}
				this.updateVisualState();
			}
		});
	}
	
	/**
	 * Subscribe to combat model changes
	 */
	private subscribeToModel(): void {
		if (!this.combatData) return;
		
		// Listen for targetable changes
		this.modelUnsubscribers.push(
			this.combatData.on('targetableVehicleIds', () => {
				this.updateVisualState();
			})
		);
		
		// Listen for focus changes
		this.modelUnsubscribers.push(
			this.combatData.on('focusedVehicleId', () => {
				this.updateVisualState();
			})
		);

		// Listen for the escort an attack order would use
		this.modelUnsubscribers.push(
			this.combatData.on('carrierVehicleId', () => {
				this.updateVisualState();
			})
		);
		
		// Listen for targeting state changes
		this.modelUnsubscribers.push(
			this.combatData.on('isTargeting', () => {
				this.updateVisualState();
			})
		);
	}
	
	/**
	 * Check if this vehicle is targetable
	 */
	private isTargetable(): boolean {
		if (!this.combatData) return true;
		return this.combatData.isVehicleTargetable(this.vehicleData.id);
	}
	
	/**
	 * Check if this vehicle is focused
	 */
	private isFocusedTarget(): boolean {
		if (!this.combatData) return false;
		return this.combatData.focusedVehicleId === this.vehicleData.id;
	}
	
	/**
	 * The escort that would carry out the attack order being aimed
	 */
	private isOrderCarrier(): boolean {
		return this.combatData?.carrierVehicleId === this.vehicleData.id;
	}

	/**
	 * Update visual state based on model state. The escort that would carry
	 * out an attack order lights up like a focused target while the order is
	 * over its raider.
	 */
	private updateVisualState(): void {
		const carrier = this.isOrderCarrier();
		const targetable = this.isTargetable() || carrier;
		const focused = this.isFocusedTarget() || carrier;
		const targeting = this.combatData?.isTargeting || false;
		
		// Update visual state based on targetability
		// Non-targetable vehicles get dimmed colors
		if (!targetable && targeting) {
			this.portrait.setFillColor('#3a3a3a'); // Dimmed background
			this.portrait.setBorderColor('#4a4a4a'); // Dimmed border
		} else {
			this.portrait.setFillColor(this.getPortraitColor());
			this.portrait.setBorderColor(this.getBorderColor());
		}
		
		// Update border based on state
		if (focused && targetable) {
			// Focused and targetable
			this.portrait.setBorderWidth(4);
			this.portrait.setBorderColor(this.getFocusedBorderColor());
		} else if (this.hovered && targetable) {
			// Hovered and targetable
			this.portrait.setBorderWidth(4);
			this.portrait.setBorderColor(this.getBorderColor());
		} else {
			// Normal state
			this.portrait.setBorderWidth(3);
			this.portrait.setBorderColor(this.getBorderColor());
		}
	}
	
	/**
	 * Get border color for focused state - can be overridden
	 */
	protected getFocusedBorderColor(): string {
		return '#88ff88'; // Default green for focused targets
	}
	
	/** Model subscriptions are the vehicle's own; input is released by the base. */
	protected onUnmount(): void {
		this.modelUnsubscribers.forEach(unsubscribe => unsubscribe());
		this.modelUnsubscribers = [];
	}
}
