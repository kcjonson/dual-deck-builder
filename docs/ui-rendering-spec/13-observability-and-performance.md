# 13. Observability, performance monitoring, and developer tooling

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

This chapter specifies what an implementation must expose so that a person, a CI job, or an AI agent can verify a UI without eyeballing it, and can find a frame-time regression without guessing. Every mechanism here was either built and used in worldsim or was designed there and found missing when a bug needed it. The chapter is backend-agnostic; the last section maps each mechanism onto OpenGL (native) and WebGL2 (browser, Electron).

Rules are numbered R13.n so reviews and conformance checks can cite them. MUST, SHOULD, and MAY carry their RFC 2119 meanings.

## 13.0 Principles

- R13.1 Monitoring MUST never block or lengthen the frame it observes. Writers push into pre-sized buffers, readers copy out; no locks on the render path, no synchronous GPU readback in a normal frame.
- R13.2 Everything in this chapter is development tooling. It MUST be excluded from production builds by a build-time flag so that the production binary carries no overhead and opens no ports. Runtime toggles (`enableMetrics`, GPU timer on/off) are additionally allowed for expensive collectors.
- R13.3 Machine-readable output comes first. A UI tree as JSON, a lint result as JSON, and a metrics snapshot as JSON are the primary interfaces; screenshots are the last resort. Worldsim's rule was "logs over screenshots" because screenshots cost context and prove less.
- R13.4 The same verification code MUST run in unit tests and against the live application. The layout lint, the tree serializer, and the metrics statistics are pure functions over plain data structures so they can be tested without a GPU and reused live.
- R13.5 Every metric MUST have a sanity check or a documented failure mode. Worldsim shipped a GPU timer that read 352 ms on an 8 ms frame for months, and a draw-call counter that read 3 for the whole game, because nothing compared them against anything.
- R13.6 Report distributions, not averages. A rolling window with p99 and spike counts caught hitches that a 120 FPS average hid.

## 13.1 Frame timer

- R13.7 The implementation MUST measure each frame as a set of disjoint named sections. Minimum set: `input`, `update`, `layout`, `render` (command generation), `flush` (GPU submission), and where the platform exposes it `present` (swap or composite wait). Sections MUST NOT overlap; worldsim's `inputHandleMs` accidentally included update and the dashboard showed both as siblings.
- R13.8 Frame time is the interval between consecutive frame starts. Any deliberate pacing sleep or vsync wait MUST be recorded separately (`present` or `pacing`) and MUST NOT be folded into a section that is meant to show application cost.
- R13.9 Delta time handed to `update` MUST be clamped (worldsim uses 0.25 s). Browsers background tabs for seconds; native apps stall on window drags.
- R13.10 A rolling window of the last N frames (N = 120 SHOULD be the default) MUST provide: last, min, max, p99 (or "1% low"), a histogram over budget buckets (< half budget, < budget, < 2x budget, worse), spike counts over budget and over 2x budget, and the per-window maximum of every section so a single-frame hitch is attributable from the snapshot alone. The last item is the one worldsim lacked and listed as its top follow-up.
- R13.11 The snapshot MUST be available as a JSON-serializable object on demand and MUST carry the active scene or screen name so captures can be grouped per scene.

Snapshot shape (field names are normative so tools can be shared between implementations):

```json
{
  "timestamp": 1725700000000,
  "scene": "combat",
  "frame": { "ms": 7.9, "minMs": 6.1, "maxMs": 21.4, "p99Ms": 12.0,
             "histogram": [90, 26, 3, 1], "spikesOverBudget": 4, "spikesOver2xBudget": 1,
             "budgetMs": 8.33, "windowSize": 120 },
  "sections": { "input": { "ms": 0.1, "maxMs": 0.4 }, "update": { "ms": 0.6, "maxMs": 3.2 },
                "layout": { "ms": 0.3, "maxMs": 1.1 }, "render": { "ms": 1.2, "maxMs": 4.0 },
                "flush": { "ms": 0.4, "maxMs": 0.9 }, "present": { "ms": 5.1, "maxMs": 12.0 } },
  "gpu": { "ms": 2.3, "valid": true, "passes": [0.1, 1.9, 0.3], "spanMs": 6.8, "latencyMs": null },
  "batcher": { "...": "see 13.2" },
  "memory": { "usedBytes": null }
}
```

