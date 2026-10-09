import { readInteger } from '../core/JsonReader';
import type { Campaign } from './Campaign';
import { hasOpenFight } from './CombatBridge';
import { COMPOUND_RULES, CompoundRules, readCompoundRules } from './CompoundRules';
import type { DriverRecord, DriverRecordData, DriverStatus } from './DriverRecord';
import { describeDriver } from './DriverRecord';

/**
 * The infirmary (DDB-304): a driver who comes home hurt is injured for days
 * scaled by the HP they're missing, and meds from the stores buy those days
 * back. A day comes off the same way whether a night or meds took it.
 * Decision record: docs/AI_TECHNICAL_DECISIONS/injuries.md.
 */

/** A driver who came home hurt. */
export interface Injury {
	readonly driver: DriverRecord;
	/** How far below their max HP they came home. */
	readonly missingHitpoints: number;
	/** Day ends until they're fit, the night they came home included. */
	readonly injuredDays: number;
}

/**
 * Why the infirmary won't treat a driver, which its screen shows on the
 * action it disables: they aren't injured (their status says what they
 * are), they'll be fit in fewer days than were asked for, or the stores
 * hold fewer meds than it takes.
 */
export type TreatmentBlocker =
	| { reason: 'not_injured'; status: Exclude<DriverStatus, 'injured'> }
	| { reason: 'too_many_days'; injuredDays: number }
	| { reason: 'too_few_meds'; needed: number; held: number };

/** A treatment the infirmary refuses, carrying the blocker its check gives. */
export class TreatmentRuleError extends RangeError {
	public readonly blocker: TreatmentBlocker;

	constructor({ message, blocker }: { message: string; blocker: TreatmentBlocker }) {
		super(message);
		this.name = 'TreatmentRuleError';
		this.blocker = blocker;
	}
}

export interface TreatmentOptions {
	campaign: Campaign;
	driver: DriverRecord;
	/** Days to take off the injury. 1 when left out. */
	days?: number;
	/** The shipped `data/compound-rules.json` when left out. */
	rules?: CompoundRules;
}

/**
 * Days a driver at `hitpoints` of `maxHitpoints` spends injured: the HP
 * they're missing over `infirmary.hitpointsPerDay`, rounded up, so any HP
 * missing costs a day and full HP costs none. Throws at 0 HP, since that
 * driver is dead, not injured, and on HP that isn't a whole number up to the max.
 */
export function injuryDays({ hitpoints, maxHitpoints, rules = COMPOUND_RULES }: {
	hitpoints: number;
	maxHitpoints: number;
	rules?: CompoundRules;
}): number {
	const { hitpointsPerDay } = readCompoundRules(rules, 'CompoundRules').infirmary;
	const max = readInteger(maxHitpoints, 'maxHitpoints', { min: 1 });
	const hp = readInteger(hitpoints, 'hitpoints', { min: 0, max, maxLabel: `maxHitpoints (${max})` });
	if (hp === 0) throw new RangeError('A driver at 0 hitpoints is dead, not injured');
	return Math.ceil((max - hp) / hitpointsPerDay);
}

/**
 * A run's drivers home (Compound and Supply Runs, The driver pool): each one
 * below their max HP is injured for `injuryDays`, and keeps the HP they came
 * home with until they're fit. The run controller (DDB-322) calls this with
 * the seats of a run that got home, as the combat bridge left them, after
 * unloading the cargo and before `endDay`, so the night home is the first
 * day in the infirmary and a driver one day hurt is fit by dawn.
 *
 * Returns who's injured, in the order given, frozen. The campaign itself
 * doesn't change, so only the injured drivers' records emit. Throws,
 * changing nothing, while the campaign's fight is open or being written
 * back (the write-back has to fit the records as the fight left them, and
 * a listener partway through it sees them half stored), and for a driver
 * outside the campaign's pool, one listed twice, or one who isn't ready: a
 * run leaves with ready drivers, and only a failed run, which never gets
 * home, changes a seat's status on the road.
 */
export function injureOnArrival({ campaign, drivers, rules = COMPOUND_RULES }: {
	campaign: Campaign;
	drivers: readonly DriverRecord[];
	rules?: CompoundRules;
}): readonly Injury[] {
	if (hasOpenFight(campaign)) throw new Error("This campaign's last fight hasn't been written back, so nobody has come home from it yet");
	const checked = readCompoundRules(rules, 'CompoundRules');
	drivers.forEach((driver, index) => {
		checkInPool({ campaign, driver });
		if (drivers.indexOf(driver) !== index) throw new RangeError(`${describeDriver(driver)} is listed twice, and came home once`);
		if (driver.status !== 'ready') throw new RangeError(`${describeDriver(driver)} is ${driver.status}, so they didn't come home from a run`);
	});
	const injuries: Injury[] = drivers
		.map(driver => Object.freeze({
			driver,
			missingHitpoints: driver.maxHitpoints - driver.hitpoints,
			injuredDays: injuryDays({ hitpoints: driver.hitpoints, maxHitpoints: driver.maxHitpoints, rules: checked })
		}))
		.filter(injury => injury.injuredDays > 0);
	injuries.forEach(({ driver, injuredDays }) => driver.set({ status: 'injured', injuredDays }));
	return Object.freeze(injuries);
}

