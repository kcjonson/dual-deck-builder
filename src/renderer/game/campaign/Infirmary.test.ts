import { Rng } from '../core/Rng';
import { resolveMapParams } from '../map/MapParams';
import { Campaign, Resources } from './Campaign';
import { CampaignStore } from './CampaignStore';
import { CAMPAIGN_START } from './CampaignStart';
import { REVIVE_HP } from './CombatBridge';
import { COMPOUND_RULES, CompoundRules } from './CompoundRules';
import { endDay } from './DayClock';
import { DriverRecord, DriverStatus } from './DriverRecord';
import { foundCampaign } from './Founding';
import {
	TreatmentBlocker, TreatmentRuleError, getTreatmentBlocker, healingChanges, injureOnArrival, injuryDays, treatDriver, treatmentCost
} from './Infirmary';
import { MemorySaveStorage } from './SaveStorage';
import { getSeatBlocker } from './Seating';

const SEED = 20261008;

/** A compound with a driver of each archetype (max HP 40, 25, 30, 33) and the founding stores, 3 meds among them. */
function newCompound(resources: Partial<Resources> = {}): {
	campaign: Campaign;
	warrior: DriverRecord;
	interceptor: DriverRecord;
	mechanic: DriverRecord;
	raider: DriverRecord;
} {
	const campaign = new Campaign({
		seed: SEED,
		generatorVersion: 1,
		mapParams: resolveMapParams({ seed: SEED, environment: 'mixed' }).params,
		resources: { ...CAMPAIGN_START.resources, ...resources }
	});
	const [warrior, interceptor, mechanic, raider] = (['road_warrior', 'interceptor', 'mechanic', 'raider'] as const)
		.map(archetype => campaign.recruitDriver({ archetype }));
	return { campaign, warrior, interceptor, mechanic, raider };
}

const rulesWith = (infirmary: Partial<CompoundRules['infirmary']>): CompoundRules => ({
	...COMPOUND_RULES,
	infirmary: { ...COMPOUND_RULES.infirmary, ...infirmary }
});

const savedText = (campaign: Campaign): string => JSON.stringify(campaign);

/** A save and a load: through JSON text and back. */
const reload = (campaign: Campaign): Campaign => Campaign.fromJSON(JSON.parse(savedText(campaign)));

interface Condition {
	status: DriverStatus;
	injuredDays: number;
	hitpoints: number;
}

const conditionOf = ({ status, injuredDays, hitpoints }: Condition): Condition => ({ status, injuredDays, hitpoints });

/** Brought home from a run at `hitpoints`, as the combat bridge wrote them back, and checked in at the infirmary. */
function comeHome({ campaign, seats }: { campaign: Campaign; seats: [DriverRecord, number][] }): void {
	seats.forEach(([driver, hitpoints]) => driver.set({ hitpoints }));
	injureOnArrival({ campaign, drivers: seats.map(([driver]) => driver) });
}

describe('injuryDays', () => {
	it.each([
		['full HP costs nothing', 40, 40, 0],
		['1 HP down is a day', 39, 40, 1],
		['a day\'s 10 HP down is a day', 30, 40, 1],
		['a day and 1 HP down is two', 29, 40, 2],
		['1 HP of 40 is 4 days', 1, 40, 4],
		['1 HP of an Interceptor\'s 25 is 3 days', 1, 25, 3],
		['1 HP of 1 is full HP', 1, 1, 0]
	])('%s', (_label, hitpoints, maxHitpoints, days) => {
		expect(injuryDays({ hitpoints, maxHitpoints })).toBe(days);
	});

	it('refuses 0 HP: that driver is dead, not injured', () => {
		expect(() => injuryDays({ hitpoints: 0, maxHitpoints: 40 })).toThrow('A driver at 0 hitpoints is dead, not injured');
	});

	it('scales with the HP a day is worth', () => {
		expect(injuryDays({ hitpoints: 1, maxHitpoints: 40, rules: rulesWith({ hitpointsPerDay: 1 }) })).toBe(39);
		expect(injuryDays({ hitpoints: 1, maxHitpoints: 40, rules: rulesWith({ hitpointsPerDay: 100 }) })).toBe(1);
	});

	it.each([
		['HP past the max', 41, 40, 'hitpoints must be an integer from 0 to maxHitpoints (40), got 41'],
		['part of an HP', 12.5, 40, 'hitpoints must be an integer from 0 to maxHitpoints (40), got 12.5'],
		['a max of nothing', 0, 0, 'maxHitpoints must be an integer >= 1, got 0']
	])('refuses %s', (_label, hitpoints, maxHitpoints, message) => {
		expect(() => injuryDays({ hitpoints, maxHitpoints })).toThrow(message);
	});

	it('checks the rules it\'s given', () => {
		expect(() => injuryDays({ hitpoints: 1, maxHitpoints: 40, rules: rulesWith({ hitpointsPerDay: 0 }) }))
			.toThrow('CompoundRules.infirmary.hitpointsPerDay must be an integer from 1 to 100, got 0');
	});
});

