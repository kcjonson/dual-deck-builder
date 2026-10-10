/**
 * Campaign saves for the screen scenarios: local storage items a capture
 * writes before it navigates, so the main menu, Campaign History, the
 * compound screen, and the Crew screen render from a save the way a
 * player's page would.
 *
 * Built from the campaign store's own test fixtures, so they follow the
 * fixture and the save format version wherever those move, and nothing here
 * names either. `campaignSaves.test.ts` loads each one through the real
 * store.
 */
import { CAMPAIGN_SCHEMA_VERSION } from '../../../src/renderer/game/campaign/Campaign';
import { campaignKeys, pageNamespace } from '../../../src/renderer/game/campaign/CampaignStore';
import { atHomeText, fixtureText, fullLockerCampaign, lostCampaign, outdatedText, saveText } from '../../../src/renderer/game/campaign/__fixtures__/storeFixtures';

/** Every key the store writes starts with this, whatever the build. */
export const CAMPAIGN_KEY_PREFIX = 'dual-deckbuilder.campaign[';

/** The harness's dev server is served from 127.0.0.1 (`BASE_URL` in playwright.config.ts), which `pageNamespace` puts in `dev`. */
export const HARNESS_PAGE = { protocol: 'http:', hostname: '127.0.0.1', pathname: '/' };

const KEYS = campaignKeys(pageNamespace(HARNESS_PAGE));

/** A save in slot a, named by `active`, as a session before this one left it. */
function savedAs(text: string): Record<string, string> {
	return { [KEYS.active]: 'a', [KEYS.slots.a]: text };
}

/** The fixture: day 9, three drivers at the compound, one stronghold taken. */
export const IN_PROGRESS = savedAs(fixtureText());

/** The fixture with its run home and unwound, as the Crew screen sees the compound between runs. */
export const AT_HOME = savedAs(atHomeText());

/** The Crew screen's longest lists from the shipped cards: a deck at the most it holds, and every card but the escorts' in the locker. */
export const FULL_LOCKER = savedAs(saveText({ campaign: fullLockerCampaign().toSaveText() }));

/** The fixture home from its run, then lost: its last drivers killed or missing, and the compound rioting (DDB-305). */
export const LOST = savedAs(saveText({ campaign: lostCampaign({ ending: 'rioted', cause: 'last_driver' }).toSaveText() }));

/** The fixture as the next save format version wrote it. */
export const OUTDATED = savedAs(outdatedText());

/** The fixture's save cut short, which no reader gets through. */
export const DAMAGED = savedAs(fixtureText().slice(0, 1000));

/** One past campaign for each ending, newest first. */
export const ENDED = {
	[KEYS.history]: JSON.stringify({
		version: CAMPAIGN_SCHEMA_VERSION,
		campaigns: [
			{ seed: 3141592653, day: 3, strongholdsTaken: 0, ending: 'abandoned' },
			{ seed: 20261006, day: 84, strongholdsTaken: 6, ending: 'won' },
			{ seed: 1234567, day: 41, strongholdsTaken: 2, ending: 'rioted' },
			{ seed: 99, day: 12, strongholdsTaken: 1, ending: 'starved' },
			{ seed: 4000000000, day: 1, strongholdsTaken: 0, ending: 'disbanded' },
		],
	}),
};
