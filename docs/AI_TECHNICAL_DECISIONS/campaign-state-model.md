# Campaign state model and its save format (DDB-282)

Date: 2026-10-06. Code: `src/renderer/game/campaign/`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Terms, Resources, The driver pool, Decks and the locker), [Area Map Generation](../specs/Area%20Map%20Generation.md) (Saving). Follows [compound-and-area-map.md](./compound-and-area-map.md), decisions 1, 3, and 7, and uses [seeded-prng.md](./seeded-prng.md).

## Context

Nothing outlived a fight. The combat screen rebuilt both drivers from their archetype every time, `Battle.endCombat` returned an `AfterFight` nothing read, `Convoy` only lived in tests, and the one thing persisted anywhere was `GameSettings`. The compound campaign needs a single object holding everything a save keeps: the seed and map, the day, the compound's stores and unrest, the driver pool, the locker, the convoy, strongholds taken, and a log. Saving (DDB-49), founding (DDB-284), and the combat bridge (DDB-286) all build on it, so the model and its JSON come first.

## Two models, read-only from outside, checked on every change

`Campaign` and `DriverRecord` are Models the way `Driver` and `Convoy` are: a static property set, a merged interface, named-param constructors, change events. Two things differ.

- The merged interface is `Readonly<Data>`, and lists are readonly arrays, so `campaign.day = 2` or `campaign.drivers.push(record)` doesn't compile. A change goes through `set`.
- `set` is overridden to check the whole merged state first, with the same reader a save goes through, and throws without changing anything if the result is invalid. The constructor runs it too, since Model's constructor calls `set`.

So whatever `toJSON` writes, `fromJSON` reads. A bug that would have written an unloadable save throws at the `set` that caused it, with the caller on the stack, instead of at some later load. Stored values are frozen (arrays, resources, card counts, log entries, map JSON), so nothing changes around the check.

The alternatives: the plain Model pattern, writable properties checked only on load, finds a bad write at the next load, far from its cause; a method per mutation (advance the day, spend fuel) needs rules this ticket doesn't own. Later tickets add those methods where a rule lives; `set` is the checked floor under them. Model's `set` stays public, which is fine now that it checks.

## Driver ids come from a saved counter

The ticket asked for ids drawn from the campaign RNG. A stream rebuilt from its seed after a load replays from its first draw, so the first driver recruited after a load would draw the same id as the first founding driver. Instead the campaign saves `nextDriverNumber` and hands out `driver-1`, `driver-2`, and on, from `recruitDriver` only, which checks the archetype before it names anyone. It's deterministic, readable in a save, and never repeats: `set` refuses to turn the counter back, even with the pool emptied, so dropping drivers can't bring an id round again. A record's `id` shadows Model's per-instance id, which is random (DDB-99) and is never saved.

Nothing in the model draws randomness, and the seed comes in from founding. When something later needs a draw (an archetype for a Find: driver, say), it forks a fresh stream for that one event from the seed and a saved counter, `new Rng({ seed }).fork('recruit', n)`, never a stream kept across a save.

## Default decks and the locker are card-type counts

`CardCounts` is a frozen `{ cardType: count }` object with positive counts only and keys sorted, so equal counts write identical JSON. Copies have no identity, so "every copy is in exactly one place" is a property of the operations: `Campaign.moveCards` takes copies from one place and adds them to another after checking the source holds enough, and it's how copies travel between the locker and default decks. It works out both ends before storing either, so a move that fails part way changes nothing. It enforces no deck rules. Size limits (8 to 20) and archetype-only cards are the Crew screen's (DDB-310, DDB-317), and run decks are DDB-315.

`moveCards` refuses a dead or missing driver at either end. A driver killed on a run is gone with their deck (Compound and Supply Runs, The driver pool), so nothing goes into it or comes back out; a missing driver isn't at the compound to hand cards to or take them from. An injured driver is, healing in the infirmary, so their deck can still change.

Card types are checked for shape (lower snake case), not against `cards.json`, which loads asynchronously. Nothing upgrades a card yet; when something does, an upgraded copy needs a key of its own (or a richer count) and a schema bump.

## Driver records