describe('injureOnArrival', () => {
	it('injures each driver home below their max HP for their days, keeping the HP they came home with, and leaves one home whole ready', () => {
		const { campaign, warrior, interceptor } = newCompound();
		warrior.set({ hitpoints: 35 });

		const injuries = injureOnArrival({ campaign, drivers: [warrior, interceptor] });

		expect(injuries).toEqual([{ driver: warrior, missingHitpoints: 5, injuredDays: 1 }]);
		expect(conditionOf(warrior)).toEqual({ status: 'injured', injuredDays: 1, hitpoints: 35 });
		expect(conditionOf(interceptor)).toEqual({ status: 'ready', injuredDays: 0, hitpoints: 25 });
		expect(Object.isFrozen(injuries)).toBe(true);
		expect(Object.isFrozen(injuries[0])).toBe(true);
	});

	it('injures a driver the partner revived at REVIVE_HP for as long as their max HP allows', () => {
		const { campaign, warrior, interceptor } = newCompound();
		[warrior, interceptor].forEach(driver => driver.set({ hitpoints: REVIVE_HP }));

		const injuries = injureOnArrival({ campaign, drivers: [warrior, interceptor] });

		expect(injuries.map(({ driver, missingHitpoints, injuredDays }) => [driver.name, missingHitpoints, injuredDays])).toEqual([
			['Road Warrior 1', 39, 4],
			['Interceptor 1', 24, 3]
		]);
	});

	it('injures by the rules it\'s given', () => {
		const { campaign, mechanic } = newCompound();
		mechanic.set({ hitpoints: 20 });

		injureOnArrival({ campaign, drivers: [mechanic], rules: rulesWith({ hitpointsPerDay: 3 }) });

		expect(mechanic.injuredDays).toBe(4);
	});

	it('changes only the injured drivers\' records, never the campaign', () => {
		const { campaign, warrior, interceptor } = newCompound();
		interceptor.set({ hitpoints: 3 });
		const changed: string[] = [];
		[warrior, interceptor].forEach(driver => driver.on('change', () => changed.push(driver.name)));
		campaign.on('change', () => changed.push('campaign'));

		injureOnArrival({ campaign, drivers: [warrior, interceptor] });

		expect(changed).toEqual(['Interceptor 1']);
	});

	it('injures nobody when nobody comes home hurt', () => {
		const { campaign, warrior, raider } = newCompound();

		expect(injureOnArrival({ campaign, drivers: [warrior, raider] })).toEqual([]);
		expect(injureOnArrival({ campaign, drivers: [] })).toEqual([]);
	});

	describe('refuses, changing nothing', () => {
		it.each([
			['a dead driver at 0 HP, who never came home', (driver: DriverRecord) => driver.set({ status: 'dead', hitpoints: 0, defaultDeck: {} }),
				'Mechanic 1 (driver-3) is dead, so they didn\'t come home from a run'],
			['a missing driver', (driver: DriverRecord) => driver.set({ status: 'missing' }),
				'Mechanic 1 (driver-3) is missing, so they didn\'t come home from a run'],
			['a driver who was already injured, so didn\'t go', (driver: DriverRecord) => driver.set({ status: 'injured', injuredDays: 2, hitpoints: 10 }),
				'Mechanic 1 (driver-3) is injured, so they didn\'t come home from a run']
		])('%s', (_label, change, message) => {
			const { campaign, warrior, mechanic } = newCompound();
			warrior.set({ hitpoints: 12 });
			change(mechanic);
			const before = savedText(campaign);

			expect(() => injureOnArrival({ campaign, drivers: [warrior, mechanic] })).toThrow(message);
			expect(savedText(campaign)).toBe(before);
		});

		it('a driver from outside the pool', () => {
			const { campaign, warrior } = newCompound();
			warrior.set({ hitpoints: 12 });
			const stranger = new DriverRecord({ id: 'driver-9', archetype: 'mechanic', name: 'Mechanic 1', hitpoints: 3 });

			expect(() => injureOnArrival({ campaign, drivers: [warrior, stranger] })).toThrow("Mechanic 1 (driver-9) isn't in this campaign's pool");
			expect(warrior.status).toBe('ready');
		});

		it('a driver listed twice', () => {
			const { campaign, warrior } = newCompound();
			warrior.set({ hitpoints: 12 });

			expect(() => injureOnArrival({ campaign, drivers: [warrior, warrior] })).toThrow('Road Warrior 1 (driver-1) is listed twice, and came home once');
			expect(warrior.status).toBe('ready');
		});

		it('rules a save couldn\'t trust', () => {
			const { campaign, warrior } = newCompound();
			warrior.set({ hitpoints: 12 });

			expect(() => injureOnArrival({ campaign, drivers: [warrior], rules: rulesWith({ hitpointsPerDay: -1 }) }))
				.toThrow('CompoundRules.infirmary.hitpointsPerDay must be an integer from 1 to 100, got -1');
			expect(warrior.status).toBe('ready');
		});
	});
});

