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
- A disjoint read marks every sample resolved in that poll invalid. A sample over three times the larger of its own CPU frame interval and the median of the last 31 intervals is invalid; judging it by its own interval alone dropped the samples beside a hitch (rAF fires a short catch-up frame after a long one), which biased p99 and max low, the numbers p99 is there for. A lost context drops everything in flight and counts it invalid. Invalid samples stay visible as the newest sample (`valid: false`) but are excluded from `p99Ms`, `maxMs` and `sampleCount` (R13.18).
- At most eight frames are in flight; past that a frame is simply not timed. See the unthrottled finding below for why that is normal rather than a fault.
- `spanMs` is always null. A spanning query would nest the per-pass ones, and `queryCounterEXT` timestamps are zero-bit on most Chromium platforms.

### The fence fallback

Where the extension is absent (Firefox, Safari, SwiftShader in CI) the timer puts one `fenceSync` at the end of each frame, `flush`es (R15.23), and polls with `clientWaitSync(sync, 0, 0)` from the next frame on. The time from submission to the poll that saw it signalled is `gpu.latencyMs`, never `gpu.ms` (R13.19). It is an upper bound quantised to the frame interval: about one frame when the GPU keeps up, two or more when it falls behind. The overlay says "no timer query" and labels the number as latency.

### Development builds only

Both pages build the timer inside `if (__DEV_TOOLS__)` through a `require` DefinePlugin folds away, as they already do for the debug hooks. Checked: a production `build:web` bundle contains neither `TIME_ELAPSED_EXT` nor the DevTools track code. The timer is built disabled. On ANGLE Metal it costs frame time (an unthrottled main menu went from about 4.9 to 6.9 ms with it on, in review measurements), so leaving it on in every development session would break R13.1 for a number nobody reads. F5 turns it on with the overlay and off again with it, and `window.__perf.gpuTimer(on)` is R13.2's runtime toggle, which a GPU capture uses. Toggling also empties its window.

### Snapshot fields

`gpu` keeps R13.11's five normative fields first and adds `source` (`'timerQuery' | 'fence' | null`), `p99Ms`, `maxMs`, `sampleCount` and `invalidCount`, so a capture can tabulate GPU time the same way it tabulates frame time. The snapshot gains a top-level `tracks` naming the DevTools spelling in use, or null. Both are additive, as `liveness` and `device` were.

### DevTools tracks

`debug/devtoolsTracks.ts` picks by Chromium major version: 134 and up get the six-argument `console.timeStamp` on track `Frame` in group `Engine`; 128 to 133 get `performance.measure` with `detail.devtools`, cleared straight after each call because user timing never trims its buffer and the trace event is emitted at the call; anything else (Electron 25 is Chromium 114, Firefox, Safari) gets nothing and `tracks: null`. The version comes from the `Chromium` client-hint brand, else the `Chrome/NNN` token, because the six-argument form cannot be detected by calling it (older versions accept and ignore the extra arguments) or by its `length` (always 0). `FrameTimer` emits each section at `endSection` and each completed frame at the next `beginFrame`, coloured `error` when it overran the budget. The emitter is injected, so `FrameTimer` stays DOM-free.

R15.29's other half, the `PerformanceObserver` subscriptions, came later (DDB-192); see the next section.

### Long frames and slow input (DDB-192)

`debug/hitchObserver.ts` subscribes to `long-animation-frame` where the runtime has it (Chromium 123 and up), to `longtask` where it does not (Electron 25, until DDB-22), and to `event` with `durationThreshold: 16`, all `buffered`. Detection is `PerformanceObserver.supportedEntryTypes`; a block whose entry type is missing is null, and the whole field is null with no observer or none of the three types (Firefox and Safari get `event` only). Entries land in two 64-entry rings from the observer callback, between frames, so nothing runs in the frame loop.

