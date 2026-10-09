# The map pipeline runner and its worker (DDB-446)

Date: 2026-10-09. Code: `src/renderer/game/map/MapPipeline.ts` (the runner), `AreaMapPipeline.ts` (today's stages), and `map/worker/` (the worker, its client, the transfer format, and the dev hook). Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Seeds and determinism, Pipeline, Validation and retries, Performance, and Saving. Follows [realistic-map.md](./realistic-map.md), decision 5, and builds on [seeded-prng.md](./seeded-prng.md) and [map-params.md](./map-params.md).

## Context

The spec runs generation as a pipeline: each stage on a stream forked from its upstream's winning stream with its own name and attempt, each with its own checks and an optional `accept(map, stage)` hook after them, 8 attempts a stage and then a whole-map restart up to 32, stops and dressing retrying only themselves, and debug and release builds parting ways past each cap. It runs once, at founding, in a Web Worker in the web build and the Electron renderer alike.

None of that existed. Three places chained terrain, highways, and growth by hand on flat streams, `root.fork('map', 0).fork(stage, attempt)`, with no checks and no retries: `roadTesting.growMap`, `scripts/road-growth.mjs`, and the gallery's area map fixture. A retry there was a caller asking for `growthAttempt: 1`.

What the worker had to fit:

- tsconfig compiles to CommonJS, and TypeScript rejects `import.meta` under it.
- Jest runs in Node, where there's no `Worker`.
- The Electron renderer is sandboxed with context isolation, and a packaged build loads it from `file://`.
- webpack splits every chunk (`splitChunks: 'all'`), and neither build sets a Content-Security-Policy.
- Terrain's insides change with uplift and erosion (Map 4), so the pipeline calls terrain only through `generateTerrain`.

## The runner

`MapPipeline` is an ordered list of stages, built a stage at a time so each stage's upstream is typed, and immutable:

```ts
new MapPipeline<MapParams>()
	.stage(TERRAIN_STAGE)
	.stage(HIGHWAYS_STAGE)
	.stage(growthStage({ branchiness, clearance }))
	.run({ seed, input: params, accept, onProgress });
```

A stage has a name, `run({ input, products, rng })`, an optional `check(product, { input, products })`, and an optional `localRetry` flag. Checks and the accept hook return problems as a list of strings, and an empty list passes. A stage that throws has a bug, not a failure, so the exception goes straight out.

- Streams nest. A map attempt's stream is `root.fork('map', m)`, the first stage's is that forked with its name and attempt, and every later stage's is its upstream's winning stream forked the same way. `fork` reads only its parent's seed, so how many draws a stage made never moves its children, and a failed attempt leaves nothing behind. Attempts count from 0 per stage in each map attempt, so they can't collide, and a rerun upstream gives everything below it fresh streams because they hang from a different parent.
- A failing stage reruns on the products its upstream already made; nothing upstream recomputes. After 8 failures the map restarts on its next attempt, up to 32. The accept hook runs after a stage's own checks pass, sees the map so far with the stage's output in it, and its rejection counts as the stage failing.
- A local-retry stage reruns alone and never restarts the map. Past its 8, a debug build throws and a release build warns and keeps its best attempt, the one with the fewest problems, the earliest on a tie. Later stages nest in the kept attempt's stream, and the result's `keptFailing` names the stage.
- Past the map cap a debug build throws a `MapPipelineError` naming the last failure. A release build warns and starts over on the next seed, `seed + 1` wrapped to uint32, keeping the params, and gives up after 4 seeds, throwing in release too, so a set of params no seed can satisfy ends rather than spinning.
- Debug is `__DEV_TOOLS__`, the DefinePlugin constant every other dev-only path reads, unless the caller passes `debug`. Node scripts pass it, since nothing defines the constant there.
- The result holds the products, the seed the map came from, the map attempt, each stage's winning attempt and winning stream (as its seed), per-stage timings (runs, milliseconds in runs, and milliseconds in checks and the hook), every failed attempt with its problems, and the whole run's milliseconds. Progress is reported as each attempt starts, with the stage, its index and the count, the attempt, the map attempt, and the seed.

A stage list typed loosely, every stage seeing `Partial<Products>`, was simpler but put a non-null assertion on every upstream read. The builder costs one generic type and catches a stage placed before what it reads.

## Today's stages

Terrain, then the highways and growth, as stand-ins until settlements and road links (Map 7 and 8) replace them, named for the streams they always drew on. Growth's check is `checkRoadNetwork`, the network checks the map validator will run, worded `rule: detail`.

Terrain is the first stage, so its stream is the `root.fork('map', 0).fork('terrain', 0)` it always had, and the terrain goldens hold. The highways now draw under terrain's winning stream and growth under the highways', so every seed grows different roads: the area map goldens moved, and the tests that pinned the old streams now pin the nested ones. `roadTesting.growMap`, `scripts/road-growth.mjs`, and the gallery fixture (now `fixtureAreaMap`) all run the runner. `growMap` composes its own pipeline when a test lays water over the terrain, and asks for growth's second attempt by rejecting its first through the accept hook. The property test now also asserts growth won on its first attempt, since a network failing the checks would otherwise be retried out of sight, and `road-growth.mjs check` reports every first-attempt failure, the spec's health metric.

## The worker

### A worker per generation

Options:

1. In-process on the page's thread. Nothing to bundle, and fastest end to end, but the whole run blocks the frame: a 35 to 37 ms pipeline today at radius 1000, and the spec's grid stages budget a second.
2. One long-lived worker, kept for every generation. Its code stays compiled, so after the first a generation costs about what it does on a warm thread. But it holds memory between generations, and cancelling one means terminating the worker or checking for a cancel inside the stages.
3. A worker per generation, terminated when the map comes back (chosen). Cancelling is `terminate()`, the memory goes with it, and nothing carries over between generations. The cost is starting a worker and running cold code every time: in Electron the pipeline takes 93 ms in a fresh worker against 38 ms in a warm one.

Founding generates once a campaign, so the cold cost is paid once either way, and terminate-as-cancel keeps the founding screen simple. The Map Lab, which regenerates on every change, is where a long-lived worker would pay; the worker entry already answers any number of requests, so that's a client-side change when the Map Lab moves off the main thread.

### The transfer format

Options:

1. Post the products as they are. `Terrain` is a class holding noise generators and closures, which structured clone refuses, and the network is 150 to 250 small arrays of numbers cloned one by one.
2. JSON. One string, but 160 to 290 KB of digits written and parsed at radius 1000.
3. Plain data with the bulk packed into transferred typed arrays (chosen). Every stretch's points go end to end in one `Float64Array`, with a `Uint32Array` of where each stretch starts, and both buffers transfer rather than copy. Float64, so every coordinate arrives exactly as generated and junctions still match. Nodes, roads, the stretches' other fields, the highways, growth's stats, and the run's attempts, streams, timings, and failures are small and go by structured clone.

The terrain isn't sent at all. Today's terrain is analytic fields built in about 2 ms, so the client rebuilds it from the terrain stage's winning stream, which costs less than any encoding of it would; the whole decode, unpacking included, takes 3 ms median on the main thread. A gridded terrain (Map 4's erosion) changes that one function: its grids go as typed arrays in the same transfer list, and the client wraps them instead of regenerating. Errors cross as plain data too, a `MapPipelineError` with its failure intact.

