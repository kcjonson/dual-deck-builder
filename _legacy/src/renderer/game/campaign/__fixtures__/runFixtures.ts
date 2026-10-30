import { Card, CardEffect } from '../../mechanics/Card';
import { Deck } from '../../mechanics/Deck';
import { Driver, DriverRole } from '../../mechanics/Driver';
import { Team, TeamType } from '../../mechanics/Team';
import { Vehicle, createDrivenVehicle } from '../../mechanics/Vehicle';
import type { CampaignFight } from '../CombatBridge';

/** Raiders and a fight loop for tests that play a supply run's fights to their end (DDB-454). */

/** A raider's card that always lands where its AI aims it. */
function raiderCard(name: string, effect: CardEffect): Card {
	return new Card({
		type: name.toLowerCase(),
		name,
		summary: name,
		description: name,
		rarity: 'common',
		cost: 1,
		targetType: 'enemy_single',
		effects: [{ ...effect, always_hits: true }],
		tags: ['attack'],
	});
}

/** Takes down the driver it hits. */
const snipe = (): Card => raiderCard('Snipe', { type: 'damage', value: 500, target: 'driver' });

/** A raider any hit finishes, playing its deck's cards at its first legal target. */
function raider(deck: Card[] = []): Vehicle {
	const driver = new Driver({
		archetype: 'raider',
		metadata: { name: 'Scrapper', vehicleName: 'Scrap Buggy', specialty: 'TEST RAIDER', flavorText: 'Built to lose.', unlocked: true },
		skills: { ramming: 0, gunnery: 0, evade: 0, speed: 1 },
		vehicleStats: { maxStructure: 1, weight: 1, armor: 0, speed: 1, gunnery: 0, evade: 0 },
		startingDeck: { cards: [] },
		hitpoints: 1,
		maxHitpoints: 1,
		adrenaline: 3,
		maxAdrenaline: 3,
		handLimit: 7,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck('scrapper', "Scrapper's deck", deck),
	});
	return createDrivenVehicle({ driver });
}

/** One raider with nothing to play, which any hit finishes. */
export const pushovers = (): Team => new Team({ type: TeamType.ENEMY, vehicles: [raider()] });

/** One raider that takes a driver down with every card, three a turn. */
export const snipers = (): Team => new Team({ type: TeamType.ENEMY, vehicles: [raider(Array.from({ length: 10 }, snipe))] });

/**
 * The fight played to its end: each turn, every seat with a Precision Shot
 * in hand fires it at the first raider still in the fight, unless told to
 * hold fire, until one side is out. Throws if ten turns don't end it.
 */
export function fightOut(fight: CampaignFight, { shoot = true }: { shoot?: boolean } = {}): void {
	const { battle } = fight;
	for (let turn = 1; turn <= 10 && !battle.isBattleOver(); turn++) {
		for (const driver of shoot ? fight.drivers : []) {
			const target = battle.enemyTeam.vehicles.find(vehicle => vehicle.isAlive());
			const cardIndex = driver.hand.findIndex(card => card.type === 'precision_shot');
			if (target && cardIndex >= 0 && driver.isAlive() && !battle.isBattleOver()) battle.playCard({ driver, cardIndex, targetVehicle: target });
		}
		if (!battle.isBattleOver()) battle.endPlayerTurn();
	}
	if (!battle.isBattleOver()) throw new Error("The fight didn't end in ten turns");
}
