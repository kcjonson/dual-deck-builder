# GPU timer, DevTools tracks, and the perf capture tables (DDB-92)

DDB-55 phase 7, first item: R13.16 to R13.20, R13.38, R13.39, R15.24, R15.29, R15.42, spec 13.8.

## Context

The frame timer (DDB-61) reported `gpu` as nulls, the F5 overlay showed CPU sections only, `scripts/perf-capture.mjs` wrote JSON that someone had to read by hand, and nothing reached the DevTools Performance panel. Chapter 13 asks for GPU time per submission pass with a validity flag, a capture script with a before/after table, an overlay that degrades where the timer is absent, and the frame sections as a DevTools track with feature detection.

A constraint from outside the spec: DDB-64 is rewriting the backend's encoder and shader path at the same time, so the backend footprint had to be small enough to survive that rewrite as a trivial merge.

## Decisions

### A `GpuTimer` the backend brackets, and nothing more

`rendering/GpuTimer.ts` owns the queries, the pool, the pending queue, the polling and the window. `WebGL2Backend` makes four calls on an optional `gpuTimer`: `beginFrame` and a pass around the clear in its `beginFrame`, a pass around `batcher.flush` in `submit` (one sort domain is one pass), and `endFrame` in its `endFrame`. Eight lines; the backend never reads a result.