/**
 * An injured driver's record once `days` come off their injury, whether
 * nights took them (`endDay`) or meds did: still injured with fewer days, or
 * ready again at full HP once none are left. Until then their HP stays
 * where they came home with it.
 */
export function healingChanges({ driver, days }: { driver: DriverRecord; days: number }): Partial<DriverRecordData> {
	const injuredDays = driver.injuredDays - days;
	return injuredDays > 0 ? { injuredDays } : { injuredDays, status: 'ready', hitpoints: driver.maxHitpoints };
}

/** Meds it takes to bring `days` off an injury. Throws unless `days` is a whole number from 1. */
export function treatmentCost({ days, rules = COMPOUND_RULES }: { days: number; rules?: CompoundRules }): number {
	return readInteger(days, 'days', { min: 1 }) * readCompoundRules(rules, 'CompoundRules').infirmary.medsPerDay;
}

/**
 * Why the infirmary won't take `days` off this driver's injury, or null if
 * `treatDriver` would, in this order: they aren't injured, they'll be fit in
 * fewer days than that, or the stores hold fewer meds than it costs. Throws,
 * as `treatDriver` does, on a driver outside the campaign's pool or `days`
 * that isn't a whole number from 1.
 */
export function getTreatmentBlocker({ campaign, driver, days = 1, rules = COMPOUND_RULES }: TreatmentOptions): TreatmentBlocker | null {
	return checkTreatment({ campaign, driver, days, rules }).blocker;
}

/**
 * Spends meds from the stores to take `days` off an injured driver's
 * injury (Compound and Supply Runs, Buildings: meds speed it up) and returns
 * the meds spent. A driver with no days left is ready at full HP straight
 * away, as one the night heals is at dawn, so they can go out today. The
 * record is stored first and the campaign last, so the campaign's `change`
 * comes once the treatment is whole. Throws a `TreatmentRuleError`,
 * changing nothing, when `getTreatmentBlocker` refuses.
 */
export function treatDriver({ campaign, driver, days = 1, rules = COMPOUND_RULES }: TreatmentOptions): number {
	const { blocker, cost } = checkTreatment({ campaign, driver, days, rules });
	if (blocker !== null) throw new TreatmentRuleError({ message: treatmentMessage({ blocker, driver, days }), blocker });
	driver.set(healingChanges({ driver, days }));
	campaign.set({ resources: { ...campaign.resources, meds: campaign.resources.meds - cost } });
	return cost;
}

/** A treatment checked against the rules, with the meds it costs, which `treatDriver` spends. */
function checkTreatment({ campaign, driver, days, rules }: Required<TreatmentOptions>): { blocker: TreatmentBlocker | null; cost: number } {
	checkInPool({ campaign, driver });
	const cost = treatmentCost({ days, rules });
	const refused = (blocker: TreatmentBlocker) => ({ blocker, cost });
	if (driver.status !== 'injured') return refused({ reason: 'not_injured', status: driver.status });
	if (days > driver.injuredDays) return refused({ reason: 'too_many_days', injuredDays: driver.injuredDays });
	const held = campaign.resources.meds;
	if (held < cost) return refused({ reason: 'too_few_meds', needed: cost, held });
	return { blocker: null, cost };
}

/** What a refused treatment throws, worded for the console; the infirmary screen words its own from the blocker. */
function treatmentMessage({ blocker, driver, days }: { blocker: TreatmentBlocker; driver: DriverRecord; days: number }): string {
	switch (blocker.reason) {
		case 'not_injured':
			return `${describeDriver(driver)} is ${blocker.status}, not injured, so there's nothing to treat`;
		case 'too_many_days':
			return `${describeDriver(driver)} is fit in ${daysText(blocker.injuredDays)}, so meds can't take ${daysText(days)} off`;
		case 'too_few_meds':
			return `Taking ${daysText(days)} off ${describeDriver(driver)}'s injury takes ${blocker.needed} meds, and the stores hold ${blocker.held}`;
	}
}

function daysText(days: number): string {
	return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function checkInPool({ campaign, driver }: { campaign: Campaign; driver: DriverRecord }): void {
	if (!campaign.drivers.includes(driver)) throw new RangeError(`${describeDriver(driver)} isn't in this campaign's pool`);
}