describe('injuries and the day clock', () => {
	it('counts the night home as the first day in the infirmary: a driver a day hurt is fit by dawn, one four days hurt on the fourth', () => {
		const { campaign, warrior, interceptor } = newCompound();
		comeHome({ campaign, seats: [[warrior, REVIVE_HP], [interceptor, 20]] });

		const dawns = [1, 2, 3, 4].map(() => {
			const { healed } = endDay({ campaign });
			return { day: campaign.day, healed: healed.map(driver => driver.name), warrior: conditionOf(warrior), interceptor: conditionOf(interceptor) };
		});

		expect(dawns).toEqual([
			{ day: 2, healed: ['Interceptor 1'], warrior: { status: 'injured', injuredDays: 3, hitpoints: 1 }, interceptor: { status: 'ready', injuredDays: 0, hitpoints: 25 } },
			{ day: 3, healed: [], warrior: { status: 'injured', injuredDays: 2, hitpoints: 1 }, interceptor: { status: 'ready', injuredDays: 0, hitpoints: 25 } },
			{ day: 4, healed: [], warrior: { status: 'injured', injuredDays: 1, hitpoints: 1 }, interceptor: { status: 'ready', injuredDays: 0, hitpoints: 25 } },
			{ day: 5, healed: ['Road Warrior 1'], warrior: { status: 'ready', injuredDays: 0, hitpoints: 40 }, interceptor: { status: 'ready', injuredDays: 0, hitpoints: 25 } }
		]);
	});

	it('mixes nights and meds over several days, and a driver back from a second run is injured again from full HP', () => {
		const { campaign, warrior, interceptor, mechanic, raider } = newCompound({ meds: 2 });
		const seen: string[] = [];
		const dawn = (): void => {
			endDay({ campaign });
			seen.push(`day ${campaign.day}: ${[warrior, interceptor, mechanic].map(driver => `${driver.status} ${driver.injuredDays} ${driver.hitpoints}`).join(', ')}; meds ${campaign.resources.meds}`);
		};

		// Day 1: the Road Warrior and the Mechanic come home badly hurt
		comeHome({ campaign, seats: [[warrior, 9], [mechanic, 2]] });
		dawn();
		// Day 2: a med for the Road Warrior, and the Interceptor and the Raider go out
		treatDriver({ campaign, driver: warrior });
		comeHome({ campaign, seats: [[interceptor, 14], [raider, 33]] });
		dawn();
		// Day 3: the last med for the Mechanic, fit straight away
		treatDriver({ campaign, driver: mechanic });
		dawn();
		dawn();

		expect(seen).toEqual([
			'day 2: injured 3 9, ready 0 25, injured 2 2; meds 2',
			'day 3: injured 1 9, injured 1 14, injured 1 2; meds 1',
			'day 4: ready 0 40, ready 0 25, ready 0 30; meds 0',
			'day 5: ready 0 40, ready 0 25, ready 0 30; meds 0'
		]);
		expect(conditionOf(raider)).toEqual({ status: 'ready', injuredDays: 0, hitpoints: 33 });

		comeHome({ campaign, seats: [[warrior, 25], [interceptor, 25]] });
		expect(conditionOf(warrior)).toEqual({ status: 'injured', injuredDays: 2, hitpoints: 25 });
		expect(interceptor.status).toBe('ready');
	});

	it('heals a driver the same whether the last day comes off by night or by meds', () => {
		const byNight = newCompound();
		const byMeds = newCompound();
		[byNight, byMeds].forEach(({ campaign, raider }) => comeHome({ campaign, seats: [[raider, 13]] }));

		endDay({ campaign: byNight.campaign });
		endDay({ campaign: byNight.campaign });
		treatDriver({ campaign: byMeds.campaign, driver: byMeds.raider, days: 2 });

		expect(conditionOf(byMeds.raider)).toEqual(conditionOf(byNight.raider));
		expect(conditionOf(byNight.raider)).toEqual({ status: 'ready', injuredDays: 0, hitpoints: 33 });
	});

	it('shares one step for a day off, which keeps the HP until the last day and then fills it', () => {
		const { campaign, raider } = newCompound();
		comeHome({ campaign, seats: [[raider, 2]] });

		expect(healingChanges({ driver: raider, days: 1 })).toEqual({ injuredDays: 3 });
		expect(healingChanges({ driver: raider, days: 4 })).toEqual({ injuredDays: 0, status: 'ready', hitpoints: 33 });
	});
});

