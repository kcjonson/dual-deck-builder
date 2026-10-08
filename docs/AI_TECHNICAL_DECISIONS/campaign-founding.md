# Founding a campaign (DDB-284)

Date: 2026-10-07. Code: `src/renderer/game/campaign/Founding.ts` and `CampaignStart.ts`, with the starting values in `src/renderer/game/data/campaign-start.json`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Founding the compound, The driver pool, open question 6), [Area Map Generation](../specs/Area%20Map%20Generation.md) (Randomising for the finished game, Validation and retries, Saving). Builds on [campaign-state-model.md](./campaign-state-model.md), [seeded-prng.md](./seeded-prng.md), and [map-params.md](./map-params.md).

## Context

The campaign model (DDB-282) holds everything a save keeps, but nothing made a new one. A new campaign needs its map params, its map, a starting pool with default decks, stores, a locker, a convoy, and a day, and the same seed has to found the same campaign. Two callers found campaigns: the main menu's New Campaign (DDB-283) and the Map Lab's "Start a campaign here" (DDB-299). The area map generator doesn't exist yet (terrain is its first stage), and whether the player picks the starting pool or it's dealt, and how big it is, is still open (open question 6, DDB-391).

## One function, and everything it uses comes in

`foundCampaign({ seed, unlockedArchetypes, mapParams?, start? })` returns a new `Campaign`. The same options found the same campaign, down to its JSON.

- The seed comes in. The caller mints it with `freshSeed()` from `core/Rng.ts`, the one place root seeds come from, or brings the Map Lab's; nothing in `campaign/` reads `Math.random` or crypto, which lint enforces.
- So do the unlocked archetypes. Unlocks live in `DriverLoader` today, a singleton that loads asynchronously, and meta-progression will hold them later. Taking the list keeps founding synchronous and indifferent to where unlocks live. The main menu's call:

```ts
const loader = DriverLoader.getInstance();
await loader.loadDrivers();
const campaign = foundCampaign({
	seed: freshSeed(),
	unlockedArchetypes: loader.getUnlockedDrivers().map(driver => driver.archetype)
});
```

- Everything is checked before anything is built, so a bad call throws and founds nothing: a seed that isn't a uint32, map params that don't read or were made from another seed, fewer than two archetypes unlocked, or a start that doesn't read.

Reading `DriverLoader` inside founding was rejected. It would make founding async and tie it to the singleton's load state: an unloaded loader hands out no drivers, which would found a compound with nobody in it.

## Map params: rolled, or given and validated

With no `mapParams`, founding calls `rollParams(seed)`, which draws them on the seed's `params` stream and validates them. A given set (the Map Lab's) is read the way a map preset is (`readMapPreset`: an object of known parameters, numbers as numbers, stop tables as an object), filled out from its environment (`resolveMapParams`), and run through the parameter validator, and its seed, wrapped as the validator wraps it, must be the campaign's. Either way the result goes through the campaign's own params reader (`readMapParams`), so a bad value inside the stop tables fails with its path before anything is built, and the campaign holds the frozen params as they are. Generation validates before it runs (Area Map Generation, Validation and retries), so these are the params the map is made from. The validator is idempotent, so the Map Lab's validated set comes through untouched.

Refusing a set the validator would change was considered. The Map Lab passes validated params, so a refusal would never fire for the caller it was meant for, and clamping founds on the params the Map Lab made its map from anyway.

## The map is a stand-in until the generator exists

The generator's call has one place, marked in `foundCampaign`: it will make the gameplay map from the seed and the params, and the campaign will keep that map and the generator's version. Until then founding reads `MAP_STAND_IN`, the model's empty map state (`EMPTY_MAP`) at generator version 1. Nothing pretends to generate a map.

Founding's order already suits the generator: the cheap checks first, then the map, then the campaign built on it. If generation gives up on a seed and takes the next one (release builds, after 32 map attempts), founding starts again from that seed, since the params, the pool, and every later stream fork from it.

## The starting pool is dealt

The spec deals four drivers from the unlocked archetypes, no two alike. Founding builds to that text, with the size in the data file so open question 6 can go either way.

- `dealStartingPool({ seed, unlockedArchetypes, size })` drops repeats, sorts the unlocked archetypes by id, shuffles them on `new Rng({ seed }).fork('founding').fork('pool')`, and takes the first `size`. Sorting first means neither the order they're passed in nor the order of `DRIVER_CONFIGS` moves a seed's deal; unlocking an archetype moves every seed's.
- The dealt order is the order they join, so `driver-1` is the first one dealt.
- Fewer unlocked archetypes than the pool size deals all of them, one each. Only three are unlocked today (the Raider waits on "Complete a run with any driver"), so every new campaign starts with a Road Warrior, an Interceptor, and a Mechanic, in an order the seed deals.
- Fewer than two different archetypes unlocked throws. A run takes two drivers, no two alike (`PLAYER_DRIVEN_VEHICLES`), and the pool only grows on runs, through Find: driver stops, so a compound founded with one driver could never leave. `dealStartingPool` on its own stays a plain deal, which takes one archetype and refuses only none.
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

The model saves a day and no hour, and founding sets day 1. Hours only run on the road: a run leaves at dawn, and getting home, or resting, ends the day. So between runs the compound is always at the dawn of its day, and an hour field would always say 06:00. A run's clock starts at dawn (06:00), and dark is dawn plus the campaign's `daylightHours`.

The log's first line is "Founded the compound.", on day 1, the start of the campaign's history.

## Math.random

What founding draws (the params and the deal) comes from seeded streams, and a test spies on `Math.random` around the deal and asserts it isn't called. A whole founding is held to its output instead: the test mocks `Math.random` to two different values and checks the campaign comes out the same, the second pattern the lint rule's comment gives. So anything founding builds that reads `Math.random` can't reach the campaign, and the test doesn't depend on whether anything does.

## Consequences

- The Map Lab (DDB-299) calls `foundCampaign({ seed: params.seed, unlockedArchetypes, mapParams: params })` with its validated params.
- The generator replaces `MAP_STAND_IN` where `foundCampaign` marks it; nothing else in founding changes.
- If the player picks the pool (DDB-391), the pick replaces `dealStartingPool` in `foundCampaign`, or the deal becomes the suggestion it starts from. `poolSize` holds the size either way.
- A pinned test holds what one seed deals, so changing the deal (the stream, the sort, the shuffle) shows up there, and moves every seed's pool.
