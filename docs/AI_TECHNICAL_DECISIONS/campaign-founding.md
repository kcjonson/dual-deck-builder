# Founding a campaign (DDB-284)

Date: 2026-10-07, revised 2026-10-10 for the generated map (DDB-467). Code: `src/renderer/game/campaign/Founding.ts`, `CampaignFounding.ts`, and `CampaignStart.ts`, with the starting values in `src/renderer/game/data/campaign-start.json`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Founding the compound, The driver pool, open question 6), [Area Map Generation](../specs/Area%20Map%20Generation.md) (Randomising for the finished game, Validation and retries, Saving). Builds on [campaign-state-model.md](./campaign-state-model.md), [seeded-prng.md](./seeded-prng.md), and [map-params.md](./map-params.md).

## Context

The campaign model (DDB-282) holds everything a save keeps, but nothing made a new one. A new campaign needs its map params, its map, a starting pool with default decks, stores, a locker, a convoy, and a day, and the same seed has to found the same campaign. Two callers found campaigns: the main menu's New Campaign (DDB-283) and the Map Lab's "Start a campaign here" (DDB-299). The area map takes most of a second to generate, in a worker, and whether the player picks the starting pool or it's dealt, and how big it is, is still open (open question 6, DDB-391).

## One function, and everything it uses comes in

`foundCampaign({ seed, unlockedArchetypes, mapParams?, start?, map })` returns a new `Campaign`, synchronously, on an area map already generated (below). The same options found the same campaign, down to its JSON.

- The seed comes in. The caller mints it with `freshSeed()` from `core/Rng.ts`, the one place root seeds come from, or brings the Map Lab's; nothing in `campaign/` reads `Math.random` or crypto, which lint enforces.
- So do the unlocked archetypes. Unlocks live in `DriverLoader` today, a singleton that loads asynchronously, and meta-progression will hold them later. Taking the list keeps founding indifferent to where unlocks live. The main menu founds through `CampaignFounding`, which generates the map and then calls `foundCampaign`:

```ts
const loader = DriverLoader.getInstance();
await loader.loadDrivers();
const founding = new CampaignFounding({
	seed: freshSeed(),
	unlockedArchetypes: loader.getUnlockedDrivers().map(driver => driver.archetype),
	onProgress
});
const { campaign, map } = await founding.result;
```

- Everything is checked before anything is built, so a bad call throws and founds nothing: a seed that isn't a uint32, map params that don't read or were made from another seed, fewer than two archetypes unlocked, a start that doesn't read, or a map generated on other params. `prepareFounding` runs the same checks without the map, and resolves the params to generate it on, so `CampaignFounding` fails a bad call before it spends a generation on it.

Reading `DriverLoader` inside founding was rejected. It would make founding async and tie it to the singleton's load state: an unloaded loader hands out no drivers, which would found a compound with nobody in it.

## Map params: rolled, or given and validated

With no `mapParams`, founding calls `rollParams(seed)`, which draws them on the seed's `params` stream and validates them. A given set (the Map Lab's) is read with the campaign's strict readers (`readMapParamSet` in `MapParamsJson.ts`): a plain object holding a uint32 seed and any of a known environment, finite numbers for the parameters, and stop tables as an object of JSON, each its own field, and nothing else. Every error names the path from `mapParams` and the value found, `mapParams.radius must be a number, got "1400"` or `mapParams.stopTables.highway.raider_ambush must be a finite number, got NaN`, before anything is built. Another realm's plain object reads like this realm's, and its stop tables are copied into this one. A class instance, or an object made on another whose values it would inherit, is refused, so the params founded on are only ever the set's own. Each value is read once, so a getter can't answer the check one way and the copy another, and one that throws is named by its path.

The set's seed must be the campaign's, compared as given. One that isn't a uint32 is refused rather than wrapped: the validator wraps NaN, Infinity, and 0.9 to 0, and 2^32 + 7 to 7, so a set that only matched once wrapped would found on a seed nobody passed, and the error for one that didn't would name the wrapped value instead of the one given.

