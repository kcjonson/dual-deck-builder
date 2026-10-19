import type { AIType } from '../ai/AIController';
import { Rng } from '../core/Rng';
import type { RouteMap } from '../map/RouteDescriptors';
import type { Card } from '../mechanics/Card';
import type { DriverArchetype } from '../mechanics/Driver';
import { ESCORT_CONFIGS, createEscort } from '../mechanics/Escort';
import { MAX_CONVOY_ESCORTS, Team } from '../mechanics/Team';
import type { Vehicle } from '../mechanics/Vehicle';
import { Campaign, NO_RESOURCES, RESOURCE_NAMES, Resources, UnloadedCargo, resourceAmount } from './Campaign';
import { CampaignEnd, refuseOver, refuseOverBlocker } from './CampaignEnd';
import { CardCounts, NO_CARDS } from './CardCounts';
import { addCardsWon } from './CardsWon';
import { BrokenOffFight, CampaignFight, FailedRun, RunParty, WonFight, startCampaignFight, writeBackFight } from './CombatBridge';
import { DayEnd, endDay } from './DayClock';
import { cardName } from './DeckRules';
import type { DriverRecord } from './DriverRecord';
import { encounterForces } from './Encounters';
import { EventFight, EventResult, GameEvent, eventById, eventParty, landOutcome, pickEvent, resolveChoice } from './Events';
import { Injury, injureOnArrival } from './Infirmary';
import type { RunDeck } from './RunDeck';
import { applyEventGains, payEventCost, recruitArchetype } from './RunEvents';
import { rollRewardCards } from './RunRewards';
import { getCrewRule, getSeatBlocker } from './Seating';
import { clearPoi, clearStop, clearedPois, stopStates } from './MapClearing';
import { destinationId, poiOf, routeOffers, routeStop, stopOf } from './MapRoutes';
import type { MapState } from './MapState';
import { FindKind, FindStop, RouteLeg, RouteStop, RouteYield, RunRoute, YIELD_RESOURCES, routeStops } from './SupplyRoutes';
import type { SupplyRun } from './SupplyRunState';

/**
 * The MVP supply run (DDB-454): depart on a route the area map offers
 * (`routesOnOffer`), take its stops in order, a fight through the combat
 * bridge with a card reward after each win, a find taken or left (DDB-523),
 * an event's choice taken, which can hand off to a fight (DDB-535), load
 * the destination's yield, and come home, or lose the run. A stand-in for the full run controller
 * (DDB-322), which keeps this state machine. Decision records:
 * docs/AI_TECHNICAL_DECISIONS/mvp-supply-run.md and area-map-route-pick.md.
 *
 * The run's state is the campaign's `supplyRun`, saved with it. Every step
 * here changes the campaign and nothing else, and the caller checkpoints at
 * its end, as after any step.
 */

/**
 * Why the compound can't plan a run, which its Plan a supply run button
 * shows: the campaign is over, a run is out (on the road, or a load out
 * under way), nobody at the compound can go (`getCrewRule`), the map offers
 * no route, or the stores hold less fuel than its cheapest route costs.
 */
export type PlanBlocker =
	| { reason: 'campaign_over'; end: Readonly<CampaignEnd> }
	| { reason: 'run_out'; run: string }
	| { reason: 'no_crew' }
	| { reason: 'no_routes' }
	| { reason: 'too_little_fuel'; needed: number; held: number };

/** Why a route can't be taken now, which the run route screen shows on it. */
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

/** How a stop's fight ended: the run goes on to a reward, goes on with nothing won when the raiders broke off, or it failed. */
export type StopFightResult =
	| {
		readonly outcome: 'won';
		readonly fight: WonFight;
		/** An event hand-off's win as the log has it, its fight's text and what it gave; null for a stop fight. */
		readonly handOff: string | null;
	}
	| { readonly outcome: 'broken_off'; readonly fight: BrokenOffFight }
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
	/** Drivers found on the road who joined the pool on getting home (`SupplyRun.recruits`). */
	readonly recruits: readonly DriverRecord[];
	/** Escorts an event gave that joined the convoy on getting home (`SupplyRun.escortsFound`). */
	readonly escorts: readonly Vehicle[];
	readonly dayEnd: DayEnd;
}

