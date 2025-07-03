import { Layer } from '../../engine/components/Layer';
import { Rectangle } from '../../engine/components/Rectangle';
import { Text } from '../../engine/components/Text';
import { Vehicle as VehicleData } from '../mechanics/Vehicle';
import { InputSystem } from '../../engine/input/InputSystem';
import { CombatModel } from '../screens/combat/CombatModel';

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
	protected armorDisplay!: Rectangle;
	protected armorText!: Text;
	protected driverPortrait: Rectangle | null = null;
	protected statusContainer: Layer | null = null;
	
	// References
	private combatData: CombatModel | null = null;
	private onClickCallback: ((vehicle: VehicleData) => void) | null = null;
	
	// State
	private isHovered = false;
	private modelUnsubscribers: (() => void)[] = [];
	
	constructor(args: {
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
		this.setupEventHandlers();
		
		if (this.combatData) {
			this.subscribeToModel();
		}
	}
	
	/**
	 * Update the vehicle data and refresh visuals
	 */
	public set data(vehicleData: VehicleData) {
		this.vehicleData = vehicleData;
		this.updateVisuals();
	}
	
	/**
	 * Get the vehicle data
	 */
	public get data(): VehicleData {
		return this.vehicleData;
	}
	
	/**
	 * Create visual elements
	 */
	protected createElements(): void {
		const width = this.getWidth();
		const height = this.getHeight();
		
		// Vehicle portrait/body
		this.portrait = new Rectangle({
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
			style: {
				fontSize: 9,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		this.healthText.setPosition(Math.floor(width / 2), Math.floor(height * 0.73));
		this.addChild(this.healthText);
		
		// Armor display and status container on same line
		this.armorDisplay = new Rectangle({
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.82),
			width: Math.floor(width * 0.25),
			height: 16,
			style: {
				backgroundColor: '#4a4a4a',
				borderColor: '#8a8aaa',
				borderWidth: 1,
			},
		});
		this.addChild(this.armorDisplay);
		
		this.armorText = new Text('', {
			style: {
				fontSize: 8,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		this.armorText.setPosition(Math.floor(width * 0.225), Math.floor(height * 0.84));
		this.addChild(this.armorText);
		
		// Status effect container (for future use)
		this.statusContainer = new Layer({
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
		
		// Update armor
		this.armorDisplay.setFillColor(this.vehicleData.armor > 0 ? '#6a6aaa' : '#4a4a4a');
		this.armorText.setText(`${this.vehicleData.armor}⛡`);
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
		// Remove all children and recreate with new size
		while (this.children.length > 0) {
			this.removeChild(this.children[0]);
		}
		this.createElements();
		this.updateVisuals();
	}
	
	/**
	 * Set up event handlers
	 */
	private setupEventHandlers(): void {
		// Click handler
		InputSystem.registerMouseDown(this, () => {
			if (this.onClickCallback && this.isTargetable()) {
				this.onClickCallback(this.vehicleData);
			}
		});
		
		// Hover handlers for visual feedback
		InputSystem.registerMouseOver(this, () => {
			if (!this.isHovered) {
				this.isHovered = true;
				if (this.combatData && this.combatData.isTargeting) {
					this.combatData.focusVehicle(this.vehicleData.id);
				}
				this.updateVisualState();
			}
		});
		
		InputSystem.registerMouseOut(this, () => {
			if (this.isHovered) {
				this.isHovered = false;
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
	private isFocused(): boolean {
		if (!this.combatData) return false;
		return this.combatData.focusedVehicleId === this.vehicleData.id;
	}
	
	/**
	 * Update visual state based on model state
	 */
	private updateVisualState(): void {
		const targetable = this.isTargetable();
		const focused = this.isFocused();
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
		} else if (this.isHovered && targetable) {
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
	
	/**
	 * Get hover state
	 */
	public get hovered(): boolean {
		return this.isHovered;
	}
	
	/**
	 * Unmount the vehicle and clean up event listeners
	 */
	public unmount(): void {
		// Unsubscribe from model
		this.modelUnsubscribers.forEach(unsubscribe => unsubscribe());
		this.modelUnsubscribers = [];
		
		// Unregister from input system
		InputSystem.unregisterComponent(this);
		
		// Call parent unmount to handle children
		super.unmount();
	}
}