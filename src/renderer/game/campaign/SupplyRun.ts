import type { AIType } from '../ai/AIController';
import { Rng } from '../core/Rng';
import type { Card } from '../mechanics/Card';
import { MAX_CONVOY_ESCORTS, Team } from '../mechanics/Team';
import type { Vehicle } from '../mechanics/Vehicle';
import { Campaign, NO_RESOURCES, RESOURCE_NAMES, Resources, UnloadedCargo, resourceAmount } from './Campaign';
import { CampaignEnd, refuseOver, refuseOverBlocker } from './CampaignEnd';
import { CardCounts, NO_CARDS } from './CardCounts';
import { addCardsWon } from './CardsWon';
import { CampaignFight, FailedRun, RunParty, WonFight, startCampaignFight, writeBackFight } from './CombatBridge';
import { DayEnd, endDay } from './DayClock';
import { cardName } from './DeckRules';
import type { DriverRecord } from './DriverRecord';
import { EncounterId, encounterFor, encounterTeam } from './Encounters';
import { Injury, injureOnArrival } from './Infirmary';
import type { RunDeck } from './RunDeck';
import { rollRewardCards } from './RunRewards';
import { getCrewRule, getSeatBlocker } from './Seating';
import { RouteStop, RouteYield, RunRoute, YIELD_RESOURCES, routeStops, supplyRoutes } from './SupplyRoutes';
import type { SupplyRun } from './SupplyRunState';

/**
 * The MVP supply run (DDB-454): depart on a route, take its stops in order,
 * a fight through the combat bridge with a card reward after each win, load
 * the destination's yield, and come home, or lose the run. A stand-in for
 * the full run controller (DDB-322), which keeps this state machine and
 * swaps the mock routes (`routesOnOffer`) for the area map. Decision record:
 * docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md.
 *
 * The run's state is the campaign's `supplyRun`, saved with it. Every step
 * here changes the campaign and nothing else, and the caller checkpoints at
 * its end, as after any step.
 */

/**
 * Why the compound can't plan a run, which its Plan a supply run button
 * shows: the campaign is over, a run is out (on the road, or a load out
 * under way), nobody at the compound can go (`getCrewRule`), no route is on
 * offer, or the stores hold less fuel than today's cheapest route costs.
 */
export type PlanBlocker =
	| { reason: 'campaign_over'; end: Readonly<CampaignEnd> }
	| { reason: 'run_out'; run: string }
	| { reason: 'no_crew' }
	| { reason: 'no_routes' }
	| { reason: 'too_little_fuel'; needed: number; held: number };

/** Why a route can't be taken now, which the route pick shows on it. */
export type DepartBlocker =
	| { reason: 'campaign_over'; end: Readonly<CampaignEnd> }
	| { reason: 'run_out'; run: string }
	| { reason: 'too_little_fuel'; needed: number; held: number };

/** A departure the rules refuse, carrying the blocker. */
export class DepartRuleError extends RangeError {
	public readonly blocker: DepartBlocker;

	constructor({ message, blocker }: { message: string; blocker: DepartBlocker }) {
		super(message);
		this.name = 'DepartRuleError';
		this.blocker = blocker;
	}
}

/** How a stop's fight ended: the run goes on to a reward, or it failed. */
export type StopFightResult =
	| { readonly outcome: 'won'; readonly fight: WonFight }
	| {
		readonly outcome: 'run_failed';
		readonly fight: FailedRun;
		/** The run decks lost with the dead. */
		readonly lost: readonly RunDeck[];
		/** The night after, or null when the failed run ended the campaign. */
		readonly dayEnd: DayEnd | null;
	};

/** What getting home did, for the run screen's summary. */
export interface Arrival {
	/** Who drove, in seat order. */
	readonly seats: readonly DriverRecord[];
	readonly cargo: UnloadedCargo;
	readonly injuries: readonly Injury[];
	readonly dayEnd: DayEnd;
}

/**
 * The routes on offer today. The one place the run's routes come from, so
 * the area map and its route descriptors (DDB-322) replace the mock here.
 */
