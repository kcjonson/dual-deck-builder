# The map pipeline runner and its worker (DDB-446)

Date: 2026-10-09. Code: `src/renderer/game/map/MapPipeline.ts` (the runner), `AreaMapPipeline.ts` (the stages), and `map/worker/` (the worker, its client, the transfer format, and the dev hook). Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Seeds and determinism, Pipeline, Validation and retries, Performance, and Saving. Follows [realistic-map.md](./realistic-map.md), decision 5, and builds on [seeded-prng.md](./seeded-prng.md), [map-params.md](./map-params.md), and [campaign-founding.md](./campaign-founding.md).

## Context

The spec runs generation as a pipeline: each stage on a stream forked from its upstream's winning stream with its own name and attempt, each with its own checks and an optional `accept(map, stage)` hook after them, 8 attempts a stage and then a whole-map restart up to 32, stops and dressing retrying only themselves, and debug and release builds parting ways past each cap. It runs once, at founding, in a Web Worker in the web build and the Electron renderer alike.

Before the runner, three places chained terrain, highways, and growth by hand on flat streams, `root.fork('map', 0).fork(stage, attempt)`, with no checks and no retries: `roadTesting.growMap`, `scripts/road-growth.mjs`, and the gallery's area map fixture.

What the worker had to fit:

- tsconfig compiles to CommonJS, and TypeScript rejects `import.meta` under it.
- Jest runs in Node, where there's no `Worker`.
- The Electron renderer is sandboxed with context isolation, and a packaged build loads it from `file://` inside an asar archive.
- webpack splits every chunk (`splitChunks: 'all'`), and neither build sets a Content-Security-Policy.
- Terrain's insides change with uplift and erosion (Map 4), so the pipeline reaches terrain only through its stage.

## The runner

`MapPipeline` is an ordered list of stages, built a stage at a time so each stage's upstream is typed, and immutable:

```ts
new MapPipeline<MapParams>()
	.stage(TERRAIN_STAGE)
	.stage(HIGHWAYS_STAGE)
	.stage(growthStage({ branchiness, clearance }))
	.run({ seed, input: params, accept, onProgress });
```

A stage has a name, `run({ input, products, rng })`, an optional `check(product, { input, products })`, and three optional settings: `attempts`, `escalate`, and `localRetry`. Checks and the accept hook return problems as a list of strings, and an empty list passes. A stage that throws has a bug, not a failure, so the exception goes straight out. Each stage is handed a record of its upstream's products of its own, which later stages never write to.

- Streams nest. A map attempt's stream is `root.fork('map', m)`, the first stage's is that forked with its name and attempt, and every later stage's is its upstream's winning stream forked the same way. `fork` reads only its parent's seed, so how many draws a stage made never moves its children, and a failed attempt leaves nothing behind. A stage counts its attempts from 0 whenever its upstream changes, so numbers can't collide, and a rerun upstream gives everything below it fresh streams because they hang from a different parent.
- A failing stage reruns on the products its upstream already made; nothing upstream recomputes. A stage gets 8 attempts unless it sets `attempts`: a stage that takes no draws (the route tree, the tiers) sets 1, since its every attempt would be the same. The accept hook runs after a stage's own checks pass, sees the map so far with the stage's output in it, and its rejection counts as the stage failing.
- A stage out of attempts restarts the map on its next attempt, up to 32, unless it names a stage to `escalate` to. Then that upstream stage reruns on its next attempt, the stages between it and the escalating one rerun after it on fresh streams, and the escalating stage counts from 0 again. That's the spec's POIs that can't seat their strongholds rerunning the roads. Escalating spends the upstream stage's attempts; once they're gone its own `escalate` applies, and past the last one the map restarts. Chained escalations multiply: with c escalating to b and b to a, at 8 attempts each, one map attempt can run c 512 times, and there can be 32 map attempts. A stage can only escalate to one upstream of it, which the builder's types check, and neither to nor from a local-retry stage, which the builder refuses.
- A local-retry stage reruns alone and never restarts the map. Past its cap a debug build throws and a release build warns and keeps its best attempt, the one with the fewest problems, the earliest on a tie. Later stages nest in the kept attempt's stream, and the result's `keptFailing` names the stage. Because problems are counted to rank attempts, a local-retry stage's checks report every problem, never stopping at a limit.
- Past the map cap the run throws a `MapPipelineError` with `exhausted: 'map'` and the last failure, in every build. The runner never changes seed. Params roll from the seed, and the pool is dealt from it, so a map on another seed needs both done again, which is founding's to do (below).
- Debug is `__DEV_TOOLS__`, the DefinePlugin constant every other dev-only path reads, unless the caller passes `debug`. Node scripts pass it, since nothing defines the constant there.
- The result holds the products, the map attempt, each stage's winning attempt and winning stream (as its seed), per-stage timings (runs, milliseconds in runs, and milliseconds in checks and the hook), every failed attempt with its problems, and the whole run's milliseconds. Progress is reported as each attempt starts, with the stage, its index and the count, the attempt, the map attempt, and the seed. The accept hook and progress see stage names typed as the pipeline's own.

