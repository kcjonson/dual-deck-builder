# Saving and loading a campaign (DDB-49)

Date: 2026-10-07. Code: `src/renderer/game/campaign/CampaignStore.ts`, `SaveStorage.ts`, `CampaignHistory.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Terms), [Area Map Generation](../specs/Area%20Map%20Generation.md) (Saving), [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) (1.1). Builds on [campaign-state-model.md](./campaign-state-model.md), and follows the persistence pattern of [settings-store-and-screens.md](./settings-store-and-screens.md).

## Context

The campaign model writes and reads its own JSON, but nothing kept it, so a campaign lasted as long as the page. A campaign is one save from founding to its fall, so the game needs an active save that survives a restart, a list of past campaigns for the main menu, saves after every step that changes the campaign, and a safe failure when a save is damaged or was written by a newer build. Founding (DDB-284), the main menu (DDB-283), and the run and compound screens all call the store this record describes.

## The store

`CampaignStore` holds one active save and a history list, through an injectable `SaveStorage`, as `GameSettings` takes a `SettingsStorage`. `CampaignStore.shared` is the game's instance over local storage, since `ScreenManager` builds screens with no arguments; tests build their own over `MemorySaveStorage`.

- `hasSave()`: whether there's a save, without reading it. The main menu shows Continue on it.
- `load()`: the campaign in progress, or null. What Continue opens; the menu's summary line ("Day 12 - 3 drivers - 1 stronghold taken") reads from the loaded campaign.
- `save(campaign)`: writes it, and rejects if it can't. Founding saves a new campaign with it.
- `checkpoint(campaign)`: what the run and compound screens call after every step. It never rejects, resolving false after telling `onSaveFailed` listeners why, so a screen can fire it and move on while one notice in the UI covers every failure.
- `end({ campaign, ending })`: the campaign goes into the history and its save goes.
- `delete()`: the save goes without a history line.
- `history()`: past campaigns, newest first.

A campaign that has ended, or whose save `delete` removed, can't be saved again, so a checkpoint that arrives late can't bring it back to Continue.

Every call waits for the ones before it, so calls take effect in the order they're made: a load right after a save reads it, and two writes never interleave. A save turns the campaign into JSON when its turn comes, not when it's asked for, and its turn is never before the code that asked has run to its end. That's what makes a save asked for at an awkward moment safe: a record's `change` fires partway through a card move, before the locker is stored, and a save that a record's or an escort's listener asks for then still writes the whole move. Checkpoints of one campaign that are waiting together share a single write, of the campaign as it stands by then.

## When to save: checkpoints, not change events

The screens call `checkpoint` after each stop resolves, on arriving home, and at the end of each compound action (a Crew screen move, a garage purchase, a rest day). The store doesn't save on the campaign's `change`:

- Not everything a save holds emits there. A record changes on the record, and an escort's damage on its own `Vehicle`; the convoy emits only when escorts join or leave.
- A fight or a compound action makes many small changes, and a write per change would write the same campaign dozens of times for one step.
- A step's own boundaries are what a save should land on. Quitting loses at most the step in progress, which is what the player expects of a step.

A screen that does listen for changes and saves on them still gets a whole step, since the save waits its turn. That's the guidance DDB-410 added to the campaign model.

## Storage: async, local storage in both builds

`SaveStorage` is `getItem`, `setItem`, and `removeItem` returning promises. `LocalSaveStorage` puts them over `window.localStorage`, which the web build and Electron's renderer both have, and looks it up on every call, since reading it throws where storage is blocked. Local storage itself is synchronous; the interface is async so IndexedDB can stand in later without the store or its callers changing.

Measured, with the save as compact JSON:

| | Characters |
| --- | --- |
| The version 1 fixture | 3,021 |
| A stress campaign (`__fixtures__/stressCampaign.ts`) | 358,643 |
| its 2,000 log lines | 222,351 |
| its stand-in gameplay map, at the spec's sizes | 117,643 |
| its 60 drivers | 15,891 |
| A history entry | about 70 |

The stand-in map has 300 stretches of 12 points at a tenth of a world unit (78 KB), 300 stops with their state (27 KB), 40 POIs with approaches (10 KB), and 64 by 64 land fog (1.4 KB). A real campaign's log is far shorter, so the map is most of a real save, and the stand-in puts it nearer 120 KB than the spec's tens of KB; how many points a stretch keeps decides most of that.

The stress campaign saves in 4.3 ms and loads (parse and `fromJSON`) in 18 ms under Jest on Node 24; the fixture loads in 0.3 ms. Electron 25 wrote a string the stress save's size to local storage in about 1 ms and read it back in under 0.1 ms. Loading happens at the main menu, never on the frame path.

Browsers give local storage about 5 MiB an origin (MDN, Storage quotas and eviction criteria). Electron 25's `file://` page, which the packaged build loads, took about 52 million characters before throwing `QuotaExceededError`. The store can hold three copies of a save at once (two slots and a recovery copy, below), about 1.1 million characters at the stress size, which fits 5 MiB even counted at two bytes a character. So local storage holds with room to spare, and nothing forces IndexedDB. The stress test fails if a save passes 1,048,576 characters, the size at which three copies stop fitting comfortably; that's the cue to swap `LocalSaveStorage` for an IndexedDB one.

Rejected:

