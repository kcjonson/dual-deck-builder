/**
 * @jest-environment jsdom
 */
import type { Component } from '../../engine/components/Component';
import { Container } from '../../engine/components/Container';
import type { MountContext } from '../../engine/components/MountContext';
import { checkReveal, createTestContext, expectWithin, inkOnScreen, rectOnScreen } from '../../engine/components/testing';
import type { DrawApi } from '../../engine/draw/DrawApi';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import cardsFile from '../data/cards.json';
import { Card as GameCard, CardData } from '../mechanics/Card';
import { createDrivenVehicle } from '../mechanics/Vehicle';
import { CombatModel } from '../screens/combat/CombatModel';
import { Card, CardSize, MiniCardState } from './Card';
import { Vehicle } from './Vehicle';

/**
 * R12.20's contract for the game's focusables, as `engine/ui/revealInk.test.ts`
 * holds it for the catalog: focused by keyboard with the pointer away, each
 * reveals what it draws, no less, and no more but for a card's known
 * over-bound.
 */

// Lays out card faces; the 5 s default fails under a loaded machine.
jest.setTimeout(30_000);

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

let context: MountContext;
let api: DrawApi;
let root: Container;

beforeEach(() => {
	api = createMeasuringDrawApi().api;
	context = createTestContext({ draw: api });
	root = new Container({ id: 'root', width: 1000, height: 800 });
	root.mount(context);
});

afterEach(() => {
	root.unmount();
});

function card(type: string, size: CardSize, options: { copies?: number; miniState?: MiniCardState | null; driverNumber?: 1 | 2 | null } = {}): Card {
	const data = cardData.find((candidate) => candidate.type === type) as CardData;
	const made = new Card({ id: 'card', x: 100, y: 100, data: new GameCard({ ...data }), size, ...options });
	made.focusable = true;
	root.addChild(made);
	return made;
}

/** A raider the aimed card can land on, so it takes focus as the target choice. */
function target(): Vehicle {
	const buggy = createDrivenVehicle({ driver: createTestDriver('Raider'), name: 'Buggy' });
	const model = new CombatModel();
	model.isTargeting = true;
	model.targetableVehicleIds = [buggy.id];
	const token = new Vehicle({ id: 'token', x: 100, y: 100, vehicleData: buggy, side: 'raider', combatData: model, onClick: () => undefined });
	root.addChild(token);
	return token;
}

/** Laid out, then focused by keyboard, and settled. */
function focused(component: Component): Component {
	context.frame.layout();
	context.focus.focus(component, 'keyboard');
	// Every transition done
	context.frame.update(1);
	context.frame.layout();
	expect(component.focusVisible).toBe(true);
	return component;
}

const exact = { top: 0, right: 0, bottom: 0, left: 0 };

const cards: [string, () => Card][] = [
	['a card face', () => card('ramming_speed', CardSize.NORMAL, { driverNumber: 1 })],
	['a mini card', () => card('ramming_speed', CardSize.MINI)],
	['a stacked mini card with its count', () => card('ramming_speed', CardSize.MINI, { copies: 3 })],
	['a borrowed mini card with its tag', () => card('medical_kit', CardSize.MINI, { miniState: 'borrowed', driverNumber: 1 })],
];

it.each(cards)('reveals all a card draws, and past it no more than its known over-bound (DDB-412): %s', (_name, make) => {
	const made = focused(make());
	const { outside, audit } = checkReveal(made, api);
	expect(outside).toEqual([]);
	expect(audit).toEqual([]);
	// The over-bound: its inkExtent on every side, where it draws less on most
	expectWithin(inkOnScreen(made), rectOnScreen(made, made.inkRect));
});

it('reveals what a vehicle offered as a target draws, no less and no more: its outline and glow', () => {
	expect(checkReveal(focused(target()), api)).toEqual({ outside: [], beyond: exact, audit: [] });
});

const unfocused: [string, () => Vehicle][] = [
	['a vehicle a card can land on, in its dashed outline', target],
	['the acting raider, in its glow', () => {
		const buggy = createDrivenVehicle({ driver: createTestDriver('Raider'), name: 'Buggy' });
		const token = new Vehicle({ id: 'token', x: 100, y: 100, vehicleData: buggy, side: 'raider' });
		token.acting = true;
		root.addChild(token);
		return token;
	}],
];

it.each(unfocused)('reveals what it draws when code scrolls to it unfocused: %s', (_name, make) => {
	const token = make();
	context.frame.layout();
	expect(token.focused).toBe(false);
	expect(checkReveal(token, api)).toEqual({ outside: [], beyond: exact, audit: [] });
});