/** Who a Find: driver turns up: one of the compound's own missing, or someone new of an archetype. */
export type FoundDriver =
	| { readonly kind: 'missing'; readonly driver: DriverRecord }
	| { readonly kind: 'recruit'; readonly archetype: DriverArchetype };

/** Each map's offer with nothing cleared, worked out once: the compound asks on every refresh. */
const offers = new WeakMap<RouteMap, readonly RunRoute[]>();

/** Each map's offer for the last map state asked about, which a campaign replaces whole when a run clears something. */
const cleared = new WeakMap<RouteMap, { readonly state: MapState; readonly routes: readonly RunRoute[] }>();

/**
 * The routes a run can set off on: every route the area map has
 * (`routeOffers`), POI by POI, each POI's quickest first, but a
 * stronghold's, which waits for assaults, and a cleared POI's, which no run
 * goes back to (Runs and Encounters, Clearing). A stop still in its
 * cooldown is `cleared`, so the run drives past it, and one that's come
 * back holds its contents at its roll now; a route with a stop cleared
 * takes its risk from the fights it still meets. Every POI is known until
 * fog (DDB-294). The one place the run's routes come from, and every caller
 * passes the campaign and its own map (`getAreaMap`), so what the screens
 * show is what `departRun` checks.
 */
export function routesOnOffer({ map, campaign }: { map: RouteMap; campaign: Campaign }): readonly RunRoute[] {
	let full = offers.get(map);
	if (!full) {
		const strongholds = new Set(map.products.pois.strongholds.map(({ poi }) => destinationId(poi)));
		full = Object.freeze(routeOffers(map).filter(route => !strongholds.has(route.destination.id)));
		offers.set(map, full);
	}
	const state = campaign.map;
	if (clearedPois(state).length === 0 && stopStates(state).length === 0) return full;
	const kept = cleared.get(map);
	if (kept?.state === state) return kept.routes;
	const closed = new Set(clearedPois(state).map(destinationId));
	const states = new Map(stopStates(state).map(entry => [entry.stop, entry]));
	const legs = new Map<RouteLeg, RouteLeg>();
	const legNow = (leg: RouteLeg): RouteLeg => {
		let now = legs.get(leg);
		if (now) return now;
		const stops = leg.stops.map((stop) => {
			const id = stopOf(stop.id);
			const entry = id === null ? undefined : states.get(id);
			if (id === null || !entry) return stop;
			const rolled = entry.roll > 0 ? routeStop({ map, id, roll: entry.roll }) : stop;
			return entry.cleared === null ? rolled : Object.freeze({ ...rolled, cleared: true as const });
		});
		now = stops.every((stop, index) => stop === leg.stops[index]) ? leg : Object.freeze({ ...leg, stops: Object.freeze(stops) });
		legs.set(leg, now);
		return now;
	};
	const routes = Object.freeze(full.filter(route => !closed.has(route.destination.id)).map((route) => {
		const now = route.legs.map(legNow);
		if (now.every((leg, index) => leg === route.legs[index])) return route;
		const changed: RunRoute = Object.freeze({ ...route, legs: Object.freeze(now) });
		return Object.freeze({ ...changed, risk: riskOf(changed) });
	}));
	cleared.set(map, { state, routes });
	return routes;
}