The in-process fallback runs the same `generateTransfer` the worker does and decodes the same way, so a map is identical whichever path made it, and the Jest tests of the fallback cover the format the worker sends.

### Bundling

Options:

1. webpack 5's `new Worker(new URL('./mapWorker.ts', import.meta.url))` (chosen). webpack bundles the worker and its imports into a chunk of its own, `map-generation.[contenthash].js`, which loads what it shares with the page through `importScripts`, resolved against the chunk's own URL, so it works over http and from `file://` without configuration. In a production-mode build that's a 4.5 to 6 KB chunk plus a 50 KB chunk of the map modules.
2. A separate webpack entry with a fixed file name, created by URL. It needs its own split-chunks rule and a name the page knows without the content hash.
3. worker-loader, built for webpack 4 and superseded by option 1.
4. A Blob URL from an inlined bundle. It needs a second build to inline and `blob:` in any future CSP.

The cost of option 1 is the `import.meta` that CommonJS can't type. TypeScript still emits it untouched, so one `@ts-expect-error` in `spawnMapWorker.ts` covers it, and webpack resolves it at build time; the directive turns into an error of its own if the project ever moves to ES modules. Jest runs the CommonJS as it is, so `jest.config.js` maps that module to a stub that spawns nothing, beside the asset and shader stubs, and the client runs in-process there. Nothing else in the client knows about webpack.

Neither build sets a Content-Security-Policy (no meta tag in `public/`, no header handler in `electron/main.ts`), so nothing restricts workers. A CSP added later needs `worker-src 'self'`, and the packaged `file://` renderer should be rechecked under it. The web dev server's cross-origin isolation is satisfied as is: the worker's scripts come from the same server, with the same headers.

The client starts a worker wherever `Worker` exists, and generates in-process, after a warning, if the platform refuses one. It reports progress, resolves with the decoded map and its wall and decode times, and `cancel()` terminates the worker and rejects with `MapGenerationCancelled`, the way an aborted fetch rejects.