export function routesOnOffer({ campaign }: { campaign: Campaign }): readonly RunRoute[] {
	return supplyRoutes({ seed: campaign.seed, day: campaign.day });
}

/**
 * Who a run can seat now, by the crew rule (`getCrewRule`), Driver 1 first
 * in pool order: the first pair of different archetypes, or of one
 * archetype when that's all that's ready, or the one driver ready; null
 * when nobody can go.
 */
export function seatableCrew({ campaign }: { campaign: Campaign }): readonly DriverRecord[] | null {
	const free = campaign.drivers.filter(driver => getSeatBlocker({ campaign, driver }) === null);
	if (getCrewRule({ campaign }) === 'solo') return free.slice(0, 1);
	for (const first of free) {
		const second = free.find(driver => driver !== first && getSeatBlocker({ campaign, driver, partner: first }) === null);
		if (second) return [first, second];
	}
	return null;
}

/**
 * Load out, stubbed until its screen exists (DDB-320): the crew a run can
 * seat (`seatableCrew`: a pair, a same-archetype pair, or one driver alone),
 * on their default decks, and every escort in the convoy, up to
 * `MAX_CONVOY_ESCORTS` in roster order, their cards to Driver 1, through
 * `startRunDecks`. The one call a load out screen replaces. Throws with
 * nobody to send, and as `startRunDecks` does.
 */
export function quickLoadOut({ campaign }: { campaign: Campaign }): { seats: readonly DriverRecord[]; escorts: readonly Vehicle[] } {
	const seats = seatableCrew({ campaign });
	if (seats === null) throw new RangeError('Nobody at the compound can go out on a run');
	const escorts = campaign.convoy.escorts.slice(0, MAX_CONVOY_ESCORTS);
	campaign.startRunDecks({ seats, escorts });
	return { seats, escorts };
}

export function getPlanBlocker({ campaign }: { campaign: Campaign }): PlanBlocker | null {
	if (campaign.end !== null) return { reason: 'campaign_over', end: campaign.end };
	const run = campaign.currentRun;
	if (run !== null) return { reason: 'run_out', run };
	if (seatableCrew({ campaign }) === null) return { reason: 'no_crew' };
	const routes = routesOnOffer({ campaign });
	if (routes.length === 0) return { reason: 'no_routes' };
	const needed = Math.min(...routes.map(route => route.fuel));
	const held = campaign.resources.fuel;
	return held < needed ? { reason: 'too_little_fuel', needed, held } : null;
}

/**
 * Why this route can't set off now, in this order: the campaign is over, a
 * run is already on the road, or the stores hold less fuel than it costs.
 * A load out under way, its run decks started, is what departs, so it
 * doesn't block.
 */
export function getDepartBlocker({ campaign, route }: { campaign: Campaign; route: RunRoute }): DepartBlocker | null {
	if (campaign.end !== null) return { reason: 'campaign_over', end: campaign.end };
	const run = campaign.currentRun;
	if (campaign.supplyRun !== null && run !== null) return { reason: 'run_out', run };
	const held = campaign.resources.fuel;
	return held < route.fuel ? { reason: 'too_little_fuel', needed: route.fuel, held } : null;
}

/**
 * The run sets off on a route on offer today, with the run decks load out
 * started and the escorts it brought: the fuel is paid, and the run is on
 * the road at its first stop with no cargo, in one `set`. One run a day
 * holds because every run's end ends the day (`arriveHome`,
 * `finishStopFight`), and nothing departs while a run is out.
 *
 * The route is today's own by its id, so what's checked is what's paid.
 * Throws, changing nothing, for a route not on offer today, a
 * `DepartRuleError` when `getDepartBlocker` refuses (a `CampaignOverError`
 * once the campaign is over), and a plain error with no run decks started
 * and for escorts that aren't the ones whose cards load out dealt into the
 * run decks: each the convoy's, listed once, `MAX_CONVOY_ESCORTS` at most,
 * every escort card's escort among them, and every one with a signature
 * card holding it in a run deck.
 */
