# Saving and loading a campaign (DDB-49)

Date: 2026-10-07, revised 2026-10-08 for per-build saves (DDB-413) and 2026-10-10 for the area map (DDB-467). Code: `src/renderer/game/campaign/CampaignStore.ts`, `SaveStorage.ts`, `CampaignHistory.ts`, `CampaignMaps.ts`, and `Campaign.toSaveText`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Terms), [Area Map Generation](../specs/Area%20Map%20Generation.md) (Saving), [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) (1.1). Builds on [campaign-state-model.md](./campaign-state-model.md), and follows the persistence pattern of [settings-store-and-screens.md](./settings-store-and-screens.md).

## Context

The campaign model writes and reads its own JSON, but nothing kept it, so a campaign lasted as long as the page. A campaign is one save from founding to its fall, so the game needs an active save that survives a restart, a list of past campaigns for the main menu, saves after every step that changes the campaign, and a safe failure when a save can't be read. Founding (DDB-284), the main menu (DDB-283), and the run and compound screens all call the store this record describes.

## The store

`CampaignStore` holds one active save and a history list, through an injectable `SaveStorage`, as `GameSettings` takes a `SettingsStorage`. `CampaignStore.shared` is the game's instance over local storage, since `ScreenManager` builds screens with no arguments; tests build their own over `MemorySaveStorage`, with a namespace and version of their choosing.

