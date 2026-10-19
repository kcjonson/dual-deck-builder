import encountersFile from '../data/encounters.json';
import { ReaderRangeError, readArray, readFields, readInteger, readOneOf, readText } from '../core/JsonReader';
import type { Rng } from '../core/Rng';
import type { Card } from '../mechanics/Card';
import { RAIDER_IDS, RAIDER_PROFILES, RaiderId, RaiderProfile, raiderVehicle } from '../mechanics/Raiders';
import { PLAYER_DRIVEN_VEHICLES, Team, TeamType } from '../mechanics/Team';
import type { Vehicle } from '../mechanics/Vehicle';

/**
 * Fight encounters (Runs and Encounters, Encounters; DDB-328), read from
 * `data/encounters.json`: a fight's raiders as templates of waves, by skull
 * count and the tiers whose roster they draw from. The raiders are the
 * shared profiles (mechanics/Raiders.ts). Decision record:
 * docs/AI_TECHNICAL_DECISIONS/raider-waves-and-fight-ends.md.
 */

/** Danger, as the route screen's skulls count it (Game Flow 3.4). */
export type Skulls = 1 | 2 | 3;

/** A wave: its raiders, and for a wave after the first when it's due (ReinforcementWave). */
export interface EncounterWave {
	readonly raiders: readonly RaiderId[];
	readonly arriveAt?: number;
	readonly afterTurns?: number;
}

/** Tiers a template can be for: the area map's, 1 to 5. */
const TEMPLATE_TIERS = 5;

/** Tiers every skull count needs a template for; a stronghold's tier 5 borrows tier 4's until it has its own. */
const COVERED_TIERS = 4;

export interface EncounterTemplate {
	readonly id: string;
	readonly skulls: Skulls;
	readonly tiers: readonly number[];
	/** The first wave, then the queued ones, each with when it's due */
	readonly waves: readonly EncounterWave[];
	/** The raider game stage adds to the last wave, one every STAGES_PER_GROWTH stages */
	readonly grow: RaiderId;
}

export interface EncounterData {
	/** The most raiders on the road at once, by skull count (Runs and Encounters, How big) */
	readonly roadCap: Readonly<Record<Skulls, number>>;
	readonly templates: readonly EncounterTemplate[];
}

export const SKULLS: readonly Skulls[] = [1, 2, 3];

/** The fewest raiders a lone driver meets (Runs and Encounters, How big). */
export const SOLO_MIN_RAIDERS = 4;

/** Game stages per extra `grow` raider (Runs and Encounters, Encounters). */
export const STAGES_PER_GROWTH = 2;

function readRaiders(value: unknown, path: string): RaiderId[] {
	const raiders = readArray(value, path).map((raider, index) => readOneOf(raider, `${path}[${index}]`, RAIDER_IDS));
	if (raiders.length === 0) throw new ReaderRangeError(`${path} must name at least one raider`);
	return raiders;
}

function readWave(value: unknown, path: string, first: boolean): EncounterWave {
	const fields = readFields(value, path, ['raiders'], first ? [] : ['arriveAt', 'afterTurns']);
	return {
		raiders: readRaiders(fields.raiders, `${path}.raiders`),
		...(fields.arriveAt === undefined ? {} : { arriveAt: readInteger(fields.arriveAt, `${path}.arriveAt`, { min: 0 }) }),
		...(fields.afterTurns === undefined ? {} : { afterTurns: readInteger(fields.afterTurns, `${path}.afterTurns`, { min: 1 }) })
	};
}

function readTemplate(value: unknown, path: string): EncounterTemplate {
	const fields = readFields(value, path, ['id', 'skulls', 'tiers', 'waves', 'grow']);
	const waves = readArray(fields.waves, `${path}.waves`).map((wave, index) => readWave(wave, `${path}.waves[${index}]`, index === 0));
	if (waves.length === 0) throw new ReaderRangeError(`${path}.waves must hold at least the first wave`);
	return {
		id: readText(fields.id, `${path}.id`),
		skulls: readInteger(fields.skulls, `${path}.skulls`, { min: 1, max: 3 }) as Skulls,
		tiers: readArray(fields.tiers, `${path}.tiers`).map((tier, index) => readInteger(tier, `${path}.tiers[${index}]`, { min: 1, max: TEMPLATE_TIERS })),
		waves,
		grow: readOneOf(fields.grow, `${path}.grow`, RAIDER_IDS)
	};
}

/**
 * The encounter data, read strictly: an unknown or missing field, a raider
 * that isn't a profile, a skull count or tier out of range, an id used
 * twice, or a skull count and tier (1 to 4) with no template throws,
 * naming its path.
 */
