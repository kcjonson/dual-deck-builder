import type { Component } from '../components/Component';
import type { Rect } from '../draw/geometry';
import type { PlacementAlign, PlacementSide } from './Placement';

/**
 * Where the tooltip goes when it isn't the default below-right of the
 * pointer (R12.22's "default"): against the owner's bounds rather than the
 * pointer, on a side and alignment of its choosing. Flip and clamp still
 * apply.
 */
export interface TooltipPlacement {
	/** `pointer` (the default) or the owner's `screenBounds`. */
	anchor?: 'pointer' | 'owner';
	side?: PlacementSide;
	align?: PlacementAlign;
	/**
	 * With `anchor: 'owner'`, the rect to place against instead of the
	 * owner's live `screenBounds`: for an owner mid-animation, where it
	 * will settle.
	 */
	ownerRect?: () => Rect;
}

/**
 * What a component declares through its `tooltip` property (R12.22): text
 * content the tooltip service lays out itself, or a factory whose tree it
 * mounts under the tooltip root while shown (a full-size card preview) and
 * unmounts on hide. A factory wins when both are given.
 */
export interface TooltipSpec {
	title?: string;
	description?: string;
	/** A key hint drawn beside the title. */
	hotkey?: string;
	factory?: () => Component;
	/** The widest the text wraps at, in logical pixels. */
	maxWidth?: number;
	placement?: TooltipPlacement;
	/** Keyboard focus shows it at once rather than after `tooltip_delay`. */
	immediateOnFocus?: boolean;
}

/** A bare string is a title. */
export type TooltipInput = string | TooltipSpec;

export function normalizeTooltip(input: TooltipInput | null | undefined): TooltipSpec | null {
	if (input === null || input === undefined) return null;
	return typeof input === 'string' ? { title: input } : input;
}