describe('treating a driver with meds', () => {
	it('spends a med from the stores to take a day off, keeping their HP, and says what it spent', () => {
		const { campaign, warrior } = newCompound();
		comeHome({ campaign, seats: [[warrior, 5]] });
		const stores = campaign.resources;

		const spent = treatDriver({ campaign, driver: warrior });

		expect(spent).toBe(1);
		expect(conditionOf(warrior)).toEqual({ status: 'injured', injuredDays: 3, hitpoints: 5 });
		expect(campaign.resources).toEqual({ ...stores, meds: 2 });
	});

	it('brings a driver fit straight away with their last day bought, at full HP, so they can be seated today', () => {
		const { campaign, warrior, interceptor } = newCompound();
		comeHome({ campaign, seats: [[warrior, 25]] });
		expect(getSeatBlocker({ campaign, driver: warrior, partner: interceptor })).toEqual({ reason: 'injured', injuredDays: 2 });

		expect(treatDriver({ campaign, driver: warrior, days: 2 })).toBe(2);

		expect(conditionOf(warrior)).toEqual({ status: 'ready', injuredDays: 0, hitpoints: 40 });
		expect(getSeatBlocker({ campaign, driver: warrior, partner: interceptor })).toBeNull();
		expect(campaign.resources.meds).toBe(1);
	});

	it('costs what the rules say a day costs', () => {
		const { campaign, mechanic } = newCompound({ meds: 7 });
		const rules = rulesWith({ medsPerDay: 2 });
		comeHome({ campaign, seats: [[mechanic, 1]] });

		expect(treatmentCost({ days: 2, rules })).toBe(4);
		expect(treatDriver({ campaign, driver: mechanic, days: 2, rules })).toBe(4);
		expect([campaign.resources.meds, mechanic.injuredDays]).toEqual([3, 1]);
		expect(getTreatmentBlocker({ campaign, driver: mechanic, rules })).toBeNull();
		expect(getTreatmentBlocker({ campaign, driver: mechanic, rules: rulesWith({ medsPerDay: 4 }) })).toEqual({ reason: 'too_few_meds', needed: 4, held: 3 });
	});

	it('stores the record first and the campaign last, in one change, so a campaign listener sees the whole treatment', () => {
		const { campaign, warrior } = newCompound();
		comeHome({ campaign, seats: [[warrior, 30]] });
		const seen: string[] = [];
		warrior.on('change', () => seen.push(`record: ${warrior.status}, meds ${campaign.resources.meds}`));
		campaign.on('change', () => seen.push(`campaign: ${warrior.status}, meds ${campaign.resources.meds}`));

		treatDriver({ campaign, driver: warrior });

		expect(seen).toEqual(['record: ready, meds 3', 'campaign: ready, meds 2']);
	});

	describe('refuses, with the reason, changing nothing', () => {
		it.each<[string, (compound: ReturnType<typeof newCompound>) => DriverRecord, number, TreatmentBlocker, string]>([
			['a driver who isn\'t hurt', ({ interceptor }) => interceptor, 1,
				{ reason: 'not_injured', status: 'ready' }, "Interceptor 1 (driver-2) is ready, not injured, so there's nothing to treat"],
			['a dead driver', ({ interceptor }) => {
				interceptor.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });
				return interceptor;
			}, 1, { reason: 'not_injured', status: 'dead' }, "Interceptor 1 (driver-2) is dead, not injured, so there's nothing to treat"],
			['a missing driver', ({ interceptor }) => {
				interceptor.set({ status: 'missing' });
				return interceptor;
			}, 1, { reason: 'not_injured', status: 'missing' }, "Interceptor 1 (driver-2) is missing, not injured, so there's nothing to treat"],
			['more days than are left', ({ warrior }) => warrior, 3,
				{ reason: 'too_many_days', injuredDays: 2 }, "Road Warrior 1 (driver-1) is fit in 2 days, so meds can't take 3 days off"],
			['more meds than the stores hold', ({ campaign, warrior }) => {
				campaign.set({ resources: { ...campaign.resources, meds: 1 } });
				return warrior;
			}, 2, { reason: 'too_few_meds', needed: 2, held: 1 }, "Taking 2 days off Road Warrior 1 (driver-1)'s injury takes 2 meds, and the stores hold 1"]
		])('%s', (_label, choose, days, blocker, message) => {
			const compound = newCompound();
			const { campaign, warrior } = compound;
			comeHome({ campaign, seats: [[warrior, 25]] });
			const driver = choose(compound);
			const before = savedText(campaign);

			expect(getTreatmentBlocker({ campaign, driver, days })).toEqual(blocker);
			let thrown: unknown;
			try {
				treatDriver({ campaign, driver, days });
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(TreatmentRuleError);
			expect(thrown).toBeInstanceOf(RangeError);
			expect((thrown as TreatmentRuleError).message).toBe(message);
			expect((thrown as TreatmentRuleError).blocker).toEqual(blocker);
			expect(savedText(campaign)).toBe(before);
		});

		it('in order: not injured before too many days, and too many days before too few meds', () => {
			const { campaign, warrior, interceptor } = newCompound({ meds: 0 });
			comeHome({ campaign, seats: [[warrior, 39]] });

			expect(getTreatmentBlocker({ campaign, driver: interceptor, days: 5 })).toEqual({ reason: 'not_injured', status: 'ready' });
			expect(getTreatmentBlocker({ campaign, driver: warrior, days: 5 })).toEqual({ reason: 'too_many_days', injuredDays: 1 });
			expect(getTreatmentBlocker({ campaign, driver: warrior })).toEqual({ reason: 'too_few_meds', needed: 1, held: 0 });
		});
	});

	it.each([
		['0 days', 0, 'days must be an integer >= 1, got 0'],
		['part of a day', 1.5, 'days must be an integer >= 1, got 1.5']
	])('throws on %s from the check and the treatment, as a bug rather than a reason', (_label, days, message) => {
		const { campaign, warrior } = newCompound();
		comeHome({ campaign, seats: [[warrior, 5]] });

		expect(() => getTreatmentBlocker({ campaign, driver: warrior, days })).toThrow(message);
		expect(() => treatDriver({ campaign, driver: warrior, days })).toThrow(message);
		expect(campaign.resources.meds).toBe(3);
	});

	it('throws on a driver from another campaign', () => {
		const { campaign } = newCompound();
		const { warrior: stranger } = newCompound();

		expect(() => getTreatmentBlocker({ campaign, driver: stranger })).toThrow("Road Warrior 1 (driver-1) isn't in this campaign's pool");
		expect(() => treatDriver({ campaign, driver: stranger })).toThrow("Road Warrior 1 (driver-1) isn't in this campaign's pool");
	});
});

