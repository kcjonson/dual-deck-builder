import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../../engine/components/Component';
import { Container } from '../../engine/components/Container';
import { Rectangle } from '../../engine/components/Rectangle';
import { Text } from '../../engine/components/Text';
import { Vehicle as VehicleData } from '../mechanics/Vehicle';
import type { AnyUiEvent, UiDragEvent } from '../../engine/input/events';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions } from '../../engine/draw/commands';
import { resolveColor } from '../../engine/style/styleObject';
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

const STRUCTURE_BAR_HEIGHT = 10;
const TRACK_FILL = resolveColor('#333333');
const TRACK_BORDER = { color: resolveColor('#555555'), width: 1 };

/** A rect the plate redraws every frame and moves in its layout phase. */
function emptyRect(): { x: number; y: number; width: number; height: number } {
	return { x: 0, y: 0, width: 0, height: 0 };
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
 *
 * The portrait panel and the structure bar are the plate's own draws, so
 * the text on them is on the plate rather than over a sibling; the rows
 * below the driver are placed from the measured heights above them, so a
 * short plate pushes them down rather than stacking them on each other.
 */
export class Vehicle extends Component {
	protected vehicleData: VehicleData;

	// UI elements
	private readonly portraitDraw: DrawRectOptions;
	private readonly portraitBorder = { color: resolveColor('#000000'), width: 3 };
	private readonly trackDraw: DrawRectOptions = { rect: emptyRect(), fill: TRACK_FILL, border: TRACK_BORDER };
	private readonly fillDraw: DrawRectOptions = { rect: emptyRect(), fill: TRACK_FILL };
	protected driverPortrait: Rectangle;
	protected driverNameText: Text;
	protected driverHpText: Text;
	protected nameText: Text;
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

		this.portraitBorder.color = resolveColor(this.getBorderColor());
		this.portraitDraw = {
			id: this.id ?? undefined,
			rect: emptyRect(),
			fill: resolveColor(this.getPortraitColor()),
			border: this.portraitBorder,
		};

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
		const inset = Math.floor(width * 0.05);

		const portrait = this.portraitDraw.rect;
		portrait.width = width;
		portrait.height = Math.floor(height * 0.65);

		const driverPortraitSize = Math.min(20, Math.floor(width * 0.15));
		this.driverPortrait.setPosition(inset, Math.floor(height * 0.05));
		this.driverPortrait.setSize(driverPortraitSize, driverPortraitSize);

		// Each row starts at its share of the height or below the row above,
		// whichever is lower
		let rowBottom = 0;
		if (this.driverNameText.isVisible()) {
			this.driverNameText.setPosition(inset, Math.floor(height * 0.30));
			const hpY = Math.max(Math.floor(height * 0.42), Math.ceil(this.driverNameText.getY() + this.driverNameText.getHeight()));
			this.driverHpText.setPosition(inset, hpY);
			rowBottom = hpY + this.driverHpText.getHeight();
		}

		const nameY = Math.max(Math.floor(height * 0.55), Math.ceil(rowBottom));
		this.nameText.setPosition(inset, nameY);
		this.nameText.setWidth(Math.floor(width * 0.9));

		// The value is centred on the bar
		const track = this.trackDraw.rect;
		track.x = Math.floor(width * 0.1);
		track.y = Math.max(Math.floor(height * 0.68), Math.ceil(nameY + this.nameText.getHeight()));
		track.width = Math.floor(width * 0.8);
		track.height = STRUCTURE_BAR_HEIGHT;
		this.placeHealthFill();
		this.healthText.setWidth(track.width);
		this.healthText.setPosition(track.x, track.y + (STRUCTURE_BAR_HEIGHT - this.healthText.getHeight()) / 2);

		const badgeY = Math.max(Math.floor(height * 0.82), Math.ceil(this.healthText.getY() + this.healthText.getHeight()));
		this.armorBadge.setPosition(Math.floor(width * 0.1), badgeY);
		this.armorBadge.minWidth = Math.floor(width * 0.25);

		// Right edge at 95 percent of the width, from the chip's measured width
		this.spentChip.setPosition(
			Math.floor(width * 0.95 - this.spentChip.getWidth()),
			Math.floor(height * 0.05),
		);

		this.statusContainer.setPosition(Math.floor(width * 0.4), badgeY);
		this.statusContainer.setWidth(Math.floor(width * 0.5));
	}

	/** The fill's width is the track's, scaled by the structure left. */
	private placeHealthFill(): void {
		const healthPercentage = this.vehicleData.structure / this.vehicleData.maxStructure;
		const track = this.trackDraw.rect;
		this.fillDraw.rect = { x: track.x, y: track.y, width: Math.floor(track.width * healthPercentage), height: track.height };
		this.fillDraw.fill = resolveColor(this.getHealthColor(healthPercentage));
	}

	public render(draw: DrawApi): void {
		draw.drawRect(this.portraitDraw);
		draw.drawRect(this.trackDraw);
		if (this.fillDraw.rect.width > 0) draw.drawRect(this.fillDraw);
	}

	/** The portrait panel is the plate's fill and border (R13.22). */
	public get resolvedColors(): ResolvedColors {
		return { fill: this.portraitDraw.fill ?? resolveColor(this.getPortraitColor()), border: this.portraitBorder.color };
	}

	/** The portrait panel and the structure track, in the plate's own space. */
	public get portraitRect(): Readonly<{ x: number; y: number; width: number; height: number }> {
		return this.portraitDraw.rect;
	}

	public get structureTrackRect(): Readonly<{ x: number; y: number; width: number; height: number }> {
		return this.trackDraw.rect;
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
		if (this.portraitDraw) this.updateVisualState();
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
		this.portraitDraw.fill = resolveColor(!targetable && targeting ? '#3a3a3a' : this.getPortraitColor());

		if (focused && targetable) {
			this.portraitBorder.width = 4;
			this.portraitBorder.color = resolveColor(this.getFocusedBorderColor());
		} else if (this.hovered && targetable) {
			this.portraitBorder.width = 4;
			this.portraitBorder.color = resolveColor(this.getBorderColor());
		} else {
			this.portraitBorder.width = 3;
			this.portraitBorder.color = resolveColor(this.getBorderColor());
		}
	}

	/**
	 * Get border color for focused state - can be overridden
	 */
	protected getFocusedBorderColor(): string {
		return '#88ff88'; // Default green for focused targets
	}
}
