import type { CampaignEnd } from '../../campaign/CampaignEnd';
import { fallMessage } from '../../campaign/CampaignEnd';
import { awayText } from '../../campaign/cardBlockerText';
import type { DriverRecord } from '../../campaign/DriverRecord';
import type { SeatBlocker } from '../../campaign/Seating';
import { DRIVER_CONFIGS } from '../../mechanics/Driver';
import { DriverSynergy, SynergyAnalysis } from '../../mechanics/DriverSynergy';
import { countOf } from '../main-menu/campaignText';
import type { LoadOutPlan, PoolStanding, StartBlocker } from './LoadOutPlan';
import type { LoadOutTrip } from './LoadOutScreen';

/** In the route line's place when load out was opened without a route. */
export const NO_ROUTE_PICKED = 'No route picked';

/** Beside the title, from the pool's note in the wireframe. */
export const POOL_NOTE = 'Drivers who die on a run are gone for good, with their run deck.';

/** Over the escorts. */
export const ESCORT_CAPTION = 'Escorts / click to bring or leave';

/** Under an escort card: coming along, marked in highlighter, or left at home. */
export const ESCORT_COMING = 'Coming';
export const ESCORT_STAYING = 'At home';

/** Where the second seat would be on a solo run. */
export const SOLO_SEAT = 'Solo run: nobody else is fit to go.';

/** In place of the synergy on a solo run. */
export const SOLO_SYNERGY = 'One driver and the escorts. No partner to cover a bad hand.';

/** "Driver 1", a seat's title. */
export function seatTitle(seat: number): string {
	return `Driver ${seat + 1}`;
}

/** "Deck / 12 cards / view only", over a seat's run deck; escort cards sit outside the count. */
export function deckCaption(cards: number): string {
	return `Deck / ${countOf(cards, 'card')} / view only`;
}

/** Why the rules keep a driver out of a seat, in the few words under their card. */
export function seatBlockerText(blocker: SeatBlocker): string {
	switch (blocker.reason) {
		case 'campaign_over':
			return 'Campaign over';
		case 'injured':
			return `Injured, fit in ${countOf(blocker.injuredDays, 'day')}`;
		case 'driver_away':
			return awayText(blocker.status);
		case 'already_seated':
			return 'Already seated';
		case 'same_archetype':
			return 'Same archetype as a seated driver';
	}
}

/** A pool driver's Seat button and the line under it: "Seat" and nothing when they're free. */
export function standingText(standing: PoolStanding): { label: string; reason: string } {
	switch (standing.kind) {
		case 'seated':
			return { label: 'Seated', reason: `In seat ${standing.seat + 1}` };
		case 'free':
			return { label: 'Seat', reason: '' };
		case 'blocked':
			return { label: 'Seat', reason: seatBlockerText(standing.blocker) };
		case 'seats_full':
			return { label: 'Seat', reason: 'Clear a seat first' };
	}
}

/** Why Start run can't go, under it. */
export function startBlockerText(blocker: StartBlocker, end: Readonly<CampaignEnd> | null = null): string {
	switch (blocker.reason) {
		case 'campaign_over':
			return end ? `Campaign over. ${fallMessage(end)}` : 'Campaign over.';
		case 'no_crew':
			return 'Nobody at the compound is fit to go.';
		case 'seat_empty':
			return blocker.needed === 1 ? 'Seat a driver to start the run.' : 'Seat two drivers to start the run.';
		case 'seat_blocked':
			return `${blocker.driver.name} can't go: ${seatBlockerText(blocker.blocker).toLowerCase()}.`;
	}
}

/** Under a live Start run: what the drivers take, and who comes along. */
export function readyText(plan: LoadOutPlan): string {
	const custom = plan.seats.filter((_, seat) => plan.runDeckAt(seat)?.isCustomized).length;
	const decks = plan.seatsNeeded === 1
		? `A solo run on ${custom === 0 ? 'the default deck' : 'a deck customized for this run'}.`
		: custom === 0
			? 'Both drivers take their default decks.'
			: `${custom === 1 ? 'One run deck is' : 'Both run decks are'} customized for this run.`;
	const escorts = plan.escorts.length;
	return escorts === 0 ? `${decks} No escorts come along.` : `${decks} ${countOf(escorts, 'escort')} and their cards come along.`;
}

/**
 * How the seated pair works together, from the driver selection screen's
 * analysis (`DriverSynergy`), each driver's archetype read from its config
 * under the campaign's name for them.
 */
export function pairSynergy(first: DriverRecord, second: DriverRecord): SynergyAnalysis {
	return DriverSynergy.analyzeSynergy(synergyDriver(first), synergyDriver(second));
}

function synergyDriver(driver: DriverRecord) {
	const { metadata, vehicleStats } = DRIVER_CONFIGS[driver.archetype];
	return { archetype: driver.archetype, vehicleStats, metadata: { ...metadata, name: driver.name } };
}

/** One item on the route line, and whether it's a shortfall to set in stronghold red. */
export interface TripItem {
	text: string;
	short: boolean;
}

/**
 * The route line's items after the destination, as the map's legend sets
 * them: "by Back roads", "2 stops", "fuel 3", "home by 16:30". The fuel
 * says what the stores hold when it's less than the route burns, and
 * home-by says when it's after dark.
 */
export function tripItems(trip: LoadOutTrip, fuelHeld: number): Record<'route_name' | 'stops' | 'fuel' | 'home_by', TripItem> {
	const fuelShort = fuelHeld < trip.fuel;
	return {
		route_name: { text: `by ${trip.routeName}`, short: false },
		stops: { text: countOf(trip.stops, 'stop'), short: false },
		fuel: { text: fuelShort ? `fuel ${trip.fuel}, ${fuelHeld} held` : `fuel ${trip.fuel}`, short: fuelShort },
		home_by: { text: trip.pastDark ? `home by ${trip.homeBy}, after dark` : `home by ${trip.homeBy}`, short: trip.pastDark },
	};
}

/** Under Start run once the store has moved on from this campaign; Back then goes to the menu. */
export const STRANDED_LOAD_OUT = "This campaign isn't the save any more, so nothing more is saved here. Back goes to the menu to pick up the save.";
