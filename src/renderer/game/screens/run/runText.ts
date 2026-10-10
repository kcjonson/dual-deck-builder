import { RESOURCE_NAMES, Resources, resourceAmount } from '../../campaign/Campaign';
import type { CardCounts } from '../../campaign/CardCounts';
import { cardName } from '../../campaign/DeckRules';
import type { Skulls } from '../../campaign/Encounters';
import type { RouteStop, RunRoute } from '../../campaign/SupplyRoutes';
import type { Arrival, DepartBlocker, PlanBlocker, StopFightResult } from '../../campaign/SupplyRun';
import { countOf } from '../main-menu/campaignText';

/** What the route pick, the run screen, and the compound's Plan button say about a supply run (DDB-454). */

/** "A", "A and B", "A, B, and C". */
export function listText(items: readonly string[]): string {
	if (items.length <= 2) return items.join(' and ');
	return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function skullsText(skulls: Skulls): string {
	return countOf(skulls, 'skull');
}

/** "Raider ambush, 2 skulls", "Quiet stretch". */
export function stopTitle(stop: RouteStop): string {
	return stop.kind === 'fight' ? `Raider ambush, ${skullsText(stop.skulls)}` : 'Quiet stretch';
}

/** "3 fuel, 4.8 h out, 2.3 h home". */
export function routeCost(route: RunRoute): string {
	return `${route.fuel} fuel, ${route.hours.out} h out, ${route.hours.home} h home`;
}

/** "Risk: 2 skulls". */
export function riskText(route: RunRoute): string {
	return `Risk: ${skullsText(route.risk)}`;
}

/** The compound's line under Plan a supply run when it's off. */
export function planRefusal(blocker: PlanBlocker): string {
	switch (blocker.reason) {
		case 'campaign_over':
			return 'The campaign is over, so no run goes out.';
		case 'run_out':
			return 'A run is out. Continue from the menu drives it on.';
		case 'no_crew':
			return 'No two drivers at the compound can go out together.';
		case 'too_little_fuel':
			return `Today's cheapest route takes ${blocker.needed} fuel, and the stores hold ${blocker.held}.`;
	}
}

/** The route pick's line under a route it can't take. */
export function departRefusal(blocker: DepartBlocker): string {
	switch (blocker.reason) {
		case 'campaign_over':
			return 'The campaign is over.';
		case 'run_out':
			return 'A run is already on the road.';
		case 'too_little_fuel':
			return `Takes ${blocker.needed} fuel, and the stores hold ${blocker.held}.`;
	}
}

/** "2 fuel, 15 scrap, and Headshot", or null for nothing at all. */
export function cargoText({ cargo, cards }: { cargo: Readonly<Resources>; cards: CardCounts }): string | null {
	const items = [
		...RESOURCE_NAMES.filter(name => cargo[name] > 0).map(name => resourceAmount({ resource: name, amount: cargo[name] })),
		...Object.entries(cards).map(([type, count]) => (count === 1 ? cardName(type) : `${cardName(type)} x${count}`)),
	];
	return items.length > 0 ? listText(items) : null;
}

/**
 * The one line the run screen shows on getting home: what was unloaded,
 * who's hurt, and the day that ended.
 */
export function arrivalSummary({ arrival, route }: { arrival: Arrival; route: RunRoute }): string {
	const unloaded = cargoText({ cargo: arrival.cargo.resources, cards: arrival.cargo.cards });
	const parts = [`Home from ${route.destination.name}.`, unloaded ? `Unloaded ${unloaded}.` : 'Nothing to unload.'];
	for (const { driver, injuredDays } of arrival.injuries) parts.push(`${driver.name} is injured, fit in ${countOf(injuredDays, 'day')}.`);
	parts.push(`Day ${arrival.dayEnd.day} ended.`);
	return parts.join(' ');
}

/** The one line the run screen shows for a failed run: who's lost, what's lost, and the day that ended. */
export function failureSummary(result: Extract<StopFightResult, { outcome: 'run_failed' }>): string {
	const { dead, missing, cargoLost, cargoCardsLost, escortsLost } = result.fight;
	const fates = [
		...dead.map(driver => `${driver.name} is dead`),
		...missing.map(driver => `${driver.name} is missing`),
	];
	const parts = [`The run failed. ${listText(fates)}.`];
	const lost = cargoText({ cargo: cargoLost, cards: cargoCardsLost });
	if (lost) parts.push(`Lost with it: ${lost}.`);
	if (escortsLost.length > 0) parts.push(`${listText(escortsLost.map(escort => escort.name))} ${escortsLost.length === 1 ? 'is' : 'are'} gone.`);
	parts.push(result.dayEnd ? `Day ${result.dayEnd.day} ended.` : 'Nobody is left at the compound.');
	return parts.join(' ');
}
