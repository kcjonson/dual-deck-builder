import { Component, ComponentOptions } from '../components/Component';
import type { Axis, Size, SizeMode } from '../components/layoutTypes';
import type { BoxShadow } from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { AnyUiEvent, UiActionEvent, UiKeyEvent, UiPointerEvent } from '../input/events';
import { glowShadow, shadowExtent } from '../style/look';
import { CONTROL_SIZES, ControlSize, Tone, segmentLayers, toneGlow } from '../style/variants';
import { tokens } from '../theme/tokens';
import { LabelledPressable } from './LabelledPressable';

export interface SegmentOption<T> {
	label: string;
	value: T;
	disabled?: boolean;
}

/** A user change: the new value, already applied, and the press or key that made it. */
export type SegmentChangeCallback<T> = (value: T, event: UiPointerEvent | UiActionEvent | UiKeyEvent) => void;

export type SegmentTone = Exclude<Tone, 'auto' | 'default'>;

export interface SegmentedControlOptions<T> extends Omit<ComponentOptions, 'style'> {
	options: readonly SegmentOption<T>[];
	/** The selected value; absent or unmatched selects nothing. */
	selected?: T | null;
	/** R11.10: each segment's height and label size; the well is `space_0_5` taller on each side. */
	size?: ControlSize;
	/** The selected chip's colour. Default `accent`. */
	tone?: SegmentTone;
	/** Each segment's width; absent, every segment is as wide as the widest label needs. */
	segmentWidth?: number;
	disabled?: boolean;
	onChange?: SegmentChangeCallback<T> | null;
}

/** The well's inset around the segments, which the chip's glow sits in. */
const WELL_PAD = tokens.space.space_0_5;
const SEGMENT_INSET = tokens.control.inset_row;
/** Every tone's glow has the accent glow's blur, so one extent covers them all. */
const CHIP_GLOW_EXTENT = shadowExtent(glowShadow(tokens.color.accent_glow));

/** One segment: its label, and the tone's chip when selected. */
export class Segment<T = unknown> extends LabelledPressable {
	public readonly value: T;
	private readonly tone: SegmentTone;
	private readonly chipGlow: BoxShadow;

	constructor({ label, value, size, tone, disabled }: { label: string; value: T; size: ControlSize; tone: SegmentTone; disabled: boolean }) {
		super({
			label,
			face: { font: 'display', size: CONTROL_SIZES[size].fontSize, letterSpacing: tokens.letterSpacing.ls_wide, textTransform: 'uppercase' },
			layers: segmentLayers({ tone, on: false }),
			inset: SEGMENT_INSET,
			height: CONTROL_SIZES[size].height,
			...(disabled ? { enabled: false } : {}),
		});
		this.componentType = 'Segment';
		this.value = value;
		this.tone = tone;
		this.chipGlow = glowShadow(toneGlow(tone));
	}

	/** Segments abut in the well, so the ring is drawn inside. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** R8.8: the selected chip's glow. */
	public get inkExtent(): number {
		return CHIP_GLOW_EXTENT;
	}

	protected onStateChange(): void {
		// `selected` picks the layers, as a checkable's `checked` does.
		if (this.transition) this.layers = segmentLayers({ tone: this.tone, on: this.selected });
		super.onStateChange();
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const { width, height } = this;
		const rect = { x: 0, y: 0, width, height };
		const glowing = this.selected && this.effectivelyEnabled;
		if (look.fill[3] > 0) {
			draw.drawRect({
				id: this.id ?? undefined,
				rect,
				fill: look.fill,
				radius: look.radius > 0 ? look.radius : undefined,
				shadow: glowing ? this.chipGlow : undefined,
			});
		}
		this.drawLabel(draw, rect);
		if (look.focusRing) {
			draw.drawRect({
				rect,
				fill: [0, 0, 0, 0],
				radius: look.radius > 0 ? look.radius : undefined,
				border: { color: look.focusRing, width: tokens.control.focus_ring_width, position: 'inside' },
			});
		}
	}
}

/**
 * Arrows that move to the previous or next segment: the row's own axis.
 * Up and Down go unconsumed to directional focus (R9.24, R9.26).
 */
const STEP: Readonly<Record<string, -1 | 1>> = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * R12.17's segmented control: an inset well holding equal-width segments,
 * the selected one a filled chip in the tone's colour with its glow. Every
 * segment is as wide as the widest label needs, unless `segmentWidth` says
 * otherwise, and the control hugs them. It is interactive (worldsim's was
 * draw-only) and a focus group (R12.34): one Tab stop entered at the
 * selection, Left and Right moving focus and selection together (wrapping,
 * skipping disabled segments), Home and End to the ends, and a click or
 * `activate` selecting. Up and Down leave it for directional focus
 * (R9.24). Setting `selected` never fires `onChange`; a user change fires
 * it once, with the value applied.
 */
export class SegmentedControl<T = string> extends Component {
	public onChange: SegmentChangeCallback<T> | null;

	private readonly segments: Segment<T>[] = [];
	private selectedValue: T | null = null;
	private readonly fixedSegmentWidth: number | null;
	private readonly controlSize: ControlSize;

