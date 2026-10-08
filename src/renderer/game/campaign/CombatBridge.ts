import type { AIType } from '../ai/AIController';
import type { Rng } from '../core/Rng';
import { Battle } from '../mechanics/Battle';
import { Card } from '../mechanics/Card';
import type { AfterFight, DividendPayout } from '../mechanics/Convoy';
import { Deck } from '../mechanics/Deck';
import { DRIVER_CONFIGS, Driver, DriverRole } from '../mechanics/Driver';
import { assertDriverPair } from '../mechanics/DriverPair';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle, createDrivenVehicle } from '../mechanics/Vehicle';
import type { Campaign } from './Campaign';
import { CardCounts, NO_CARDS, readCardCounts } from './CardCounts';
import { DriverRecord, DriverRecordData, readDriverRecordData } from './DriverRecord';

/**
 * The combat bridge (DDB-286): a supply run's fights built from the
 * campaign, and what each fight did written back to it. Decision record:
 * docs/AI_TECHNICAL_DECISIONS/combat-bridge.md.
 */

/** A seated driver: their record, and the cards they took on the run. */
export interface RunSeat {
	readonly record: DriverRecord;
	/**
	 * Their run deck (Compound and Supply Runs, At load out). Left out, it's
	 * their default deck, which is what a run takes until load out builds
	 * run decks (DDB-315).
	 */
	readonly runDeck?: CardCounts;
}

/**
 * Who's out on a supply run, as the run controller holds it between
 * fights: the seated drivers in seat order, Driver 1 first, and the
 * convoy's escorts that came along (load out can leave some at home).
 */
export interface RunParty {
	readonly seats: readonly RunSeat[];
	readonly escorts: readonly Vehicle[];
}

/**
 * A fight built from a run party, already started. It's the combat
 * screen's PreparedCombat, so `{ prepare: async () => fight }` mounts it,
 * with the compound's scrap and fuel on the top bar.
 */
export interface CampaignFight {
	readonly battle: Battle;
	/** Each seat's combat driver, in seat order */
	readonly drivers: [Driver, Driver];
	readonly scrap: number;
	readonly fuel: number;
	/** The party it was built from, which the write-back carries on from */
	readonly party: RunParty;
}

export interface CampaignFightOptions {
	campaign: Campaign;
	party: RunParty;
	/** The encounter's raiders */
	enemyTeam: Team;
	/** The fight's stream, `run.fork('fight', i)` off the run's saved fight count */
	rng: Rng;
	/** Card templates by card type, as `CardLoader.getAllCardsAsMap` hands them out */
	cards: ReadonlyMap<string, Card>;
	/** How the raiders plan, aggressive as in the combat screen's own fight. Null plays each raider's first playable card. */
	enemyAI?: AIType | null;
}

/** What became of a seated driver: still in the fight at its end, dead, or crashed out and then picked up or missing. */
type Fate = 'aboard' | 'dead' | 'picked_up' | 'missing';

/**
 * What a fight did to the run, once it's written back. A fight is won, so
 * the run goes on, or lost with no driver left in it, which fails the run.
 */
export interface FightWriteBack {
	readonly outcome: 'won' | 'run_failed';
	/** Who goes on to the run's next stop; null once the run has failed */
	readonly party: RunParty | null;
	readonly dead: readonly DriverRecord[];
	/** Crashed out of a won fight, so the partner went back for them */
	readonly pickedUp: readonly DriverRecord[];
	/** Crashed out of the fight that failed the run, with nobody left to go back for them */
	readonly missing: readonly DriverRecord[];
	/** Gone from the convoy: wrecked in the fight, or, when it failed the run, every escort that came along */
	readonly escortsLost: readonly Vehicle[];
}

/** Fights already written back, so a second write-back can't pay the dividends twice. */
const writtenBack = new WeakSet<Battle>();

/**
 * Build a run's next fight and start it. Each seat's combat driver is their
 * record (name, HP, max HP, hand limit) and their archetype (skills,
 * adrenaline), dealing from their run deck in card-type order, at the wheel
 * of a fresh signature vehicle; the run's escorts follow in roster order.
 * Everything random draws from `rng`.
 *
 * Throws, building nothing, unless the party seats two drivers of different
 * archetypes from the campaign's pool who are ready to fight, every escort
 * is the campaign's and out of the last fight, and every card in the run
 * decks has a template. A team fields four escorts at most, so a run that a
 * fight left with five dismisses one first.
 */
