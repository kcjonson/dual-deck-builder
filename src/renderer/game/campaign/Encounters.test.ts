import { Rng } from '../core/Rng';
import cardsFile from '../data/cards.json';
import encountersFile from '../data/encounters.json';
import { Battle } from '../mechanics/Battle';
import { Card, CardData } from '../mechanics/Card';
import { DRIVER_CONFIGS } from '../mechanics/Driver';
import { RAIDER_PROFILES, STAGE_GROWTH, raiderVehicle } from '../mechanics/Raiders';
import { Team, TeamType } from '../mechanics/Team';
import { createDrivenVehicle } from '../mechanics/Vehicle';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import {
	ENCOUNTER_DATA,
	EncounterTemplate,
	SKULLS,
	SOLO_MIN_RAIDERS,
	STAGES_PER_GROWTH,
	Skulls,
	encounterForces,
	readEncounterData,
	sizedWaves,
	templatesFor
} from './Encounters';

/** DDB-328: encounter templates, raider classes, and how a fight is sized. */

const CARDS: ReadonlyMap<string, Card> = new Map(
	(cardsFile as unknown as { cards: CardData[] }).cards.map(data => [data.type, new Card(data)])
);

/** Runs and Encounters, How big: raiders to kill, waves, and the most on the road at once, by skull count */
const HOW_BIG: Record<Skulls, { raiders: [number, number]; waves: [number, number]; onRoad: number }> = {
	1: { raiders: [4, 6], waves: [2, 2], onRoad: 3 },
	2: { raiders: [6, 10], waves: [2, 3], onRoad: 4 },
	3: { raiders: [9, 14], waves: [3, 3], onRoad: 5 }
};

const count = (template: EncounterTemplate): number => template.waves.reduce((sum, wave) => sum + wave.raiders.length, 0);

describe('Encounter data', () => {
	it('gives every skull count two or three templates at each tier, 1 to 4', () => {
		for (const skulls of SKULLS) {
			for (let tier = 1; tier <= 4; tier += 1) {
				expect(templatesFor({ skulls, tier }).length).toBeGreaterThanOrEqual(2);
				expect(templatesFor({ skulls, tier }).length).toBeLessThanOrEqual(3);
			}
		}
	});

	it.each(ENCOUNTER_DATA.templates.map(template => [template.id, template] as const))('sizes %s as its skull count asks', (_id, template) => {
		const size = HOW_BIG[template.skulls];
		const leaders = template.waves.flatMap(wave => wave.raiders).filter(raider => RAIDER_PROFILES[raider].class === 'leader').length;
		// A warband adds its leader on top
		expect(count(template) - leaders).toBeGreaterThanOrEqual(size.raiders[0]);
		expect(count(template) - leaders).toBeLessThanOrEqual(size.raiders[1]);
		expect(template.waves.length).toBeGreaterThanOrEqual(size.waves[0]);
		expect(template.waves.length).toBeLessThanOrEqual(size.waves[1]);
		expect(template.waves[0].raiders.length).toBeLessThanOrEqual(size.onRoad);
		expect(ENCOUNTER_DATA.roadCap[template.skulls]).toBe(size.onRoad);
		// Never a single vehicle (Kevin's rule 4)
		expect(template.waves[0].raiders.length).toBeGreaterThan(1);
	});

	it('refuses a template with no tiers, a tier twice, or a first wave past its road cap', () => {
		const noTiers = JSON.parse(JSON.stringify(encountersFile));
		noTiers.templates[0].tiers = [];
		expect(() => readEncounterData(noTiers)).toThrow('tiers must name at least one tier');
		const twice = JSON.parse(JSON.stringify(encountersFile));
		twice.templates[0].tiers = [1, 1];
		expect(() => readEncounterData(twice)).toThrow('tiers must name at least one tier');
		const crowded = JSON.parse(JSON.stringify(encountersFile));
		crowded.templates[0].waves[0].raiders = ['scav_bike', 'scav_bike', 'scav_bike', 'scav_bike'];
		expect(() => readEncounterData(crowded)).toThrow('past the 1-skull cap of 3');
	});

	it("fields a tier's own templates, and tier 4's for a tier with none", () => {
		const data = JSON.parse(JSON.stringify(encountersFile));
		data.templates.push({ ...data.templates[0], id: 'stronghold_pack', tiers: [5] });
		const read = readEncounterData(data);
		expect(templatesFor({ skulls: 1, tier: 5, data: read }).map(template => template.id)).toEqual(['stronghold_pack']);
		expect(templatesFor({ skulls: 2, tier: 5, data: read })).toEqual(templatesFor({ skulls: 2, tier: 4, data: read }));
	});

	it('refuses an unknown raider, a missing field, and a skull count with no template at a tier', () => {
		const data = JSON.parse(JSON.stringify(encountersFile));
		data.templates[0].waves[0].raiders = ['tank'];
		expect(() => readEncounterData(data)).toThrow('encounters.json.templates[0].waves[0].raiders[0] must be one of');

		const missing = JSON.parse(JSON.stringify(encountersFile));
		delete missing.templates[0].grow;
		expect(() => readEncounterData(missing)).toThrow('encounters.json.templates[0].grow is missing');

		const short = JSON.parse(JSON.stringify(encountersFile));
		short.templates = short.templates.filter((template: { skulls: number }) => template.skulls !== 2);
		expect(() => readEncounterData(short)).toThrow('has no 2-skull template for tier 1');
	});
});

