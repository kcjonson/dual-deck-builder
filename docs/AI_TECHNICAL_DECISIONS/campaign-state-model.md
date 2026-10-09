# Campaign state model and its save format (DDB-282)

Date: 2026-10-06. Code: `src/renderer/game/campaign/`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Terms, Resources, The driver pool, Decks and the locker), [Area Map Generation](../specs/Area%20Map%20Generation.md) (Saving). Follows [compound-and-area-map.md](./compound-and-area-map.md), decisions 1, 3, and 7, and uses [seeded-prng.md](./seeded-prng.md).

## Context

Nothing outlived a fight. The combat screen rebuilt both drivers from their archetype every time, `Battle.endCombat` returned an `AfterFight` nothing read, `Convoy` only lived in tests, and the one thing persisted anywhere was `GameSettings`. The compound campaign needs a single object holding everything a save keeps: the seed and map, the day, the compound's stores and unrest, the driver pool, the locker, the convoy, strongholds taken, and a log. Saving (DDB-49), founding (DDB-284), and the combat bridge (DDB-286) all build on it, so the model and its JSON come first.

## Two models, read-only from outside, checked on every change

`Campaign` and `DriverRecord` are Models the way `Driver` and `Convoy` are: a static property set, a merged interface, named-param constructors, change events. Two things differ.

- The merged interface is `Readonly<Data>`, and lists are readonly arrays, so `campaign.day = 2` or `campaign.drivers.push(record)` doesn't compile. A change goes through `set`.
- `set` is overridden to check the whole merged state first, with the same reader a save goes through, and throws without changing anything if the result is invalid. The constructor runs it too, since Model's constructor calls `set`.

So whatever `toJSON` writes, `fromJSON` reads. A bug that would have written an unloadable save throws at the `set` that caused it, with the caller on the stack, instead of at some later load. Stored values are frozen (arrays, resources, card counts, log entries, map JSON), so nothing changes around the check.

A check doesn't redo what's already been checked. The readers hand back frozen values they made earlier as they are (resources, strongholds, map params, map JSON), the pool and the log are compared with the ones held, and a log that only grows has just its new entries checked, against the newest one before them. So `set({ unrest })` costs the same at 2,000 log entries as at none (about 20 microseconds, against 4.4 ms when every set re-read the log), and setting a value the campaign already holds changes nothing and says nothing.

The alternatives: the plain Model pattern, writable properties checked only on load, finds a bad write at the next load, far from its cause; a method per mutation (advance the day, spend fuel) needs rules this ticket doesn't own. Later tickets add those methods where a rule lives; `set` is the checked floor under them. Model's `set` stays public, which is fine now that it checks.

## What a campaign's change event covers

The campaign's `change` covers its own fields and finished card moves (below). Records, escorts, and the convoy emit on their own models and not on the campaign: a combat bridge setting a record's HP emits on the record, an escort taking damage on its own `Vehicle`, and escorts joining or leaving on the convoy. So saving happens at checkpoints, `CampaignStore.checkpoint` at the end of each step (a stop resolving, arriving home, a compound action), not on change events. A save asked for from a listener is taken once the code that set it off has run, so it's whole for a synchronous step like a card move, but a step that awaits part way is captured as it stood at the await ([campaign-save-and-load.md](./campaign-save-and-load.md)).

A record listener has three things to know about a card move:

- Mid-move it can see a copy in two places or in none: the giving deck is stored before the receiving one, and both before the locker.
- `Campaign.set` or `addLogEntry` from it throws, since the campaign refuses every change while a move is stored, and the event emitter catches and logs the throw, so the listener's change is lost without the move noticing.
- A move whose copies bounce back to the giving driver or the locker (below) returns as if it had landed; the caller gets no signal.

## Driver ids come from a saved counter

The ticket asked for ids drawn from the campaign RNG. A stream rebuilt from its seed after a load replays from its first draw, so the first driver recruited after a load would draw the same id as the first founding driver. Instead the campaign saves `nextDriverNumber` and hands out `driver-1`, `driver-2`, and on, from `recruitDriver` only, which checks the archetype before it names anyone. It's deterministic, readable in a save, and never repeats: `set` refuses to turn the counter back.