export function startCampaignFight({ campaign, party, enemyTeam, rng, cards, enemyAI = 'aggressive' }: CampaignFightOptions): CampaignFight {
	if (party.seats.length !== 2) {
		throw new RangeError(`A fight seats two drivers, and this party has ${party.seats.length}; a run down to one driver can't field a fight yet`);
	}
	party.seats.forEach(({ record }) => {
		assertInPool({ campaign, record });
		if (record.status !== 'ready') throw new RangeError(`${describeRecord(record)} is ${record.status}, so they can't fight`);
	});
	party.escorts.forEach(escort => {
		if (!campaign.convoy.escorts.includes(escort)) throw new RangeError(`${escort.name} isn't in the campaign's convoy`);
		if (escort.slot || escort.passenger) throw new Error(`${escort.name} is still in a fight that wasn't written back`);
	});

	const drivers = party.seats.map(seat => combatDriverOf({ seat, cards }));
	assertDriverPair(drivers);
	const playerTeam = new Team({
		type: TeamType.PLAYER,
		vehicles: [
			...drivers.map(driver => createDrivenVehicle({ driver })),
			...campaign.convoy.escorts.filter(escort => party.escorts.includes(escort))
		]
	});
	const battle = new Battle({ playerTeam, enemyTeam, rng });
	battle.aiController.setEnemyAI(enemyAI);
	battle.start();
	return { battle, drivers, scrap: campaign.resources.scrap, fuel: campaign.resources.fuel, party };
}

/**
 * Write a finished fight back to the campaign and say where the run stands.
 * A driver still in the fight carries their HP on. A dead driver is gone
 * with their cards. A driver who crashed out is picked up after a win and
 * fights the next one; when the fight failed the run, they're missing.
 * Wrecked escorts leave the convoy, the rest keep their structure, and a
 * driven vehicle that carried on unmanned joins it; a failed run loses
 * every escort that came along. Haulers' fuel and scrap go into the
 * compound's stores; the Med Truck's heal is already in the drivers' HP.
 *
 * Everything is worked out and checked before anything is stored, then
 * stored in one order: the records in seat order, the convoy, the stores.
 * The campaign's own `change` comes last, once the records and the convoy
 * hold the fight. Saving is the caller's, at the end of the step.
 *
 * Throws, storing nothing, for a fight that isn't over, ended in a tie (a
 * campaign fight has no turn limit), or was written back already.
 */
export function writeBackFight({ campaign, fight }: { campaign: Campaign; fight: CampaignFight }): FightWriteBack {
	const { battle, drivers, party } = fight;
	const afterFight = battle.afterFight;
	if (!battle.isBattleOver() || !afterFight) throw new Error("The fight isn't over, so there's nothing to write back yet");
	if (battle.isBattleTied()) throw new Error('The fight ended in a tie at its turn limit; a campaign fight has none, so it ends won or lost');
	if (writtenBack.has(battle)) throw new Error('This fight has already been written back');
	party.seats.forEach(({ record }) => assertInPool({ campaign, record }));
	const won = battle.isBattleWon();

	const seats = party.seats.map((seat, index) => {
		const fate = fateOf({ battle, driver: drivers[index], won });
		return { seat, fate, changes: recordChanges({ fate, driver: drivers[index] }) };
	});
	seats.forEach(({ seat: { record }, changes }) => readDriverRecordData({ ...record.getState(), ...changes }, describeRecord(record)));
	const escortsLost = won ? afterFight.lost : campaign.convoy.escorts.filter(escort => party.escorts.includes(escort));
	const { fuel, scrap } = income(afterFight.dividends);

	writtenBack.add(battle);
	seats.forEach(({ seat: { record }, changes }) => record.set(changes));
	campaign.convoy.afterFight(won ? afterFight : lostWithTheRun(escortsLost));
	const carriedOn = won ? campaign.convoy.escorts.filter(escort => afterFight.escorts.includes(escort)) : [];
	// endCombat leaves seats alone, and a driver left aboard would ride into the next fight as well as drive in it
	carriedOn.forEach(escort => { escort.passenger = null; });
	if (fuel > 0 || scrap > 0) {
		const { resources } = campaign;
		campaign.set({ resources: { ...resources, fuel: resources.fuel + fuel, scrap: resources.scrap + scrap } });
	}

	const recordsFated = (fate: Fate): DriverRecord[] => seats.filter(seat => seat.fate === fate).map(({ seat }) => seat.record);
	return {
		outcome: won ? 'won' : 'run_failed',
		party: won ? { seats: seats.filter(({ fate }) => fate !== 'dead').map(({ seat }) => seat), escorts: carriedOn } : null,
		dead: recordsFated('dead'),
		pickedUp: recordsFated('picked_up'),
		missing: recordsFated('missing'),
		escortsLost
	};
}

