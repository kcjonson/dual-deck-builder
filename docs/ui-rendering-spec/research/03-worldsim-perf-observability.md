# worldsim: performance monitoring, observability, testability, dev tooling

Research notes for abstracting the worldsim (C++/OpenGL 3.3) UI-engine tooling into a
backend-agnostic spec, then porting to TypeScript/WebGL2 (browser + Electron).

Repo: `C:/Users/kevin/Code/worldsim`. All paths below are relative to that root. Line numbers
are from the checkout on 2026-09-07. Read-only research; nothing was modified.

Short orientation before the sections: the whole observability story in worldsim is one
embedded HTTP server (`libs/foundation/debug/DebugServer.*`, cpp-httplib) fed by lock-free ring
buffers from the game thread, plus a static React page that reads it. Everything else (screenshot,
input injection, scene control, UI-tree dump, layout lint, world-state readback, dev cheats) was
bolted onto that same server as GET endpoints with a "queue on the HTTP thread, execute on the
main thread" handshake. The design docs in `docs/technical/observability/` describe a much larger
system (profiler streams, hover inspection, UI event streams, golden screenshots, DebugDraw); only
the subset listed in section 5 was ever built, and that subset is what the owner and the agents
actually use.

---

## 1. Frame timing and game loop

### Loop structure

`engine::Application::run()` at `libs/engine/application/Application.cpp:94-314` is a single
variable-step loop (no fixed step, no accumulator). The header documents the order
(`Application.h:39-48`):

```
1. Calculate delta time (capped at 0.25s)
2. Poll GLFW events
3. Call pre-frame callbacks
4. SceneManager::HandleInput(dt)  [skipped if paused]
5. SceneManager::Update(dt)       [skipped if paused]
6. SceneManager::Render()
7. Call overlay renderer (application-level UI)
8. Call post-frame callbacks
9. Swap buffers
```

The actual code has the post-frame callback after the swap and after frame pacing (see below).
Concrete sequence in `Application.cpp`:

- `Application.cpp:113-122` delta from `glfwGetTime()`, capped to 0.25 s with a debug log.
- `Application.cpp:126-129` `glfwPollEvents()` wrapped in `high_resolution_clock` -> `m_frameTimings.pollEventsMs`.
- `Application.cpp:132-202` `InputManager::update`, then synthesized `UI::InputEvent`s
  (mouseMove every frame with modifier bits, mouseDown/Up per button edge, scroll) pushed
  through `SceneManager::Get().handleInput`. Scroll is only consumed if the UI handled it, so
  the scene can still use it for camera zoom (`190-201`).
- `Application.cpp:206-218` pre-frame callback (may return false to exit). AppLauncher installs
  the default one at `AppLauncher.cpp:387-458`: `g_metrics->beginFrame()`,
  `Primitives::beginFrame()`, drain injected input, then process one `ControlAction`.
- `Application.cpp:221-231` `SceneManager::update(dt)` unless paused; every scene call is wrapped
  in try/catch that logs and continues (the loop never dies from a scene exception).
- `Application.cpp:232-236` timing bookkeeping. Note the quirk: `inputEnd` is sampled *after*
  update, so `inputHandleMs` = input + pre-frame callback + scene update. It is a superset of
  `sceneUpdateMs`, not a sibling. The client displays both as if independent (`App.tsx:467-498`).
- `Application.cpp:239-263` `glClear`, `SceneManager::render()`, overlay renderer
  (`Primitives::endFrame()` by default, `AppLauncher.cpp:461`; the sandbox adds the UI-tree drain
  after it, `apps/ui-sandbox/Main.cpp:99-102`) -> `sceneRenderMs`. Render runs even when paused
  "so screen doesn't freeze".
- `Application.cpp:266-269` `glfwSwapBuffers` timed -> `swapBuffersMs`.
- `Application.cpp:271-287` frame pacing to a 120 FPS cap:

```cpp
constexpr float  kTargetFrameMs = 1000.0F / 120.0F; // 8.33ms for 120 FPS cap
constexpr double kSpinWindowMs = 2.0;
```

  sleep coarsely to `target - 2ms`, then `yield()` spin to the target. On Windows the loop
  brackets itself with `timeBeginPeriod(1)` / `timeEndPeriod(1)` (`102-106`, `309-311`) because
  `sleep_for` otherwise rounds to the 15.6 ms tick, which "silently capped frames at ~60 FPS and
  injected 25ms spikes" (that was a real bug, see section 11).
- `Application.cpp:290-294` `deltaTime` and `fps` recomputed after pacing so they reflect the
  capped frame.
- `Application.cpp:298-306` post-frame callback. AppLauncher's default (`AppLauncher.cpp:464-487`)
  pushes `Primitives::getStats()` and the `FrameTimings` into `MetricsCollector`, calls
  `endFrame()`, then `DebugServer::setCurrentSceneName`, `updateMetrics(getCurrentMetrics())`,
  and `captureScreenshotIfRequested()`.

Consequence worth carrying into the spec: because `MetricsCollector::endFrame()` runs after the
pacing sleep, `frameTimeMs` floors at 8.33 ms whenever the app is idle. To see real cost you read
`sceneRenderMs`/`sceneUpdateMs`, or turn vsync off and look at the breakdown, which is exactly what
`scripts/perf-capture.ps1` does.

### vsync and swap

- `glfwSwapInterval(1)` at window creation (`AppLauncher.cpp:142`).
- Runtime toggle: `GET /api/control?action=vsync&value=0|1` -> `ControlAction::SetVsync` ->
  `glfwSwapInterval(getTargetVsync())` on the main thread (`AppLauncher.cpp:446-450`).
- `swapBuffersMs` is the only place GPU backpressure shows up on the CPU side. The client labels
  that bar "GPU" (`apps/developer-client/src/components/FrameBudgetBar.tsx:41`). This is honest but
  coarse: it includes the vsync wait, driver present, and any queued GPU work the swap has to wait
  on. It was still enough to find the 30 ms tile/entity shader bottleneck (section 11).

### Frame-time statistics

`Renderer::MetricsCollector` (`libs/renderer/metrics/MetricsCollector.{h,cpp}`):

- 60-sample rolling window, pre-filled with 16.67 ms (`MetricsCollector.cpp:16`).
- `frameTimeMs` is the last sample; `fps = 1000/frameTimeMs` (instantaneous, not averaged,
  `141-146`).
- min/max over the window (`148-160`).
- Histogram buckets `<8`, `8-16.67`, `16.67-33.33`, `>33.33` ms (`162-180`).
- "1% low" = value at index `size*0.99` via `std::nth_element` on a reused scratch vector
  (`182-201`); actually the 99th percentile of frame time, i.e. the worst 1%.
- Spike counts of frames over 16.67 and over 33.33 ms in the window (`203-211`).

Setters for scene-supplied sections: `setTimingBreakdown(tileRenderMs, entityRenderMs, updateMs,
tileCount, entityCount, visibleChunkCount)`, `setEntityRenderStats`, `setEcsSystemTimings`,
`setGpuRenderTime`, `setMainLoopTimings` (`MetricsCollector.h:24-41`).

### Scene-level CPU sections

`apps/world-sim/scenes/game/GameScene.cpp:962-1073` brackets tile rendering and entity rendering
with `Clock::now()` and reports them plus the previous update's `m_lastUpdateMs`. Per-ECS-system
timings come from `ecs::World::update` (`libs/engine/ecs/World.h:155-172`), compiled in by
`ECS_ENABLE_SYSTEM_TIMING` (default 1, `World.h:15-17`):

```cpp
struct SystemTiming { const char* name; float durationMs; };
```

Sandbox perf scenes do their own thing: `VectorPerfScene` counts frames per second itself and
times its draw loop (`apps/ui-sandbox/scenes/VectorPerfScene.cpp:61-69, 84, 117-119`), and
returns those numbers from `exportState()` (`160-164`).

### Budget targets in the repo

- 120 FPS cap in the loop (8.33 ms), and the client's `FrameBudgetBar` defaults `targetMs = 8.33`
  (`FrameBudgetBar.tsx:9,18`).
- `docs/technical/vector-graphics/performance-targets.md:7-25`: target 60 FPS, minimum 30,
  stretch 120; <100 draw calls (target 10-50); GPU <6 ms; a per-system 16.67 ms budget table.
