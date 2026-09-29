import { Component, ComponentOptions, PointerEvents } from '../../engine/components/Component';
import { Container } from '../../engine/components/Container';
import { Rectangle } from '../../engine/components/Rectangle';
import { Text } from '../../engine/components/Text';
import { Vehicle as VehicleData } from '../mechanics/Vehicle';
import type { AnyUiEvent } from '../../engine/input/events';
import { CombatModel } from '../screens/combat/CombatModel';
import { ArmorBadge } from './ArmorBadge';

export interface VehicleOptions extends ComponentOptions {
	x: number;
	y: number;
	width: number;
	height: number;
	vehicleData: VehicleData;
	combatData?: CombatModel;
	onClick?: (vehicle: VehicleData) => void;
}

/**
 * Visual representation of a vehicle on the battlefield. Can be extended for
 * player/enemy specific styling.
 *
 * Every element is built once. The plate's size places them in the layout
 * phase (R8.18), so a resize moves them rather than rebuilding, and the
 * data decides which show: the driver row while there is a driver, and an
 * escort's SPENT chip once it has acted. A driven vehicle that loses its
 * driver becomes an escort mid-fight, and only visibility changes.
 */
export class Vehicle extends Component {
	protected vehicleData: VehicleData;

	// UI elements
	protected portrait: Rectangle;
	protected driverPortrait: Rectangle;
	protected driverNameText: Text;
	protected driverHpText: Text;
	protected nameText: Text;
	protected healthBar: Rectangle;
	protected healthBarFill: Rectangle;
	protected healthText: Text;
	protected armorBadge: ArmorBadge;
	protected spentChip: Text;
	protected statusContainer: Container;

	// References
	private combatData: CombatModel | null = null;
	private onClickCallback: ((vehicle: VehicleData) => void) | null = null;

	private modelUnsubscribers: (() => void)[] = [];

