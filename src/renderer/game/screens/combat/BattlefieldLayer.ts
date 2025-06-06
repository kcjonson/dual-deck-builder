import { Layer } from '../../../engine/components/Layer';
import { Text } from '../../../engine/components/Text';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Driver } from '../../mechanics/Driver';
import { InputSystem } from '../../../engine/input/InputSystem';

/**
 * Player vehicle data for combat display
 */
export interface PlayerVehicle {
	driver: Driver;
	currentHealth: number;
	maxHealth: number;
	armor: number;
	statusEffects: StatusEffect[];
	position: 'front' | 'back' | 'flanking';
}

/**
 * Status effect on vehicles
 */
export interface StatusEffect {
	id: string;
	name: string;
	type: 'buff' | 'debuff';
	duration: number;
	description: string;
}

/**
 * Battlefield layer for the middle 40% of combat screen
 * Shows player vehicles with health, armor, status effects
 */
export class BattlefieldLayer extends Layer {
	private playerVehicles: PlayerVehicle[] = [];
	private vehicleElements: Map<string, {
		container: Layer;
		portrait: Rectangle;
		healthBar: Rectangle;
		healthBarFill: Rectangle;
		healthText: Text;
		armorDisplay: Rectangle;
		armorText: Text;
		nameText: Text;
		driverPortrait: Rectangle;
		statusContainer: Layer;
	}> = new Map();
	
	// Target callback
	private onTargetCallback: ((vehicle: PlayerVehicle) => void) | null = null;