`null` means "not measurable on this platform", never zero. Worldsim's memory and CPU fields read 0 on Windows because the collector was macOS-only; a consumer could not tell "zero" from "unknown".

## 13.2 Batcher statistics

The batcher is the one place the platform's own profiler cannot see into (a browser inspector sees a canvas, not the draw list). It MUST count, per frame, and reset at frame start:

- R13.12 `apiDraws` (draw-API calls, equal to draw groups plus shadow groups), `gpuDraws` (`drawElements`, `drawArrays`, and their instanced variants, foreign passes included), `vertices`, `triangles`, `instances`, `culled` (draws dropped on the CPU by the clip, chapter 4, R4.2a), `occluded` (groups dropped as fully covered, chapter 3, R3.2). The two draw counts are distinct because worldsim's "3 draw calls for the whole game" counted GPU submissions while its UI counted API calls, and one name for both makes two implementations report different things.
- R13.13 `flushes` by reason: `barrier`, `endFrame`, `targetChange`, `bufferFull`. `splits` (GPU draws within a flush beyond the first) by reason: `textureSlotsExhausted`, `blendChange`, `stencilLevel`. `groupsByLayer[]` (the count per layer, which is the number that explains a reorder) and `reorderedGroups` (groups emitted at a position different from their submission position). `clipChange` and `shaderChange` are retained as counters that MUST read zero under this design; a non-zero value fails the batch test of chapter 5.
- R13.14 `textureBinds`, `clipPushes`, `bytesUploaded`, `residentTextureBytes`, `pendingUploads`, `evictions`, `targetSwitches` (chapter 5, R5.35).
- R13.15 Anything that bypasses the batcher (a world renderer issuing its own draws) MUST add its GPU draws, vertices, and triangles to the same counters. Worldsim reported 3 draw calls for the whole game until the entity renderer's raw draws were added.

These fields live under `batcher` in the frame snapshot. The reason breakdown is what turns "we have 400 draw calls" into "we split on every card because the art page is not in the resident set", which is the actionable form.

## 13.3 GPU timing

- R13.16 Where the backend offers asynchronous timer queries, the implementation SHOULD issue one elapsed-time query per GPU submission pass (the clear, each flush, each off-screen composite), never nested, and report their sum as `gpu.ms` and the per-pass values under `gpu.passes`. A single query spanning the frame MAY be reported additionally as `gpu.spanMs` and is documented as including the GPU's idle time between submissions, which on a CPU-bound frame makes it read close to the CPU frame time. Worldsim's single query ended before the final batched UI flush and the number was unusable.
- R13.17 Results MUST be read back asynchronously with at least two frames of latency and MUST never stall the frame waiting for a result. A result that is not ready is skipped, not awaited. The result and disjoint queries are the one permitted synchronous GPU query in the frame (chapter 15, R15.22), development builds only.
- R13.18 A GPU sample MUST be marked invalid when it exceeds three times the measured frame time, when the backend reports a disjoint event (context reset, power state change), or when the query object was reset mid-frame. Invalid samples are excluded from the window statistics.
- R13.19 When timer queries are unavailable `gpu.ms` is `null` and the UI shows "n/a". The fence-based fallback of chapter 15, R15.23 measures the CPU time from submission to completion and is reported as `gpu.latencyMs`, never as `gpu.ms`. Falling back to a blocking `finish()` MUST NOT happen in the normal frame; it MAY exist as an explicit diagnostic mode that is clearly labelled as distorting the measurement (worldsim found `glFinish` adds 6 to 15 ms on trivial scenes).
- R13.20 The snapshot SHOULD include the renderer and GPU identity string (vendor, device) where the platform exposes it, because driver identity explained several worldsim anomalies (Windows timer granularity, DWM pacing).