The pool only grows. Against the pool held before, a `set` must keep the same records in the same places and add any new ones after them, with ids at or past the counter as it stood before the `set`, so a driver can't be dropped or swapped for a hand-built record, and nobody joins with an id the counter has passed. Names aren't checked: only `recruitDriver` never reuses a placeholder name, and a record appended with `set` can repeat one. A record's `id` shadows Model's per-instance id, which is never saved: it's a runtime count that depends on what the session built first.

Nothing in the model draws randomness, and the seed comes in from founding. When something later needs a draw (an archetype for a Find: driver, say), it forks a fresh stream for that one event from the seed and a saved counter, `new Rng({ seed }).fork('recruit', n)`, never a stream kept across a save.

## Default decks and the locker are card-type counts

`CardCounts` is a frozen `{ cardType: count }` object with positive counts only and keys sorted, so equal counts write identical JSON. Copies have no identity, so "every copy is in exactly one place" is a property of the operations: `Campaign.moveCards` takes copies from one place and adds them to another, and it's how copies travel between the locker and default decks; `scrapCards` takes them out of the locker for scrap, the one way a copy leaves on purpose. `cardsOwned` sums every place a copy can be, which no move changes. Run decks (DDB-315) will be places of their own, and join that sum.

`moveCards` keeps the deck rules (Compound and Supply Runs, The rules; [locker-and-deck-rules.md](./locker-and-deck-rules.md)). `getCardMoveBlocker` says why the rules refuse a move, as a typed `CardBlocker` naming the end that refuses, and `moveCards` runs the same check and throws a `CardRuleError` carrying that blocker, so the Crew screen's disabled action and the move can't disagree. A record's listener can see half a move, so the screen asks again on the campaign's `change`, not a record's. The check reads each end's counts as `moveCards` stores them, and the archetype at the receiving place, which is all a run deck has to answer. In the order they're checked:

- `driver_away`: a driver at either end is dead or missing.
- `too_few`: the giving end holds fewer copies than the move takes.
- `other_archetype`: the card is marked for another archetype than the receiving driver's (`driverRestriction` in `cards.json`).
- `deck_full`: the receiving deck would hold more than the most a deck takes.
- `deck_at_minimum`: the giving deck would hold fewer than the fewest.

The limits live in `data/deck-rules.json` and are checked on each move, not on the record. A deck outside them (set directly, loaded from a save, or left there when the limits are retuned) still loads and can move back toward them, and a dead driver's empty deck stays valid. A move no rule covers (a malformed card type or count, a driver from another campaign, a place to itself) throws a plain error from both the check and the move. `scrapCards` scraps locker copies only, at `scrapPerCard` each, in one `set`, and `getScrapBlocker` refuses (`too_few`) when the locker holds fewer than asked. None of this is saved.

A move is stored so nothing sees half of it, or acts on half of it:

- Both ends are checked before either is stored, and for a move between drivers the locker too, since it's where the copies fall back to (below), so a move that would push a count past what it can hold stores nothing.
- Decks are stored before the locker, so the campaign's `change` for a move to or from the locker comes once the move is whole. A move between two drivers ends with a campaign `change` of its own.
- While the decks are being stored, the campaign refuses another `moveCards` and every `set`. A listener on a driver's deck that moved cards or changed the locker then would have its change overwritten by the rest of this one, destroying a copy, and any other change would tell campaign listeners about a campaign holding half a move. Once the campaign's `change` arrives, the move is done and a listener can change the campaign again.
- Records aren't held while a move is stored, so a listener on the giving driver's deck can still change the receiving driver. The copies land on the deck the receiving driver holds once the giving one is stored. If a listener has sent the receiving driver away (dead or missing) by then, or filled their deck so the rules or a count can't take the copies, they go back to the giving driver, or to the locker if the giving driver can't take them either.

`moveCards` refuses a dead or missing driver at either end (`driver_away`). A driver killed on a run is gone with their cards (Compound and Supply Runs, The driver pool), so a dead record's deck is empty, and dying is one `set` of status, 0 HP, and an empty deck; a missing driver isn't at the compound to hand cards to or take them from. An injured driver is, healing in the infirmary, so their deck can still change.