A stage list typed loosely, every stage seeing `Partial<Products>`, was simpler but put a non-null assertion on every upstream read. The builder costs one generic type and catches a stage placed before what it reads, or escalating to one after it.

An escalation could instead have been a failure a stage returns naming the stage to rerun. Declaring it on the stage keeps the rerun target out of every check's code, and lets the builder refuse targets that can't work.

## The stages

Terrain, water (water-and-biomes.md), then the highways and growth, stand-ins for settlements and road links (Map 7 and 8), named for the streams they always drew on. Growth's check is `checkRoadNetwork`, the network checks the map validator will run, worded `rule: detail`. `areaMapPipeline` takes growth's knobs and, for tests, a terrain stage to use in place of `TERRAIN_STAGE`.

Terrain is the first stage, so its stream is `root.fork('map', m).fork('terrain', t)`, and water, the highways, and growth nest under it in turn. `roadTesting.growMap`, `scripts/road-growth.mjs`, and the gallery's `fixtureAreaMap` all run the runner.

Retries can hide a regression from a test: a network that breaks a road rule is retried, and the test sees the attempt that passed. So `growMap` throws unless every stage won its first attempt on the first map attempt, naming what failed, and only a caller that passes `accept`, steering the retries itself, gets whatever won. `road-growth.mjs check` reports every first-attempt failure, the spec's health metric.

## The worker

### A worker per generation

Options:

1. In-process on the page's thread. Nothing to bundle, and fastest end to end, but the whole run blocks the frame: a 35 to 37 ms pipeline today at radius 1000, and the spec's grid stages budget a second.
2. One long-lived worker, kept for every generation. Its code stays compiled, so after the first a generation costs about what it does on a warm thread. But it holds memory between generations, and cancelling one means terminating the worker or checking for a cancel inside the stages.
3. A worker per generation, terminated when the map comes back (chosen). Cancelling is `terminate()`, the memory goes with it, and nothing carries over between generations. The cost is starting a worker and running cold code every time: in Electron the pipeline takes 93 ms in a fresh worker against 38 ms in a warm one.

Founding generates once a campaign, so the cold cost is paid once either way, and terminate-as-cancel keeps the founding screen simple. The Map Lab, which regenerates on every change, is where a long-lived worker would pay; the worker entry answers any number of requests, so that's a client-side change.

### The transfer format

Options:

1. Post the products as they are. `Terrain` is a class holding noise generators and closures, which structured clone refuses, and the network is 150 to 250 small arrays of numbers cloned one by one.
2. JSON. One string, but 160 to 290 KB of digits written and parsed at radius 1000.
3. Plain data with the bulk packed into transferred typed arrays (chosen). Every stretch's points go end to end in one `Float64Array`, with a `Uint32Array` of where each stretch starts, and both buffers transfer rather than copy. Float64, so every coordinate arrives exactly as generated and junctions still match. Nodes, roads, the stretches' other fields, the highways, growth's stats, and the run's attempts, streams, timings, and failures are small and go by structured clone.