The set is then filled out from its environment and validated (`validateMapParamSet`). Either way the result goes through the campaign's own params reader (`readMapParams`), which freezes it, and the campaign holds the frozen params as they are. Generation validates before it runs (Area Map Generation, Validation and retries), so these are the params the map is made from. The validator is idempotent, so the Map Lab's validated set comes through untouched.

The map preset reader (`readMapPreset`) takes the same fields but is built for parsed preset files: its errors name no `mapParams.` path, it doesn't look for class instances or inherited values, and its module reads `data/mapPresets/default.json` as it loads, so importing it would carry the shipped presets into every bundle founding is in and fail founding on a bad preset edit. Founding doesn't load the presets, which a test holds.

Refusing a set the validator would change was considered. The Map Lab passes validated params, so a refusal would never fire for the caller it was meant for, and clamping founds on the params the Map Lab made its map from anyway.

## The map is generated first, and kept as its attempts

Generation runs in a worker and takes most of a second, so it can't happen inside a synchronous `foundCampaign`. `CampaignFounding` runs it first: `prepareFounding` for the params, `new MapGeneration({ params, onProgress })`, then `foundCampaign` with the result ([map-pipeline-worker.md](./map-pipeline-worker.md), The founding contract). `foundCampaign` takes the map as a `FoundingMap`, the shape the generation result already has: the params it was made on, its map attempt, and each stage's winning attempt. It refuses a map made on params other than its own resolved ones, which catches a caller generating on one seed and founding on another.

The campaign keeps what makes the map again rather than the map: the seed and params it already held, the generator version (`AREA_MAP_GENERATOR_VERSION`; 1 was the stand-in campaigns were founded on before the generator existed), and `mapAttempts`, the map attempt and the stage attempts, all fixed at founding. Its `map`, what's changed on the map since, starts empty (`EMPTY_MAP`). Saves don't hold the map's lines until DDB-436, so a load makes the map again from those ([campaign-save-and-load.md](./campaign-save-and-load.md), The area map).

Generation can give up on a seed. Past 32 map attempts, release builds take the next seed (Area Map Generation, Validation and retries), but the params and the deal came from the seed founding was given, and every later stream forks from the campaign's seed as well. So the generator gives up with a typed error in every build (`MapPipelineError`, `exhausted: 'map'`) and never moves seed itself, and `CampaignFounding` loops: params, deal, and generation again from the next seed, wrapped to uint32, up to 4 seeds (`FOUNDING_SEEDS`), in release builds, warning each time. Debug builds rethrow at once, and so does any build for params given rather than rolled, since they belong to their seed; the Map Lab, the one caller that passes params, is dev-only anyway. Anything else that stops generation stands at once.

`cancel()` terminates the generation and rejects `result` with `MapGenerationCancelled`, founding nothing, including when the map arrives after the cancel or between one seed and the next. The main menu cancels when the player leaves it.

## The starting pool is dealt

The spec deals four drivers from the unlocked archetypes, no two alike. Founding builds to that text, with the size in the data file so open question 6 can go either way.

- The deal drops repeats, sorts the unlocked archetypes by id, shuffles them on `new Rng({ seed }).fork('founding').fork('pool')`, and takes the first `size`. Sorting first means neither the order they're passed in nor the order of `DRIVER_CONFIGS` moves a seed's deal; unlocking an archetype moves every seed's. It's a step inside `foundCampaign`, not exported, since nothing else deals a pool.
- The dealt order is the order they join, so `driver-1` is the first one dealt.
- Fewer unlocked archetypes than the pool size deals all of them, one each. Only three are unlocked today (the Raider waits on "Complete a run with any driver"), so every new campaign starts with a Road Warrior, an Interceptor, and a Mechanic, in an order the seed deals.
- Fewer than two different archetypes unlocked throws. A run takes two drivers, no two alike (`PLAYER_DRIVEN_VEHICLES`), and the pool only grows on runs, through Find: driver stops, so a compound founded with one driver could never leave.
- Each archetype is recruited with `Campaign.recruitDriver`, so the ids, the names ("Road Warrior 1"), max HP, the hand limit, and the archetype's starting deck as the default deck all come from the model.

