# Saving and loading a campaign (DDB-49)

Date: 2026-10-07, reworked 2026-10-08 after review. Code: `src/renderer/game/campaign/CampaignStore.ts`, `SaveStorage.ts`, `CampaignHistory.ts`, and `Campaign.toSaveText`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Terms), [Area Map Generation](../specs/Area%20Map%20Generation.md) (Saving), [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) (1.1). Builds on [campaign-state-model.md](./campaign-state-model.md), and follows the persistence pattern of [settings-store-and-screens.md](./settings-store-and-screens.md).

## Context

The campaign model writes and reads its own JSON, but nothing kept it, so a campaign lasted as long as the page. A campaign is one save from founding to its fall, so the game needs an active save that survives a restart, a list of past campaigns for the main menu, saves after every step that changes the campaign, and a safe failure when a save is damaged or was written by a newer build. Founding (DDB-284), the main menu (DDB-283), and the run and compound screens all call the store this record describes.

## The store

`CampaignStore` holds one active save and a history list, through an injectable `SaveStorage`, as `GameSettings` takes a `SettingsStorage`. `CampaignStore.shared` is the game's instance over local storage, since `ScreenManager` builds screens with no arguments; tests build their own over `MemorySaveStorage`.

- `hasSave()`: whether there's a save, without loading it. The main menu shows Continue on it.
- `load()`: the campaign in progress, or null. What Continue opens; the menu's summary line ("Day 12 - 3 drivers - 1 stronghold taken") reads from the loaded campaign.
- `save(campaign)`: writes it, and rejects if it can't. Founding saves a new campaign with it.
- `checkpoint(campaign)`: what the run and compound screens call at the end of each step. It never rejects: it resolves false after telling `onSaveFailed` listeners why, so a screen can fire it and move on while one notice in the UI covers every failure.
- `end({ campaign, ending })`: the campaign goes into the history and its save goes.
- `delete()`: the save goes without a history line.
- `history()`: past campaigns, newest first.

Every call waits for the ones before it, so calls take effect in the order they're made: a load right after a save reads it, and two writes never interleave. A save or checkpoint takes its snapshot (the campaign's save text) in the first microtask after the call, once the code that asked has run and before the next frame, and writes that text when its turn comes. Checkpoints of one campaign share a write while it waits its turn, and a checkpoint that joins after the shared snapshot was taken replaces it, so the write holds the latest of their steps. Any other call ends the sharing: a checkpoint asked for after a delete, an end, or another campaign's save gets a write of its own, after that call.

## When to save: checkpoints at the end of each step

The screens call `checkpoint` when a stop resolves, on arriving home, and at the end of each compound action (a Crew screen move, a garage purchase, a rest day). Not on change events:

- Not everything a save holds emits on the campaign. A record changes on the record, an escort's damage on its own `Vehicle`, and escorts joining or leaving on the convoy.
- A fight or a compound action makes many small changes, and a write per change would write the same campaign dozens of times for one step.
- A step's end is what a save should land on. Quitting loses at most the step in progress.

A save asked for from a listener is still whole for a synchronous step, since the snapshot waits until the code that set it off has run: a record's `change` fires partway through a card move, before the locker is stored, and the save still captures the finished move. An async step is another matter: a save asked for before an `await` in the step captures it as it stood there. Hence checkpoints at step ends.

## Storage: async, local storage in both builds

`SaveStorage` is `getItem`, `setItem`, and `removeItem` returning promises. `LocalSaveStorage` puts them over `window.localStorage`, which the web build and Electron's renderer both have, and looks it up on every call, since reading it throws where storage is blocked. Local storage itself is synchronous; the interface is async so IndexedDB can stand in later.

Measured, with the save as compact JSON:

| | Characters |
| --- | --- |
| The version 1 fixture | 3,021 |
| A stress campaign (`__fixtures__/stressCampaign.ts`) | 358,438 |
| its 2,000 log lines | 222,351 |
| its stand-in gameplay map, at the spec's sizes | 117,643 |
| its 60 drivers, with decks drawn from every card in `cards.json` | 15,668 |
| A history entry | about 70 |

The stand-in map has 300 stretches of 12 points at a tenth of a world unit (78 KB), 300 stops with their state (27 KB), 40 POIs with approaches (10 KB), and 64 by 64 land fog (1.4 KB). A real campaign's log is far shorter, so the map is most of a real save, and the stand-in puts it nearer 120 KB than the spec's tens of KB; how many points a stretch keeps decides most of that.