## 13.4 UI tree snapshot

- R13.21 The implementation MUST be able to serialize the live component tree to JSON after layout has run for the current frame. Roots are supplied by the active scene or screen (only open dialogs and visible overlays are roots; closed ones are not serialized).
- R13.22 Node schema (normative field names):

```json
{ "id": "end_turn_button", "type": "Button",
  "bounds": { "x": 1104, "y": 12, "w": 180, "h": 44 },
  "screenBounds": { "x": 1204, "y": 812, "w": 180, "h": 44 },
  "margin": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
  "zIndex": 0, "layer": "base", "visible": true, "enabled": true, "opacity": 1,
  "clip": { "x": 0, "y": 800, "w": 1440, "h": 82 }, "contentOffset": null, "transform": null,
  "focusable": true,
  "state": { "hovered": false, "pressed": false, "focused": true, "focusVisible": true,
             "selected": false, "open": false, "active": false, "dropActive": false },
  "text": { "content": "End turn", "measured": { "w": 74, "h": 15, "lines": 1 }, "overflow": "none" },
  "value": null,
  "style": { "fill": [0.91, 0.64, 0.24, 1], "text": [0.06, 0.05, 0.04, 1], "border": [0.96, 0.75, 0.40, 1] },
  "inkBounds": { "x": 1201, "y": 809, "w": 186, "h": 50 },
  "children": [] }
```

  `bounds` is the margin box in the parent's content-box space (chapter 8) and `screenBounds` the content box in viewport space after offsets and transforms; `margin` is emitted per side so consumers can derive the content box; `layer`, `opacity`, and `clip` are the effective values; `state` is the chapter 11, R11.11 flag set minus `enabled`, which is reported at the top level; `text` carries the content, the measured extent, and whether it was clipped or ellipsised; `value` is the component's controlled value when it has one; `style` is the resolved fill, text, and border colours after state resolution; `inkBounds` covers ink overflow (chapter 8, R8.8). `id` is `null` when the component was not given one. Fields that do not apply are omitted, never emitted as zero. Worldsim's schema had bounds, margin, `zIndex`, and `visible` only; an agent could verify geometry but not behaviour.
- R13.23 The document root MUST carry the logical viewport: `{ "viewport": { "width": 1440, "height": 882 }, "roots": [ ... ] }`.
- R13.24 Serialization MUST NOT throw on bad input (non-UTF-8 ids are replaced, not fatal), because it runs inside the frame.

## 13.5 Layout lint

The lint checks the invariants that HTML flow layout gives for free and a hand-positioned UI loses. It is a pure function over the tree snapshot.

- R13.25 Rules an implementation MUST provide:
  1. `sibling-overlap`: two visible siblings intersect by more than epsilon on both axes and have the same `zIndex`, beyond what a negative stack gap allows. Touching edges are not overlap. Differing `zIndex` or differing effective layer is a declared stacking intent and exempts the pair.
  2. `child-outside-parent`: a visible child's bounds exceed its parent's bounds by more than epsilon (ink overflow excluded).
  3. `outside-viewport`: a visible node's bounds exceed the viewport.
  4. `zero-or-negative-size`: a visible node has `w <= 0` or `h <= 0`.
  5. `text-overflow`: a text's measured extent exceeds its box without wrap, clip, or ellipsis (the class of the doubled-title and overlapping-banner bugs on the sibling project's board).
  6. `unreachable-interactive`: a focusable or `pointerEvents: auto | unit` component whose `screenBounds` intersect no ancestor clip, or are entirely covered by a sibling above it in the same layer (the "button under the deck preview" class of bug).
  7. `target-size`: an interactive component whose content box is under 24 by 24 logical pixels (44 under a touch profile) without spacing that compensates.