- `.claude/plans/render-performance-overhaul.md:113-126` success criteria: 120+ FPS idle at every
  zoom, p99 < 16.7 ms while scrolling, `tileRenderMs < 0.5ms`, `entityRenderMs < 2ms`.
- Client thresholds (ok/warning/bad) live in `App.tsx:412-498` and `505-565`: FPS 55/30, frame
  16.67/33.33, GPU 10/16, poll 1/5, input 2/5, update 4/8, render 8/16, swap 2/10, memory
  500/1000 MB.

---

## 2. Metrics collection

### Every metric recorded

`Foundation::PerformanceMetrics` (`libs/foundation/metrics/PerformanceMetrics.h:18-70`):

| Group | Fields | Source |
|---|---|---|
| Frame | `timestamp`, `fps`, `frameTimeMs`, `frameTimeMinMs`, `frameTimeMaxMs` | MetricsCollector window |
| Renderer | `drawCalls`, `vertexCount`, `triangleCount` | `Primitives::getStats()` + entity renderer raw GL draws |
| Scene breakdown | `tileRenderMs`, `entityRenderMs`, `updateMs`, `tileCount`, `entityCount`, `visibleChunkCount` | GameScene |
| Histogram | `histogram0to8ms`, `histogram8to16ms`, `histogram16to33ms`, `histogram33plusMs`, `histogramTotal` | MetricsCollector |
| Spikes | `frameTime1PercentLow`, `spikeCount16ms`, `spikeCount33ms` | MetricsCollector |
| ECS | `ecsSystems[] {name, durationMs}` | `World::getSystemTimings()` |
| GPU | `gpuRenderMs` | GPUTimer (broken, see 3) |
| System | `memoryUsedBytes`, `memoryPeakBytes`, `cpuUsagePercent`, `cpuCoreCount` | SystemResources (macOS only) |
| Input | `inputLatencyMs` | declared, never set anywhere |
| Main loop | `pollEventsMs`, `inputHandleMs`, `sceneUpdateMs`, `sceneRenderMs`, `swapBuffersMs` | Application::FrameTimings |

Serialized by a hand-written `ostringstream` `toJSON()` (`PerformanceMetrics.cpp:9-66`) with
`setprecision(2)`. The SSE stream appends `"sceneName"` before the closing brace
(`DebugServer.cpp:883-886`).

Renderer stats are thin. `Primitives::RenderStats` is only
`{drawCalls, vertexCount, triangleCount}` (`libs/renderer/primitives/Primitives.h:325-331`,
mirrored in `BatchRenderer.h:171-176`). There is no count of flushes by reason, texture binds,
clip pushes, z-sorts, upload bytes, layout time, or hit-test time. The batcher does have the
information (it splits draws per text atlas and stable-sorts `DrawGroup`s when any explicit z is
present, `BatchRenderer.h:220-235`) but never counts it. The `EntityRenderer` bypasses the batcher
with raw GL, so its draws/triangles are added separately (`MetricsCollector.cpp:113-116`,
`GameScene.cpp:1059`); before that fix the dashboard reported 3 draw calls for the whole game.

`SystemResources::sample()` is `#ifdef __APPLE__` only (`libs/foundation/metrics/SystemResources.cpp:5-10, 25-81`),
so memory/CPU read 0 on Windows. It is sampled every 10th `getCurrentMetrics()` call
(`MetricsCollector.cpp:75-85`), i.e. every 10 frames, and cached in function statics.

### Data structure and threading

`Foundation::LockFreeRingBuffer<T, N>` (`libs/foundation/debug/LockFreeRingBuffer.h`), single
writer, atomic write index only:

```cpp
void write(const T& item);             // game thread, overwrites oldest, never blocks
bool readLatest(T& item) const;        // newest only (metrics)
size_t writeCursor() const;            // absolute count ever written
bool peekAt(size_t idx, T& item) const;// non-consuming read by absolute index (logs)
```

`DebugServer` owns `LockFreeRingBuffer<PerformanceMetrics, 64> metricsBuffer` and
`LockFreeRingBuffer<LogEntry, 1000> logBuffer` (`DebugServer.h:220-224`). The header's contract:
"If ring buffer is full, oldest entries are dropped. Performance > Complete Logs. Never blocks game
thread." (`DebugServer.h:13-14`).

Two honest caveats for the spec:

- `PerformanceMetrics` contains a `std::vector<EcsSystemTiming>`, so `buffer[i] = item` heap
  allocates on the game thread and a reader copying the same slot while the writer laps it is a
  data race on that vector. The design assumes trivially copyable `T`; the metrics struct quietly
  violates it. Practically harmless (64 slots vs a 10 Hz reader) but not the "10-20 ns" the
  comments claim.
- The log ring is single-writer; `Logger::log` writes from whichever thread logs. Chunk generation
  and mesh baking were moved to worker threads in 2026-06 (section 11), so any `LOG_*` from a
  worker breaks the single-writer assumption.

The log stream was originally a shared consuming `read()`; it was rewritten so each SSE client
keeps its own cursor and reads forward with `peekAt`, starting one ring-length behind the write
cursor so a fresh panel sees recent history (`LockFreeRingBuffer.h:5-10`,
`DebugServer.cpp:918-934`). Reason: "the old shared, consuming read() let one reader starve the
rest."

### Sampling rates and exposure

- Written once per frame from the post-frame callback (`AppLauncher.cpp:480-484`).
- `GET /api/metrics` returns the latest sample; `GET /stream/metrics` is SSE at 10 Hz
  (`DebugServer.cpp:862-906`, `updateRateHz = 10`, 10 ms sleeps between checks).
- `GET /stream/logs` SSE at 10 Hz batches (`909-953`).
- No in-viewport metrics overlay exists. The in-game `DebugOverlay` UI component shows only chunk
  count, camera position/chunk, and biome (`apps/world-sim/scenes/game/ui/views/DebugOverlay.h:5-10`).
  The design principle was "Zero in-game overhead. All visualization happens in an external
  browser window" (`docs/technical/observability/INDEX.md:10`).
- `scripts/perf-capture.ps1` polls `/api/metrics` for scripted sweeps (section 4).

### Overhead guards and toggles

- `AppConfig::enableDebugServer`, `debugServerPort`, `enableMetrics` (`libs/engine/application/AppConfig.h:16-21`);
  `--http-port N` CLI overrides the port (`AppLauncher.cpp:295-302`). Both flags are `true` in all
  three apps (ui-sandbox port 8090 `apps/ui-sandbox/Main.cpp:58-60`; world-sim 8081
  `apps/world-sim/Main.cpp:11-13`; asset-manager 8070). The docs still say 8081 sandbox / 8082 game
  (`observability/INDEX.md:54-57`), and `CLAUDE.md:249-255` says 8081 for the sandbox; code wins.
- `DEVELOPMENT_BUILD` is defined for Debug and RelWithDebInfo (`libs/foundation/CMakeLists.txt:25`,
  `$<$<CONFIG:Debug,RelWithDebInfo>:DEVELOPMENT_BUILD>`). It gates the Logger->DebugServer hookup
  (`Log.cpp:117-124`) and compiles `LOG_DEBUG/INFO/WARNING` to `((void)0)` in Release
  (`Log.h:76-88`). The DebugServer class itself is *not* compiled out in Release, despite the docs
  saying so (`developer-server.md:408-435`); only the config flag stops it.
- `GPUTimer` is disabled by default "to avoid driver overhead" (`GPUTimer.h:28,52`) and enabled
  only by GameScene (`GameScene.cpp:583`).
- `ECS_ENABLE_SYSTEM_TIMING` compile macro (`World.h:15-17`).
- Server binds `127.0.0.1` only (`DebugServer.cpp:1017`) and disables `SO_REUSEADDR` so a second
  instance fails fast with a printed `curl .../api/control?action=exit` hint (`553-557`, `1018-1025`).

---

## 3. GPU timing

`Renderer::GLQuery` is an RAII wrapper over `glGenQueries/glDeleteQueries` with
`begin(target)`, static `end(target)`, `isResultAvailable()` (`GL_QUERY_RESULT_AVAILABLE`), and
`getResult()` (`glGetQueryObjectui64v`, documented "blocks if not yet available")
(`libs/renderer/gl/GLQuery.h:60-82`).