### Showing it

Development builds have `window.__map.generate(set?, { inProcess? })`, installed from Game's `__DEV_TOOLS__` branch beside the other debug hooks. It makes the map in a worker (or on the page's thread, for comparison), logs one line of where the time went, and resolves with the same numbers for a script to read. With no map section on the Developer screen, a hook leaves `sections.ts` untouched. Production bundles carry neither the hook nor the worker until founding imports the client.

## Timings

Radius 1000, five environments by three seeds, on the development desktop (Windows 11), every map winning every stage on its first attempt. Builds in production mode with dev tools on, so the hook exists and the code is what ships. Wall is from asking to having the decoded map on the main thread.

| | Chromium 153 (web build, served over http) | Electron 25.9 (Chromium 114, renderer from `file://`) |
| --- | --- | --- |
| Wall, worker per generation | 145 ms median, 150 slowest | 105 ms median, 117 slowest |
| Pipeline in the worker | 74 ms | 93 ms |
| terrain, highways, growth + its checks | 11, 0.2, 48 + 15 ms | 16, 0.3, 55 + 21 ms |
| Decode on the main thread | 2.9 ms | 3.4 ms |
| Starting the worker and the messages | 58 ms | 9 ms |
| In-process on the page's thread, wall (pipeline) | 64 ms (37) | 38 ms (35) |
| One long-lived worker, first then median | 198 ms, then 66 | 103 ms, then 39 |

Electron against the development dev server, the build the screenshot harness runs, took 126 ms median wall with a 100 ms pipeline. Plain Node 24 runs the same stages in 2 ms of terrain, 17 to 29 ms of highways and growth, and 5 to 10 ms of checks: the gap to the worker's numbers is cold code, which every fresh worker starts with. All of it is far inside the spec's budget of a second for the grid stages; Map 4's erosion will take most of that budget, and its share of cold-code overhead will be smaller.

## What a save needs from it

Because streams nest, a stage's stream depends on every winning attempt above it, not on the map attempt alone. The land is rebuilt on load from terrain's stream, which needs the map attempt and terrain's attempt, and dressing, the last stage, from a stream nested under every stage before it. So the map attempt by itself can't rebuild the dressing. The result carries each stage's winning attempt and winning stream seed, and the save (Map 18) keeps the map attempt and every stage's winning attempt, a dozen small integers, or the stream seeds of the stages rebuilt on load. The spec's Saving section and realistic-map.md now say so.

## Where founding picks it up

Not built here: founding keeps its stand-in map until the save encoding exists. `foundCampaign` is synchronous and marks the generator's slot where it reads `MAP_STAND_IN`; its only caller, `MainMenuScreen.startCampaign`, is already async. So the hookup is in two halves:

- `MainMenuScreen.startCampaign`, behind the founding screen, resolves the founding params (`foundingParams` in Founding.ts, exported or split out), starts `new MapGeneration({ params, onProgress })`, shows progress, awaits `result`, and cancels it if the player leaves.
- `foundCampaign` takes the generated map in place of `MAP_STAND_IN` and keeps what the save needs: the map, the map attempt, and the stage attempts. When the result's seed isn't the one founding started from (release builds past the map cap), founding redoes the deal from the result's seed, the give-up path campaign-founding.md describes.

## Provisional calls

Calls the spec left open, made the simplest way consistent with it, for Kevin to approve or adjust:

1. A release build past the map cap takes `seed + 1`, wrapped to uint32, and keeps the params; after 4 seeds it throws in release too.
2. A local-retry stage that runs out keeps the attempt with the fewest problems, the earliest on a tie.
3. Growth's own check is `checkRoadNetwork`, so a network breaking a road rule is retried on growth's next stream rather than handed on.
4. A worker per generation, terminated when the map comes back; `cancel()` terminates it.
5. The stand-in stages are named `highways` and `growth`, the streams they always drew on, until the spec's `places` and `roads` stages replace them.

## Consequences

- Every stage the realistic map adds is a `.stage()` call with its checks; retries, streams, progress, timings, and the debug and release paths come with it.
- The accept hook is where the map validator (DDB-296) plugs in, stage by stage.
- Seeds grow different roads from before this change; the area map goldens were re-minted with it.
- A fresh worker runs cold code, roughly doubling the pipeline against a warm thread today. Fine for founding; the Map Lab wants a long-lived worker when it moves off the main thread.
- A future CSP has to allow `worker-src 'self'`, and the `@ts-expect-error` in `spawnMapWorker.ts` goes when tsconfig moves to ES modules.