export function departRun({ campaign, route, escorts }: { campaign: Campaign; route: RunRoute; escorts: readonly Vehicle[] }): SupplyRun {
	const offered = routesOnOffer({ campaign }).find(offer => offer.id === route.id);
	if (!offered) throw new RangeError(`${route.id} isn't on offer on day ${campaign.day}`);
	const blocker = getDepartBlocker({ campaign, route: offered });
	refuseOverBlocker({ blocker, action: 'set off on a run' });
	if (blocker !== null) throw new DepartRuleError({ message: departRefusal(blocker), blocker });
	if (campaign.currentRun === null) throw new Error('Load out starts the run decks before a run sets off');
	checkEscorts({ campaign, escorts });
	campaign.set({
		resources: { ...campaign.resources, fuel: campaign.resources.fuel - offered.fuel },
		supplyRun: arrivedAt({ route: offered, stop: 0, phase: 'driving', escorts, cargo: NO_RESOURCES, cargoCards: NO_CARDS }),
	});
	return requireRun(campaign);
}

/** The run on the road as the combat bridge takes it: the run decks' drivers, and the run's escorts, cargo, and id. */
export function runParty({ campaign }: { campaign: Campaign }): RunParty {
	const { escorts, cargo, cargoCards } = requireRun(campaign);
	return { seats: campaign.runDecks.map(deck => deck.driver), escorts, cargo, cargoCards, run: campaign.currentRun as string };
}

/** The stop the run is driving to or at, or null once it's heading home. */
export function currentStop(run: SupplyRun): RouteStop | null {
	return routeStops(run.route)[run.stop] ?? null;
}

/** Whether the run has reached its destination: every stop behind it, the yield in its cargo, and home ahead. */
export function atDestination(run: SupplyRun): boolean {
	return run.stop >= routeStops(run.route).length;
}

/** A quiet stretch passes: on to the next stop, or the destination. Throws unless the run is driving to a quiet stop. */
export function passQuietStop({ campaign }: { campaign: Campaign }): void {
	const run = drivingTo({ campaign, kind: 'quiet' });
	campaign.set({ supplyRun: arrivedAt({ ...run, stop: run.stop + 1 }) });
}

export interface StopFightOptions {
	campaign: Campaign;
	/** Card templates by type, as `CardLoader.getAllCardsAsMap` hands them out. */
	cards: ReadonlyMap<string, Card>;
	/** The raiders for an encounter: the encounter table's when left out. */
	raiders?: (encounter: EncounterId) => Team;
	/** The raiders' AI, the bridge's aggressive when left out. */
	enemyAI?: AIType | null;
}

/**
 * The fight at the run's stop, started through the combat bridge on the
 * run's stream for that stop, `fork('fight', stop)` off the run's own
 * (`runStream`). Nothing is saved: a load finds the run driving to this
 * stop, and the fight replays from the same stream. Throws unless the run
 * is driving to a fight, and as `startCampaignFight` does.
 */
export function startStopFight({ campaign, cards, raiders, enemyAI }: StopFightOptions): CampaignFight {
	const run = drivingTo({ campaign, kind: 'fight' });
	const encounter = encounterFor((currentStop(run) as Extract<RouteStop, { kind: 'fight' }>).skulls);
	const enemyTeam = raiders ? raiders(encounter) : encounterTeam({ encounter, cards });
	return startCampaignFight({
		campaign,
		party: runParty({ campaign }),
		enemyTeam,
		rng: runStream({ campaign }).fork('fight', run.stop),
		cards,
		...(enemyAI === undefined ? {} : { enemyAI }),
	});
}

/**
 * A stop's fight written back. A win carries the write-back's party on,
 * its escorts and cargo, to the stop's reward. A loss, a fight given up
 * included (`Battle.forfeit`), fails the run: the log names who died and
 * who went missing, `loseRun` loses the run and logs its cargo, and the day
 * ends unless the campaign is over, as a run getting home does. Throws as
 * `writeBackFight` does, and as `loseRun` and `endDay` do.
 */
