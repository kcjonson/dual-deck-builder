# The map pipeline runner (DDB-446)

Date: 2026-10-09, revised 2026-10-10 for founding and loading (DDB-467). Code: `_legacy/src/renderer/game/map/MapPipeline.ts` (the runner), `AreaMapPipeline.ts` (the stages), `map/worker/` (the TypeScript build's generation worker and its client), and `campaign/CampaignFounding.ts` and `campaign/CampaignMaps.ts` (founding on a generated map, and the session's map). Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Seeds and determinism, Pipeline, Validation and retries, Performance, and Saving. Follows [realistic-map.md](./realistic-map.md), decision 5, and builds on [seeded-prng.md](./seeded-prng.md), [map-params.md](./map-params.md), and [campaign-founding.md](./campaign-founding.md).

## Context

The spec runs generation as a pipeline: each stage on a stream forked from its upstream's winning stream with its own name and attempt, each with its own checks and an optional `accept(map, stage)` hook after them, a local-retry stage's optional `keepable(problems)` saying which failing attempts it may keep, 8 attempts a stage and then a whole-map restart up to 32, stops and dressing retrying only themselves, and debug and release builds parting ways past each cap. It runs once, at founding.

Before the runner, three places chained terrain, highways, and growth by hand on flat streams, `root.fork('map', 0).fork(stage, attempt)`, with no checks and no retries: `roadTesting.growMap`, `_legacy/scripts/road-growth.mjs`, and the gallery's area map fixture.

Terrain's insides change with uplift and erosion (Map 4), so the pipeline reaches terrain only through its stage.

## The runner

`MapPipeline` is an ordered list of stages, built a stage at a time so each stage's upstream is typed, and immutable:

```ts
new MapPipeline<MapParams>()
	.stage(TERRAIN_STAGE)
	.stage(WATER_STAGE)
	.stage(ROADS_STAGE)
	.run({ seed, input: params, accept, onProgress });
```

A stage has a name, `run({ input, products, rng })`, an optional `check(product, { input, products })`, and four optional settings: `attempts`, `escalate`, `localRetry`, and, on a local-retry stage only, `keepable(problems)`, which the builder refuses on any other. Checks and the accept hook return problems as a list of strings, and an empty list passes. A stage that throws has a bug, not a failure, so the exception goes straight out. Each stage is handed a record of its upstream's products of its own, which later stages never write to.

- Streams nest. A map attempt's stream is `root.fork('map', m)`, the first stage's is that forked with its name and attempt, and every later stage's is its upstream's winning stream forked the same way. `fork` reads only its parent's seed, so how many draws a stage made never moves its children, and a failed attempt leaves nothing behind. A stage counts its attempts from 0 whenever its upstream changes, so numbers can't collide, and a rerun upstream gives everything below it fresh streams because they hang from a different parent.
- A failing stage reruns on the products its upstream already made; nothing upstream recomputes. A stage gets 8 attempts unless it sets `attempts`: a stage that takes no draws (the route tree, the tiers) sets 1, since its every attempt would be the same. The accept hook runs after a stage's own checks pass, sees the map so far with the stage's output in it, and its rejection counts as the stage failing. `keepable` runs on a local-retry stage's failing attempts: one it refuses is never kept past the cap, and when it refuses every one, debug and release builds alike restart the map on its next attempt rather than throw or keep. The stops stage refuses an attempt with a route under its fight floor.
- A stage out of attempts restarts the map on its next attempt, up to 32, unless it names a stage to `escalate` to. Then that upstream stage reruns on its next attempt, the stages between it and the escalating one rerun after it on fresh streams, and the escalating stage counts from 0 again. That's the spec's POIs that can't seat their strongholds rerunning the roads. Escalating spends the upstream stage's attempts; once they're gone its own `escalate` applies, and past the last one the map restarts. Chained escalations multiply: with c escalating to b and b to a, at 8 attempts each, one map attempt can run c 512 times, and there can be 32 map attempts. A stage can only escalate to one upstream of it, which the builder's types check, and neither to nor from a local-retry stage, which the builder refuses.
- A local-retry stage reruns alone and never restarts the map. Past its cap a debug build throws and a release build warns and keeps its best attempt, the one with the fewest problems, the earliest on a tie, except that a stops attempt with any route under its fight floor is never kept and the map restarts (Area Map Generation, Validation and retries). Later stages nest in the kept attempt's stream, and the result's `keptFailing` names the stage. Because problems are counted to rank attempts, a local-retry stage's checks report every problem, never stopping at a limit.
- Past the map cap the run throws a `MapPipelineError` with `exhausted: 'map'` and the last failure, in every build. The runner never changes seed. Params roll from the seed, and the pool is dealt from it, so a map on another seed needs both done again, which is founding's to do (below).
- Debug means a development build unless the caller passes `debug`, which tools and scripts do.
- A run can replay a map instead of generating one, given its map attempt and each stage's winning attempt (`replay`). Each stage runs once, on the stream that attempt had, and nothing is checked, since those attempts passed; the result has no failures. Attempts that don't fit the pipeline, a stage's missing or one for a stage it doesn't have, or one past a stage's attempts, are an error before anything runs. It's how a load makes a saved campaign's map again (below).
- The result holds the products, the map attempt, each stage's winning attempt and winning stream (as its seed), per-stage timings (runs, milliseconds in runs, and milliseconds in checks and the hook), every failed attempt with its problems, and the whole run's milliseconds. Progress is reported as each attempt starts, with the stage, its index and the count, the attempt, the map attempt, and the seed. The accept hook and progress see stage names typed as the pipeline's own.

