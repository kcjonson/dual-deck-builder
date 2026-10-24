import { Component, ComponentOptions, Cursor, ResolvedColors } from '../../engine/components/Component';
import type { AnyUiEvent, UiDragEvent } from '../../engine/input/events';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawPolygonOptions, DrawRectOptions } from '../../engine/draw/commands';
import type { RGBA, Rect, Vec2 } from '../../engine/draw/geometry';
import { RoadSlot, sameSlot } from '../mechanics/Road';
import type { CombatModel } from '../screens/combat/CombatModel';
import { dashedOutlineTriangles } from './stripes';
import {
	LEGAL_OUTLINE,
	OWN_TARGET,
	OWN_TARGETABLE,
	RAIDER_TARGET,
	RAIDER_TARGETABLE,
	TARGET_OUTLINE_WIDTH,
	VehicleSide,
} from './Vehicle';

const CORNER_RADIUS = 3;
const CLEAR: RGBA = [0, 0, 0, 0];
/**
 * How strongly a solid slot is tinted inside. A target vehicle's glow is a
 * shadow its opaque plate covers in the middle; under an empty slot the
 * same shadow fills the whole slot, so a faint tint of the outline's colour
 * stands in for it.
 */
const SOLID_TINT = 0.14;

export interface SlotTargetOptions extends Omit<ComponentOptions, 'onClick'> {
	slot: RoadSlot;
	/** Whose formation the slot is in, which colours it as that side's vehicles are while a card is aimed. */
	side: VehicleSide;
	combatData: CombatModel;
	/** A destination chosen at an earlier step: drawn solid while the card waits, and never a target itself. */
	picked?: boolean;
}

/**
 * An empty slot a card's move can go to while it waits for its slot
 * (Battle Screen Design section 6, slot targeting, DDB-548): the legal
 * target's 2 px dashes, solid at 3 px over a faint tint while the pointer,
 * keyboard focus, or a dragged card is on it. Your formation's slots light
 * in the interaction yellow your vehicles do, the raiders' (a shove) in
 * their red. The road makes one per legal slot, so illegal slots (taken,
 * reserved, too far for the card) show nothing.
 *
 * It takes clicks, drops, and keyboard focus the way a target vehicle
 * does, through the combat model: hover or focus previews the slot
 * (`focusSlot`), and a click, Enter, or a drop chooses it (`targetSlot`).
 * The dashes are one triangle list, rebuilt when the box changes size.
 */
export class SlotTarget extends Component {
	public readonly slot: RoadSlot;
	public readonly side: VehicleSide;
	public readonly picked: boolean;
	private readonly combatData: CombatModel;
	private readonly dashPoints: Vec2[] = [];
	private readonly dashDraw: DrawPolygonOptions & { fill: RGBA };
	private dashedFor = { width: -1, height: -1 };
	private readonly outlineDraw: DrawRectOptions & { rect: Rect; border: { color: RGBA; width: number } };
	private solid = false;
	private modelUnsubscribers: (() => void)[] = [];

	constructor({ slot, side, combatData, picked = false, ...options }: SlotTargetOptions) {
		super({ pointerEvents: picked ? 'none' : 'auto', ...options });
		this.componentType = 'SlotTarget';
		this.slot = slot;
		this.side = side;
		this.picked = picked;
		this.combatData = combatData;
		const raider = side === 'raider';
		const [red, green, blue] = raider ? RAIDER_TARGET : OWN_TARGET;
		this.dashDraw = { points: this.dashPoints, fill: raider ? RAIDER_TARGETABLE : OWN_TARGETABLE };
		this.outlineDraw = {
			rect: { x: 0, y: 0, width: 0, height: 0 },
			fill: [red, green, blue, SOLID_TINT],
			radius: CORNER_RADIUS,
			border: { color: [red, green, blue, 1], width: TARGET_OUTLINE_WIDTH },
		};
		this.focusable = !picked;
		this.refresh();
	}

	/** Whether it's drawn solid now: chosen already, or under the pointer, focus, or a dragged card. */
	public get isSolid(): boolean {
		return this.solid;
	}

	protected get defaultCursor(): Cursor | null {
		return this.picked ? null : 'pointer';
	}

	public get handlesPointer(): boolean {
		return !this.picked;
	}

	/** The outline's colour (R13.22). */
	public get resolvedColors(): ResolvedColors {
		return this.solid
			? { fill: this.outlineDraw.fill as RGBA, border: this.outlineDraw.border.color }
			: { fill: CLEAR, border: this.dashDraw.fill };
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (this.picked) return;
		switch (event.type) {
			case 'click':
				this.choose();
				return;
			case 'activate':
				event.consume();
				this.choose();
				return;
			case 'focus':
			case 'pointerenter':
				this.combatData.focusSlot(this.slot);
				this.refresh();
				return;
			case 'blur':
				if (!this.hovered) this.leave();
				return;
			// A slot the keyboard is on keeps its preview when the pointer passes over and off it
			case 'pointerleave':
				if (!this.focusVisible) this.leave();
				this.refresh();
				return;
			case 'dragenter':
				this.dragEntered(event);
				return;
			case 'dragleave':
				this.leave();
				return;
			case 'drop':
				event.consume();
				this.choose();
				return;
		}
	}

	private dragEntered(event: UiDragEvent): void {
		if (!this.combatData.isSlotTargetable(this.slot)) return;
		event.accept();
		this.combatData.focusSlot(this.slot);
	}

	/** The preview goes when the last thing on this slot leaves it. */
	private leave(): void {
		if (sameSlot(this.combatData.focusedSlot, this.slot)) this.combatData.focusSlot(null);
	}

	private choose(): void {
		this.combatData.targetSlot(this.slot);
	}

	/** `dropActive` and `hovered` light it. */
	protected onStateChange(): void {
		if (this.outlineDraw) this.refresh();
	}

	protected onResized(): void {
		this.refresh();
	}

	protected onMount(): void {
		const refresh = (): void => this.refresh();
		this.modelUnsubscribers.push(this.combatData.on('focusedSlot', refresh));
		this.refresh();
	}

	protected onUnmount(): void {
		this.modelUnsubscribers.forEach(unsubscribe => unsubscribe());
		this.modelUnsubscribers = [];
	}

	private refresh(): void {
		this.solid = this.picked || this.dropActive || this.hovered || sameSlot(this.combatData.focusedSlot, this.slot);
		const { width, height } = this;
		const box = this.outlineDraw.rect;
		box.width = width;
		box.height = height;
		if (!this.solid && (this.dashedFor.width !== width || this.dashedFor.height !== height)) {
			this.dashedFor = { width, height };
			dashedOutlineTriangles({ x: 0, y: 0, width, height }, LEGAL_OUTLINE, this.dashPoints);
		}
	}

	public render(draw: DrawApi): void {
		if (this.solid) draw.drawRect(this.outlineDraw);
		else if (this.dashPoints.length > 0) draw.drawPolygon(this.dashDraw);
	}
}