Founding draws on a stream of its own, `root.fork('founding')`, forked again per purpose, so it never shares draws with the map's `params` and `map` streams, and a later founding draw (rolled driver names, say) takes another fork without moving the deal. Founding happens once a campaign, so its fork takes no counter, unlike `recruit` for a Find: driver.

## Starting values in a data file

`data/campaign-start.json` holds what the compound starts with. `readCampaignStart` checks it as `CampaignStart.ts` loads, so a bad edit fails straight away, the way the map presets load. The reader is as strict as a save's: exactly its fields, a pool of at least two, the drivers a run takes, every store a whole number from 0, escorts of the four hired types and no more than four of them. Every value is a starting point for tuning:

| Value | Start | Why |
| --- | --- | --- |
| `poolSize` | 4 | the spec's pool |
| `people` | 12 | upkeep is 1 food and 1 water per 4 people, rounded up: 3 of each a day |
| `food`, `water` | 21 each | a week of upkeep, long enough to reach the food and water POIs the starting reveal guarantees (Area Map Generation, guarantee 7) |
| `fuel` | 10 | a few runs; route costs aren't set yet |
| `meds` | 3 | a little healing in hand |
| `scrap` | 150 | what a run starts with today, on the combat screen |
| `escorts` | none | the convoy starts empty |

The locker starts empty and isn't in the file; unrest starts at 0 and the day at 1, which are the model's, not tuning. `foundCampaign` takes a `start` in place of the shipped values, for tests and tools, checked the same way.

The convoy starts empty because escorts come from events and the garage, and runs today field none. A starter escort is one line, `"escorts": ["fuel_hauler"]`, and joins fresh, in roster order. It brings no cards: signature cards join run decks at load out (Decks and the locker), never the locker or a default deck.

## Day 1, at dawn

The model saves a day and no hour, and founding sets day 1. Hours only run on the road: a run leaves at dawn, and getting home, or resting, ends the day. So while it's one run a day (Compound and Supply Runs, open question 8), the compound between runs is always at the dawn of its day, and an hour field would always say 06:00. Two short runs in a day's light would need one. A run's clock starts at dawn (06:00), and dark is dawn plus the campaign's `daylightHours`.

The log's first line is "Founded the compound.", on day 1, the start of the campaign's history.

## Math.random

Founding reads no randomness at all but the seed's own streams. The params and the deal draw from forks of the seed, and building the campaign, its driver records, its convoy, and its escorts draws nothing. A test spies on `Math.random` around whole foundings, with params rolled and given and starter escorts aboard, and asserts it's never called.

## Consequences

- The main menu's New Campaign (DDB-283) saves the campaign `CampaignFounding` resolves with, then hands its map to the session's map cache. Founding stays pure: it builds a campaign and saves nothing.
- The Map Lab (DDB-299) founds with `new CampaignFounding({ seed: params.seed, unlockedArchetypes, mapParams: params })` on its validated params, or calls `foundCampaign` with the map it already has on screen.
- Tests about everything but the map found on a stub map (`foundTestCampaign` in `__fixtures__/mapFixtures.ts`), since a real generation takes most of a second.
- If the player picks the pool (DDB-391), the pick replaces the deal in `foundCampaign`, or the deal becomes the suggestion it starts from, exported for the pick screen to show. `poolSize` holds the size either way.
- A pinned test holds what one seed deals, so changing the deal (the stream, the sort, the shuffle) shows up there, and moves every seed's pool.

## Provisional calls

Made here, each a line or a value to change:

- The founding progress is the menu's notice line, held between the title and New Campaign in the space the title always left there, rather than a founding screen or overlay, so no button moves as it fills in: "Founding the compound." until the first stage starts, then "Making the area map: water (2 of 7)", each stage by its label (`MAP_STAGE_LABELS`, which a new stage can't miss, since it's keyed by every stage name), with ", try 2" once a seed has given up. Continue is disabled while founding. The menu's other buttons stay live, and leaving through one cancels the founding at the click; a map that arrives while a navigation is still fading out founds nothing.
- A new campaign's old one is abandoned only once the new map is made, so leaving partway, or a failure, keeps the campaign in progress as it was.
- Founding records `AREA_MAP_GENERATOR_VERSION` on every campaign; 2 was the first generated map.
