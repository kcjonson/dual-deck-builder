import type { Component } from '../../engine/components/Component';
import type { MountContext } from '../../engine/components/MountContext';
import { Text } from '../../engine/components/Text';
import { renderTree } from '../../engine/components/renderTree';
import type { RGBA, Rect } from '../../engine/draw/geometry';
import type { createMeasuringDrawApi } from '../../engine/text/testing';
import { Card as GameCard, CardData } from '../mechanics/Card';
import cardsFile from '../data/cards.json';
import type { CardLookup } from './DriverDetailView';

/**
 * Helpers the card tests share: the game's cards, a screen's lookup of
 * them, a card's text parts, and a frame of a card's drawing.
 */

/** Every card in `cards.json`, as data. */
export const cardData: readonly CardData[] = (cardsFile as unknown as { cards: CardData[] }).cards;

/** The game's cards by type, a new one each time, as a screen's lookup hands them out; null for a type they don't have. */
export const lookup: CardLookup = (type) => {
	const data = cardData.find((entry) => entry.type === type);
	return data ? new GameCard({ ...data }) : null;
};

/** The text part of `owner` whose id is the owner's and `suffix`, at any depth. */
export function part(owner: Component, suffix: string): Text {
	const found = owner.findById(`${owner.id}_${suffix}`);
	if (!(found instanceof Text)) throw new Error(`no ${suffix}`);
	return found;
}

/** A draw as the measuring backend records it, with the fields the card tests read. */
export interface RecordedDraw {
	kind: string;
	id?: string | null;
	text?: string;
	rect?: Rect;
	box?: Rect | null;
	points?: readonly { x: number; y: number }[];
	center?: { x: number; y: number };
	radius?: number | readonly number[] | null;
	border?: { color: RGBA; width: number } | null;
	fill?: RGBA | null;
}

/** One frame of `root`'s drawing on `context`, laid out first, in a viewport that holds it and its ink. */
export function recordFrame({ root, context, measuring, viewport = { width: 400, height: 400 } }: {
	root: Component;
	context: MountContext;
	measuring: ReturnType<typeof createMeasuringDrawApi>;
	viewport?: { width: number; height: number };
}): RecordedDraw[] {
	const { api, backend } = measuring;
	context.frame.layout();
	api.beginFrame({ viewport });
	renderTree(root, api);
	api.endFrame();
	return [...backend.commands] as unknown as RecordedDraw[];
}