The terrain crosses as its eroded land, `terrain.surface`: its seven typed arrays (elevation, the range mask, and the drainage's receivers, levels, area, order, and outlets) go in the same transfer list as the network's, and the client rebuilds the rest of the terrain over them with `terrainFromSurface` on the winning terrain stream. The analytic terrain this pipeline started with was cheaper to rerun than to send, about 2 ms; running the stage again now would mean eroding the land again, 236 ms at radius 1000 in Node, where the decode takes 11 ms median and 28 ms at radius 1600, and about 20 ms and 60 to 130 ms on Chromium's main thread (terrain-erosion.md, Crossing the worker boundary). Transferring detaches the arrays from the worker's own terrain, so it encodes after its last stage, then is terminated. The water crosses the same way, as its surface's ten arrays, and `waterFromSurface` lays it back over the rebuilt terrain (water-and-biomes.md, Crossing the worker boundary). Errors cross as plain data too, a `MapPipelineError` with its failure and what was exhausted.

The in-process fallback runs the same `generateTransfer` the worker does and decodes the same way, so a map is identical whichever path made it, and the Jest tests of the fallback cover the format the worker sends.

### Bundling

Options:

1. webpack 5's `new Worker(new URL('./mapWorker.ts', import.meta.url))` (chosen). webpack bundles the worker and its imports into a chunk of its own, `map-generation.[contenthash].js`, which loads what it shares with the page through `importScripts`, resolved against the chunk's own URL, so it works over http and from `file://` without configuration. In a production-mode build that's a 4.5 to 6 KB chunk plus a 50 KB chunk of the map modules.
2. A separate webpack entry with a fixed file name, created by URL. It needs its own split-chunks rule and a name the page knows without the content hash.
3. worker-loader, built for webpack 4 and superseded by option 1.
4. A Blob URL from an inlined bundle. It needs a second build to inline and `blob:` in any future CSP.

The cost of option 1 is the `import.meta` that CommonJS can't type. TypeScript still emits it untouched, so one `@ts-expect-error` on the `new URL(...)` argument in `spawnMapWorker.ts` covers it, leaving the Worker's options type-checked, and webpack resolves it at build time; the directive turns into an error of its own if the project moves to ES modules. Jest runs the CommonJS as it is, so `jest.config.js` maps that module to a stub that spawns nothing, beside the asset and shader stubs, and the client runs in-process there. Nothing else in the client knows about webpack.

Neither build sets a Content-Security-Policy (no meta tag in `public/`, no header handler in `electron/main.ts`), so nothing restricts workers. A CSP needs `worker-src 'self'`. The web dev server's cross-origin isolation is satisfied as is: the worker's scripts come from the same server, with the same headers.

The client starts a worker wherever `Worker` exists. It generates in-process instead, after a warning, if the platform refuses one or the worker fails before its first reply, which is how a chunk that didn't load shows up; a failure after a reply rejects. It reports progress, resolves with the decoded map and its wall and decode times, and `cancel()` terminates the worker and rejects with `MapGenerationCancelled`, the way an aborted fetch rejects, without leaving an unhandled rejection when nothing awaits it.

### Showing it

Development builds have `window.__map.generate(set?, { inProcess? })`, installed from Game's `__DEV_TOOLS__` branch beside the other debug hooks. It makes the map in a worker (or on the page's thread, for comparison), logs one line of where the time went, and resolves with the same numbers for a script to read; `__map.start(set?)` hands back the `MapGeneration` itself, to watch or cancel. With no map section on the Developer screen, a hook leaves `sections.ts` untouched. A production bundle never carries the hook, and carries the worker chunk only once production code imports the client.

## Timings

Radius 1000, five environments by three seeds, on the development desktop (Windows 11), every map winning every stage on its first attempt. Builds in production mode with dev tools on, so the hook exists and the code is what ships. Wall is from asking to having the decoded map on the main thread. Measured on the analytic terrain, before Map 4. Erosion adds about 236 ms to the terrain stage in Node, and the decode, rebuilding the terrain over the land sent, takes 11 ms there and about 20 ms in Chromium (terrain-erosion.md).

