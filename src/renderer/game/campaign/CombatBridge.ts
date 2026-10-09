import type { AIType } from '../ai/AIController';
import type { Rng } from '../core/Rng';
import { Battle } from '../mechanics/Battle';
import { Card } from '../mechanics/Card';
import type { DividendPayout } from '../mechanics/Convoy';
import { Deck } from '../mechanics/Deck';
import { DRIVER_CONFIGS, Driver, DriverRole } from '../mechanics/Driver';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle, createDrivenVehicle } from '../mechanics/Vehicle';
import { Campaign, NO_RESOURCES, Resources, readResources } from './Campaign';
import { NO_CARDS } from './CardCounts';
import { DriverRecord, DriverRecordData, VehicleCondition, readDriverRecordData } from './DriverRecord';
import { SeatBlocker, getSeatBlocker } from './Seating';

/**
 * The combat bridge (DDB-286): a supply run's fights built from the
 * campaign, and what each fight did written back to it. Decision record:
 * docs/AI_TECHNICAL_DECISIONS/combat-bridge.md.
 */

/** HP a driver downed in a won fight is back on their feet with. A tuning value. */
export const REVIVE_HP = 1;

/** Structure a wrecked driven vehicle limps into the next fight with. A tuning value. */
export const LIMP_STRUCTURE = 1;

/**
 * Who's out on a supply run, as the run controller holds it between
 * fights: the seated drivers' records in seat order, Driver 1 first, the
 * convoy's escorts that came along (load out can leave some at home), and
 * the cargo picked up so far, which reaches the compound's stores only if
 * the run gets home. A save between fights refers to the seats and escorts
 * by their campaign ids (`driver-<n>`, `escort-<n>`), which a load finds
 * again in the pool and the convoy.
 */
export interface RunParty {
	readonly seats: readonly DriverRecord[];
	readonly escorts: readonly Vehicle[];
	readonly cargo: Readonly<Resources>;
}

/**
 * A fight built from a run party, already started. It's the combat
 * screen's PreparedCombat, so `{ prepare: async () => fight }` mounts it,
 * with the run's cargo on the top bar.
 */