The snapshot gains a top-level `hitches` with `longFrames` (`source`, `count`, `maxMs`, summed `blockingMs`, and the `worst` with its longest script as `function (invoker) file:char`, which is LoAF's attribution; a long task has none) and `slowEvents` (`thresholdMs`, `count`, `maxMs`, and the `worst` split into input delay, handler time and presentation delay). `FrameTimer` takes the observer as an injected `HitchSource`, as it takes the track emitter, and asks for entries that started inside its own window: the window's records are consecutive intervals ending at the newest frame start, so their sum walks back to the oldest frame's start exactly. A long frame therefore appears in the same snapshot as the frame-time spike it caused and leaves the window when that frame does. Both entry types and the timer read `performance.now()`, and both pages build the timer on that clock; a timer on a stepped test clock would need its own source.

`input` stays null. `event` entries exist only for input slower than the threshold (16 ms is the platform minimum, and durations are rounded to 8 ms), so a section built from them would read zero on every frame whose input was merely fast; R13.5 forbids that zero. Slow input is reported under its own name instead. The F5 overlay has two or three new lines (long frames with the worst script, slow input with its phases), and the capture table a "Long frames" column: the last sample's count and max, so a capture shows whether a hitch landed in the sampled frames.

Development builds only, through the same folded `require` as the track emitter on the game page; the gallery imports it directly.

### The overlay

The F5 overlay was already drawn through the renderer (a `Layer` of `Rectangle` and `Text`), off by default, so goldens do not see it. It now takes a snapshot function rather than the `FrameTimer`, and `Game` hands it the same function `window.__perf.snapshot` calls, so the batcher line reads the snapshot instead of reaching into `RendererContext`. It anchors to the top-right of `CanvasViewport`'s logical width, set at construction and from `Game`'s viewport listener on every committed change (DDB-194); it used to read `window.innerWidth` once, at construction, and stayed where the startup window put it. While shown it is its own domain: it calls `DrawApi.flush()` before drawing, which is R3.21's "UI, flush, debug" order. Submitting last within the UI's domain is not enough, because a domain sorts by layer before submission order (R3.10), so any screen draw above `base` (a raised card, a modal, a targeting line on `overlay`) would paint over an overlay drawn at `base`; the barrier puts every screen draw beneath it whatever its layer. (When this landed the main menu's title also drew over the overlay, through `LegacyPaintOrder` putting a domain's text after its shapes; DDB-67 deleted that, so layers are the remaining reason.) A raised layer was rejected because the ladder is the UI's (R3.9) and even `transition` would tie with a screen transition. The barrier exists only while the overlay is shown, so goldens and GPU pass counts with it hidden are unchanged; shown, it adds one GPU pass, which the GPU line counts. New lines: GPU time with p99, max, pass count and dropped samples (or the fence latency, or n/a), the worst section by window max (13.11's "biggest offender"), the device string, and the DevTools track mode.

### Capture script and tables

`scripts/perf-table.ts` is the table logic as pure functions (R13.4), imported by `perf-capture.mjs` with Node's type stripping, which `merge-kerning.mjs` already relies on. Each capture now writes `perf-results/<label>.md` beside the JSON. The table header states whether the GPU timer was on, and fence latency (R13.19) has its own labelled column so it is never read as GPU time. `--compare <file>` appends R13.39's before/after table; `node scripts/perf-capture.mjs compare a.json b.json` prints it with no browser. With no scenarios named, it captures every screen or gallery scene the page offers. Windowed figures come from the last sample's window, which after the settle covers exactly the sampled frames; the one median is the frame median, taken over the samples' `frame.ms`, which are consecutive distinct frames.

Two capture changes came from measuring rather than reading:

- **A wall-clock settle (`--settleMs`, default 1000) on top of 120 frames.** Unthrottled, 120 frames pass in a tenth of a second on a light screen, and the first second after mounting is not steady state: frames start at about 0.5 ms and settle to about 5 ms once the GPU queue fills and back-pressure reaches the CPU (it shows as time inside `render` and `flush`, where GL calls block). A capture of the first tenth of a second reported a 2000 FPS splash screen that does not exist.
- **`--vsync on` for GPU captures.** With `--disable-frame-rate-limit --disable-gpu-vsync`, Chromium hands timer query results back hundreds of frames late: on ANGLE Metal, none of twelve queries in flight resolved within 300 frames, against the very next frame when paced. An unthrottled capture therefore collects almost no GPU samples, and the few it gets are from the first frames after a reset, which the 3x rule rejects because those frames are the fast transient ones. R13.38 says vsync off, and the CPU capture stays that way; GPU time is a separate, paced capture, and its table says so in its header.

