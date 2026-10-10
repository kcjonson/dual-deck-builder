import type { CardBlocker } from './Campaign';
import { awayText, cardBlockerReason } from './cardBlockerText';
import { DriverRecord } from './DriverRecord';
import type { RunDeck } from './RunDeck';

describe('cardBlockerReason', () => {
	const driver = new DriverRecord({ id: 'driver-1', archetype: 'road_warrior', name: 'Road Warrior 1' });
	const dead = new DriverRecord({ id: 'driver-2', archetype: 'mechanic', name: 'Mechanic 1', status: 'dead', hitpoints: 0, defaultDeck: {} });
	const runDeck = { driver } as unknown as RunDeck;

	it('words every reason the rules give in a few words, naming nobody', () => {
		const reasons: [CardBlocker, string][] = [
			[{ reason: 'campaign_over', end: { ending: 'starved', cause: 'no_people' } }, 'Campaign over'],
			[{ reason: 'driver_away', place: dead }, 'Killed on a run'],
			[{ reason: 'on_run', place: driver }, 'Out on a run'],
			[{ reason: 'too_few', place: 'locker', held: 0 }, 'None left'],
			[{ reason: 'already_borrowed', place: 'locker', held: 0, by: runDeck }, 'Other seat has it'],
			[{ reason: 'card_locked', place: runDeck, broughtBy: 'escort-1' }, "Escort's card"],
			[{ reason: 'too_little_scrap', needed: 12, held: 3 }, 'Needs 12 scrap'],
			[{ reason: 'other_archetype', archetype: 'interceptor', place: driver }, 'Interceptor only'],
			[{ reason: 'deck_full', max: 20, place: driver }, 'Deck full'],
			[{ reason: 'deck_at_minimum', min: 8, place: driver }, 'Deck at minimum'],
		];
		expect(reasons.map(([blocker]) => cardBlockerReason(blocker))).toEqual(reasons.map(([, words]) => words));
	});

	it('says how a driver away went', () => {
		expect([awayText('dead'), awayText('missing')]).toEqual(['Killed on a run', 'Missing on a run']);
	});
});
