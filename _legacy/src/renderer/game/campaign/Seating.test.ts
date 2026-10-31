import { resolveMapParams } from '../map/MapParams';
import { Campaign } from './Campaign';
import { CAMPAIGN_START } from './CampaignStart';
import { endDay } from './DayClock';
import { DriverRecord } from './DriverRecord';
import { injureOnArrival, treatDriver } from './Infirmary';
import { getSeatBlocker } from './Seating';

const SEED = 20261008;

/** A compound with a Road Warrior (40 HP), an Interceptor, and a Mechanic, and the founding stores. */
function newCompound(): { campaign: Campaign; warrior: DriverRecord; interceptor: DriverRecord; mechanic: DriverRecord } {
	const campaign = new Campaign({
		seed: SEED,
		generatorVersion: 1,
		mapParams: resolveMapParams({ seed: SEED, environment: 'mixed' }).params,
		resources: CAMPAIGN_START.resources
	});
	const [warrior, interceptor, mechanic] = (['road_warrior', 'interceptor', 'mechanic'] as const).map(archetype => campaign.recruitDriver({ archetype }));
	return { campaign, warrior, interceptor, mechanic };
}

/** Home from a run at `hitpoints`, and checked in at the infirmary. */
function comeHome({ campaign, driver, hitpoints }: { campaign: Campaign; driver: DriverRecord; hitpoints: number }): void {
	driver.set({ hitpoints });
	injureOnArrival({ campaign, drivers: [driver] });
}

describe('getSeatBlocker', () => {
	it('seats a ready driver, alone or beside another archetype', () => {
		const { campaign, warrior, interceptor } = newCompound();

		expect(getSeatBlocker({ campaign, driver: warrior })).toBeNull();
		expect(getSeatBlocker({ campaign, driver: warrior, partner: interceptor })).toBeNull();
		expect(getSeatBlocker({ campaign, driver: interceptor, partner: warrior })).toBeNull();
	});

	it('refuses an injured driver with the days until they\'re fit, for load out\'s "Injured, fit in 2 days", until nights heal them', () => {
		const { campaign, warrior, interceptor } = newCompound();
		comeHome({ campaign, driver: warrior, hitpoints: 22 });

		expect(getSeatBlocker({ campaign, driver: warrior })).toEqual({ reason: 'injured', injuredDays: 2 });
		expect(getSeatBlocker({ campaign, driver: warrior, partner: interceptor })).toEqual({ reason: 'injured', injuredDays: 2 });
		endDay({ campaign });
		expect(getSeatBlocker({ campaign, driver: warrior })).toEqual({ reason: 'injured', injuredDays: 1 });
		endDay({ campaign });
		expect(getSeatBlocker({ campaign, driver: warrior })).toBeNull();
	});

	it('seats an injured driver once meds have bought their last day', () => {
		const { campaign, warrior, interceptor } = newCompound();
		comeHome({ campaign, driver: warrior, hitpoints: 30 });

		treatDriver({ campaign, driver: warrior });

		expect(getSeatBlocker({ campaign, driver: warrior, partner: interceptor })).toBeNull();
	});

	it.each([
		['dead', { status: 'dead', hitpoints: 0, defaultDeck: {} }],
		['missing', { status: 'missing' }]
	] as const)('refuses a %s driver as away', (status, changes) => {
		const { campaign, mechanic } = newCompound();
		mechanic.set(changes);

		expect(getSeatBlocker({ campaign, driver: mechanic })).toEqual({ reason: 'driver_away', status });
	});

	it('refuses the archetype the other seat already holds, naming who holds it', () => {
		const { campaign, warrior } = newCompound();
		const second = campaign.recruitDriver({ archetype: 'road_warrior' });

		expect(getSeatBlocker({ campaign, driver: second, partner: warrior })).toEqual({ reason: 'same_archetype', archetype: 'road_warrior', partner: warrior });
	});

	it('refuses the driver who holds the other seat as already seated, not as their own partner', () => {
		const { campaign, warrior } = newCompound();

		expect(getSeatBlocker({ campaign, driver: warrior, partner: warrior })).toEqual({ reason: 'already_seated' });
	});

	it('says injured before same archetype, since that\'s the reason that lasts', () => {
		const { campaign, warrior } = newCompound();
		const second = campaign.recruitDriver({ archetype: 'road_warrior' });
		comeHome({ campaign, driver: second, hitpoints: 39 });

		expect(getSeatBlocker({ campaign, driver: second, partner: warrior })).toEqual({ reason: 'injured', injuredDays: 1 });
	});

	it('says injured or away before already seated', () => {
		const { campaign, warrior, mechanic } = newCompound();
		comeHome({ campaign, driver: warrior, hitpoints: 39 });
		mechanic.set({ status: 'missing' });

		expect(getSeatBlocker({ campaign, driver: warrior, partner: warrior })).toEqual({ reason: 'injured', injuredDays: 1 });
		expect(getSeatBlocker({ campaign, driver: mechanic, partner: mechanic })).toEqual({ reason: 'driver_away', status: 'missing' });
	});

	it('throws on a driver or partner from outside the pool', () => {
		const { campaign, warrior } = newCompound();
		const stranger = new DriverRecord({ id: 'driver-9', archetype: 'mechanic', name: 'Mechanic 1' });

		expect(() => getSeatBlocker({ campaign, driver: stranger })).toThrow("Mechanic 1 (driver-9) isn't in this campaign's pool");
		expect(() => getSeatBlocker({ campaign, driver: warrior, partner: stranger })).toThrow("Mechanic 1 (driver-9) isn't in this campaign's pool");
	});
});
