# The main menu's campaign entries (DDB-283)

Date: 2026-10-08. Code: `src/renderer/game/screens/main-menu/MainMenuScreen.ts` and `campaignText.ts`, `screens/campaign-history/CampaignHistoryScreen.ts`, `screens/compound/CompoundPlaceholderScreen.ts`, and the harness's `tests/visual/support/campaignSaves.ts`. Spec: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 1.1. Builds on [campaign-save-and-load.md](./campaign-save-and-load.md) and [campaign-founding.md](./campaign-founding.md), whose APIs it uses as built.

## Context

The menu's first button opened driver selection for a one-off fight. A campaign now founds, saves, and loads, so the menu needs New Campaign, Continue with the save's state, and Campaign History, and has to cope with a save it can't open: one from another save format version, a damaged one, or storage that's blocked or full. The compound screen doesn't exist yet, so whatever New Campaign and Continue open is a stand-in.

## Reading the save on mount

Continue's line ("Day 12 - 3 drivers - 1 stronghold taken") reads from the campaign, and the store has no summary short of loading it, so the menu calls `saveStatus()` and then `load()` as it mounts. Continue hands that instance to the compound screen, which is right by the store's lineage rule: the instance a load hands out is the only one that saves. Every mount loads again, so returning to the menu retires whatever the compound screen held, which has unmounted by then.

Considered: loading on Continue alone. It doesn't give the line, and a summary stored beside the save is a store change, which this task doesn't make.

"Drivers" counts the pool at the compound, ready and injured. The dead and the missing stay in the campaign's record, but a player reading "3 drivers" means who they can send.

The store answers in microtasks over local storage, so the first frame already shows the answer. Until it does, Continue is disabled with "Looking for a saved campaign.", and a New Campaign press waits for the answer before deciding whether to ask.

## Continue says why it's disabled, in text

With nothing to continue, Continue stays in the column, disabled, and the line under it says why: no campaign in progress, a save from another version ("New Campaign replaces it"), or the store's own message for a damaged save or a storage failure. A disabled control takes no focus and shows no hover (R9.5), and a tooltip needs one or the other (R12.22), so the reason is a visible line rather than a tooltip. The arrows skip Continue while it's disabled (R9.18, R9.29).

## New Campaign over a save

It asks first, in a modal dialog (R12.21) with Cancel focused, so a stray Enter keeps the campaign; Escape and Cancel close it, and focus goes back to New Campaign (R9.20). The question depends on the save: abandoning a campaign in progress, replacing an outdated save (no copy, since it isn't damaged), or replacing a damaged one (the store copies it to the recovery key first). With no save, or when storage failed and the menu can't tell, it doesn't ask.

A campaign in progress goes into the history as `abandoned` through `end`, not `delete`. The history type already had the ending, and a campaign the player gave up is part of their record. The end comes before the new campaign's save, since saving a new campaign retires the old lineage and `end` would then refuse it. A storage failure between the two leaves the old campaign in the history and no save; the menu says why, reads the save again, and New Campaign can be tried again.

Founding runs before either, after `DriverLoader` has loaded, on `freshSeed()`, as campaign-founding.md describes. A failure anywhere stays on the menu with the reason under New Campaign.

## Campaign History

Its own screen, laid out like credits: the title, one panel, Back. Each past campaign is a row of text (how it ended, days, strongholds, seed), not a ListRow: nothing in the list does anything, and R12.8's rows are pressable. The list sits in a scroll container that hugs a short history and scrolls a long one, so Back stays on screen at 1024x600; the page keys scroll it while Back has focus. A damaged history shows the store's message in place of the list.

## The compound placeholder

Registered as `compoundScreen`, the name the compound screen will take, with the data contract `{ campaign }`, so replacing it touches neither the menu nor the registry entry. It shows the summary and the stores, and Back to menu. Opened with no campaign, as a capture or the dev navigate hook does, it loads the save itself, which is what Continue would have handed it.

## Goldens over saved campaigns

Screen scenarios take a `storage` map, which `openScreen` writes to local storage after the page loads and before the navigate. It clears every campaign key first, since the Electron project's profile keeps local storage from one launch to the next and a capture must not see the last one's saves. The saves (in progress, outdated, damaged, and a history with every ending) are written in `campaignSaves.ts` as the store writes them, from the version 1 fixture, without importing the store into the Playwright process; `campaignSaves.test.ts` loads each through the real store, so a renamed key or a save format bump fails there by name rather than as a changed golden.

## Consequences

- The compound screen replaces `CompoundPlaceholderScreen.ts` and its goldens, keeping the registry name and `{ campaign }`.
- Bumping `CAMPAIGN_SCHEMA_VERSION` fails `campaignSaves.test.ts` until the harness's saves move with it.
- "Unlocks earned" joins the history rows with the history schema bump that adds it.