export function finishStopFight({ campaign, fight }: { campaign: Campaign; fight: CampaignFight }): StopFightResult {
	const run = requireRun(campaign);
	const result = writeBackFight({ fight });
	if (result.outcome === 'won') {
		const { escorts, cargo, cargoCards } = result.party;
		campaign.set({ supplyRun: { ...run, escorts, cargo, cargoCards, phase: 'reward' } });
		return Object.freeze({ outcome: 'won', fight: result });
	}
	campaign.addLogEntry({ message: fallenMessage({ route: run.route, dead: result.dead, missing: result.missing }) });
	const { lost } = campaign.loseRun({ result });
	const dayEnd = campaign.isOver ? null : endDay({ campaign });
	return Object.freeze({ outcome: 'run_failed', fight: result, lost, dayEnd });
}

/**
 * The cards on offer after the fight at the run's stop: drawn from the
 * run's stream for that stop, `fork('reward', stop)`, so a load offers the
 * same ones. Throws unless the run is at a reward.
 */
export function rewardOffer({ campaign }: { campaign: Campaign }): readonly string[] {
	const run = atReward({ campaign });
	return rollRewardCards({ rng: runStream({ campaign }).fork('reward', run.stop), ownsEscort: campaign.convoy.escorts.length > 0 });
}

/**
 * The reward picked, one of `rewardOffer`'s cards, or skipped with null:
 * a card picked rides home as cargo (`addCardsWon`), and the run drives on
 * to its next stop, or reaches its destination, in one `set`. Throws unless
 * the run is at a reward, and for a card that isn't on offer.
 */
export function takeReward({ campaign, cardType }: { campaign: Campaign; cardType: string | null }): void {
	const run = atReward({ campaign });
	if (cardType !== null && !rewardOffer({ campaign }).includes(cardType)) throw new RangeError(`${cardType} isn't on offer at stop ${run.stop}`);
	const cargoCards = cardType === null ? run.cargoCards : addCardsWon({ party: runParty({ campaign }), cardsWon: { [cardType]: 1 } }).cargoCards;
	campaign.set({ supplyRun: arrivedAt({ ...run, cargoCards, stop: run.stop + 1, phase: 'driving' }) });
}

/**
 * Home from the destination (Compound and Supply Runs, Return): the log says
 * what the run brought, the run is unloaded (`unloadRun`, which unwinds its
 * run decks and clears it), its drivers hurt are injured, each seat has a
 * run more, and the day ends. Throws unless the run is heading home, and as
 * each of those does.
 */
export function arriveHome({ campaign }: { campaign: Campaign }): Arrival {
	const run = requireRun(campaign);
	if (run.phase !== 'driving' || !atDestination(run)) {
		throw new Error(`The run is at stop ${run.stop + 1} of ${routeStops(run.route).length}, so it isn't heading home yet`);
	}
	const party = runParty({ campaign });
	const brought = cargoText({ cargo: party.cargo, cards: party.cargoCards }) ?? 'nothing';
	campaign.addLogEntry({ message: `Home from ${run.route.destination.name} with ${brought}.` });
	const cargo = campaign.unloadRun({ party });
	const injuries = injureOnArrival({ campaign, drivers: party.seats });
	party.seats.forEach(seat => seat.set({ runsCompleted: seat.runsCompleted + 1 }));
	const dayEnd = endDay({ campaign });
	return Object.freeze({ seats: party.seats, cargo, injuries, dayEnd });
}

/**
 * The run's own stream, `fork('run', n)` off the campaign's seed for run
 * `run-<n>`, which its fights and rewards fork from by stop.
 */
export function runStream({ campaign }: { campaign: Campaign }): Rng {
	if (campaign.currentRun === null) throw new Error('No run is out, so there is no run stream');
	return new Rng({ seed: campaign.seed }).fork('run', campaign.nextRunNumber - 1);
}

/** A yield as stores: its food, water, fuel, and scrap, and nothing else. */
export function yieldResources(yields: RouteYield): Resources {
	const resources: Resources = { ...NO_RESOURCES };
	for (const resource of YIELD_RESOURCES) resources[resource] = yields[resource];
	return resources;
}

