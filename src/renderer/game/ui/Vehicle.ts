import { Component, ComponentOptions, PointerEvents } from '../../engine/components/Component';
import { Container } from '../../engine/components/Container';
import { Rectangle } from '../../engine/components/Rectangle';
import { Text } from '../../engine/components/Text';
import { Vehicle as VehicleData } from '../mechanics/Vehicle';
import type { AnyUiEvent, UiDragEvent } from '../../engine/input/events';
import { CombatModel } from '../screens/combat/CombatModel';
import { resolveFontRole } from '../../engine/text/fontRoles';
import { tokens } from '../../engine/theme/tokens';
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

/** Every run on the plate is the token scale's smallest size, on tight lines (R6.4a). */
const TEXT_SIZE = tokens.fontSize.fs_xs;
const TEXT_LINE_HEIGHT = tokens.lineHeight.lh_tight;
const VALUE_ROLE = resolveFontRole({ weight: 'bold' });
const INSET_X = tokens.space.space_1_5;
const INSET_Y = tokens.space.space_1;
const GAP = tokens.space.space_1;
const ROW_GAP = tokens.space.space_0_5;
const DRIVER_PORTRAIT_SIZE = 20;
const TRACK_HEIGHT = 10;
const BADGE_HEIGHT = 16;

/**
 * Visual representation of a vehicle on the battlefield. Can be extended for
 * player/enemy specific styling.
 *
 * Every element is built once. The plate's size places them in the layout
 * phase (R8.18), so a resize moves them rather than rebuilding, and the
 * data decides which show: the driver row while there is a driver, and an
 * escort's SPENT chip once it has acted. A driven vehicle that loses its
 * driver becomes an escort mid-fight, and only visibility changes.
 *
 * Rows stack from the plate's measured lines rather than fractions of its
 * height, so the smallest plate (an enemy's, 140x91 on the stage) holds them
 * at the token sizes: the driver's name beside its portrait with the HP
 * under it, the vehicle's name at the foot of the portrait, the structure
 * value beside its track, and the armor badge along the bottom.
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
				fontSize: TEXT_SIZE,
				color: '#cccccc',
				textAlign: 'left',
			},
			lineHeight: TEXT_LINE_HEIGHT,
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.addChild(this.driverNameText);

		this.driverHpText = new Text('', {
			id: this.childId('driver_hp'),
			style: {
				fontSize: TEXT_SIZE,
				color: '#aaaaaa',
				textAlign: 'left',
			},
			lineHeight: TEXT_LINE_HEIGHT,
		});
		this.addChild(this.driverHpText);

		// Just the vehicle's name; the driver's is on its own row
		this.nameText = new Text('', {
			id: this.childId('name'),
			style: {
				fontSize: TEXT_SIZE,
				color: '#ffffff',
				textAlign: 'center',
				fontWeight: 'bold',
			},
			lineHeight: TEXT_LINE_HEIGHT,
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.addChild(this.nameText);

		this.healthBar = new Rectangle({
			id: this.childId('structure_track'),
			height: TRACK_HEIGHT,
			style: {
				backgroundColor: '#333333',
				borderColor: '#555555',
				borderWidth: 1,
			},
		});
		this.addChild(this.healthBar);

		this.healthBarFill = new Rectangle({
			id: this.childId('structure_fill'),
			height: TRACK_HEIGHT,
			style: {
				backgroundColor: '#4a8a4a',
			},
		});
		this.addChild(this.healthBarFill);

		this.healthText = new Text('', {
			id: this.childId('structure_value'),
			style: {
				fontSize: TEXT_SIZE,
				color: '#ffffff',
				textAlign: 'right',
				fontWeight: 'bold',
			},
			lineHeight: TEXT_LINE_HEIGHT,
		});
		this.addChild(this.healthText);

		// Armor and the status container share a line
		this.armorBadge = new ArmorBadge({
			id: this.childId('armor_badge'),
			minWidth: Math.floor(args.width * 0.25),
			height: BADGE_HEIGHT,
		});
		this.addChild(this.armorBadge);

		this.spentChip = new Text('SPENT', {
			id: this.childId('spent_chip'),
			style: {
				fontSize: TEXT_SIZE,
				color: '#ffcc66',
				fontWeight: 'bold',
			},
			lineHeight: TEXT_LINE_HEIGHT,
		});
		this.addChild(this.spentChip);

		// Status effect container (for future use)
		this.statusContainer = new Container({
			id: this.childId('status_container'),
			height: BADGE_HEIGHT,
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
		const contentWidth = width - INSET_X * 2;

		// From the bottom: the armor row, the structure row over it, and the
		// portrait takes what is left
		const badgeY = height - ROW_GAP - BADGE_HEIGHT;
		const structureHeight = Math.max(TRACK_HEIGHT, Math.ceil(this.healthText.getHeight()));
		const structureY = badgeY - ROW_GAP - structureHeight;
		const portraitHeight = structureY - ROW_GAP;

		this.portrait.setPosition(0, 0);
		this.portrait.setSize(width, portraitHeight);

		// The driver's name beside their portrait, the HP under both
		const driverPortraitSize = Math.min(DRIVER_PORTRAIT_SIZE, Math.floor(width * 0.15));
		this.driverPortrait.setPosition(INSET_X, INSET_Y);
		this.driverPortrait.setSize(driverPortraitSize, driverPortraitSize);
		const driverNameX = INSET_X + driverPortraitSize + GAP;
		this.driverNameText.setWidth(width - INSET_X - driverNameX);
		this.driverNameText.setPosition(driverNameX, INSET_Y + Math.round((driverPortraitSize - this.driverNameText.getHeight()) / 2));
		this.driverHpText.setPosition(INSET_X, INSET_Y + driverPortraitSize + ROW_GAP);

		this.nameText.setWidth(contentWidth);
		this.nameText.setPosition(INSET_X, Math.floor(portraitHeight - INSET_Y - this.nameText.getHeight()));

		// The value right-aligned in a column as wide as the full value, so
		// the track keeps its width as the structure falls
		const valueWidth = this.structureValueWidth();
		const trackWidth = contentWidth - (valueWidth > 0 ? valueWidth + GAP : 0);
		const trackY = structureY + Math.floor((structureHeight - TRACK_HEIGHT) / 2);
		this.healthBar.setPosition(INSET_X, trackY);
		this.healthBar.setWidth(trackWidth);
		this.healthBarFill.setPosition(INSET_X, trackY);
		this.placeHealthFill();
		this.healthText.setWidth(valueWidth);
		this.healthText.setPosition(width - INSET_X - valueWidth, structureY);

		this.armorBadge.setPosition(INSET_X, badgeY);
		this.armorBadge.minWidth = Math.floor(width * 0.25);

		// Right edge at the inset, from the chip's measured width
		this.spentChip.setPosition(width - INSET_X - this.spentChip.getWidth(), INSET_Y);

		this.statusContainer.setPosition(Math.floor(width * 0.4), badgeY);
		this.statusContainer.setWidth(Math.floor(width * 0.5));
	}

	/**
	 * The structure value's column: the measured width of the value at full
	 * structure, or nothing where text is not measured (a unit test's null
	 * backend).
	 */
	private structureValueWidth(): number {
		const draw = this.context?.draw;
		if (!draw || !draw.canMeasureText(VALUE_ROLE)) return 0;
		const { maxStructure } = this.vehicleData;
		return Math.ceil(draw.measureText({ text: `${maxStructure}/${maxStructure}`, font: VALUE_ROLE, size: TEXT_SIZE }).width);
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
			this.driverNameText.setText(driver.metadata.name);
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
			// A card dragged from the hand (R9.12): a vehicle it can land on
			// (a target, or one a no-target card acts on) accepts it, lights up
			// as the pointer's target, and is chosen by the drop
			case 'dragenter':
				this.dragEntered(event);
				return;
			case 'dragleave':
				this.dragLeft();
				return;
			case 'drop':
				this.dropped(event);
				return;
		}
	}

	/**
	 * A dragged card arriving: taken here when it can land on this vehicle.
	 * Public so something that stands for the vehicle outside its box (its
	 * intent row) can take a drop as the vehicle would.
	 */
	public dragEntered(event: UiDragEvent): void {
		if (this.combatData && this.isTargetable()) {
			event.accept();
			this.combatData.focusVehicle(this.vehicleData.id);
		}
	}

	public dragLeft(): void {
		if (this.combatData && this.combatData.focusedVehicleId === this.vehicleData.id) {
			this.combatData.focusVehicle(null);
		}
	}

	public dropped(event: UiDragEvent): void {
		event.consume();
		this.chooseAsTarget();
	}

	/** `dropActive`, set while a dragged card would land here, lights the plate. */
	protected onStateChange(): void {
		if (this.portrait) this.updateVisualState();
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
		const focused = this.isFocusedTarget() || carrier || this.dropActive;
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