describe('Sizing a fight', () => {
	const template = ENCOUNTER_DATA.templates.find(candidate => candidate.skulls === 3) as EncounterTemplate;

	it('meets a lone driver with half the raiders, rounded up, cut from the last wave first', () => {
		const waves = sizedWaves({ template, solo: true });
		const total = waves.reduce((sum, wave) => sum + wave.raiders.length, 0);
		expect(total).toBe(Math.max(SOLO_MIN_RAIDERS, Math.ceil(count(template) / 2)));
		expect(waves[0].raiders).toEqual(template.waves[0].raiders);
	});

	it('never meets a lone driver with fewer than four', () => {
		const small = ENCOUNTER_DATA.templates.find(candidate => count(candidate) <= 6) as EncounterTemplate;
		const waves = sizedWaves({ template: small, solo: true });
		expect(waves.reduce((sum, wave) => sum + wave.raiders.length, 0)).toBe(Math.min(count(small), SOLO_MIN_RAIDERS));
	});

	it('queues one more grow raider in the last wave every two stages', () => {
		const waves = sizedWaves({ template, solo: false, stage: 2 * STAGES_PER_GROWTH + 1 });
		const last = waves[waves.length - 1].raiders;
		expect(last).toEqual([...template.waves[template.waves.length - 1].raiders, template.grow, template.grow]);
	});

	it('grows each raider\'s structure and HP 5% a stage', () => {
		const grown = raiderVehicle({ raider: 'rust_buggy', cards: CARDS, stage: 4 });
		const base = RAIDER_PROFILES.rust_buggy;
		expect(grown.maxStructure).toBe(Math.round(base.vehicleStats.maxStructure * (1 + STAGE_GROWTH * 4)));
		expect(grown.driver?.maxHitpoints).toBe(Math.round(base.hitpoints * (1 + STAGE_GROWTH * 4)));
	});

	it('picks the template from the fight\'s stream, the same one from the same seed, and queues the later waves under the road cap', () => {
		const forces = (seed: number) => encounterForces({ skulls: 2, tier: 1, cards: CARDS, seats: 2, rng: new Rng({ seed }) });
		const first = forces(11);
		expect(forces(11).template).toBe(first.template);
		const picked = new Set(Array.from({ length: 30 }, (_, seed) => forces(seed).template.id));
		expect(picked.size).toBe(templatesFor({ skulls: 2, tier: 1 }).length);

		expect(first.team.vehicles.map(vehicle => vehicle.name)).toEqual(first.template.waves[0].raiders.map(raider => RAIDER_PROFILES[raider].vehicleName));
		expect(first.team.reinforcements?.map(wave => wave.maxOnRoad)).toEqual(first.template.waves.slice(1).map(() => 4));
	});
});

describe('Raider classes', () => {
	it('gives the leader an elite\'s hidden intents and the leader flag', () => {
		const leader = raiderVehicle({ raider: 'warlord', cards: CARDS });
		expect(leader.leader).toBe(true);
		expect(leader.intentTier).toBe('elite');
		expect(raiderVehicle({ raider: 'scav_bike', cards: CARDS }).leader).toBe(false);
	});

	it('plays the mook one card a turn', () => {
		const profile = RAIDER_PROFILES.scav_bike;
		const cheapest = Math.min(...Object.keys(profile.deck).map(type => CARDS.get(type)?.cost ?? Infinity));
		expect(profile.maxAdrenaline).toBeLessThan(2 * cheapest);
	});

	it.each([
		['road_warrior', 'ramming_speed'],
		['interceptor', 'precision_shot'],
		['interceptor', 'headshot']
	])('lets the %s take the mook out with one %s, even at stage 6', (archetype, cardType) => {
		const config = DRIVER_CONFIGS[archetype as 'road_warrior'];
		const driver = createTestDriver(config.metadata.name);
		driver.set({ skills: { ...config.skills }, hand: [CARDS.get(cardType)?.copy() as Card], adrenaline: 5 });
		const vehicle = createDrivenVehicle({ driver });
		const mook = raiderVehicle({ raider: 'scav_bike', cards: CARDS, stage: 6 });
		const other = raiderVehicle({ raider: 'scav_bike', cards: CARDS });
		const battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [vehicle] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [mook, other] })
		});

		expect(battle.playCard({ driver, cardIndex: 0, targetVehicle: mook })).toBe(true);
		expect(mook.isOutOfFight).toBe(true);
	});

	it.each(['road_warrior', 'interceptor', 'mechanic'] as const)('arms every class with a card that can hit the %s', (archetype) => {
		const config = DRIVER_CONFIGS[archetype];
		for (const profile of Object.values(RAIDER_PROFILES)) {
			const reaches = Object.keys(profile.deck).some(type => {
				const effect = CARDS.get(type)?.effects.find(candidate => candidate.type === 'damage');
				if (!effect) return false;
				const ram = effect.attackType === 'ramming' || type.startsWith('ram');
				return ram ? profile.skills.ramming >= config.skills.evade : profile.skills.gunnery > config.skills.evade;
			});
			expect([profile.name, reaches]).toEqual([profile.name, true]);
		}
	});
});

describe('profiles given', () => {
	it('builds every raider, queued ones too, from the profiles given, leaving the shipped ones alone', () => {
		const profiles = Object.fromEntries(Object.entries(RAIDER_PROFILES).map(([id, profile]) => [id, { ...profile, hitpoints: 10 }])) as typeof RAIDER_PROFILES;
		const { team } = encounterForces({ skulls: 1, tier: 1, cards: CARDS, seats: 2, rng: new Rng({ seed: 3 }), profiles });
		const everyone = [...team.vehicles, ...(team.reinforcements ?? []).flatMap(wave => wave.raiders)];
		expect(everyone.map(raider => raider.driver?.hitpoints)).toEqual(everyone.map(() => 10));
		expect(RAIDER_PROFILES.rust_buggy.hitpoints).not.toBe(10);
	});
});
