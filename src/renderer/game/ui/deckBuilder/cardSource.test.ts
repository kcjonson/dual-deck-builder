import type { CardBlocker } from '../../campaign/Campaign';
import { DriverRecord } from '../../campaign/DriverRecord';
import type { RunDeck } from '../../campaign/RunDeck';
import { lookup } from '../testing';
import { cardBlockerReason, cardKind, passesFilter } from './cardSource';

describe('cardBlockerReason', () => {
	const driver = new DriverRecord({ id: 'driver-1', archetype: 'road_warrior', name: 'Road Warrior 1' });
	const dead = new DriverRecord({ id: 'driver-2', archetype: 'mechanic', name: 'Mechanic 1', status: 'dead', hitpoints: 0, defaultDeck: {} });
	const runDeck = { driver } as unknown as RunDeck;

	it('words every reason the rules give in a few words', () => {
		const reasons: [CardBlocker, string][] = [
			[{ reason: 'driver_away', place: dead }, 'Killed on a run'],
			[{ reason: 'on_run', place: driver }, 'Out on a run'],
			[{ reason: 'too_few', place: 'locker', held: 0 }, 'None left'],
			[{ reason: 'already_borrowed', place: 'locker', held: 0, by: runDeck }, 'Road Warrior 1 has it'],
			[{ reason: 'card_locked', place: runDeck, broughtBy: 'escort-1' }, 'Locked escort card'],
			[{ reason: 'too_little_scrap', needed: 12, held: 3 }, 'Needs 12 scrap'],
			[{ reason: 'other_archetype', archetype: 'interceptor', place: driver }, 'Interceptor only'],
			[{ reason: 'deck_full', max: 20, place: driver }, 'Deck full'],
			[{ reason: 'deck_at_minimum', min: 8, place: driver }, 'Deck at minimum'],
		];
		expect(reasons.map(([blocker]) => cardBlockerReason(blocker))).toEqual(reasons.map(([, words]) => words));
	});
});

describe('cardKind', () => {
	it('files every card under one kind by its first tag, a power card under attack', () => {
		const kinds = ['ram', 'witness_me', 'coordinated_attack', 'armor_plating', 'repair_kit', 'flank', 'covering_fire']
			.map((type) => cardKind(lookup(type) as NonNullable<ReturnType<typeof lookup>>));
		expect(kinds).toEqual(['attack', 'attack', 'attack', 'defense', 'utility', 'utility', 'order']);
		const ram = lookup('ram') as NonNullable<ReturnType<typeof lookup>>;
		expect([passesFilter(ram, 'all'), passesFilter(ram, 'attack'), passesFilter(ram, 'order')]).toEqual([true, true, false]);
	});
});
