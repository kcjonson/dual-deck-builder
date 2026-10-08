/**
 * Campaign saves for the screen scenarios: local storage items a capture
 * writes before it navigates, so the main menu, Campaign History, and the
 * compound placeholder render from a save the way a player's page would.
 *
 * Written as the game's `CampaignStore` writes them, without importing it:
 * the store pulls the campaign model into the Playwright process.
 * `campaignSaves.test.ts` loads each one through the real store, so a change
 * to the key names or the save format fails there, by name, before it
 * reaches a golden.
 */
import campaignV1 from '../../../src/renderer/game/campaign/__fixtures__/campaign-v1.json';

/** Every key the store writes starts with this, whatever the build. */
export const CAMPAIGN_KEY_PREFIX = 'dual-deckbuilder.campaign[';

/** `pageNamespace` puts every localhost page, the harness's dev server included, in `dev`. */
const PREFIX = `${CAMPAIGN_KEY_PREFIX}dev]`;

export const SAVE_KEYS = {
	active: `${PREFIX}.active`,
	slotA: `${PREFIX}.a`,
	history: `${PREFIX}.history`,
} as const;

/** `CAMPAIGN_SCHEMA_VERSION`, the save format version the game stamps on saves. */
export const SAVE_FORMAT_VERSION = 1;

function saveText({ campaign, version = SAVE_FORMAT_VERSION }: { campaign: string; version?: number }): string {
	return `{"version":${version},"sequence":1,"campaign":${campaign}}`;
}

/** A save in slot a, named by `active`, as a session before this one left it. */
function savedAs(text: string): Record<string, string> {
	return { [SAVE_KEYS.active]: 'a', [SAVE_KEYS.slotA]: text };
}

const FIXTURE = JSON.stringify(campaignV1);

/** The version 1 fixture: day 9, three drivers at the compound, one stronghold taken. */
export const IN_PROGRESS = savedAs(saveText({ campaign: FIXTURE }));

/** The fixture as the next save format version wrote it. */
export const OUTDATED = savedAs(saveText({ campaign: FIXTURE, version: SAVE_FORMAT_VERSION + 1 }));

/** The fixture's save cut short, which no reader gets through. */
export const DAMAGED = savedAs(saveText({ campaign: FIXTURE }).slice(0, 1000));

/** One past campaign for each ending, newest first. */
export const ENDED = {
	[SAVE_KEYS.history]: JSON.stringify({
		version: SAVE_FORMAT_VERSION,
		campaigns: [
			{ seed: 3141592653, day: 3, strongholdsTaken: 0, ending: 'abandoned' },
			{ seed: 20261006, day: 84, strongholdsTaken: 6, ending: 'won' },
			{ seed: 1234567, day: 41, strongholdsTaken: 2, ending: 'rioted' },
			{ seed: 99, day: 12, strongholdsTaken: 1, ending: 'starved' },
			{ seed: 4000000000, day: 1, strongholdsTaken: 0, ending: 'disbanded' },
		],
	}),
};