`Renderer::GPUTimer` (`libs/renderer/metrics/GPUTimer.{h,cpp}`):

- Two `GL_TIME_ELAPSED` queries, `kQueryCount = 2`, "double-buffered - you get the previous
  frame's time" (`GPUTimer.h:13, 46`).
- Support check `GLEW_ARB_timer_query || GLEW_VERSION_3_3`; unsupported -> logs a warning and every
  call is a no-op, `getTimeMs()` stays 0 (`GPUTimer.cpp:9-22`).
- `begin()`: if a previous result exists and `isResultAvailable()`, read it (ns -> ms) into
  `lastTimeMs`; then `glBeginQuery` on the current slot (`24-42`). `end()`: `glEndQuery`, mark
  `hasResult`, advance the slot (`44-55`). Non-blocking; a result that is not ready is simply
  skipped that frame. One-frame latency.
- Single anonymous scope. No names, no nesting, no hierarchy (GL allows only one active
  `GL_TIME_ELAPSED` query at a time anyway; nesting would need `GL_TIMESTAMP` pairs).

Usage: `m_gpuTimer.begin()` right after the clear in `GameScene::render` (`GameScene.cpp:964`)
and `end()` after `gameUI->render()` but *before* `Primitives::endFrame()` flushes the batched UI
(`1046`; the flush happens in the Application overlay callback). Recorded status: "gpuRenderMs is
unusable (352ms readings; query window also misses the uber-batch flush)"
(`docs/development-log/entries/2026-06-09-render-performance-analysis.md:43`,
`.claude/plans/render-performance-overhaul.md:47-48`). Phase 4 of that plan, still open: "move
begin/end to wrap the whole frame including Primitives::endFrame, keep 2-frame latency reads;
sanity-check against frame time" (`plan:99-100`).

The client shows `gpuRenderMs` as a headline stat and sparkline with 10/16 ms thresholds
(`App.tsx:424-429, 540-546`), so a broken number was on the dashboard for months. A sanity check
against frame time would have flagged it.

---

## 4. Benchmarks

### Harness

Google Benchmark via vcpkg (`vcpkg.json`). `*.bench.cpp` files are collocated with the code and
globbed into one `<lib>-benchmarks` executable per library
(`libs/renderer/CMakeLists.txt:88-126`, same pattern in foundation). Benchmarks compile `-O3`
(non-MSVC) while `<lib>-tests` compile `-O0`. They are registered with ctest but excluded from the
CI gate: `ctest -j4 --output-on-failure -E "(benchmarks|world-tests-heavy)"`
(`.github/workflows/tests.yml:77-80`). Local convention: `ctest ... -LE heavy -E benchmarks -j 13`
(`docs/workflows.md:152`).

### What is benchmarked

`libs/renderer/primitives/ZSort.bench.cpp` (header comment `1-12`): "Measures the CPU cost that
the per-draw-call group queue + z-sort adds to the batch flush, in isolation (no GL)". Three cases
at 10k and 20k draw calls: `BM_ZQueue_Baseline` (indices as-is), `BM_ZQueue_FastPath` (one
`Group{indexStart,indexCount,zIndex}` record per draw, no explicit z so no sort),
`BM_ZQueue_Sorted` (~2% explicit z, `std::stable_sort` then rebuild emit-order index list). It
mirrors `BatchRenderer::DrawGroup` exactly (`BatchRenderer.h:228-235`) rather than linking it,
so it can run without a GL context. Reports `SetItemsProcessed`.

`libs/renderer/primitives/Clipping.bench.cpp`: copies `ComputeClipBounds` / `IntersectClipBounds`
"from Primitives.cpp for isolated benchmarking" (`17`), then benchmarks rect/circle/8-vertex-path
bounds, intersection, push/pop of a `std::stack<ClipStackEntry>`, nested depth 1/2/4/8/16
(`BM_NestedClipRegions`, "Window > Panel > Card > Content"), rapid switching over 10-200 list items
(`BM_RapidClipSwitching`), and a CPU stand-in for the fragment-shader clip test over 1k-100k
fragments (`BM_FragmentClipCheck`, `277-305`).

`libs/renderer/vector/Tessellator.bench.cpp`: convex n-gon fan fast path (8-512 verts), concave
"wobbly blob" ear-clipping path (16-512, "watch O(n^2) at high counts"), 5-point star. Silences
the tessellator's per-call logging first (`46`) and exports `state.counters["tris"]` (`57`).

Foundation also has `Arena.bench.cpp`, `HashNoise.bench.cpp`, `Pcg32.bench.cpp`,
`TaskPool.bench.cpp`.

A second "benchmark" form is the sandbox scene: `ArenaScene::onEnter` runs arena-vs-malloc
timing, alignment, capacity, and scoped tests and writes results through `LOG_INFO`
(`apps/ui-sandbox/scenes/ArenaScene.cpp:29-43, 77-134`); its `render()` draws nothing. It is a
runnable perf check whose output is the log stream.

### How results are recorded and compared

Benchmark output is not archived anywhere. `perf-results/` holds *runtime* captures, not
Google Benchmark output:

- `perf-results/baseline-2025-11-30.json` is hand-assembled: per-scene `samples[]` of
  `{fps, frameTimeMs, frameTimeMinMs, frameTimeMaxMs}` from the sandbox, a `summary`, and an
  `analysis` block ("clip_scene_vs_shapes": "9x slower (0.63ms vs 0.07ms)"). Its `notes` admit
  "drawCalls/vertexCount/triangleCount show 0 - metrics tracking needs investigation" and "vsync
  appears off for simple scenes but on for complex scenes".
- `capture-2026-06-09-223132.json`, `capture-2026-06-10-085724.json`,
  `capture-4x-density-final.json` are produced by `scripts/perf-capture.ps1`: an array of
  `{scenario, samples[]}` where each sample has 17 fields copied from `/api/metrics`
  (`perf-capture.ps1:28-35`: fps, frameTimeMs, frameTimeMaxMs, p99Ms, spikes16, spikes33,
  drawCalls, triangles, vertices, tileMs, entityMs, updateMs, sceneUpdateMs, sceneRenderMs, swapMs,
  tileCount, entityCount, chunks). Scenarios: idle at zoom 20/8/3/1.5/0.75/0.5/0.25, scroll at
  zoom 3 and 0.75 (`52-72`). The script turns vsync off first, drives the camera through
  `/api/control?action=camera`, sleeps for chunk loads to settle, samples 5-25 times, prints a
  one-line summary per scenario, restores vsync.

Comparison is manual: the before/after table in
`docs/development-log/entries/2026-06-10-render-performance-overhaul.md:11-19` was assembled by
reading two captures. No diff tool, no CI threshold. Plan Phase 4 wants per-window max of
`sceneRenderMs/sceneUpdateMs` "so single-frame hitches are attributable from JSON alone" and "a
new baseline JSON to perf-results/ after each phase lands" (`plan:102-104`).

---

## 5. The ui-sandbox app as a pattern

### Structure

`apps/ui-sandbox/Main.cpp` is 114 lines: an `engine::AppConfig` (title, 80% window, debug server
on 8090, metrics on, scene registry callback, default scene), `AppLauncher::initialize`, an
optional `NavigationMenu` overlay, an overlay renderer that flushes primitives then serves UI-tree
requests, and `AppLauncher::run/shutdown`.

Scene registry is an X-macro (`apps/ui-sandbox/SceneTypes.h:18-45`):

```cpp
#define UI_SANDBOX_SCENES(X) \
	X(Arena) X(Handle) X(Button) X(TabBar) X(TextInput) X(Grass) X(VectorPerf) X(Svg) X(Clip) \
	X(Layer) X(TextShapes) X(SdfMinimal) X(InputTest) X(Tree) X(Layout) X(Scroll) X(Icon) \
	X(TreeView_) X(Dropdown) X(Toast_) X(Dialog_) X(Tooltip_) X(ContextMenu_) X(TextWrap) \
	X(Planet) X(Salvage) X(SalvageDialog)
```

It generates the enum, `extern const SceneInfo` declarations, and the registry table
(`SceneTypes.cpp:5-33`). Each scene file is self-registering:

```cpp
namespace ui_sandbox::scenes {
	extern const ui_sandbox::SceneInfo VectorPerf = {kSceneName, []() { return std::make_unique<VectorPerfScene>(); }};
}
```

