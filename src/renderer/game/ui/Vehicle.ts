import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../../engine/components/Component';
import { Text } from '../../engine/components/Text';
import { drawIcon, DrawIconOptions } from '../../engine/components/Icon';
import { grownRect } from '../../engine/components/componentGeometry';
import type { AnyUiEvent, UiDragEvent } from '../../engine/input/events';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawPolygonOptions, DrawRectOptions, DrawTextOptions } from '../../engine/draw/commands';
import type { RGBA, Rect, Vec2 } from '../../engine/draw/geometry';
import { triangulatePolygon } from '../../engine/draw';
import { resolveColor } from '../../engine/style/styleObject';
import { shadowExtent } from '../../engine/style/look';
import { tokens } from '../../engine/theme/tokens';
import type { Driver } from '../mechanics/Driver';
import { Vehicle as VehicleData } from '../mechanics/Vehicle';
import { CombatModel } from '../screens/combat/CombatModel';
import { EnemyIntent, IntentRow } from './IntentMarker';
import { StatusChip, StatusChipContent, STATUS_CHIP_SIZE, shieldChipContent, statusChipContent } from './StatusChip';
import { MARK_COLORS, TargetMark, TargetMarkDraw, seatMark } from './targetMarks';
import { VehicleSprite, spriteKindOf } from './vehicleSprites';
import { RangeChip, RangeLabel } from './RangeChip';
import { dashedOutlineTriangles, hatchTriangles } from './stripes';
import type { AimLosses } from '../mechanics/AimPreview';
import { TOKEN_HEIGHT, TOKEN_MAX_SCALE, TOKEN_SLOT_CLEARANCE_X, TOKEN_SLOT_CLEARANCE_Y, TOKEN_WIDTH } from './tokenGeometry';

export { TOKEN_HEIGHT, TOKEN_MAX_SCALE, TOKEN_PASSENGER_HEIGHT, TOKEN_WIDTH, slotScale } from './tokenGeometry';

/** Whose convoy a token is in: yours, or the raiders'. */
export type VehicleSide = 'player' | 'raider';

export interface VehicleOptions extends Omit<ComponentOptions, 'onClick' | 'width' | 'height'> {
	vehicleData: VehicleData;
	side?: VehicleSide;
	combatData?: CombatModel;
	/**
	 * The player's driver seat a driver sits in (1 or 2), which gives the
	 * plate its mark and the passenger row its tag. Null for a raider's
	 * driver, or without one.
	 */
	seatOf?: (driver: Driver) => 1 | 2 | null;
	/** Choosing the vehicle as a target, with its data; not the component's own `onClick`. */
	onClick?: (vehicle: VehicleData) => void;
}

/** A slot as the road hands it to a token: where it is in the token's parent, and how big. */
export interface SlotRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

const INTENT_HEIGHT = 24;
const SPRITE_BOX = { x: 0, y: 30, width: 60, height: 40 };
const SPEED_Y = 72;
const SPEED_ICON = 12;
const SPEED_TEXT_X = SPEED_ICON + 1;
const PLATE_X = 64;
const PLATE_Y = 26;
const PLATE_WIDTH = TOKEN_WIDTH - PLATE_X;
const PLATE_MIN_HEIGHT = 68;
const PLATE_PAD_Y = 5;
const PLATE_PAD_RIGHT = 6;
/** A plate with an owner's stripe down its left edge starts its content past it. */
const PLATE_PAD_LEFT = 6;
const PLATE_PAD_LEFT_STRIPED = 9;
const STRIPE_WIDTH = 3;
const PLATE_RADIUS = 3;
const ROW_GAP = 4;
const NAME_ROW = 16;
const MARK_SIZE = 12;
const MARK_GAP = 5;
const STRUCTURE_ROW = 18;
const STRUCTURE_BAR = 16;
const HP_ROW = 16;
const HP_BAR = 14;
const PASSENGER_ROW = 14;
const PASSENGER_BAR = 12;
const PASSENGER_MARK = 10;
/** The armor shield, the heart, and the passenger tag share a column this wide. */
const LEAD_WIDTH = 26;
const LEAD_GAP = 4;
const HEART_SIZE = 14;
const STATUS_GAP = 3;
const CHIP_GAP = 3;
/** Five chips, then "+N" (section 3). */
const MAX_STATUS_CHIPS = 5;
const OUTLINE_OFFSET = 3;

const NAME_SIZE = 15;
const BAR_VALUE_SIZE = 13;
const PASSENGER_VALUE_SIZE = 12;
const SPEED_SIZE = 12;
const TAG_SIZE = 10;
const STAMP_SIZE = 18;
const STAMP_CENTRE_X = 130;
const STAMP_TOP = 44;
const STAMP_PAD_X = 6;
const STAMP_PAD_Y = 2;
const STAMP_BORDER = 2;
const STAMP_TILT = -8 * Math.PI / 180;
/** Barlow Condensed's average advance plus the stamp's 0.2 em spacing; the stamp is sized from it, not measured. */
const STAMP_ADVANCE = 0.62;

