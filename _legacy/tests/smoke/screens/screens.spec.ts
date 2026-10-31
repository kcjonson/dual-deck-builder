import { test } from '@playwright/test';
import { captureConsole, expectCleanConsole, openScreen } from '../support/app';
import type { ScreenCase } from '../support/app';
import { AT_HOME, DAMAGED, ENDED, FULL_LOCKER, FULL_RUN, IN_PROGRESS, LOST, ON_THE_ROAD, OUTDATED } from '../support/campaignSaves';

/**
 * Every screen `ScreenManager.navigate` accepts, plus the saves and payloads
 * that send a screen down a different path: Continue with a live, an outdated
 * and a damaged save, the battle result once per outcome, a run home and on
 * the road. Screens that read the campaign store mount over the saves a case
 * puts in local storage, and the ones that regrow the save's map wait for the
 * worker (`assetsReady`).
 */
const SCREENS: readonly ScreenCase[] = [
	{ screen: 'splashScreen', leadsTo: 'mainMenuScreen' },
	{ screen: 'mainMenuScreen' },
	{ screen: 'mainMenuScreen', variant: 'continue', storage: IN_PROGRESS },
	{ screen: 'mainMenuScreen', variant: 'outdated', storage: OUTDATED },
	{ screen: 'mainMenuScreen', variant: 'damaged', storage: DAMAGED },
	{ screen: 'settingsScreen' },
	{ screen: 'creditsScreen' },
	{ screen: 'developerScreen' },
	{ screen: 'cardShowcaseScreen' },
	{ screen: 'combatScreen' },
	{ screen: 'combatScreen', variant: 'log', data: { openLog: true } },
	{ screen: 'battleResultScreen', variant: 'victory', data: { victory: true } },
	{ screen: 'battleResultScreen', variant: 'defeat', data: { victory: false } },
	{ screen: 'campaignHistoryScreen' },
	{ screen: 'campaignHistoryScreen', variant: 'ended', storage: ENDED },
	{ screen: 'compoundScreen', storage: IN_PROGRESS },
	{ screen: 'compoundScreen', variant: 'home', storage: AT_HOME },
	{ screen: 'crewScreen', storage: AT_HOME },
	{ screen: 'crewScreen', variant: 'full', storage: FULL_LOCKER },
	{ screen: 'customizeScreen', storage: IN_PROGRESS },
	{ screen: 'customizeScreen', variant: 'full', storage: FULL_RUN },
	{ screen: 'defeatScreen', storage: LOST },
	{ screen: 'areaMapScreen', storage: AT_HOME },
	{ screen: 'runRouteScreen', storage: AT_HOME },
	{ screen: 'loadOutScreen', storage: AT_HOME, data: { trip: { destination: 'Elk Creek Clinic', routeName: 'Back roads', stops: 2, fuel: 3, homeBy: '16:30', pastDark: false } } },
	{ screen: 'runScreen', storage: IN_PROGRESS },
	{ screen: 'runScreen', variant: 'road', storage: ON_THE_ROAD },
	{ screen: 'eventScreen' },
];

test.describe('every screen opens', () => {
	for (const entry of SCREENS) {
		test(entry.variant ? `${entry.screen} (${entry.variant})` : entry.screen, async ({ page }) => {
			const log = captureConsole(page);
			await openScreen(page, log, entry);
			expectCleanConsole(log);
		});
	}
});