- IndexedDB now. It has a far larger quota and is async already, but it means opening a database, upgrading its schema, and wrapping requests in transactions, for saves that fit local storage a dozen times over.
- A file per save in Electron, through the preload bridge. A file can be renamed into place atomically, but it's a second code path, and the web build needs local storage regardless.

## Writing a save whole

The save lives in one of two slots, `dual-deckbuilder.campaign.a` and `.b`, and `dual-deckbuilder.campaign.active` names which. A save writes the slot that isn't active, then switches `active` to it. A crash before the switch leaves `active` naming the save before, whole; a write cut off part way lands in a slot nothing reads. Each save costs one full write and a one-character one, and the slot before holds the previous save until the next write.

The store relies on storage only for writes landing in order and staying written once they resolve; it doesn't need a long write to be atomic. Local storage gives more than that: a `setItem` that fails leaves the old value, and Chromium writes a page's local storage to disk in batches, in order, each applied whole, so the switch can't reach disk ahead of the slot it names.

Rejected:

- Writing one key in place. It leans on every future backend writing a long value atomically, and a crash mid-write in one that doesn't (a file written in place) loses the only save.
- Writing a temporary key, then copying it over the save. Two full writes a save, and a crash between them leaves two candidates for the load to choose between.

## Failing safely

A call that fails rejects with a `CampaignStoreError` (checkpoints hand theirs to listeners instead). Its `message` is a sentence for the player, its `reason` says which kind of failure it is, and `detail` and `cause` carry what went wrong underneath, such as the reader's path-named error:

- `storage`: storage threw. A quota error reads "storage is full"; anything else "storage failed". A failed write leaves the save before.
- `damaged`: the save isn't JSON, or `Campaign.fromJSON` refuses it, or `active` names no save.
- `newer`: `migrateSave` threw a `NewerSaveError`, a `RangeError` carrying the save's version and the newest this build reads, which the message names.
- `unsavable`: the campaign can't be written, because `toJSON` refused it (an escort out of range, which the convoy allows between checks), or because it has ended or its save was deleted. Nothing is written.

A save this build can't read is never destroyed. A load that fails on it copies it to `dual-deckbuilder.campaign.recovery` and leaves it in its slot. Writing a campaign other than the one the store loaded or last saved (a newly founded one) first checks the save it replaces, since the next write lands in that save's slot, and copies it to recovery if it can't be read; `delete` does the same before removing anything. If the copy itself fails, the write fails too. The recovery key holds the most recent save set aside, for a newer build or a person to restore; the game doesn't read it.

A newer build's save is likelier than a damaged one. Every playtest build is served from one origin, so they share one save, as they share settings, and a branch build that bumps the schema leaves a save main's build can't read. Main's build says so, and starting a new campaign there sets the newer save aside instead of writing over it.

## The history

`dual-deckbuilder.campaign.history` holds `{ schemaVersion, campaigns }`, newest first, each entry `{ seed, day, strongholdsTaken, ending }`, about 70 characters. It's kept apart from the save: Continue never reads it, and the history list never reads a save. The seed is there because the spec shows it in campaign history; `day` is the day the campaign ended on, from which the menu tells days survived. The endings are `starved`, `rioted`, and `disbanded` for the compound's fall, `won`, and `abandoned` for a campaign given up for a new one. Unlocks earned (Game Flow 1.1) join as a schema bump once unlocks exist. The history has its own schema version and migrations, through the same `migrateSave`.

`end` records the campaign as it stands, then removes the save if it's the campaign the store holds; ending a campaign the store didn't load or save leaves the save alone. A crash between the two writes leaves the save for Continue, and ending that campaign again from the same state records nothing new, since an entry equal to the newest one isn't added twice.

A history from a newer build is left as it is: `history()` fails as `newer`, and `end` skips the entry with a warning rather than write an older format over it. A damaged history is copied to `dual-deckbuilder.campaign.history-recovery`; `history()` fails as `damaged`, and the next `end` starts a new list.

## Randomness and map attempts

No `Rng` is saved. Campaign-time draws fork a stream per event from the seed and a saved counter, `nextDriverNumber` being the first such counter, so nothing is saved partway through a sequence.

The seed is checked on load as an integer from 0 to 2^32 - 1, so a save whose seed is a string, null, or a number JSON reads as Infinity (`1e999`) fails as damaged. `new Rng({ seed })` throws on a seed that isn't a number but coerces NaN and Infinity to 0, which would quietly build seed 0's map.

Loading rebuilds terrain and scenery from `root.fork('map', mapAttempt).fork(stage, stageAttempt)`, so the map state the generator defines (DDB-275) keeps the map attempt and the winning terrain and scenery attempts. The gameplay stages' attempts aren't needed, since their output is saved. Until the generator exists the map state is opaque JSON, and `MapState` names where they go.

## Consequences

- Founding saves with `CampaignStore.shared.save(campaign)`; a failure there means the new campaign isn't saved, and the message says why.
- The main menu shows Continue on `hasSave()`, opens it with `load()`, and picks its words for a failure from `reason`. New Campaign over a save in progress calls `end({ ending: 'abandoned' })` to keep it in the history, or `delete()`.
- The run and compound screens call `checkpoint` after each step, subscribe to `onSaveFailed` for a "couldn't save" notice, and call `end` when the last driver dies or the campaign is won.
- Two tabs of the game on one origin write over each other's saves: the last write wins, and no save is ever half written.
- The recovery keys hold one save and one history each; a second unreadable one replaces the first.
- Swapping storage for IndexedDB is a new `SaveStorage` and nothing else.
