import type { Campaign } from '../../campaign/Campaign';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { atHomeCampaign } from '../../campaign/__fixtures__/storeFixtures';
import { LoadOutPlan } from './LoadOutPlan';

/**
 * The fixture home from its run: Road Warrior 1 and Interceptor 2 ready,
 * Mechanic 1 injured for two days, Interceptor 1 dead and Road Warrior 2
 * missing, and two escorts, the Fuel Hauler and the Outrider.
 */
function home(change: (campaign: Campaign) => void = () => undefined): { campaign: Campaign; plan: LoadOutPlan; changed: jest.Mock; named: (name: string) => DriverRecord } {
	const campaign = atHomeCampaign(change);
	const changed = jest.fn();
	const named = (name: string): DriverRecord => {
		const driver = campaign.drivers.find((record) => record.name === name);
		if (!driver) throw new Error(`no ${name}`);
		return driver;
	};
	return { campaign, plan: new LoadOutPlan({ campaign, changed }), changed, named };
}

const readyAgain = (name: string) => (campaign: Campaign): void => {
	campaign.drivers.find((driver) => driver.name === name)?.set({ status: 'ready', injuredDays: 0 });
};

describe('LoadOutPlan (DDB-320)', () => {
	it('opens on the crew the quick load out would send and every escort, with nothing started', () => {
		const { campaign, plan, named } = home();
		expect(plan.seats).toEqual([named('Road Warrior 1'), named('Interceptor 2')]);
		expect(plan.seatsNeeded).toBe(2);
		expect(plan.escorts).toEqual(campaign.convoy.escorts);
		expect(plan.started).toBe(false);
		expect(plan.startBlocker).toBeNull();
	});

	it('lists every driver at the compound in the pool, the dead and missing left out, with where each stands', () => {
		const { plan, named } = home();
		expect(plan.pool.map(({ name }) => name)).toEqual(['Road Warrior 1', 'Mechanic 1', 'Interceptor 2']);
		expect(plan.standing(named('Road Warrior 1'))).toEqual({ kind: 'seated', seat: 0 });
		expect(plan.standing(named('Mechanic 1'))).toEqual({ kind: 'blocked', blocker: { reason: 'injured', injuredDays: 2 } });
	});

	it('seats a free driver in the first free seat, and waits on a full pair', () => {
		const { plan, named } = home(readyAgain('Mechanic 1'));
		expect(plan.seats).toEqual([named('Road Warrior 1'), named('Mechanic 1')]);
		expect(plan.standing(named('Interceptor 2'))).toEqual({ kind: 'seats_full' });
		plan.clear(0);
		expect(plan.seats).toEqual([null, named('Mechanic 1')]);
		expect(plan.startBlocker).toEqual({ reason: 'seat_empty', needed: 2 });
		expect(plan.standing(named('Interceptor 2'))).toEqual({ kind: 'free' });
		plan.seat(named('Interceptor 2'));
		expect(plan.seats).toEqual([named('Interceptor 2'), named('Mechanic 1')]);
		expect(plan.startBlocker).toBeNull();
	});

	it('keeps a second of a seated archetype out while a mixed pair can go', () => {
		const { plan, named } = home(readyAgain('Road Warrior 2'));
		plan.clear(1);
		expect(plan.standing(named('Road Warrior 2'))).toEqual({
			kind: 'blocked',
			blocker: { reason: 'same_archetype', archetype: 'road_warrior', partner: named('Road Warrior 1') },
		});
		plan.seat(named('Road Warrior 2'));
		expect(plan.seats[1]).toBeNull();
	});

	it('seats one driver alone when only one is ready (gameplay call 35)', () => {
		const { campaign, plan, named } = home((campaign) => campaign.drivers.find((driver) => driver.name === 'Interceptor 2')?.set({ status: 'injured', injuredDays: 1 }));
		expect(plan.seatsNeeded).toBe(1);
		expect(plan.seats).toEqual([named('Road Warrior 1'), null]);
		expect(plan.startBlocker).toBeNull();
		plan.start();
		expect(campaign.runDecks.map(({ driver }) => driver)).toEqual([named('Road Warrior 1')]);
	});

	it('says nobody can go when nobody is ready', () => {
		const { plan } = home((campaign) => campaign.drivers.forEach((driver) => {
			if (driver.status === 'ready') driver.set({ status: 'injured', injuredDays: 1 });
		}));
		expect(plan.seats).toEqual([null, null]);
		expect(plan.startBlocker).toEqual({ reason: 'no_crew' });
		expect(plan.canCustomize(0)).toBe(false);
		expect(() => plan.start()).toThrow("Load out can't start run decks: no_crew");
	});

	it('starts the run decks once, the escorts\' cards with Driver 1, and gives them up on Back', () => {
		const { campaign, plan, changed, named } = home();
		plan.start();
		plan.start();
		expect(changed).toHaveBeenCalledTimes(1);
		expect(campaign.runDecks.map(({ driver }) => driver)).toEqual([named('Road Warrior 1'), named('Interceptor 2')]);
		expect(plan.runDeckAt(0)?.escortCards.map(({ broughtBy }) => broughtBy)).toEqual(['escort-1', 'escort-3']);
		plan.giveUp();
		expect(plan.started).toBe(false);
		expect(campaign.currentRun).toBeNull();
		expect(changed).toHaveBeenCalledTimes(2);
	});

	it('leaves an escort at home and brings it back, its card following in place once the decks are out', () => {
		const { campaign, plan } = home();
		const [hauler] = campaign.convoy.escorts;
		plan.toggleEscort(hauler);
		expect(plan.isStaying(hauler)).toBe(true);
		plan.start();
		expect(plan.runDeckAt(0)?.escortCards.map(({ broughtBy }) => broughtBy)).toEqual(['escort-3']);
		plan.toggleEscort(hauler);
		expect(plan.escorts).toEqual(campaign.convoy.escorts);
		expect(plan.runDeckAt(0)?.escortCards.map(({ broughtBy }) => broughtBy)).toEqual(['escort-1', 'escort-3']);
	});

	it('gives the decks up when a seat empties, and swaps the seats by starting them again in the new order', () => {
		const { campaign, plan, named } = home(readyAgain('Mechanic 1'));
		plan.start();
		plan.clear(1);
		expect(plan.started).toBe(false);
		plan.seat(named('Mechanic 1'));
		expect(plan.started).toBe(false);
		plan.start();
		expect(campaign.runDecks.map(({ driver }) => driver)).toEqual([named('Road Warrior 1'), named('Mechanic 1')]);
		expect(plan.canSwap).toBe(true);
		plan.swap();
		expect(plan.seats).toEqual([named('Mechanic 1'), named('Road Warrior 1')]);
		expect(campaign.runDecks.map(({ driver }) => driver)).toEqual([named('Mechanic 1'), named('Road Warrior 1')]);
		expect(plan.runDeckAt(0)?.escortCards).toHaveLength(2);
	});

	it('takes run decks already out as its own: their drivers seated, and the escorts whose cards they hold coming', () => {
		const { campaign } = home();
		const [hauler, outrider] = campaign.convoy.escorts;
		const [first, second] = new LoadOutPlan({ campaign }).seats as DriverRecord[];
		campaign.startRunDecks({ seats: [second, first], escorts: [outrider] });
		const plan = new LoadOutPlan({ campaign });
		expect(plan.seats).toEqual([second, first]);
		expect(plan.isStaying(hauler)).toBe(true);
		expect(plan.escorts).toEqual([outrider]);
		expect(plan.canCustomize(0)).toBe(true);
	});
});
