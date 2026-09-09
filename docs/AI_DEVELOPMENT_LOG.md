# AI Development Log

This document contains the chronological log of completed development tasks for Wasteland Wheels. Most recent entries are at the top.

=========================================

**Date correction (2026-08-22):** the repo's first commit is 2025-05-17, but many entries below carry dates in December 2024 or January 2025 — the AI that wrote them used its assumed date instead of the real one. Entries dated 2025-07-03 and 2025-07-02 have been corrected from "2025-01-03"/"2025-01-02" (verified against git history). Remaining Dec 2024 / Jan 2025 dates are wrong by roughly six months; the real work happened May–July 2025. Trust git history over these dates.

## Screenshot goldens minted on CI, screenshots job becomes a gate, phase 0 closes (2026-09-09)

**What changed:**
- Twenty-six Linux baselines committed to `main` as `670350c`, thirteen per project, by the `update-baselines` dispatch job in [run 34310762573](https://github.com/kcjonson/dual-deck-builder/actions/runs/34310762573). That job is the only writer R14.5 permits, and it was unreachable until `visual.yml` reached the default branch, which is why DDB-59 shipped a harness with no pictures in it.
- `continue-on-error` removed from the `visual` job and its name changed from "Screenshots (unbaselined, non-blocking)" to "Screenshots". The suite is now a merge gate.
- The bootstrap section of [visual-golden-harness.md](./AI_TECHNICAL_DECISIONS/visual-golden-harness.md) gained a "what the bootstrap actually did" subsection recording the three things the dispatch settled, and the phase 0 checklist item in the implementation spec is ticked. Phase 0 is eight of eight.

**The mint was verified before it was trusted, which was the whole point of the ordering.** A mint runs `--update-snapshots` once and has no second run to disagree with it, so whatever it captures becomes the definition of correct by default. Three checks, none of which assume the run was fine because it was green.

*The card-dependent frames are populated.* The failure this guards against is a slow `cards.json`, which the two-frame quiescence check provably cannot see (an unstarted fetch serialises identically to a finished one), and which `assetsReady` was added to catch. Decoding all twenty-six committed PNGs: card showcase carries 45.6 percent non-modal pixels over 1,537 distinct colours, combat 64.0 percent over 2,367, driver selection 49.2 percent over 2,175. Reading the card showcase golden by eye shows all eighteen cards with their rules text and rarity lines. A pre-data frame would be a flat field of one colour.

*Linux and win32 draw the same picture.* Each Linux golden was compared against this machine's untracked `win32` baseline for the same scenario, both reduced to a 48x30 grid of mean RGB, which averages out glyph antialiasing but not missing or misplaced content. All twenty-six agreed: mean per-cell difference between 0.07 and 0.68 of 255, worst single cell 18.4, no size mismatches. Cross-runner variance was the one thing a developer machine could not measure and the reason the tolerance is nonzero at all; it is now an observation.

*Electron runs on Linux, and the speculative packages were right.* `npx playwright install --with-deps chromium` installs Chromium's system libraries, not Electron's, so `libgtk-3-0t64`, `libxtst6` and `--no-sandbox` had been added against Ubuntu 24.04's packaging and its unprivileged-user-namespace restriction without ever being tried. The electron project minted all thirteen of its goldens under `xvfb-run` with no additional packages. The `t64` suffix was the guess most likely to be wrong, since the plain `libgtk-3-0` name still resolves on older images.

**What is still unmeasured**: run-to-run variance on the runner itself, because the mint ran once. The next push to `main` is the first comparison against these goldens and the first observation of it. If it wobbles the value to revisit is `maxDiffPixels`, not `threshold`; the mutation table in the decision doc is what both numbers were chosen against, and raising `threshold` reopens the colour cliff that let a button drawn in its own hover colour pass as identical.

**Still deliberately unbaselined**, unchanged from DDB-59 and appearing in every report as named gaps rather than silent absences: `primitive-shapes` (DDB-103) and `battleResultScreen` (no `BattleResultData` on the R13.32 control surface).

=========================================

## Playwright screenshot harness, phase 0 task DDB-59 (2026-09-08)

**What changed:**
- `playwright.config.ts` with two projects, `chromium` and `electron`, a `webServer` that starts the webpack dev server, and `expect.toHaveScreenshot` defaults of `threshold: 0.01`, `maxDiffPixels: 200` and `maxDiffPixelRatio: 0.0002` (R14.5's tolerance, never exact equality).
- `tests/visual/web/screens.spec.ts` and `tests/visual/web/gallery.spec.ts`: one spec per game screen and one per gallery scene, generated from a single scenario list in `tests/visual/support/scenarios.ts`. `tests/visual/electron/shell.spec.ts` runs that same list inside the Electron shell.
- `tests/visual/support/harness.ts` holds R13.37's determinism controls, so both projects get all of them.
- `.github/workflows/visual.yml`: the suite on push, pull request and dispatch, plus the two jobs behind R14.5. All three jobs pin `ubuntu-24.04` rather than `ubuntu-latest`, because the runner image is part of what a golden is a picture of and the image that checks has to be the image that minted; a rolling image bump joins phase 1 ordering, phase 2 text metrics and phase 4 styles on the re-baseline list. The pull-request trigger includes `claude/**`, since this repository's work lives in a stack of such branches and a screenshot job that runs on none of them is decoration; PR #23 makes the same change to three other workflows, so expect a conflict in that block. The screenshots job `needs: baseline-provenance`, so pixels are never reported green beside a red provenance verdict, and the mint job uploads its own report artifact, which matters most because it is the bootstrap.
- `npm run test:visual`, `npm run build:harness:electron`, `npm run typecheck`, `tsconfig.tests.json` (the root tsconfig covers `src/` and `electron/` only, so the specs needed their own program to be typechecked at all).
- Six `setup-node` steps across five workflow files moved from Node 18 to Node 24 (`cleanup-pr.yml` has no setup-node step), and `package.json` and the lockfile root gained `engines: {node: ">=20"}`.

**Baselines are per project and per platform**, at `tests/visual/__screenshots__/{project}/{platform}/`. Only the Linux ones are tracked; `.gitignore` drops every other platform's. That is the mechanism behind R14.5's "local runs compare and never update", and it is a mechanism rather than a rule because a local run on Windows or macOS physically cannot write the file CI committed: the platform is a path segment, so a developer's run writes `.../win32/scene-buttons.png` and compares against that. Local runs stay useful (the first mints this machine's baseline, every run after is a real comparison of the change against the machine's own before) while the committed pictures only ever come from the runner image.

**R14.5 is enforced by three layers of unequal strength, and it is worth being precise about which is which.** The file layout is the strong one and it is not a rule at all: `{platform}` is a directory segment, so a Windows or macOS run writes a path git is not tracking and physically cannot overwrite the committed Linux file. `playwright.config.ts` throws when any argument beginning with `-u` or with `--update-snapshots` appears in `process.argv` without `VISUAL_BASELINE_RUNNER`, which only the workflow's dispatch job sets; the match is on the prefix because the flag carries an optional mode that commander accepts attached, and `-uall`, `-uchanged` and `--update-snapshots=changed` rewrite baselines exactly as the bare forms do; that stops the accident and nothing else, since the person it stops owns the file. The `baseline-provenance` job runs on every pull request, diffs `tests/visual/__screenshots__` against the base branch, and fails when any commit touching a baseline lacks a `[visual-baseline]` marker, which the `update-baselines` job writes together with a link to the run that produced it. That job raises the cost of a hand-minted golden and puts the attempt in the log where a reviewer meets it. It does not make one impossible: the marker is a commit subject and anyone can type a commit subject, and making it unforgeable means resolving the run id against the Actions API, which is worth building once there are baselines to protect.

**The five determinism controls of R13.37, and what each one actually kills.** Fixed viewport, 1440x882, the size the phase 0 frame baseline was captured at, which is the default in `scripts/perf-capture.mjs` rather than anything the baseline JSON records, so a screenshot and a frame time in that table describe the same frame; the chromium project takes it from `use.viewport`, the electron project from `BrowserWindow.setContentSize`. Fixed device pixel ratio: `deviceScaleFactor: 1` for the browser, and `--force-device-scale-factor=1` for Electron, which needs its own answer because a window inherits the desktop's display scaling. On this machine's 1.25 scaling `setContentSize(1440, 882)` landed on 883 logical pixels, because the DIP-to-physical rounding does not divide; the flag makes it exact. Without a pinned ratio `FontAtlas` rasterises glyphs at a different scale, `Renderer.resize` sizes a different drawing buffer, and `Layer` and `Panel` scissor at different rectangles. Time freeze: `window.__app.pause()`, R13.32's own seam, which stops `update` while rendering continues, so the splash screen stops counting towards its automatic navigate and `PlayerHandLayer`'s 300 ms discard timer cannot fire mid-capture, and the canvas still presents the frame the screenshot needs. Seeded random: a mulberry32 over `Math.random` installed by `page.addInitScript` before any application script runs. Wait-for-assets: `settle()` returns once the dev hooks exist, `document.fonts.ready` has resolved, `window.__app.status().assetsReady` is true, `window.__perf.snapshot().liveness.frameCount` has advanced, and two consecutive frames serialise to the same tree. The `assetsReady` field is new here and is the half that actually waits for `cards.json`: `CardLoader` now counts its in-flight requests and the field is false while any is outstanding. The two-frame comparison cannot do that job, and the comment that said it could was wrong. A screen whose fetch has not resolved serialises identically frame after frame, so the pre-data frame satisfies a stability check exactly as well as the loaded one; measured with a four-second delayed route on `cards.json` and the new wait removed, `openScreen` returned after 449 ms with a 1,786-character card-showcase tree where the loaded tree is 89,108, and with the wait in place the same run takes 4,547 ms and returns all 89,108. The case that costs real money is the mint job, which runs `--update-snapshots` once with no second run to disagree with it, so one slow fetch there would commit the pre-data frame as the definition of correct.

**Playwright's Clock API is deliberately not used, which is a departure from R15.36 and from R14.5, and worth stating plainly.** R13.37 is the rule that permits what is done instead: it asks for a time freeze *or* a fixed-step hook, and `window.__app.pause()` is the freeze. R14.5's fixed-step injected render clock is not satisfied by a pause either, and there is no route to one from a running page today regardless, because `src/index.ts` and `src/gallery/index.ts` both construct `new FrameTimer()` with no arguments and DDB-61's clock seam therefore has no caller. Two reasons for taking the freeze. `clock.pauseAt` stops `requestAnimationFrame` along with the timers, which stops the frame loop, and a harness that photographs a page which is no longer drawing has swapped one determinism problem for a worse one. And any clock call at all, `setFixedTime` included, replaces the page's `performance` with a plain stand-in whose `measureUserAgentSpecificMemory` is `() => {}`; because DDB-61 put cross-origin isolation on the dev server, `FrameTimer.requestMemorySample` takes its live branch, calls that stub and throws on `undefined.then`, so `window.__perf.snapshot()` fails on every clocked page. Verified directly: with the clock installed the settle gate died in `requestMemorySample`; without it the same run passes. Nothing the phase 0 goldens capture reads `Date`, so the freeze costs nothing today. Whoever needs a state behind a timer, the discard animation being the first, has to deal with that `performance` collision first.

**The seeded random source changes nothing measurable today, and pretending otherwise would be the exact dishonesty this harness exists to prevent.** Running the combat golden under a different seed, and again with seeding removed entirely, produced byte-identical captures. `Deck.shuffle` has one caller, `Driver.reshuffleDiscardIntoDeck`, which fires only when a deck runs dry, so the opening hand is dealt in deck order and a mounted screen consumes no randomness that reaches a pixel; `Model.__id` is random but is only ever a map key. It is installed anyway because the states phase 0 does not capture are the ones that do vary: playing a card and capturing what follows is where 72 of the combat screen's 355 lint rows differed run to run, and that state becomes goldenable without revisiting this question.

**Two scenarios are listed and deliberately unbaselined**, as `test.fixme` so they appear in the report as named gaps rather than as absences nobody notices. `primitive-shapes` is DDB-103: the scene overruns the renderer's dynamic vertex buffer, logs `bufferSubData: buffer overflow` every frame and draws malformed circles. Committing that picture would make the corrupt drawing the definition of correct and tell whoever fixes DDB-103 that their fix is a visual regression; fixing the buffer sizing is a renderer change and out of phase 0. `battleResultScreen` renders from a `BattleResultData` payload and `window.__app.navigate(name)` carries none, so a capture would get the screen's own missing-data fallback, a state the game never puts a player in, and it cannot pass the clean-console gate either. Constructing a fake `BattleState` in the page to get past that would be a fabricated golden.

**Every spec asserts on the console as well as the pixels.** `Renderer` throws on a null WebGL context, `src/index.ts` swallows that into a `console.error`, and the result reaches a screenshot as a plain black page, which is not distinguishable from a legitimately dark golden. The console is where that failure is visible, so a run with a GL error fails even if the picture somehow matched. There is no allow-list: the one scenario that emits a known error is `test.fixme` and never reaches the assertion, so an allowance would have been dead code whose only effect is to make the next error easy to normalise.

**The navigation path is pinned.** Every screen spec is a fresh page, the splash screen the app boots into, a pause, then exactly one `window.__app.navigate`. Because the pause comes first, `update` never runs on the incoming screen and every game-screen golden is the pre-first-update frame; and because a page screenshot captures the viewport rather than the document, `screen-developerScreen` holds two of that screen's eight sections whole plus 32 pixels of a third, the other five being covered by the gallery scenes and by nothing else. That matters for driver selection specifically: DDB-106 records that it draws 49 GPU calls on its first mount in a page and 33 on every mount after, so the screen is not the same drawing twice, and the golden has to fix which one it is.

**Electron runs the dev build, not the packaged one.** `build:electron` forces `NODE_ENV=production`, which drops `__DEV_TOOLS__` and the gallery entry, so a packaged renderer has neither the scenes nor the hooks the specs drive; an unpackaged Electron loads the dev server, which is the build that has both. `npm run build:harness:electron` therefore builds main and preload only, into `.playwright-build/electron/` rather than `dist/`, so a session building `dist/` for its own reasons is not disturbed. Two small changes to `electron/main.ts` were needed and neither is cosmetic: the development URL now honours `DDB_RENDERER_URL`, because the dev-server port is no longer fixed at 9000 once several worktrees run at once, and DevTools opens only when that variable is absent, because it docks to the right of the web contents and takes its width from them, so every capture would otherwise be of a narrower page than the harness asked for. R15.33's three switches are passed to both launchers unconditionally, as the rule words it, even though Electron 25's Chromium 114 still has the automatic SwiftShader fallback that Chromium removed in 137. The Electron launch also passes `--no-sandbox`, and the workflow installs `libgtk-3-0t64` and `libxtst6`, neither of which `playwright install --with-deps chromium` provides: Electron links GTK 3 and libXtst, and Ubuntu 24.04 restricts unprivileged user namespaces so a sandboxed Electron main process cannot spawn a renderer there. The electron project has never actually run on a Linux runner and counts as unverified there until the bootstrap dispatch proves it.

**The dev-server port is derived from the checkout path**, `9100 + sha256(__dirname)[0] % 100`, so it is stable across restarts in one worktree and different in a sibling, and `reuseExistingServer: false` turns a collision into a loud failure instead of a silent attach to another worktree's build. `--no-hot` removes the HMR websocket and `--no-client-overlay` stops a compile error painting a DOM panel over the canvas and into a golden.

**Node 18 to 24, six setup-node steps across five workflow files at once.** `@playwright/test@1.63.0` declares `engines: {node: ">=20"}`, so 18 was not an option. 20 reached end of life in April 2026, which leaves 22 and 24; 24 is what this machine runs, and the Node 18 versus 24 divergence between CI and local had already caused a failure on the branch below this one. `electron-build.yml` is the one to watch, since electron-builder 24 on Node 24 is the least exercised of them.

**Jest cannot pick the specs up.** They were already unreachable twice over, `roots` is `<rootDir>/src` and `testMatch` requires a `.test.` infix, and `testPathIgnorePatterns` now names `<rootDir>/tests/` explicitly so the day someone widens `roots` does not become the day CI tries to run a browser under Jest.

**No goldens are in this change, and that is a sequencing fact rather than an oversight.** R14.5 puts baselines on the CI runner image; the only writer is the `update_baselines` dispatch; and GitHub offers `workflow_dispatch` only for workflows already on the default branch, so a brand-new `visual.yml` on a feature branch cannot be dispatched from that branch. `git ls-files tests/` therefore returns nothing, the 26 PNGs on disk are this machine's untracked `win32` ones, and the screenshot job ships with `continue-on-error: true` under the name "Screenshots (unbaselined, non-blocking)" so it cannot read as a broken required check with no remedy. The order out of that, written down in the decision doc: `visual.yml` lands on `main` non-blocking, the baselines are minted by dispatching `update_baselines` from `main`, the `playwright-report-baseline` artifact from that one run is read before it is trusted, and only then does `continue-on-error` come off. Phase 0's goldens checkbox stays open until that happens.

**The tolerance was set by mutation, not by feel.** Seven mutations were applied one at a time and run against the committed baselines, with the differing-pixel count read out of the comparison. Under the original `threshold: 0.2` and `maxDiffPixelRatio: 0.001` (a 1,270-pixel budget at this viewport) five of the seven passed: a 3 px shift of one 300x60 button (631 px), a 5% brightening of a button fill (0 px), `Button.normalColor` set to `hoverColor` (0 px), a dropped character in an 18 px label (355 px) and a one-character typo in the 64 px main-menu title (223 px). Under the committed `threshold: 0.01` with `maxDiffPixels: 200` all seven fail, at 874, 84,776, 85,086, 512, 604, 3,213 and 1,973 pixels. The arithmetic behind the depth change: pixelmatch's ceiling is `35215 * threshold^2` and a uniform neutral shift of *d* levels scores `0.5053 * d^2`, so 0.2 could not see a colour move smaller than 53 levels per channel and 0.01 cannot see one smaller than 3, confirmed by shifting the whole main-menu background by +2 (0 pixels) and +3 (1,166,829). `maxDiffPixels` is absolute because the viewport is pinned, and a ratio at a fixed size is an obscured way of writing an absolute number; the ratio is kept at 0.0002 only so a smaller future capture is not served by 200. What the suite still cannot see is recorded as its own section in the decision doc: the two-level colour floor, the roughly six-glyph area floor, the developer-screen fold, the pre-first-update frame, and sibling z-order, which is untestable here because batched text always flushes over geometry and `Panel.render` hardcodes background-then-content. Two mutations came back inert for product reasons and are tickets rather than tolerance problems: `Button` never forwards `options.style.fontSize` to its label `Text`, so five style blocks in `MainMenuScreen` are dead configuration and every button label draws at `Text`'s default 16; and swapping a `Button`'s background and label child order changes nothing on screen.

**Verification:** `npx tsc --noEmit -p tsconfig.json` clean, and `-p tsconfig.tests.json` clean; `npm run lint` 0 errors and the same 9 pre-existing warnings in `RammingAI.test.ts`; `npm test` 384 passing across 21 suites, unchanged; `npm run build:web` compiles, and the production output carries `index.html`, `battle.html` and `evalai.html` but no `gallery.html`. The visual suite at the committed tolerance: 26 passed, 4 skipped, twice in a row, with every baseline file byte-identical afterwards and no spec differing between the two runs. Determinism was measured rather than assumed: the whole suite also passes with `threshold: 0` and `maxDiffPixels: 0`, so consecutive runs on one machine are bit-exact and the committed tolerance is entirely headroom for cross-runner variance, which a developer machine cannot measure and the bootstrap dispatch is the first chance to.

## Frame timer and window.__perf, phase 0 task DDB-61 (2026-09-08)

**What changed:**
- `PerformanceMonitor` is gone, replaced by `src/renderer/engine/rendering/FrameTimer.ts`. The old class timed the interval between frame starts and nothing inside it, so a slow frame could be seen but never attributed. The new one measures R13.7's named sections, keeps R13.10's rolling window of 120 frames (the old history was 60 and only averaged), and answers R13.11's snapshot. It carries the draw counters the old class held, because those are per-frame counters reset at frame start and a second per-frame collector beside this one would be the parallel path the ground rules forbid. Nothing runs beside it: `Renderer`, `TextRenderer`, `DeveloperOverlay`, both entry points and `Game` all moved over.
- `src/renderer/engine/rendering/frameStats.ts` is the window statistics as a pure function over an array of frame records, split out the way `treeSnapshot` and `layoutLint` are split from the hooks that install them (R13.4). It imports nothing, reads no clock and touches no DOM. Every frame figure it reports is a value lifted out of the input rather than computed from it, so the tests assert exact float equality.
- `window.__perf.snapshot()` and `window.__perf.capture({scenario, settleFrames, samples})` install on both pages through `installPerfHooks` in `debug/hooks.ts`, which completes R15.37's four globals: `__ui`, `__app`, `__dev`, `__perf`.
- Delta time is clamped to 0.25 s (R13.9), which it was not. The clamp lives in `beginFrame`, which returns the delta, rather than in each loop, because there are two loops and one of them would eventually forget. Both loops lost their own `lastTime` bookkeeping as a result.
- `scripts/perf-capture.mjs` drives a development build through a list of scenarios over the DevTools protocol and writes R13.38's `[{scenario, samples}]`. `perf-results/phase0-frame-baseline.json` is the phase 0 baseline it produced (R13.41), seven game screens at 1440x882.
- 32 tests in `frameStats.test.ts` and 24 in `FrameTimer.test.ts` (both node, no DOM), 5 in `perfCapture.test.ts`, 3 added to `Game.test.ts` for the installed surface and the scene it reports.
- The dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which is what buys the clock and the memory number the rest of this entry quotes. See the clock paragraph below.

**A frame's record is written when the next frame starts.** Frame time is the interval between consecutive frame starts (R13.8), so a frame is not measurable until its successor begins; `beginFrame` closes the previous record, pairing that interval with the sections measured inside it, and the newest entry in the window is therefore always the previous frame. The old monitor pushed the interval at `endFrame` alongside the current frame's counters, which put a frame's span next to the following frame's work, and invented 16.67 ms for the first frame because it had no interval to report. Nothing is invented now: before the second frame start the window is empty and every frame figure reads null.

**Sections are disjoint by construction, not by convention.** `beginSection` refuses to open a second section while one is running and `endSection` refuses a name that is not the open one; both complain once rather than sixty times a second (R13.44). Worldsim's `inputHandleMs` quietly contained update and the dashboard drew the two as siblings, which is what R13.7 exists to stop. The sanity check R13.5 demands is in the snapshot rather than in a comment: `sanity` reports the last frame's span, the sum of its sections, what fell outside them, and how many frames in the whole window had sections summing past their own span. Across the seven-screen baseline that last count is 0 on every one of the 140 samples. Unaccounted time is not a fault: vsync-paced it is nearly the whole frame (0.2 ms of sections inside a 13 ms interval), and with the frame cap off during the capture it falls to 0.045 to 0.885 ms, which is the rAF dispatch and the browser's own work.

**Three of R13.7's six sections are measurable here and three are null, which is the whole of R13.5's null convention.** `update`, `render` and `flush` are real, bracketed by both frame loops, and together they are all of the application's per-frame work. `flush` is narrower than R13.7's "GPU submission" and has to be read that way: the renderer is immediate mode, so every primitive reaches GL at its draw site inside `render`, and the batched text flush is the only submission the frame defers. It is measured rather than folded into `render` because it is the number the phase 1 batcher has to beat. It is also not all of the text: `Renderer.enableScissor` and `disableScissor` flush whatever text is pending before they touch GL state, and `Panel` and `Layer` call those during the render tree walk, so on a screen with a clipped panel most of the batch has already submitted inside `render` and the `flush` section only times the tail. The baseline shows the shape of it, `developerScreen` reporting a smaller flush maximum than `splashScreen` while drawing nearly five times the text. The frame's final flush at least lands in the section that claims it: `Game.flush` and the gallery loop disable the scissor inside the flush section rather than at the end of render, since disabling it is itself a flush. Attributing the mid-render submissions wants the phase 1 batcher, which removes the reason for them. At today's scene sizes the largest per-window flush maximum in the baseline is `driverSelectionScreen`'s 0.130 ms and the other six screens sit at 0.070 ms or below, so what the baseline records is that text submission is not yet where the time goes. `Game.render` was split into `render` and `flush` to give the loop a boundary to time, since a section opened inside another is refused rather than nested. `input` is null because this engine dispatches straight from DOM listeners on the canvas, so input handling happens between frames rather than as a phase of one; a section there would read 0 forever while the real cost landed invisibly outside the loop, and attributing it wants a `PerformanceObserver` on `event` entries. `layout` is null because there is no layout phase: `Layer.layout()` is called by screens when they choose, inside their own update or render, so there is no disjoint span to bracket until phase 3. `present` is null because rAF is vsync-paced, so the wait shows up as a late next frame rather than as a measurable call. Worldsim's memory and CPU fields read 0 on Windows because the collector was macOS-only and no consumer could tell zero from unknown; none of these read 0.

**`batcher` is null and stays null until phase 1.** R13.12's counters need a batcher and there is not one. What the current renderer can honestly count is reported under `renderer` with names that say exactly what they count: `glDrawCalls` is one increment per `drawElements` or `drawArrays` at its call site, `vertices` is the count each call site reports for itself, `textCharacters` is what was handed to `drawText`. Naming either draw figure `apiDraws` or `gpuDraws` would publish R13.12's field names over numbers that do not mean what those names promise, which is the exact mistake the rule was written for. `TextRenderer.flush` records each colour group at its own `drawElements`, with that group's own character count. It first accumulated the groups and then replayed them with the mean, which left the sum right and every per-call attribution invented, and printed combat's vertex total on the F5 overlay as 5327.999999999999. The check R13.5 asks for is a GL-context count rather than a code reading: a probe patched over `WebGLRenderingContext.prototype` shadows whatever is written into the bound `ELEMENT_ARRAY_BUFFER`, counts the distinct indices each `drawElements` references and the `count` each `drawArrays` submits, and compares per frame against the snapshot. Over 28,862 frames across combat, card showcase, driver selection, developer and the gallery the draw count and the vertex total agree exactly on every frame and the vertex total is an integer on every frame; against the previous code the same probe reports combat as 92 draws and 5328 vertices where the timer says 5327.999999999999. Phase 1 replaces the counters anyway.

**`gpu` is five nulls, not `valid: false`.** Timer queries are phase 7. A `valid: false` would read as a measurement that failed R13.18's plausibility check rather than as no measurement at all. `memory.usedBytes` is null unless the page is cross-origin isolated, in which case each snapshot kicks off `performance.measureUserAgentSpecificMemory` at most once a second and reports the last result that landed; it is asynchronous, so a synchronous snapshot cannot await it. `performance.memory.usedJSHeapSize` is deliberately not used: non-standard, Chromium-only and quantised, and a number that looks measured but is not comparable is worse than null. With the isolation headers the API exists and reports: a game page left running answers 61,271,929 bytes. The baseline's memory column is still null throughout, and that is its documented failure mode rather than a bug, because the measurement resolves on a garbage collection and the whole seven-screen capture finishes before the first one lands. A capture that wants the number has to sit on a scene longer than this one does.

**The baseline, and the conditions that make it mean something.** `node scripts/perf-capture.mjs --label phase0-frame-baseline --url http://localhost:9061/` in headless Chrome, viewport 1440x882 at devicePixelRatio 1 through `Emulation.setDeviceMetricsOverride`, ANGLE on an RTX 3090 over D3D11, vsync and the frame cap off per R13.38 and restored by the browser exiting, 120 frames of settle then 20 samples per screen. Frame p99, then the per-window maxima of the three measured sections, then the draw counters, from the last sample of each scenario:

| Screen | frame p99 | render max | flush max | update max | draws | vertices | text chars |
|---|---|---|---|---|---|---|---|
| splashScreen | 0.39 ms | 0.070 ms | 0.040 ms | 0.010 ms | 4 | 156 | 37 |
| mainMenuScreen | 0.35 ms | 0.070 ms | 0.070 ms | 0.010 ms | 7 | 300 | 69 |
| developerScreen | 0.42 ms | 0.125 ms | 0.005 ms | 0.020 ms | 19 | 776 | 177 |
| cardShowcaseScreen | 1.02 ms | 0.935 ms | 0.005 ms | 0.040 ms | 96 | 15736 | 3856 |
| driverSelectionScreen | 0.50 ms | 0.190 ms | 0.130 ms | 0.015 ms | 33 | 4016 | 977 |
| combatScreen | 0.93 ms | 0.855 ms | 0.045 ms | 0.060 ms | 92 | 5328 | 1267 |
| battleResultScreen | 0.20 ms | 0.035 ms | 0.020 ms | 0.005 ms | 4 | 44 | 8 |

`driverSelectionScreen` has two mount states and this row is the second one. Mounted first in a fresh page it draws 49 calls, 4552 vertices and 1095 characters; mounted again after any other screen it draws 33, 4016 and 977, every time. The capture visits it fifth, so the row is the remount. Nothing in the timer explains the difference, it is the screen building something on first mount that it does not rebuild afterwards, and DDB-106 tracks it. Two earlier capture files disagreed with each other on exactly this row; only this one is kept, and a capture that wants the first-mount numbers has to name the screen first. The file cannot carry any of that itself: R13.38 fixes its shape as an array of `{scenario, samples}` and leaves nowhere to write a note, so the mount-state caveat and the DDB-106 citation live only in this entry, and a reader who opens the JSON alone sees the remount numbers with nothing that says so.

`cardShowcaseScreen`'s 96 draws are 48 submitted twice. The GL probe recorded the frame's draw sequence in two byte-identical halves, which `combatScreen` does not do; the frame loop renders once, so the duplication is inside the screen, and it is the known double render at `CardShowcaseScreen.onRender`, which calls `rootLayer.render()` when `Screen.render` has already rendered it. The largest draw-call number in the baseline is half waste, and the implementation spec schedules the deletion in phase 1.

Unthrottled, so these say how much of a 16.67 ms budget each screen costs, not what a vsync-paced run displays. Repeating the capture moves a figure a little either way; that is the machine, not the app. Nothing here is close to the budget, which is the point of taking a baseline before the rendering work rather than after it.

**The first capture measured the clock rather than the app, so the clock was fixed.** `performance.now()` is coarsened to 100 microseconds in a page that is not cross-origin isolated, and at these scene sizes that is most of the signal: in the capture taken before the headers went on, 306 of 420 section readings were exactly 0, two of the three measured sections reported a per-window maximum of 0.0 across all 20 samples of a screen, 60 of 140 samples reported a frame interval of exactly zero milliseconds, and every distinct value in the file was a multiple of 0.1. The dev server now sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which drops the tick to 5 microseconds. In the capture above, no frame interval is zero, no section reports a per-window maximum of zero, only three of the 75 distinct section values land on a multiple of 0.1 rather than all of them, the smallest non-zero reading is 0.005 ms, and 84 of the 420 section readings are still exactly 0, which is now a real statement that a section finished inside 5 microseconds rather than an artefact. Isolation costs nothing here because nothing this app loads is cross-origin: every script, asset and fetch comes from the same dev server, and all four pages (`/`, `/battle.html`, `/evalai.html`, `/gallery.html`) load isolated with no console error and no blocked request. The headers are on the dev server only, so a deployed build keeps the coarse clock; the numbers that matter are captured against this server.

**The capture has to be headless, and that is not a preference.** Chrome freezes rAF for an occluded tab, so the game loop stops between wakes; measured through a hidden preview pane the timer reported a maximum frame of 88765.6 ms, which is a correct measurement of a frozen loop and a useless baseline. The script therefore launches its own headless browser with `--disable-frame-rate-limit --disable-gpu-vsync`, which is also R13.38's requirement that vsync be off during capture, and it uses Node's own WebSocket over the DevTools protocol so it adds no dependency. The chapter 13 mapping table names Playwright as the browser answer; when a Playwright harness lands it should replace this script rather than run beside it.

**Three of R13.5's sanity checks were missing and are now in the snapshot, added beside R13.11's normative names rather than over them.** A spike is counted past the budget plus a tolerance of 5 percent (floored at the 0.1 ms a non-isolated clock reports) rather than past the budget itself. Frame time is the interval between frame starts and therefore carries the vsync wait (R13.8), so a vsync-paced run at exactly the refresh rate scatters either side of a budget of 1000/60 by design: a capture with the frame cap left on reported 46 to 68 spikes per 120 frames on every screen, with `spikesOver2xBudget` 0 everywhere, on a run with nothing wrong with it, and the F5 overlay printed that to a person as "Spikes: 68 over". The failure mode is in `frameStats.ts`'s header and on the overlay line, because the tolerance narrows the lie rather than removing it: a spike count still cannot separate a frame that overran because the application was slow from one that overran because the compositor made it wait, and reading it beside the section maxima is the only honest way to read it. `frame.sampleCount` says how many frames the window figures were actually taken over; `windowSize` is the configured capacity, and a p99 over four frames published beside a bare "windowSize: 120" reads as a p99 over 120. `liveness` answers whether the loop that filled the window is still running, which nothing else in the snapshot did: `timestamp` is read fresh on every call while the ring can be minutes stale, so a stopped loop kept reporting the healthy window it stopped in. It carries a monotonic `frameCount` incremented in `beginFrame` and `newestSampleAgeMs`, the wall-clock age of the newest sample. Two snapshots a second apart with the same count is then unambiguous. This is not hypothetical: measuring through a throttled preview pane during this task produced a maximum frame of 88765.6 ms in one run and 60136.5 ms in another, and a fully stopped loop would have shown no signal at all.

**The F5 overlay now reads the same snapshot the harness does,** so what a person sees and what a capture records cannot drift apart, and it shows last, p99, max and both spike counts instead of the average it used to lead with (R13.6, and worldsim's 120 FPS average that hid 64 ms hitches). DDB-95's separate finding that the overlay never actually draws is untouched and unaffected.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors and 9 pre-existing warnings, all in `RammingAI.test.ts`; `npm test` 384 passing across 21 suites, up from 320 across 18; `npm run build:web` compiles. A production bundle built to a scratch output directory contains no `__perf`, `installPerfHooks`, `capturePerfSamples`, `settleFrames`, `__ui`, `__dev`, `injectInput`, `layoutLint` or `treeSnapshot`, against a development control build of the same tree that contains all of them. The frame timer itself does ship in production, as the monitor it replaces did: `FrameTimer`, `beginSection` and the snapshot field names appear in the production bundle because `Renderer` and the frame loop use them unconditionally. That is a real gap against R13.2, which asks for the whole chapter to be excluded from production builds, and closing it means gating the draw counters and the developer overlay too, which is a larger change than this task. The `window.__perf` surface, the capture sampler and the whole `debug/` subtree are excluded.

## Input injection behind window.__dev.input(), phase 0 task DDB-60 (2026-09-08)

**What changed:**
- `src/renderer/engine/debug/inputScript.ts` parses R13.35's comma-separated grammar and nothing else: `move,x,y`, `down,x,y[,button]`, `up,x,y[,button]`, `click,x,y[,button]`, `scroll,x,y,delta`, `keydown,<key>`, `keyup,<key>`. `click` is the one verb that expands, into move then down then up, and the expansion happens in the parser so it is provable without a DOM. Pure function, no imports, so its tests run in the suite's default node environment (R13.4).
- `src/renderer/engine/debug/inputInjection.ts` dispatches the parsed steps as real `MouseEvent`s, `WheelEvent`s and `KeyboardEvent`s at the canvas `InputSystem.setup` registered on, and at the focused element for keys. Nothing calls a component method directly: injected input travels the path real input travels, which is the whole of what R13.35 asks for. The split mirrors `treeSnapshot`/`layoutLint` against the hooks that install them.
- `window.__dev.input(...commands)` in `debug/hooks.ts`, variadic so a gesture is one round trip (`__dev.input('move,10,10', 'down,10,10', 'up,10,10')`, or `__dev.input(...script)`), installed by both entry points on the canvas they already hold. `window.__perf` is the last of R15.37's four globals still missing.
- `window.__app` on the game page gained `pause`, `resume` and `status`, which until now existed only in the gallery. R13.35's "injected input is ignored while paused" is a clause about a page that can pause, and the game page could not; DDB-59 also needs a frozen frame before it shoots, and a spec forced onto `gallery.html` cannot photograph a game screen at all.
- 24 parser tests in `inputScript.test.ts` (node), 20 dispatch tests in `inputInjection.test.ts` (jsdom, through handlers registered with the `InputSystem` the ordinary way), 8 in `Game.test.ts` (jsdom, driving pause through `window.__app` with `ScreenManager` and `DeveloperOverlay` mocked out).

**How:**
- Plain `MouseEvent`s, not `PointerEvent`s. A `PointerEvent` reaches a `mousemove` listener only when the browser synthesises the compatibility mouse event, which is a behaviour the harness would then be built on top of; a `MouseEvent` hits the registered listener directly, in every runtime and in jsdom.
- Coordinates are logical pixels, the space `window.__ui.tree()` reports (R7.1, R7.15), and need no conversion: `handleMouseMove` computes `clientX - rect.left` in CSS pixels and `Renderer.resize` builds the ortho projection from `innerWidth`/`innerHeight`, applying `devicePixelRatio` only to the backing store and `gl.viewport`. The injector adds `rect.left`/`rect.top` back for the same reason the handler subtracts them: the canvas sits at the origin today and a hook that assumed so would break the day it does not.
- `handleMouseDown`, `handleMouseUp` and `handleWheel` ignore their event's coordinates entirely and act on the position `handleMouseMove` last stored, so a bare `down,x,y` or `scroll,x,y,delta` presses or scrolls wherever the pointer already was. R13.35 expands only `click`, and injecting a hidden move inside the other verbs would be worse than the hazard: it would fire mouseover and mouseout handlers the harness never asked for, changing hover state underneath an assertion about it. Send `move` first, or use `click`. A test pins the hazard rather than a comment claiming it was fixed.
- Key events are dispatched at the focused element (`document.body` when nothing holds focus) and bubble, rather than being fired at `window`. That is where a real key event starts, and it is the difference between reaching only the InputSystem's window listener and also reaching the game's F5/F12 handler on `document`.
- Nothing throws. A parse failure comes back as `{ok: false, error}` on that one command and the commands either side of it still run, so a harness that mistypes one line gets a message and a partial result rather than a stack trace. The unknown-verb message names all seven verbs, since `window.__dev` is one variadic `input(...)` with no help surface and a console is the only place its author is reading.
- `button` is capped at 0 to 4, not merely non-negative. `MouseEvent.buttons` is a bitmask with five entries in the dispatcher's table, so a button 9 would mask to 0 and dispatch a mousedown whose `buttons` field claims nothing is held during a press. The parser refuses what the dispatcher cannot represent.

**Pause, and what it actually stops.** `InputSystem.paused` (added by DDB-58) gates all six of its handlers behind `if (__DEV_TOOLS__ && this.inputPaused) return;`, so an injected event that travels the real listener path is dropped exactly like a real one and no code in the injector is needed to honour R13.35. The result reports `swallowed` per event, so a harness distinguishes a click the gate ignored from one that missed. On the game page, `Game.update` now returns early while paused and `Game.render` keeps running, which is the same bargain `SceneHost` strikes: a paused page still presents the frame a screenshot needs, and `lastTime` in the loop advances on paused frames so resume gets a normal delta rather than the whole pause. `window.__app.status()` reports `{screen, screens, paused, updates, renders, inputPaused, viewport}`; the two counters are the evidence, since reading a boolean back from the object that set it proves nothing while one counter climbing and the other holding proves the loop is doing what pause claims. The one input path outside the InputSystem, `Game`'s raw `document` keydown shortcut for F5, F12 and Escape, is now gated by the same flag. That changes what a real key does while paused, which is defensible because pause is reachable only through `window.__app` in a development build, and the alternative was a shortcut that navigates out from under a paused capture while `status().paused` says the page is still. Pause does not stop the resize path: `Renderer.handleResize` and `Screen.onResized` still run, so a window resized while paused reflows the mounted screen. The gallery's `SceneHost` defers a resize while paused because re-entering a scene swaps every component instance; the game's screens reflow in place, so there is nothing there to defer.

**R9.3's delta units are a known gap, deliberately left open.** `delta` is logical pixels of vertical scroll intent per R9.3 ("wheel deltas are normalised to logical pixels per axis ... no per-notch constant"), dispatched as `deltaY` with `deltaMode` DOM_DELTA_PIXEL, so `scroll,x,y,100` means a hundred pixels and not one notch. The engine does not honour R9.3 yet: `handleWheel` passes the raw delta through and `Panel.onWheel` multiplies it by 30, so an injected 100 currently scrolls a panel 3000 pixels. Compensating inside the injection hook would make injected wheels behave differently from real ones, which is exactly what R13.35's same-path requirement forbids. The fix belongs in the wheel handler, in a later phase. The grammar carries one delta, so injected scrolls are vertical only.

**R13.36's key-collapse hazard does not arise here.** The rule covers engines that poll key state, where a down and an up landing in the same frame collapse into a release. This engine is event-driven: `handleKeyDown` calls the component's handler synchronously from the DOM listener and no frame boundary sits between the two, so a `keydown` and a `keyup` injected in one call are both delivered, in order, with no need to split them across frames. There is a test for that rather than a comment asserting it. `keyup` is dispatched faithfully but nothing in the engine listens for it today, since the InputSystem registers `keydown` only; the verb is in R13.35's grammar and the event is real, so the day a keyup listener is added, injection already feeds it.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors and 9 pre-existing warnings, all in `RammingAI.test.ts`; `npm test` 320 passing across 18 suites, up from 268 across 15; `npm run build:web` compiles. Every emitted `.js` of a production build made to a scratch output directory contains no `parseInputCommand`, `injectInput`, `installInputHooks`, `treeSnapshot`, `layoutLint`, `__ui`, `__app`, `__dev` or `__DEV_TOOLS__`, and no `debug/` module appears in any source map's `sources`. The emitted `.js.map` files are the one exception worth naming: `main`'s embeds the original `src/index.ts` text, which mentions `installInputHooks` inside its dev-gated branch, so that one string ships in a deployed artifact even though nothing reachable references it. Dropping source maps from the production web build would close it, at the cost of debuggable stack traces. What does survive there is `Game`'s three field initialisers (`isPaused`, `updates`, `renders`) and its `paused` accessor pair, the same residue DDB-58 left on `InputSystem`: DefinePlugin folds every branch and every increment away, so nothing runs, but terser cannot delete a class member it cannot prove is unread.

## Scene gallery behind ?scene=, phase 0 task DDB-58 (2026-09-08)

**What changed:**
- A second application over the same engine at `public/gallery.html` and `src/gallery/index.ts`: one scene mounted at a time, chosen by `?scene=`, no menu and no scene picker in the picture (R13.30). It is a separate webpack entry added only when `NODE_ENV !== 'production'`, so `npm run build:web` and both deploy workflows emit neither the entry nor the page. The bootstrap deliberately mirrors `src/index.ts`: same `Renderer`, same `RendererContext` singleton, same `InputSystem.setup`, same shader, same frame-loop shape, because a gallery that renders through a different path proves things about the gallery rather than about the game.
- Eight scenes, one per developer-screen section: `interactive-controls`, `style-guide`, `input-showcase`, `rectangles`, `buttons`, `text`, `primitive-shapes`, `nested-panels`. The names mirror the `dev_section_*` ids the sections already carry, so a scene name and the node id it selects are derivable from each other, and a rename invalidates a golden.
- The section list lives at `src/renderer/game/screens/developer/sections.ts`, beside the sections it names. `DeveloperScreen` builds its scroll container from it and `src/gallery/registry.ts` wraps each entry as `{name, factory}`, so the screen and the gallery cannot drift apart while the dependency still points from the development-only tool to the game. It pointed the other way first, which put the gallery directory in the production web bundle and in the packaged Electron renderer.
- `src/gallery/SceneHost.ts` owns mount, unmount, reload, resize, pause and resume (R13.32) with no DOM, no canvas and no GL: the viewport arrives as a supplier and the scene list as an argument, so the whole mount discipline is exercised in Jest (R13.4, R14.1).
- `src/gallery/sceneSelection.ts` is the pure `?scene=` parser. `resolveScene` answers `requested`, `default`, `unknown` or `empty`, and the host records which of them produced the mounted scene: `window.__app.status()` reports `{scene, requested, resolution}` alongside the pause counters. A capture asserts `resolution === 'requested'` before it shoots.
- `window.__ui.tree()` and `window.__ui.lint()` install on the gallery page through the same `installDebugHooks` the game app uses, with the host's root layer as the single root (R13.33), and `window.__app` gains `scene`, `reload`, `pause`, `resume` and `status`.
- `InputSystem` gained a `paused` flag, since this engine dispatches input straight from DOM listeners rather than from the frame loop: stopping the loop's update alone would leave clicks and keystrokes landing on components, which is the half of R13.35 that makes "injected input is ignored while paused" true.

**How:**
- An unknown `?scene=` mounts the default rather than nothing, because a blank canvas is the one outcome a screenshot harness cannot tell apart from a GL failure. The substitution is reported twice: a console error naming what was asked for and what was mounted, and `status().resolution === 'unknown'`, which is the half a script can act on. A stale golden name therefore fails loudly instead of producing a plausible screenshot of the wrong scene. `reload` and `resize` re-enter through the same private path and keep the recorded provenance, since how the scene was chosen is not state the scene accumulated.
- Resize re-enters the scene, because a section lays itself out from the width it was constructed with and has no reflow path. Re-entering is destructive though, so the host stores the viewport the current scene was built for and returns early when a resize event reports that same size (the browser fires resize for zoom, for a `devicePixelRatio` change, and on some platforms for a window move). A real resize while paused is deferred rather than applied, and resume applies it: pause exists so a capture can read the tree and inject input against a still scene, and swapping every component instance underneath it would break exactly that promise.
- Scene switching is a teardown path the developer screen never exercises, since it builds its sections once and lives as long as the screen does. Two sections construct `Input`s, and an `Input` registers a mouse-down and a keydown handler with the `InputSystem` singleton from its constructor, so a switch that merely dropped the reference would leave every scene ever mounted hit-tested on every mouse move. `Layer.removeChild` unmounts the subtree it detaches (DDB-62), so the registration maps stay flat across switches; focus is the one pointer that is not per-component bookkeeping, so the host clears it explicitly.
- The host runs `rootLayer.layout()` on mount. `Text` takes its size from `Layer.layout()`, which the frame loop never calls, so without that pass every label in a scene reports `w = h = 0` and DDB-57's zero-or-negative-size rule fires on all of them. `DeveloperScreen` does the same thing in `onResized`.
- A registry entry carries no size and no viewport. A section computes its own height from its content and publishes it with `setSize` on the last line of its constructor, so the height does not exist until the factory has returned; `status().content` reads it off the constructed scene.
- Deleted rather than kept for a caller that does not exist yet: `sceneUrl`, written for a DDB-59 spec that has not been written, and the registry's `findScene` and `sceneNames`, which had no non-test caller. `SceneHost` could not have used the last two anyway: it holds an injected scene list, which is what lets its tests run against synthetic scenes, while those two are bound to the module-level registry.

**Lint counts on the gallery scenes,** through `window.__ui.lint()` at 1440x882: interactive-controls 4, style-guide 1, input-showcase 8, rectangles 1, buttons 9, text 3, primitive-shapes 1, nested-panels 3. Thirty violations across the eight, so R13.29's `count: 0` gate is not met yet. Twenty-eight of the thirty are `sibling-overlap` on a pair that overlaps by construction: a section's background `Rectangle` against the content `Layer` drawn over it, and a `Button`'s `Rectangle` against its own label `Text`. R13.25.1 exempts a pair on differing `zIndex` or effective layer and the phase-0 snapshot emits neither, so nothing is exempted; those counts drop to near zero the moment the snapshot carries `zIndex`, and they are not defects to fix in the scenes. The remaining two are one node: a right-aligned label in the `text` scene reports a width estimated from `fontSize` (`Text.layout` has no measurement service until phase 2) that puts its box about 105 px past the section's right edge, so it fires `child-outside-parent` and `outside-viewport` together. No `zero-or-negative-size` violation anywhere, which is the mount-time `layout()` pass doing its job: that same rule accounts for 44 of the developer screen's violations, where no layout pass runs.

**The developer screen is unchanged by the section-list move.** Re-measured at 1440x882 after the move: 164 nodes, 156 visible, 191 violations (32 sibling-overlap, 44 zero-or-negative-size, 6 child-outside-parent, 109 outside-viewport), identical to the row committed in `perf-results/phase0-layout-lint.json` before this task.

**R15.37 is half met, and stays half met.** The rule names four globals in development builds only. `window.__ui` (DDB-56, DDB-57) and `window.__app` are live; `window.__dev` arrives with DDB-60 and `window.__perf` with DDB-61. The development-builds-only half is satisfied without a second gate, because `build:web` forces `NODE_ENV=production` and the gallery entry is spread in only when it is not, which also means a Playwright run has to point at a development build rather than at a deployed artifact.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors and 9 pre-existing warnings, all in `RammingAI.test.ts`; `npm test` 268 passing across 15 suites, up from 222 across 11; `npm run build:web` compiles. A production bundle built to a scratch output directory contains no `gallerySceneRegistry`, `SceneHost`, `mountFromSearch`, `resolveScene`, `__ui`, `__app` or `__DEV_TOOLS__`, and its module graph lists no `./src/gallery/*` module at all.

## Layout lint behind window.__ui.lint(), phase 0 task DDB-57 (2026-09-08)

**What changed:**
- `src/renderer/engine/debug/layoutLint.ts` implements R13.25's seven rules as a pure function over the R13.23 tree snapshot document: `sibling-overlap`, `child-outside-parent`, `outside-viewport`, `zero-or-negative-size`, `text-overflow`, `unreachable-interactive`, `target-size`. It imports nothing, not even the serializer: the input types are declared locally as a structural superset of `SnapshotDocument`, so the same code runs in Jest over hand-built objects and in the browser over `window.__ui.tree()` (R13.4), and stays assignable as phases 2 and 4 add fields. Epsilon is exactly 0.5 logical pixels (R13.27) on rules 1, 2 and 3.
- `window.__ui.lint(options?)` in `debug/hooks.ts` runs those rules over a freshly taken snapshot. Dev-only, behind the same `__DEV_TOOLS__` branch as `tree()`.
- Output is R13.28's shape, `{count, violations: [{rule, path, bounds, otherPath?, otherBounds?}]}`, plus a `rules[]` array of per-rule diagnostics that R13.28 does not require. A rule that cannot fire for want of a field must not read as a silent pass, so every rule reports what it evaluated, what it exempted, what it skipped and which field was missing, and summarises that as `dormant`.
- Sixty-one unit tests in `layoutLint.test.ts`, all on hand-built snapshot objects with no GL context.
- Committed the phase-0 baseline at `perf-results/phase0-layout-lint.json` (R13.38's shape): eight scenarios at 1440x882, captured through `window.__ui.lint()` after a rendered frame. Every screen except splash, main menu and battle result is in the hundreds of violations, which is expected rather than alarming and is explained below.

**How:**
- All geometry is computed in screen space. Rule 2 compares a child against its parent and rule 3 compares a node against the viewport, and those two live in different coordinate spaces if `bounds` is used, because R13.22 makes `bounds` parent-relative and `screenBounds` absolute. The rect *reported* on a violation is still the node's own `bounds`, which is the field R13.28 names. Rule 2's tests pin this with a parent away from the origin, where a bounds-against-bounds compare reports a 490 px escape for a child that is fully contained.
- Rule 2 measures the child as its margin box, since R13.25.2 names the child's `bounds` and R13.22 defines `bounds` as the margin box. Phase 0 emits no `margin` and the two boxes coincide, so this is inert today and correct the moment phase 1 emits margins.
- Absence never exempts. Where an exemption depends on a field the snapshot may not carry (`zIndex`, `layer`, `wrap`, `overflow`), it applies only when the field is present on *both* sides of the comparison. Reading an absent `zIndex` as 0 would turn "no stacking declared" into "same stacking declared" and silently exempt every pair in phase 0.
- No exemption for scroll containers either. R13.25.2 grants none, and the signal that would carry one, `contentOffset`, sits on the `Panel`, whose only two children are a background and a content layer both sized exactly to it. The rows that actually overflow are a level below that, so a parent-side carve-out would have let off only the two nodes that can never violate while leaving every real overflow reported. The test now uses the shape the serializer actually emits.
- Rule 4 splits its findings into `unmeasured-text` and `zero-box` buckets and reports both. Suppressing Text would hide the only class of node the rule can currently see; reporting it undifferentiated buries the case the rule exists for, a Rectangle or Button that really collapsed. The discriminator is the type *and* the absence of `text.measured`, not the type alone, so a phase-2 Text that genuinely collapses moves to `zero-box` by itself instead of being filtered away as a phase-0 artefact.
- The walk mirrors the serializer's guards: a 256-deep cap and a walk-wide `seen` set. `Layer.addChild` never detaches from a previous parent, so one instance can sit in two children arrays and a diamond expands exponentially; a node in its own children array is an immediate `RangeError`. A repeat is still linted where it reappears, only its subtree is left unexpanded.
- One deliberate deviation from R13.28's letter: when an id repeats among its siblings the path segment is `id[index]` rather than the bare id. Taken literally the rule gives the two nodes the same path and a baseline diff silently collapses their rows; reporting the collision is the lesser departure. The current eight-screen baseline has no collisions, so no path in it changes.
- `layoutLint(document, null)` is accepted as well as `layoutLint(document)`. A default parameter only fires on `undefined`, and DDB-59 will be calling this across a `page.evaluate` boundary where an explicit null is easy to produce.

**Three of the seven rules are dormant against the live tree.** `text-overflow` needs `text.measured`, which no measurement service exists to supply until phase 2. `unreachable-interactive` and `target-size` need `focusable` or `pointerEvents`, which is R8.29's vocabulary and arrives in phase 3. All three are fully implemented and unit-tested on synthetic snapshots, and they report `dormant: true` with the field they wanted rather than a clean pass. Two related latent problems were fixed now rather than left for those phases to inherit: rule 6 treated a `pointerEvents: 'passthrough'` sibling as an occluder, which R8.29 says it cannot be, since passthrough makes the node's own box transparent to hits and this rule never descends into a sibling's children; and rule 4's bucket discriminator, described above. R3.27 gives `opacity: 0` the same property as passthrough, but R13.22 emits no opacity, so that case defers to phase 3 with the rest.

**Why the counts are high, and what the baseline is for.** R13.25.1 exempts a sibling pair on differing `zIndex` or effective layer, and the phase-0 snapshot emits neither, so nothing is exempted and every overlapping sibling fires. That is the intended maximally-catching behaviour. Separately, rule 4 fires on nearly every Text node: `Text.render` reads width and height for alignment and assigns neither, only `Text.layout()` writes them, and the frame loop never calls it, so an unsized Text reports 0x0. Across the eight captured scenarios that is 596 of 704 visible Text nodes, all of them in the `unmeasured-text` bucket, and no Rectangle, Button, Panel or Layer ever reports zero. The counts and the command that re-derives them are in `.claude/notes/ddb55-phase0-recon.md`; the code comments carry the mechanism only, since a comment citing a number nobody can re-derive rots the first time the capture is retaken. R13.29's `count: 0` merge gate therefore applies to the gallery first and to each screen as it migrates, per the implementation spec's ground rules, and nothing here is wired into CI.

**Known bugs the lint already catches.** `child-outside-parent` reports 24 violations on card showcase, driver selection and combat start, 20 on combat after a card is played, and 6 on the developer screen: content overflowing its panel, not a snapshot artefact. Splash, main menu and battle result report no `child-outside-parent` at all, and their totals (3, 11 and 6) are almost entirely the full-screen background rectangle overlapping the content it sits behind, which is exactly the pair R13.25.1 will exempt once the snapshot carries `zIndex`.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors and 9 pre-existing warnings, all in `RammingAI.test.ts`; `npm test` 222 passing across 11 suites, 61 of them this file's; `npm run build:web` compiles. A production bundle contains no `layoutLint` and no `__ui`, confirming the dev-only exclusion still holds.

## UI tree snapshot behind window.__ui.tree(), phase 0 task DDB-56 (2026-09-07)

**What changed:**
- Added the shared `__DEV_TOOLS__` plumbing the rest of phase 0 sits on: a `webpack.DefinePlugin` constant in `webpack/webpack.common.js` (so the packaged Electron renderer gets it too, not just the web build), `declare const __DEV_TOOLS__: boolean` in `src/types.d.ts`, and `global.__DEV_TOOLS__ = true` in `jest.setup.js`.
- `LayerOptions` gained `id?: string`, with a private backing field and an ES6 `get id(): string | null` on `Layer`. Because `ComponentOptions = LayerOptions` and `PanelOptions extends LayerOptions`, that one edit covers every primitive, Button, Input, and Panel. `Screen` passes its own id to its root layer. Named about sixty elements across the seven screens; `ui/Card` and `ui/Vehicle` derive their internals from the composite's own id (`<card>_title`, `<card>_driver_badge`, `<vehicle>_structure_fill`), and the card showcase, which renders the same cards twice, prefixes the second pass `showcase_{rarity}_card_{type}` so ids stay unique within the root. Ids never come from `Model.id`, which is the constructor name plus `Math.random()` and so re-rolls every load: a hand card is `hand_card_{slot}_{type}`, a showcase card keys off the card type (`CardLoader` maps one card per type), and a battlefield vehicle is `{side}_vehicle_{lane}_{ordinal within lane}`.
- `src/renderer/engine/debug/treeSnapshot.ts` serializes the live tree to the R13.23 document as a pure function over `(roots, viewport)`: no GL, no DOM, no `window`. It emits only what this engine can honestly back (id, type, bounds, screenBounds, visible, children, plus clip, contentOffset, enabled, state.hovered/focused, and value where they apply) and omits everything else rather than filling in a default; `zIndex: 0` in particular would change what DDB-57's sibling-overlap rule exempts.
- `src/renderer/engine/debug/hooks.ts` installs `window.__ui.tree()`, with the roots being the mounted screen plus the developer overlay while it is actually drawn. Reached through small accessors (`Screen.root`, `ScreenManager.activeScreen`, `DeveloperOverlay.shown`) rather than by exporting internals.
- Thirty-three unit tests in `treeSnapshot.test.ts`, run in Jest with no GL context on hand-built Layer trees.

**How:**
- Two geometry traps, both from the DDB-55 recon and both confirmed in the code. `Panel.getChildren()` forwards to the content layer, so a walk through it never sees the background rectangle or the scrollable content layer and reports content children one level too shallow; the walk uses a new `Layer.debugChildren` getter onto the real child array instead. And `localToGlobal` does not subtract panel scroll while `Panel.render` hands its content layer `offsetX: screenX - scrollOffsetX`, so `screenBounds` re-accumulates along the render path and special-cases the panel subtraction. Both are pinned by tests.
- Serialization never throws (R13.24): an ancestor set breaks child-graph cycles, non-finite coordinates report as 0 (which lands them on the lint's zero-or-negative-size rule rather than vanishing), a non-string id reports as null, unpaired surrogates are replaced, and a node whose accessors throw degrades to one `Unserializable` entry instead of failing the document. The degraded entry keeps the id, bounds and children computed before the throw and reports `visible: true`, because R13.27 lets the lint skip an invisible subtree whole and the broken node is the one worth seeing. The cycle guard is joined by a walk-wide `seen` set: `Layer.addChild` never detaches from a previous parent, so one instance can sit in two children arrays, and a per-path guard alone let a depth-18 diamond expand to 524,287 nodes. A repeat is emitted once more as a childless stub.
- Dev code is kept out of production by requiring `debug/hooks` inside the `if (__DEV_TOOLS__)` branch rather than importing it. With `tsconfig` on `module: commonjs`, webpack cannot tree-shake an unused ES import, but it does drop a `require` in a branch DefinePlugin folded to false. Verified: a production bundle contains no `__ui`, `treeSnapshot`, `installDebugHooks`, `screenBounds`, or `contentOffset`; a development bundle contains all of them.

**Finding for DDB-57:** `Text` still reports `w = h = 0` after any number of rendered frames. `Text.render()` never writes width or height; only `Text.layout()` does, and the frame loop never calls it (the only two callers are `CardShowcaseScreen.onResized` and `DeveloperScreen.onResized`). The snapshot deliberately does not run layout, because a read hook must not mutate the tree it observes. So `zero-or-negative-size` will fire on nearly every unsized text node on the live screens until a layout phase exists in phase 3.

## Dead engine code purge and unmount fixes, phase 0 task DDB-62 (2026-09-07)

**What changed:**
- Deleted nine modules nothing imported: `engine/components/Arrow.ts`, `engine/rendering/ScissorBatcher.ts`, `engine/rendering/Texture.ts`, `game/core/Assets.ts`, `game/core/State.ts`, `game/ai/MCTSNode.ts`, `game/ai/index.ts`, `utils/helpers.ts`, `utils/math.ts`. Eight had zero importers; `helpers.ts` had exactly one, `Assets.ts`, which went with it.
- Swept the dead members those deletions and earlier refactors left behind, about 1,960 lines across 32 files: `Renderer.drawLine`, `destroy`, `hasTextToFlush` and the scissor-state notification (all dead once ScissorBatcher went); `ScreenManager.resize` and `destroy`, and `Screen.resize`, which lost its only caller with them; the whole keyup half of `InputSystem` (`keyUpComponents`, `globalKeyUpHandlers`, `handleKeyUp`, both window listeners, `registerKeyUp`, `registerGlobalKeyUp`, `unregisterGlobalKeyUp`) plus `getMousePosition`; `Component`'s semantic event system (`select`, `deselect`, `activate`, `target`, `untarget`, `cancel` and the six protected hooks behind them), which had no caller anywhere, `DriverPanel.activate` being its own method on a `Layer` subclass rather than an override; `Card`'s `activateHandler` and `targetHandler` with their setters; `Input`'s focus and blur callbacks with their setters and guards, and `setPlaceholder`, `setMaxLength`, `setTextColor`, `setPlaceholderColor`; `ResourceBarLayer.clearElements`; `CombatModel.determineTargetableVehicles`; `AIController.findVehicleByDriver`; and unread getters and setters on Circle, Polygon, Triangle, Text, Panel, Button, Shader, FontAtlas, TextRenderer, and DeveloperOverlay.
- Fixed four unmount leaks found while doing the sweep. `Layer.removeChild` now calls `child.unmount()` before detaching, so a removed subtree stops being hit-tested instead of sitting in the InputSystem handler maps forever. `Card` gained an `unmount()` override that unregisters itself, since it extends Layer rather than Component and so inherits no unregistering unmount. `CombatLogLayer.unmount` now calls `super.unmount()`, so its children unmount too. `CombatScreen.onUnmount` unregisters `rootLayer`, a plain Layer that does not unregister itself.

**How:**
- Every deletion was justified by an importer count or a ripgrep caller count from the DDB-55 recon notes, and re-verified with ripgrep after the cut; nothing was removed on a hunch about naming.
- `removeChild` is the only behavioural change. It is safe because no call site removes a node and re-adds the same instance: every clear-and-rebuild path constructs fresh objects. Two sites now double-unmount (PlayerHandLayer, CardShowcaseScreen), which is harmless because `Layer.unmount` is pure recursion and `InputSystem.unregisterComponent` is a map delete.
- Deliberately kept: `RenderContext.ts` (13 importers) and `RendererContext.ts` (9, retired in phase 3), and every `Style` field, since `opacity` and `zIndex` are re-added in phase 4.

## UI rendering specification and implementation plan (2026-09-07)

**What changed:**
- Wrote a backend-agnostic layered UI rendering specification at `docs/ui-rendering-spec/` (README, glossary, architecture, draw API, render order, clipping, shading, text, coordinates, object model, input and focus, layout, style and theme, component catalog, observability, testing and conformance, WebGL2 and OpenGL backend notes, review log), abstracted from worldsim's C++/OpenGL UI system after reading its renderer, component library, sandbox tooling, design docs, and development log, plus an audit of this engine and a sourced survey of published designs (GPUI, PixiJS, Skia, Flutter, WebRender, ImGui, egui, Unity, Godot, CSS stacking contexts) and WebGL2 specifics.
- Ran five independent challenge reviews against the draft (graphics engineer with web verification, UI architect, worldsim maintainer, implementer for this codebase, consistency editor). The UI-architect and implementer reviews produced 74 findings, five of them blockers (a layout-freeze defect inherited from worldsim, a coordinate ambiguity in layer promotion, deferred callbacks, an undefined hit-target model, a one-sentence drag protocol), resolved into draft 2. The graphics review produced 37 findings including a blocker in the border-over-fill compositing formula (a one-pixel halo on every bordered control), plus corrections to the clip test, anti-aliasing ramp, shadow padding, buffer ring sizing, resident textures, the text atlas range, hairline snapping, GPU timing, and several WebGL version claims; the consistency review produced 24, including a stale conformance table and glossary contradictions; both were resolved into draft 3. Every resolution is recorded in chapter 17. The worldsim-maintainer provenance review produced 65 findings (about seventy of ninety checked claims verified with file-level evidence; five wrong in a way that would mislead a port, among them the tab bar hover claim, the ellipsis row, and which widgets forward z; one structural omission, worldsim's absolute coordinates) and was resolved into draft 4, which also gained a migration order for worldsim (chapter 16.4) and a not-applicable scoring rule (R14.9) so the drag service, transform, and animator do not fail a project with no use for them.
- Preserved the research and review reports verbatim under `docs/ui-rendering-spec/research/` and `review/` so the spec's provenance survives the session.
- Wrote the implementation specification for this repo at `docs/specs/ui-rendering-engine-implementation.md` (seven phases, toolchain decisions, board structure, success criteria, risks) and the decision record `docs/AI_TECHNICAL_DECISIONS/ui-rendering-spec-adoption.md`. No board items were created; that is the next step when implementation starts.

**How:**
- Research fan-out to five parallel agents writing structured reports with file-and-line citations; the spec was written from those plus direct reading of worldsim's ordering commits (global draw-group z-sort, the reverted overlay queue, the world/UI flush barrier) and design docs.
- Rules are numbered per chapter so reviews, tests, and PRs can cite them; each chapter carries its incidents, rationale, required tests, and a conformance checklist; chapter 14 scores both worldsim and this engine against every required item.

**Notable findings about this codebase (from the audit, evidence in the research folder):** text always paints above shapes drawn in the same clip scope because the text batch flushes on scissor changes, which is the mechanism behind DDB-28 and DDB-31; `borderRadius`, `opacity`, `fontFamily`, `fontWeight`, and `zIndex` are parsed and ignored; `Button` and `Input` ignore their style objects entirely; hit testing ignores occlusion, clipping, and visibility; the combat screen has two different layouts (construction and resize); the F5 overlay measures only the frame interval.

## Migrated task tracking to Specboard (2026-08-22)

**What changed:**
- All planning moved from AI_DEVELOPMENT_HUB.md to Specboard: https://specboard.io/projects/6b4e4cdd-15bc-4001-8280-706838168f2e
- Created six epics with ~40 bugs/tasks: Security and correctness fixes (P0 defects as bugs), Dead code purge, Toolchain modernization, Code convention cleanup, Combat UI and gameplay debt (live-verified rendering bugs), and Game feature roadmap (the unbuilt Game Flow spec phases 4-6 from the old hub, spec docs linked).
- Hub's to-do and roadmap sections replaced with a pointer to the board; CLAUDE.md todo-management instruction updated to use the Specboard MCP tools.
- Old planning docs audited for open items: PERFORMANCE_OPTIMIZATION_PLAN.md is fully implemented; VEHICLE_POSITIONING_AND_WAVE_SYSTEM.md's remaining phase (waves + movement cards) became a roadmap task.

## Project Survey and Documentation Rebuild (2026-08-22)

**What changed:**
- Full re-survey of the dropped project: tests (128/128 pass), lint (0 errors), web build (compiles), live click-through of menu → driver selection → combat with working enemy AI, plus a code audit for stubs, dead code, and doc drift.
- Rewrote AI_DEVELOPMENT_HUB.md around a verified current-state (working / built-but-broken / never-built) and a prioritized modernization to-do list.
- Deleted MISSING_COMBAT_FEATURES.md: nearly every "missing" feature (range, hit calc, flanking, ram formulas, occupant damage, targeting restrictions) was implemented in the June–July 2025 combat work. The two genuinely missing pieces (`Battle.endCombat()` never called in production, no post-combat effects pass) moved to the hub's P0 list.
- Corrected fabricated doc dates (see note above) and the stale screen-lifecycle instructions in CLAUDE.md (activate/deactivate → mount/unmount, registration in ScreenManager not Game.ts).

**Key findings:** battle-end double navigation, dead per-property Model listeners in ui/Vehicle.ts, Electron build broken since early on, production deploys ship dev-mode bundles (no NODE_ENV=production), CI shell injection via `github.head_ref` in cleanup-pr.yml, stale `public/cards.json` fork, ~10 dead modules, CI pinned to EOL Node 18. Details and priorities in the hub.

## UI Component Lifecycle Standardization (2025-07-03)

### Fixed Ghost Click Bug and Standardized Component Lifecycle

**What Changed:**
- Fixed bug where main menu buttons remained clickable after navigating to combat screen
- Standardized all component lifecycle methods to use mount/unmount terminology
- Screen base class now properly unmounts all child components when unmounting

**Technical Details:**
- **Screen.unmount()**: Now calls `rootLayer.unmount()` to recursively clean up all children
- **Component Renames**: 
  - `cleanup()` → `unmount()` in Component, Layer, Panel, Input classes
  - `destroy()` → `unmount()` in Vehicle UI component
  - `dispose()` → `unmount()` in FontAtlas class
- **Button Fix**: Buttons now properly unregister from InputSystem via unmount chain

**Benefits:**
- No more ghost clicks from previous screens
- Consistent lifecycle terminology across entire codebase
- Proper memory cleanup and event handler removal
- Clear component lifecycle: mount (if applicable) → unmount

## Screen Manager Architecture Implementation (2025-07-03)

### Implemented ScreenManager with Lazy Loading

**What Changed:**
- Created ScreenManager as a static class for global screen navigation
- Removed all screen creation from Game.createScreens() 
- Screens now created on-demand when navigated to
- Removed callback-based navigation in favor of direct ScreenManager.navigate() calls
- Fixed CardShowcaseScreen creating cards in constructor

**Technical Details:**
- **ScreenManager**: Static class with `navigate()`, `update()`, `render()` methods
- **Screen Creation**: Map of screen names to constructors, screens created fresh on each navigation
- **Navigation Pattern**: Screens call `ScreenManager.navigate('screenName', data)` directly
- **Memory Management**: Screens fully destroyed when navigating away (no caching)
- **Data Passing**: Combat screen receives drivers via navigation data in `onMount()`

**Benefits:**
- Fixes input handler bug where inactive screens intercepted clicks
- Reduces memory usage - only active screen exists
- Cleaner architecture with separation of concerns
- Simpler navigation without callback spaghetti

### Fixed Combat Screen Initialization Issues

**What Changed:**
- Fixed async initialization timing issues in combat screen
- Added proper promise handling in Screen base class for async onMount
- Combat screen now properly updates UI after async initialization completes
- Added development fallback for direct navigation to combat

**Technical Details:**
- Screen base class now properly handles async onMount methods
- Added explicit `updateUIFromBattle()` call after combat initialization
- Development mode: If no drivers provided, loads default drivers automatically
- Fixed timing issue where UI was rendering before battle data was ready

## Layer Rendering and Overflow Fixes (2025-07-03)

### Fixed Layer Stacking Issues in Combat Screen

**What Changed:**
- Fixed card text showing through bottom resource bar
- Added overflow clipping to all combat layers
- Improved card positioning with vertical padding

**Technical Details:**
- Added `setOverflow('hidden')` to PlayerHandLayer, ResourceBarLayer, and BattlefieldLayer base class
- Modified card layout logic to ensure cards stay within layer bounds with 10px vertical padding
- Prevents UI elements from bleeding across layer boundaries

## AI Integration and Combat Enhancements (2025-07-03)

### Integrated AI System into Main Game

**What Changed:**
- Enabled AI controller in CombatScreen - enemies now use AggressiveFlankerAI
- Removed placeholder enemy turn logic
- Enhanced combat logging to match battle simulator's comprehensive output
- Fixed card click routing bug causing navigation to wrong screens

**Technical Details:**
- **AI Integration**: 
  - Added `battle.aiController.setEnemyAI('aggressive')` in CombatScreen.initializeCombat()
  - Battle system already handles AI turns automatically via executeEnemyAction()
  - Same AI strategies from battle simulator now work in main game
- **Enhanced Logging**:
  - Added 6 new CombatLogType entries: MISS, ARMOR, RESOURCE, POSITION, BATTLE_START, BATTLE_END
  - CombatLog.addBattleMessage() method maps Battle message types to log types
  - Added turn numbers to log entries with `[Turn X]` prefix
  - Enhanced color coding for all message types
- **Card Click Bug Fix**:
  - Root cause: Cards not unregistered from InputSystem when screens unmount
  - Solution: Added unmount() calls in screen unmount methods
  - CardShowcaseScreen tracks and cleans up card components
  - CombatScreen calls unmount() on all layers
  - Leveraged existing Layer/Component unmount() architecture

=========================================

## Combat Targeting System Fix (2025-07-03)

### Fixed Card Targeting Not Working

**What Changed:**
- Removed arrow visualization that was causing complexity
- Fixed CombatModel to properly emit 'targetedVehicle' event
- Fixed CombatLogLayer to handle Model change events correctly
- Removed global click handler that was interfering with vehicle clicks

**Technical Details:**
- **Root Cause**: Model base class only emits generic 'change' events, but CombatScreen was listening for specific 'targetedVehicle' event
- **Solution**: Added manual emit of 'targetedVehicle' event in CombatModel.targetVehicle()
- **CombatLog Fix**: Updated to handle Model's state-based change events instead of expecting added/removed arrays

## Combat Interface Bug Fixes (2025-07-03)

### Fixed High-Priority Combat UI Issues

**What Changed:**
- Fixed card targeting system - removed arrow, simplified to click-based targeting
- Fixed card removal from hand after playing
- Fixed end turn functionality to properly draw new cards
- Fixed resource display updates with per-driver adrenaline tracking
- Added victory/defeat screen with proper data passing

**Technical Details:**
- **Card Targeting**: Simplified system - select card, then click enemy vehicle
- **Card Playing**: Cards properly removed via Driver.playCard() method, UI updates after
- **End Turn**: 
  - Added `emit('stateChanged')` in startPlayerTurn for UI updates
  - Fixed card discard order - hands now discarded before drawing
- **Resource Display**: 
  - Modified PlayerHandLayer to track per-driver adrenaline Map
  - Added setDriverAdrenaline() method replacing single pool
  - canPlayCard() now checks correct driver's adrenaline via cardDriverMap
- **Victory/Defeat Screen**:
  - Enhanced Screen base class with mount(data?: unknown) support
  - Updated Game.showScreen() to accept optional data parameter  
  - Created BattleResultScreen with DRY layoutUI() method
  - Integrated with CombatScreen via getBattleState() method

=========================================

## Battle Log Display for Human Player Interface (2025-07-02)

### Added Real-time Battle Log to Human Player UI

**What Changed:**
- Added a scrollable battle log pane on the right side of the human player interface
- Battle messages are displayed in real-time as the game progresses
- Each message type has its own color coding for better readability
- Log automatically scrolls to show the newest entries
- **Driver names now include team prefixes** (Player1/Player2 or Enemy1/Enemy2) for clarity

**Technical Details:**
- Modified HTML structure to use a flex layout with game board on left and log on right
- Battle log pane is 400px wide with scrollable content area
- Forwarded battle message events from Battle instance to window events
- Added event listener to capture and display battle messages
- Color-coded message types:
  - Damage dealt: Red
  - Healing: Green
  - Turn start/end: Blue
  - Card played: Purple
  - Miss: Gray (italic)
  - Battle start/end: Yellow
- Messages include turn numbers for context
- Log clears when starting a new battle
- Added `getDriverDisplayName()` helper method to Battle class that prefixes driver names with:
  - Player1/Player2 for player team drivers
  - Enemy1/Enemy2 for enemy team drivers
- Updated all battle log messages to use the new display names

=========================================

## Adrenaline System Configuration Update (2025-07-02)

### Changed Default Max Adrenaline from 10 to 5

**What Changed:**
- Added `maxAdrenaline` property to the `DriverConfig` interface
- Updated all driver configurations to include `maxAdrenaline: 5`
- Modified `DriverLoader` to use the configured max adrenaline value instead of hardcoded 10
- Fixed `getConfig()` method to include maxAdrenaline in returned configuration

**Technical Details:**
- `maxAdrenaline` is now exposed alongside `maxHitpoints` in driver configurations
- All four driver archetypes (road_warrior, interceptor, mechanic, raider) now have 5 max adrenaline
- Starting adrenaline remains at 3
- This change makes the game more tactical by limiting the energy pool for playing cards
- Players must be more strategic about card usage with the reduced adrenaline capacity

=========================================

## Human Player Interface for Battle Simulator (2025-07-02)

### Added Human Player Support to Battle System

**What Changed:**
- Implemented human player option in battle.html, allowing manual card play instead of AI-only battles
- Created HumanPlayerInterface class to manage player decisions and UI interactions
- Modified BattleSimulator to support human input through promise-based decision system
- Added comprehensive interactive UI overlay for human players

**Technical Details:**
- Created event-driven architecture using custom events for UI updates
- UI Components:
  - Team displays showing vehicle status (structure, armor, position, drivers)
  - Driver sections with hand display showing cards with costs and effects
  - Visual feedback for playable vs unplayable cards (based on adrenaline)
  - Target selection interface that highlights valid targets
  - End turn button for passing control to enemy AI
- Card selection flow:
  1. Player clicks card → Card is highlighted
  2. If card needs target → Valid targets are highlighted
  3. Player clicks target → Card is played
  4. UI updates to show new game state
- Maintained full compatibility with existing AI vs AI battles
- Fixed TypeScript issues with TargetType enum values and Team method names

=========================================

## Ramming AI Implementation (2024-12-30)

### Created Ramming-Focused AI Strategy

**What Changed:**
- Implemented RammingAI strategy that prioritizes vehicle collision attacks
- Added 'ramming' as a new AI type in AIController
- Created comprehensive test suite for RammingAI behavior
- Updated AI Development Hub documentation with new strategy details

**Technical Details:**
- Strategy prioritizes ramming attacks with highest score (+300)
- Speed boosts are high priority (+250) to enable effective ramming
- Armor is valued (+200) for protection during collisions
- Detects ramming cards by:
  - Card type/description containing 'ram'
  - Effects with scaling: 'ramming'
  - Formula-based damage (e.g., 'armor/10 + speed_diff')
- Estimates ram damage based on armor, speed difference, and driver skills
- Prefers front position for optimal ramming range
- Targets low-health enemies for kill bonuses
- Still maintains survival instincts (healing at <30% health)
- Full test coverage validates all strategic priorities

## Salvage AI Implementation (2024-12-30)

### Created AI Strategy for Vehicle Salvage

**What Changed:**
- Implemented SalvageAI strategy that minimizes vehicle damage for salvage opportunities
- Added 'salvage' as a new AI type in AIController
- Updated AI Development Hub documentation with new strategy
- **Major revision**: Redesigned AI to be competitive while maintaining salvage focus

**Technical Details:**
- Initial implementation was too passive and lost to RandomAI
- Redesigned with game state awareness:
  - Evaluates health ratios to determine if in danger or winning
  - Switches strategies based on game state (survival mode when losing)
  - Prioritizes flanking position for 50% damage bonus (+150 score)
  - Values card draw to find headshots faster (+80 score)
  - Focuses fire on damaged vehicles for efficiency
- Headshot priority reduced from +1000 to +500 for better balance
- Structure damage penalty reduced from -10 to -5 per damage
- Added team detection to properly evaluate game state
- Demonstrates strategic depth while maintaining salvage theme

## AI Evaluation System (2024-12-30)

### Created Comprehensive AI Evaluation System

**What Changed:**
- Created AIEvaluator class to run automated AI vs AI tournaments
- Built `/evalai.html` endpoint for running and visualizing AI evaluations
- Implemented round-robin tournament system with configurable parameters
- Added detailed metrics tracking and reporting

**Technical Details:**
- AIEvaluator runs matches between all AI type combinations
- Tests with different driver configurations to assess adaptability
- Tracks win rates, head-to-head records, average turns per game
- Provides both summary rankings and detailed match results
- Web interface allows configuration of:
  - Which AI types to test
  - Number of games per matchup
  - Driver randomization settings
- Results consistently show:
  - MCTS AI performs best (highest win rate)
  - Aggressive Flanker AI second
  - Random AI baseline performance

## Monte Carlo Tree Search AI Implementation (2025-06-30)

### Implemented MCTS AI Player

**What Changed:**
- Created MCTSNode class for tree structure with UCB1 selection
- Implemented MCTSAI player using Monte Carlo Tree Search algorithm
- Added MCTS to AIController as a selectable AI type
- Created comprehensive test suite for MCTS functionality
- Updated battle simulator to support MCTS AI selection
- **Improved MCTS to be competitive**: Fixed evaluation issues that made it lose to Random AI

**Technical Details:**
- Uses UCB1 (Upper Confidence Bound) for balancing exploration vs exploitation
- Simplified implementation using action evaluation rather than full game state cloning
- Improved parameters: iterations (2000), exploration constant (1.4)
- Enhanced evaluation with strategic weights:
  - ELIMINATION_SCORE = 10.0 (huge bonus for finishing enemies)
  - FLANKING_BONUS = 1.5 (50% damage bonus consideration)
  - Position changes and speed boosts for flanking strategy
  - Better resource management (penalizes ending turn with good plays available)
- Context-aware evaluation:
  - Considers target health, armor, and position
  - Evaluates card synergies with driver skills
  - Prioritizes low-health target elimination
  - Values self-preservation when critical

**Performance Improvements:**
- No longer loses to Random AI consistently
- Makes strategic decisions similar to Aggressive Flanker AI
- Better adrenaline usage (doesn't waste turns)
- Smarter target prioritization

## AI Battle Simulator Web Page (2025-06-29)

### Created Web-Based Battle Simulator

**What Changed:**
- Created `/battle` webpage for running AI vs AI battles
- Built interactive UI for selecting AI strategies and drivers for both teams
- Implemented BattleSimulator class that runs battles headlessly
- Added battle result display with team stats and complete battle log
- Modified webpack config to support multiple entry points
- Integrated with existing AI system (Random AI, Aggressive Flanker AI)

**Technical Details:**
- Created `public/battle.html` with team setup forms and result display
- Implemented `src/battle-simulator.ts` as separate webpack entry point
- Modified webpack configs to build both main game and battle simulator
- Battle simulator runs complete battles using AI decisions
- Displays color-coded battle log with all events
- Shows final team stats (vehicle health, driver HP)
- Max 50 turns to prevent infinite loops

**Features:**
- Select AI strategy for player team (Random, Aggressive Flanker)
- Select AI strategy for enemy team (Simple default, Random, Aggressive Flanker)
- Choose drivers for each vehicle (Road Warrior, Interceptor, Mechanic, Raider)
- Run battles and see winner/loser/tie
- View complete battle log with turn-by-turn events
- See final vehicle and driver health stats

**Usage:**
- Navigate to http://localhost:9000/battle.html when dev server is running
- Select AI and drivers for both teams
- Click "Run Battle" to simulate
- Results and battle log display immediately

**Fixes Applied:**
- Fixed cards.json to use `type` instead of `id` for card identifiers
- Updated battle simulator to use `createDriverWithStartingDeck` instead of `getDriver`
- Fixed mismatched card references (coordinated_strike → coordinated_attack)
- Ensured all drivers have properly initialized decks with valid card types

=========================================

## Battle Event Logging System (2025-06-29)

### Implemented Battle Message Logging

**What Changed:**
- Added comprehensive battle event logging system to Battle.ts
- Created `BattleMessage` interface with type, message, timestamp, turn, and metadata
- Added `BattleMessageType` enum for categorizing messages (damage_dealt, heal_applied, etc.)
- Replaced all 30 console.log and 9 console.warn calls with internal log() method
- Implemented public methods for message retrieval:
  - `getMessages()`: Get all battle messages
  - `getMessagesByType(type)`: Get messages of specific type
  - `clearMessages()`: Clear all messages
- Messages stored in WeakMap to work with frozen Model instances
- Each log entry emits 'battleMessage' event for real-time updates

**Technical Details:**
- Messages include metadata for structured data (driver names, card names, damage values)
- Maintains console.log output in non-test environments for debugging
- Updated all Battle.test.ts tests to check battle messages instead of mocking console
- All 39 Battle tests now pass with the new logging system

**Purpose:**
- Provides structured logging for combat UI to display battle events
- Enables filtering and searching through battle history
- Supports future features like combat replay and analytics
- Removes direct console dependencies from production code

=========================================

## Aggressive Flanker AI Strategy (2025-06-29)

### Implemented Advanced AI Strategy

**What Changed:**
- Created `AggressiveFlankerAI` - first advanced AI strategy
- Strategy focuses on maximizing damage through flanking position (50% bonus)
- Implemented intelligent decision scoring system:
  - Prioritizes movement to flanking position when not already there
  - Values speed-boosting cards when below flanking threshold (60 total speed)
  - Scores damage cards higher when in flanking position
  - Targets low-health enemies for elimination
  - Considers vulnerable status effects for additional damage
- Added card effect analysis to understand:
  - Damage potential
  - Position change capabilities
  - Speed modifications
  - Healing and armor effects
- Implemented resource management:
  - Cost efficiency calculations
  - Avoids spending all adrenaline early
- **Critical health healing**: Prioritizes healing when below 30% health

**Technical Details:**
- Extended `AIPlayer` base class with `AggressiveFlankerStrategy`
- Score-based decision making (evaluates all possible actions)
- Factors in position bonuses, target health, and kill potential
- Modular design allows easy creation of additional AI strategies
- Integrated into AIController as the 'aggressive' AI type
- Full test coverage (6/6 tests passing) with edge case handling

## AI Player System Implementation (2025-06-29)

### Created Computer-Run Player System

**What Changed:**
- Created AI player system architecture with swappable implementations
- Implemented core AI components:
  - `AIPlayer` abstract base class for all AI implementations
  - `AIController` for managing AI players for both teams
  - `AIDecision` interface for representing AI actions
  - `GameStateEvaluation` for analyzing current battle state
- Implemented `RandomAI` as baseline strategy
- Integrated AI system with Battle class using WeakMap pattern (to work with frozen Model instances)
- Modified battle system to support async AI decisions
- Created comprehensive unit tests covering all AI functionality

**Technical Details:**
- Used strategy pattern for different AI personalities
- Support for AI controlling either player or enemy teams
- Fallback to simple AI when no AI configured
- Clean integration without UI changes
- Test coverage includes AI vs AI battles

## Cards.json Update to Match Combat Rules (2025-06-28)

### Updated Card Implementations to Follow Current Combat Rules

**What Changed:**
- Updated cards.json to include all cards specified in Combat Rules document
- Added new cards: Point Blank, Far Shoot, Headshot, Ram, Flank, Oil Slick, Caltrops, Medical Kit, Berserker
- Updated existing cards to match rule specifications:
  - Coordinated Strike → Coordinated Attack (3 damage, doubles if partner attacked)
  - Repair Kit (8 healing with overflow to armor)
  - Nitro Boost (3 speed for 2 turns, draw 2 cards)
  - EMP Blast (upgraded cost reduction)
- Updated starting decks to use cards from the Combat Rules
- Created comprehensive unit tests for Battle system

**How:**
- Reviewed Combat Rules document and compared against existing cards.json
- Maintained backward compatibility by keeping existing cards not in rules
- Used consistent effect structures for all card types
- Added proper upgrade effects where specified in rules
- Created Battle.test.ts with full test coverage for battle mechanics

**Key Implementation Details:**
- Range system implemented with `range` property on damage effects
- Hit modifiers for Headshot implemented with `hit_modifier` property
- Formula-based damage for Ram card using `formula` property
- Status effect duration of -1 indicates permanent effects
- Conditional effects use nested `effect` objects
- Target types include: enemy_single, enemy_all, self, ally, same_vehicle, self_driver

=========================================

## Vehicle UI Architecture Refactor and Combat Log Toggle (2025-01-08)

### Completed Major Vehicle Display System Refactor

**What Changed:**
- Refactored vehicle display and targeting system with event-driven architecture
- Created `/game/ui/Vehicle.ts` component that handles its own click/hover events
- Implemented `CombatModel` to manage UI state (selected cards, targeting, focused vehicles)
- Refactored `BattlefieldLayer` hierarchy to pass full Vehicle models instead of just IDs
- Renamed `EnemyLayer` → `EnemyBattlefieldLayer` for consistency
- Moved `/engine/ui/Card.ts` → `/game/ui/Card.ts` for better organization
- Added F6 key to toggle combat log visibility (hidden by default)
- Enhanced InputSystem with global keyboard handler support

**How:**
- Vehicle components now handle their own input events instead of parent layers checking coordinates
- CombatModel uses our Model base class with automatic getters/setters for state management
- Vehicles listen to CombatModel for state changes and update their visual appearance
- Implemented ES6-style property accessors (get/set) throughout
- Used dimmed colors instead of transparency for non-targetable vehicles
- Added global keyboard handlers to InputSystem that work regardless of focus
- Combat log toggle uses new `InputSystem.registerGlobalKeyDown('F6', handler)`

**Key Architecture Decisions:**
- Event-driven UI where components manage their own interactions
- Clear separation between game state (Battle, Vehicle models) and UI state (CombatModel)
- Components receive full model objects, not just IDs, even if they don't use all properties
- Input abstraction using "focused" instead of "hovered" for future controller support
- Global keyboard handlers checked before component-specific handlers

**Technical Details:**
- `combatModel.targetedVehicle` property automatically emits change events when set
- Vehicle onClick handlers simply set `combatData.targetedVehicle = vehicle`
- CombatScreen listens for 'targetedVehicle' changes to handle card plays
- InputSystem stores global handlers in separate Maps from component handlers
- Proper unmount of global handlers on screen unmount

=========================================

## FPS Limiting Investigation and Fix (2025-06-08)

### Fixed Frame Rate Measurement and Removed Broken Frame Limiting

**What Changed:**
- Fixed FPS measurement to show actual frame rate (was showing ~8500 FPS due to timing bug)
- Removed broken frame limiting code that wasn't actually limiting frames
- Now correctly shows 120 FPS on 120Hz displays (browser's natural vsync)
- Simplified game loop to use browser's built-in frame synchronization

**How:**
- Fixed `lastFrameTime` initialization - was comparing against 0 causing huge initial delta
- Removed artificial frame limiting attempts (setTimeout/setImmediate)
- Let browser handle frame timing naturally through requestAnimationFrame
- Now respects display refresh rate automatically

=========================================

## Combat Log System Implementation (2025-01-07)

### Added Combat Event Logging with Scrollable Display

**What Changed:**
- Created CombatLog model class to track all combat events
- Implemented CombatLogLayer UI component with auto-scrolling
- Added comprehensive event logging throughout Battle system
- Color-coded entries by type (damage, heal, turn changes, etc.)
- Driver-specific formatting with [D1]/[D2] prefixes

**How:**
- CombatLog extends Model base class for automatic property management
- Efficient rendering with view window calculation (only renders visible entries)
- Automatic scrolling to bottom when new entries added
- Integrated with Battle system to log all major events
- Each entry typed as CombatLogEntry with timestamp and formatting

=========================================

## Framerate Display Enhancement (2025-01-07)

### Improved FPS Counter Visibility and Stability

**What Changed:**
- Moved FPS display to top-right corner with dark background
- Added 100ms update interval to prevent flickering
- Improved contrast with yellow text on dark background
- Made performance metrics more readable

**How:**
- Added semi-transparent black background panel
- Positioned in top-right to avoid overlapping game content
- Implemented update throttling in PerformanceMonitor
- Only updates display when 100ms have passed since last update

=========================================

## Combat UI Clarity Improvements (2025-01-06)

### Phase 1: Resource Display and Card Ownership

**What Changed:**
- Split resource display to show both drivers' stats separately
- Added card ownership indicators (D1/D2 overlays with color coding)
- Created reusable DriverStatsDisplay component
- Implemented turn/phase display with clear indicators
- Added draw pile and discard pile counts per driver

**How:**
- Extended ResourceBarLayer to show two DriverStatsDisplay components
- Modified Card UI component to show driver badges and tinted backgrounds
- Created TurnPhaseDisplay component with color-coded phase indicators
- Used Model's state management for reactive UI updates

### Phase 2: Vehicle Positioning System

**What Changed:**
- Implemented 3-lane positioning system (Flanking, Back, Front)
- Added visual lanes with proper labels
- Support for multiple vehicles per position (up to 3)
- Smart stacking and spacing within lanes

**How:**
- Created lane-based layout in battlefield layers
- Calculated vehicle positions based on lane and stack index
- Added translucent background rectangles for lane visualization
- Maintained 30px spacing between stacked vehicles

**Technical Decision:**
- See [Vehicle Positioning and Wave System Design](./AI_TECHNICAL_DECISIONS/VEHICLE_POSITIONING_AND_WAVE_SYSTEM.md)

=========================================

## Performance Optimization Implementation (2024-12-30)

### Major Performance Improvements Through Text Batching

**What Changed:**
- Reduced draw calls from 500+ to ~30 per frame (94% reduction)
- Implemented efficient text batching system
- Added real-time performance monitoring (F5 to toggle)
- Fixed upside-down text rendering issue
- Resolved scissor test compatibility with batching

**How:**
- Created TextBatchRenderer with pre-allocated vertex buffers
- Batch all text rendering into single draw call per frame
- Integrated seamlessly with existing immediate-mode rendering
- Added PerformanceMonitor to track metrics in real-time

**Results:**
- Text-heavy screens now performant (DeveloperScreen: 500+ → 30 draw calls)
- Maintains 60 FPS on all screens
- No visual differences - exact same output with better performance

=========================================

## Basic Combat System Implementation (2024-12-29)

### Dual Driver Combat with Individual Resources

**What Changed:**
- Implemented Team-based battle system (Player: 2 vehicles, Enemy: variable)
- Each driver has individual hand, deck, and adrenaline pool
- Created visual combat screen with all major components
- Added turn-based flow with enemy AI
- Implemented card playing mechanics and battle resolution

**How:**
- Refactored from single BattleEntity to Team/Vehicle/Driver architecture
- Created combat UI layers: Enemy, Battlefield, PlayerHand, Resources
- Connected driver selection to combat with proper data flow
- Added Model base class for reactive state management

**Key Features:**
- Players always have initiative (enemy AI simplified)
- Passengers can't play attack cards (role restrictions)
- Click-to-play cards (drag-and-drop deferred)
- Visual feedback for playable/unplayable cards

=========================================

## Driver Selection Screen (2024-12-28)

### Created Two-Panel Driver Selection Interface

**What Changed:**
- Built complete driver selection screen with synergy preview
- Added 4 driver archetypes with full metadata and starting decks
- Implemented dynamic synergy detection between selected drivers
- Created mini-card previews for starting decks

**How:**
- Extended Layer class for DriverPanel components
- Created SynergyPreviewPanel with real-time analysis
- Used singleton DriverLoader for driver instance management
- Connected to main menu and combat screen flow

=========================================

## Card System Foundation (2024-12-27)

### Implemented Complete Card Loading and Display System

**What Changed:**
- Created flexible JSON-based card configuration system
- Built CardLoader singleton for parsing and validation
- Implemented visual Card UI component with full styling
- Added card showcase screen to preview all cards

**How:**
- Designed extensible card effect system with variables
- Added CSS-like text formatting (wrap, ellipsis, shadows)
- Created scrollable grid layout organized by rarity
- Fixed JSON loading from public directory

=========================================

## Driver System Architecture (2024-12-26)

### Built Complete Driver Data Management

**What Changed:**
- Created Driver class with skills, vehicle stats, and metadata
- Implemented DriverLoader for managing driver instances
- Built DriverSynergy system for analyzing driver combinations
- Added driver archetypes: road_warrior, interceptor, mechanic, raider

**How:**
- Structured driver data to match game design specs
- Created flexible synergy detection based on cards and skills
- Integrated with deck building system

=========================================

## Scrollable Panel System (2024-12-23)

### Complete Overhaul of Coordinate System

**What Changed:**
- Implemented RenderContext for proper coordinate transformations
- Added mouse wheel scrolling support
- Fixed hit testing in scrollable containers
- Added keyboard input with focus management

**How:**
- Coordinate transform stack for nested scrolling contexts
- Scissor test integration for proper clipping
- Component-aware coordinate transformation for input events

**Technical Decision:**
- See [Scrollable Panel Architecture](./AI_TECHNICAL_DECISIONS/scrollable-panel-architecture.md)

=========================================

## UI Primitive Expansion (2024-12-20)

### Added Geometric Shapes and Modular Architecture

**What Changed:**
- Added Circle, Triangle, Polygon, Arrow components
- Refactored DeveloperScreen into modular sections
- Added gradient rendering capabilities
- Improved Panel styling with borders and shadows

**How:**
- Extended Component base class for all shapes
- Created section-based architecture for demo screen
- Used efficient triangulation for complex shapes

=========================================

## Developer Screen Creation (2024-12-15)

### Built Comprehensive Component Showcase

**What Changed:**
- Created interactive developer/demo environment
- Added examples of all UI components
- Implemented visual style guide
- Built modular section system

**How:**
- Organized into panels: primitives, text, buttons, inputs, etc.
- Real-time interactive testing capabilities
- Visual demonstration of theming system

=========================================