// The mock's palette (section 7): structure green, armor steel, driver HP
// pink-red, the passenger's a darker pink
const PLATE_FILL = resolveColor('#0f1011');
const PLATE_EDGE = tokens.color.line_edge;
const BAR_TRACK = resolveColor('#26292b');
const STRUCTURE_FILL = resolveColor('#8fbf5c');
const ARMOR_FILL = resolveColor('#a9bccd');
const HP_FILL = resolveColor('#e7727a');
const PASSENGER_FILL = resolveColor('#c9656c');
const SPEED_COLOR = tokens.color.text_dim;
/** A targetable raider, and the one the pointer is on (the mock's `.valid` and `.targeted`). */
const RAIDER_TARGET = resolveColor('#ff6a55');
const RAIDER_TARGETABLE: RGBA = [1, 0.431, 0.353, 0.8];
/** Your own vehicles light in the interaction yellow when a card can land on them. */
const OWN_TARGET = tokens.color.accent;
const OWN_TARGETABLE = tokens.color.accent_glow;
const SPRITE_TINTS: Readonly<Record<'driver1' | 'driver2' | 'escort' | 'raider', RGBA>> = {
	driver1: resolveColor('#8a7b63'),
	driver2: resolveColor('#5f7f82'),
	escort: resolveColor('#77736a'),
	raider: resolveColor('#8a5a50'),
};
// A wreck greys out (the mock's grayscale and darken)
const WRECK_GREY = resolveColor('#4a4b4c');
const WRECK_DIM = resolveColor('#5c5d5e');
const WRECK_TEXT = resolveColor('#8a8b8c');
const STAMP_COLOR = resolveColor('#ff8a78');
/** The mock's `.dimmed`: an out-of-reach vehicle while a card is aimed. */
const DIMMED_OPACITY = 0.35;
/** The mock's `.valid` outline: 2 px dashes; `.targeted` is 3 px solid with a 22 px glow. */
const LEGAL_OUTLINE = { width: 2, dash: 6, gap: 4 };
const TARGET_OUTLINE_WIDTH = 3;
const TARGET_GLOW_BLUR = 22;
const RAIDER_GLOW: RGBA = [1, 0.353, 0.275, 0.45];
const OWN_GLOW = tokens.color.accent_glow;
/** The range chip at the token's top left (the mock's `.veh.grid .slotchip`). */
const RANGE_CHIP_Y = 2;
/** The mock's `i.ghost`: amber stripes 4 px wide at 135 degrees over a darker amber. */
const GHOST_BASE = resolveColor('#c9953a');
const GHOST_STRIPE = resolveColor('#ffe2a0');
const GHOST_HATCH = { period: 8 * Math.SQRT2, stripe: 4 * Math.SQRT2 };

/** The mock's `i-armor`, a shield in a 26x18 box, as one outline. */
const ARMOR_OUTLINE: readonly [number, number][] = [
	[13, 0.5], [25, 3], [25, 9.5], [23.6, 12.6], [20.2, 15.3], [16.8, 16.8], [13, 17.5],
	[9.2, 16.8], [5.8, 15.3], [2.4, 12.6], [1, 9.5], [1, 3],
];

/** A rect the token redraws every frame and moves when its data changes. */
function rectAt(x = 0, y = 0, width = 0, height = 0): { x: number; y: number; width: number; height: number } {
	return { x, y, width, height };
}

/**
 * A vehicle on the road (Battle Screen Design, section 3): the 196x117
 * token, 135 tall with a passenger, laid out at x1 and scaled as a whole
 * to fill its slot.
 *
 * - An intents row over the full width, right-aligned (raiders only).
 * - A 60x40 rear-view sprite, with the speed under it.
 * - A 132x68 plate: the owner's mark and the name, ellipsized, with the full
 *   name on hover; the armor shield beside the structure bar; the driver's
 *   HP bar at the same weight, since you lose when drivers die. An escort
 *   has no driver and no HP bar. A passenger adds an 18 px row.
 * - Up to five status chips under the plate, then "+N"; an escort's SPENT
 *   leads them once it has acted.
 * - A wreck greys out under a WRECKED stamp (an unmanned raider reads NO
 *   DRIVER) for the turn it dies, until it leaves the road.
 *
 * Geometry is fixed, so every part is built once and placed when the data
 * changes; nothing is laid out from the token's size. The host places it
 * with `fitToSlot`, which is allocation-free so a swerve can call it every
 * frame.
 *
 * The token is one target (`auto`): its own box takes clicks and drops,
 * and its text is transparent to hits, so the only things inside that the
 * pointer reaches are the ones with tooltips of their own (intents and
 * status chips). Their events bubble here, so a card dropped on a chip or
 * an intent lands on the vehicle.
 */
export class Vehicle extends Component {
	protected vehicleData: VehicleData;
	public readonly side: VehicleSide;