Checkpoints run in the calling frame: the snapshot is taken in the microtask after the step, and over local storage the write finishes before the frame ends too. So serializing has to be cheap. `Campaign.toSaveText` writes the same text as `JSON.stringify(campaign)` but hands `JSON.stringify` the campaign's frozen values instead of the copies `toJSON` makes for its callers, still checking the convoy first. At the stress size, serializing went from 4.1 to 4.7 ms to 1.2 to 1.5 ms in Node (best runs), and a whole checkpoint over memory storage takes about 1.8 ms; QA measured whole checkpoints at 9 to 21 ms in Chromium and 17 to 48 ms in Electron before the change. A checkpoint after a load also no longer parses the save again (23 to 28 ms at the stress size): the store remembers the text it wrote or read in each slot (below). Loading parses the save and checks the other slot, at the main menu, never on the frame path.

Browsers give local storage about 5 MiB an origin (MDN, Storage quotas and eviction criteria). Electron 25's `file://` page, which the packaged build loads, took about 52 million characters before throwing `QuotaExceededError`. The store can hold three copies of a save at once (two slots and a recovery copy), which at two bytes a character fit 5 MiB up to 873,813 characters a save, and the origin holds the settings and the history too. So a save has a budget of 800,000 characters, which the stress campaign meets at 45%, and the store test holds a long campaign to it. Local storage holds with room to spare, and nothing forces IndexedDB; a generated map that pushes a long campaign past the budget is the cue to move.

Rejected:

- IndexedDB now. It has a far larger quota and is async already, but it means opening a database, upgrading its schema, and wrapping requests in transactions, for saves that fit local storage many times over.
- A file per save in Electron, through the preload bridge. A file can be renamed into place atomically, but it's a second code path, and the web build needs local storage regardless.