Options considered: a `DrawBackend` decorator that wraps the WebGL2 backend (zero lines in the backend, but it has to forward every member including the optional `measureText` and `textInk`, whose presence `DrawApi` tests, so it silently breaks the first time the seam grows); timing in `DrawApi` around `backend.submit` (backend-agnostic, but the draw API has no GL and the clear happens inside the backend's `beginFrame`, so it would need a GL hook anyway). The four calls won on survivability.

The GL spelling is behind a `GpuQueryDevice` interface (`WebGL2QueryDevice`), so the timer's logic is tested against a scripted device: latency, nesting, availability order, disjoint, the 3x rule, context loss, pool reuse, the pending cap, and the fence path.

### Reading results

- Frames are polled oldest first, no sooner than two frames after issue (R13.17), and polling stops at the first frame whose last query is not available: queries complete in order, so nothing newer can be ready. That is one availability read per pending frame per frame, one result read per query, and one `GPU_DISJOINT_EXT` read per frame that resolved anything, which is exactly R15.22's permitted list.
- A disjoint read marks every sample resolved in that poll invalid. A sample over three times its own CPU frame interval is invalid. A lost context drops everything in flight and counts it invalid. Invalid samples stay visible as the newest sample (`valid: false`) but are excluded from `p99Ms`, `maxMs` and `sampleCount` (R13.18).
- At most eight frames are in flight; past that a frame is simply not timed. See the unthrottled finding below for why that is normal rather than a fault.
- `spanMs` is always null. A spanning query would nest the per-pass ones, and `queryCounterEXT` timestamps are zero-bit on most Chromium platforms.

### The fence fallback

Where the extension is absent (Firefox, Safari, SwiftShader in CI) the timer puts one `fenceSync` at the end of each frame, `flush`es (R15.23), and polls with `clientWaitSync(sync, 0, 0)` from the next frame on. The time from submission to the poll that saw it signalled is `gpu.latencyMs`, never `gpu.ms` (R13.19). It is an upper bound quantised to the frame interval: about one frame when the GPU keeps up, two or more when it falls behind. The overlay says "no timer query" and labels the number as latency.

### Development builds only

Both pages build the timer inside `if (__DEV_TOOLS__)` through a `require` DefinePlugin folds away, as they already do for the debug hooks. Checked: a production `build:web` bundle contains neither `TIME_ELAPSED_EXT` nor the DevTools track code. The timer defaults to on in development builds; `window.__perf.gpuTimer(false)` turns it off (R13.2's runtime toggle), which also empties its window.

### Snapshot fields

`gpu` keeps R13.11's five normative fields first and adds `source` (`'timerQuery' | 'fence' | null`), `p99Ms`, `maxMs`, `sampleCount` and `invalidCount`, so a capture can tabulate GPU time the same way it tabulates frame time. The snapshot gains a top-level `tracks` naming the DevTools spelling in use, or null. Both are additive, as `liveness` and `device` were.

### DevTools tracks

`debug/devtoolsTracks.ts` picks by Chromium major version: 134 and up get the six-argument `console.timeStamp` on track `Frame` in group `Engine`; 128 to 133 get `performance.measure` with `detail.devtools`, cleared straight after each call because user timing never trims its buffer and the trace event is emitted at the call; anything else (Electron 25 is Chromium 114, Firefox, Safari) gets nothing and `tracks: null`. The version comes from the `Chromium` client-hint brand, else the `Chrome/NNN` token, because the six-argument form cannot be detected by calling it (older versions accept and ignore the extra arguments) or by its `length` (always 0). `FrameTimer` emits each section at `endSection` and each completed frame at the next `beginFrame`, coloured `error` when it overran the budget. The emitter is injected, so `FrameTimer` stays DOM-free.

Not built: R15.29's other half, `PerformanceObserver` subscriptions to `long-animation-frame` and `event`. That is input and hitch attribution, which is what the `input` section being null is waiting on, and it is filed as a follow-up rather than folded in here.

### The overlay

The F5 overlay was already drawn through the renderer (a `Layer` of `Rectangle` and `Text`), off by default, so goldens do not see it. It now takes a snapshot function rather than the `FrameTimer`, and `Game` hands it the same function `window.__perf.snapshot` calls, so the batcher line reads the snapshot instead of reaching into `RendererContext`. New lines: GPU time with p99, max, pass count and dropped samples (or the fence latency, or n/a), the worst section by window max (13.11's "biggest offender"), the device string, and the DevTools track mode.

### Capture script and tables

`scripts/perf-table.ts` is the table logic as pure functions (R13.4), imported by `perf-capture.mjs` with Node's type stripping, which `merge-kerning.mjs` already relies on. Each capture now writes `perf-results/<label>.md` beside the JSON. `--compare <file>` appends R13.39's before/after table; `node scripts/perf-capture.mjs compare a.json b.json` prints it with no browser. With no scenarios named, it captures every screen or gallery scene the page offers. Windowed figures come from the last sample's window, which after the settle covers exactly the sampled frames; the one median is the frame median, taken over the samples' `frame.ms`, which are consecutive distinct frames.

Two capture changes came from measuring rather than reading:

- **A wall-clock settle (`--settleMs`, default 1000) on top of 120 frames.** Unthrottled, 120 frames pass in a tenth of a second on a light screen, and the first second after mounting is not steady state: frames start at about 0.5 ms and settle to about 5 ms once the GPU queue fills and back-pressure reaches the CPU (it shows as time inside `render` and `flush`, where GL calls block). A capture of the first tenth of a second reported a 2000 FPS splash screen that does not exist.
- **`--vsync on` for GPU captures.** With `--disable-frame-rate-limit --disable-gpu-vsync`, Chromium hands timer query results back hundreds of frames late: on ANGLE Metal, none of twelve queries in flight resolved within 300 frames, against the very next frame when paced. An unthrottled capture therefore collects almost no GPU samples, and the few it gets are from the first frames after a reset, which the 3x rule rejects because those frames are the fast transient ones. R13.38 says vsync off, and the CPU capture stays that way; GPU time is a separate, paced capture, and its table says so in its header.

The GPU window also outlives a scenario on an unthrottled page (a sample every few frames), so the script toggles the timer off and on after each navigation to empty it.

## Findings recorded with the baseline

- **ANGLE Metal puts a floor under every timed pass.** An empty query reads 0; a query around one `clear` reads 1.39 ms, and around twenty clears the same 1.39 ms. A pass on this device is a Metal render pass with a 4x MSAA resolve and store of a 1440x882 target, and a timer query boundary appears to end the render pass, so each timed pass pays that cost whatever it draws. `gpu.ms` on this backend is therefore dominated by pass count, and the query itself adds passes an untimed frame would not have. Compare GPU figures only on the same device with the same pass count; the device string is in every snapshot and every table for this reason (R13.20). `antialias: false`, which DDB-64 brings, should lower the floor.
- **Combat misses 60 FPS on this machine even paced**: frame median 26.9 ms, GPU 16.2 ms across seven passes. The CPU sections are small (render max 2.5 ms paced), so it is GPU-bound, and the pass floor above is most of it.

## Baselines

In `perf-results/`, all four on one machine (a Mac with a Radeon Pro 560X, ANGLE Metal, headless Chrome, 1440x882 at ratio 1):

- `phase7-frame-baseline` and `phase7-gallery-baseline`: vsync off (R13.38). The CPU baseline. GPU columns mostly n/a, for the reason above.
- `phase7-frame-gpu` and `phase7-gallery-gpu`: vsync on. The GPU baseline; frame times are paced, the sections and GPU columns are costs.

The phase 0 baseline was captured on a different machine before the `device` field existed, so no comparison table against it is committed; the next phase's capture on this machine compares against these with `--compare`.

## Trade-offs

- The per-pass split is what R13.16 asks for, and on Metal it is also what distorts the measurement. A single query per frame would add one boundary instead of one per domain. R13.16 is a SHOULD; the spec's intent (attribute GPU time to submissions) is kept, and the distortion is documented and filed rather than hidden.
- The pending cap means an unthrottled run times a subset of frames. A bigger cap would not help (results are late, not lost) and would grow the pool.