	// The token's own draws, moved in place
	private readonly sprite = new VehicleSprite({ box: SPRITE_BOX });
	private readonly speedIconDraw: DrawIconOptions = { glyph: 'keyboard_double_arrow_right', size: SPEED_ICON, tint: SPEED_COLOR, box: rectAt(0, SPEED_Y, SPEED_ICON, SPEED_ICON) };
	private readonly plateEdge: { color: RGBA; width: number } = { color: PLATE_EDGE, width: 1 };
	private readonly plateDraw: DrawRectOptions = { rect: rectAt(PLATE_X, PLATE_Y, PLATE_WIDTH, PLATE_MIN_HEIGHT), fill: PLATE_FILL, radius: PLATE_RADIUS, border: this.plateEdge };
	private readonly stripeDraw: DrawRectOptions = { rect: rectAt(PLATE_X, PLATE_Y, STRIPE_WIDTH, PLATE_MIN_HEIGHT), fill: PLATE_FILL, radius: [PLATE_RADIUS, 0, 0, PLATE_RADIUS] };
	private hasStripe = false;
	private readonly ownMark = new TargetMarkDraw();
	private readonly armorDraw: DrawPolygonOptions & { fill: RGBA };
	private readonly structureTrack: DrawRectOptions = { rect: rectAt(), fill: BAR_TRACK, radius: 2 };
	private readonly structureFill: DrawRectOptions = { rect: rectAt(), fill: STRUCTURE_FILL, radius: 2 };
	private readonly heartDraw: DrawIconOptions = { glyph: 'favorite', size: HEART_SIZE, tint: HP_FILL, box: rectAt() };
	private readonly hpTrack: DrawRectOptions = { rect: rectAt(), fill: BAR_TRACK, radius: 2 };
	private readonly hpFill: DrawRectOptions = { rect: rectAt(), fill: HP_FILL, radius: 2 };
	private readonly passengerMark = new TargetMarkDraw();
	private readonly passengerTrack: DrawRectOptions = { rect: rectAt(), fill: BAR_TRACK, radius: 2 };
	private readonly passengerFill: DrawRectOptions = { rect: rectAt(), fill: PASSENGER_FILL, radius: 2 };
	private readonly outlineBorder: { color: RGBA; width: number } = { color: RAIDER_TARGET, width: 2 };
	private readonly outlineDraw: DrawRectOptions = { rect: rectAt(), fill: [0, 0, 0, 0], radius: PLATE_RADIUS + OUTLINE_OFFSET, border: this.outlineBorder };
	/** The legal-target outline's dashes, rebuilt only when the plate's height changes. */
	private readonly dashPoints: Vec2[] = [];
	private readonly dashDraw: DrawPolygonOptions & { fill: RGBA } = { points: this.dashPoints, fill: RAIDER_TARGETABLE };
	private dashedForHeight = -1;
	private readonly glowShadow = { color: RAIDER_GLOW, blur: TARGET_GLOW_BLUR };
	private readonly glowDraw: DrawRectOptions = { rect: rectAt(PLATE_X, PLATE_Y, PLATE_WIDTH, PLATE_MIN_HEIGHT), fill: [0, 0, 0, 0], radius: PLATE_RADIUS, shadow: this.glowShadow };
	private outlineStyle: 'none' | 'dashed' | 'solid' = 'none';
	private ghostLosses: AimLosses | null = null;
	private readonly ghosts: { base: DrawRectOptions; stripes: DrawPolygonOptions; shown: boolean }[] = [];
	private showHpRow = true;
	private showPassengerRow = false;
	private wrecked = false;
	private plateHeight = PLATE_MIN_HEIGHT;

	// Parts with text or tooltips of their own
	protected readonly intentRow: IntentRow;
	protected readonly nameText: Text;
	protected readonly armorText: Text;
	protected readonly structureText: Text;
	protected readonly hpText: Text;
	protected readonly passengerTagText: Text;
	protected readonly passengerText: Text;
	protected readonly speedText: Text;
	protected readonly statusChips: StatusChip[] = [];
	protected readonly stamp: WreckStamp;
	protected readonly rangeChip: RangeChip;

	// Placement in the slot the host last gave, kept so a passenger joining
	// or leaving refits without the host asking
	private readonly slot: SlotRect = { x: 0, y: 0, width: 0, height: 0 };
	private hasSlot = false;
	private slotScaleOverride: number | null = null;
	private currentScale = 1;
	private readonly scaleTransform: { scale: number; origin: readonly [number, number] } = { scale: 1, origin: [0, 0] };

	// References
	private readonly combatData: CombatModel | null;
	private readonly onClickCallback: ((vehicle: VehicleData) => void) | null;
	private readonly seatResolver: ((driver: Driver) => 1 | 2 | null) | null;
	private modelUnsubscribers: (() => void)[] = [];

	constructor({ onClick, vehicleData, side = 'player', combatData, seatOf, ...options }: VehicleOptions) {
		super({ ...options, width: TOKEN_WIDTH, height: TOKEN_HEIGHT });
		this.componentType = 'Vehicle';
		this.vehicleData = vehicleData;
		this.side = side;
		this.combatData = combatData ?? null;
		this.onClickCallback = onClick ?? null;
		this.seatResolver = seatOf ?? null;

		const armorPoints = ARMOR_OUTLINE.map(([x, y]) => ({ x: x + PLATE_X, y }));
		this.armorDraw = { points: armorPoints, indices: triangulatePolygon(armorPoints), fill: ARMOR_FILL };

		this.intentRow = new IntentRow({
			id: this.childId('intents'),
			markerSize: INTENT_HEIGHT,
			width: TOKEN_WIDTH,
			height: INTENT_HEIGHT,
			distribution: 'end',
			crossAlign: 'center',
		});
		this.addChild(this.intentRow);

		this.rangeChip = new RangeChip({ id: this.childId('range'), x: 0, y: RANGE_CHIP_Y, zIndex: 1 });
		this.addChild(this.rangeChip);

		this.nameText = this.addText({ suffix: 'name', size: NAME_SIZE, role: 'display', align: 'left', ellipsis: true });
		this.armorText = this.addText({ suffix: 'armor', size: BAR_VALUE_SIZE, role: 'display', color: '#0f1011' });
		this.structureText = this.addText({ suffix: 'structure_value', size: BAR_VALUE_SIZE, role: 'display', shadow: true });
		this.hpText = this.addText({ suffix: 'driver_hp', size: BAR_VALUE_SIZE, role: 'display', shadow: true });
		this.passengerTagText = this.addText({ suffix: 'passenger_tag', size: TAG_SIZE, role: 'mono', color: 'text_dim', align: 'left' });
		this.passengerTagText.text = 'P';
		this.passengerText = this.addText({ suffix: 'passenger_hp', size: PASSENGER_VALUE_SIZE, role: 'display', shadow: true });
		this.speedText = this.addText({ suffix: 'speed', size: SPEED_SIZE, role: 'mono', color: 'text_dim', align: 'left' });

		for (let index = 0; index < MAX_STATUS_CHIPS + 1; index++) {
			const chip = new StatusChip({ id: this.childId(`status_${index}`) });
			this.statusChips.push(chip);
			this.addChild(chip);
		}

		// Over everything else on the token
		this.stamp = new WreckStamp({ id: this.childId('stamp'), zIndex: 1, pointerEvents: 'none' });
		this.stamp.visible = false;
		this.addChild(this.stamp);

		this.updateVisuals();
	}