Moving to IndexedDB later is a new `SaveStorage` plus a look at timing: its writes resolve frames after the step (the snapshot still doesn't move), the queue can back up behind a slow write, and a quit straight after a checkpoint has to wait for it.

## Writing a save whole, and finding it again

The save lives in one of two slots, `dual-deckbuilder.campaign.a` and `.b`, and `dual-deckbuilder.campaign.active` names which. A write goes into the slot that isn't the save's, then switches `active` to it, so a crash before the switch leaves the save before, whole, and a write cut off part way lands in a slot nothing reads. Each save costs one full write and a one-character one. Writing a campaign that hasn't changed since its save writes nothing.

Every call finds the save the same way. `active` naming a slot with text in it decides. Otherwise (no `active`, as a first write cut off before its switch leaves, or one naming an empty slot, as a race between tabs can leave) it's whichever slot holds text, preferring one that loads, and with text in neither there's no save. `hasSave`, `load`, writes, and `delete` all agree on it, so Continue never shows for a save that isn't there, and a load never calls a missing save damaged. An `active` holding anything else is a newer build's format, whose save may sit where this build can't see: `hasSave` says there's a save, `load` says it's from a newer version, and writes leave storage alone until the player deletes it.

Removing the save goes other slot, then the save's, then `active`, so a crash part way leaves the save or nothing, never the save before it.

The store relies on storage only for writes landing in order and staying written once they resolve; a long slot write needn't be atomic. Local storage gives more than that: a `setItem` that fails leaves the old value, and Chromium writes a page's local storage to disk in batches, in order, each applied whole, so the switch can't reach disk ahead of the slot it names. The history and the recovery copies are written in place, so they do need a single write to land whole, as local storage's does.

Rejected:

- Writing one key in place. It leans on every future backend writing a long value atomically, and a crash mid-write in one that doesn't (a file written in place) loses the only save.
- Writing a temporary key, then copying it over the save. Two full writes a save, and a crash between them leaves two candidates for the load to choose between.

## Failing safely

A call that fails rejects with a `CampaignStoreError` (checkpoints hand theirs to listeners instead). Its `message` is a whole sentence for the player, its `reason` says which kind of failure it is, and `detail` and `cause` carry what went wrong underneath, such as the reader's path-named error:

- `storage`: storage threw. A quota error reads "storage is full", a SecurityError "storage is blocked", anything else "storage failed". A failed write leaves the save before.
- `damaged`: the save isn't JSON, or `Campaign.fromJSON` refuses it.
- `newer`: `migrateSave` threw a `NewerSaveError`, a `RangeError` carrying the save's version and the newest this build reads, which the message names; or `active` holds a value this build doesn't know.
- `unsavable`: the campaign can't be written, because `toJSON` would refuse it (an escort out of range, which the convoy allows between checks); nothing is written. `end` with an ending that doesn't exist fails this way too, at once, before it queues.
- `retired`: the campaign has ended, its save was deleted, or a new campaign replaced it (below). `save` rejects with it; a checkpoint of a retired campaign just resolves false without telling listeners, since a game over isn't a failed save.

Before any slot is written over or removed, the store copies its text to `dual-deckbuilder.campaign.recovery` unless that's text the store wrote or read there, or this build loads it. So a save this build can't read, damaged or from a newer build, isn't destroyed by a later write, a new campaign, or a delete. A load that fails copies the save straight away and leaves it in its slot, and `load` checks the other slot too, at the menu, since the next write lands there. If a copy fails, the write fails with it, except for a delete the player asked for when storage is too full to hold the copy: that goes ahead with a warning, so a full storage can't trap the player behind a save nobody can read. The recovery key holds the most recent save set aside, for a newer build or a person to restore; the game doesn't read it, and a second unreadable save replaces the first copy. A message says the save was kept only when it was.

A newer build's save is likelier than a damaged one. Every playtest build is served from one origin, so they share one save, as they share settings, and a branch build that bumps the schema leaves a save main's build can't read. Main's build says so, and its writes set the newer save aside before landing in its slot.

Warnings (map param repairs, a history set aside) are collected while the store decides, and handed to `onWarning` once it has, one at a time, so a callback that throws is logged and changes nothing.

## Which campaign the save belongs to

Every campaign instance the store loads or saves is tagged with the generation of the save it belongs to, and only the current generation's instances are saved. `load` tags what it returns; a write of an instance the store hasn't tagged is a new campaign, which starts a generation once it's written. Ending the save's campaign (through any of its instances), deleting the save, and saving a new campaign each start a new generation, retiring every instance of the one before. So a run screen still holding the campaign the menu abandoned, deleted, or replaced can't write it back, and no instance of an ended campaign returns to Continue. `delete` retires before it removes anything, so a delete that fails part way can't be undone by a late checkpoint. An instance the store never tagged that's passed to `end` is retired on its own and leaves the save alone.

The tags live in each store's memory, so a second tab has its own and can write a campaign the first tab ended or deleted. Two tabs of the game on one origin aren't supported until a single-writer lock lands (DDB-415).

## The history

`dual-deckbuilder.campaign.history` holds `{ schemaVersion, campaigns }`, newest first, each entry `{ seed, day, strongholdsTaken, ending }`, about 70 characters. It's kept apart from the save: Continue never reads it, and the history list never reads a save. The seed is there because the spec shows it in campaign history; `day` is the day the campaign ended on, from which the menu tells days survived. The endings are `starved`, `rioted`, and `disbanded` for the compound's fall, `won`, and `abandoned` for a campaign given up for a new one. Unlocks earned (Game Flow 1.1) join as a schema bump once unlocks exist. The history has its own schema version and migrations, through the same `migrateSave`.

`end` records the campaign as it stands, then removes the save. An entry equal to the newest one isn't added again, which heals a crash between the two writes only when the campaign is ended the same way again: ended another way (abandoned from New Campaign, say), it gets a second line. Entries carry no campaign identity, so two campaigns on one seed that end the same way on the same day, back to back, also read as one.

A history from a newer build is left as it is: `history()` fails as `newer`, and `end` skips the entry with a warning rather than write an older format over it. A damaged history is copied to `dual-deckbuilder.campaign.history-recovery`; `history()` fails as `damaged`, and the next `end` starts a new list.

## Randomness and map attempts

No `Rng` is saved. Campaign-time draws fork a stream per event from the seed and a saved counter, `nextDriverNumber` being the first such counter, so nothing is saved partway through a sequence.

The seed is checked on load as an integer from 0 to 2^32 - 1 (`readSeed`, shared by the campaign, its map params, and the history), so a save whose seed is a string, null, or a number JSON reads as Infinity (`1e999`) fails as damaged. `new Rng({ seed })` throws on a seed that isn't a number but coerces NaN and Infinity to 0, which would quietly build seed 0's map.

Loading rebuilds terrain and scenery from `root.fork('map', mapAttempt).fork(stage, stageAttempt)`, so the map state the generator defines (DDB-275) keeps the map attempt and the winning terrain and scenery attempts. The gameplay stages' attempts aren't needed, since their output is saved. Until the generator exists the map state is opaque JSON, and `MapState` names where they go.

## Consequences

- Founding saves with `CampaignStore.shared.save(campaign)`; a failure there means the new campaign isn't saved, and the message says why.
- The main menu shows Continue on `hasSave()`, opens it with `load()`, and picks its words for a failure from `reason`. New Campaign over a save in progress calls `end({ ending: 'abandoned' })` to keep it in the history, or `delete()`; over a newer build's save it has to `delete()` first.
- The run and compound screens call `checkpoint` at the end of each step, subscribe to `onSaveFailed` for a "couldn't save" notice, and call `end` when the last driver dies or the campaign is won.
- Two tabs on one origin can write over each other's saves and bring back an ended campaign, until DDB-415.
- The recovery keys hold one save and one history each.
