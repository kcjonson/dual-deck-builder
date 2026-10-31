# Saving and loading a campaign (DDB-49)

Date: 2026-10-07, revised 2026-10-10 for the area map (DDB-467). Code: `_legacy/src/renderer/game/campaign/CampaignStore.ts`, `CampaignHistory.ts`, `CampaignMaps.ts`, and `Campaign.toSaveText`. Storage is salal app's `SaveStore` (salal's `docs/app-api.md`, "Game state and saves"). Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Terms), [Area Map Generation](../specs/Area%20Map%20Generation.md) (Saving), [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) (1.1). Builds on [campaign-state-model.md](./campaign-state-model.md).

## Context

The campaign model writes and reads its own JSON, but nothing kept it, so a campaign lasted as long as the session. A campaign is one save from founding to its fall, so the game needs an active save that survives a restart, a list of past campaigns for the main menu, saves after every step that changes the campaign, and a safe failure when a save can't be read. Founding (DDB-284), the main menu (DDB-283), and the run and compound screens all call the store this record describes.

## The store

`CampaignStore` holds one active save and a history list over the App's `SaveStore`, the save and the history each in a slot of its own. The game's instance lives in the game's context object, which every scene reaches; a test builds its own over a `SaveStore` in a directory of its own, with a format version of its choosing.

- `saveStatus()`: `'none'`, `'saved'`, or `'outdated'`, without loading the save. The main menu shows Continue on `'saved'`, and says a campaign from another version can't be continued on `'outdated'`. `hasSave()` is `saveStatus() === 'saved'`.
- `load()`: the campaign in progress, or null (none, or outdated). What Continue opens; the menu's summary line ("Day 12 - 3 drivers - 1 stronghold taken") reads from the loaded campaign.
- `save(campaign)`: writes it, and fails if it can't. Founding saves a new campaign with it.
- `checkpoint(campaign)`: what the run and compound screens call at the end of each step. It never fails to its caller: it returns `failed` after telling `onSaveFailed` listeners why, so a screen can fire it and move on while one notice in the UI covers every failure. Otherwise it returns `saved`, `ended` (the campaign's end is in the history, [campaign-end.md](./campaign-end.md)), or `retired` (below).
- `end({ campaign, ending })`: the campaign goes into the history and its save goes. A campaign that's over (`Campaign.end`) goes in with its own ending, and a checkpoint or save of one ends it this way instead of writing it ([campaign-end.md](./campaign-end.md)).
- `delete()`: the save goes without a history line.
- `history()`: past campaigns, newest first.

Calls take effect in the order they're made: a load right after a save reads it, and two writes never interleave.

## Saves are stamped with the save format version

Every save and the history carry the save format version, the game's `SaveFormat` version that salal's store writes into each file's envelope, bumped by hand whenever the campaign's saved JSON, or a history entry, changes shape. A save stamped with another version, older or newer, isn't loaded: salal's store reports a newer one as `NewerThanBuild` and an older one with no upgrade step as `UpgradeFailed`, and leaves both as they were. `saveStatus` calls it outdated, `load` passes it by, and a new campaign or a delete replaces it (salal's store keeps a newer build's save aside as `<slot>.save.v<N>`, which nothing reads).

A save of this version whose campaign's map another version of the area map generator made is outdated the same way: it has map attempts, and its generator version is other than this build's (`AREA_MAP_GENERATOR_VERSION` in `_legacy/src/renderer/game/map/GeneratorVersion.ts`), so its map can't be made again here (The area map, below). `saveStatus` reads that one field beside the stamp, still without loading the campaign. A history from another version starts over on the next ending.

So bumping the version invalidates every existing save, which is the trade for not carrying migrations while the format moves this fast. An upgrade step (one of `SaveFormat`'s `upgrades`) is written only where an old save's meaning in the new format is obvious.

Rejected:

- Migrations: each one is code to write and test for a format nobody keeps for long during playtesting, and a newer build's save was still unreadable to an older one.

## When to save: checkpoints at the end of each step

The screens call `checkpoint` when a stop resolves, on arriving home, and at the end of each compound action (a Crew screen move, a garage purchase, a rest day). Not on change events:

- Not everything a save holds emits on the campaign. A record changes on the record, an escort's damage on its own `Vehicle`, and escorts joining or leaving on the convoy.
- A fight or a compound action makes many small changes, and a write per change would write the same campaign dozens of times for one step.
- A step's end is what a save should land on. Quitting loses at most the step in progress.

A save holds whole steps. A checkpoint captures the campaign once the step's code has run, never partway through it, so the next step starts only after it. A save asked for from a listener partway through a step (a record's `change` fires partway through a card move, before the locker is stored) still has to capture the whole step.

## Writing a save whole

Salal's store writes each save whole: a temp file, flushed, then renamed over the slot, with the save it replaces kept as the slot's backup, so at every moment the slot holds the save before or the new one, never a torn file. Each file's envelope carries a CRC, so a damaged file reads as damaged, never as some other campaign. Writing a campaign that hasn't changed since its save writes nothing.

`saveStatus` reads the slot's header alone (its version, and whether it's whole), and only `load` reads the campaign, so Continue never shows for a save that isn't there, and a load never calls a missing save damaged.