export interface CampaignFight {
	readonly campaign: Campaign;
	readonly battle: Battle;
	/** Each seat's combat driver, in seat order */
	readonly drivers: [Driver, Driver];
	/**
	 * Each seat's own vehicle, in seat order. By the end of the fight it can
	 * be a wreck that has left the team, an escort with nobody at the wheel,
	 * or driven by the partner; its damage is still its driver's.
	 */
	readonly vehicles: [Vehicle, Vehicle];
	readonly scrap: number;
	readonly fuel: number;
	/** The party it was built from, its escorts in roster order and its cargo checked */
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

/** A won fight: the run goes on, with both drivers. */
export interface WonFight {
	readonly outcome: 'won';
	/** Who goes on to the run's next stop, with the cargo the haulers added */
	readonly party: RunParty;
	/** Down in the fight, and back on their feet at REVIVE_HP */
	readonly revived: readonly DriverRecord[];
	/** Crashed out, so the partner went back for them */
	readonly pickedUp: readonly DriverRecord[];
	/** The convoy's escorts wrecked in the fight */
	readonly escortsLost: readonly Vehicle[];
}

/** A lost fight: nobody was left in it, so the run has failed. */
export interface FailedRun {
	readonly outcome: 'run_failed';
	readonly party: null;
	readonly dead: readonly DriverRecord[];
	/** Crashed out with nobody left to go back for them */
	readonly missing: readonly DriverRecord[];
	/** Every escort that came along, wrecked or not */
	readonly escortsLost: readonly Vehicle[];
	/** The cargo the run was bringing home */
	readonly cargoLost: Readonly<Resources>;
}

export type FightWriteBack = WonFight | FailedRun;

/** What became of a seated driver: still in the fight at its end, down, or crashed out, and what the outcome makes of that. */
type Fate = 'aboard' | 'revived' | 'picked_up' | 'dead' | 'missing';

/**
 * Each campaign's fight from its start until it's written back. One at a
 * time, so a fight can't start beside one that hasn't been written back,
 * and none is written back twice.
 */
const openFights = new WeakMap<Campaign, CampaignFight>();
/**
 * Campaigns partway through storing a write-back. The fight stops being
 * open before anything is stored, so this is what keeps a listener from
 * starting the next fight on records and a convoy that are half written.
 */
const storingWriteBacks = new WeakSet<Campaign>();

/**
 * Whether the campaign has a fight started and not yet written back, or
 * being written back. Nobody comes home while one is open
 * (`injureOnArrival`), since the write-back has to fit the records as the
 * fight left them, and a listener partway through it sees them half stored.
 */
export function hasOpenFight(campaign: Campaign): boolean {
	return openFights.has(campaign) || storingWriteBacks.has(campaign);
}

/**
 * Build a run's next fight and start it. Each seat's combat driver is their
 * record (name, HP, max HP, hand limit, deck) and their archetype (skills,
 * adrenaline), at the wheel of their signature vehicle with the damage the
 * record carries, clamped to the archetype's maximums as they stand now;
 * the run's escorts follow in roster order. Each deck is built from the
 * default deck in card-type order, and Battle.start shuffles it on the
 * seat's deck stream before the opening deal. Everything random draws from
 * `rng`.
 *
 * Throws, building nothing, while the campaign's last fight hasn't been
 * written back or is being written back (from a listener partway through
 * it), and unless the party seats two drivers load out's own check
 * (`getSeatBlocker`) seats together: each from the campaign's pool and
 * ready, checked in seat order, then two different drivers of different
 * archetypes. So does a party whose cargo doesn't check out, an escort that
 * isn't the campaign's, or a card in the decks with no template. The teams
 * and the encounter can refuse the road too (Team, Battle), and move nobody
 * when they do.
 */
export function startCampaignFight({ campaign, party, enemyTeam, rng, cards, enemyAI = 'aggressive' }: CampaignFightOptions): CampaignFight {
	if (storingWriteBacks.has(campaign)) throw new Error("This campaign's last fight is still being written back");
	if (openFights.has(campaign)) throw new Error("This campaign's last fight hasn't been written back");
	if (party.seats.length !== 2) throw new RangeError(`A fight seats two drivers, and this party has ${party.seats.length}`);
	const [first, second] = party.seats;
	// Each seat on its own before the pair, so a seat's own reason wins over the pairing's
	const checks = [{ driver: first, partner: null }, { driver: second, partner: null }, { driver: first, partner: second }];
	for (const { driver, partner } of checks) {
		const blocker = getSeatBlocker({ campaign, driver, partner });
		if (blocker !== null) throw new RangeError(seatRefusal({ record: driver, blocker }));
	}
	const cargo = readResources(party.cargo, 'RunParty.cargo');
	party.escorts.forEach(escort => {
		if (!campaign.convoy.escorts.includes(escort)) throw new RangeError(`${escort.name} isn't in the campaign's convoy`);
	});
	const escorts = campaign.convoy.escorts.filter(escort => party.escorts.includes(escort));

	const drivers: [Driver, Driver] = [combatDriverOf({ record: first, cards }), combatDriverOf({ record: second, cards })];
	const vehicles: [Vehicle, Vehicle] = [vehicleOf({ record: first, driver: drivers[0] }), vehicleOf({ record: second, driver: drivers[1] })];
	const playerTeam = new Team({ type: TeamType.PLAYER, vehicles: [...vehicles, ...escorts] });
	const battle = new Battle({ playerTeam, enemyTeam, rng });
	battle.aiController.setEnemyAI(enemyAI);
	battle.start();
	const fight: CampaignFight = { campaign, battle, drivers, vehicles, scrap: cargo.scrap, fuel: cargo.fuel, party: { seats: party.seats, escorts, cargo } };
	openFights.set(campaign, fight);
	return fight;
}

/**
 * Write a finished fight back to its campaign and say where the run
 * stands. After a win both drivers go on: one still in the fight carries
 * their HP, one who crashed out is picked up, and one who went down is
 * revived at REVIVE_HP. Each driver's vehicle carries its damage, and a
 * wreck limps on at LIMP_STRUCTURE. Wrecked escorts leave the convoy and
 * the rest keep their structure. The haulers' fuel and scrap go into the
 * party's cargo; the Med Truck's heal is already in the drivers' HP. A
 * lost fight fails the run: the drivers who went down are dead, with their
 * cards, the ones who crashed out are missing, and the cargo and every
 * escort that came along are lost.
 *
 * Everything is worked out and checked before anything is stored, then
 * stored in one order: the records in seat order, then the convoy and its
 * seats. The compound's stores are the run controller's, when the run
 * gets home. Save at the step's checkpoint, after this: until a fight is
 * written back its wrecked escorts are still in the convoy, and a campaign
 * holding a wreck can't be saved.
 *
 * Throws, storing nothing, for a fight that isn't over, ended in a tie (a
 * campaign fight has no turn limit), or is written back already, and for a
 * result its records no longer fit. When storing throws part way (a
 * listener changed a record in between), the fight can be written back
 * again: every step stores the same thing a second time.
 */
export function writeBackFight({ fight }: { fight: CampaignFight }): FightWriteBack {
	const { campaign, battle, drivers, vehicles, party } = fight;
	const afterFight = battle.afterFight;
	if (!battle.isBattleOver() || !afterFight) throw new Error("The fight isn't over, so there's nothing to write back yet");
	if (battle.isBattleTied()) throw new Error('The fight ended in a tie at its turn limit; a campaign fight has none, so it ends won or lost');
	if (openFights.get(campaign) !== fight) throw new Error('This fight has already been written back');
	const won = battle.isBattleWon();

	const seats = party.seats.map((record, index) => {
		const fate = fateOf({ battle, driver: drivers[index], won });
		const changes = recordChanges({ fate, driver: drivers[index], vehicle: vehicles[index] });
		readDriverRecordData({ ...record.getState(), ...changes }, describeRecord(record));
		return { record, fate, changes };
	});
	const escortsLost = won ? afterFight.lost : party.escorts;
	const cargo = won ? readResources(withDividends({ cargo: party.cargo, dividends: afterFight.dividends }), 'RunParty.cargo') : NO_RESOURCES;

	// Closed before storing, so a write-back started from a listener partway through is refused
	openFights.delete(campaign);
	storingWriteBacks.add(campaign);
	try {
		seats.forEach(({ record, changes }) => record.set(changes));
		campaign.convoy.afterFight({ lost: escortsLost });
		// endCombat leaves seats alone, and a driver left aboard would ride into the next fight as well as drive in it
		party.escorts.forEach(escort => { escort.passenger = null; });
	} catch (error) {
		openFights.set(campaign, fight);
		throw error;
	} finally {
		storingWriteBacks.delete(campaign);
	}

	const recordsFated = (fate: Fate): DriverRecord[] => seats.filter(seat => seat.fate === fate).map(({ record }) => record);
	if (!won) {
		return { outcome: 'run_failed', party: null, dead: recordsFated('dead'), missing: recordsFated('missing'), escortsLost, cargoLost: party.cargo };
	}
	return {
		outcome: 'won',
		party: { seats: party.seats, escorts: party.escorts.filter(escort => !escortsLost.includes(escort)), cargo },
		revived: recordsFated('revived'),
		pickedUp: recordsFated('picked_up'),
		escortsLost
	};
}

/**
 * A seat's driver as a fight deals them: the record's name, HP, and hand
 * limit, the archetype's skills, vehicle, and adrenaline, and a fresh copy
 * of every card in their default deck, which is also the starting deck
 * they're dealt.
 */
function combatDriverOf({ record, cards }: { record: DriverRecord; cards: ReadonlyMap<string, Card> }): Driver {
	const config = DRIVER_CONFIGS[record.archetype];
	const deck = Object.entries(record.defaultDeck);
	return new Driver({
		archetype: record.archetype,
		metadata: { ...config.metadata, name: record.name },
		skills: { ...config.skills },
		vehicleStats: { ...config.vehicleStats },
		startingDeck: { cards: deck.map(([type, quantity]) => ({ type, quantity })) },
		hitpoints: record.hitpoints,
		maxHitpoints: record.maxHitpoints,
		adrenaline: config.maxAdrenaline,
		maxAdrenaline: config.maxAdrenaline,
		handLimit: record.handLimit,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: new Deck(`${record.id}_deck`, `${record.name}'s deck`, deck.flatMap(([cardType, count]) => {
			const template = cards.get(cardType);
			if (!template) throw new RangeError(`${describeRecord(record)}'s deck holds ${cardType}, which isn't a card`);
			return Array.from({ length: count }, () => template.copy());
		}))
	});
}

/**
 * A seat's signature vehicle, carrying the damage on the record, clamped to
 * the archetype's maximums as they stand: a retune since the record was
 * saved lowers them, and the next write-back stores the clamped values.
 */
function vehicleOf({ record, driver }: { record: DriverRecord; driver: Driver }): Vehicle {
	const { maxStructure, armor: maxArmor } = driver.vehicleStats;
	return createDrivenVehicle({
		driver,
		structure: Math.min(record.vehicle.structure, maxStructure),
		armor: Math.min(record.vehicle.armor, maxArmor)
	});
}

/** A driver still aboard is in the fight; one at 0 HP went down; one alive and not aboard crashed out of it. */
function fateOf({ battle, driver, won }: { battle: Battle; driver: Driver; won: boolean }): Fate {
	if (!driver.isAlive()) return won ? 'revived' : 'dead';
	if (battle.playerTeam.isAboard(driver)) return 'aboard';
	return won ? 'picked_up' : 'missing';
}

/**
 * Each seat's record after the fight, in one set. Dying is status, 0 HP,
 * and an empty deck: the dead take their cards with them.
 */
function recordChanges({ fate, driver, vehicle }: { fate: Fate; driver: Driver; vehicle: Vehicle }): Partial<DriverRecordData> {
	switch (fate) {
		case 'dead':
			return { status: 'dead', hitpoints: 0, defaultDeck: NO_CARDS };
		case 'missing':
			return { status: 'missing', hitpoints: driver.hitpoints, vehicle: conditionOf(vehicle) };
		case 'revived':
			return { hitpoints: REVIVE_HP, vehicle: conditionOf(vehicle) };
		default:
			return { hitpoints: driver.hitpoints, vehicle: conditionOf(vehicle) };
	}
}

/** The damage a vehicle carries out of a fight. A wreck has no armor left (Vehicle.destroy) and limps on. */
function conditionOf(vehicle: Vehicle): VehicleCondition {
	return { structure: vehicle.isAlive() ? vehicle.structure : LIMP_STRUCTURE, armor: vehicle.armor };
}

/** The cargo with the haulers' fuel and scrap added. A heal lands on the drivers in the fight instead. */
function withDividends({ cargo, dividends }: { cargo: Readonly<Resources>; dividends: readonly DividendPayout[] }): Resources {
	const total = (kind: DividendPayout['kind']): number =>
		dividends.filter(payout => payout.kind === kind).reduce((sum, payout) => sum + payout.amount, 0);
	return { ...cargo, fuel: cargo.fuel + total('fuel'), scrap: cargo.scrap + total('scrap') };
}

/** Why a fight won't seat a driver, from load out's own check. */
function seatRefusal({ record, blocker }: { record: DriverRecord; blocker: SeatBlocker }): string {
	switch (blocker.reason) {
		case 'already_seated':
			return `${describeRecord(record)} is in both seats; a fight seats two different drivers`;
		case 'same_archetype':
			return `${describeRecord(record)} and ${describeRecord(blocker.partner)} are both ${blocker.archetype}; a fight seats two different archetypes`;
		default:
			return `${describeRecord(record)} is ${record.status}, so they can't fight`;
	}
}

function describeRecord(record: DriverRecord): string {
	return `${record.name} (${record.id})`;
}