`id`, `archetype`, `name`, `hitpoints` and `maxHitpoints` (the combat `Driver`'s names, since DDB-286 copies them across), `injuredDays`, `handLimit`, `defaultDeck`, `status` (ready, injured, dead, missing), and `runsCompleted`.

- HP runs from 0 to max, and max is at least 1. A driver is dead exactly when their HP is 0: the dead have none, the living some.
- `injuredDays` is above 0 exactly while injured. It's "fit in N days", which load out shows.
- The dead and the missing stay in the pool, which the Crew screen lists for the record.
- A new record defaults to its archetype's config: max HP, all of it, the hand limit (`DRIVER_CONFIGS[archetype].handLimit`, DDB-285), and the starting deck, ready.
- The name is the archetype's title and an ordinal, "Road Warrior 2", counting every driver of that archetype the compound has had, dead included, so no two share one. It's stored, so the names DDB-318 decides on can replace it.

## The save is strict JSON with a schema version

`toJSON` writes fresh plain JSON, so `JSON.stringify(campaign)` is the save. `Campaign.fromJSON` takes the parsed value:

- `schemaVersion` is read first. It's an integer from 1; a version newer than the build is refused, and an older one goes through `migrateSave`, one step per version from `CAMPAIGN_MIGRATIONS` (empty while 1 is the only version), each step's result stamped with the version it reached.
- Every object must have exactly its fields. Missing and unknown fields both throw, as map presets do, so a renamed field can't vanish quietly. Map params are the one exception (below).
- Errors name where: `Campaign.drivers[1].status must be one of ready, injured, dead, missing, got "sleeping"`. TypeError for the wrong kind of value, RangeError for a value out of range.
- `campaign/__fixtures__/campaign-v1.json` is a version 1 save, which loads and writes back the same. When the version goes up it stays, loading through the migration.

Loading leniently, as `GameSettings` does (defaults for what's missing, unknown keys ignored), was rejected for saves: a damaged campaign would load as a different campaign.

## Resources and unrest are whole numbers, never below 0

People may reach 0; whether that ends the campaign is open (Compound and Supply Runs, open question 2). Whole numbers is the strict choice, and the safe one to start with: loosening it later still reads every old save, tightening it wouldn't. A route's fuel cost that comes out fractional has to be rounded.

## The convoy saves each escort's stat block

An escort saves its name, armor, structure, their maxima, base speed, mods, and crew profile, not a type to look up, because a driven vehicle that carried on unmanned has no type and its stats came from the fight it converted in. Fight state (slot, flank, statuses, shield, spent, seats) isn't saved: the campaign saves between runs, and a loaded escort is off the road and ready. A convoy over its cap after a fight saves as it is.

Drivers go the other way, archetype plus what varies, so retuning `DRIVER_CONFIGS` reaches campaigns in progress and retuning `ESCORT_CONFIGS` doesn't reach escorts already in a convoy.

## Map params: exact in the model, repaired on load

The campaign holds the real `MapParams` (DDB-287), frozen, keys in the table's order, and its seed must be the campaign's. The seed, generator version, and params are fixed at founding, and `set` refuses to change them. Two readers, for two sources:

- `readMapParams`, which the constructor and `set` run, takes params exactly: every parameter, the right types, nothing extra, and nothing `validateMapParams` would change. Founding resolves and validates params before it builds a campaign, so anything else there is a bug.
- `repairMapParams`, which `fromJSON` runs first, expects drift, since the Map Lab will add, drop, and re-range parameters while the table settles, and refusing every older save after the first new parameter would be worse than repairing it. Corruption still throws with its path: params that aren't an object, a seed that isn't a uint32, a parameter with the wrong JSON type. Drift is repaired: a missing or no longer existing environment becomes Mixed, a missing parameter takes its environment's default, an unknown one is dropped, and a value out of range is clamped. Everything else stays as saved.

Each repair is a warning, worded with its path ("Campaign.mapParams.radius was missing; took 1000, the mixed default"). `fromJSON(json, { onWarning })` hands them to the caller, which can show them, and logs them with `console.warn` when it isn't given one. The repaired params are what the campaign saves from then on.

`MapParams` became a `type` rather than an `interface`, a one-word change in the map module, so it fits `JsonObject` and copies like any other JSON. `JsonValue` and `JsonObject` live in `core/Json.ts`, shared by the map and campaign modules.

## Map state is a stand-in

Map state (DDB-275) is opaque JSON, copied and frozen, until the map defines it. `strongholdsTaken` holds ids as strings until the map defines its ids.

The log is `{ day, message }` lines, dated by `addLogEntry` with the current day, in day order, none after today. Plain text for now; campaign history may want structured entries later, which is a schema bump.

## Consequences

- Saving (DDB-49) writes `JSON.stringify(campaign)` and loads with `Campaign.fromJSON(JSON.parse(text), { onWarning })`; anything thrown means the save can't be loaded, and warnings mean it loaded with its map params repaired.
- Founding (DDB-284) builds `new Campaign({ seed, generatorVersion, mapParams, map, resources })` and calls `recruitDriver` for each starting driver.
- The combat bridge (DDB-286) builds combat drivers from records and writes HP, status, and injured days back in one `set`.
- Until saves ship, the format can change without a version bump if the fixture changes with it. After that, every change bumps the version and adds a migration.
- A checked `set` can still replace a whole deck or the locker, which makes or destroys copies; `moveCards` is the path that conserves them.