/** "A", "A and B", "A, B, and C". */
export function listText(items: readonly string[]): string {
	if (items.length <= 2) return items.join(' and ');
	return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** "4 food, 12 scrap, and Headshot", or null for nothing at all. */
export function cargoText({ cargo, cards = NO_CARDS }: { cargo: Readonly<Resources>; cards?: CardCounts }): string | null {
	const items = [
		...RESOURCE_NAMES.filter(name => cargo[name] > 0).map(name => resourceAmount({ resource: name, amount: cargo[name] })),
		...Object.entries(cards).map(([type, count]) => (count === 1 ? cardName(type) : `${cardName(type)} x${count}`)),
	];
	return items.length > 0 ? listText(items) : null;
}

/**
 * The run as it stands at `stop`: once that's past the last stop it has
 * reached its destination, so the destination's yield is in its cargo,
 * where a failed run still loses it until it gets home.
 */
function arrivedAt(run: SupplyRun): SupplyRun {
	if (!atDestination(run)) return run;
	const cargo: Resources = { ...run.cargo };
	for (const resource of YIELD_RESOURCES) cargo[resource] += run.route.destination.yield[resource];
	return { ...run, cargo };
}

/** "Road Warrior 1 died and Interceptor 2 went missing when the run to Red Mesa Silos failed." */
function fallenMessage({ route, dead, missing }: { route: RunRoute; dead: readonly DriverRecord[]; missing: readonly DriverRecord[] }): string {
	const fates = [
		...(dead.length > 0 ? [`${listText(dead.map(driver => driver.name))} died`] : []),
		...(missing.length > 0 ? [`${listText(missing.map(driver => driver.name))} went missing`] : []),
	];
	return `${fates.join(' and ')} when the run to ${route.destination.name} failed.`;
}

function requireRun(campaign: Campaign): SupplyRun {
	refuseOver({ campaign, action: 'take a run on' });
	const run = campaign.supplyRun;
	if (run === null) throw new Error('No supply run is on the road');
	return run;
}

function drivingTo({ campaign, kind }: { campaign: Campaign; kind: RouteStop['kind'] }): SupplyRun {
	const run = requireRun(campaign);
	const stop = currentStop(run);
	if (run.phase !== 'driving' || stop?.kind !== kind) {
		throw new Error(`The run isn't driving to a ${kind} stop: it's ${run.phase} at stop ${run.stop + 1} of ${routeStops(run.route).length}`);
	}
	return run;
}

function atReward({ campaign }: { campaign: Campaign }): SupplyRun {
	const run = requireRun(campaign);
	if (run.phase !== 'reward') throw new Error(`The run is ${run.phase}, with no reward to pick`);
	return run;
}

/** The escorts load out sent: the convoy's, each once, and exactly those whose cards the run decks hold. */
function checkEscorts({ campaign, escorts }: { campaign: Campaign; escorts: readonly Vehicle[] }): void {
	if (escorts.length > MAX_CONVOY_ESCORTS) throw new RangeError(`A run takes ${MAX_CONVOY_ESCORTS} escorts at most, not ${escorts.length}`);
	escorts.forEach((escort, index) => {
		if (!campaign.convoy.escorts.includes(escort)) throw new RangeError(`${escort.name} isn't in the campaign's convoy`);
		if (escorts.indexOf(escort) !== index) throw new RangeError(`${escort.name} (${escort.convoyId}) is listed twice`);
	});
	const held = new Set(campaign.runDecks.flatMap(deck => deck.escortCards.map(card => card.broughtBy)));
	held.forEach(broughtBy => {
		if (!escorts.some(escort => escort.convoyId === broughtBy)) throw new RangeError(`A run deck holds the card ${broughtBy} brought, and it isn't coming`);
	});
	escorts.forEach(escort => {
		if (escort.escort?.signatureCard && !held.has(escort.convoyId as string)) {
			throw new RangeError(`${escort.name} (${escort.convoyId}) is coming, and no run deck holds its ${escort.escort.signatureCard}`);
		}
	});
}

function departRefusal(blocker: DepartBlocker): string {
	switch (blocker.reason) {
		case 'campaign_over':
			return `The campaign is over, since the compound ${blocker.end.ending}, so no run sets off`;
		case 'run_out':
			return `${blocker.run} is on the road, so no other run sets off until it's home`;
		case 'too_little_fuel':
			return `The route costs ${blocker.needed} fuel, and the stores hold ${blocker.held}`;
	}
}