## Failing safely

A call that fails says why (checkpoints hand theirs to listeners instead): a whole sentence for the player, a `reason` saying which kind of failure it is, and what went wrong underneath, such as the reader's path-named error:

- `storage`: the store couldn't write or remove the save. A failed write leaves the save before.
- `damaged`: a save of this version that salal's store reads as `Corrupt` (a short file, a bad CRC), that isn't JSON, or that `Campaign.fromJSON` refuses. Anything that throws while reading a save of this version counts, a bug in the reading code included, so one bad save can't lock the player out of the menu: only `load` fails, logging a throw that isn't a reader error as an error. `saveStatus` reads only the stamp, never the campaign.
- `unsavable`: the campaign can't be written, because `toSaveText` refused it (an escort out of range, which the convoy allows between checks); nothing is written. `end` with an ending that doesn't exist fails this way too, at once.
- `retired`: the campaign has ended, its save was deleted or loaded again, or a new campaign replaced it (below). `save` and `end` fail with it, recording nothing; a checkpoint of a retired campaign tells no listener, since a game over isn't a failed save, and returns `ended` when the campaign's end is in the history, or `retired` when the store has just moved on from it.

Nothing a write replaces is lost: salal's store keeps the save before as the backup (`restoreBackup` swaps them back), and copies a damaged save aside as `<slot>.save.corrupt` before a new save goes over it, for a person to restore. An outdated save is never treated as damaged: it isn't, just from another version.

Warnings (map param repairs, a history set aside or started over) are collected while the store decides, and handed to `onWarning` once it has, even when a later step fails, so a callback that throws is logged and changes nothing.

## Which campaign the save belongs to

Every campaign instance the store loads or saves is tagged with the lineage of the save it belongs to, and only the current lineage's instances are saved. Loading the save, ending its campaign, deleting it, and saving a new campaign each start a new lineage, so the instance a load hands out is the only one that saves, and a run screen left running after a plain Continue, or holding a campaign the menu abandoned, deleted, or replaced, can't write it back. Ending or deleting retires the lineage only once the steps that can fail before anything is removed (reading the save, writing the history line) have passed, so a call that fails early leaves the campaign saving. If a removal fails part way, the store owes it: the next `saveStatus`, `load`, `delete`, or `end` of that campaign finishes it first, and a new campaign's save drops it. An end retried after its removal failed answers with the entry the first end recorded, however the retry ends it; an end after a delete whose removal failed finishes the removal, then is refused as `retired`, recording nothing. An instance the store never tagged that's passed to `end` goes into the history and is retired on its own, leaving the save alone.

The lineage lives in the store's memory. Two copies of the game running on one saves directory each keep their own and don't coordinate: salal's store lets the later write win.