	private addText({ suffix, size, role, color = 'text', align = 'center', ellipsis = false, shadow = false }: {
		suffix: string;
		size: number;
		role: 'display' | 'mono';
		color?: string;
		align?: 'left' | 'center';
		ellipsis?: boolean;
		shadow?: boolean;
	}): Text {
		const text = new Text({
			id: this.childId(suffix),
			style: { fontRole: role, fontSize: size, color, textAlign: align },
			verticalAlign: 'middle',
			lineHeight: 1,
			wrap: 'none',
			textOverflow: ellipsis ? 'ellipsis' : undefined,
			pointerEvents: 'none',
		});
		if (shadow) text.shadow = { color: resolveColor('#000000'), offset: { x: 0, y: 1 }, blur: 2 };
		this.addChild(text);
		return text;
	}

	/** The vehicle's data, from the battle; setting it redraws the token. */
	public set data(vehicleData: VehicleData) {
		this.vehicleData = vehicleData;
		this.updateVisuals();
		this.updateVisualState();
	}

	public get data(): VehicleData {
		return this.vehicleData;
	}

	/** A raider's plan for the enemy turn, in order; empty clears it. */
	public set intents(intents: readonly EnemyIntent[]) {
		this.intentRow.intents = intents;
	}

	public get intents(): readonly EnemyIntent[] {
		return this.intentRow.intents;
	}

	/**
	 * The range chip while a card is aimed (section 6): this vehicle's range
	 * from the slot the card acts from, or null to hide it.
	 */
	public get rangeLabel(): RangeLabel | null {
		return this.rangeChip.range;
	}

	public set rangeLabel(label: RangeLabel | null) {
		this.rangeChip.range = label;
	}

	/**
	 * What the aimed card would take off each bar if it lands, shown as a
	 * striped ghost over the end of the bar's fill; null clears it.
	 */
	public get damageGhost(): AimLosses | null {
		return this.ghostLosses;
	}

	public set damageGhost(losses: AimLosses | null) {
		const none = !losses || (losses.structure <= 0 && losses.driver <= 0 && losses.passenger <= 0);
		this.ghostLosses = none ? null : { ...losses };
		this.placeGhosts();
	}

	/** The row showing a raider's plan. */
	public get intentsRow(): IntentRow {
		return this.intentRow;
	}

	/** The scale the token draws at. */
	public get tokenScale(): number {
		return this.currentScale;
	}

	/** Grey, stamped, and off the targets: wrecked, or an unmanned raider. */
	public get isWrecked(): boolean {
		return this.wrecked;
	}

