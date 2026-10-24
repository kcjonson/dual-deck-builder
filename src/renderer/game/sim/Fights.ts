import { seatOf, seatPartners, seatWriteBack } from '../campaign/CombatBridge';
import { DriverRecord, placeholderName } from '../campaign/DriverRecord';
import { encounterForces, Skulls } from '../campaign/Encounters';
import { injuryDays } from '../campaign/Infirmary';
import { RunDeck } from '../campaign/RunDeck';
import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import { BREAK_OFF_TURNS, Battle } from '../mechanics/Battle';
import { Card, CardData } from '../mechanics/Card';
import { DRIVER_CONFIGS } from '../mechanics/Driver';
import { Team } from '../mechanics/Team';
import { TeamType } from '../mechanics/TeamType';
import type { Vehicle } from '../mechanics/Vehicle';
import { Rate, mean, rate } from './Measures';
import { SeatInput, SimConfig } from './SimConfig';

/**
 * The balance sim's fights (Balance Simulation, fights): a crew, fresh and on
 * its decks, through a route's fights in order, played by the game's own
 * Battle and AI controller, seated and written back by the combat bridge
 * (`seatOf`, `seatWriteBack`), against encounter templates picked and sized
 * as a run's stop does it (`encounterForces`), waves, rout, and break-off
 * included. A broken-off fight carries the run on, as the bridge does.
 * Nothing here copies a rule, so a rule change reaches the sim without
 * touching it.
 *
 * Streams: run n of every cell draws from `fork('run', n)` off the seed, and
 * its fight f from that run's `fork('fight', f)`, so every crew meets the
 * same draws and adding a cell moves no other cell's numbers. A pair swaps
 * seats on every odd run.
 */

/** Card templates by type, as the game's CardLoader would hand them out, read from the bundled cards.json. */
export const SIM_CARDS: ReadonlyMap<string, Card> = new Map(
	(cardsFile as { cards: Omit<CardData, 'upgraded'>[] }).cards.map(data => [data.type, new Card({ ...data, upgraded: false })])
);

export interface FightCell {
	/** `<crew>:<route>`, archetypes and skulls joined by `+`: `road_warrior+interceptor:1+2`; a crew asked for twice, on other decks, adds `#<its place in the crews>`. */
	readonly name: string;
	readonly crew: readonly SeatInput[];
	readonly route: readonly Skulls[];
}

/** Every crew against every route, crew by crew. */
export function fightCells(config: SimConfig): FightCell[] {
	const names = config.crews.map(crewName);
	return config.crews.flatMap((crew, index) => {
		const name = names.indexOf(names[index]) === names.lastIndexOf(names[index]) ? names[index] : `${names[index]}#${index}`;
		return config.routes.map(route => ({ name: `${name}:${route.join('+')}`, crew, route }));
	});
}

/** A crew's archetypes in seat order, joined by `+`. */
export function crewName(crew: readonly SeatInput[]): string {
	return crew.map(seat => seat.archetype).join('+');
}

export type RunOutcome = 'home' | 'lost' | 'stalled';

/** One run of a cell. Lost, damage, and turns are over the fights played. */
export interface FightRun {
	readonly outcome: RunOutcome;
	/** Who drove seat 1. */
	readonly firstSeat: string;
	/** Whether a pair drove in the crew's seat order (even runs) or swapped (odd runs). */
	readonly swapped: boolean;
	/** The last fight played, for its log. */
	readonly battle: Battle;
	/** Turns over every fight the run played. */
	readonly turns: number;
	/** Whether a driver went down in any fight. */
	readonly down: boolean;
	/** Crew HP and structure lost as a share of the crew's maximum, at the end. */
	readonly hpLost: number;
	readonly structureLost: number;
	/** Injury days the crew brings home; 0 off a run that didn't get home. */
	readonly injuryDays: number;
	readonly raidersKilled: number;
	/** Whether any fight the run played ended in a rout, or broken off. */
	readonly routed: boolean;
	readonly brokenOff: boolean;
	/** Fights the run played. */
	readonly fights: number;
	/** The raiders' cards over every fight the run played. */
	readonly raiderPlays: RaiderPlays;
}

/** A raider card's plays as the enemy turn plays them: resolved, hit or miss, and fizzled. */
export interface CardPlays {
	readonly played: number;
	readonly fizzled: number;
}

/** Card plays by raider vehicle, then card. */
export type RaiderPlays = Readonly<Record<string, Readonly<Record<string, CardPlays>>>>;