describe('saves', () => {
	it('keep an injured driver\'s HP and days, and a loaded campaign heals and treats as the original does', async () => {
		const { campaign, warrior, interceptor } = newCompound();
		comeHome({ campaign, seats: [[warrior, 7], [interceptor, 11]] });
		endDay({ campaign });
		treatDriver({ campaign, driver: warrior });
		const storage = new MemorySaveStorage();
		await new CampaignStore({ storage, namespace: 'infirmary', onWarning: () => undefined }).save(campaign);

		const loaded = await new CampaignStore({ storage, namespace: 'infirmary', onWarning: () => undefined }).load();
		if (!loaded) throw new Error('the save should load');
		const [loadedWarrior, loadedInterceptor] = loaded.drivers;
		expect(conditionOf(loadedWarrior)).toEqual({ status: 'injured', injuredDays: 2, hitpoints: 7 });
		expect(conditionOf(loadedInterceptor)).toEqual({ status: 'injured', injuredDays: 1, hitpoints: 11 });
		expect(loaded.resources.meds).toBe(2);
		expect(savedText(loaded)).toBe(savedText(campaign));

		const both: [Campaign, DriverRecord][] = [[campaign, warrior], [loaded, loadedWarrior]];
		both.forEach(([compound, driver]) => {
			endDay({ campaign: compound });
			treatDriver({ campaign: compound, driver });
			endDay({ campaign: compound });
		});
		expect(savedText(loaded)).toBe(savedText(campaign));
		expect(conditionOf(loadedWarrior)).toEqual({ status: 'ready', injuredDays: 0, hitpoints: 40 });
		expect(conditionOf(loadedInterceptor)).toEqual({ status: 'ready', injuredDays: 0, hitpoints: 25 });
	});
});

