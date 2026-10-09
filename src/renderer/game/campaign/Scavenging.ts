import { readInteger, readSeed } from '../core/JsonReader';
import { Rng } from '../core/Rng';
import type { Campaign } from './Campaign';
import { COMPOUND_RULES, CompoundRules, SCAVENGED_RESOURCES, ScavengedResource, readCompoundRules } from './CompoundRules';
import { DAY_END_HOOKS, DayEnd, DayEndHooks, endDay } from './DayClock';

/**
 * The scavenging party (DDB-303): settlers go out on foot for a day and
 * bring back a little fuel and scrap, with no fight, so a compound with no
 * fuel always has a way to its next run (Compound and Supply Runs, Never
 * stuck). Decision record: docs/AI_TECHNICAL_DECISIONS/scavenging-party.md.
 */

/** What a party brought back. */
export type ScavengeHaul = Readonly<Record<ScavengedResource, number>>;

/** A day spent scavenging: what the party brought back, and the night after. */
export interface Scavenge {
	readonly haul: ScavengeHaul;
	readonly dayEnd: DayEnd;
}

/** Why no party can go out: People is 0, so nobody's left to send and the compound has fallen. */
export type ScavengeBlocker = { reason: 'abandoned' };

/** A party the compound can't send, carrying the blocker its check gives. */
export class ScavengeRuleError extends RangeError {
	public readonly blocker: ScavengeBlocker;

	constructor({ message, blocker }: { message: string; blocker: ScavengeBlocker }) {
		super(message);
		this.name = 'ScavengeRuleError';
		this.blocker = blocker;
	}
}

export interface ScavengeOptions {
	campaign: Campaign;
	/** The shipped `data/compound-rules.json` when left out. */
	rules?: CompoundRules;
	/** The shipped `DAY_END_HOOKS` when left out. */
	hooks?: DayEndHooks;
}

/**
 * Why the compound can't send a party out, or null if `scavenge` would. It
 * takes settlers, not drivers, so injured, missing, or dead drivers don't
 * stop it: the only refusal is an empty compound, which has already fallen.
 */
export function getScavengeBlocker({ campaign }: { campaign: Campaign }): ScavengeBlocker | null {
	return campaign.resources.people === 0 ? { reason: 'abandoned' } : null;
}

/**
 * What a party sent out on `day` brings back: fuel, then scrap, each one
 * `int` from its range, drawn from `fork('scavenge', day)` off the campaign's
 * seed. A party ends its day, and the day is a saved counter that never
 * repeats, so every party has a stream of its own and the save keeps
 * nothing new. Comes back frozen.
 */
export function rollScavengeHaul({ seed, day, rules = COMPOUND_RULES }: { seed: number; day: number; rules?: CompoundRules }): ScavengeHaul {
	const { fuel, scrap } = readCompoundRules(rules, 'CompoundRules').scavenging;
	const rng = new Rng({ seed: readSeed(seed, 'seed') }).fork('scavenge', readInteger(day, 'day', { min: 1 }));
	const fuelFound = rng.int(fuel.min, fuel.max);
	return Object.freeze({ fuel: fuelFound, scrap: rng.int(scrap.min, scrap.max) });
}

/**
 * Sends a scavenging party out for the day and returns what it brought
 * back and the night after. The haul comes home at dusk, before the
 * compound eats, and goes into the stores in `endDay`'s own `set`, with a
 * line in the log, so a day end that throws stores neither. Throws a
 * `ScavengeRuleError`, changing nothing, when `getScavengeBlocker` refuses.
 * Saving is the caller's checkpoint after it, as with Rest.
 */
export function scavenge({ campaign, rules = COMPOUND_RULES, hooks = DAY_END_HOOKS }: ScavengeOptions): Scavenge {
	const blocker = getScavengeBlocker({ campaign });
	if (blocker !== null) throw new ScavengeRuleError({ message: 'Nobody is left at the compound to send out scavenging', blocker });
	const haul = rollScavengeHaul({ seed: campaign.seed, day: campaign.day, rules });
	const dayEnd = endDay({ campaign, rules, hooks, haul: { resources: haul, message: scavengeMessage(haul) } });
	return Object.freeze({ haul, dayEnd });
}

/** "A scavenging party brought back 2 fuel and 15 scrap.", naming only what it found. */
export function scavengeMessage(haul: ScavengeHaul): string {
	const found = SCAVENGED_RESOURCES.filter(resource => haul[resource] > 0).map(resource => `${haul[resource]} ${resource}`);
	if (found.length === 0) return 'A scavenging party came back empty-handed.';
	return `A scavenging party brought back ${found.join(' and ')}.`;
}