Card types are checked for shape (lower snake case), not against `cards.json`, so a save holding a card the file has since dropped still loads, and the eligibility check takes a card the file doesn't list as anyone's. Nothing upgrades a card yet; when something does, an upgraded copy needs a key of its own (or a richer count) and a schema bump.

## Driver records

`id`, `archetype`, `name`, `hitpoints` and `maxHitpoints` (the combat `Driver`'s names, since DDB-286 copies them across), `vehicle` (their signature vehicle's structure and armor, carried between fights; structure is at least 1, since a wreck limps on, and armor at least 0, with no maximum: a fight clamps both to the archetype's maximums as they stand, so a retune doesn't break a save), `injuredDays`, `handLimit`, `defaultDeck`, `status` (ready, injured, dead, missing), and `runsCompleted`.

- HP runs from 0 to max, and max is at least 1. A driver is dead exactly when their HP is 0: the dead have none, the living some. The dead have no cards either.
- `injuredDays` is above 0 exactly while injured. It's "fit in N days", which load out shows.
- The dead and the missing stay in the pool, which the Crew screen lists for the record.
- A new record defaults to its archetype's config: max HP, all of it, the hand limit (`DRIVER_CONFIGS[archetype].handLimit`, DDB-285), and the starting deck, ready.
- The name is the archetype's title and an ordinal, "Road Warrior 2", counting every driver of that archetype the compound has had, dead included, so no two share one. It's stored, so the names DDB-318 decides on can replace it.

## The save is strict JSON

`toSaveText` writes the save's plain JSON, which `JSON.stringify(campaign)` also writes, and `toJSON` parses back as a copy. `Campaign.fromJSON` takes the parsed value:

- The campaign's JSON carries no version. `CampaignStore` stamps every save with the save format version, `CAMPAIGN_SCHEMA_VERSION`, and only hands `fromJSON` a save of this build's version; there are no migrations ([campaign-save-and-load.md](./campaign-save-and-load.md)).
- Every object must have exactly its fields. Missing and unknown fields both throw, as map presets do, so a renamed field can't vanish quietly. Map params are the one exception (below).
- Every array must hold a value at every index. JSON never makes a hole, but a `set` could pass one, and `map` and `forEach` would skip it unchecked.
- Errors name where: `Campaign.drivers[1].status must be one of ready, injured, dead, missing, got "sleeping"`. A `ReaderTypeError` for the wrong kind of value, a `ReaderRangeError` for a value out of range: still a TypeError and a RangeError, but classes of their own, so a load can tell a damaged save from a bug in the code reading it, and log the bug (it still treats the save as damaged).
- `campaign/__fixtures__/campaign-v2.json` is a campaign at the current format, which loads and writes back the same. When the format changes, the fixture changes with it and the version goes up.