A stage list typed loosely, every stage seeing every product as optional, was simpler but put a presence check on every upstream read. The builder costs one generic type and catches a stage placed before what it reads, or escalating to one after it, at compile time.

An escalation could instead have been a failure a stage returns naming the stage to rerun. Declaring it on the stage keeps the rerun target out of every check's code, and lets the builder refuse targets that can't work.

## The stages

Terrain, water (water-and-biomes.md), hazards and places (places.md), the roads (road-network.md), then the route tree and the POIs (route-tree-and-pois.md). The highways and growth stages this record started with were stand-ins until the places and the road links and graph (Maps 6 to 8) replaced them. The roads' check is too few loops, a place no road reaches, and `checkRoadNetwork`, the network checks the map validator will run, worded `rule: detail`.

Terrain is the first stage, so its stream is `root.fork('map', m).fork('terrain', t)`, and every stage after nests under the one before. `roadTesting.roadMap`, `_legacy/scripts/road-network.mjs`, and the gallery's `fixtureAreaMap` all run the runner.

Retries can hide a regression from a test: a network that breaks a road rule is retried, and the test sees the attempt that passed. So `roadMap` throws on any failure but too few loops, which the spec retries on purpose, naming what failed. `road-network.mjs check` reports each stage's first-attempt pass rate, the spec's health metric.

## What a save needs from it

Because streams nest, a stage's stream depends on every winning attempt above it, not on the map attempt alone. The land is rebuilt on load from terrain's stream, which needs the map attempt and terrain's attempt, and dressing, the last stage, from a stream nested under every stage before it. So a campaign keeps the map attempt and every stage's winning attempt, `mapAttempts`, a dozen small integers fixed at founding beside the seed and the params; a load rebuilds any stage's stream from them. The spec's Saving section says the same.

Until saves keep the map's lines (DDB-436), a load rebuilds every stage, not just the land (Making a saved map again, below). A save names the stages in `mapAttempts.stages`, so adding, removing, or renaming a stage bumps `AREA_MAP_GENERATOR_VERSION` (`map/GeneratorVersion.ts`, a module of its own so the store reads it without loading the pipeline), and a test pins the list to it. The save format version stays where it is: the campaign store reads a save whose map another generator version made as outdated, as it does one of another format version.

## The founding contract

Founding starts generation and takes the next seed past the map cap; the runner does neither. `foundCampaign` stays synchronous and takes the generated map, and `CampaignFounding` is the half round it that waits on generation, which the main menu's New Campaign runs.

Generation is a job the founding screen watches: it reports progress as each attempt starts, can be cancelled at any point with nothing kept, and gives up with the typed `MapPipelineError`. Each generation starts fresh, with nothing carried over from the one before. The TypeScript build ran it in a Web Worker per generation; the C++ build runs the same contract on whatever job mechanism it picks. Whether that needs a thread of its own turns on the C++ timings; the TypeScript pipeline took about 75 to 100 ms before erosion, which added roughly 150 to 250 ms in Node.

