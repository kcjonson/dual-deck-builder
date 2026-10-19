import { DriverRecord, archetypeTitle } from '../../campaign/DriverRecord';
import type { Skulls } from '../../campaign/Encounters';
import type { FindStop, RouteStop, RouteYield, RunRoute } from '../../campaign/SupplyRoutes';
import { Arrival, DepartBlocker, FoundDriver, PlanBlocker, StopFightResult, cargoText, listText, yieldResources } from '../../campaign/SupplyRun';
import { resourceAmount } from '../../campaign/Campaign';
import { dayEndReport, injuredLine } from '../compound/compoundText';
import { countOf } from '../main-menu/campaignText';

/** What the run route screen, the run screen, and the compound's Plan button say about a supply run (DDB-454). */

export function skullsText(skulls: Skulls): string {
	return countOf(skulls, 'skull');
}

/** "Raider ambush, 2 skulls", "Find: supplies", "Quiet stretch". */
export function stopTitle(stop: RouteStop): string {
	switch (stop.kind) {
		case 'fight':
			return `Raider ambush, ${skullsText(stop.skulls)}`;
		case 'find':
			return `Find: ${stop.find}`;
		case 'quiet':
			return 'Quiet stretch';
	}
}

/** What the run screen says of the find ahead, and what taking it is called; `found` is who a Find: driver turns up. */
export function findStep({ stop, found }: { stop: FindStop; found: FoundDriver | null }): { line: string; take: string } {
	switch (stop.find) {
		case 'cards':
			return { line: 'A gutted trailer off the shoulder, a crate of cards still in it. Look through them, or drive on.', take: 'Look through them' };
		case 'supplies':
			return { line: `${resourceAmount({ resource: stop.supplies.resource, amount: stop.supplies.amount })} stashed by the road. Load it, or drive on.`, take: 'Load it' };
		case 'driver':
			if (found?.kind === 'missing') return { line: `${found.driver.name} flags the convoy down, alive. Take them home, or drive on.`, take: 'Take them home' };
			const who = found ? archetypeTitle(found.archetype) : 'driver';
			return { line: `${/^[AEIOU]/.test(who) ? 'An' : 'A'} ${who} flags the convoy down, looking for a compound to join. Take them on, or drive on.`, take: 'Take them on' };
	}
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
			return `The cheapest route on the area map takes ${blocker.needed} fuel, and the stores hold ${blocker.held}.`;
	}
}

/** The run route screen's line under a route it can't take. */
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
	const recruits = arrival.recruits.map(driver => driver.name);
	if (recruits.length > 0) parts.push(`${listText(recruits)} joined the compound.`);
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

/**
 * The debrief's one hero damage mark (UI Art Direction, Wear: one at a
 * time): an injured driver's tag takes a tear; otherwise the destination
 * the run cleared is stamped LOOTED. Null for none.
 */
export function debriefMark({ cleared, injured }: { cleared: boolean; injured: boolean }): 'tear' | 'looted' | null {
	if (injured) return 'tear';
	return cleared ? 'looted' : null;
}

/** A driver's tag line on the debrief: "Injured, fit in 2 days", or "Fit". */
export function crewState(driver: DriverRecord): string {
	return driver.status === 'injured' ? `Injured, fit in ${countOf(driver.injuredDays, 'day')}` : 'Fit';
}