- `saveStatus()`: `'none'`, `'saved'`, or `'outdated'`, without loading the save. The main menu shows Continue on `'saved'`, and says a campaign from another version can't be continued on `'outdated'`. `hasSave()` is `saveStatus() === 'saved'`.
- `load()`: the campaign in progress, or null (none, or outdated). What Continue opens; the menu's summary line ("Day 12 - 3 drivers - 1 stronghold taken") reads from the loaded campaign.
- `save(campaign)`: writes it, and rejects if it can't. Founding saves a new campaign with it.
- `checkpoint(campaign)`: what the run and compound screens call at the end of each step. It never rejects: it resolves `failed` after telling `onSaveFailed` listeners why, so a screen can fire it and move on while one notice in the UI covers every failure. Otherwise it resolves `saved`, `ended` (the campaign's end is in the history, [campaign-end.md](./campaign-end.md)), or `retired` (below).
- `end({ campaign, ending })`: the campaign goes into the history and its save goes. A campaign that's over (`Campaign.end`) goes in with its own ending, and a checkpoint or save of one ends it this way instead of writing it ([campaign-end.md](./campaign-end.md)).
- `delete()`: the save goes without a history line.
- `history()`: past campaigns, newest first.

Every call waits for the ones before it, so calls take effect in the order they're made: a load right after a save reads it, and two writes never interleave.

## Saves are per build, and stamped with the save format version

Every playtest build is served from one origin (main at /playtest/dual-deckbuilder/, each PR's at /playtest/dual-deckbuilder/<branch>/), and running main beside a PR build is the normal playtest setup. So each build keeps its own saves (DDB-413): every key carries the build's namespace, the directory the page was served from (`pageNamespace`). The desktop build's `file://` page is `desktop`, and a localhost dev server is `dev`. Settings stay shared across builds; nothing in them depends on the build.

Every save and history list also carries the save format version, `CAMPAIGN_SCHEMA_VERSION`, bumped by hand whenever the text `toSaveText` writes, or a history entry, changes shape. Ordinary redeploys of a build keep its saves. There are no migrations: a save stamped with another version, older or newer (an integer other than this build's), isn't loaded. `saveStatus` calls it outdated, `load` passes it by, and a new campaign or a delete replaces it without a copy. A stamp with no version, or one that isn't an integer, is damage, not another version. A save of this version whose campaign's map another version of the area map generator made is outdated the same way: it has map attempts, and its `generatorVersion` is an integer other than this build's `AREA_MAP_GENERATOR_VERSION`, so its map can't be made again here (The area map, below). `saveStatus` reads that one field beside the stamp, still without loading the campaign. A history stamped with another version starts over on the next ending. So bumping the version invalidates every existing save of that build, which is the trade for not carrying migrations while the format moves this fast.

Rejected:

- Migrations: each one is code to write and test for a format nobody keeps for long during playtesting, and a newer build's save was still unreadable to an older one.
- One shared save for every build on the origin, which is what put a newer build's save in front of an older build in the first place.

## When to save: checkpoints at the end of each step

The screens call `checkpoint` when a stop resolves, on arriving home, and at the end of each compound action (a Crew screen move, a garage purchase, a rest day). Not on change events:

- Not everything a save holds emits on the campaign. A record changes on the record, an escort's damage on its own `Vehicle`, and escorts joining or leaving on the convoy.
- A fight or a compound action makes many small changes, and a write per change would write the same campaign dozens of times for one step.
- A step's end is what a save should land on. Quitting loses at most the step in progress.

A save or checkpoint captures the campaign in the first microtask after the call, so it holds everything that runs synchronously after the call as well, and writes that text when its turn comes. So the next step starts only after awaiting the checkpoint, or on a later frame, never in the same synchronous run. A save asked for from a listener partway through a synchronous step (a record's `change` fires partway through a card move, before the locker is stored) still captures the whole step; one asked for before an `await` in an async step captures it as it stood there.

Checkpoints of one campaign share a write while it waits its turn, and a checkpoint that joins after the shared snapshot was taken replaces it, so the write holds the latest of their steps. Any other call ends the sharing: a checkpoint asked for after a delete, an end, a load, or another campaign's save gets a write of its own, after that call.

Checkpoints run in the calling frame: the snapshot is taken in the microtask after the step, and over local storage the write finishes before the frame ends too. So the store serializes through `Campaign.toSaveText`, which writes the same text as `JSON.stringify(campaign)` but hands `JSON.stringify` the frozen values instead of the copies `toJSON` makes. At the stress size that takes 1.5 to 2.3 ms in Node, against 4.4 to 4.9 ms through `toJSON` (best runs), and a whole checkpoint over memory storage about 2 to 3 ms. Whole checkpoints through `JSON.stringify(campaign)` measured 9 to 21 ms in Chromium and 17 to 48 ms in Electron at that size, which is why the store doesn't use it. A checkpoint parses nothing: the store remembers the text it wrote, loaded, or copied to recovery in each slot, so writing over it needs no look inside.

## Storage: async, local storage in both builds

`SaveStorage` is `getItem`, `setItem`, and `removeItem` returning promises. `LocalSaveStorage` puts them over `window.localStorage`, which the web build and Electron's renderer both have, and looks it up on every call, since reading it throws (or hands back null) where storage is blocked. Local storage itself is synchronous; the interface is async so IndexedDB can stand in later. The store needs every write to land whole or not at all, `active` included, in the order made, and to stay written once it resolves. Local storage's writes do, and so do IndexedDB's transactions.

Measured, with the save as compact JSON:

| | Characters |
| --- | --- |
| The version 5 fixture's campaign, with a run out | 3,509 |
| A stress campaign's save (`__fixtures__/stressCampaign.ts`) | 360,495 |
| its 2,000 log lines | 222,351 |
| its stand-in gameplay map, at the spec's sizes | 117,644 |
| its 60 drivers, with decks drawn from every card in `cards.json` | 17,903 |
| A history entry | about 70 |

The stand-in map has 300 stretches of 12 points at a tenth of a world unit (78 KB), 300 stops with their state (27 KB), 40 POIs with approaches (10 KB), and 64 by 64 land fog (1.4 KB). A real campaign's log is far shorter, so the map is most of a real save, and the stand-in puts it nearer 120 KB than the spec's tens of KB; how many points a stretch keeps decides most of that. Saves today keep the map's attempts rather than its lines (The area map, below), so a real save is a few KB until DDB-436 adds the lines; the stress campaign keeps its stand-in lines so the budget test already covers them.

Browsers give local storage about 5 MiB an origin (MDN, Storage quotas and eviction criteria). Electron 25's `file://` page, which the packaged build loads, took about 52 million characters before throwing `QuotaExceededError`. The store can hold three copies of a save at once (two slots and a recovery copy), which at two bytes a character fit 5 MiB up to 873,813 characters a save, leaving room for the settings and the history. So a save has a budget of 800,000 characters, which the stress campaign meets at 45%, and the store test holds a long campaign to it. A generated map that pushes a long campaign past the budget is the cue to move to IndexedDB.

The budget is one build's. Every build on the playtest origin shares its 5 MiB, and one build can't see another's saves, let alone remove them: at the stress size a build's two slots take 1.4 MB, so four builds holding campaigns that long overflow it, and a build that's taken down leaves its saves behind. A save that doesn't fit fails as `storage` ("storage is full") and leaves the save before.

Moving to IndexedDB is a new `SaveStorage` plus a look at timing: its writes resolve frames after the step (the snapshot still doesn't move), the queue can back up behind a slow write, and a quit straight after a checkpoint has to wait for it.

Rejected:

- IndexedDB now. It has a far larger quota and is async already, but it means opening a database, upgrading its schema, and wrapping requests in transactions, for saves that fit local storage many times over.
- A file per save in Electron, through the preload bridge. A file can be renamed into place atomically, but it's a second code path, and the web build needs local storage regardless.

## Writing a save whole, and finding it again

The save lives in one of two slots, and `active` names which. A write goes into the slot that isn't the save's, then switches `active` to it, so a crash before the switch leaves the save before. Each save costs one full write and a one-character one. Writing a campaign that hasn't changed since its save writes nothing.

Every call finds the save the same way. `active` naming a slot with text in it decides, whatever the text, and the other slot then holds only the save before it. Otherwise (no `active`, an empty one, one naming an empty slot, or anything else) the save is the newest that loads, by the write count each save carries (one past the newest in either slot), and with none there's no save. `saveStatus`, `load`, writes, and removals all agree on it, so Continue never shows for a save that isn't there, and a load never calls a missing save damaged.

Removing the save goes other slot, then the save's, then `active`, so a crash part way leaves the save or nothing, never the save before it. `active` goes whenever it's set, even when it names nothing.

Rejected:

- One key written in place. Under the whole-write contract a crash can't tear it either, and it's simpler; the two slots were kept for now because the save before sits beside the save, which a restore path (DDB-414) could fall back to. Collapsing to one key is DDB-435.
- Writing a temporary key, then copying it over the save. Two full writes a save, and a crash between them leaves two candidates for the load to choose between.

## Failing safely

A call that fails rejects with a `CampaignStoreError` (checkpoints hand theirs to listeners instead). Its `message` is a whole sentence for the player, its `reason` says which kind of failure it is, and `detail` and `cause` carry what went wrong underneath, such as the reader's path-named error:

- `storage`: storage threw. A quota error reads "storage is full", a SecurityError "storage is blocked", anything else "storage failed". A failed write leaves the save before where `active` names it. With no `active` naming a save (none yet, or after a delete), a write that fails after its slot is written can still be found by the newest-that-loads rule, so a save that rejected can turn up as the save.
- `damaged`: a save of this version isn't JSON, isn't a stamped save, or `Campaign.fromJSON` refuses it. Anything that throws while reading a save of this version counts, a bug in the reading code included, so one bad save can't lock the player out of the menu: the slot never counts as a save that loads, it's copied before anything replaces it, and only `load` fails, logging a throw that isn't a reader error as an error. `saveStatus` reads only the stamp's version, never the campaign.
- `unsavable`: the campaign can't be written, because `toSaveText` refused it (an escort out of range, which the convoy allows between checks); nothing is written. `end` with an ending that doesn't exist fails this way too, at once, before it queues.
- `retired`: the campaign has ended, its save was deleted or loaded again, or a new campaign replaced it (below). `save` and `end` reject with it, recording nothing; a checkpoint of a retired campaign tells no listener, since a game over isn't a failed save, and resolves `ended` when the campaign's end is in the history, or `retired` when the store has just moved on from it.

A damaged save is copied to the recovery key before anything writes over it or removes it: the save's own slot when `active` moves off it or it's removed, and any slot no `active` vouches for. Only one copy is ever needed per write or removal, so the one kept is the save, never the save before it. A load that fails copies the save straight away and leaves it in its slot. If a copy fails, the write fails with it, except for a delete the player asked for when storage is too full to hold the copy: that goes ahead with a warning, so a full storage can't trap the player behind a save nobody can read. The recovery key holds the most recent save set aside, for a person to restore (DDB-414 is a restore path); a second damaged save replaces the first copy. An outdated save is never copied: it isn't damaged, just from another version. All of this holds for one tab of a build; two tabs of one build can still write over each other's saves until DDB-415's single-writer lock.

Warnings (map param repairs, a history set aside or started over) are collected while the store decides, and handed to `onWarning` once it has, even when a later step fails, so a callback that throws or rejects is logged and changes nothing.

## Which campaign the save belongs to

Every campaign instance the store loads or saves is tagged with the lineage of the save it belongs to, and only the current lineage's instances are saved. Loading the save, ending its campaign, deleting it, and saving a new campaign each start a new lineage, so the instance a load hands out is the only one that saves, and a run screen left running after a plain Continue, or holding a campaign the menu abandoned, deleted, or replaced, can't write it back. Ending or deleting retires the lineage only once the steps that can fail before anything is removed (reading storage, copying a damaged save, writing the history line) have passed, so a call that fails early leaves the campaign saving. If a removal fails part way, the store owes it: the next `saveStatus`, `load`, `delete`, or `end` of that campaign finishes it first, and a new campaign's save drops it. An end retried after its removal failed answers with the entry the first end recorded, however the retry ends it; an end after a delete whose removal failed finishes the removal, then is refused as `retired`, recording nothing. An instance the store never tagged that's passed to `end` goes into the history and is retired on its own, leaving the save alone.

The lineage lives in each store's memory, so a second tab of one build has its own and can write a campaign the first tab ended or deleted. Two tabs of one build aren't supported until a single-writer lock lands (DDB-415).

## The history

`history` holds `{ version, campaigns }`, newest first, each entry `{ seed, day, strongholdsTaken, ending }`, about 70 characters. It's kept apart from the save: Continue never reads it, and the history list never reads a save. The seed is there because the spec shows it in campaign history; `day` is the day the campaign ended on, from which the menu tells days survived. The endings are `starved`, `rioted`, and `disbanded` for the compound's fall, `won`, and `abandoned` for a campaign given up for a new one. A fall comes only from the campaign's own end: `end` records a campaign that's over with its own ending, whatever it's given, and one still standing as won or abandoned ([campaign-end.md](./campaign-end.md)). Unlocks earned (Game Flow 1.1) join with a version bump once unlocks exist. `end` records the campaign as it stood when it was called.

An entry equal to the newest one isn't added again. A new session after a crash between recording a campaign and removing its save doesn't know the campaign ended, so that heals the crash only when the campaign is ended the same way again; ended another way (abandoned from New Campaign, say), it gets a second line. Entries carry no campaign identity, so two campaigns on one seed that end the same way on the same day, back to back, also read as one.

A damaged history is copied to its own recovery key; `history()` fails as `damaged`, and the next `end` starts a new list. The history and the recovery copies are written in place, so they rely on a single write landing whole, as the storage contract says.

## Randomness and map attempts

No `Rng` is saved. Campaign-time draws fork a stream per event from the seed and a saved counter, `nextDriverNumber` being the first such counter, so nothing is saved partway through a sequence.

The seed is checked on load as an integer from 0 to 2^32 - 1 (`readSeed` in `core/JsonReader.ts`, shared by founding, the campaign, its map params, and the history), so a save whose seed is a string, null, or a number JSON reads as Infinity (`1e999`) fails as damaged. `new Rng({ seed })` throws on a seed that isn't a number but coerces NaN and Infinity to 0, which would quietly build seed 0's map.

Loading rebuilds the map from its streams, which nest: each stage's stream forks from the winning stream of the stage before it ([map-pipeline-worker.md](./map-pipeline-worker.md)), so the campaign keeps the map attempt and every stage's winning attempt, `mapAttempts`, since the last stage's stream hangs from all of them. It's `{ map, stages }`, a uint32 map attempt and a uint32 attempt for each stage by its name, read strictly like the rest of the save and fixed at founding beside the seed and the params; null for a campaign built without a map, as tests build them. The reader takes any stage name; the pipeline checks the names when it replays them. What's changed on the map since founding (`map`) is still opaque JSON, nested at most 100 levels as the stop tables are (`MAX_JSON_DEPTH`), so a save nested deeper fails as damaged instead of overflowing the stack.

## The area map

Saves don't keep the map's lines until DDB-436, so a loaded campaign's map is made again from its seed, params, and `mapAttempts`, in the generation worker: the runner replays each stage once on the attempt that won it, which makes the map founding made, bit for bit. That takes as long as founding's generation, about a second.

`CampaignMaps.shared` keeps the session's map. Founding hands over the map it just made. Continue starts making the loaded campaign's map and opens the next screen without waiting (`prepare`); a screen that needs the map awaits `getAreaMap(campaign, { onProgress, signal })` and shows the progress while it's being made, which by then is usually done or nearly so, and aborts the signal if it unmounts first, which stops its wait and leaves the map being made. The cache keys the map by the generator version, the seed, the params, and the attempts, so a later load of the same campaign reuses it, and keeps one campaign's map at a time.

A save names the pipeline's stages in `mapAttempts.stages`, so adding, removing, or renaming a stage bumps `AREA_MAP_GENERATOR_VERSION`, the one constant in `map/GeneratorVersion.ts`, and leaves `CAMPAIGN_SCHEMA_VERSION` alone. The store reads an older save as outdated, which the menu explains, instead of loading it with attempts its map can't replay, and the format's version, fixture, and history stay as they were. A test in `CampaignMaps.test.ts` pins the stage list to the generator version, so a stage change fails it until the version goes up. A change inside a stage that makes something else from the same streams isn't caught unless its author bumps the version too: otherwise an older save of that build loads onto the map the new code makes, which holds until saves keep the map's lines.

## Consequences

- Founding saves with `CampaignStore.shared.save(campaign)`; a failure there means the new campaign isn't saved, and the message says why.
- The main menu reads `saveStatus()`: Continue on `'saved'`, a note that a campaign from another version can't be continued on `'outdated'`. It opens the save with `load()` and picks its words for a failure from `reason`. New Campaign over a save in progress calls `end({ ending: 'abandoned' })` to keep it in the history, or `delete()`; over an outdated save it can simply save the new campaign.
- The run and compound screens call `checkpoint` at the end of each step, start the next step only after it or on a later frame, subscribe to `onSaveFailed` for a "couldn't save" notice, and call `end` when the campaign is won. The checkpoint after the step that loses the campaign ends it in the store by itself ([campaign-end.md](./campaign-end.md)).
- Bumping `CAMPAIGN_SCHEMA_VERSION` invalidates every existing save of a build, and starts its history over. `Campaign.test.ts` pins the format to it (the fixture's key paths, and a history entry's and list's fields), so a change that moves the pin fails until the version goes up with it.
- Bumping `AREA_MAP_GENERATOR_VERSION` makes every existing save of a build that has a map outdated, and leaves the history alone. `CampaignMaps.test.ts` pins the pipeline's stage names to it.
- The area map screen (DDB-43) and the run loop's routes read the map with `getAreaMap(campaign)`, and show `mapProgressText` while they wait.
- Saves of builds that are gone stay in the playtesters' local storage until they clear it, and count against the origin's quota.
- The recovery keys hold one save and one history each.

## Provisional calls

Made here, each a line or a value to change:

- A loaded campaign's map is started on Continue and awaited where it's needed, rather than made before Continue opens anything or only when a screen first asks. Continue never waits, the worker keeps the frame free, and the map is usually ready before the player reaches a screen that needs it.
- The session keeps one campaign's map. Asking for another's cancels or drops it.
- Making a saved map again runs no checks, so a check added later never moves a saved map, and a map the checks would now refuse still loads.
- Adding, removing, or renaming a stage bumps `AREA_MAP_GENERATOR_VERSION`, not the save format version, and the store reads a save whose map is from another generator version as outdated. A change inside a stage that moves maps bumps it only if its author chooses to; otherwise older saves of that build load onto the new map.
- A campaign without map attempts is never outdated by its generator version, since it has no map to make again; only tests build those.