- R13.26 Rules an implementation SHOULD provide: `text-contrast` (resolved text over resolved fill under 4.5:1, or 3:1 at 18 px and above), `missing-id` (an interactive or focusable component with `id: null`), `unsnapped-bounds` (a node whose bounds are not on the device pixel grid when chapter 7 says they must be), `sibling-gap-mismatch` (children of an auto-layout container whose spacing disagrees with the container's gap).
- R13.27 Epsilon is 0.5 logical pixels. Invisible subtrees are skipped entirely. Roots are treated as siblings of each other.
- R13.28 Output: `{ "count": N, "violations": [ { "rule", "path", "bounds", "otherPath", "otherBounds" } ] }` where `path` uses ids when present and `Type[index]` otherwise, joined with `/`.
- R13.29 `count: 0` on every screen MUST be the merge gate for UI changes. Worldsim built the lint before the layout engine ("build the net before the thing it catches") and it caught real overlaps in every polish wave.

## 13.6 Scene gallery (the sandbox application)

- R13.30 The implementation MUST ship a gallery application that mounts one scene at a time from a registry of `{ name, factory }` entries, addressable by name from outside the process (a CLI flag natively, a URL query parameter in a browser), so a scripted run starts on the scene under test with no navigation chrome in the picture.
- R13.31 The gallery MUST contain: one scene per component in the catalog (chapter 12), a z-order fixture with ascending and descending overlapping stacks and an open popup (chapter 3's test scene), a clipping fixture with nested rect and non-rect clips plus an animated content offset (chapter 4), a text fixture covering alignment, wrapping, and pixel snapping (chapter 6), a layout fixture exercising every sizing mode (chapter 10), and at least one stress scene (10k primitives) for the batcher counters.
- R13.32 The gallery MUST expose control hooks: switch scene, pause (skip input and update, keep rendering), resume, reload (re-enter the current scene), and where applicable vsync off for unthrottled measurement.
- R13.33 Every gallery scene MUST provide its UI roots for the tree snapshot and lint, and MAY export scene-specific state as JSON for assertions.

## 13.7 Screenshots and input injection

- R13.34 A screenshot hook MUST capture the framebuffer after the frame's final flush, force alpha to opaque, and return a PNG. Coordinates in the screenshot are logical pixels times the device pixel ratio, and the tree snapshot uses the same logical space, so bounds from the tree can be checked against pixels.
- R13.35 An input injection hook MUST accept events in logical pixels in the same space as the tree snapshot, and MUST dispatch them through the same path real input takes. Grammar: `move,x,y`, `down,x,y[,button]`, `up,x,y[,button]`, `click,x,y[,button]` (expands to move, down, up), `scroll,x,y,delta`, `keydown,<key>`, `keyup,<key>`. Injected input is ignored while paused.
- R13.36 If key state is polled rather than event-driven, a key down and key up landing in the same frame collapse to a release; the injection API MUST document this and tests MUST send them as separate frames.
- R13.37 Deterministic capture controls MUST exist for the screenshot harness: fixed viewport and device pixel ratio, a time-freeze or fixed-timestep hook so animations land on the same frame, a seeded random source, and a way to wait until fonts and assets are loaded. Golden-image comparison with a tolerance SHOULD be automated; worldsim designed it and never built it, and had to eyeball every screenshot.

## 13.8 Performance capture and benchmarks

- R13.38 A capture script MUST drive the gallery through a fixed list of scenarios, sample the snapshot N times per scenario after a settle period, and write `perf-results/<label>.json` as `[ { "scenario", "samples": [snapshot...] } ]`. Vsync or frame capping MUST be off during capture and restored afterwards.
- R13.39 A comparison tool SHOULD render a before/after table (fps, frame p99, per-section max, draw calls, flushes by reason, triangles) from two capture files. Worldsim assembled these tables by hand from two JSON files.
- R13.40 CPU micro-benchmarks for the z-sort, the clip stack, layout, and text measurement SHOULD exist, collocated with the code, and MUST be excluded from the CI test gate.
- R13.41 A new baseline capture SHOULD be committed after each phase of rendering work lands.

## 13.9 Logging

- R13.42 Logging has categories (at least `Renderer`, `UI`, `Input`, `Game`) and levels (`Debug`, `Info`, `Warning`, `Error`). Debug and Info compile out of production builds.
- R13.43 Development builds keep an in-process ring of recent entries (1000 SHOULD be the default) that a tool can dump, independent of the console filter. The console is a filtered view; the ring is the complete feed. Drop-oldest on overflow is the documented behaviour; a log call never blocks.
- R13.44 Render and UI code SHOULD log state transitions that tests want to assert on (scene entered, popup opened, focus moved) at Debug, and MUST NOT log per-frame.

## 13.10 Diagnostic drawing

- R13.45 An implementation MAY provide immediate-mode debug drawing (lines, rects, circles, text with an optional time-to-live). If it does, debug draws MUST live in a sort domain below the UI domain (chapter 3) so they never paint over UI, and MUST be compiled out of production.

## 13.11 Backend mapping

| Mechanism | Native (OpenGL, worldsim today) | Browser / Electron (WebGL2) |
|---|---|---|
| Frame sections | `high_resolution_clock` around loop phases | `performance.now()` around phases (100 µs precision unless the page is cross-origin isolated, then 5 µs); `console.timeStamp(label, start, end, track, group, color)` to draw the same phases as a custom track in DevTools Performance at near-zero cost; a `PerformanceObserver` on `long-animation-frame` (Chromium 123+) and `event` (`durationThreshold` 16) for hitch and input-latency attribution with script locations |
| Frame time | loop timestamps; beware pacing sleeps and the 15.6 ms Windows timer tick (`timeBeginPeriod`) | `requestAnimationFrame` timestamp delta; rAF is vsync-paced so `present` shows up as a late next frame, not a measurable wait |
| GPU time | `GL_TIME_ELAPSED` double-buffered queries | `EXT_disjoint_timer_query_webgl2` (Chrome and Electron; usually absent on Firefox and Safari, sometimes blocklisted), handle `GPU_DISJOINT_EXT` |
| Snapshot transport | embedded HTTP server, lock-free ring buffers, SSE at 10 Hz, external dashboard page | a global (`window.__perf.snapshot()`) plus an `EventTarget`; optional DOM overlay drawn outside the canvas; `BroadcastChannel` or Electron IPC if a second window is wanted. No HTTP server, no lock-free buffers: the page is single-threaded |
| Memory | platform APIs (macOS only in worldsim) | `performance.measureUserAgentSpecificMemory` (needs cross-origin isolation) or Electron `process.memoryUsage()`; otherwise `null` |
| Tree, lint, state | `GET /api/ui/tree`, `/api/ui/lint`, `/api/state?what=` via a queue-on-HTTP-thread, execute-on-main-thread handshake | `window.__ui.tree()`, `window.__ui.lint()`, `window.__dev.state(what)` read through Playwright `page.evaluate`; the lint also runs in the unit test runner on trees built without a GL context |
| Scene control | `--scene=<name>`, `GET /api/control?action=...` where the action is `scene`, `pause`, `resume`, `reload`, `exit`, or `vsync` | `?scene=<name>`, `window.__app.pause()/resume()/reload()`; exit is the test runner closing the page; vsync off is an Electron launch flag (`--disable-frame-rate-limit --disable-gpu-vsync`) |
| Screenshot | `glReadPixels`, row flip, alpha forced opaque, PNG over HTTP | Playwright `page.screenshot` / `toHaveScreenshot` (pixelmatch, per-browser and per-backend baselines, `maxDiffPixelRatio`) or Electron `webContents.capturePage`; in-page `gl.readPixels` needs `preserveDrawingBuffer` or capture inside the same rAF, and SHOULD go through a `PIXEL_PACK_BUFFER` plus a fence so it never stalls |
| Deterministic time | fixed-step hook in the app | Playwright's Clock API (`clock.install`, `pauseAt`, `runFor`) overrides `Date`, timers, `requestAnimationFrame`, and `performance`; combine with the renderer's injectable fixed-step clock |
| Input injection | `GET /api/input?ev=click,x,y` dispatched on the main thread through the UI event path | Playwright `page.mouse` (trusted events) or in-page `dispatchEvent(new PointerEvent(...))` on the canvas |
| Logging | printf-style macros, ring to HTTP stream before console filter | `console.*` with category prefix (Playwright captures via `page.on('console')`), in-page ring `window.__logs.dump()` |
| Benchmarks | Google Benchmark `*.bench.cpp`, excluded from ctest gate | tinybench run by a script (`scripts/bench.mjs`) over `*.bench.ts` files outside the unit runner's match pattern, excluded from the CI gate; fits Jest and vitest alike |
| Dev-only exclusion | `DEVELOPMENT_BUILD` compile definition | a bundler `DefinePlugin` constant (`__DEV_TOOLS__`, declared for the type checker and set in the test setup); dev code wrapped in `if (__DEV_TOOLS__)` so production tree-shakes it; the gallery is a separate bundle entry emitted in development builds only |
| Runtime floor | GL 3.3 | Chromium 134 or newer for the six-argument `console.timeStamp` (`long-animation-frame` needs 123); older runtimes use `performance.measure` with `detail.devtools` (Chromium 128) or feature-detect (`PerformanceObserver.supportedEntryTypes`, `console.timeStamp.length`) and report `null`; verified 2026-09 |
| Perf capture | `scripts/perf-capture.ps1` polling `/api/metrics`, writes `perf-results/*.json` | a Playwright script sampling `window.__perf.snapshot()`, same JSON schema |

Things that exist in worldsim only because it is a native process and have no browser equivalent worth building: the HTTP server, SSE streams, lock-free ring buffers, port-conflict detection, the separate dashboard build pipeline, CPU percentage sampling. Keep the dashboard's content (frame budget bar with a "biggest offender" line, histogram, per-scene sessions), not its plumbing.

## 13.12 Provenance and lessons

From worldsim's development log and debug notes, the events that produced the rules above:

- The metrics buffer was designed as a lock-free single-writer ring from the start, so the game thread never blocks on a reader, and stress-tested with 50 concurrent readers (R13.1).
- The swapBuffers investigation: `glFinish` as a diagnostic distorted the measurement; a leftover debug change was itself the slowness; adding the swap wait as its own budget segment exposed entities as the real bottleneck; a CPU metric said "fixed" while the frame did not move (R13.5, R13.8, R13.19).
- Draw calls read 3 for the whole game because only batcher flushes were counted (R13.15).
- The GPU timer's scope missed the final UI flush and produced nonsense that sat on the dashboard for months (R13.16, R13.18).
- Windows `sleep_for` rounding to the 15.6 ms tick capped frames at ~63 FPS and injected 25 ms spikes; found because light scenes ran slower than heavy ones (R13.8, R13.20).
- 4x density scrolling showed p99 64 ms hitches with a 120 FPS average and no way to attribute them (R13.6, R13.10).
- The layout lint caught real overlaps in every polish wave and became the acceptance gate (R13.29).
- Windows `__FILE__` backslashes produced invalid JSON and a silently empty log view (worldsim commit d8f480c; R13.24).
- Golden screenshots, hover inspection, event streams, and a profiler view were all designed and never built; the shipped subset was whatever an investigation needed next. The rules above are that subset plus the three gaps worldsim itself recorded (per-window section max, flush reasons, trustworthy GPU time).

## 13.13 Conformance checklist

| Item | Level |
|---|---|
| Disjoint frame sections with p99, histogram, spikes, per-window max | required |
| Batcher counters with flush reasons | required |
| Tree snapshot JSON with the normative schema | required |
| Layout lint with the four required rules, `count: 0` gate | required |
| Scene gallery with component, z-order, clip, text, layout, stress scenes | required |
| Screenshot and input injection in logical coordinates | required |
| Build-time exclusion from production | required |
| GPU timer with validity flag | recommended |
| Perf capture script (R13.38) | required |
| Comparison table (R13.39) | recommended |
| Micro-benchmarks | recommended |
| Diagnostic drawing | optional |