| | Chromium 153 (web build, served over http) | Electron 25.9 (Chromium 114, renderer from `file://`) |
| --- | --- | --- |
| Wall, worker per generation | 145 ms median, 150 slowest | 105 ms median, 117 slowest |
| Pipeline in the worker | 74 ms | 93 ms |
| terrain, highways, growth + its checks | 11, 0.2, 48 + 15 ms | 16, 0.3, 55 + 21 ms |
| Decode on the main thread | 2.9 ms | 3.4 ms |
| Starting the worker and the messages | 58 ms | 9 ms |
| In-process on the page's thread, wall (pipeline) | 64 ms (37) | 38 ms (35) |
| One long-lived worker, first then median | 198 ms, then 66 | 103 ms, then 39 |

Electron against the development dev server, the build the screenshot harness runs, took 126 ms median wall with a 100 ms pipeline. Plain Node 24 runs the same stages in 2 ms of terrain, 17 to 29 ms of highways and growth, and 5 to 10 ms of checks: the gap to the worker's numbers is cold code, which every fresh worker starts with. All of it is far inside the spec's budget of a second for the grid stages; Map 4's erosion takes most of that budget, and its share of cold-code overhead is smaller.

## What a save needs from it

Because streams nest, a stage's stream depends on every winning attempt above it, not on the map attempt alone. The land is rebuilt on load from terrain's stream, which needs the map attempt and terrain's attempt, and dressing, the last stage, from a stream nested under every stage before it. So the save (Map 18) keeps the map attempt and every stage's winning attempt, a dozen small integers, which the result carries; a load rebuilds any stage's stream from them. The spec's Saving section says the same.

## The founding contract

Founding starts generation and takes the next seed past the map cap; the runner does neither. `foundCampaign` is synchronous and holds the generator's slot where it reads `MAP_STAND_IN`, and its caller, `MainMenuScreen.startCampaign`, is async, so the generation goes between them:

- Behind the founding screen, `startCampaign` resolves the founding params and the deal for the seed, starts `new MapGeneration({ params, onProgress })`, shows progress, awaits `result`, and cancels it if the player leaves.
- On a `MapPipelineError` with `exhausted: 'map'`, a release build logs and starts over from `seed + 1` (wrapped to uint32): params rolled from that seed, the pool dealt from it, and the map generated from it, up to 4 seeds, then the error stands. A debug build rethrows at once. Params given rather than rolled (the Map Lab's) never move seed, since they're tied to the seed they were made on, and the Map Lab is a debug tool.
- `foundCampaign` takes the generated map in place of `MAP_STAND_IN` and keeps what the save needs: the map, the map attempt, and the stage attempts, on the seed the campaign records, so its history reproduces it.
- The founding hookup smoke-tests a packaged build, as `scripts/smoke-electron-package.mjs` does for the fonts: the worker chunk loading from inside the asar is the one path no development run covers.

## Provisional calls

Calls the spec left open, made the simplest way consistent with it:

1. Founding tries 4 seeds past the map cap, the one it was given and the three after it, before the error stands.
2. A local-retry stage that runs out keeps the attempt with the fewest problems, the earliest on a tie.
3. Growth's own check is `checkRoadNetwork`, so a network breaking a road rule is retried on growth's next stream rather than handed on.
4. A worker per generation, terminated when the map comes back; `cancel()` terminates it.
5. The stand-in stages are named `highways` and `growth`, the streams they always drew on, until the spec's `places` and `roads` stages replace them.
6. A stage's 8 attempts cover its own retries and the reruns escalations ask for, so one that won its first can be escalated to 7 times; after that its own escalation or a map restart follows. The escalating stage starts its count again under each new upstream.

## Consequences

- Every stage the realistic map adds is a `.stage()` call with its checks, attempts, and escalation; retries, streams, progress, timings, and the debug and release paths come with it.
- The accept hook is where the map validator (DDB-296) plugs in, stage by stage.
- A seed's roads come from the nested highways and growth streams, which the area map goldens show.
- A fresh worker runs cold code, roughly doubling the pipeline against a warm thread today. Fine for founding; the Map Lab wants a long-lived worker.
- A future CSP has to allow `worker-src 'self'`, and the `@ts-expect-error` in `spawnMapWorker.ts` goes when tsconfig moves to ES modules.
