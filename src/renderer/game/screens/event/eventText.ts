import type { Resources } from '../../campaign/Campaign';
import { cardName } from '../../campaign/DeckRules';
import { ChoiceLock, EVENT_RESOURCES, EventFight, EventGains, EventRequirement, EventResult } from '../../campaign/Events';
import { STOP_TUNING, StopType } from '../../map/StopData';
import type { DriverArchetype } from '../../mechanics/Driver';
import { ESCORT_CONFIGS, EscortType } from '../../mechanics/Escort';
import { countOf } from '../main-menu/campaignText';
import type { EventIconKind, EventIconTone } from './EventIcon';

/** What the event screen says, kept apart from the screen so its tests read the same strings. */

const ARCHETYPE_NAMES: Readonly<Record<DriverArchetype, string>> = {
	road_warrior: 'Road Warrior',
	interceptor: 'Interceptor',
	mechanic: 'Mechanic',
	raider: 'Raider',
};

export function archetypeName(archetype: DriverArchetype): string {
	return ARCHETYPE_NAMES[archetype];
}

/** "a Med Truck", "an Outrider". */
function anEscort(escort: EscortType): string {
	const name = ESCORT_CONFIGS[escort].name;
	return `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
}

/** The stop's kind over the title: "Wreck", "Distress signal". */
export function eventKicker(stopType: StopType): string {
	return STOP_TUNING.types[stopType].label;
}

/** What a choice needs, on its card: "Mechanic only", "Requires: EMP Blast", "Med Truck". Empty for none. */
export function needText({ archetype, card, escort }: EventRequirement): string {
	const needs: string[] = [];
	if (archetype !== null) needs.push(`${archetypeName(archetype)} only`);
	if (card !== null) needs.push(`Requires: ${cardName(card)}`);
	if (escort !== null) needs.push(ESCORT_CONFIGS[escort].name);
	return needs.join(' + ');
}

/** Why a choice is locked: "Need 5 fuel, have 2". */
export function lockText(lock: ChoiceLock): string {
	switch (lock.reason) {
		case 'archetype': return `${archetypeName(lock.archetype)} only`;
		case 'card': return `Requires: ${cardName(lock.cardType)}`;
		case 'escort': return `Needs ${anEscort(lock.escort)}`;
		case 'cost': return `Need ${lock.needed} ${lock.resource}, have ${lock.held}`;
	}
}

/**
 * A card's band: what the choice needs, and when it's locked, why. A need
 * the party lacks is the lock itself, so it shows once; a need it meets
 * stays beside a shortfall, named short so both fit a card at 1024 wide:
 * "Mechanic / Need 8 scrap, have 5".
 */
export function bandText({ requirement, lock }: { requirement: EventRequirement; lock: ChoiceLock | null }): string {
	if (lock === null) return needText(requirement);
	if (lock.reason !== 'cost') return lockText(lock);
	const { archetype, card, escort } = requirement;
	const met = [archetype && archetypeName(archetype), card && cardName(card), escort && ESCORT_CONFIGS[escort].name].filter((part): part is string => Boolean(part));
	return [...met, lockText(lock)].join(' / ');
}

/** "1.5 h", "+1.5 h" with `sign`. */
export function hoursText(hours: number, { sign = false }: { sign?: boolean } = {}): string {
	return `${sign ? '+' : ''}${hours} h`;
}

/** Resources in file order, signed: "+3 fuel, +6 scrap". Only those `keep` picks; settlers are their own line. */
export function resourcesText(resources: Readonly<Resources>, keep: (amount: number) => boolean = (amount) => amount !== 0): string {
	return EVENT_RESOURCES
		.filter((resource) => resources[resource] !== 0 && keep(resources[resource]))
		.map((resource) => `${resources[resource] > 0 ? '+' : ''}${resources[resource]} ${resource}`)
		.join(', ');
}

/** "3 settlers join you" */
export function settlersText(count: number): string {
	return count === 1 ? 'A settler joins you' : `${count} settlers join you`;
}

/** "A driver joins the pool at home" */
export function driversText(count: number): string {
	return count === 1 ? 'A driver joins the pool at home' : `${count} drivers join the pool at home`;
}

/** "Structure -3 on each vehicle", "Structure +2 on each vehicle" */
export function structureText(amount: number): string {
	return `Structure ${amount > 0 ? '+' : ''}${amount} on each vehicle`;
}

/** "HP -2 for each driver" */
export function hpText(amount: number): string {
	return `HP ${amount > 0 ? '+' : ''}${amount} for each driver`;
}

/** "Paid 3 fuel" */
export function paidText(cost: Readonly<Resources>): string | null {
	const paid = EVENT_RESOURCES.filter((resource) => cost[resource] > 0).map((resource) => `${cost[resource]} ${resource}`);
	return paid.length === 0 ? null : `Paid ${paid.join(', ')}`;
}

/** A ledger line under an outcome: its icon, what it says, and whether it's a cost. */
export interface LedgerLine {
	icon: EventIconKind;
	text: string;
	tone: EventIconTone;
}

/** What an outcome gives or takes, line by line, cards and escorts aside (they're drawn as cards). */
export function gainLines(gains: EventGains): LedgerLine[] {
	const lines: LedgerLine[] = [];
	for (const [keep, tone] of [[(amount: number) => amount > 0, 'gain'], [(amount: number) => amount < 0, 'cost']] as const) {
		const text = resourcesText(gains.resources, keep);
		const first = EVENT_RESOURCES.find((resource) => gains.resources[resource] !== 0 && keep(gains.resources[resource]));
		if (text && first) lines.push({ icon: first, text, tone });
	}
	if (gains.resources.people > 0) lines.push({ icon: 'people', text: settlersText(gains.resources.people), tone: 'gain' });
	if (gains.drivers > 0) lines.push({ icon: 'driver', text: driversText(gains.drivers), tone: 'gain' });
	if (gains.cardPick) lines.push({ icon: 'cards', text: 'Pick a card for the locker', tone: 'gain' });
	if (gains.structure !== 0) lines.push({ icon: 'repair', text: structureText(gains.structure), tone: gains.structure < 0 ? 'cost' : 'gain' });
	if (gains.hp !== 0) lines.push({ icon: 'heal', text: hpText(gains.hp), tone: gains.hp < 0 ? 'cost' : 'gain' });
	return lines;
}

/** Every ledger line a result shows, in order: what it cost, what it gave and took, the hours, and the fight. */
export function resultLines({ cost, outcome }: EventResult): LedgerLine[] {
	const lines: LedgerLine[] = [];
	const paid = paidText(cost);
	const spent = EVENT_RESOURCES.find((resource) => cost[resource] > 0);
	if (paid && spent) lines.push({ icon: spent, text: paid, tone: 'cost' });
	lines.push(...gainLines(outcome));
	if (outcome.hours > 0) lines.push({ icon: 'clock', text: `${hoursText(outcome.hours, { sign: true })} at the stop`, tone: 'ink' });
	if (outcome.fight) lines.push({ icon: 'swords', text: fightText(outcome.fight), tone: 'cost' });
	return lines;
}

/** The hand-off, without spoiling the debrief: "Raiders, 2 skulls. Win, and: +2 food; 3 settlers join you." */
export function fightText(fight: EventFight): string {
	const prize = [...gainLines(fight).map(({ text }) => text), ...Object.entries(fight.cards).map(([cardType, count]) => (count > 1 ? `${count} ${cardName(cardType)}` : cardName(cardType)))];
	if (fight.escort) prize.push(anEscort(fight.escort));
	const head = `Raiders, ${countOf(fight.skulls, 'skull')}.`;
	return prize.length === 0 ? head : `${head} Win, and: ${prize.join('; ')}.`;
}

/** The primary once an outcome's in: into the fight, to the reward picker, or on down the road. */
export function goLabel({ fight, cardPick }: { fight: boolean; cardPick: boolean }): string {
	if (fight) return 'Fight them';
	return cardPick ? 'Pick a card' : 'Drive on';
}
