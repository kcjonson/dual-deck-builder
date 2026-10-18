import { NO_RESOURCES } from '../../renderer/game/campaign/Campaign';
import { EventParty, GameEvent, eventById, landOutcome } from '../../renderer/game/campaign/Events';
import { EventScreen, EventScreenData } from '../../renderer/game/screens/event/EventScreen';
import type { ScreenScene } from '../registry';

/**
 * The event screen whole (DDB-45), at the states its goldens pin: a wreck
 * whose Mechanic's choice is open but short of scrap (the need beside the
 * shortfall, struck through); a distress signal with a card lock (rust
 * hatch) and a fuel shortfall; one with an escort lock; outcomes that give a
 * card and an escort, each drawn as a card, and one that costs; and a fight
 * hand-off. The stand-in screen capture adds an archetype lock.
 */

/** A Road Warrior and a Mechanic with a little in the stores: no EMP Blast, no escort. */
const CREW: EventParty = {
	archetypes: ['road_warrior', 'mechanic'],
	cards: { ram: 2, repair_kit: 2 },
	escorts: [],
	resources: { ...NO_RESOURCES, fuel: 2, scrap: 5 },
};

function shown(id: string): GameEvent {
	const event = eventById(id);
	if (!event) throw new Error(`gallery: no event ${id}`);
	return event;
}

function scene(name: string, data: EventScreenData): ScreenScene {
	return { name, screen: () => ({ screen: new EventScreen(), data }) };
}

function outcome(id: string, choice: string, draw: number): EventScreenData {
	const event = shown(id);
	return { event, where: 'stop 2 of 4', result: landOutcome({ event, choice, draw }) };
}

export const EVENT_SCENES: readonly ScreenScene[] = [
	scene('event-wreck', { event: shown('armored_car'), party: CREW, where: 'stop 1 of 4' }),
	scene('event-distress', { event: shown('family_under_fire'), party: CREW, where: 'stop 3 of 4' }),
	scene('event-locks', { event: shown('mayday_channel_nine'), party: CREW, where: 'stop 2 of 4' }),
	scene('event-outcome', outcome('burned_bus', 'search_bus', 0)),
	scene('event-escort', outcome('armored_car', 'get_it_running', 0)),
	scene('event-fight', outcome('family_under_fire', 'charge', 0)),
];