(`VectorPerfScene.cpp:275-277`). Scene names are lowercase strings (`"vector-perf"`, `"clip"`,
`"layer"`, `"arena"`) used by `--scene=<name>` on the command line (`AppLauncher.cpp:292-294`) and
by `/api/control?action=scene&scene=<name>`.

Scene interface `engine::IScene` (`libs/engine/scene/Scene.h`): `onEnter`, `update(dt)`,
`render`, `onExit`, `exportState() -> JSON string`, `getName`, optional `handleInput(InputEvent&)`,
optional `getUiRoots() -> vector<const UI::IComponent*>` (`82-85`, "Top-level UI roots for the
/api/ui/tree and /api/ui/lint snapshot").

Three kinds of scenes:

- Component gallery, one scene per widget: Button, TabBar, TextInput, Dropdown, Toast, Dialog,
  Tooltip, ContextMenu, Scroll, Icon, TreeView, Slider, TextWrap, Layout. These own real component
  trees and override `getUiRoots()` (e.g. `ButtonScene.cpp:232-244`, `LayoutScene.cpp:255-267`).
- Perf/stress scenes: `VectorPerf` (10,000 tessellated stars, `C` toggles clipping, logs
  generation time per star, `VectorPerfScene.cpp:38-47, 188-221`), `Grass`, `Clip` (four clipping
  demos with `C` toggle and animated scroll, `ClipScene.cpp:30-117`), `Arena` (memory tests).
- Integration: `Planet`, `Salvage`, `SalvageDialog`.

`LayerScene` (`apps/ui-sandbox/scenes/LayerScene.cpp`) is the z-order fixture: a `Container`
with rectangles/text at zIndex 0-3, ascending and descending overlap stacks (`90-122`), so
z-sorting bugs are visible at a glance.

The `NavigationMenu` (`apps/ui-sandbox/NavigationMenu.{h,cpp}`) is an `engine::IOverlay` pushed on
`SceneManager` (`Main.cpp:93`): overlays "receive input before scenes, persist across scene
transitions, render on top" (`NavigationMenu.h:20-23`, `SceneManager.h:112-126`). It is only
created when no `--scene` argument is given (`Main.cpp:75`), so scripted runs are free of the
menu's pixels.

### HTTP control, exact endpoint list

All routes are in `DebugServer::serverThreadFunc` (`libs/foundation/debug/DebugServer.cpp:550-1027`).
Every handler sets `Access-Control-Allow-Origin: *`. Everything is GET with query params ("GET
with query params over POST+JSON: simpler, browser-testable, no JSON parsing",
`docs/development-log/entries/2025-10-29-sandbox-control-endpoints-implementation.md:42`).

| Endpoint | Behaviour | Response |
|---|---|---|
| `GET /api/health` (`562-573`) | snapshot timestamp | `{"status":"ok","uptime":<ms>}` |
| `GET /api/metrics` (`576-580`) | latest `PerformanceMetrics` | JSON, fields in section 2 |
| `GET /api/ui/screenshot` (`583-598`) | sets `screenshotRequested`, HTTP thread sleeps 10 ms loops up to 10 s; main thread's post-frame callback does `glReadPixels` RGBA, flips rows, forces alpha 255, PNG-encodes (`339-399`) | `image/png`, `Content-Disposition: inline; filename="screenshot.png"`; 500 `{"error":"Screenshot capture timeout or failed"}` |
| `GET /api/input?ev=<csv>[&ev=...]` (`600-649`) | parses each `ev`, queues `InputCommand`s | `{"status":"ok","queued":N}`; 400 `{"error":..., "ev":...}` |
| `GET /api/dev/<verb>?k=v&...` (`651-685`) | queues a domain-agnostic `DevCommand{verb, params[]}` (`DebugServer.h:72-95`) | `{"status":"ok","verb":"spawn","queued":1}` |
| `GET /api/state?what=summary|colonists|construction|stations|storage|landing|time|scene` (`687-700`) | synchronous handshake: `requestState` parks the HTTP thread on a condvar (2 s), the game thread `consumeStateRequest` -> serializes -> `deliverState` (`502-548`) | app JSON; 503 `{"error":"state request unavailable (timed out, busy, or game scene not running)"}` |
| `GET /api/ui/tree`, `GET /api/ui/lint` (`702-719`) | same handshake with `what = "ui.tree" / "ui.lint"` | see section 7; 503 on timeout |
| `GET /api/control?action=...` (`721-858`) | atomic `ControlAction` consumed on the main thread | see below |
| `GET /stream/metrics` (`862-906`) | SSE, 10 Hz, `event: metric` | metrics JSON + `"sceneName"` |
| `GET /stream/logs` (`908-953`) | SSE, 10 Hz batches, per-connection cursor, `event: log` | `{"level","category","message","timestamp","file","line"}` |
| `GET /` (`965-1013`) | static HTML listing the endpoints | |

`/api/control` actions (`725-858`), and how each executes in the pre-frame callback
(`AppLauncher.cpp:405-456`):

- `exit`: sets `ControlAction::Exit`, then *blocks the HTTP handler* until the main loop signals
  shutdown complete (30 s cap, `448-454`), returns
  `{"status":"ok","action":"exit","shutdown":"complete"}` with `Connection: close`. The main
  thread waits for `handlerDone` before `server->stop()` so the response is delivered
  (`265-297`). This is why the agent workflow says "no sleep needed" after exit.
- `scene&scene=<name>`: validated on the main thread via `SceneManager::getKeyForName`; failure is
  only logged, the HTTP reply is already `ok`.
- `pause` / `resume`: `Application::pause()` skips input and update, keeps rendering.
- `reload`: `switchTo(currentKey)` -> `onExit` + `onEnter`.
- `camera&x=&y=&zoom=&panx=&pany=`: `CameraCommand` with optional fields; pan is a persistent
  -1..1 direction "applied every frame like held movement keys; send panx=0&pany=0 to stop"
  (`DebugServer.h:38-51`); parsed with `strtof` and finiteness checks, 400 on malformed.
- `vsync&value=0|1`.

Input injection grammar (`DebugServer.cpp:600-612`, parser `29-107`):

```
click,x,y[,left|right|middle]   (expands to move+down+up)
move,x,y
down,x,y[,button]   up,x,y[,button]
scroll,x,y,delta
keydown,<key>   keyup,<key>   (key name, e.g. R or Escape; no coords)
```

Coordinates are logical UI pixels, "same space the screenshot endpoint captures"
(`DebugServer.h:53-56`). Dispatch (`AppLauncher.cpp:46-86`) goes through
`SceneManager::Get().handleInput(UI::InputEvent::mouseMove/mouseDown/mouseUp/scroll)` with
modifiers 0, i.e. the same path as real mouse events; keys go to
`InputManager::injectKey(key, down)` which "funnels through the exact path GLFW key events take"
(`InputManager.cpp:370-374`) because keys are polled, not routed as UI events. Injected input is
skipped while paused. Documented trap: a keydown and keyup in one request land in the same frame
and collapse to a release, so taps must be two requests (`DebugServer.cpp:608-612`).

Dev verbs (`docs/testing/README.md:87-107`): `spawn`, `colonist`, `give`, `need`, `time`,
`teleport`, `select`, `kill`, `complete`, `craft`, `storage`, `foundation`, `walls`, `opening`,
`freebuild`. The server never interprets them; `GameScene` drains `consumeDevCommands` before
`ecsWorld->update()` "so a command takes effect the same frame" (`GameScene.cpp:782-793`).

### The app-side drain

The state handshake needs someone on the main thread to answer. Three drains exist, all shaped the
same:

- ui-sandbox: `serveUiStateRequests()` in `Main.cpp:27-52`, called from the overlay renderer after
  `Primitives::endFrame()` "so the snapshot sees this frame's layout". Answers only `ui.tree` and
  `ui.lint`; anything else gets `{"error":"unknown state query (ui-sandbox serves ui.tree and
  ui.lint)"}` so the HTTP request does not hang to timeout.
- world-sim pre-game scenes: `world_sim::serveUiStateRequests(IScene&)`
  (`apps/world-sim/scenes/shared/UiStateDrain.cpp:15-42`), called at the end of each scene's
  `render()`; also serves `what=scene` from `exportState()`.
- GameScene: inline in `update()` (`GameScene.cpp:796-812`), routes `ui.*` to the UI serializer and
  everything else to `DevCommandHandler::serializeState`.

`IScene::exportState()` has existed since the beginning ("Used by debug server /api/scene/state
endpoint", `Scene.h:64-68`) but that endpoint never existed; it is only reachable as
`/api/state?what=scene` in pre-game scenes.

### How an agent verifies UI without a human

The mandated workflow in `CLAUDE.md:264-282` ("CRITICAL: Testing Visual Changes"):

1. `curl "http://127.0.0.1:8081/api/control?action=exit"` (blocking; connection refused is fine).
2. Rebuild.
3. Launch `ui-sandbox --scene=<scene>` in the background (never shell `&`).
4. `curl /api/ui/tree` for element bounds, `curl /api/ui/lint` "for invariant violations - expect
   `"count":0` before screenshotting. Don't verify coordinates by eye."
5. `curl -s /api/ui/screenshot > screenshot.png` ("implicitly waits for the app to be ready").

Plus: "Only capture a screenshot when requested by the user, avoid them where possible"
(`CLAUDE.md:246`), "Prefer logs over screenshots - Logs are tiny, screenshots consume context"
(`docs/technical/debugging-strategy.md:13`), and "Close the game as soon as your task is done"
(`CLAUDE.md:257`).

For gameplay, `docs/testing/` defines curl-driven scenarios: `README.md` (environment, launch on a
unique port, "poll until `/api/state?what=colonists` is valid JSON" as the ready check, verb and
readback tables), `TEMPLATE.md` (Preconditions / Setup / Steps / Expected state as JSON field
assertions / Pass-fail), four scenarios, and `regressions.md` (fixed-bug repros as API sequences
with expected outcomes). Sample assertion style (`scenarios/01-craft-axe-and-box.md:108-122`):

```
GET /api/state?what=colonists
  -> colonists[0].inventory.AxePrimitive >= 1
```

The dev log for the dev-tools API frames the point: "Before this, the dev API was
construction-only and write-only; every check went through a screenshot. Now you can ... read the
world back as JSON a test can assert on" (`2026-06-16-dev-tools-api-and-tab.md:9-11`).

`apps/asset-manager` reuses the identical server on port 8070 as a designer GUI with a Reload
button, "same `/api/ui/screenshot`, `/api/input`, `/api/control` as the game" (`CLAUDE.md:259-263`).

---

## 6. Developer client dashboard

`apps/developer-client/`: React 18 + TypeScript + Vite, built into one HTML file with
`vite-plugin-singlefile`, opened via `file://` (no dev server, and the README is emphatic about
not adding one, `README.md:38-42`). CORS `*` on the server makes cross-origin fetch/EventSource
work from `file://`. CMake builds it in single-config Debug/Development or with
`-DBUILD_DEVELOPER_CLIENT=ON`; Windows CI passes `OFF` (`CMakeLists.txt:160-215`,
`tests.yml:132`). Server URL is hard-coded `http://localhost:8081` (`App.tsx:15`), which means it
points at world-sim, not the 8090 sandbox, unless edited.

### Panels (Performance tab, `App.tsx:356-576`)

- `FrameBudgetBar` (hero): stacked bar of tiles / entities / update / GPU(=swapBuffersMs) /
  other against `targetMs = 8.33`, over-budget overflow segment, "Biggest: <name> (N% of budget)"
  insight line (`FrameBudgetBar.tsx:20-44, 112-114`). "Other" is `frameTime - measured`.
- `EcsSystemsBar`: one segment per ECS system, width relative to `updateMs`, legend with ms.
- `FrameHistogram`: the four buckets as a stacked bar, "N bad frames" alert when `spikeCount33ms > 0`,
  "N slow frames" when `spikeCount16ms > 2`, 1% low and window size (`FrameHistogram.tsx:31-33, 95-98`).
- `StatsRow` x3: key stats (FPS, Frame, GPU, Chunks, Tiles, Entities, Draw Calls, Vertices k);
  System (Memory, Peak, CPU/cores); Main Loop Breakdown (Poll, Input, Update, Render, Swap), each
  with ok/warning/bad colouring.
- `Sparkline` grid: FPS, Frame, Tiles, Entities, Update, GPU, Draws, Memory, CPU. SVG
  `<polyline>` in a 0..1 viewBox, auto-scaled Y, threshold colouring (`Sparkline.tsx`).
- `ScenePerformanceLog`: a session per `sceneName` change accumulating FPS/frame sums and sample
  counts; live row plus history, persisted to localStorage (`ScenePerformanceLog.tsx:26-58`).
- Record/pause button and retention selector 30 s / 1 min / 5 min / 10 min
  (`App.tsx:360-376`).

Logs tab: `LogViewer` with level filter, text search, count limit 500-5000, auto-scroll
detection, file:line for warnings/errors. Dev Tools tab: `DevToolsPanel` forms for the verbs and a
world-state JSON viewer; `DevToolsService` does one-shot `fetch()` (`DevToolsService.ts:15-42`).

### Data flow

`ServerConnection` wraps one `EventSource` per stream type, tracks connect/disconnect per stream,
and relies on the browser's auto-reconnect (`ServerConnection.ts:23-58`). Metrics history is a
`CircularBuffer<MetricsData>` sized `retentionSeconds * 10` (`App.tsx:133-150`); recreated on
retention change with history replayed. `LocalStorageService` persists metrics history, logs,
scene sessions, and preferences on `beforeunload` (`App.tsx:197-226`). Malformed SSE payloads are
surfaced as `System ERROR` log lines, throttled (`App.tsx:242-250`), added after the Windows
backslash-path bug (section 11).

### What proved useful, per the logs

- The "GPU" (swap) segment: "Other category was showing ~200% of frame budget, hiding the real
  issue ... Now clearly shows GPU (swapBuffers) as the bottleneck in red"
  (`docs/debug-swapbuffers-performance.md:29-32`).
- Scene name in the metrics stream plus per-scene sessions for comparing scenes
  (`2025-12-02-developer-client-enhancements.md`).
- The log stream as the primary evidence channel, which is what made "logs over screenshots"
  workable for agents.
- The Dev Tools tab is the only sending surface; everything else is read-only.

Designed but never built (still listed in `developer-client.md:401-416`, `ui-inspection.md:72-82`,
`observability/INDEX.md:75-94`): `UIHierarchyTree`, `HoverInspector`, `ProfilerView` flame graph,
`/stream/ui`, `/stream/hover`, `/stream/events`, `/stream/profiler`, `/api/scene`,
`/api/resources`, `/api/ui/element/:id`, `POST /api/ui/click`, F3 hover toggle, heartbeat
keepalives, catch-up replay on connect, JSON config for stream rates. `ServerConnection.ts:1`
still types `'ui' | 'hover' | 'events' | 'profiler'` streams that do not exist.

---

## 7. UI tree serialization and layout lint

### Serializer

`libs/ui/debug/UiTreeSerializer.{h,cpp}`. Per element (`UiTreeSerializer.cpp:15-34`):

```json
{"id": "btn_two" | null, "type": "Button", "bounds": {"x","y","w","h"},
 "margin": 5.0, "zIndex": 3, "visible": true, "children": [...]}
```

- `uiElementBounds` = `getPosition()` + `getWidth()/getHeight()`, which is the margin box; margin
  is emitted separately "so consumers can derive content bounds" (`UiTreeSerializer.h:12-19`).
- `uiElementChildren` uses `dynamic_cast<const Component*>`; shapes and other bare `IComponent`s
  are leaves (`UiTreeSerializer.cpp:10-13`).
- `id` and `type` come from `IComponent::debugId()` / `debugTypeName()`.
- Root document: `{"viewport": {"width","height"}, "roots": [...]}` (`36-47`), viewport from
  `Primitives::getLogicalViewport` (logical, not framebuffer pixels).
- `dump()` uses `error_handler_t::replace` so a non-UTF-8 id cannot throw inside the frame
  (`49-53`).
- Roots come from `IScene::getUiRoots()`. `GameUI::getUiRoots` lists its panels and only includes
  dialogs that are open (`apps/world-sim/scenes/game/ui/GameUI.cpp:634-660`).

Tests (`UiTreeSerializer.test.cpp`): leaf fields incl. margin-box arithmetic, null id, insertion
order, viewport+roots, invisible elements still serialized, and a `LayoutContainer` whose
`render()` lays out children so their positions "flow into snapshot" (`91-110`). All without GL.

### Lint

`libs/ui/debug/LayoutLint.{h,cpp}`. Header comment (`LayoutLint.h:14-24`): "Checks the invariants
normal HTML flow gives for free":

1. `sibling-overlap`: no two visible siblings overlap unless their `zIndex` differs; touching
   edges are not overlap, the intersection must exceed 0.5 px on both axes (`LayoutLint.cpp:32-36, 78-87`).
2. `child-outside-parent`: every visible child inside its parent's bounds, 0.5 px epsilon.
3. `outside-viewport`.
4. `zero-or-negative-size` for visible elements.
5. Reserved `sibling-gap-mismatch` ("Not implementable until LayoutContainer grows a gap property").

Roots are treated as siblings; invisible subtrees are skipped. Paths use ids when present, else
`Type[index]`, joined by `/` ("vertical_layout/btn_two", `13-22`). Two entry points: `lintUiTree`
returns a `LintResult{violations[]}` with `clean()` for C++ asserts; `lintUiTreeJson` wraps it for
HTTP (`LayoutLint.h:16-19`). JSON: `{"count": N, "violations": [{"rule","path","bounds",
"otherPath","otherBounds"}]}` (`122-146`).

Tests (`LayoutLint.test.cpp`) cover each rule plus a `LayoutContainer` Hug+Center case that used to
pin a defect and now asserts cleanliness (`149-164`), and JSON/struct parity.

### Why it makes UI machine-verifiable

- It is the acceptance gate: "The acceptance gate is machine-checked: `/api/ui/lint` reports zero
  violations on every screen" (`2026-07-03-game-ui-prototype-polish.md:9`); "Verification harness
  before engine before screens ('build the net before the thing it catches') - the lint caught real
  overlaps in every wave" (`:23`).
- Same function runs in unit tests (vitest equivalent) and against the live app, so a layout rule
  is pinned twice.
- Recorded gaps: no window-size CLI flag, "so multi-resolution lint passes aren't scriptable yet"
  (`:38`); a Hug-container freeze wart found by the lint (`:41`). The snapshot carries no text
  content, enabled/disabled state, colours, or hover state, although `ui-inspection.md:37-55`
  designed `"text"` and `"enabled"`. Primitive-level `.id` fields exist on `drawRect` etc.
  "for inspection/debugging" (`Primitives.h:157, 178`) but nothing reads them (`Primitives.cpp:383`
  only forwards one).

---

## 8. Diagnostic drawing

`docs/technical/diagnostic-drawing.md` designs an immediate-mode `DebugDraw` (`Line`, `Ray`,
`Box`, `Sphere`, `Circle`, `Axes`, `Line2D`, `Rect`, `Circle2D`, `Text`, `TextScreen`, then
`Render(viewProj)` + `Clear()` once per frame, batched into one `GL_LINES` draw, compiled out
without `DEVELOPMENT_BUILD`, `136-183`). Status line: "Priority: Implement Later" (`:6`). No
`DebugDraw` exists in `libs/` (grep confirms). No lifetimes/TTL API was ever specced either;
"Clear all (call after render)" is the whole lifetime model.

What exists instead is scene-owned overlay classes that call `Renderer::Primitives` directly with
reserved zIndex bands, each toggled by a hotkey in `GameScene::update` and drawn in
`GameScene::render` (`GameScene.cpp:1002-1013`):

- `RoomOverlay` (R): tint 56, outline 57, label 58 (`.../rooms/RoomOverlay.h:14-15`).
- `VisionOverlay` (V): fan 62, outline 64, occluders 65 (`.../vision/VisionOverlay.h:7-11`).
- `NavOverlay` (N): mesh edges 66, path 70, waypoint 71 (`.../nav/NavOverlay.h:14-15`).

They sit above wall bands (~60-64) and below the world/UI barrier. The layering rule is the
interesting part: batched z-sort only orders within one flush (`BatchRenderer.h:228-231`), so
GameScene calls `Primitives::flush()` as a "World/UI draw-order barrier" so "no world primitive
can ever sort above the UI" whose z-space is "panels 0, dialogs 500, menus 1000"
(`GameScene.cpp:1035-1040`). Debug drawing lives in world z-space, UI in its own, and the flush
is the wall between them.

Ad hoc lifetime handling shows up once: the move-order marker with `m_moveMarkerTtl` fading over
frames (`GameScene.cpp:1019-1032`).

The docs' argument for keeping this separate from the HTTP tools still holds: DebugDraw is
"temporary lines/boxes drawn IN viewport during manual debugging", the HTTP server is for
"metrics, logs, UI hierarchy, automated testing" (`diagnostic-drawing.md:479-508`).

---

## 9. Logging

`libs/foundation/utils/Log.{h,cpp}`:

```cpp
#define LOG_INFO(category, format, ...) \
	foundation::Logger::log(foundation::LogCategory::category, foundation::LogLevel::Info, __FILE__, __LINE__, format, ##__VA_ARGS__)
```

- Levels Debug/Info/Warning/Error; categories Renderer, Physics, Audio, Network, Game, World, UI,
  Engine, Foundation (`Log.h:13-31`).
- printf-style, formatted into a 256-byte stack buffer (`Log.cpp:111-115`). No structured
  key/value fields.
- Per-category console level (`Logger::setLevel/getLevel`); dev defaults are Info for most,
  Debug for Game (`Log.cpp:68-77`); Release = Error only and the other three macros compile to
  `((void)0)` (`Log.h:76-88`).
- In `DEVELOPMENT_BUILD`, every log goes to the DebugServer ring *before* the console filter
  ("ALWAYS send to debug server regardless of console filter ... Developer client has its own
  filtering UI", `Log.cpp:117-124`). So the HTTP stream is the complete feed and the console is a
  filtered view, which is why `CLAUDE.md:240` says "NEVER switch LOG_DEBUG to LOG_INFO 'to see
  logs'. Debug logs are visible in dev tools via the HTTP log server."
- Console line: `[HH:MM:SS][Category][LEVEL] message`, ANSI coloured, ` (file:line)` appended for
  warnings and errors (`Log.cpp:131-169`).
- `LogEntry` for the ring: `{level, category, char message[256], uint64 timestamp ms, const char*
  file, int line}` (`DebugServer.h:119-129`), JSON with proper escaping (`DebugServer.cpp:206-226`).
  The escaping was added after Windows `__FILE__` backslashes produced invalid JSON and "the log
  view silently shows nothing" (`207-210`).
- `Tessellator.bench.cpp:46` shows the cost of unfiltered per-call logging: the bench has to
  silence the Renderer category before timing.

Render/UI relevance: scenes narrate state changes (`"Clipping ENABLED"`, `"Generated and
tessellated %zu stars in %.2F ms"`) and the sandbox's Arena scene reports results only via logs.
The `DebugServer` also logs its own screenshot lifecycle at Info (`DebugServer.cpp:345, 394, 465`),
which pollutes the stream during scripted runs.

---

## 10. Testing strategy for UI and render code

### Framework and gating

Google Test + Google Benchmark, collocated `*.test.cpp` / `*.bench.cpp`, one `<lib>-tests`
executable per library discovered by glob (`docs/technical/unit-testing-strategy.md:128-193`,
`libs/renderer/CMakeLists.txt:83-108`). CI (`.github/workflows/tests.yml`): Linux clang + Windows
MSVC/Ninja, Debug, sccache, `ctest -j4 -E "(benchmarks|world-tests-heavy)"`, draft PRs skipped,
docs/`.claude` paths ignored. Heavy worldgen tests are path-gated in `tests-heavy.yml` with a
nightly run (`docs/technical/build-performance.md:36-61`). Test count referenced: 1272 fast tests
(`build-performance.md:18`), 879 engine tests (`docs/testing/README.md:45`).

### Unit tests without a GPU

The trick is that `Renderer::Primitives::*` are all null-guarded: `if (g_batchRenderer != nullptr)`
around `beginFrame/endFrame/flush/setViewport` and an early return in every `draw*`
(`libs/renderer/primitives/Primitives.cpp:171-191, 273, 297`). When `Primitives::init` was never
called, `Component::render()` runs layout and z-context logic and draws nothing. So:

- Layout tests render a `LayoutContainer` of `MockComponent`s and assert child positions
  (`libs/ui/layout/LayoutContainer.test.cpp:16-24`); the tree serializer and lint tests do the
  same (`UiTreeSerializer.test.cpp:91-110`, `LayoutLint.test.cpp:151-164`).
- Input tests construct `InputEvent` structs and call `handleEvent` directly
  (`ContextMenu.test.cpp:74-100`); a `FocusManager` instance is installed per fixture
  (`Button.test.cpp:9-14`).
- `BatchRenderer.test.cpp` is limited to `UberVertex` size and constants: "Tests requiring
  OpenGL context are limited in scope" (`:17-23`).

There is no `RenderContext` abstraction to mock or record. `UI::RenderContext` is just a
thread-local z-index (`libs/ui/core/RenderContext.h`). Nothing asserts *what* was drawn; tests
assert geometry and state. The 2025-12-02 close-out deferred "Application/Scene/ECS tests require
GLFW/OpenGL mocking infrastructure" and "Shader/VBO tests require GL abstraction layer"
(`2025-12-02-unit-testing-infrastructure-complete.md:23-26`).

### Tests with a GPU

A hidden GLFW window plus `GTEST_SKIP` when headless:

```cpp
glfwWindowHint(GLFW_VISIBLE, GLFW_FALSE);
window = glfwCreateWindow(32, 32, "font-test", nullptr, nullptr);
if (window == nullptr) { glfwTerminate(); GTEST_SKIP() << "Could not create GLFW window (no OpenGL context available)"; }
```

(`libs/ui/font/FontRenderer.test.cpp:27-49`; same in `RenderToTexture.test.cpp:11-30`). The
`GlFixture` in `libs/engine/assets/AssetRenderer.test.cpp:53-105` also locates the shader
directory and calls `Primitives::init(nullptr)`, restoring cwd afterwards. Assertions read pixels
back (`glGetTexImage`, `RenderToTexture.test.cpp:40-49`) or check determinism of a procedural
render. CI runners are headless, so these skip there; they run locally.

### Golden screenshots, scenarios, regression

- Golden-image comparison was designed (`ui-inspection.md:104-119`: `tests/golden/`,
  `testing::captureGolden` / `compareWithGolden(threshold)`) and never built. Screenshots are
  human/agent review only.
- Scenario tests are markdown curl scripts under `docs/testing/` run by a person or an agent, with
  `/api/state` JSON assertions; no runner.
- Performance regression: no automated comparison; baseline JSONs per phase, by hand.
- The nearest thing to a characterization harness: "Characterization tests pinned the old engine's
  defects before the fix flipped them" (`2026-07-03:13`), i.e. lint/layout tests written to
  document current behaviour, then inverted.

---

## 11. Lessons recorded

Direct from the dev logs and debug docs, in rough chronological order.

1. Mutex -> lock-free. "Initial implementation used std::mutex (WRONG - could block game
   thread!) ... Replaced with lock-free ring buffer" and "Zero possibility of frame drops from
   monitoring"; stress test 50 concurrent curls with no drops
   (`2025-10-27-ui-sandbox-implementation-lock-free-performance-mo.md:25-37`).
2. Drop-oldest is a feature. "If ring buffer full (1000 entries): oldest logs silently dropped"
   and "Tested under load: no frame drops, logs may be dropped (by design)"
   (`2025-10-26-observability-web-ui-with-real-time-logging.md:11-15, 90`).
3. Multiple log readers need their own cursors; a shared consuming read starved panels
   (`LockFreeRingBuffer.h:5-10`).
4. JSON escaping of `__FILE__` on Windows blanked the log view silently; the client now reports
   parse errors loudly (`DebugServer.cpp:207-210`, `App.tsx:242-250`).
5. Control endpoint design: single atomic enum "prevents conflicting directives"; all GL/GLFW work
   on the main thread, HTTP thread only sets flags; `SO_REUSEADDR` off for instant duplicate
   detection (`2025-10-29-sandbox-control-endpoints-implementation.md:38-46`).
6. The swapBuffers investigation (`docs/debug-swapbuffers-performance.md`): `glFinish()` as a
   diagnostic "adds 6-15ms even on simple scenes" and must be removed (`19-22`); a leftover debug
   change was itself the main-menu slowness (`24-27`); adding the swap segment to the budget bar
   exposed the real bottleneck (`29-32`); the method that worked was `#if 0` bisection with
   `swapBuffersMs` as the metric (`61-95`, table at `85-92`): interior early-out -4 ms, no blending
   -3 ms, no tile texture -10 ms, no entities -19 ms, "ENTITIES ARE THE MAIN BOTTLENECK". Baking
   1.76 M flora into static meshes dropped `entityRenderMs` to 0.67 ms but GPU stayed ~30 ms
   (`175-204`), i.e. the CPU metric said "fixed" while the frame did not move. Ruled out: zoom LOD
   and simpler grass, "visual quality must be preserved" (`214-219`); later reversed as impostors.
7. Render performance analysis (`2026-06-09-render-performance-analysis.md`): draw calls were
   under-reported because only batcher flushes counted; camera/vsync control endpoints plus a
   sweep script were added specifically so profiling could be scripted (`31-39`); known-broken
   metrics listed rather than fixed (`41-46`).
8. Overhaul results measured by the same sweep (`2026-06-10-render-performance-overhaul.md:11-19`):
   zoom 0.25 from 4.1 FPS/248 ms to 120 FPS/p99 8.4 ms; scroll p99 443 ms -> 11 ms. The Windows
   pacing bug was found because "light-load frames pin at ~63 FPS with vsync off" looked wrong
   against 119 FPS mid-load (`2026-06-09:45-46`). Follow-up: "4x-density scrolling shows p99 ~64ms
   single-frame hitches (avg stays 120 FPS); needs per-frame attribution tooling"
   (`2026-06-10:65-66`). Averages hid hitches; p99 caught them; attribution still missing.
9. Layout lint pays for itself: built before the layout engine, "caught real overlaps in every
   wave" (`2026-07-03:23`).
10. Baseline JSON from 2025-11-30 records that draw-call metrics read 0 at the time; metrics
    plumbing broke silently once and nobody noticed until a baseline was taken.

What was over-built or never built: the observability docs (`developer-server.md`,
`ui-inspection.md`, `developer-client.md`, `diagnostic-drawing.md`) specify six SSE streams, five
REST snapshots, F3 hover inspection with visual-stack and component-hierarchy views, UI event
streaming, profiler flame graphs, golden screenshot API, JSON stream-rate config, SSE heartbeats
and catch-up replay, DebugDraw, and Release compile-out. What shipped: two streams, metrics
snapshot, screenshot, control, input, dev verbs, state readback, tree, lint. The shipped subset
is what the workflow docs reference, and every later feature (camera, vsync, input, tree/lint,
state) was added on demand when an investigation needed it.

What is missing, by the repo's own accounting:

- Per-frame attribution of single-frame hitches (max-over-window per section; plan Phase 4).
- A trustworthy GPU time (scope excludes the final flush; no sanity check).
- Batch-level counters: flush count and reasons, texture binds, clip changes, upload bytes.
- Layout time and hit-test time (never measured).
- `inputLatencyMs` (declared, never set), memory/CPU on Windows.
- Multi-resolution lint (no window-size flag).
- Any automated perf or visual regression gate.
- The `inputHandleMs` overlap bug in `Application.cpp:232-236`.

---

## 12. Translation notes for a browser / Electron TypeScript port

Per mechanism, the closest browser equivalent, and whether it is still worth having.

### Frame loop and CPU sections

- Loop: `requestAnimationFrame` is vsync-locked; the rAF timestamp delta is the frame time. No
  `swapBuffers` to time; GPU backpressure shows up as a late next rAF or in the Chrome DevTools GPU
  track. Frame pacing/capping is unnecessary (rAF paces), though a throttle (skip frames) is easy.
- Sections: `performance.mark/measure` around poll/input/update/render/flush give named spans
  that appear in the DevTools Performance panel and can be read back with `PerformanceObserver`
  or `performance.getEntriesByType('measure')`. Chrome's `long-animation-frame` entries (LoAF)
  report hitches with script attribution for free.
- `MetricsCollector` (window, min/max, histogram, p99, spikes) ports as-is to a `Float32Array`
  ring; `nth_element` becomes a sort of a 60-element copy. Fix the two worldsim bugs on the way:
  do not include pacing in frame time, and keep section timers disjoint.
- Delta-time cap (0.25 s) still matters: tab backgrounding produces multi-second gaps.

### GPU timing

- `EXT_disjoint_timer_query_webgl2`: Chrome desktop only (Electron inherits it), usually absent
  on Firefox/Safari and on some Chrome GPU blocklists. Same single-scope, non-nesting
  `TIME_ELAPSED_EXT` model as worldsim, plus `GPU_DISJOINT_EXT` invalidation and 2+ frame result
  latency via `getQueryParameter(QUERY_RESULT_AVAILABLE)`. Feature-detect, show "n/a", and wrap the
  *whole* frame including the final flush (the exact mistake worldsim made). Sanity-check: if
  gpuMs > 3x frame time, mark the sample invalid.
- `WEBGL_debug_renderer_info` for the GPU name in the snapshot, since driver identity explained
  several worldsim anomalies.

### Metrics transport and the external client

- `LockFreeRingBuffer`, the HTTP thread, SSE, and cpp-httplib have no reason to exist in a
  single-threaded page. Keep the ring buffer as a plain array; expose the snapshot on a global
  (`window.__perf.snapshot()`), an `EventTarget` for subscribers, and optionally
  `BroadcastChannel` if the dashboard is a second tab. In Electron, a second `BrowserWindow` over
  IPC reproduces the "external window" layout if wanted.
- The separate React dashboard app loses most of its rationale: an in-page DOM overlay (stats.js
  style) does not touch the WebGL canvas, so the "zero in-game overhead" argument for an external
  window is moot. Keep the panel *content* (frame budget bar, histogram, biggest-offender line,
  per-scene sessions), drop the build pipeline.
- `SystemResources`: `performance.memory` (Chrome, non-standard) or
  `performance.measureUserAgentSpecificMemory()` (needs cross-origin isolation); in Electron use
  `process.memoryUsage()` / `process.getCPUUsage()` from the main process. CPU% is unavailable in a
  plain browser; skip it.

### Logging

- Categories/levels map to `console.*` with a category prefix; DevTools filters, and Playwright's
  `page.on('console')` captures them for tests. Keep a small in-page ring (`window.__logs.dump()`)
  for the overlay and for bug reports; drop the HTTP stream. Compile-out via a build-time `DEV`
  define and dead-code elimination (esbuild `define`).

### Screenshots

- `canvas.toBlob()`/`toDataURL()` needs `preserveDrawingBuffer: true` or a capture inside the same
  rAF after rendering; `gl.readPixels` into `ImageData` is the direct port. Worldsim's "force
  alpha 255" lesson applies doubly in the browser because a premultiplied-alpha canvas composites
  over the page.
- Playwright `page.screenshot()` / `locator.screenshot()` is the deterministic harness (fixed
  viewport, `deviceScaleFactor`, headless GPU via SwiftShader or headed with a real GPU); Electron
  has `webContents.capturePage()`. Golden comparison with `pixelmatch`/`toHaveScreenshot` is cheap
  here, which worldsim designed but never did.

### Input injection

- Playwright `page.mouse`/`page.keyboard` gives trusted events; in-page
  `canvas.dispatchEvent(new PointerEvent(...))` gives untrusted-but-fine events for your own
  handlers. Preserve the worldsim API shape: logical coordinates in the same space as the
  screenshot, `click` expanding to move+down+up, and the rule that keydown/keyup must land on
  separate frames if the input layer is polled rather than event-driven.

### Scene control and gallery

- `--scene=` becomes a URL query (`?scene=button`) or hash route; `pause/resume/reload` become
  functions on `window.__app`; `exit` is Playwright closing the page; `vsync` cannot be toggled in
  a browser (Electron: launch flags `--disable-frame-rate-limit --disable-gpu-vsync` for
  unthrottled measurement, the equivalent of `perf-capture.ps1`'s first step).
- The X-macro registry becomes an array of `{name, factory}`; the navigation overlay becomes a DOM
  `<select>` outside the canvas, which also keeps it out of screenshots without a flag.

### UI tree, lint, state readback, dev verbs

- `/api/ui/tree` and `/api/ui/lint` become `window.__ui.tree()` / `window.__ui.lint()` returning
  the same JSON, read by `page.evaluate` and asserted with `expect(lint.count).toBe(0)`. The lint is
  a pure function over the tree, so it also runs in vitest against trees built with no GL. Add
  `text`, `enabled`, and `hover` to the node schema, which worldsim omitted.
- `/api/state?what=` and `/api/dev/<verb>` become `window.__dev.state(what)` /
  `window.__dev.<verb>(params)`. A dev-server HTTP route (a Vite middleware forwarding to the page
  over WebSocket) is only worth building if non-browser tooling (curl from an agent) must drive a
  running page; Playwright covers the agent case.
- The synchronous handshake disappears: everything runs on the page's thread.

### Benchmarks and perf capture

- CPU-side benches (z-sort, clip stack, tessellation, layout) port to vitest `bench` (tinybench);
  collocated `*.bench.ts`, excluded from the CI gate like worldsim's.
- `perf-capture.ps1` becomes a Playwright script that loads each scene, sets zoom/camera through
  `window.__dev`, samples `window.__perf.snapshot()` N times, and writes the same
  `{scenario, samples[]}` JSON into `perf-results/`. Add the per-window max that worldsim's Phase 4
  wants.

### Pointless in the browser

HTTP server and SSE, lock-free buffers, HTTP log streaming, port-conflict detection, the separate
dashboard build, memory/CPU sampling (mostly unavailable), Tracy/RenderDoc notes (use DevTools,
Spector.js, `about:gpu`).

### Still valuable

Render-tree JSON with z-order and margin boxes, layout lint as a CI and live gate, batch/draw
stats from your own batcher (the browser inspector cannot see inside a canvas), named CPU section
timers with p99/histogram/spikes, GPU timer where available, URL-addressable scene gallery with
per-component and stress scenes, deterministic screenshot harness, input injection in logical
coordinates, JSON state readback for assertions, per-scene perf sessions.

---

## 13. Recommendation: minimum viable observability for a WebGL UI framework, ranked

1. Frame timer core. rAF frame time with a 0.25 s cap; disjoint named sections
   (input, update, layout, render, flush) via `performance.measure`; 120-sample ring with
   min/max/p99/histogram/spike counts; `sceneName`; snapshot on `window.__perf`; optional DOM
   overlay. Guard the whole thing behind a build-time dev flag.
2. Batcher statistics, reset per frame: draw calls, flushes with reason (texture change, clip
   change, explicit z-sort, buffer full, explicit barrier), vertices, triangles, texture binds,
   clip pushes, bytes uploaded. Worldsim never had reasons or binds and paid for it in the
   swapBuffers hunt.
3. UI tree JSON + layout lint as pure functions (id, type, bounds, margin, zIndex, visible,
   text, enabled, children, viewport). Same code in vitest and on the live page; `count: 0` is
   the merge gate for UI PRs.
4. Scene gallery app: registry array, `?scene=` routing, one scene per component, a z-order
   fixture (LayerScene), a clipping fixture, one stress scene (10k shapes), `pause/reload` hooks.
5. Deterministic screenshot harness in Playwright: fixed viewport and DPR, fonts awaited, seeded
   RNG, a time-freeze hook for animations, opaque alpha, golden compare with tolerance. Cheap in
   the browser; worldsim only ever designed it.
6. Input injection API at logical coordinates with the click-expansion and separate-frame key
   rule, used through `page.evaluate` or Playwright's trusted events.
7. GPU timer via `EXT_disjoint_timer_query_webgl2`, whole-frame scope including the last flush,
   disjoint handling, "n/a" when absent, and a sanity check against frame time.
8. Perf capture script writing `perf-results/*.json` in worldsim's schema plus per-window max
   per section, and a tiny before/after table generator so comparisons stop being by hand.
9. Logging: category + level, in-page ring, `console` mirror, compile-out in production. No
   streaming.
10. Later: CPU microbenches (vitest bench) for z-sort/clip/layout; Electron-only memory/CPU;
    and a real render-backend interface with a recording implementation so unit tests can
    assert what was drawn, which is the one testability gap worldsim's null-renderer trick never
    closed.