The GPU timer follows the vsync setting unless `--gpuTimer` says otherwise: on for a paced run, off for an unthrottled one, where it collects almost nothing and still costs frame time. The CPU baselines were captured with it off.

The GPU window also outlives a scenario on an unthrottled page (a sample every few frames), so the script toggles the timer off and on after each navigation to empty it.

## Findings recorded with the baseline

- **ANGLE Metal put a floor under every timed pass, and it was MSAA (re-measured in DDB-193).** DDB-92 found that an empty query reads 0 and a query around one `clear` reads the same as around twenty (1.39 ms), and suspected the 4x MSAA resolve paid once per pass because a query boundary splits the Metal render pass. After DDB-64 (`antialias: false`) and DDB-195, a standalone probe on the same machine (headless Chrome, vsync on, a 1440x882 canvas with the page's context attributes, 60 settled frames per variant, medians) settles it:

  | Timed passes in one frame | antialias on | antialias off | off, 128x128 |
  |---|---|---|---|
  | one clear | 2.83 | 1.26 | 0.04 |
  | twenty clears | 3.54 | 1.26 | 0.04 |
  | a 1-pixel scissored clear | 3.56 | 1.26 | 0.05 |
  | a 1-pixel draw, no clear | 2.85 | 1.26 | 0.05 |
  | clear, then three 1-pixel draws | 2.84 / 1.90 / 1.91 / 1.91 | 1.30 / 0.08 / 0.05 / 0.04 | 0.05 / 0.05 / 0.04 / 0.04 |
  | clear, full-screen draw, 1-pixel draw | 2.84 / 2.39 / 1.91 | 1.30 / 1.35 / 0.07 | |
  | untimed clear, then a timed 1-pixel draw | | 0.07 | |

  With multisampling, every timed pass pays at least 1.6 to 1.9 ms however little it draws: that was the per-pass floor, and it was the resolve and store a query boundary forced on each pass. Without it there is no per-pass floor: passes after the first read their own work (0.04 to 0.08 ms for a 1-pixel draw, 1.35 ms for a full-screen fill). What remains is a once-per-frame cost of 1.26 ms at 1440x882 in whichever timed pass first touches the drawing buffer, independent of what that pass draws, 0.04 ms at 128x128, and absent from a pass that follows an untimed clear. It is the drawing buffer's clear and store (with `preserveDrawingBuffer: false` a frame that draws a single pixel still clears the whole buffer), so it is work the frame does untimed too, and `gpu.ms` counts it once, in the clear pass. In the app the clear pass reads 1.27 to 1.32 ms paced on every screen. The DDB-92 figure of 1.39 ms is not reproduced by this probe with antialias on (2.83 ms); the probe that produced it was not kept, so the two setups cannot be compared, and this table is the one to re-run. The GPU tables' header now states the frame cost instead of a per-pass floor.
- **Paced GPU times are read at a low clock.** Every figure above, and the `-gpu` tables, are paced captures, where the GPU idles most of each 16.7 ms and a discrete GPU drops its clock. Unthrottled, where it never idles, the same passes read about 2.7 times shorter: main menu 0.47 / 0.62 ms against 1.31 / 1.66 paced, combat's clear pass 0.44 against 1.30. Neither is wrong; paced is what the game pays at 60 FPS, unthrottled is closer to the work itself. A GPU comparison is only valid between captures with the same pacing, which the table header already states.
- **Since DDB-64 and DDB-195 the unthrottled findings above have changed.** With multisampling gone and the index pool in, the GPU keeps up with an unthrottled page: main menu holds 0.96 ms a frame after 8 s of settle as after 1 s, so the one second settle no longer hides a back-pressure transient (it is kept, since a heavier scene may bring one back), and timer query results come back in time to fill the window unthrottled (20 valid samples per scenario, main menu and combat). The timer's cost is small now too: 0.96 to 0.98 ms on main menu and 3.86 to 4.06 ms on combat, unthrottled, off against on, where DDB-92 measured 4.9 to 6.9 ms. The F5 coupling and the paced default for GPU captures are left as they are; the first because the timer still costs something and nobody reads it with the overlay off, the second because paced is the clock the game runs at.
- **Combat's slowness was not the timer and not the pass floor.** (Fixed by DDB-195; combat now reads 60 FPS paced with a 5.8 ms GPU median over seven passes. What follows is the DDB-92 finding as it stood.) Combat runs at 26 to 28 ms a frame (36 to 38 FPS), paced or not, with the timer on or off. Its passes read 2.0 to 2.9 ms each, above the floor, the timer accounts for 16 of a ~28 ms frame, and `sanity.unaccountedMs` is 24 to 27 ms of it, so the cost sits outside the frame loop's sections: the browser is waiting on the GPU after the rAF callback. Bisected across this epic's merges (DDB-195): it arrived with #70 (DDB-63, the WebGL2 backend), not the batcher or clip PRs, and it scales with the size of the index ring: a 256 KB index ring instead of about 1.1 MB puts combat back at 16.7 ms paced. The inflated per-pass readings on combat are probably mostly that cost, not rendering work. Fixing it is DDB-195's job, not this PR's.
- **Unthrottled captures are noisy run to run.** Same build, same settings, back to back: a light scene can land on either side of the sub-millisecond transient the one second settle is meant to skip (splash has read 196 and 2198 FPS), and driver selection moved from 181 to 323 FPS. A single unthrottled run is good for spotting a large change on a heavy scene; a small delta on a light scene in a `--compare` table is noise until it survives a second capture. The paced GPU captures are stable to a few percent.

## Baselines

In `perf-results/`, all four on one machine (a Mac with a Radeon Pro 560X, ANGLE Metal, headless Chrome, 1440x882 at ratio 1). DDB-92 captured them from the legacy program, before the uber shader; DDB-193 recaptured all four after DDB-64 (#76) and DDB-195 (#79), from the same build as DDB-192 and DDB-194 with DDB-70 (#80, MTSDF text) merged in, and each file's table ends with a comparison against the DDB-92 capture it replaces (that capture is at 987494b):

- `phase7-frame-baseline` and `phase7-gallery-baseline`: vsync off (R13.38), GPU timer off. The CPU baseline; GPU columns are n/a because nothing measured them. Frame medians are now 0.5 to 5 ms where DDB-92 read 3.5 to 26: the GPU no longer falls behind an unthrottled page, so the back-pressure that used to settle every scene near 5 ms is gone (see the findings). A light scene under a millisecond is steady state now, checked against an 8 s settle, not the startup transient DDB-92 had to recapture around.
- `phase7-frame-gpu` and `phase7-gallery-gpu`: vsync on, GPU timer on. The GPU baseline; frame times are paced, the sections and GPU columns are costs at the paced clock, with the frame's 1.3 ms clear pass included. GPU medians fell 35 to 65 percent against DDB-92 (combat 16.2 to 5.8 ms with DDB-195), which is the per-pass MSAA resolve going away.

The committed captures ran with the load average at 3 to 5 (other sessions share this machine). An earlier set taken at 5 to 15 agreed on frame medians to within about 20 percent but read the paced sections up to three times higher, so a section delta against a later capture is not a finding until a second capture agrees. The phase 0 baseline was captured on a different machine before the `device` field existed, so no comparison table against it is committed; the next phase's capture on this machine compares against these with `--compare`.

## Trade-offs

- The per-pass split is what R13.16 asks for. With multisampling on ANGLE Metal it inflated the measurement by a floor per pass, and a single query per frame would have paid it once. With `antialias: false` (R5.29) there is no per-pass floor to avoid (DDB-193), so the per-pass split stays and a Metal-only single query is not built. If multisampling ever returns, that decision reopens: the probe table above is the test.
- The pending cap means an unthrottled run times a subset of frames when results come back late. A bigger cap would not help (results are late, not lost) and would grow the pool.