Loading leniently, as `GameSettings` does (defaults for what's missing, unknown keys ignored), was rejected for saves: a damaged campaign would load as a different campaign.

## Resources and unrest are whole numbers, never below 0

People may reach 0; whether that ends the campaign is open (Compound and Supply Runs, open question 2). Whole numbers is the strict choice, and the safe one to start with: loosening it later still reads every old save, tightening it wouldn't. A route's fuel cost that comes out fractional has to be rounded.

## The convoy saves each escort's stat block

The convoy holds at most four escorts, each of a hired type. An escort saves its name, armor, structure, their maxima, base speed, mods, and crew profile as well as its type, so the stats it was hired with stay its own. Fight state (slot, flank, statuses, shield, spent, seats) isn't saved: the campaign saves between fights, and a loaded escort is off the road and ready. An escort needs at least 1 structure, since `Convoy.afterFight` never keeps a wreck.

Drivers go the other way, archetype plus what varies, so retuning `DRIVER_CONFIGS` reaches campaigns in progress and retuning `ESCORT_CONFIGS` doesn't reach escorts already in a convoy.

The convoy and its escorts change outside the campaign's checks (fights, the garage), so `toJSON` reads the convoy it's about to write back in, and throws there: an escort at 41 structure out of 40 fails on write, with its path, instead of writing a save that won't load.

## Map params: complete in the model, repaired on load

The campaign holds the real `MapParams` (DDB-287), frozen, keys in the table's order, and its seed must be the campaign's. The seed, generator version, and params are fixed at founding, and `set` refuses to change them. Two readers, for two sources:

- `readMapParams`, which the constructor and `set` run, takes params whole: every parameter, the right types, a uint32 seed, a known environment, and nothing extra. Ranges and the validator's combination rules are founding's to check, since it resolves and validates params before it makes a map.
- `repairMapParams`, which `fromJSON` runs first, expects drift, since the Map Lab will add, drop, and re-range parameters while the table settles, and refusing every older save after the first new parameter would be worse than repairing it. Corruption still throws with its path: params that aren't an object, a seed that isn't a uint32, a parameter with the wrong JSON type. Drift is repaired: a missing or no longer existing environment becomes Mixed, a missing parameter takes its environment's default, and an unknown one is dropped.

Values today's validator would clamp are kept as saved, for every parameter, not just the geometry ones. The map was made with them, and terrain and scenery are regenerated on load from the params around the saved roads (Area Map Generation, Saving), so a clamped radius, metro size, or mountain coverage would draw ground that no longer fits the roads on it. The network and gameplay parameters were used to make a map that's already saved, or set how play goes in it (daylight hours), so keeping them keeps the campaign as it was. Only missing values and unknown keys are repaired, since there's nothing saved to keep.

Each repair, and each value kept outside today's ranges, is a warning worded with its path: "Campaign.mapParams.radius was missing; took 1000, the mixed default", or "Campaign.mapParams.radius lowered to 1600 (tuning range 600 to 1600) for a new map; this one keeps the 5000 it was made with". Each parameter gets one warning: a value the validator clamps twice (into its range, then by a combination rule) runs from the saved value to the validator's last word, both reasons joined, and a default filled in for a missing parameter says what a new map would take instead, with no claim that a map was made with it. `fromJSON(json, { onWarning })` hands them over once the campaign has loaded, so a save that fails reports only its error, and logs them with `console.warn` when it isn't given a callback. The repaired params are what the campaign saves from then on.

`MapParams` became a `type` rather than an `interface`, a one-word change in the map module, so it fits `JsonObject` and copies like any other JSON. `JsonValue` and `JsonObject` live in `core/Json.ts`, and `StopTables` is a `JsonObject`, so the map and campaign modules share one JSON type.

## Map state is a stand-in

Map state (DDB-275) is opaque JSON, copied and frozen, and nested at most 100 levels, until the map defines it. `strongholdsTaken` holds ids as strings until the map defines its ids.

The log is `{ day, message }` lines, dated by `addLogEntry` with the current day, in day order, none after today. Plain text for now; campaign history may want structured entries later, which is a schema bump.

## Consequences

- Saving (DDB-49, [campaign-save-and-load.md](./campaign-save-and-load.md)) writes `campaign.toSaveText()` at checkpoints, stamped with the save format version, and loads with `Campaign.fromJSON(json, { onWarning })`; a reader error means the save can't be loaded (or, from `toSaveText`, written), and warnings mean it loaded with its map params repaired.
- Founding (DDB-284) builds `new Campaign({ seed, generatorVersion, mapParams, map, resources })` with params it has validated, and calls `recruitDriver` for each starting driver.
- The combat bridge (DDB-286, [combat-bridge.md](./combat-bridge.md)) builds combat drivers from records and writes each back after every fight in one `set`: their HP and their vehicle's structure and armor. Status only changes when a fight fails the run: dead (0 HP and an empty deck) or missing. Injured days are set when a run comes home.
- Every change to the format bumps `CAMPAIGN_SCHEMA_VERSION`, which invalidates every existing save of a build, since there are no migrations; the fixture changes with it.
- A checked `set` can still replace a whole deck or the locker, which makes or destroys copies; `moveCards` is the path that conserves them.