/** A route's worst fight still on it, in skulls, or 1, the objective's, with none. */
function riskOf(route: RunRoute): RunRoute['risk'] {
	return routeStops(route).reduce<RunRoute['risk']>((worst, stop) => (stop.kind === 'fight' && stop.skulls > worst ? stop.skulls : worst), 1);
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
 * Load out with nothing changed, as the load out screen opens (DDB-320):
 * the crew a run can seat (`seatableCrew`: a pair, a same-archetype pair,
 * or one driver alone), on their default decks, and every escort in the
 * convoy, up to `MAX_CONVOY_ESCORTS` in roster order, their cards to
 * Driver 1, through `startRunDecks`. For setting a run off without the
 * screen, as the tests do. Throws with nobody to send, and as
 * `startRunDecks` does.
 */
export function quickLoadOut({ campaign }: { campaign: Campaign }): { seats: readonly DriverRecord[]; escorts: readonly Vehicle[] } {
	const seats = seatableCrew({ campaign });
	if (seats === null) throw new RangeError('Nobody at the compound can go out on a run');
	const escorts = campaign.convoy.escorts.slice(0, MAX_CONVOY_ESCORTS);
	campaign.startRunDecks({ seats, escorts });
	return { seats, escorts };
}

export function getPlanBlocker({ campaign, map }: { campaign: Campaign; map: RouteMap }): PlanBlocker | null {
	if (campaign.end !== null) return { reason: 'campaign_over', end: campaign.end };
	const run = campaign.currentRun;
	if (run !== null) return { reason: 'run_out', run };
	if (seatableCrew({ campaign }) === null) return { reason: 'no_crew' };
	const routes = routesOnOffer({ map, campaign });
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
 * The run sets off on a route the campaign's map offers, with the run decks
 * load out started and the escorts it brought: the fuel is paid, and the
 * run is on the road at its first stop with no cargo, in one `set`. One run
 * a day holds because every run's end ends the day (`arriveHome`,
 * `finishStopFight`), and nothing departs while a run is out.
 *
 * The route is the map's own by its id, so what's checked is what's paid.
 * Throws, changing nothing, for a route the map doesn't offer, a
 * `DepartRuleError` when `getDepartBlocker` refuses (a `CampaignOverError`
 * once the campaign is over), and a plain error with no run decks started
 * and for escorts that aren't the ones whose cards load out dealt into the
 * run decks: each the convoy's, listed once, `MAX_CONVOY_ESCORTS` at most,
 * every escort card's escort among them, and every one with a signature
 * card holding it in a run deck.
 */
export function departRun({ campaign, map, route, escorts }: { campaign: Campaign; map: RouteMap; route: RunRoute; escorts: readonly Vehicle[] }): SupplyRun {
	const offered = routesOnOffer({ map, campaign }).find(offer => offer.id === route.id);
	if (!offered) throw new RangeError(`${route.id} isn't a route the area map offers`);
	const blocker = getDepartBlocker({ campaign, route: offered });
	refuseOverBlocker({ blocker, action: 'set off on a run' });
	if (blocker !== null) throw new DepartRuleError({ message: departRefusal(blocker), blocker });
	if (campaign.currentRun === null) throw new Error('Load out starts the run decks before a run sets off');
	checkEscorts({ campaign, escorts });
	campaign.set({
		resources: { ...campaign.resources, fuel: campaign.resources.fuel - offered.fuel },
		...withYieldAtDestination({ route: offered, stop: 0, phase: 'driving', escorts, cargo: NO_RESOURCES, cargoCards: NO_CARDS, recruits: [], escortsFound: [], handOff: null }),
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
	campaign.set(withYieldAtDestination({ ...run, stop: run.stop + 1 }));
}

/**
 * Who the Find: driver the run is driving to turns up: the first of the
 * pool's missing drivers who can be found (`Campaign.findMissingDriver`),
 * or else someone new, of an unlocked archetype the compound has fewest
 * living drivers of, counting recruits riding home, drawn on the run's
 * stream for the stop, `fork('find', stop)`, so a load finds the same one.
 * Throws unless the run is driving to a Find: driver.
 */
export function foundDriver({ campaign }: { campaign: Campaign }): FoundDriver {
	const run = drivingToFind({ campaign, find: 'driver' });
	const missing = campaign.drivers.find(driver => driver.status === 'missing' && !campaign.foundOnRun.includes(driver) && campaign.runDeckOf(driver) === null);
	if (missing) return Object.freeze({ kind: 'missing', driver: missing });
	const archetype = recruitArchetype({ campaign, recruits: run.recruits, rng: runStream({ campaign }).fork('find', run.stop) });
	return Object.freeze({ kind: 'recruit', archetype });
}

/**
 * The find the run is driving to, taken (Runs and Encounters, What a stop
 * can be): Find: cards opens the card picker at the stop (`rewardOffer`,
 * `takeReward`); Find: supplies loads its haul into the cargo; Find: driver
 * takes on who it turns up (`foundDriver`), a missing driver riding home
 * with the run (`Campaign.findMissingDriver`) and someone new as one of its
 * `recruits`. Then on to the next stop, or the destination, but for the
 * cards, which move on once picked. Throws unless the run is driving to a
 * find, and as `findMissingDriver` does.
 */
export function takeFind({ campaign }: { campaign: Campaign }): void {
	const run = drivingTo({ campaign, kind: 'find' });
	const stop = currentStop(run) as FindStop;
	switch (stop.find) {
		case 'cards':
			campaign.set({ supplyRun: { ...run, phase: 'reward' } });
			return;
		case 'supplies': {
			const { resource, amount } = stop.supplies;
			const cargo = { ...run.cargo, [resource]: run.cargo[resource] + amount };
			campaign.set(withYieldAtDestination({ ...run, cargo, stop: run.stop + 1 }));
			return;
		}
		case 'driver': {
			const found = foundDriver({ campaign });
			if (found.kind === 'missing') {
				campaign.findMissingDriver({ driver: found.driver });
				campaign.set(withYieldAtDestination({ ...run, stop: run.stop + 1 }));
			} else {
				campaign.set(withYieldAtDestination({ ...run, recruits: [...run.recruits, found.archetype], stop: run.stop + 1 }));
			}
			return;
		}
	}
}

/** The find the run is driving to, left by the road: on to the next stop, or the destination. Throws unless the run is driving to a find. */
export function leaveFind({ campaign }: { campaign: Campaign }): void {
	const run = drivingTo({ campaign, kind: 'find' });
	campaign.set(withYieldAtDestination({ ...run, stop: run.stop + 1 }));
}

/** The event at the run's stop, and the draw its outcome lands on. */
export interface StopEvent {
	readonly event: GameEvent;
	readonly draw: number;
}

/**
 * The event the run is driving to, or at the hand-off of: picked evenly
 * among its stop type's events (`pickEvent`, call 258), then the draw its
 * outcome lands on (call 253), both on the run's stream for the stop,
 * `fork('event', stop)`, so a load meets the same event and lands the same
 * outcome. At a hand-off it's the event saved with it. Throws unless the run
 * is driving to an event or at a hand-off, and for a stop type or a saved
 * event the content doesn't have.
 */
export function stopEvent({ campaign }: { campaign: Campaign }): StopEvent {
	const run = requireRun(campaign);
	const stop = currentStop(run);
	if (stop?.kind !== 'event' || (run.phase !== 'driving' && run.phase !== 'hand_off')) {
		throw new Error(`The run isn't at an event: it's ${run.phase} at stop ${run.stop + 1} of ${routeStops(run.route).length}`);
	}
	const rng = runStream({ campaign }).fork('event', run.stop);
	const picked = pickEvent({ stopType: stop.stopType, draw: rng.float() });
	const event = run.handOff === null ? picked : eventById(run.handOff.event);
	if (!event) throw new Error(run.handOff === null ? `No event resolves a ${stop.stopType} stop` : `The event ${run.handOff.event} the run is at isn't in the event content`);
	return Object.freeze({ event, draw: rng.float() });
}

/**
 * A choice taken at the event the run is driving to, by its id: checked
 * against the party (`eventParty`, `resolveChoice`), its cost paid and its
 * outcome's gains applied (`payEventCost`, `applyEventGains`). Then an
 * outcome that hands off to a fight waits for it at the stop (the
 * `hand_off` phase, `startStopFight`), one with the card picker opens it
 * (`rewardOffer`), and any other drives on, in one `set`. Returns what the
 * event screen shows. Throws unless the run is driving to an event, and as
 * `resolveChoice` does for a choice the event lacks or the party can't take.
 */
export function takeEventChoice({ campaign, choice }: { campaign: Campaign; choice: string }): EventResult {
	const run = drivingTo({ campaign, kind: 'event' });
	const { event, draw } = stopEvent({ campaign });
	const party = eventParty({ campaign });
	if (party === null) throw new Error('No run is out, so no party can take an event choice');
	const result = resolveChoice({ event, choice, party, draw });
	const paid = payEventCost({ campaign, run, cost: result.cost });
	const gained = applyEventGains({ campaign, run: paid.run, stores: paid.resources, party: runParty({ campaign }), gains: result.outcome, rng: runStream({ campaign }).fork('event-recruit', run.stop) });
	const { outcome } = result;
	const supplyRun: SupplyRun = outcome.fight !== null
		? { ...gained.run, phase: 'hand_off', handOff: { event: event.id, choice: result.choice } }
		: outcome.cardPick ? { ...gained.run, phase: 'reward' } : withYieldAtDestination({ ...gained.run, stop: run.stop + 1 }).supplyRun;
	campaign.set({ resources: gained.resources, supplyRun });
	return result;
}

/**
 * The fight an event's outcome handed off to, worked out again from the
 * choice saved with the hand-off: its skulls, and what winning it gives.
 * Throws unless the run is at a hand-off, and when that choice's outcome no
 * longer hands off to a fight.
 */
export function handOffFight({ campaign }: { campaign: Campaign }): EventFight {
	const run = requireRun(campaign);
	if (run.phase !== 'hand_off' || run.handOff === null) throw new Error(`The run is ${run.phase}, with no event fight to come`);
	const { event, draw } = stopEvent({ campaign });
	const { fight } = landOutcome({ event, choice: run.handOff.choice, draw }).outcome;
	if (fight === null) throw new Error(`${event.id}'s choice ${run.handOff.choice} doesn't hand off to a fight`);
	return fight;
}

/**
 * A hand-off whose fight can't be worked out any more, its event or choice
 * gone from the content since it was saved, given up: the run drives on
 * past the stop with nothing more, so a content change never strands it.
 * Throws unless the run is at a hand-off, and when its fight still stands.
 */
export function abandonHandOff({ campaign }: { campaign: Campaign }): void {
	const run = requireRun(campaign);
	if (run.phase !== 'hand_off') throw new Error(`The run is ${run.phase}, with no event fight to give up`);
	if (handOffStands({ campaign })) throw new Error('The event fight still stands, so the run fights it');
	campaign.set(withYieldAtDestination({ ...run, stop: run.stop + 1, phase: 'driving', handOff: null }));
}

/** Whether the run's hand-off can still be fought: its event and choice are in the content, and the choice still turns into a fight. */
export function handOffStands({ campaign }: { campaign: Campaign }): boolean {
	try {
		handOffFight({ campaign });
		return true;
	} catch {
		return false;
	}
}

export interface StopFightOptions {
	campaign: Campaign;
	/** Card templates by type, as `CardLoader.getAllCardsAsMap` hands them out. */
	cards: ReadonlyMap<string, Card>;
	/** The fight's raiders: an encounter template's (`encounterForces`) when left out. */
	raiders?: () => Team;
	/** The raiders' AI, the bridge's aggressive when left out. */
	enemyAI?: AIType | null;
}

/**
 * The fight at the run's stop, started through the combat bridge on the
 * run's stream for that stop, `fork('fight', stop)` off the run's own
 * (`runStream`). Its raiders are an encounter template for the stop's
 * skulls at the destination's tier, picked on that stream and sized for
 * the seats (`encounterForces`); game stage isn't kept yet (DDB-339), so
 * every fight is stage 0's. An event's hand-off is fought the same way at
 * its fight's skulls. Nothing is saved: a load finds the run driving to
 * this stop, or at its hand-off, and the fight replays from the same
 * stream, template and all. Throws unless the run is driving to a fight or
 * at a hand-off, and as `startCampaignFight` does.
 */
export function startStopFight({ campaign, cards, raiders, enemyAI }: StopFightOptions): CampaignFight {
	const run = requireRun(campaign);
	const skulls = run.phase === 'hand_off' ? handOffFight({ campaign }).skulls : (currentStop(drivingTo({ campaign, kind: 'fight' })) as Extract<RouteStop, { kind: 'fight' }>).skulls;
	const rng = runStream({ campaign }).fork('fight', run.stop);
	return startCampaignFight({
		campaign,
		party: runParty({ campaign }),
		raiders: vehicles => raiders ? raiders() : encounterForces({ skulls, tier: run.route.destination.tier, cards, seats: vehicles.length, rng }).team,
		rng,
		cards,
		...(enemyAI === undefined ? {} : { enemyAI }),
	});
}

/**
 * A stop's fight written back. A win carries the write-back's party on,
 * its escorts and cargo, to the stop's reward, a hand-off's win with its
 * fight's gains applied first (call 255). A break-off carries it on
 * past the stop with no reward, and the log says so. A loss, a fight given up
 * included (`Battle.forfeit`), fails the run: the log names who died and
 * who went missing, `loseRun` loses the run and logs its cargo, and the day
 * ends unless the campaign is over, as a run getting home does. Throws as
 * `writeBackFight` does, and as `loseRun` and `endDay` do.
 */
export function finishStopFight({ campaign, fight }: { campaign: Campaign; fight: CampaignFight }): StopFightResult {
	const run = requireRun(campaign);
	const gains = run.phase === 'hand_off' ? handOffFight({ campaign }) : null;
	const result = writeBackFight({ fight });
	if (result.outcome === 'won') {
		const { escorts, cargo, cargoCards } = result.party;
		const won: SupplyRun = { ...run, escorts, cargo, cargoCards, phase: 'reward', handOff: null };
		const gained = gains === null
			? { run: won, resources: campaign.resources }
			: applyEventGains({ campaign, run: won, stores: campaign.resources, party: result.party, gains, rng: runStream({ campaign }).fork('event-fight-recruit', run.stop) });
		campaign.set({ resources: gained.resources, supplyRun: gained.run });
		const handOff = gains === null ? null : handOffText(gains);
		if (handOff !== null) campaign.addLogEntry({ message: handOff });
		return Object.freeze({ outcome: 'won', fight: result, handOff });
	}
	if (result.outcome === 'broken_off') {
		const { escorts, cargo, cargoCards } = result.party;
		campaign.addLogEntry({ message: `The raiders broke off at stop ${run.stop + 1} on the run to ${run.route.destination.name}.` });
		campaign.set(withYieldAtDestination({ ...run, escorts, cargo, cargoCards, stop: run.stop + 1, phase: 'driving', handOff: null }));
		return Object.freeze({ outcome: 'broken_off', fight: result });
	}
	campaign.addLogEntry({ message: fallenMessage({ route: run.route, dead: result.dead, missing: result.missing }) });
	const { lost } = campaign.loseRun({ result });
	const dayEnd = campaign.isOver ? null : endDay({ campaign });
	return Object.freeze({ outcome: 'run_failed', fight: result, lost, dayEnd });
}

/**
 * The cards on offer at the run's stop, after its fight or at its Find:
 * cards: drawn from the run's stream for that stop, `fork('reward', stop)`,
 * so a load offers the same ones. Throws unless the run is at a reward.
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
	campaign.set(withYieldAtDestination({ ...run, cargoCards, stop: run.stop + 1, phase: 'driving' }));
}

/**
 * Home from the destination (Compound and Supply Runs, Return): the log says
 * what the run brought, the run is unloaded (`unloadRun`, which unwinds its
 * run decks and clears it), the stops it got past and its POI are cleared
 * (`clearedByRun`), anyone new it found joins the pool
 * (`recruitDriver`) and the log says so, its drivers hurt are injured, each
 * seat has a run more, and the day ends. Throws unless the run is heading
 * home, and as each of those does.
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
	const map = clearedByRun({ map: campaign.map, run, day: campaign.day });
	if (map !== campaign.map) campaign.set({ map });
	const recruits = run.recruits.map(archetype => campaign.recruitDriver({ archetype }));
	if (recruits.length > 0) campaign.addLogEntry({ message: `${listText(recruits.map(driver => driver.name))} joined the compound, found on the road.` });
	const escorts = joinConvoy({ campaign, found: run.escortsFound });
	const injuries = injureOnArrival({ campaign, drivers: party.seats });
	party.seats.forEach(seat => seat.set({ runsCompleted: seat.runsCompleted + 1 }));
	const dayEnd = endDay({ campaign });
	return Object.freeze({ seats: party.seats, cargo, injuries, recruits, escorts, dayEnd });
}

/**
 * The escorts a run's events gave joining the convoy as it gets home, in
 * the order given, and the log says so; one with the convoy full is left
 * on the road (call 270). Returns those that joined.
 */
function joinConvoy({ campaign, found }: { campaign: Campaign; found: SupplyRun['escortsFound'] }): readonly Vehicle[] {
	const joined: Vehicle[] = [];
	for (const type of found) {
		if (campaign.convoy.isFull) {
			campaign.addLogEntry({ message: `No room in the convoy for the ${ESCORT_CONFIGS[type].name} found on the road, so it was left behind.` });
			continue;
		}
		const escort = createEscort({ type });
		campaign.convoy.add(escort);
		joined.push(escort);
	}
	if (joined.length > 0) campaign.addLogEntry({ message: `${listText(joined.map(escort => escort.name))} joined the convoy, found on the road.` });
	return joined;
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
 * The run as it stands at `stop`: once it's past its last stop it has
 * reached its destination, so the POI's whole yield is in its cargo, where
 * a failed run still loses it until it gets home. Nothing clears on the
 * road; what the run resolved clears when it's home (`clearedByRun`), so a
 * failed run leaves the map as it found it (call 260).
 */
function withYieldAtDestination(run: SupplyRun): { supplyRun: SupplyRun } {
	if (!atDestination(run)) return { supplyRun: run };
	const cargo: Resources = { ...run.cargo };
	for (const resource of YIELD_RESOURCES) cargo[resource] += run.route.destination.yield[resource];
	return { supplyRun: { ...run, cargo } };
}

/**
 * The map state once a run that got home clears what it resolved: every
 * stop on its road from `day` (`clearStop`), and its POI for the rest of
 * the campaign (`clearPoi`). The saved route says which stops those are,
 * so a run loaded mid-road clears the same. A stop or POI whose id isn't
 * the map's, as in a run saved before the real map, clears nothing.
 */
function clearedByRun({ map, run, day }: { map: MapState; run: SupplyRun; day: number }): MapState {
	let cleared = map;
	for (const passed of routeStops(run.route)) {
		const stop = stopOf(passed.id);
		if (stop !== null) cleared = clearStop({ map: cleared, stop, day });
	}
	const poi = poiOf(run.route.destination.id);
	return poi === null ? cleared : clearPoi({ map: cleared, poi });
}

/** A hand-off's win: "The last buggy runs. ... The run took 3 people and 2 food." */
function handOffText(fight: EventFight): string {
	const gained = Object.fromEntries(RESOURCE_NAMES.map(name => [name, Math.max(0, fight.resources[name])])) as unknown as Resources;
	const loot = cargoText({ cargo: gained, cards: fight.cards });
	const escort = fight.escort === null ? null : ESCORT_CONFIGS[fight.escort].name;
	const items = [
		...(loot === null ? [] : [loot]),
		...(escort === null ? [] : [`${/^[AEIOU]/.test(escort) ? 'an' : 'a'} ${escort} for the convoy`]),
		...(fight.drivers > 0 ? [fight.drivers === 1 ? 'a new driver' : `${fight.drivers} new drivers`] : []),
		...(fight.hp > 0 ? [`${fight.hp} HP back`] : []),
		...(fight.structure > 0 ? [`${fight.structure} structure repaired`] : []),
	];
	return items.length === 0 ? fight.text : `${fight.text} The run took ${listText(items)}.`;
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

function drivingToFind({ campaign, find }: { campaign: Campaign; find: FindKind }): SupplyRun {
	const run = drivingTo({ campaign, kind: 'find' });
	const stop = currentStop(run) as FindStop;
	if (stop.find !== find) throw new Error(`The run is driving to a Find: ${stop.find}, not a Find: ${find}`);
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