## The history

The history is the campaigns, newest first, each entry `{ seed, day, strongholdsTaken, ending }`, about 70 characters. It's kept apart from the save: Continue never reads it, and the history list never reads a save. The seed is there because the spec shows it in campaign history; `day` is the day the campaign ended on, from which the menu tells days survived. The endings are `starved`, `rioted`, and `disbanded` for the compound's fall, `won`, and `abandoned` for a campaign given up for a new one. A fall comes only from the campaign's own end: `end` records a campaign that's over with its own ending, whatever it's given, and one still standing as won or abandoned ([campaign-end.md](./campaign-end.md)). Unlocks earned (Game Flow 1.1) join with a version bump once unlocks exist. `end` records the campaign as it stood when it was called.

An entry equal to the newest one isn't added again. A new session after a crash between recording a campaign and removing its save doesn't know the campaign ended, so that heals the crash only when the campaign is ended the same way again; ended another way (abandoned from New Campaign, say), it gets a second line. Entries carry no campaign identity, so two campaigns on one seed that end the same way on the same day, back to back, also read as one.

A damaged history fails `history()` as `damaged`, and the next `end` starts a new list; salal's store copies the damaged one aside when it's written over.

## Randomness and map attempts

No `Rng` is saved. Campaign-time draws fork a stream per event from the seed and a saved counter, `nextDriverNumber` being the first such counter, so nothing is saved partway through a sequence. The streams are salal's `foundation/random/Rng.h`.

The seed is checked on load as an integer from 0 to 2^32 - 1 (founding, the campaign, its map params, and the history share the check), so a save whose seed is anything else fails as damaged instead of quietly building another seed's map.

Loading rebuilds the map from its streams, which nest: each stage's stream forks from the winning stream of the stage before it ([map-pipeline-worker.md](./map-pipeline-worker.md)), so the campaign keeps the map attempt and every stage's winning attempt, `mapAttempts`, since the last stage's stream hangs from all of them. It's `{ map, stages }`, a uint32 map attempt and a uint32 attempt for each stage by its name, read strictly like the rest of the save and fixed at founding beside the seed and the params; null for a campaign built without a map, as tests build them. The reader takes any stage name; the pipeline checks the names when it replays them. What's changed on the map since founding (`map`) is still opaque JSON, nested at most 100 levels as the stop tables are, so a save nested deeper fails as damaged instead of overflowing the stack.

## The area map

Saves don't keep the map's lines until DDB-436, so a loaded campaign's map is made again from its seed, params, and `mapAttempts`, in the background: the runner replays each stage once on the attempt that won it, which makes the map founding made, bit for bit. That takes as long as founding's generation, about a second.

The session keeps one campaign's map, in the game's context object. Founding hands over the map it just made. Continue starts making the loaded campaign's map and opens the next screen without waiting; a screen that needs the map waits for it and shows the progress while it's being made, which by then is usually done or nearly so, and leaving the screen stops its wait and leaves the map being made. The cache keys the map by the generator version, the seed, the params, and the attempts, so a later load of the same campaign reuses it.

A save names the pipeline's stages in `mapAttempts.stages`, so adding, removing, or renaming a stage bumps the generator version and leaves the save format version alone. The store reads an older save as outdated, which the menu explains, instead of loading it with attempts its map can't replay, and the format's version, fixture, and history stay as they were. A test pins the stage list to the generator version, so a stage change fails it until the version goes up. A change inside a stage that makes something else from the same streams isn't caught unless its author bumps the version too: otherwise an older save loads onto the map the new code makes, which holds until saves keep the map's lines.

## Consequences

