import type { Rng } from '../core/Rng';
import { DRIVER_CONFIGS, DriverArchetype } from '../mechanics/Driver';
import { Campaign, RESOURCE_NAMES, Resources } from './Campaign';
import { addCardsWon } from './CardsWon';
import type { RunParty } from './CombatBridge';
import { DRIVER_ARCHETYPES } from './DriverRecord';
import type { DriverRecord } from './DriverRecord';
import type { EventGains } from './Events';
import type { SupplyRun } from './SupplyRunState';

/**
 * What an event does to a run on the road (DDB-535): its cost paid and its
 * gains and losses applied, as Events.ts leaves them for the run to do
 * (calls 251, 252, 256, and 259). The steps that call these are
 * SupplyRun.ts's; the decision record is
 * docs/AI_TECHNICAL_DECISIONS/event-stops-on-a-run.md.
 */

/** The run and the stores once a choice's cost is paid: from the cargo first, then the stores (call 251). */
export function payEventCost({ campaign, run, cost }: { campaign: Campaign; run: SupplyRun; cost: Readonly<Resources> }): { run: SupplyRun; resources: Resources } {
	const negated = Object.fromEntries(RESOURCE_NAMES.map(name => [name, -cost[name]])) as unknown as Resources;
	return withResources({ run, stores: campaign.resources, change: negated });
}

/**
 * The run and the stores with an outcome's (or a won hand-off fight's)
 * gains: resources and settlers into the cargo, losses from the cargo and
 * then the stores, never below 0; cards into the cargo cards; an escort
 * among `escortsFound`; drivers as recruits, each of the archetype the
 * compound has fewest of (`recruitArchetype`). HP and structure change on
 * every seated driver and their vehicle, here and now, a loss stopping at 1
 * and a gain at their most (calls 252, 259). The reward picker isn't a
 * gain applied here: the step opens it.
 */
export function applyEventGains({ campaign, run, stores, party, gains, rng }: {
	campaign: Campaign;
	run: SupplyRun;
	/** The stores a loss takes from once the cargo is out: the campaign's, or as a cost just paid left them. */
	stores: Readonly<Resources>;
	party: RunParty;
	gains: EventGains;
	rng: Rng;
}): { run: SupplyRun; resources: Resources } {
	const { run: paid, resources } = withResources({ run, stores, change: gains.resources });
	const cargoCards = Object.keys(gains.cards).length === 0 ? paid.cargoCards : addCardsWon({ party: { ...party, cargoCards: paid.cargoCards }, cardsWon: gains.cards }).cargoCards;
	const recruits = [...paid.recruits];
	for (let found = 0; found < gains.drivers; found += 1) recruits.push(recruitArchetype({ campaign, recruits, rng }));
	const escortsFound = gains.escort === null ? paid.escortsFound : [...paid.escortsFound, gains.escort];
	for (const driver of party.seats) mendOrHurt({ driver, hp: gains.hp, structure: gains.structure });
	return { run: { ...paid, cargoCards, recruits, escortsFound }, resources };
}

/**
 * The archetype of someone new the run turns up: an unlocked one the
 * compound has fewest living drivers of, counting recruits riding home,
 * drawn on `rng` among those tied.
 */
export function recruitArchetype({ campaign, recruits, rng }: { campaign: Campaign; recruits: readonly DriverArchetype[]; rng: Rng }): DriverArchetype {
	const unlocked = DRIVER_ARCHETYPES.filter(archetype => DRIVER_CONFIGS[archetype].metadata.unlocked);
	const living = (archetype: DriverArchetype): number =>
		campaign.drivers.filter(driver => driver.archetype === archetype && driver.status !== 'dead').length
		+ recruits.filter(recruit => recruit === archetype).length;
	const fewest = Math.min(...unlocked.map(living));
	return rng.pick(unlocked.filter(candidate => living(candidate) === fewest));
}

/** Signed changes to the run's cargo, a loss taking what the cargo lacks from the stores, neither below 0. */
function withResources({ run, stores, change }: { run: SupplyRun; stores: Readonly<Resources>; change: Readonly<Resources> }): { run: SupplyRun; resources: Resources } {
	const cargo: Resources = { ...run.cargo };
	const resources: Resources = { ...stores };
	for (const name of RESOURCE_NAMES) {
		const amount = change[name];
		if (amount >= 0) {
			cargo[name] += amount;
			continue;
		}
		const fromCargo = Math.min(cargo[name], -amount);
		cargo[name] -= fromCargo;
		resources[name] = Math.max(0, resources[name] - (-amount - fromCargo));
	}
	return { run: { ...run, cargo }, resources };
}

function mendOrHurt({ driver, hp, structure }: { driver: DriverRecord; hp: number; structure: number }): void {
	const maxStructure = DRIVER_CONFIGS[driver.archetype].vehicleStats.maxStructure;
	const hitpoints = shifted({ value: driver.hitpoints, by: hp, max: driver.maxHitpoints });
	const vehicle = { ...driver.vehicle, structure: shifted({ value: driver.vehicle.structure, by: structure, max: maxStructure }) };
	if (hitpoints !== driver.hitpoints || vehicle.structure !== driver.vehicle.structure) driver.set({ hitpoints, vehicle });
}

/** `value` moved by `by`: a gain up to `max`, a loss down to 1, and neither moving it the other way. */
function shifted({ value, by, max }: { value: number; by: number; max: number }): number {
	if (by > 0) return Math.max(value, Math.min(max, value + by));
	if (by < 0) return Math.min(value, Math.max(1, value + by));
	return value;
}