	/** Composite internals derive their ids from the vehicle's own id; unnamed vehicles leave children unnamed. */
	protected childId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}

	/**
	 * Place the token in a slot: scaled x1 to x1.25 to fill it and centred
	 * in it, the slot given in the token's parent's space. Pass `scale` to
	 * use one scale for every token on the road (the mock's single `k`); a
	 * passenger's taller token that `scale` would push out of its slot
	 * takes less, and either way it is held to x1 to x1.25. Returns whether
	 * the slot is big enough at x1. Allocates nothing, so a swerve can call
	 * it every frame; a passenger joining or leaving refits to the same slot.
	 */
	public fitToSlot(slot: SlotRect, scale?: number): boolean {
		this.slot.x = slot.x;
		this.slot.y = slot.y;
		this.slot.width = slot.width;
		this.slot.height = slot.height;
		this.hasSlot = true;
		this.slotScaleOverride = scale ?? null;
		return this.placeInSlot();
	}

	private placeInSlot(): boolean {
		const slot = this.slot;
		// slotScale's formula inline: an options object here would allocate every frame of a swerve
		const need = Math.min((slot.width - TOKEN_SLOT_CLEARANCE_X) / TOKEN_WIDTH, (slot.height - TOKEN_SLOT_CLEARANCE_Y) / this.height);
		const scale = Math.min(TOKEN_MAX_SCALE, Math.max(1, Math.min(this.slotScaleOverride ?? need, need)));
		this.applyScale(scale);
		this.setPosition(slot.x + (slot.width - TOKEN_WIDTH * scale) / 2, slot.y + (slot.height - this.height * scale) / 2);
		return need >= 1;
	}

	private applyScale(scale: number): void {
		if (scale === this.currentScale) return;
		this.currentScale = scale;
		this.scaleTransform.scale = scale;
		this.transform = this.scaleTransform;
	}

	/** The plate in viewport space, where a hit's number pops (CombatFxLayer). */
	public get plateScreenBounds(): Rect {
		const token = this.screenBounds;
		const scale = token.width / TOKEN_WIDTH;
		return { x: token.x + PLATE_X * scale, y: token.y + PLATE_Y * scale, width: PLATE_WIDTH * scale, height: this.plateHeight * scale };
	}

	/** The plate, the structure bar, and the driver's HP bar, in the token's own space. */
	public get plateRect(): Readonly<Rect> {
		return this.plateDraw.rect;
	}

	public get structureTrackRect(): Readonly<Rect> {
		return this.structureTrack.rect;
	}

	public get hpTrackRect(): Readonly<Rect> {
		return this.hpTrack.rect;
	}

	/** The mark the plate shows for its owner: a driver's seat, an escort's square, or none for a raider. */
	public get mark(): TargetMark | null {
		return this.ownMark.mark;
	}

	private markOf(driver: Driver | null): TargetMark | null {
		if (!driver) return null;
		const seat = this.seatResolver?.(driver) ?? null;
		return seat === null ? null : seatMark(seat);
	}

	private showPassengerRowFor(): boolean {
		return this.vehicleData.passenger !== null;
	}

	/** Everything that follows from the data: what shows, where, and in what colour. */
	protected updateVisuals(): void {
		const data = this.vehicleData;
		const escort = data.isEscort;
		this.wrecked = data.isOutOfFight;
		this.showHpRow = !escort;
		this.showPassengerRow = this.showPassengerRowFor();

		// Rows from the top of the plate: name, structure, then the driver
		// and the passenger when there are
		const rowsHeight = PLATE_PAD_Y + NAME_ROW + ROW_GAP + STRUCTURE_ROW
			+ (this.showHpRow ? ROW_GAP + HP_ROW : 0)
			+ (this.showPassengerRow ? ROW_GAP + PASSENGER_ROW : 0)
			+ PLATE_PAD_Y;
		this.plateHeight = Math.max(PLATE_MIN_HEIGHT, rowsHeight);
		const tokenHeight = PLATE_Y + this.plateHeight + STATUS_GAP + STATUS_CHIP_SIZE;
		if (tokenHeight !== this.height) this.setSize(TOKEN_WIDTH, tokenHeight);

		// The owner: a player's vehicle carries its driver's mark and stripe,
		// an escort its square; a raider neither
		const mark: TargetMark | null = this.side === 'raider' ? null : escort ? 'escort' : this.markOf(data.driver);
		this.hasStripe = mark !== null;
		const contentLeft = PLATE_X + (this.hasStripe ? PLATE_PAD_LEFT_STRIPED : PLATE_PAD_LEFT);
		const contentRight = TOKEN_WIDTH - PLATE_PAD_RIGHT;
		const ownerColor = mark === null || mark === 'both' ? null : resolveColor(MARK_COLORS[mark]);

		this.plateDraw.rect.height = this.plateHeight;
		this.stripeDraw.rect.height = this.plateHeight;
		this.stripeDraw.fill = this.wrecked ? WRECK_DIM : ownerColor ?? PLATE_EDGE;
		this.plateEdge.color = this.wrecked ? WRECK_DIM : ownerColor ?? PLATE_EDGE;

		// Name row: the mark, then the name, ellipsized, with the full name on hover
		let rowY = PLATE_Y + PLATE_PAD_Y;
		this.ownMark.place(mark, contentLeft, rowY + (NAME_ROW - MARK_SIZE) / 2, MARK_SIZE);
		this.ownMark.tint = this.wrecked ? WRECK_DIM : null;
		const nameX = mark === null ? contentLeft : contentLeft + MARK_SIZE + MARK_GAP;
		this.nameText.text = data.name;
		this.nameText.setPosition(nameX, rowY);
		this.nameText.setSize(contentRight - nameX, NAME_ROW);
		this.nameText.color = this.wrecked ? WRECK_TEXT : tokens.color.text;

		// Armor shield and structure
		rowY += NAME_ROW + ROW_GAP;
		const barX = contentLeft + LEAD_WIDTH + LEAD_GAP;
		const barWidth = contentRight - barX;
		this.placeArmor(contentLeft, rowY);
		this.placeBar({ track: this.structureTrack, fill: this.structureFill, text: this.structureText, x: barX, y: rowY + (STRUCTURE_ROW - STRUCTURE_BAR) / 2, width: barWidth, height: STRUCTURE_BAR, value: data.structure, max: data.maxStructure, color: STRUCTURE_FILL });
		rowY += STRUCTURE_ROW;

		// The driver's HP, the same weight as structure; empty with nobody at the wheel
		this.hpText.visible = this.showHpRow;
		if (this.showHpRow) {
			rowY += ROW_GAP;
			const driver = data.driver;
			this.heartDraw.box = rectAt(contentLeft, rowY + (HP_ROW - HEART_SIZE) / 2, LEAD_WIDTH, HEART_SIZE);
			this.heartDraw.tint = this.wrecked ? WRECK_DIM : HP_FILL;
			this.placeBar({ track: this.hpTrack, fill: this.hpFill, text: this.hpText, x: barX, y: rowY + (HP_ROW - HP_BAR) / 2, width: barWidth, height: HP_BAR, value: driver?.hitpoints ?? 0, max: driver?.maxHitpoints ?? 0, color: HP_FILL });
			rowY += HP_ROW;
		}

		// The passenger's HP, tagged with their mark
		this.passengerTagText.visible = this.showPassengerRow;
		this.passengerText.visible = this.showPassengerRow;
		if (this.showPassengerRow) {
			rowY += ROW_GAP;
			const passenger = data.passenger;
			const passengerMark = this.markOf(passenger);
			this.passengerMark.place(passengerMark, contentLeft + 2, rowY + (PASSENGER_ROW - PASSENGER_MARK) / 2, PASSENGER_MARK);
			this.passengerMark.tint = this.wrecked ? WRECK_DIM : null;
			this.passengerTagText.setPosition(contentLeft + 2 + (passengerMark ? PASSENGER_MARK + 1 : 0), rowY);
			this.passengerTagText.setSize(LEAD_WIDTH - PASSENGER_MARK - 3, PASSENGER_ROW);
			this.placeBar({ track: this.passengerTrack, fill: this.passengerFill, text: this.passengerText, x: barX, y: rowY + (PASSENGER_ROW - PASSENGER_BAR) / 2, width: barWidth, height: PASSENGER_BAR, value: passenger?.hitpoints ?? 0, max: passenger?.maxHitpoints ?? 0, color: PASSENGER_FILL });
		}

		// Sprite and speed
		this.sprite.kind = spriteKindOf(data);
		const tint = this.side === 'raider' ? SPRITE_TINTS.raider : mark === 'driver1' || mark === 'driver2' || mark === 'escort' ? SPRITE_TINTS[mark] : SPRITE_TINTS.escort;
		this.sprite.setColors(this.wrecked ? WRECK_GREY : tint, this.wrecked ? WRECK_DIM : undefined);
		this.speedText.text = `${data.speed}`;
		this.speedText.setPosition(SPEED_TEXT_X, SPEED_Y);
		this.speedText.setSize(PLATE_X - SPEED_TEXT_X - 2, SPEED_ICON);

		this.placeStatuses();

		this.stamp.visible = this.wrecked;
		if (this.wrecked) this.placeStamp();

		this.tooltip = { title: data.name, description: this.describe() };
		this.placeGhosts();

		// A passenger joining or leaving changes the height, so the scale
		if (this.hasSlot) this.placeInSlot();
	}

	private placeArmor(x: number, y: number): void {
		const data = this.vehicleData;
		const points = this.armorDraw.points as { x: number; y: number }[];
		ARMOR_OUTLINE.forEach(([px, py], index) => {
			points[index].x = x + px;
			points[index].y = y + py;
		});
		// The mock fades a shield at zero; a wreck's goes grey
		const fill = this.wrecked ? WRECK_DIM : ARMOR_FILL;
		this.armorDraw.fill = data.armor > 0 || this.wrecked ? fill : [fill[0], fill[1], fill[2], 0.35];
		this.armorText.text = `${data.armor}`;
		this.armorText.setPosition(x, y);
		this.armorText.setSize(LEAD_WIDTH, STRUCTURE_ROW);
	}

	private placeBar({ track, fill, text, x, y, width, height, value, max, color }: {
		track: DrawRectOptions;
		fill: DrawRectOptions;
		text: Text;
		x: number;
		y: number;
		width: number;
		height: number;
		value: number;
		max: number;
		color: RGBA;
	}): void {
		const trackRect = track.rect as { x: number; y: number; width: number; height: number };
		trackRect.x = x;
		trackRect.y = y;
		trackRect.width = width;
		trackRect.height = height;
		const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
		const fillRect = fill.rect as { x: number; y: number; width: number; height: number };
		fillRect.x = x;
		fillRect.y = y;
		fillRect.width = Math.round(width * share);
		fillRect.height = height;
		fill.fill = this.wrecked ? WRECK_DIM : color;
		text.text = max > 0 ? `${value}/${max}` : '0';
		text.setPosition(x, y);
		text.setSize(width, height);
		text.color = this.wrecked ? WRECK_TEXT : tokens.color.text_bright;
	}

	/**
	 * A ghost over each bar the aimed card would take something off: the
	 * fill's last `loss` of `value`, as the bar measures it. Rebuilt when the
	 * losses or the bars change, never per frame.
	 */
	private placeGhosts(): void {
		const losses = this.ghostLosses;
		const data = this.vehicleData;
		const bars: [DrawRectOptions, number, number, number][] = [
			[this.structureTrack, data.structure, data.maxStructure, losses?.structure ?? 0],
			[this.hpTrack, data.driver?.hitpoints ?? 0, data.driver?.maxHitpoints ?? 0, this.showHpRow ? losses?.driver ?? 0 : 0],
			[this.passengerTrack, data.passenger?.hitpoints ?? 0, data.passenger?.maxHitpoints ?? 0, this.showPassengerRow ? losses?.passenger ?? 0 : 0],
		];
		bars.forEach(([track, value, max, loss], index) => {
			const ghost = this.ghosts[index] ?? (this.ghosts[index] = { base: { rect: rectAt(), fill: GHOST_BASE }, stripes: { points: [], fill: GHOST_STRIPE }, shown: false });
			const lost = Math.min(Math.max(0, loss), Math.max(0, value));
			ghost.shown = lost > 0 && max > 0 && !this.wrecked;
			if (!ghost.shown) return;
			const { x, y, width, height } = track.rect;
			const from = x + Math.round(width * Math.min(1, (value - lost) / max));
			const to = x + Math.round(width * Math.min(1, value / max));
			const rect = ghost.base.rect as { x: number; y: number; width: number; height: number };
			rect.x = from;
			rect.y = y;
			rect.width = Math.max(1, to - from);
			rect.height = height;
			ghost.stripes.points = hatchTriangles(rect, GHOST_HATCH);
		});
	}

	/**
	 * SPENT first on an escort that has acted, then Shield, then statuses
	 * in the order they landed: as many as the row holds, at most five, with
	 * the last place given to "+N" when there are more.
	 */
	private placeStatuses(): void {
		const data = this.vehicleData;
		const contents: StatusChipContent[] = [];
		if (data.isEscort && data.spent) {
			contents.push({ kind: 'label', text: 'SPENT', title: 'Spent', detail: 'Acted this turn. Ready again at the start of your turn.' });
		}
		if ((data.shield ?? 0) > 0) contents.push(shieldChipContent(data.shield ?? 0));
		for (const effect of data.statusEffects) contents.push(statusChipContent(effect));

		const shown: StatusChipContent[] = [];
		let used = 0;
		const room = PLATE_WIDTH;
		let statusesShown = 0;
		for (let index = 0; index < contents.length; index++) {
			const content = contents[index];
			const width = StatusChip.widthOf(content) + (shown.length > 0 ? CHIP_GAP : 0);
			const rest = contents.length - index - 1;
			const moreWidth = StatusChip.widthOf({ kind: 'more', count: 0, detail: '' }) + CHIP_GAP;
			const capped = content.kind === 'status' && statusesShown >= MAX_STATUS_CHIPS;
			const fits = used + width + (rest > 0 ? moreWidth : 0) <= room || (rest === 0 && used + width <= room);
			if (capped || !fits) {
				const hidden = contents.slice(index);
				shown.push({ kind: 'more', count: hidden.length, detail: hidden.map((item) => (item.kind === 'more' ? '' : item.title)).join(', ') });
				break;
			}
			shown.push(content);
			used += width;
			if (content.kind === 'status') statusesShown++;
		}

		const y = PLATE_Y + this.plateHeight + STATUS_GAP;
		let x = PLATE_X;
		this.statusChips.forEach((chip, index) => {
			const content = shown[index] ?? null;
			chip.chip = content;
			if (!content) return;
			chip.setPosition(x, y);
			x += chip.width + CHIP_GAP;
			chip.opacity = this.wrecked ? 0.5 : 1;
		});
	}

	/** Across the plate's upper half, as the mock stamps it (centred at x 130, top 44). */
	private placeStamp(): void {
		this.stamp.label = this.vehicleData.isAlive() ? 'NO DRIVER' : 'WRECKED';
		this.stamp.setPosition(Math.round(STAMP_CENTRE_X - this.stamp.width / 2), STAMP_TOP);
	}

	/** The tooltip under the full name: who is aboard and how they stand. */
	private describe(): string {
		const data = this.vehicleData;
		const lines: string[] = [];
		if (data.isEscort) lines.push('Escort');
		else if (data.driver) lines.push(`Driver: ${data.driver.metadata.name}, ${data.driver.hitpoints}/${data.driver.maxHitpoints} HP`);
		else lines.push('No driver');
		if (data.passenger) lines.push(`Passenger: ${data.passenger.metadata.name}, ${data.passenger.hitpoints}/${data.passenger.maxHitpoints} HP`);
		lines.push(`Structure ${data.structure}/${data.maxStructure}, armor ${data.armor}, speed ${data.speed}`);
		return lines.join('. ');
	}

	/** The intents row and the outline reach past the token's box, the target's glow further. */
	protected get cullInk(): Rect {
		return grownRect(this.inkRect, this.outlineStyle === 'solid' ? shadowExtent(this.glowShadow) : OUTLINE_OFFSET + 3);
	}

	public render(draw: DrawApi): void {
		this.sprite.draw(draw);
		drawIcon(draw, this.speedIconDraw);
		if (this.outlineStyle === 'solid') draw.drawRect(this.glowDraw);
		draw.drawRect(this.plateDraw);
		if (this.hasStripe) draw.drawRect(this.stripeDraw);
		this.ownMark.draw(draw);
		draw.drawPolygon(this.armorDraw);
		draw.drawRect(this.structureTrack);
		if (this.structureFill.rect.width > 0) draw.drawRect(this.structureFill);
		this.drawGhost(draw, 0);
		if (this.showHpRow) {
			drawIcon(draw, this.heartDraw);
			draw.drawRect(this.hpTrack);
			if (this.hpFill.rect.width > 0) draw.drawRect(this.hpFill);
			this.drawGhost(draw, 1);
		}
		if (this.showPassengerRow) {
			this.passengerMark.draw(draw);
			draw.drawRect(this.passengerTrack);
			if (this.passengerFill.rect.width > 0) draw.drawRect(this.passengerFill);
			this.drawGhost(draw, 2);
		}
		if (this.outlineStyle === 'solid') draw.drawRect(this.outlineDraw);
		else if (this.outlineStyle === 'dashed') draw.drawPolygon(this.dashDraw);
	}

	private drawGhost(draw: DrawApi, index: number): void {
		const ghost = this.ghosts[index];
		if (!ghost?.shown) return;
		draw.drawRect(ghost.base);
		draw.drawPolygon(ghost.stripes);
	}

	/** The plate's fill and edge (R13.22). */
	public get resolvedColors(): ResolvedColors {
		const border = this.outlineStyle === 'solid' ? this.outlineBorder.color : this.outlineStyle === 'dashed' ? this.dashDraw.fill : this.plateEdge.color;
		return { fill: PLATE_FILL, border };
	}

	public get vehicleId(): string {
		return this.vehicleData.id;
	}

	/** The token is a target; its text takes no hits, and its chips and intents keep their tooltips. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
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
			// as the pointer's target, and is chosen by the drop. A drop on an
			// intent or a chip bubbles here.
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

	/** A dragged card arriving: taken here when it can land on this vehicle. */
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
		if (this.outlineDraw) this.updateVisualState();
	}

	private chooseAsTarget(): void {
		if (this.onClickCallback && this.isTargetable()) {
			this.onClickCallback(this.vehicleData);
		}
	}

	/**
	 * Model subscriptions are registered on mount and released on unmount
	 * (R8.14), so a remount subscribes again. The state is read fresh too:
	 * the model may have moved on while the token was detached.
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

	private isTargetable(): boolean {
		if (!this.combatData) return true;
		return this.combatData.isVehicleTargetable(this.vehicleData.id);
	}

	private isFocusedTarget(): boolean {
		if (!this.combatData) return false;
		return this.combatData.focusedVehicleId === this.vehicleData.id;
	}

	/** The escort that would carry out the attack order being aimed. */
	private isOrderCarrier(): boolean {
		return this.combatData?.carrierVehicleId === this.vehicleData.id;
	}

	/**
	 * While a card is aimed, a vehicle it can land on gets a dashed outline,
	 * the one under the pointer (or the escort that would carry an attack
	 * order out) a heavy solid one with a glow, and the rest dim (section 6,
	 * Targeting). Raiders outline in red, your own vehicles in the
	 * interaction yellow. The dashes are one triangle list, built when the
	 * plate's height changes.
	 */
	private updateVisualState(): void {
		const carrier = this.isOrderCarrier();
		const targetable = this.isTargetable() || carrier;
		const focused = this.isFocusedTarget() || carrier || this.dropActive;
		const targeting = this.combatData?.isTargeting ?? false;
		this.focusable = targeting && this.onClickCallback !== null && this.isTargetable();
		this.opacity = targeting && !targetable ? DIMMED_OPACITY : 1;

		const raider = this.side === 'raider';
		const outline = this.outlineDraw.rect as { x: number; y: number; width: number; height: number };
		outline.x = PLATE_X - OUTLINE_OFFSET;
		outline.y = PLATE_Y - OUTLINE_OFFSET;
		outline.width = PLATE_WIDTH + OUTLINE_OFFSET * 2;
		outline.height = this.plateHeight + OUTLINE_OFFSET * 2;
		const glow = this.glowDraw.rect as { height: number };
		glow.height = this.plateHeight;
		if (targetable && (focused || (this.hovered && targeting))) {
			this.outlineStyle = 'solid';
			this.outlineBorder.width = TARGET_OUTLINE_WIDTH;
			this.outlineBorder.color = raider ? RAIDER_TARGET : OWN_TARGET;
			this.glowShadow.color = raider ? RAIDER_GLOW : OWN_GLOW;
		} else if (targetable && targeting) {
			this.outlineStyle = 'dashed';
			this.dashDraw.fill = raider ? RAIDER_TARGETABLE : OWN_TARGETABLE;
			if (this.dashedForHeight !== this.plateHeight) {
				this.dashedForHeight = this.plateHeight;
				dashedOutlineTriangles(outline, LEGAL_OUTLINE, this.dashPoints);
			}
		} else {
			this.outlineStyle = 'none';
		}
	}
}