/**
 * A founded campaign through `days` day ends, scripted on `script`: meds
 * spent on someone some mornings (asking for one day too many now and then),
 * a run most days with two drivers load out would seat, coming home at any
 * HP the bridge could write back, and meds found some days. Every step is
 * checked against a plain model of the rules: injured for the HP missing
 * over 10, a day off a night or a med, and ready at full HP with none left.
 */
function playInfirmary({ campaign, script, days }: { campaign: Campaign; script: Rng; days: number }): { treated: number; injured: number; healed: number } {
	const model = new Map(campaign.drivers.map(driver => [driver.id, conditionOf(driver)]));
	let meds = campaign.resources.meds;
	const counts = { treated: 0, injured: 0, healed: 0 };
	const checkModel = (): void => {
		campaign.drivers.forEach(driver => expect(conditionOf(driver)).toEqual(model.get(driver.id)));
		expect(campaign.resources.meds).toBe(meds);
	};
	const takeDays = (driver: DriverRecord, taken: number): void => {
		const was = model.get(driver.id) as Condition;
		model.set(driver.id, was.injuredDays > taken
			? { ...was, injuredDays: was.injuredDays - taken }
			: { status: 'ready', injuredDays: 0, hitpoints: driver.maxHitpoints });
	};

	for (let day = 0; day < days; day++) {
		const injured = campaign.drivers.filter(driver => driver.status === 'injured');
		if (injured.length > 0 && script.int(0, 1) === 0) {
			const driver = script.pick(injured);
			const asked = script.int(1, driver.injuredDays + 1);
			const blocker = getTreatmentBlocker({ campaign, driver, days: asked });
			if (blocker === null) {
				expect(treatDriver({ campaign, driver, days: asked })).toBe(asked);
				meds -= asked;
				takeDays(driver, asked);
				counts.treated++;
			} else {
				expect(asked > driver.injuredDays || meds < asked).toBe(true);
				expect(() => treatDriver({ campaign, driver, days: asked })).toThrow(TreatmentRuleError);
			}
		}
		checkModel();

		const seatable = campaign.drivers.filter(driver => getSeatBlocker({ campaign, driver }) === null);
		seatable.forEach(driver => expect(conditionOf(driver)).toEqual({ status: 'ready', injuredDays: 0, hitpoints: driver.maxHitpoints }));
		if (seatable.length >= 2 && script.int(0, 3) > 0) {
			const first = script.pick(seatable);
			const second = script.pick(seatable.filter(driver => getSeatBlocker({ campaign, driver, partner: first }) === null));
			const seats = [first, second].map(driver => [driver, script.int(1, driver.maxHitpoints)] as [DriverRecord, number]);
			seats.forEach(([driver, hitpoints]) => driver.set({ hitpoints }));
			const injuries = injureOnArrival({ campaign, drivers: [first, second] });
			seats.forEach(([driver, hitpoints]) => {
				const days = Math.ceil((driver.maxHitpoints - hitpoints) / 10);
				model.set(driver.id, days > 0 ? { status: 'injured', injuredDays: days, hitpoints } : { status: 'ready', injuredDays: 0, hitpoints });
			});
			counts.injured += injuries.length;
		}
		checkModel();

		if (script.int(0, 4) === 0) {
			const found = script.int(1, 3);
			campaign.set({ resources: { ...campaign.resources, meds: campaign.resources.meds + found } });
			meds += found;
		}
		const nightBefore = campaign.drivers.filter(driver => driver.status === 'injured');
		const { healed } = endDay({ campaign });
		nightBefore.forEach(driver => takeDays(driver, 1));
		expect(healed.map(driver => driver.id)).toEqual(nightBefore.filter(driver => driver.status === 'ready').map(driver => driver.id));
		counts.healed += healed.length;
		checkModel();
	}
	return counts;
}

