import type { Resources } from '../../campaign/Campaign';
import { UPKEEP_RESOURCES } from '../../campaign/CompoundRules';
import type { DayEnd, NeedForecast, NeedsForecast } from '../../campaign/DayClock';
import type { DriverRecord } from '../../campaign/DriverRecord';
import { countOf } from '../main-menu/campaignText';

export type BuildingId = 'bunkhouse' | 'radio_mast' | 'infirmary' | 'garage' | 'map_room' | 'stores';

/** A building on the compound screen: what it's for, and why it can't be entered yet. */
export interface Building {
	id: BuildingId;
	name: string;
	description: string;
	/** Why it's disabled; null once the screen behind it exists. */
	reason: string | null;
}

/**
 * The buildings (Compound and Supply Runs, Buildings) in the wireframe's
 * order, read in rows of three. None of the screens behind them exists yet.
 */
export const BUILDINGS: readonly Building[] = [
	{ id: 'bunkhouse', name: 'Bunkhouse', description: 'Drivers, settlers, and the Crew screen, where default decks are built.', reason: "The Crew screen isn't built yet." },
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

/** "Food 14". */
export function resourceText({ resource, amount }: { resource: keyof Resources; amount: number }): string {
	return `${RESOURCE_NAMES[resource]} ${amount}`;
}

/** The compound between runs is always at dawn (Compound and Supply Runs, Founding the compound). */
export function dayText(day: number): string {
	return `Day ${day} / dawn`;
}

/** One line of the needs panel, and whether it's urgent. */
export interface NeedLine {
	text: string;
	urgent: boolean;
}

/** "Food runs out in 6 days", or tonight's shortfall; null when nobody's there to eat it. */
export function forecastLine({ resource, forecast }: { resource: keyof Resources; forecast: NeedForecast }): NeedLine | null {
	if (forecast.days === null) return null;
	const name = RESOURCE_NAMES[resource];
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
		.map((resource) => `${forecast[resource].perDay} ${resource}`);
	return eats.length > 0 ? `Ends day ${day}. The compound eats ${eats.join(' and ')}.` : `Ends day ${day}.`;
}

/** "A", "A and B", "A, B, and C". */
function listText(items: readonly string[]): string {
	if (items.length <= 2) return items.join(' and ');
	return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** What the night did, under Rest once it's over. */
export function dayEndReport(dayEnd: DayEnd): string {
	const parts = [`Day ${dayEnd.day} ended.`];
	const short = UPKEEP_RESOURCES.filter((resource) => dayEnd.shortfall[resource] > 0)
		.map((resource) => `${dayEnd.shortfall[resource]} ${resource}`);
	if (short.length > 0) {
		const lost = dayEnd.peopleLost === 1 ? '1 person' : `${dayEnd.peopleLost} people`;
		parts.push(dayEnd.peopleLost > 0 ? `Short of ${listText(short)}; ${lost} lost.` : `Short of ${listText(short)}.`);
	}
	const healed = dayEnd.healed.map((driver) => driver.name);
	if (healed.length > 0) parts.push(`${listText(healed)} ${healed.length === 1 ? 'is' : 'are'} fit again.`);
	return parts.join(' ');
}