/**
 * The WRECKED stamp (the mock's `.stamp`): bordered, on the plate's ground
 * so the text under it doesn't show through, tilted 8 degrees. Sized from
 * its label's length, which is one of two fixed words.
 */
export class WreckStamp extends Component {
	private text = 'WRECKED';
	private readonly backDraw: DrawRectOptions = { rect: rectAt(), fill: PLATE_FILL, border: { color: STAMP_COLOR, width: STAMP_BORDER } };
	private readonly textDraw: DrawTextOptions = { text: 'WRECKED', box: rectAt(), font: 'display', size: STAMP_SIZE, color: STAMP_COLOR, align: 'center', verticalAlign: 'middle', wrap: 'none', letterSpacing: 0.2 };

	constructor(options: ComponentOptions = {}) {
		super(options);
		this.componentType = 'WreckStamp';
		this.transform = { rotate: STAMP_TILT, origin: [0.5, 0.5] };
		this.label = 'WRECKED';
	}

	get label(): string {
		return this.text;
	}

	set label(label: string) {
		this.text = label;
		const width = Math.ceil(label.length * STAMP_SIZE * STAMP_ADVANCE) + STAMP_PAD_X * 2 + STAMP_BORDER * 2;
		const height = STAMP_SIZE + STAMP_PAD_Y * 2 + STAMP_BORDER * 2;
		this.setSize(width, height);
		const back = this.backDraw.rect as { x: number; y: number; width: number; height: number };
		back.width = width;
		back.height = height;
		const box = this.textDraw.box as { x: number; y: number; width: number; height: number };
		box.width = width;
		box.height = height;
		this.textDraw.text = label;
	}

	public render(draw: DrawApi): void {
		draw.drawRect(this.backDraw);
		draw.drawText(this.textDraw);
	}
}
