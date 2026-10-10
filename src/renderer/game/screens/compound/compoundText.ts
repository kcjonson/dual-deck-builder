import type { ScreenName } from '../../core/ScreenManager';
import type { Resources } from '../../campaign/Campaign';
import { UPKEEP_RESOURCES } from '../../campaign/CompoundRules';
import { shortfallMessage } from '../../campaign/DayClock';
import type { DayEnd, NeedForecast, NeedsForecast } from '../../campaign/DayClock';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { countOf } from '../main-menu/campaignText';

export type BuildingId = 'bunkhouse' | 'radio_mast' | 'infirmary' | 'garage' | 'map_room' | 'stores';

/** A building on the compound screen: what it's for, and what its button does or why it can't. */
export interface Building {
	id: BuildingId;
	name: string;
	description: string;
	/** Why it's disabled; null once the screen behind it exists. */
	reason: string | null;
	/** The screen its button opens, handed the campaign on show, once that screen exists. */
	screen?: ScreenName;
}

/**
 * The buildings (Compound and Supply Runs, Buildings) in the wireframe's
 * order, read in rows of three. The bunkhouse opens the Crew screen; none
 * of the other screens behind them exists yet.
 */
export const BUILDINGS: readonly Building[] = [
	{
		id: 'bunkhouse',
		name: 'Bunkhouse',
		description: 'Drivers, settlers, and the Crew screen, where default decks are built.',
		reason: null,
		screen: 'crewScreen',
	},
	{ id: 'radio_mast', name: 'Radio mast', description: 'Rumors: new POIs, and roads into the fog.', reason: "The radio mast isn't built yet." },
	{ id: 'infirmary', name: 'Infirmary', description: 'Injured drivers heal over days; meds speed it up.', reason: "The infirmary isn't built yet." },
	{ id: 'garage', name: 'Garage', description: 'Cards, mods, and escort repair and hire.', reason: "The garage isn't open at home yet." },
	{ id: 'map_room', name: 'Map room', description: 'The area map, to plan a supply run.', reason: "The area map isn't built yet." },
	{ id: 'stores', name: 'Stores', description: 'The resource ledger and its forecast.', reason: "The stores ledger isn't built yet." },
];

/** The top bar's resources, in the wireframe's order. */
export const RESOURCE_ORDER: readonly (keyof Resources)[] = ['food', 'water', 'fuel', 'scrap', 'meds', 'people'];

const RESOURCE_NAMES: Readonly<Record<keyof Resources, string>> = {
	food: 'Food',
	water: 'Water',
	fuel: 'Fuel',
	scrap: 'Scrap',
	meds: 'Meds',
	people: 'People',
};

/** Thousands, millions, and on, for amounts past four digits. */
const AMOUNT_SUFFIXES = ['k', 'M', 'B', 'T', 'Q'];

/**
 * An amount in at most four characters, so the top bar's chips fit at
 * 1024 px whatever the stores hold: whole below 10,000, then rounded down
 * to thousands, millions, and on ("12k", "999k", "1M"), so a chip never
 * shows more than there is.
 */
export function amountText(amount: number): string {
	if (amount < 10_000) return String(amount);
	let scaled = amount / 1000;
	let suffix = 0;
	while (scaled >= 1000 && suffix < AMOUNT_SUFFIXES.length - 1) {
		scaled /= 1000;
		suffix += 1;
	}
	return `${Math.floor(scaled)}${AMOUNT_SUFFIXES[suffix]}`;
}

/** "Food 14", "Scrap 12k". */
export function resourceText({ resource, amount }: { resource: keyof Resources; amount: number }): string {
	return `${RESOURCE_NAMES[resource]} ${amountText(amount)}`;
}

/** The compound between runs is always at dawn (Compound and Supply Runs, Founding the compound). */
export function dayText(day: number): string {
	return `Day ${day} / dawn`;
}

/** A line of text the screen shows, and whether it's bad news. */
export interface NeedLine {
	text: string;
	urgent: boolean;
}

/**
 * "Food runs out in 6 days", tonight's shortfall, or none left at all; null
 * when nobody's there to eat it.
 */
export function forecastLine({ resource, forecast }: { resource: keyof Resources; forecast: NeedForecast }): NeedLine | null {
	if (forecast.days === null) return null;
	const name = RESOURCE_NAMES[resource];
	if (forecast.stock === 0) return { text: `No ${resource}: ${forecast.shortTonight} short tonight`, urgent: true };
	if (forecast.shortTonight > 0) return { text: `${name} runs out tonight, ${forecast.shortTonight} short`, urgent: true };
	return { text: `${name} runs out in ${countOf(forecast.days, 'day')}`, urgent: false };
}

/** The forecast lines, food then water. */
export function forecastLines(forecast: NeedsForecast): NeedLine[] {
	return UPKEEP_RESOURCES.flatMap((resource) => forecastLine({ resource, forecast: forecast[resource] }) ?? []);
}

/** "Mechanic 1 is injured, fit in 2 days". */
export function injuredLine(driver: DriverRecord): string {
	return `${driver.name} is injured, fit in ${countOf(driver.injuredDays, 'day')}`;
}

/** Rest's line: what ending the day costs. */
export function restCaption({ day, forecast }: { day: number; forecast: NeedsForecast }): string {
	const eats = UPKEEP_RESOURCES.filter((resource) => forecast[resource].perDay > 0)
		.map((resource) => `${amountText(forecast[resource].perDay)} ${resource}`);
	return eats.length > 0 ? `Ends day ${day}. The compound eats ${eats.join(' and ')}.` : `Ends day ${day}.`;
}

/** "A", "A and B", "A, B, and C". */
function listText(items: readonly string[]): string {
	if (items.length <= 2) return items.join(' and ');
	return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * What the night did, under Rest once it's over: the day that ended, the
 * shortfall as the log words it, and who is fit again. Urgent when the
 * stores fell short.
 */
export function dayEndReport(dayEnd: DayEnd): NeedLine {
	const parts = [`Day ${dayEnd.day} ended.`];
	const urgent = UPKEEP_RESOURCES.some((resource) => dayEnd.shortfall[resource] > 0);
	if (urgent) parts.push(shortfallMessage(dayEnd));
	const healed = dayEnd.healed.map((driver) => driver.name);
	if (healed.length > 0) parts.push(`${listText(healed)} ${healed.length === 1 ? 'is' : 'are'} fit again.`);
	return { text: parts.join(' '), urgent };
}
