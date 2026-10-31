# The main menu's campaign entries (DDB-283)

Date: 2026-10-08. Code: `_legacy/src/renderer/game/screens/main-menu/MainMenuScreen.ts` and `campaignText.ts`, `screens/campaign-history/CampaignHistoryScreen.ts`, and `screens/compound/CompoundScreen.ts`. Spec: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 1.1. Builds on [campaign-save-and-load.md](./campaign-save-and-load.md) and [campaign-founding.md](./campaign-founding.md), whose APIs it uses as built.

## Context

The menu's first button opened driver selection for a one-off fight. A campaign now founds, saves, and loads, so the menu needs New Campaign, Continue with the save's state, and Campaign History, and has to cope with a save it can't open (one from another save format version, or a damaged one) and with a save that fails to write.

## Reading the save on mount

Continue's line ("Day 12 - 3 drivers - 1 stronghold taken") reads from the campaign, and the store has no summary short of loading it, so the menu loads the save as it mounts (`saveStatus()` then `load()` in the TypeScript store). Continue hands that instance to the compound screen, which is right by the store's lineage rule: the instance a load hands out is the only one that saves. Every mount loads again, so returning to the menu retires whatever the compound screen held, which has unmounted by then.

Considered: loading on Continue alone. It doesn't give the line, and a summary stored beside the save is a store change, which this task doesn't make.

"Drivers" counts the pool at the compound, ready and injured. The dead and the missing stay in the campaign's record, but a player reading "3 drivers" means who they can send.

Salal app's `SaveStore` reads a slot in one call, so the menu has the answer before its first frame. Back from the compound screen lands focus on Continue; if the answer disables Continue, focus goes to New Campaign instead. Should the read ever finish after the first frame, the line reads "Looking for a saved campaign." until it does, Continue stays enabled but does nothing (so it can still take the returning focus), and a New Campaign press waits for the answer before deciding whether to ask.

## Continue says why it's disabled, in text

With nothing to continue, Continue stays in the column, disabled, and the line under it says why: no campaign in progress (the slot is missing), a save from another format version ("New Campaign replaces it"), or a damaged save. A disabled control takes no focus and shows no hover, and a tooltip needs one or the other (R12.22), so the reason is a visible line rather than a tooltip. The arrows skip Continue while it's disabled (R9.18, R9.29).

## New Campaign over a save

It asks first, in a modal dialog on ui's popup stack with Cancel focused, so a stray activate keeps the campaign; the cancel action and Cancel close it, and the player's focus goes back to New Campaign. The question depends on the save: abandoning a campaign in progress, replacing an outdated save (the game makes no copy, since it isn't damaged), or replacing a damaged one (a damaged save is copied aside before anything writes over it, which salal's `SaveStore` does as `<slot>.save.corrupt`). With no save it doesn't ask. The dialog's two buttons are 120 and 180 wide, inside the small dialog's 328 px body.

A campaign in progress goes into the history as `abandoned` through `end`, not `delete`. The history type already had the ending, and a campaign the player gave up is part of their record. The end comes before the new campaign's save, since saving a new campaign retires the old lineage and `end` would then refuse it. A failed write between the two leaves the old campaign in the history and no save; the menu says why, reads the save again, and New Campaign can be tried again.

Founding runs before either, after `DriverLoader` has loaded, on `freshSeed()`, generating the area map as campaign-founding.md describes, with its progress in the notice line between the title and New Campaign. Continue is disabled meanwhile, and leaving through any other button cancels it. A failure anywhere stays on the menu with the reason in that line.

## Campaign History

Its own screen, laid out like credits: the title, one panel, Back. Each past campaign is a row of text (how it ended, days, strongholds, seed), not a pressable list row, since nothing in the list does anything. The list hugs a short history and scrolls a long one (`overflow` Scroll in salal ui), so Back stays on screen; the page keys scroll it while Back has focus. A damaged history shows why in place of the list.

## Consequences

- "Unlocks earned" joins the history rows with the history schema bump that adds it.