- Founding saves with the store's `save`; a failure there means the new campaign isn't saved, and the message says why.
- The main menu reads `saveStatus()`: Continue on `'saved'`, a note that a campaign from another version can't be continued on `'outdated'`. It opens the save with `load()` and picks its words for a failure from `reason`. New Campaign over a save in progress calls `end({ ending: 'abandoned' })` to keep it in the history, or `delete()`; over an outdated save it can simply save the new campaign.
- The run and compound screens call `checkpoint` at the end of each step, start the next step only after it, subscribe to `onSaveFailed` for a "couldn't save" notice, and call `end` when the campaign is won. The checkpoint after the step that loses the campaign ends it in the store by itself ([campaign-end.md](./campaign-end.md)).
- Bumping the save format version invalidates every existing save and starts the history over. A test pins the format to it (the fixture's key paths, and a history entry's fields), so a change that moves the pin fails until the version goes up with it.
- Bumping the generator version makes every existing save that has a map outdated, and leaves the history alone. A test pins the pipeline's stage names to it.
- The area map screen (DDB-43) and the run loop's routes wait for the map from the session's cache, and show its progress while they wait.

## In the C++ alpha

`libs/rules/campaign/CampaignJson.h` (2026-10-31, DDB-573) reads and writes the campaign's JSON, and [campaign.md](./campaign.md) has how. Storing it in a slot, the history, and checkpoints are the game app's, over salal's `SaveStore` (`apps/wasteland-wheels/CampaignStore.h`, 2026-10-31, DDB-575), and [game-app.md](./game-app.md) has how. What differs:

- The JSON carries its version, `kSaveVersion`, 6 since an event's fight and a run's progress past its stops, which the game hands salal's `SaveFormat` too, so the rules refuse a save of another version without seeing the envelope.
- It names the packs it was made with and loads only with all of them loaded. Every card, archetype, and escort type it holds has to resolve in the loaded packs, where this record let a dropped card load.
- There's no generator version. The save keeps the map's origin, its params, the map attempt, each stage's winning attempt by name, and a fingerprint of what the campaign's ids name on the map, and `loadCampaign` (`CampaignMap.h`) makes the map again and checks it: attempts that don't fit the pipeline fail before any stage runs, and a map with another fingerprint fails after, so a generator change that moves a POI, leg, or stop fails the load by itself, where this record had its author bump a version or load old saves onto a new map. Every id the map state holds is checked against the made map too.
- An engine bump can be such a change. Salal v0.30's `fractalNoise2` offsets its octaves (terrain-fields.md, Noise is the engine's), so pinning v0.30.1 (2026-10-31) moved every map, and every campaign saved on v0.19.0 fails its map fingerprint on load. That's fine in the alpha, which keeps no compatibility; there's no migration, and a campaign founded since loads.
- A load returns the map beside the campaign, made in the same call, for the game to hold, rather than started on Continue and waited for where it's needed. Making it again runs no checks, as above, and takes a whole generation, so the game loads off the frame, on Continue, before any scene that needs the map opens. The session holds one campaign's map, the one its founding or its load made.
- The store has no lineage. A scene saves the session's campaign at the end of each step, and only the session's, so nothing left running holds another copy to write back. The store's statuses are salal's: a newer or older format reads as another save format, a damaged file or a campaign the rules refuse as damaged, the reader's path in the line under Continue.
- A new campaign writes its save first and puts the one it replaced into the history after, so a failed history write never costs the new campaign; the history is `{seed, day, strongholdsTaken, ending}` as above, in a slot of its own.

## Provisional calls

Made here, each a line or a value to change:

- A loaded campaign's map is started on Continue and waited for where it's needed, rather than made before Continue opens anything or only when a screen first asks. Continue never waits, the map is made off the frame, and it's usually ready before the player reaches a screen that needs it.
- The session keeps one campaign's map. Asking for another's cancels or drops it.
- Making a saved map again runs no checks, so a check added later never moves a saved map, and a map the checks would now refuse still loads.
- Adding, removing, or renaming a stage bumps the generator version, not the save format version, and the store reads a save whose map is from another generator version as outdated. A change inside a stage that moves maps bumps it only if its author chooses to; otherwise older saves load onto the new map.
- A campaign without map attempts is never outdated by its generator version, since it has no map to make again; only tests build those.