/**
 * A seat's driver as a fight deals them: the record's name, HP, and hand
 * limit, the archetype's skills, vehicle, and adrenaline, and a fresh copy
 * of every card in the run deck.
 */
function combatDriverOf({ seat: { record, runDeck = record.defaultDeck }, cards }: { seat: RunSeat; cards: ReadonlyMap<string, Card> }): Driver {
	const config = DRIVER_CONFIGS[record.archetype];
	const deck = readCardCounts(runDeck, `${describeRecord(record)}'s run deck`);
	return new Driver({
		archetype: record.archetype,
		metadata: { ...config.metadata, name: record.name },
		skills: { ...config.skills },
		vehicleStats: { ...config.vehicleStats },
		startingDeck: { cards: config.startingDeck.cards.map(entry => ({ ...entry })) },
		hitpoints: record.hitpoints,
		maxHitpoints: record.maxHitpoints,
		adrenaline: config.maxAdrenaline,
		maxAdrenaline: config.maxAdrenaline,
		handLimit: record.handLimit,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck(`${record.id}_run_deck`, `${record.name}'s run deck`, Object.entries(deck).flatMap(([cardType, count]) => {
			const template = cards.get(cardType);
			if (!template) throw new RangeError(`${describeRecord(record)}'s run deck holds ${cardType}, which isn't a card`);
			return Array.from({ length: count }, () => template.copy());
		}))
	});
}

/** A driver still aboard is in the fight; one alive and not aboard crashed out of it. */
function fateOf({ battle, driver, won }: { battle: Battle; driver: Driver; won: boolean }): Fate {
	if (!driver.isAlive()) return 'dead';
	if (battle.playerTeam.isAboard(driver)) return 'aboard';
	return won ? 'picked_up' : 'missing';
}

/** Dying is one set of status, 0 HP, and an empty deck: the dead take their cards with them. */
function recordChanges({ fate, driver }: { fate: Fate; driver: Driver }): Partial<DriverRecordData> {
	switch (fate) {
		case 'dead':
			return { status: 'dead', hitpoints: 0, defaultDeck: NO_CARDS };
		case 'missing':
			return { status: 'missing', hitpoints: driver.hitpoints };
		default:
			return { hitpoints: driver.hitpoints };
	}
}

/** A failed run's convoy result: nothing carries on, and every escort that came along is lost with the run. */
function lostWithTheRun(escorts: readonly Vehicle[]): AfterFight {
	return { escorts: [], lost: [...escorts], dividends: [] };
}

/** The haulers' fuel and scrap. Heals land on the drivers in the fight. */
function income(dividends: readonly DividendPayout[]): { fuel: number; scrap: number } {
	const total = (kind: DividendPayout['kind']): number =>
		dividends.filter(payout => payout.kind === kind).reduce((sum, payout) => sum + payout.amount, 0);
	return { fuel: total('fuel'), scrap: total('scrap') };
}

function assertInPool({ campaign, record }: { campaign: Campaign; record: DriverRecord }): void {
	if (!campaign.drivers.includes(record)) throw new RangeError(`${describeRecord(record)} isn't in this campaign's pool`);
}

function describeRecord(record: DriverRecord): string {
	return `${record.name} (${record.id})`;
}
