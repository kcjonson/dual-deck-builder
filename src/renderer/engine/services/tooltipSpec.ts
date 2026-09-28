import type { Component } from '../components/Component';

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
}

/** A bare string is a title. */
export type TooltipInput = string | TooltipSpec;

export function normalizeTooltip(input: TooltipInput | null | undefined): TooltipSpec | null {
	if (input === null || input === undefined) return null;
	return typeof input === 'string' ? { title: input } : input;
}