	constructor({ options, selected = null, size = 'md', tone = 'accent', segmentWidth, disabled = false, onChange = null, ...rest }: SegmentedControlOptions<T>) {
		super({
			...(disabled ? { enabled: false } : {}),
			...rest,
			// The segments are the size's control height (R11.10); the well pads round them.
			height: rest.height ?? CONTROL_SIZES[size].height + WELL_PAD * 2,
			focusGroup: { orientation: 'horizontal', wrap: true },
		});
		this.componentType = 'SegmentedControl';
		this.onChange = onChange;
		this.fixedSegmentWidth = segmentWidth ?? null;
		this.controlSize = size;
		for (const option of options) {
			const segment = new Segment<T>({ label: option.label, value: option.value, size, tone, disabled: option.disabled ?? false });
			this.segments.push(segment);
			this.addChild(segment);
		}
		// R12.17's `selected` is the value; `selected` on a component is R11.11's flag.
		this.value = selected;
	}

	/** Hugs its segments on an axis it was given no size on. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'hug';
	}

	public get items(): readonly Segment<T>[] {
		return this.segments;
	}

	public get size(): ControlSize {
		return this.controlSize;
	}

	/** The selected value, or null. */
	public get value(): T | null {
		return this.selectedValue;
	}

	/** Programmatic: never fires `onChange`. A value no segment has selects nothing. */
	public set value(value: T | null) {
		const match = this.segments.find((segment) => segment.value === value) ?? null;
		this.selectedValue = match ? match.value : null;
		for (const segment of this.segments) segment.selected = segment === match;
		if (match) this.activeChild = match;
	}

	/** The width every segment is given. */
	public get segmentWidth(): number {
		if (this.fixedSegmentWidth !== null) return this.fixedSegmentWidth;
		return Math.max(0, ...this.segments.map((segment) => segment.hugWidth));
	}

	/** A segment was clicked or activated. */
	public memberPressed(member: Component, event: UiPointerEvent | UiActionEvent): void {
		if (!(member instanceof Segment) || !this.segments.includes(member)) return;
		this.choose(member as Segment<T>, event);
	}

	/** Left, Right, Home, and End from a focused segment move focus and selection together. */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.type !== 'keydown' || event.consumed) return;
		const { ctrl, meta, alt, shift } = event.modifiers;
		if (ctrl || meta || alt || shift) return;
		const current = this.segments.find((segment) => segment.focused);
		if (!current) return;
		const enabled = this.segments.filter((segment) => segment === current || segment.canReceiveFocus());
		let target: Segment<T> | undefined;
		if (event.key === 'Home') target = enabled[0];
		else if (event.key === 'End') target = enabled[enabled.length - 1];
		else if (STEP[event.key] !== undefined) {
			const index = enabled.indexOf(current);
			target = enabled[(index + STEP[event.key] + enabled.length) % enabled.length];
		}
		if (!target) return;
		event.consume();
		if (target === current) return;
		this.context?.focus.focus(target, 'keyboard');
		this.choose(target, event);
	}

	public measure(availableWidth: number, availableHeight: number, definite: Axis | null = null): Size {
		return {
			width: definite === 'width' ? availableWidth : this.widthMode === 'fixed' ? this.width : this.hugWidth,
			height: definite === 'height' ? availableHeight : this.height,
		};
	}

	/** Equal segments in a row inside the well's padding; a hugging control outside a stack sizes itself. */
	protected layoutChildren(): void {
		if (this.widthMode === 'hug' && !this.parent?.sizesChildren) this.resizeInLayout(this.hugWidth, this.height);
		const count = this.segments.length;
		const width = this.widthMode === 'hug' ? this.segmentWidth : count > 0 ? (this.width - WELL_PAD * 2) / count : 0;
		const height = Math.max(0, this.height - WELL_PAD * 2);
		this.segments.forEach((segment, index) => {
			segment.x = WELL_PAD + index * width;
			segment.y = WELL_PAD;
			segment.assignSize(width, height);
		});
	}

	/** It places and sizes its segments itself, as a stack does (R10.5). */
	public get sizesChildren(): boolean {
		return true;
	}

	protected onMount(): void {
		this.invalidateLayout();
	}

	/** The inset well (R11.5). */
	public render(draw: DrawApi): void {
		const { color } = tokens;
		draw.drawRect({
			id: this.id ?? undefined,
			rect: { x: 0, y: 0, width: this.width, height: this.height },
			fill: color.bg_inset,
			radius: tokens.radius.r_md,
			border: { color: color.line_hairline, width: tokens.borderWidth.bw },
		});
	}

	private get hugWidth(): number {
		return this.segmentWidth * this.segments.length + WELL_PAD * 2;
	}

	private choose(segment: Segment<T>, event: UiPointerEvent | UiActionEvent | UiKeyEvent): void {
		if (!segment.effectivelyEnabled) return;
		const changed = this.selectedValue !== segment.value;
		this.value = segment.value;
		if (changed) this.onChange?.(segment.value, event);
	}
}