- `prepareFounding` runs founding's checks and resolves the params for the seed, rolled or given, so a bad call fails before a generation is spent on it. Then it starts generation with a progress callback and waits for the result. The menu shows the progress in its notice line above New Campaign ("Making the area map: water (2 of 7)"). Leaving through any of the menu's buttons cancels the founding at the click, which stops generation and saves nothing, and a map that arrives while the screen transition is running founds nothing either, since the menu leaves only once the transition ends.
- On a `MapPipelineError` with `exhausted: 'map'`, a release build logs and starts over from `seed + 1` (wrapped to uint32): params rolled from that seed, the pool dealt from it, and the map generated from it, up to 4 seeds, then the last error stands. A debug build rethrows at once. Params given rather than rolled (the Map Lab's) never move seed in any build, since they're tied to the seed they were made on. Any other error, a local-retry stage's in a debug build included, stands at once.
- `foundCampaign({ ..., map })` takes the result as a `FoundingMap`, its params, map attempt, and stage attempts, refuses one generated on params other than the campaign's, and keeps the attempts as `mapAttempts`, at `AREA_MAP_GENERATOR_VERSION`, on the seed the campaign records, so its history reproduces it ([campaign-founding.md](./campaign-founding.md)).
- The menu saves the campaign, then hands the map to the session's cache (`CampaignMaps.remember`), so the session never makes it again.

## Making a saved map again

A load makes the map again from the campaign's seed, params, and `mapAttempts`, through the same generation job: it takes the attempts as `replay`, and the runner replays them. The same campaign always makes the same map, the same road network and land bit for bit, which a test holds by founding a campaign, saving and loading it through the store, and comparing the two maps' hashes. Nothing is checked on the way, so a check that tightens later (the validator's accept hook, say) never moves a saved map; a stage that makes something else from the same stream does.

`CampaignMaps` holds the session's map, one campaign's at a time, and is how screens get it:

- `remember(campaign, map)`: founding's map.
- `prepare(campaign)`: starts making it and waits for nothing. Continue calls it.
- `mapOf(campaign)`, or `getAreaMap(campaign)` on the shared cache, each with a progress callback and a cancel signal: the map, whether it's kept, being made, or made now, with progress while it's being made. The area map screen (DDB-43) and the run loop's routes read it here, and cancel their wait when they unmount: that caller hears no more progress and its wait ends as cancelled, while the map goes on being made for anyone else waiting and is kept.

The map is keyed by the generator version, the seed, the params, and the attempts, so any instance of a campaign, the one founding made or one a later load made, gets the same map. Asking for another campaign's drops the one kept, cancelling it if it's still being made. A failure isn't kept, so asking again tries again. A campaign with no map attempts (one built without a map, as tests build them), or one recorded at another `AREA_MAP_GENERATOR_VERSION` ("this save's map is from an older build"), is refused without generating; the store already reads the second kind of save as outdated, so only a campaign that never went through it gets that far. Attempts that don't fit the pipeline are refused by the runner.

Making the map takes as long as founding it did, less any failed attempts: the same stages, once each. A screen that needs it shows the progress the same way the menu does (`mapProgressText`).

## In the C++ alpha

`libs/rules/map/MapPipeline.h` (2026-10-30, DDB-571) is the runner's skeleton, under `AreaMapPipeline`'s stages: terrain, water, hazards, places, roads, the route tree, the POIs, the stops, and the dressing. The route tree takes no draws and sets one attempt, so the accept hook rejecting it restarts the map. `MapPipeline<Input, Products>` is built a stage at a time with `then`, and a stage writes its product into a products struct, `AreaMap`, a field per stage, that later stages read; a map restart starts the struct fresh. Streams nest as above, attempts and map restarts are as above, the accept hook and progress are as above, and so are failures and replay. Each stage's record keeps its winning attempt, its stream's seed, its runs, and their time, checks included. A replay that doesn't fit the pipeline throws `std::invalid_argument` before anything runs.

A stage can name one upstream of it to `escalate` to, as above: once it's out of attempts that stage goes on from its next attempt, everything after it reruns on fresh streams, and the escalating stage counts from 0 again; past the upstream stage's last attempt its own escalation applies, or the map restarts. The POIs escalate to the roads. A replay checks every stage's attempt before any stage runs.

A stage can be `localRetry`, as above, with a `keepable` that says which failing attempts it may keep (the stops, since 2026-10-31). It reruns alone and never escalates or is escalated to, which the builder asserts. Past its cap a debug run throws a `MapPipelineError` whose `exhausted` is `Stage`, where one past the map cap says `Map`; a release run keeps the attempt with the fewest problems, the earliest on a tie, logs it with `LOG_ERROR`, and the stage's record says `kept`. With no attempt it may keep, the map restarts in either. What differs:

- The attempt kept is made again: the runner runs it once more on its stream, unchecked, and it makes what it made the first time. A stage writes into the one products struct and its later attempts overwrite it, so there's nowhere else to keep it, and the stops' run takes a few milliseconds. The rerun counts in the stage's runs.
- `debug` is the options' and defaults to a development build, `DEVELOPMENT_BUILD`, which salal's foundation defines for Debug and RelWithDebInfo, where the TypeScript's was `__DEV_TOOLS__`. Only Release keeps an attempt unless a caller says otherwise, and Release compiles warnings out, so a kept attempt logs as an error.

A stage can be `inert` (2026-10-31): it carries no gameplay, so nothing play reads may depend on it. The dressing is the one there is. Inert means local retry with no `keepable`, so an inert stage reruns alone, never escalates or is escalated to, and past its cap a debug run throws and a release run keeps its fewest problems; the builder asserts it has no `keepable`, and that only an inert stage follows an inert one, so the gameplay stages all come first. The rest is the replay and the save:

- A replay that names no attempt for an inert stage runs its first, on the stream nested in its upstream's, and one that names an attempt runs that one, held to the stage's attempts like any other. A gameplay stage left out, or a stage the pipeline doesn't have, is still an error before anything runs. So a save made before an inert stage existed makes the same map with it, and adding or changing the dressing never breaks a save.
- There's no generator version to keep it out of. The campaign's save keeps each stage's winning attempt by name and a fingerprint of the gameplay map ([campaign.md](./campaign.md), The map on the campaign), and the fingerprint reads no inert stage, so what the dressing makes can change under a save and the save still loads. Removing or renaming an inert stage would break a save that named it, as for any stage.
- A save may keep an inert stage's attempt or leave it out; `makeCampaignMap` keeps every stage's, the dressing's included. Today the dressing has no check, so its winning attempt is always 0 and leaving it out loses nothing; keeping it means a check added later can reject an attempt without moving a saved map's picture. `stageCount()` says how many records a run holds, inert stages included.

A run can be cancelled (2026-10-31), as The founding contract has it. `PipelineOptions::cancel` is a `std::stop_token`, which a `std::jthread` hands its function, so the game app's worker passes its own; the default one never stops. The runner asks it before every stage attempt, a replay's and a kept attempt's rerun included, and once a stop is requested throws `MapPipelineCancelled`, naming the stage it would have run next, so nothing half-made is handed back. A stage runs to its end, so a stop waits at most one stage, the terrain's the longest. It's a type of its own rather than a `MapPipelineError`, since founding moves to the next seed on that one and must never on a cancel. Other options: a callback polled the same way, which is all a stop token is with less to get wrong across threads, and asking inside a stage's loops too, which would put the runner's business in every stage for a wait the grid stages keep under a second.

The accept hook is the map validator's (map-knowledge.md, Decision): `generateAreaMap` runs `mapValidator` on every generation, then the caller's hook. Each stage's own check is already the validator's for its layer, so the hook holds only what spans layers, the starting knowledge's half of Guarantees 6 past the POIs, and `validateAreaMap` holds a whole map to all of it, as a load would.

The terrain stage has no check, since erosion always makes land; its stream is `root.fork("map", m).fork("terrain", t)`.

## Provisional calls

Calls the spec left open, made the simplest way consistent with it (founding's and loading's are in [campaign-founding.md](./campaign-founding.md) and [campaign-save-and-load.md](./campaign-save-and-load.md)):

1. Founding tries 4 seeds past the map cap, the one it was given and the three after it, before the error stands.
2. A local-retry stage that runs out keeps the attempt with the fewest problems, the earliest on a tie.
3. Growth's own check is `checkRoadNetwork`, so a network breaking a road rule is retried on growth's next stream rather than handed on.
4. Each generation starts fresh, nothing kept from the one before, and cancelling it throws its work away.
5. The stand-in stages were named `highways` and `growth`, the streams they always drew on, until the spec's `places` and `roads` stages replaced them.
6. A stage's 8 attempts cover its own retries and the reruns escalations ask for, so one that won its first can be escalated to 7 times; after that its own escalation or a map restart follows. The escalating stage starts its count again under each new upstream.

## Consequences

- Every stage the realistic map adds is a `.stage()` call with its checks, attempts, and escalation; retries, streams, progress, timings, and the debug and release paths come with it.
- The accept hook is where the map validator (DDB-296) plugs in, stage by stage.
- A seed's roads come from the nested places and roads streams.