/** Run `index` of a crew through its route's fights. */
export async function playRun({ config, cell, index }: { config: SimConfig; cell: FightCell; index: number }): Promise<FightRun> {
	const { crew, route } = cell;
	const swapped = crew.length === 2 && index % 2 === 1;
	const seated = swapped ? [crew[1], crew[0]] : crew;
	const records = seated.map(({ archetype }, seat) => new DriverRecord({ id: `driver-${seat + 1}`, archetype, name: placeholderName({ archetype, ordinal: 1 }) }));
	const decks = seated.map(({ deck }, seat) => deck ?? records[seat].defaultDeck);
	const stream = new Rng({ seed: config.seed }).fork('run', index);
	let down = false;
	let turns = 0;
	let raidersKilled = 0;
	let routed = false;
	let brokenOff = false;
	let battle: Battle | null = null;
	let outcome: RunOutcome = 'home';
	let fights = 0;
	const raiderPlays: PlayTally = {};
	for (const [stop, skulls] of route.entries()) {
		const partners = seatPartners(records);
		const seats = records.map((record, seat) => seatOf({ record, runDeck: new RunDeck({ driver: record, own: decks[seat] }), cards: SIM_CARDS, partner: partners[seat] }));
		const fought = await playFight({ config, vehicles: seats.map(seat => seat.vehicle), skulls, rng: stream.fork('fight', stop), raiderPlays });
		battle = fought.battle;
		fights += 1;
		turns += battle.turn;
		raidersKilled += fought.raidersKilled;
		routed ||= battle.routed ?? false;
		brokenOff ||= fought.outcome === 'broken';
		if (fought.outcome !== 'won' && fought.outcome !== 'broken') {
			outcome = fought.outcome;
			break;
		}
		seats.forEach(({ driver, vehicle }, seat) => {
			down ||= !driver.isAlive();
			records[seat].set(seatWriteBack({ battle: fought.battle, driver, vehicle }));
		});
	}
	const share = (lost: (record: DriverRecord) => number, max: (record: DriverRecord) => number): number =>
		records.reduce((sum, record) => sum + lost(record), 0) / records.reduce((sum, record) => sum + max(record), 0);
	const maxStructure = (record: DriverRecord): number => DRIVER_CONFIGS[record.archetype].vehicleStats.maxStructure;
	return {
		outcome,
		firstSeat: seated[0].archetype,
		swapped,
		battle: battle as Battle,
		turns,
		down,
		hpLost: share(record => DRIVER_CONFIGS[record.archetype].maxHitpoints - record.hitpoints, record => DRIVER_CONFIGS[record.archetype].maxHitpoints),
		structureLost: share(record => maxStructure(record) - record.vehicle.structure, maxStructure),
		injuryDays: outcome === 'home' ? records.reduce((sum, record) => sum + injuryDays(record), 0) : 0,
		raidersKilled,
		routed,
		brokenOff,
		fights,
		raiderPlays,
	};
}

type PlayTally = Record<string, Record<string, { played: number; fizzled: number }>>;

/** One fight, the AIs on both sides, against a template for the skull count at the config's tier and stage, as a run's stop fields it. */
async function playFight({ config, vehicles, skulls, rng, raiderPlays }: { config: SimConfig; vehicles: Vehicle[]; skulls: Skulls; rng: Rng; raiderPlays: PlayTally }): Promise<{ battle: Battle; outcome: 'won' | 'lost' | 'stalled' | 'broken'; raidersKilled: number }> {
	const { team: enemyTeam } = encounterForces({
		skulls,
		tier: config.tier,
		cards: SIM_CARDS,
		seats: vehicles.length,
		rng,
		stage: config.stage,
		data: config.encounters,
		profiles: config.raiders,
	});
	// Each raider with the driver it opened with, since a raider is out when either is; the queued waves too
	const raiders = [...enemyTeam.vehicles, ...(enemyTeam.reinforcements ?? []).flatMap(wave => wave.raiders)].map(vehicle => ({ vehicle, driver: vehicle.driver }));
	const battle = new Battle({ playerTeam: new Team({ type: TeamType.PLAYER, vehicles }), enemyTeam, rng, breakOffTurns: BREAK_OFF_TURNS });
	battle.aiController.setEnemyAI(config.enemyAI);
	battle.aiController.setPlayerAI(config.playerAI);
	battle.start();
	while (!battle.isBattleOver() && battle.turn <= config.turns) {
		await battle.aiController.playPlayerCards();
		// Stepped rather than run whole, the same play, so each raider card is counted as it resolves or fizzles
		battle.endPlayerTurn({ stepEnemyTurn: true });
		for (let step = battle.stepEnemyTurn(); step; step = battle.stepEnemyTurn()) {
			if (!step.card || step.outcome === 'dropped') continue;
			const cards = raiderPlays[step.raider.name] ??= {};
			const plays = cards[step.card.name] ??= { played: 0, fizzled: 0 };
			plays[step.outcome] += 1;
		}
	}
	const outcome = !battle.isBattleOver() ? 'stalled' : battle.isBattleWon() ? 'won' : battle.isBattleBrokenOff() ? 'broken' : 'lost';
	return { battle, outcome, raidersKilled: raiders.filter(({ vehicle, driver }) => !vehicle.isAlive() || !(driver?.isAlive() ?? false)).length };
}

