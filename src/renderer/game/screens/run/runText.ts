import type { Skulls } from '../../campaign/Encounters';
import type { RouteStop, RouteYield, RunRoute } from '../../campaign/SupplyRoutes';
import { Arrival, DepartBlocker, PlanBlocker, StopFightResult, cargoText, listText, yieldResources } from '../../campaign/SupplyRun';
import { dayEndReport, injuredLine } from '../compound/compoundText';
import { countOf } from '../main-menu/campaignText';

/** What the route pick, the run screen, and the compound's Plan button say about a supply run (DDB-454). */

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

/** "4 food, 3 water, 2 fuel, and 12 scrap", or "nothing". */
export function yieldText(yields: RouteYield): string {
	return cargoText({ cargo: yieldResources(yields) }) ?? 'nothing';
}

/** The compound's line under Plan a supply run when it's off. */
export function planRefusal(blocker: PlanBlocker): string {
	switch (blocker.reason) {
		case 'campaign_over':
			return 'The campaign is over, so no run goes out.';
		case 'run_out':
			return 'A run is out. Continue from the menu drives it on.';
		case 'no_crew':
			return 'Nobody at the compound is fit to go out.';
		case 'no_routes':
			return 'No routes are known yet.';
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

/**
 * The one line the run screen shows on getting home: what was unloaded,
 * who's still injured after the night, and the night itself (its shortfall
 * and who's fit again, `dayEndReport`).
 */
export function arrivalSummary({ arrival, route }: { arrival: Arrival; route: RunRoute }): string {
	const unloaded = cargoText({ cargo: arrival.cargo.resources, cards: arrival.cargo.cards });
	const parts = [`Home from ${route.destination.name}.`, unloaded ? `Unloaded ${unloaded}.` : 'Nothing to unload.'];
	const found = arrival.cargo.found.map(driver => driver.name);
	if (found.length > 0) parts.push(`${listText(found)} ${found.length === 1 ? 'is' : 'are'} back with the run.`);
	for (const { driver } of arrival.injuries) {
		if (driver.status === 'injured') parts.push(`${injuredLine(driver)}.`);
	}
	parts.push(dayEndReport(arrival.dayEnd).text);
	return parts.join(' ');
}

/** The one line the run screen shows for a failed run, under its heading: who's lost, what's lost, and the night after. */
export function failureSummary(result: Extract<StopFightResult, { outcome: 'run_failed' }>): string {
	const { dead, missing, cargoLost, cargoCardsLost, escortsLost } = result.fight;
	const fates = [
		...dead.map(driver => `${driver.name} is dead`),
		...missing.map(driver => `${driver.name} is missing`),
	];
	const parts = [`${listText(fates)}.`];
	const lost = cargoText({ cargo: cargoLost, cards: cargoCardsLost });
	if (lost) parts.push(`Lost with it: ${lost}.`);
	if (escortsLost.length > 0) parts.push(`${listText(escortsLost.map(escort => escort.name))} ${escortsLost.length === 1 ? 'is' : 'are'} gone.`);
	parts.push(result.dayEnd ? dayEndReport(result.dayEnd).text : 'Nobody is left at the compound.');
	return parts.join(' ');
}