export function readEncounterData(value: unknown, path = 'encounters.json'): EncounterData {
	const fields = readFields(value, path, ['roadCap', 'templates']);
	const caps = readFields(fields.roadCap, `${path}.roadCap`, ['1', '2', '3']);
	const roadCap: Record<Skulls, number> = {
		1: readInteger(caps['1'], `${path}.roadCap.1`, { min: 1, max: 9 }),
		2: readInteger(caps['2'], `${path}.roadCap.2`, { min: 1, max: 9 }),
		3: readInteger(caps['3'], `${path}.roadCap.3`, { min: 1, max: 9 })
	};
	const templates = readArray(fields.templates, `${path}.templates`).map((entry, index) => readTemplate(entry, `${path}.templates[${index}]`));
	templates.forEach((template, index) => {
		const at = `${path}.templates[${index}]`;
		if (templates.findIndex(other => other.id === template.id) !== index) throw new ReaderRangeError(`${at}.id ${template.id} is used twice`);
		if (template.tiers.length === 0 || new Set(template.tiers).size !== template.tiers.length) throw new ReaderRangeError(`${at}.tiers must name at least one tier, each once`);
		if (template.waves[0].raiders.length > roadCap[template.skulls]) {
			throw new ReaderRangeError(`${at}.waves[0] puts ${template.waves[0].raiders.length} raiders on the road, past the ${template.skulls}-skull cap of ${roadCap[template.skulls]}`);
		}
	});
	for (const skulls of SKULLS) {
		for (let tier = 1; tier <= COVERED_TIERS; tier += 1) {
			if (!templates.some(template => template.skulls === skulls && template.tiers.includes(tier))) {
				throw new ReaderRangeError(`${path} has no ${skulls}-skull template for tier ${tier}`);
			}
		}
	}
	return { roadCap, templates };
}

export const ENCOUNTER_DATA: EncounterData = readEncounterData(encountersFile);

/** The templates a fight of this many skulls draws from at this tier. */
export function templatesFor({ skulls, tier, data = ENCOUNTER_DATA }: { skulls: Skulls; tier: number; data?: EncounterData }): readonly EncounterTemplate[] {
	const forTier = (band: number): EncounterTemplate[] => data.templates.filter(template => template.skulls === skulls && template.tiers.includes(band));
	const own = forTier(tier);
	// A stronghold's tier 5 borrows tier 4's until it has templates of its own
	return own.length > 0 ? own : forTier(Math.min(Math.max(1, tier), COVERED_TIERS));
}

/**
 * A template's waves as they'll be fought: game stage queues one more of
 * its `grow` raider in the last wave for every STAGES_PER_GROWTH stages,
 * and a lone driver meets half the raiders, rounded up and never fewer
 * than SOLO_MIN_RAIDERS, cut from the last wave first. The first wave
 * keeps at least one raider; a later wave cut to nothing goes.
 */
export function sizedWaves({ template, solo, stage = 0 }: { template: EncounterTemplate; solo: boolean; stage?: number }): EncounterWave[] {
	const waves = template.waves.map(wave => ({ ...wave, raiders: [...wave.raiders] }));
	const grown = Math.floor(stage / STAGES_PER_GROWTH);
	waves[waves.length - 1].raiders.push(...Array.from({ length: grown }, () => template.grow));
	if (!solo) return waves;

	const total = waves.reduce((sum, wave) => sum + wave.raiders.length, 0);
	let cut = total - Math.min(total, Math.max(SOLO_MIN_RAIDERS, Math.ceil(total / 2)));
	for (let index = waves.length - 1; index >= 0 && cut > 0; index -= 1) {
		const taken = Math.min(cut, waves[index].raiders.length - (index === 0 ? 1 : 0));
		waves[index].raiders.splice(waves[index].raiders.length - taken, taken);
		cut -= taken;
	}
	return waves.filter(wave => wave.raiders.length > 0);
}

/**
 * A fight's raiders from a template picked on `rng`, the fight's own stream
 * (forked as `encounter`, so the pick moves no other draw): the first wave
 * as an enemy team, the rest queued on it as its reinforcements, each
 * under the skull count's road cap. Every raider is grown for the stage. A
 * crew of one seat is a lone driver, who meets the solo size. Throws for a
 * crew of no seats or more than two, and as `raiderVehicle` does for a card
 * the map doesn't hold.
 */
export function encounterForces({ skulls, tier, cards, seats, rng, stage = 0, data = ENCOUNTER_DATA, profiles = RAIDER_PROFILES }: {
	skulls: Skulls;
	tier: number;
	cards: ReadonlyMap<string, Card>;
	/** How many drivers the crew seats */
	seats: number;
	rng: Rng;
	stage?: number;
	data?: EncounterData;
	/** The shipped profiles when left out; the balance sim passes its config's. */
	profiles?: Readonly<Record<RaiderId, Readonly<RaiderProfile>>>;
}): { template: EncounterTemplate; team: Team } {
	if (seats < 1 || seats > PLAYER_DRIVEN_VEHICLES) {
		throw new RangeError(`An encounter sizes up one or two seats, and this crew has ${seats}`);
	}
	const template = rng.fork('encounter').pick(templatesFor({ skulls, tier, data }));
	const [first, ...later] = sizedWaves({ template, solo: seats === 1, stage });
	const build = (raider: RaiderId): Vehicle => raiderVehicle({ raider, cards, stage, profiles });
	const team = new Team({
		type: TeamType.ENEMY,
		vehicles: first.raiders.map(build),
		reinforcements: later.map(({ raiders, arriveAt, afterTurns }) => ({
			raiders: raiders.map(build),
			arriveAt,
			afterTurns,
			maxOnRoad: data.roadCap[skulls]
		}))
	});
	return { template, team };
}
