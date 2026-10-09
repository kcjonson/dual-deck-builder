import { isAtCompound } from '../../campaign/Campaign';
import type { Campaign } from '../../campaign/Campaign';
import { CardCounts, addCounts, totalCards } from '../../campaign/CardCounts';
import { DECK_RULES } from '../../campaign/DeckRules';
import type { DriverRecord } from '../../campaign/DriverRecord';
import type { DriverCardStatus } from '../../ui/DriverCard';
import { countOf } from '../main-menu/campaignText';

/**
 * A driver's default deck as the Crew screen shows it: the record's, or,
 * while they're out on a run, their run deck's own cards, going and left at
 * home, which is where the default deck is until the run deck is unwound.
 */
export function defaultDeckOf({ campaign, driver }: { campaign: Campaign; driver: DriverRecord }): CardCounts {
	const runDeck = campaign.runDeckOf(driver);
	return runDeck ? addCounts(runDeck.own, runDeck.leftHome) : driver.defaultDeck;
}

/** The tag on a driver's roster card: injured, lost (dead or missing), or the seat of a run they're out on. */
export function rosterStatus({ campaign, driver }: { campaign: Campaign; driver: DriverRecord }): DriverCardStatus | null {
	if (!isAtCompound(driver)) return 'lost';
	if (driver.status === 'injured') return 'injured';
	const seat = campaign.runDecks.findIndex((deck) => deck.driver === driver);
	if (seat === 0) return 'seat1';
	if (seat === 1) return 'seat2';
	return null;
}

/**
 * How a lost driver went, in their card's specialty line. The record keeps
 * no day for it, so it says how and not when.
 */
export function lostNote(driver: DriverRecord): string {
	if (driver.status === 'dead') return 'Killed on a run';
	if (driver.status === 'missing') return 'Missing on a run';
	return '';
}

/** Where the selected driver stands, the last of the header's chips. */
export function standingText({ campaign, driver }: { campaign: Campaign; driver: DriverRecord }): string {
	if (driver.status === 'injured') return `Injured, fit in ${countOf(driver.injuredDays, 'day')}`;
	if (driver.status === 'dead') return 'Killed on a run';
	if (driver.status === 'missing') return 'Missing on a run';
	return campaign.runDeckOf(driver) ? 'Out on a run' : 'Ready';
}

/**
 * "DECK 12/20": the deck against the most it holds. The header's figures
 * are written as the driver card writes HP ("40/40"), so the four chips fit
 * one row at 1024 px.
 */
export function deckSizeText(deck: CardCounts): string {
	return `DECK ${totalCards(deck)}/${DECK_RULES.deckSize.max}`;
}

/** "HP 31/40". */
export function hitpointsText(driver: DriverRecord): string {
	return `HP ${driver.hitpoints}/${driver.maxHitpoints}`;
}

/** Under the cost curve: the limits every deck keeps. */
export function deckLimitsText(): string {
	const { min, max } = DECK_RULES.deckSize;
	return `Decks stay between ${min} and ${max} cards.`;
}

/** Under the locker: where its cards come from, and what scrapping one pays against what the compound holds, once there's a compound. */
export function lockerNote(scrap: number | null): string {
	const pays = `Scrap destroys a copy for ${DECK_RULES.scrapPerCard} scrap`;
	return `Rewards and finds land here. ${scrap === null ? `${pays}.` : `${pays}; the compound has ${scrap}.`}`;
}

/** "Driver pool (3)": the drivers at the compound. */
export function rosterTitle(campaign: Campaign | null): string {
	return campaign ? `Driver pool (${campaign.drivers.filter((driver) => isAtCompound(driver)).length})` : 'Driver pool';
}