	constructor(args: VehicleOptions) {
		super(args);
		this.componentType = 'Vehicle';
		this.vehicleData = args.vehicleData;
		this.combatData = args.combatData || null;
		this.onClickCallback = args.onClick || null;

		this.portrait = new Rectangle({
			id: this.childId('portrait'),
			style: {
				backgroundColor: this.getPortraitColor(),
				borderColor: this.getBorderColor(),
				borderWidth: 3,
			},
		});
		this.addChild(this.portrait);

		this.driverPortrait = new Rectangle({
			id: this.childId('driver_portrait'),
			style: {
				backgroundColor: '#6a5a4a',
				borderColor: '#8a7a6a',
				borderWidth: 1,
				borderRadius: 10,
			},
		});
		this.addChild(this.driverPortrait);

		this.driverNameText = new Text('', {
			id: this.childId('driver_name'),
			style: {
				fontSize: 9,
				color: '#cccccc',
				textAlign: 'left',
			},
		});
		this.addChild(this.driverNameText);

		this.driverHpText = new Text('', {
			id: this.childId('driver_hp'),
			style: {
				fontSize: 8,
				color: '#aaaaaa',
				textAlign: 'left',
			},
		});
		this.addChild(this.driverHpText);

		// Just the vehicle's name; the driver's is on its own row
		this.nameText = new Text('', {
			id: this.childId('name'),
			style: {
				fontSize: 10,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			wrap: 'word',
		});
		this.addChild(this.nameText);

		this.healthBar = new Rectangle({
			id: this.childId('structure_track'),
			height: 10,
			style: {
				backgroundColor: '#333333',
				borderColor: '#555555',
				borderWidth: 1,
			},
		});
		this.addChild(this.healthBar);

		this.healthBarFill = new Rectangle({
			id: this.childId('structure_fill'),
			height: 10,
			style: {
				backgroundColor: '#4a8a4a',
			},
		});
		this.addChild(this.healthBarFill);

		this.healthText = new Text('', {
			id: this.childId('structure_value'),
			style: {
				fontSize: 9,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
		});
		this.addChild(this.healthText);

		// Armor and the status container share a line
		this.armorBadge = new ArmorBadge({
			id: this.childId('armor_badge'),
			minWidth: Math.floor(args.width * 0.25),
			height: 16,
		});
		this.addChild(this.armorBadge);

		this.spentChip = new Text('SPENT', {
			id: this.childId('spent_chip'),
			style: {
				fontSize: 9,
				color: '#ffcc66',
				fontWeight: 'bold',
			},
		});
		this.addChild(this.spentChip);

		// Status effect container (for future use)
		this.statusContainer = new Container({
			id: this.childId('status_container'),
			height: 16,
		});
		this.addChild(this.statusContainer);

		this.updateVisuals();
	}

	/**
	 * Update the vehicle data and refresh visuals
	 */
	public set data(vehicleData: VehicleData) {
		this.vehicleData = vehicleData;
		this.updateVisuals();
		this.updateVisualState();
	}

	/**
	 * Get the vehicle data
	 */
	public get data(): VehicleData {
		return this.vehicleData;
	}

	/**
	 * Composite internals derive their ids from the vehicle's own id, so a
	 * caller names the vehicle once. Unnamed vehicles leave children unnamed.
	 */
	protected childId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}

	/** The layout phase: the plate was sized, or a text in it measured (R8.18). */
	protected layoutChildren(): void {
		this.placeElements();
	}

	/**
	 * Every element from the plate's size. Subclasses place their own
	 * additions after calling this.
	 */
	protected placeElements(): void {
		const width = this.getWidth();
		const height = this.getHeight();

		this.portrait.setPosition(0, 0);
		this.portrait.setSize(width, Math.floor(height * 0.65));

		const driverPortraitSize = Math.min(20, Math.floor(width * 0.15));
		this.driverPortrait.setPosition(Math.floor(width * 0.05), Math.floor(height * 0.05));
		this.driverPortrait.setSize(driverPortraitSize, driverPortraitSize);
		this.driverNameText.setPosition(Math.floor(width * 0.05), Math.floor(height * 0.30));
		this.driverHpText.setPosition(Math.floor(width * 0.05), Math.floor(height * 0.42));

		this.nameText.setPosition(Math.floor(width * 0.05), Math.floor(height * 0.55));
		this.nameText.setWidth(Math.floor(width * 0.9));

		this.healthBar.setPosition(Math.floor(width * 0.1), Math.floor(height * 0.68));
		this.healthBar.setWidth(Math.floor(width * 0.8));
		this.healthBarFill.setPosition(Math.floor(width * 0.1), Math.floor(height * 0.68));
		this.placeHealthFill();
		this.healthText.setPosition(0, Math.floor(height * 0.73));
		this.healthText.setWidth(width);

		this.armorBadge.setPosition(Math.floor(width * 0.1), Math.floor(height * 0.82));
		this.armorBadge.minWidth = Math.floor(width * 0.25);

		// Right edge at 95 percent of the width, from the chip's measured width
		this.spentChip.setPosition(
			Math.floor(width * 0.95 - this.spentChip.getWidth()),
			Math.floor(height * 0.05),
		);

		this.statusContainer.setPosition(Math.floor(width * 0.4), Math.floor(height * 0.82));
		this.statusContainer.setWidth(Math.floor(width * 0.5));
	}

	/** The fill's width is the track's, scaled by the structure left. */
	private placeHealthFill(): void {
		const healthPercentage = this.vehicleData.structure / this.vehicleData.maxStructure;
		this.healthBarFill.setWidth(Math.floor(this.healthBar.getWidth() * healthPercentage));
		this.healthBarFill.setFillColor(this.getHealthColor(healthPercentage));
	}

	/**
	 * Update visual elements with current vehicle data
	 */
	protected updateVisuals(): void {
		const data = this.vehicleData;
		this.nameText.setText(data.name);

		const driver = data.driver;
		this.driverPortrait.setVisible(Boolean(driver));
		this.driverNameText.setVisible(Boolean(driver));
		this.driverHpText.setVisible(Boolean(driver));
		if (driver) {
			this.driverNameText.setText(`Driver: ${driver.metadata.name}`);
			this.driverHpText.setText(`HP: ${driver.hitpoints}/${driver.maxHitpoints}`);
		}

		this.placeHealthFill();
		this.healthText.setText(`${data.structure}/${data.maxStructure}`);

		// Shield is temporary armor on top
		this.armorBadge.armor = data.armor;
		this.armorBadge.shield = data.shield ?? 0;

		// An escort shows SPENT once it has acted this turn
		this.spentChip.setVisible(Boolean(data.isEscort && data.spent));
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
	 * Get vehicle ID
	 */
	public get vehicleId(): string {
		return this.vehicleData.id;
	}

	/** R8.29: the plate is one target; its portrait, bars, and text are internals. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/** A click chooses the vehicle as a target in handleEvent. */
	public get handlesPointer(): boolean {
		return true;
	}

	/**
	 * Hover focuses the vehicle for a targeting preview; a click on a
	 * targetable vehicle is the target choice. `hovered` is already set when
	 * the enter and leave arrive (R9.8). The keyboard does the same through
	 * focus and `activate`: a vehicle is focusable only while it is a target
	 * choice, so Tab and the arrows visit exactly the targets (R9.18, R9.26).
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'click':
				this.chooseAsTarget();
				return;
			case 'activate':
				event.consume();
				this.chooseAsTarget();
				return;
			case 'focus':
				if (this.combatData && this.combatData.isTargeting) {
					this.combatData.focusVehicle(this.vehicleData.id);
				}
				return;
			case 'blur':
				if (this.combatData && this.combatData.focusedVehicleId === this.vehicleData.id && !this.hovered) {
					this.combatData.focusVehicle(null);
				}
				return;
			case 'pointerenter':
				if (this.combatData && this.combatData.isTargeting) {
					this.combatData.focusVehicle(this.vehicleData.id);
				}
				this.updateVisualState();
				return;
			case 'pointerleave':
				if (this.combatData && this.combatData.focusedVehicleId === this.vehicleData.id) {
					this.combatData.focusVehicle(null);
				}
				this.updateVisualState();
				return;
		}
	}

	private chooseAsTarget(): void {
		if (this.onClickCallback && this.isTargetable()) {
			this.onClickCallback(this.vehicleData);
		}
	}

	/**
	 * Model subscriptions are registered on mount and released on unmount
	 * (R8.14), so a remount subscribes again. The state is read fresh too:
	 * the model may have moved on while the plate was detached.
	 */
	protected onMount(): void {
		const model = this.combatData;
		if (!model) return;
		const refresh = (): void => this.updateVisualState();
		this.modelUnsubscribers.push(
			model.on('targetableVehicleIds', refresh),
			model.on('focusedVehicleId', refresh),
			// The escort an attack order would use
			model.on('carrierVehicleId', refresh),
			model.on('isTargeting', refresh),
		);
		this.updateVisualState();
	}

	/** Model subscriptions are the vehicle's own; input is released by the base. */
	protected onUnmount(): void {
		this.modelUnsubscribers.forEach(unsubscribe => unsubscribe());
		this.modelUnsubscribers = [];
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
		this.focusable = targeting && this.onClickCallback !== null && this.isTargetable();

		// Non-targetable vehicles get dimmed colors
		if (!targetable && targeting) {
			this.portrait.setFillColor('#3a3a3a');
		} else {
			this.portrait.setFillColor(this.getPortraitColor());
		}

		if (focused && targetable) {
			this.portrait.setBorderWidth(4);
			this.portrait.setBorderColor(this.getFocusedBorderColor());
		} else if (this.hovered && targetable) {
			this.portrait.setBorderWidth(4);
			this.portrait.setBorderColor(this.getBorderColor());
		} else {
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
}