describe('the infirmary over a campaign', () => {
	const founded = (): Campaign => {
		const campaign = foundCampaign({ seed: SEED, unlockedArchetypes: ['road_warrior', 'interceptor', 'mechanic', 'raider'] });
		campaign.set({ resources: { ...campaign.resources, food: 1000, water: 1000 } });
		return campaign;
	};

	it('keeps injuries, meds, seating, and the day clock in step for 120 days of runs, treatments, and rests', () => {
		const campaign = founded();

		const counts = playInfirmary({ campaign, script: new Rng({ seed: SEED }).fork('infirmary'), days: 120 });

		expect(campaign.day).toBe(121);
		// The script has to have done each thing often enough to have tested it.
		expect(counts.injured).toBeGreaterThan(60);
		expect(counts.treated).toBeGreaterThan(10);
		expect(counts.healed).toBeGreaterThan(30);
		expect(savedText(reload(campaign))).toBe(savedText(campaign));
	});

	it('plays on the same from a save as from the campaign that made it, without Math.random', () => {
		const random = jest.spyOn(Math, 'random');
		try {
			const campaign = founded();
			playInfirmary({ campaign, script: new Rng({ seed: 7 }), days: 40 });
			const loaded = reload(campaign);

			playInfirmary({ campaign, script: new Rng({ seed: 8 }), days: 40 });
			playInfirmary({ campaign: loaded, script: new Rng({ seed: 8 }), days: 40 });

			expect(random).not.toHaveBeenCalled();
			expect(savedText(loaded)).toBe(savedText(campaign));
		} finally {
			random.mockRestore();
		}
	});
});
