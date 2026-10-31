import { NO_RESOURCES } from '../../campaign/Campaign';
import { NO_CARDS } from '../../campaign/CardCounts';
import type { EventFight, EventGains, EventResult } from '../../campaign/Events';
import {
	bandText,
	driversText,
	eventKicker,
	fightText,
	gainLines,
	goLabel,
	hoursText,
	hpText,
	lockText,
	needText,
	paidText,
	resultLines,
	settlersText,
	structureText,
} from './eventText';

const NO_NEED = { archetype: null, card: null, escort: null };
const NOTHING: EventGains = { resources: NO_RESOURCES, cards: NO_CARDS, cardPick: false, escort: null, drivers: 0, structure: 0, hp: 0 };

function fight(gains: Partial<EventGains> = {}): EventFight {
	return { ...NOTHING, ...gains, skulls: 2, text: 'Won.' };
}

describe('eventText (DDB-45)', () => {
	it('names what a choice needs, joined, and nothing for none', () => {
		expect(needText({ ...NO_NEED, archetype: 'mechanic' })).toBe('Mechanic only');
		expect(needText({ ...NO_NEED, card: 'emp_blast' })).toBe('Requires: EMP Blast');
		expect(needText({ ...NO_NEED, escort: 'med_truck' })).toBe('Med Truck');
		expect(needText({ archetype: 'road_warrior', card: 'emp_blast', escort: null })).toBe('Road Warrior only + Requires: EMP Blast');
		expect(needText(NO_NEED)).toBe('');
	});

	it('says why a choice is locked, and keeps a met need beside a shortfall in the band', () => {
		expect(lockText({ reason: 'archetype', archetype: 'interceptor' })).toBe('Interceptor only');
		expect(lockText({ reason: 'card', cardType: 'emp_blast' })).toBe('Requires: EMP Blast');
		expect(lockText({ reason: 'escort', escort: 'med_truck' })).toBe('Needs a Med Truck');
		expect(lockText({ reason: 'escort', escort: 'outrider' })).toBe('Needs an Outrider');
		expect(lockText({ reason: 'cost', resource: 'fuel', needed: 5, held: 2 })).toBe('Need 5 fuel, have 2');
		const shortfall = { reason: 'cost', resource: 'scrap', needed: 8, held: 5 } as const;
		expect(bandText({ requirement: { ...NO_NEED, archetype: 'mechanic' }, lock: shortfall })).toBe('Mechanic / Need 8 scrap, have 5');
		expect(bandText({ requirement: NO_NEED, lock: shortfall })).toBe('Need 8 scrap, have 5');
		expect(bandText({ requirement: { ...NO_NEED, archetype: 'mechanic' }, lock: { reason: 'archetype', archetype: 'mechanic' } })).toBe('Mechanic only');
		expect(bandText({ requirement: { ...NO_NEED, escort: 'med_truck' }, lock: null })).toBe('Med Truck');
	});

	it('words counts and signs', () => {
		expect(hoursText(1.5)).toBe('1.5 h');
		expect(hoursText(0.5, { sign: true })).toBe('+0.5 h');
		expect(settlersText(1)).toBe('A settler joins you');
		expect(settlersText(3)).toBe('3 settlers join you');
		expect(driversText(1)).toBe('A driver joins the pool at home');
		expect(driversText(2)).toBe('2 drivers join the pool at home');
		expect(structureText(-3)).toBe('Structure -3 on each vehicle');
		expect(structureText(2)).toBe('Structure +2 on each vehicle');
		expect(hpText(-2)).toBe('HP -2 for each driver');
		expect(hpText(4)).toBe('HP +4 for each driver');
		expect(paidText({ ...NO_RESOURCES, fuel: 3, scrap: 2 })).toBe('Paid 3 fuel, 2 scrap');
		expect(paidText(NO_RESOURCES)).toBeNull();
	});

	it('splits gains from losses, each in its tone', () => {
		const lines = gainLines({ ...NOTHING, resources: { ...NO_RESOURCES, fuel: 3, scrap: -2, people: 2 }, drivers: 1, cardPick: true, structure: -3, hp: 4 });
		expect(lines).toEqual([
			{ icon: 'fuel', text: '+3 fuel', tone: 'gain' },
			{ icon: 'scrap', text: '-2 scrap', tone: 'cost' },
			{ icon: 'people', text: '2 settlers join you', tone: 'gain' },
			{ icon: 'driver', text: 'A driver joins the pool at home', tone: 'gain' },
			{ icon: 'cards', text: 'Pick a card for the locker', tone: 'gain' },
			{ icon: 'repair', text: 'Structure -3 on each vehicle', tone: 'cost' },
			{ icon: 'heal', text: 'HP +4 for each driver', tone: 'gain' },
		]);
		expect(gainLines(NOTHING)).toEqual([]);
	});

	it('lists a result in order: the cost, what it gave and took, the hours, then the fight', () => {
		const result: EventResult = {
			event: 'e',
			choice: 'c',
			cost: { ...NO_RESOURCES, fuel: 3 },
			outcome: { ...NOTHING, text: 'Done.', resources: { ...NO_RESOURCES, scrap: 4 }, hours: 1, fight: fight({ resources: { ...NO_RESOURCES, food: 2 } }) },
		};
		expect(resultLines(result).map(({ icon, text, tone }) => `${icon}|${text}|${tone}`)).toEqual([
			'fuel|Paid 3 fuel|cost',
			'scrap|+4 scrap|gain',
			'clock|+1 h at the stop|ink',
			'swords|Raiders, 2 skulls. Win, and: +2 food.|cost',
		]);
	});

	it('hands off a fight without spoiling it, naming its prize: gains, cards, an escort', () => {
		expect(fightText(fight())).toBe('Raiders, 2 skulls.');
		expect(fightText(fight({ cards: { armor_plating: 2, medical_kit: 1 } }))).toBe('Raiders, 2 skulls. Win, and: 2 Armor Plating; Medical Kit.');
		expect(fightText(fight({ escort: 'outrider', resources: { ...NO_RESOURCES, people: 1 } }))).toBe('Raiders, 2 skulls. Win, and: A settler joins you; an Outrider.');
	});

	it('labels the highway for where it goes, and the kicker by the stop type', () => {
		expect(goLabel({ fight: true, cardPick: true })).toBe('Fight them');
		expect(goLabel({ fight: false, cardPick: true })).toBe('Pick a card');
		expect(goLabel({ fight: false, cardPick: false })).toBe('Drive on');
		expect(eventKicker('wreck')).toBe('Wreck');
		expect(eventKicker('distress')).toBe('Distress signal');
	});
});