	/**
	 * Create battlefield layer
	 */
	constructor(options: { x: number; y: number; width: number; height: number }) {
		super(options);
		
		// Battlefield background
		const background = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: this.getHeight(),
			style: {
				backgroundColor: '#3a2a1a', // Dusty battlefield color
			},
		});
		this.addChild(background);

		// Battlefield atmosphere text
		const atmosphereText = new Text('THE WASTELAND BATTLEFIELD', {
			style: {
				fontSize: 16,
				color: '#8a7a6a',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		atmosphereText.setPosition(Math.floor(this.getWidth() / 2), 20);
		this.addChild(atmosphereText);

		// Set up targeting
		this.setupTargeting();
	}

	/**
	 * Set player vehicles to display
	 */
	public setPlayerVehicles(vehicles: PlayerVehicle[]): void {
		this.playerVehicles = vehicles;
		this.clearVehicleElements();
		this.createVehicleElements();
	}

	/**
	 * Update a player vehicle's data
	 */
	public updatePlayerVehicle(driverId: string, updates: Partial<PlayerVehicle>): void {
		const vehicle = this.playerVehicles.find(v => v.driver.id === driverId);
		if (!vehicle) return;

		Object.assign(vehicle, updates);
		this.updateVehicleVisuals(vehicle);
	}

	/**
	 * Clear all vehicle visual elements
	 */
	private clearVehicleElements(): void {
		for (const elements of this.vehicleElements.values()) {
			this.removeChild(elements.container);
		}
		this.vehicleElements.clear();
	}

	/**
	 * Create visual elements for player vehicles
	 */
	private createVehicleElements(): void {
		if (this.playerVehicles.length === 0) return;

		const layerWidth = this.getWidth();
		const layerHeight = this.getHeight();
		
		// Player vehicles are fixed size cards - slightly larger than enemy cards
		const vehicleWidth = 200; // Fixed width for player vehicle cards
		const vehicleHeight = Math.floor(layerHeight * 0.6); // 60% of layer height
		const startY = Math.floor(layerHeight * 0.3); // Start at 30% down
		
		// Calculate spacing between vehicles
		const cardSpacing = 30; // More spacing for player vehicles
		const totalWidth = this.playerVehicles.length * vehicleWidth + (this.playerVehicles.length - 1) * cardSpacing;
		const startX = Math.floor((layerWidth - totalWidth) / 2);
		
		this.playerVehicles.forEach((vehicle, index) => {
			const x = startX + index * (vehicleWidth + cardSpacing);
			
			const elements = this.createSingleVehicleElement(vehicle, x, startY, vehicleWidth, vehicleHeight);
			this.vehicleElements.set(vehicle.driver.id, elements);
			this.addChild(elements.container);
		});
	}

	/**
	 * Create visual elements for a single player vehicle
	 */
	private createSingleVehicleElement(
		vehicle: PlayerVehicle,
		x: number,
		y: number,
		width: number,
		height: number
	) {
		// Container for this vehicle
		const container = new Layer({
			x,
			y,
			width,
			height,
		});

		// Vehicle portrait (larger than enemies)
		const portrait = new Rectangle({
			x: 0,
			y: 0,
			width,
			height: Math.floor(height * 0.65),
			style: {
				backgroundColor: '#5a4a3a',
				borderColor: '#7a6a5a',
				borderWidth: 3,
			},
		});
		container.addChild(portrait);

		// Driver portrait inset (small)
		const driverPortrait = new Rectangle({
			x: Math.floor(width * 0.05),
			y: Math.floor(height * 0.05),
			width: 40,
			height: 40,
			style: {
				backgroundColor: '#6a5a4a',
				borderColor: '#8a7a6a',
				borderWidth: 2,
				borderRadius: 20,
			},
		});
		container.addChild(driverPortrait);

		// Vehicle name
		const nameText = new Text(`${vehicle.driver.metadata.name}'s ${vehicle.driver.metadata.vehicleName}`, {
			width: Math.floor(width * 0.9),
			style: {
				fontSize: 14,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
				whiteSpace: 'normal',
			},
		});
		nameText.setPosition(Math.floor(width * 0.05), Math.floor(height * 0.68));
		container.addChild(nameText);

		// Health bar background
		const healthBar = new Rectangle({
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.78),
			width: Math.floor(width * 0.8),
			height: 12,
			style: {
				backgroundColor: '#333333',
				borderColor: '#555555',
				borderWidth: 1,
			},
		});
		container.addChild(healthBar);

		// Health bar fill
		const healthPercentage = vehicle.currentHealth / vehicle.maxHealth;
		const healthBarFill = new Rectangle({
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.78),
			width: Math.floor(width * 0.8 * healthPercentage),
			height: 12,
			style: {
				backgroundColor: healthPercentage > 0.6 ? '#4a8a4a' : healthPercentage > 0.3 ? '#8a8a4a' : '#8a4a4a',
			},
		});
		container.addChild(healthBarFill);

		// Health text
		const healthText = new Text(`${vehicle.currentHealth}/${vehicle.maxHealth} HP`, {
			style: {
				fontSize: 12,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		healthText.setPosition(Math.floor(width / 2), Math.floor(height * 0.84));
		container.addChild(healthText);

		// Armor display (visual armor plating)
		const armorDisplay = new Rectangle({
			x: Math.floor(width * 0.1),
			y: Math.floor(height * 0.88),
			width: Math.floor(width * 0.3),
			height: 20,
			style: {
				backgroundColor: vehicle.armor > 0 ? '#6a6aaa' : '#4a4a4a',
				borderColor: '#8a8aaa',
				borderWidth: 1,
			},
		});
		container.addChild(armorDisplay);

		const armorText = new Text(`${vehicle.armor} Armor`, {
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
			},
		});
		armorText.setPosition(Math.floor(width * 0.25), Math.floor(height * 0.90));
		container.addChild(armorText);

		// Status effects container
		const statusContainer = new Layer({
			x: Math.floor(width * 0.6),
			y: Math.floor(height * 0.88),
			width: Math.floor(width * 0.35),
			height: 20,
		});
		container.addChild(statusContainer);

		// Add status effect indicators
		this.updateStatusEffects(vehicle, statusContainer);

		return {
			container,
			portrait,
			healthBar,
			healthBarFill,
			healthText,
			armorDisplay,
			armorText,
			nameText,
			driverPortrait,
			statusContainer,
		};
	}

	/**
	 * Update visual elements for a specific vehicle
	 */
	private updateVehicleVisuals(vehicle: PlayerVehicle): void {
		const elements = this.vehicleElements.get(vehicle.driver.id);
		if (!elements) return;

		// Update health bar
		const healthPercentage = vehicle.currentHealth / vehicle.maxHealth;
		const healthBarWidth = Math.floor(elements.healthBar.getWidth() * healthPercentage);
		elements.healthBarFill.setWidth(healthBarWidth);
		elements.healthBarFill.setFillColor(
			healthPercentage > 0.6 ? '#4a8a4a' : healthPercentage > 0.3 ? '#8a8a4a' : '#8a4a4a'
		);

		// Update health text
		elements.healthText.setText(`${vehicle.currentHealth}/${vehicle.maxHealth} HP`);

		// Update armor
		elements.armorDisplay.setFillColor(vehicle.armor > 0 ? '#6a6aaa' : '#4a4a4a');
		elements.armorDisplay.setBorderColor('#8a8aaa');
		elements.armorDisplay.setBorderWidth(1);
		elements.armorText.setText(`${vehicle.armor} Armor`);

		// Update status effects
		this.updateStatusEffects(vehicle, elements.statusContainer);
	}

	/**
	 * Update status effect indicators
	 */
	private updateStatusEffects(vehicle: PlayerVehicle, statusContainer: Layer): void {
		// Clear existing status effects
		const children = [...statusContainer.getChildren()];
		children.forEach(child => statusContainer.removeChild(child));

		// Add current status effects
		vehicle.statusEffects.forEach((effect, index) => {
			const effectIcon = new Rectangle({
				x: index * 22,
				y: 0,
				width: 20,
				height: 20,
				style: {
					backgroundColor: effect.type === 'buff' ? '#4a8a4a' : '#8a4a4a',
					borderColor: '#ffffff',
					borderWidth: 1,
					borderRadius: 10,
				},
			});
			statusContainer.addChild(effectIcon);

			// Duration indicator
			if (effect.duration > 0) {
				const durationText = new Text(effect.duration.toString(), {
					style: {
						fontSize: 8,
						color: '#ffffff',
						textAlign: 'center',
						fontWeight: 'bold',
					},
				});
				durationText.setPosition(index * 22 + 10, 10);
				statusContainer.addChild(durationText);
			}
		});
	}

	/**
	 * Get player vehicles that can be targeted (for healing/buff cards)
	 */
	public getTargetableVehicles(): PlayerVehicle[] {
		return this.playerVehicles.filter(vehicle => vehicle.currentHealth > 0);
	}

	/**
	 * Get vehicle at screen position (for targeting)
	 */
	public getVehicleAtPosition(x: number, y: number): PlayerVehicle | null {
		// Convert to local coordinates
		const localPos = this.globalToLocal(x, y);
		
		for (const [driverId, elements] of this.vehicleElements) {
			const container = elements.container;
			if (localPos.x >= container.getX() && 
				localPos.x <= container.getX() + container.getWidth() &&
				localPos.y >= container.getY() && 
				localPos.y <= container.getY() + container.getHeight()) {
				return this.playerVehicles.find(v => v.driver.id === driverId) || null;
			}
		}
		
		return null;
	}

	/**
	 * Highlight vehicle for targeting
	 */
	public highlightVehicle(driverId: string, color: string): void {
		const elements = this.vehicleElements.get(driverId);
		if (!elements) return;

		elements.portrait.setFillColor('#5a4a3a');
		elements.portrait.setBorderColor(color);
		elements.portrait.setBorderWidth(4);
	}

	/**
	 * Clear all vehicle highlights
	 */
	public clearHighlights(): void {
		for (const elements of this.vehicleElements.values()) {
			elements.portrait.setFillColor('#5a4a3a');
			elements.portrait.setBorderColor('#7a6a5a');
			elements.portrait.setBorderWidth(3);
		}
	}

	/**
	 * Set targeting callback
	 */
	public setOnTarget(callback: ((vehicle: PlayerVehicle) => void) | null): void {
		this.onTargetCallback = callback;
	}

	/**
	 * Set up targeting click handling
	 */
	private setupTargeting(): void {
		InputSystem.registerMouseDown(this, () => {
			if (!this.onTargetCallback) return;

			const mousePos = InputSystem.getMousePosition();
			const targetedVehicle = this.getVehicleAtPosition(mousePos.x, mousePos.y);
			
			if (targetedVehicle) {
				this.onTargetCallback(targetedVehicle);
			}
		});
	}
	
	/**
	 * Handle layer resize
	 */
	protected onResized(): void {
		// Update background size
		const background = this.children[0] as Rectangle;
		if (background) {
			background.setWidth(this.getWidth());
			background.setHeight(this.getHeight());
		}
		
		// Vehicle elements will be re-positioned on next updateVehicles call
	}
}