/** A cell's measures (Balance Simulation, Measures). Damage, down, turns, and injury days are over the runs that got home. */
export interface FightRow {
	readonly cell: string;
	readonly crew: readonly string[];
	readonly route: readonly number[];
	readonly runs: number;
	readonly won: Rate;
	/** For a pair, won as seated in the crew's order, then swapped. */
	readonly bySeat: readonly Rate[] | null;
	readonly stalled: Rate;
	readonly lost: Rate;
	readonly hpLost: number | null;
	readonly structureLost: number | null;
	readonly down: Rate;
	/** A run's turns, over every fight it played. */
	readonly turns: number | null;
	readonly injuryDays: number | null;
	/** Over every run. */
	readonly raidersKilled: number | null;
	/** Runs with a fight that ended in a rout, or broken off, over every run. */
	readonly routed: Rate;
	readonly brokenOff: Rate;
	/** The raiders' cards a fight, over every fight of every run. */
	readonly raiderPlays: RaiderPlays;
}

/** Every run of a cell, measured. */
export async function playFightCell({ config, cell }: { config: SimConfig; cell: FightCell }): Promise<FightRow> {
	const results: FightRun[] = [];
	for (let index = 0; index < config.runs; index += 1) results.push(await playRun({ config, cell, index }));
	const home = results.filter(result => result.outcome === 'home');
	const count = (outcome: RunOutcome): Rate => rate(results.filter(result => result.outcome === outcome).length, results.length);
	const wonSeated = (swapped: boolean): Rate => {
		const seated = results.filter(result => result.swapped === swapped);
		return rate(seated.filter(result => result.outcome === 'home').length, seated.length);
	};
	return {
		cell: cell.name,
		crew: cell.crew.map(seat => seat.archetype),
		route: [...cell.route],
		runs: results.length,
		won: count('home'),
		bySeat: cell.crew.length === 2 ? [wonSeated(false), wonSeated(true)] : null,
		stalled: count('stalled'),
		lost: count('lost'),
		hpLost: mean(home.map(result => result.hpLost)),
		structureLost: mean(home.map(result => result.structureLost)),
		down: rate(home.filter(result => result.down).length, home.length),
		turns: mean(home.map(result => result.turns)),
		injuryDays: mean(home.map(result => result.injuryDays)),
		raidersKilled: mean(results.map(result => result.raidersKilled)),
		routed: rate(results.filter(result => result.routed).length, results.length),
		brokenOff: rate(results.filter(result => result.brokenOff).length, results.length),
		raiderPlays: playsAFight(results),
	};
}

/** Every run's raider plays summed, a fight. */
function playsAFight(results: readonly FightRun[]): RaiderPlays {
	const fights = results.reduce((sum, result) => sum + result.fights, 0);
	const total: PlayTally = {};
	for (const result of results) {
		for (const [raider, cards] of Object.entries(result.raiderPlays)) {
			for (const [card, { played, fizzled }] of Object.entries(cards)) {
				const sum = (total[raider] ??= {})[card] ??= { played: 0, fizzled: 0 };
				sum.played += played / fights;
				sum.fizzled += fizzled / fights;
			}
		}
	}
	return total;
}

/** One run's last fight as its battle log, with how the run came out. */
export async function fightLog({ config, cell, index }: { config: SimConfig; cell: FightCell; index: number }): Promise<{ lines: string[]; run: FightRun }> {
	const run = await playRun({ config, cell, index });
	const lines = run.battle.getMessages().filter(({ type }) => type !== 'debug').map(({ turn, type, message }) => `${turn} ${type}: ${message}`);
	return { lines, run };
}
