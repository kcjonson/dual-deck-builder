# Screenshot goldens: where they come from and what keeps them stable

Phase 0 task DDB-59. Normative: R14.5, R15.26, R15.33, R15.36, R13.34, R13.37.

## Context

A golden-image suite is worth having only while it is trusted. The failure mode is well
documented and fast: one spec goes flaky, someone widens the tolerance, then someone disables
the spec, and within a month the suite is worse than nothing because it consumes CI minutes and
reports nothing. Worldsim designed this harness and never built it, and every screenshot in that
project was checked by eye.

Two questions had to be answered before any picture was committed. Where does an authoritative
golden come from, given that software-rendered pixels on a CI runner do not match a developer's
machine? And what, exactly, varies between two runs of this application?

## Decision 1: baselines come from CI, enforced by the file layout

R14.5 says baselines are produced by the CI runner image only and local runs compare but never
update. Nothing in the repository encoded that, and a documented convention would not have.

Options considered:

1. Document the rule in a README. Rejected: unenforceable, and the first person in a hurry
   breaks it.
2. A CI check that fails when a snapshot file changed in a pull request. Enforceable, but it
   also blocks the legitimate re-baseline, and the ground rules schedule three of those
   (phase 1 ordering, phase 2 text metrics, phase 4 styles).
3. A `workflow_dispatch` job that runs `--update-snapshots` on the runner and commits, plus a
   pull-request gate that rejects baseline changes from anywhere else.

Option 3, with the platform folded into the snapshot path as a third mechanism underneath both.
`snapshotPathTemplate` is `{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}` and
`.gitignore` tracks only the `linux` directories, so a local run on Windows or macOS writes a
file that is not the file CI committed and that git does not see. Local runs therefore keep
working, and keep being useful, without any possibility of overwriting the authority: the first
local run mints that machine's own baseline and every run after compares the working change
against the machine's own before.

On top of that, `playwright.config.ts` refuses any argument that begins with `-u` or with
`--update-snapshots` unless `VISUAL_BASELINE_RUNNER` is set, which only the dispatch job
sets. The prefix is the point: the flag takes an optional mode and commander accepts it
attached, so `-uall`, `-uchanged` and `--update-snapshots=changed` rewrite baselines exactly as
the bare forms do, and a check for the bare forms alone lets all of them through. And the
`baseline-provenance` job (`scripts/check-baseline-provenance.sh`) fails any pull request in
which a baseline the branch changes was last set by anything other than the dispatch job's mint
commit: author and committer `github-actions[bot]` and the exact subject
`Update screenshot baselines [visual-baseline]`, whose body links its run. It judges each
changed file rather than each commit touching the directory: a merge of `main` that brings
`main`'s own new baselines is TREESAME only to its `main` parent, which the range excludes, so
a per-commit log listed such merges as offenders (DDB-72). The subject is compared whole, not
searched for the marker, because `git revert` of a mint is titled
`Revert "Update screenshot baselines [visual-baseline]"` and restores whatever the mint
replaced. `scripts/check-baseline-provenance.test.ts` runs the script in scratch repositories
against the cases: a mint, a hand edit, a hand edit a later mint overwrote (passes, the bytes
are the mint's), a revert of a mint, the subject typed by hand, a merge of `main` bringing its
own baselines (passes), a merge that edits a baseline, and a deletion.

What the three layers are actually worth, in order and stated without inflation. The `.gitignore`
layer is the strong one: it is not a rule about behaviour but a fact about paths, and a Windows or
macOS run cannot write the tracked file because the file it writes has a different path. The
config guard stops the accident, which is the common case; it stops nothing deliberate, since the
person it stops owns the config. The provenance job raises the cost of a hand-minted golden and
puts the attempt in the pull-request log where a reviewer meets it, and that is the whole claim:
the marker is a commit subject and anyone can type a commit subject. Making it unforgeable means
resolving the run id in the commit body against the Actions API and confirming that run produced
these bytes, which is worth building once there are baselines to protect.

Consequence: re-baselining is a deliberate act with a run URL attached, and a reviewer can see
which run produced the pictures they are approving. The cost is one extra dispatch step at each
of the scheduled re-baselines, of which there are now four: phase 1 ordering, phase 2 text
metrics, phase 4 styles, and any bump of the pinned runner image. The image is pinned to
`ubuntu-24.04` in all three jobs for that reason, since a rolling `ubuntu-latest` would let the
image that checks drift away from the image that minted. `snapshotPathTemplate` carries
`{platform}` and no architecture, so an arm64 runner would compare against the x64 goldens without
saying so; that is fine while every job names an x64 image and is a trap the day one does not.

## Decision 2: the engine's pause hook, not Playwright's clock

R13.37 asks for a time freeze *or* a fixed-timestep hook, and the freeze is the option taken:
`window.__app.pause()` (R13.32), which R13.37 permits outright. Two other rules ask for the thing
that is not done, and both are departures rather than one. R15.36 names Playwright's Clock API.
R14.5 asks for a fixed-step injected render clock, which a pause is not either: pausing stops
`update` and leaves the render loop free-running at whatever rate the runner manages, so the frame
that gets photographed is not a numbered step. DDB-61's `FrameTimer` does take an injected clock,
but neither entry point passes one - `src/index.ts` and `src/gallery/index.ts` both call
`new FrameTimer()` with no arguments - so there is no route from a running page to a fixed-step
render clock today in any case, and building one is a change to both entry points that phase 0
did not make.

`clock.pauseAt` freezes `requestAnimationFrame` along with the timers. The frame loop then stops,
and a harness photographing a page that is no longer drawing has replaced a determinism problem
with a worse one. `window.__app.pause()` does the opposite by design: it stops `update` and lets
rendering continue, which is exactly what a canvas capture needs, and it stops the splash screen
counting towards its automatic navigate.

The second reason is concrete rather than architectural. Any clock call, `setFixedTime` included,
replaces the page's `performance` object with a plain stand-in whose
`measureUserAgentSpecificMemory` is `() => {}`. Since DDB-61 put cross-origin isolation on the dev
server, `FrameTimer.requestMemorySample` takes its live branch, calls that stub and throws on
`undefined.then`, so `window.__perf.snapshot()` fails on every clocked page and the harness's own
settle gate dies. This was observed, not predicted.

Nothing the phase 0 goldens capture reads `Date`, so the freeze loses nothing. The clock becomes
necessary for a state behind a timer, `PlayerHandLayer`'s 300 ms discard being the first, and
whoever needs it has to solve the `performance` collision.

## Decision 3: seed the random source from the harness, not the engine

`Math.random` is replaced with a seeded mulberry32 by `page.addInitScript` before any application
script runs. The alternative was an injected random source threaded through `Deck`, `Model`,
`RandomAI` and `AIEvaluator`, which is a refactor of game code that phase 0 is not allowed to
make, and which would have to be maintained at every new call site. The init script covers all of
them, including ones added later, and cannot leak into a shipped build because it lives in the
test process.

In phase 0 it changed nothing measurable, and that was recorded rather than glossed: the combat
golden was byte-identical under a different seed and with the seeding removed. `Deck.shuffle` had
one caller, `Driver.reshuffleDiscardIntoDeck`, which fires only when a deck runs dry, so the
opening hand was dealt in deck order. The seed mattered for the states phase 0 does not capture,
where it already demonstrably mattered: 72 of the combat screen's 355 lint rows differed run to
run in the phase 0 lint baseline, all of them after a card was played.

DDB-399 made the refactor phase 0 ruled out: the game now threads a seeded source of its own, and
the init script still seeds it. Game code reads `Math.random` in one place, `freshSeed()`, which
mints root seeds, a fight's among them when nothing passes the battle a stream. Every reshuffle and
every random AI pick draws from a stream forked from the fight's root, so the patched
`Math.random` reaches all of them through one read per fight rather than one per call, and
`Model` ids are a counter that draws nothing ([seeded-prng.md](./seeded-prng.md)). That moves
what each seeded number lands on, which could have moved any golden that reached a shuffle. None
did: no capture reaches a reshuffle or a random AI, since the dev fight and the gallery's battles
plan with the aggressive AI, and the enemy-turn capture stops at the first raider's action.

DDB-411 shuffles every deck before the opening deal, from its seat's stream, and that shuffle does
reach a pixel: every started fight's opening hands come from the fight's root seed. The combat
screen's goldens moved with it wherever the hands show, the plain capture and the log in both
projects and the end-turn preview. The enemy-turn capture didn't, since the hands are discarded by
then and the raider's first action came out the same, and neither did the gallery's typical battle,
whose player hands the scene sets after the deal; the raiders there, as in the dev fight, hold
their whole five-card decks whatever the order and planned the same. Those goldens hold only while
the harness's seed, and the number of `Math.random` reads before each fight's `freshSeed()`, stay
where they are. A change to either moves them, and the answer is a re-mint, not a tolerance.

## Decision 4: a scene that cannot be honestly captured is listed, not omitted

`primitive-shapes` overruns the renderer's dynamic vertex buffer, logs `bufferSubData: buffer
overflow` on every frame and draws malformed circles (DDB-103). Fixing the buffer sizing is a
renderer change and out of phase 0's scope. Committing a baseline of it would make the corrupt
drawing the definition of correct, and the first person to fix DDB-103 would be told their fix is
a visual regression. `battleResultScreen` has the same shape of problem for a different reason: it
renders from a `BattleResultData` payload and the R13.32 control surface carries none, so a
capture would get its missing-data fallback.

Both are `test.fixme` with the reason attached, so they appear in every report as named gaps.
Deleting them from the scenario list would have been quieter and would have hidden two real
tickets.

Both gaps have since closed. `primitive-shapes` got its golden when DDB-103 and DDB-185 were
fixed, and `battleResultScreen` when `window.__app.navigate` gained a data argument (DDB-230,
DDB-91): the result screen's payload is plain data, so a capture passes exactly what the combat
screen does. See [screens-at-lint-zero.md](./screens-at-lint-zero.md), which also added the
1024x600 screen scenarios.

## Bootstrap: the order the first goldens have to arrive in

Nothing above works until there is a first baseline, and there is a chicken-and-egg problem in the
way of one. The config refuses to mint without `VISUAL_BASELINE_RUNNER`; the only thing that sets
it is the `update_baselines` dispatch job; and GitHub offers `workflow_dispatch` only for workflows
that already exist on the default branch. A brand-new `visual.yml` on a feature branch therefore
cannot be dispatched from that branch, which makes "run the dispatch first" impossible advice, and
leaves the screenshot job failing every assertion on a missing golden.

That is a sequencing problem rather than a design problem, so the sequence is written down here and
followed, rather than worked around by loosening something.

1. `visual.yml` lands on `main`, with the `visual` job carrying `continue-on-error: true` and the
   name "Screenshots (unbaselined, non-blocking)". It is red and it is supposed to be: there is
   nothing to compare against yet, and a red non-blocking job that says why is honest where a
   deleted job or a widened tolerance is not.
2. The Visual workflow is dispatched from `main` with `update_baselines=true`. It mints on
   `ubuntu-24.04` and pushes one `[visual-baseline]` commit carrying the run URL. Read the
   `playwright-report-baseline` artifact from that run before trusting what it committed: this is
   the single run whose output becomes the definition of correct, and it has no second run to
   disagree with it. It is also the first time the `electron` project has ever run on Linux, which
   is why that project counts as unverified there until this step passes.
3. Once the Linux goldens are on `main`, `continue-on-error` comes off the `visual` job in the same
   change, and only then is the job a gate worth requiring.

### What the bootstrap actually did

All three steps have run. Step 1 landed with the seven-PR stack merge (5da8780). Step 2 was
[run 34310762573](https://github.com/kcjonson/dual-deck-builder/actions/runs/34310762573),
dispatched from `main` with `update_baselines=true`, which passed 26 and skipped 4 in 1.5 minutes
and pushed commit `670350c` carrying twenty-six goldens, thirteen per project. Step 3 is this
change: `continue-on-error` is off the `visual` job and its name no longer says unbaselined.

Three things the dispatch settled that had been open questions rather than known facts.

**Electron runs on Linux.** It had never been tried, and `--with-deps` installs Chromium's system
libraries rather than Electron's, so `libgtk-3-0t64`, `libxtst6` and `--no-sandbox` were added
speculatively against the packaging of 24.04 and Ubuntu's unprivileged-user-namespace restriction.
All three were necessary and sufficient: the electron project minted all thirteen of its goldens
under `xvfb-run` with no further packages. The `t64` guess in particular was the one most likely to
be wrong, since the plain `libgtk-3-0` name still resolves on older images.

**The asset gate held on a runner nobody had measured.** The mint is a single run with no second
run to disagree with it, so a `cards.json` that resolved late would have committed a pre-data frame
as the definition of correct, and the two-frame quiescence check cannot see that (measured above:
an unstarted fetch serialises identically to a finished one). It did not happen. Verified after the
fact rather than assumed, by decoding all twenty-six committed PNGs: the three card-dependent
screens carry 45.6, 64.0 and 49.2 percent non-modal pixels with 1,537, 2,367 and 2,175 distinct
colours, and reading the card showcase golden by eye shows all eighteen cards with their rules text.
An empty frame would be a flat field of one colour.

**Linux and win32 draw the same picture.** Each committed Linux golden was compared against this
machine's untracked `win32` baseline for the same scenario by reducing both to a 48x30 grid of mean
RGB, which averages out glyph antialiasing but not missing content. Every one of the twenty-six
agreed: mean per-cell difference from 0.07 to 0.68 of 255, worst single cell 18.4, and no size
mismatches. So the two platforms differ only in how they rasterise edges, which is what the absolute
pixel budget exists to absorb, and cross-runner variance is now an observation rather than the
guess it had to be while a developer machine was the only thing that had ever run the suite.

What is still unmeasured is run-to-run variance *on the runner*, because the mint ran once. The next
push to `main` is the first check against these goldens and the first real observation of it; if it
wobbles, the value to revisit is `maxDiffPixels`, not `threshold`.

## What this harness does not catch

Measured, not reasoned. Every number below came from mutating the source, running the affected spec
against the committed baseline, and reading the differing-pixel count back out of the comparison.
They were taken on this machine, where consecutive runs are bit-exact, so each count is the
mutation's own signal with no noise in it.

The tolerance change closes most of this. The original `threshold: 0.2` with
`maxDiffPixelRatio: 0.001` missed five of the seven mutations; the committed `threshold: 0.01` with
`maxDiffPixels: 200` misses none of them. What remains is real, and is listed so nobody has to
rediscover it.

**The colour cliff.** `threshold` is pixelmatch's per-pixel YIQ distance, and the ceiling it sets is
`35215 * threshold^2`. A uniform neutral shift of *d* levels scores `0.5053 * d^2`, so the smallest
visible colour change is the smallest *d* clearing that ceiling. At the old 0.2 the ceiling was
1,408 and the cliff sat at *d* = 53: shifting the whole 1440x882 main-menu background by +45 per
channel produced zero differing pixels, and setting `Button.normalColor` to `Button.hoverColor`,
which is the difference between a normal button and a hovered one, also produced exactly zero. At
0.01 the ceiling is 3.52 and the cliff sits at *d* = 3: +2 per channel is still invisible (0
pixels), +3 is caught (1,166,829), and the hover-colour swap now reports 85,086. A drift of one or
two levels per channel remains invisible, which is what any nonzero tolerance costs.

**The area budget.** `maxDiffPixels: 200` is how many pixels may exceed the depth ceiling, so
anything whose whole visual footprint is under 200 changed pixels passes. That is roughly six
glyphs at 18 px: removing a 21-character 18 px label changes 704 pixels, about 33 per glyph. The old
budget was `maxDiffPixelRatio: 0.001`, which at this viewport is 1,270 pixels, and three separate
real regressions fitted inside it: a 3 px shift of one 300x60 button (631 px at the old threshold,
874 at the new one), a dropped character in an 18 px label (355 / 512), and a one-character typo in
the 64 px main-menu title (223 / 604). All three now fail.

**The vanishing-component floor.** Follows from the budget: a component drawing fewer than 200
differing pixels can disappear entirely without failing anything. An 80x30 button is well clear
(1,973 px); a short label at 16 to 18 px is not. There is no cheap fix inside a whole-page
screenshot, and there does not need to be, because the tree snapshot is the tool that answers "is it
still there" and R13.29's lint gate is where that belongs.

**The developer-screen fold.** `screen-developerScreen` captures the viewport, not the document. The
screen scrolls 3,144 logical pixels of content through an 882-pixel window, so the golden holds
`interactive-controls` (y 120 to 420) and `style-guide` (500 to 770) whole, 32 pixels of
`input-showcase`, and none of the remaining five sections. The gallery scenes are where those five
are actually covered, which means the scenario list understates what the scenes are for: they are
not a second view of the developer screen, they are the only view of most of it.

**The pre-first-update frame.** `openScreen` pauses before it navigates, so `update` never runs on
the incoming screen and every game-screen golden is the frame before the first tick. Whatever a
screen settles into on its first update is outside what these pictures cover.

**Sibling z-order, which is close to untestable here.** Two mutations came back inert for the same
underlying reason. Text does not draw where the tree says it does: `Text` submits into a batch that
`Renderer` flushes at a scissor change or at `Game.flush`, so every glyph lands over every piece of
geometry in its flush window whatever the sibling order was. And `Panel.render` draws
`this.background` and then the content layer because the method says so, not because a child list
does. Swapping a `Button`'s background and label children changes nothing on screen for both
reasons at once. Sibling ordering becomes testable when phase 1's batcher gives draws a real
ordinal key; until then a golden cannot see an ordering bug the renderer is incapable of
expressing.

## What each determinism control kills

| Control | Mechanism | What varies without it |
|---|---|---|
| Fixed viewport | `use.viewport` (chromium), `BrowserWindow.setContentSize` (electron), both 1440x882 | every screen and section lays out from a width |
| Fixed device pixel ratio | `deviceScaleFactor: 1`, plus `--force-device-scale-factor=1` for Electron | `FontAtlas` glyph raster, `Renderer.resize` drawing buffer, `Layer` and `Panel` scissor rectangles |
| Time freeze | `window.__app.pause()` | splash auto-navigate, `PlayerHandLayer`'s 300 ms discard timer |
| Seeded random | mulberry32 over `Math.random` via `addInitScript`, read by `freshSeed()` for each fight's root stream | every opening hand, deck order after a reshuffle, a random AI's picks |
| Wait for assets | `assetsReady` on `window.__app.status()`, false while CardLoader has a request outstanding | `cards.json` arriving mid-capture |
| Wait for a settled layout | hooks present, `document.fonts.ready`, then the window, the canvas box, its backing store and the committed viewport all at 1440x882 and the tree unchanged for two counted frames (DDB-201) | a resize measured or committed after the screen built; layout still settling when the shutter opens |

Those last two are separate rows because they were one row and the row was wrong. The two-frame
comparison proves that the tree stopped changing and nothing more: a screen whose `cards.json`
request has not resolved serialises identically frame after frame, so the unstarted fetch passes
it exactly as well as the finished one. Measured with a four-second delayed route on `cards.json`
and the `assetsReady` wait removed: `openScreen` returned after 449 ms with a 1,786-character card
showcase tree, where the loaded tree is 89,108. With the wait in place the same run takes 4,547 ms
and returns the full tree. The case that costs real money is the mint job, which runs
`--update-snapshots` once and has no second run to disagree with it, so one slow fetch there
commits the pre-data frame as the definition of correct and every correct run afterwards fails.

The last row did not do what it said until DDB-201. The tree comparison was a `waitForFunction`
with an async predicate, and `waitForFunction` tests the returned Promise for truthiness rather
than awaiting it, so the predicate passed on its first poll and never compared anything
(`waitForFunction(async () => false)` resolves at once; the sync form times out). Every golden
before DDB-201 was taken three frames after `assetsReady` with no stillness check at all. See
"The layout gate" below.

1440x882 is the viewport the phase 0 frame baseline was captured at - the default in
`scripts/perf-capture.mjs`, since the baseline JSON records samples and no viewport - so a
screenshot and a frame time in that table describe the same frame.

Capture is `expect(page).toHaveScreenshot()`, the runner's page capture. `toDataURL` and `toBlob`
de-multiply lossily (R15.26) and are not used anywhere.

## Verification

Consecutive runs on this machine are bit-exact: the whole suite passes with `threshold: 0` and
`maxDiffPixels: 0`, which is the measurement the committed tolerance has to be justified against. It
means the tolerance buys nothing locally, so its only job is cross-runner variance, and cross-runner
variance is the one thing a developer machine cannot measure. That is a second reason the bootstrap
dispatch matters: it is the first observation of what a Linux runner actually does, and the value to
revisit if it wobbles is `maxDiffPixels`, not `threshold`. Anti-aliasing differences on a glyph edge
are deep rather than shallow, since a pixel that lands 40% covered instead of 60% differs by tens of
levels, so no threshold short of a useless one absorbs them and the absolute pixel budget is the
honest place for that headroom.

The mutation set, run one at a time against the committed baselines. Each column is the
differing-pixel count at that threshold; a mutation is caught when the count exceeds the budget,
which was 1,270 before and is 200 now.

| Mutation | at 0.2 (budget 1,270) | at 0.01 (budget 200) |
|---|---|---|
| 3 px shift of one 300x60 button | 631, missed | 874, caught |
| button fill brightened 5% (`#3333cc` to `#3636d6`) | 0, missed | 84,776, caught |
| `Button.normalColor` set to `hoverColor` | 0, missed | 85,086, caught |
| dropped character in an 18 px label | 355, missed | 512, caught |
| one-character typo in the 64 px main-menu title | 223, missed | 604, caught |
| 1 px font-size change on a 24 px label | 2,481, caught | 3,213, caught |
| 80x30 button removed | 1,973, caught | 1,973, caught |
| whole-background neutral shift, +2 per channel | 0, missed | 0, missed |
| whole-background neutral shift, +3 per channel | 0, missed | 1,166,829, caught |

Two mutations came back inert for product reasons rather than harness reasons, and they are tickets
rather than tolerance problems. `Button` never forwards `options.style.fontSize` to its label
`Text`, so the five style blocks in `MainMenuScreen` are dead configuration and every button label
draws at `Text`'s default 16. And swapping a `Button`'s background and label child order changes
nothing on screen, for the batching and hardcoding reasons in the section above.

The suite passes 26 of 26 (4 skipped) twice in a row at the committed values, with every baseline
byte-identical afterwards. When a golden does start failing, the answer is to find what varies, not
to raise these numbers.

## The layout gate (DDB-201)

Filed after DDB-70's re-mint, where a review read the driver-selection golden as having moved its
whole layout between mints (back button at 0,0 then 30,30, panels at x 13 then 72) with no layout
change. That flip is not in the history: every committed driver-selection golden in both projects,
from the first mint (`670350c`) to `a49d605`, has the button's fill at (35, 35) and the left panel's
border at x 72, which is what the code says. So there was no flip to explain. There was a gate
that could not have caught one.

What the capture could race is a resize. It reaches a screen in three steps: the window changes
(and screens still read `innerWidth` when they build), the `ResizeObserver` measures the canvas box
into a pending viewport, and the next frame commits it, resizing the backing store and calling
`Screen.resize`, which on driver selection tears the screen down and rebuilds it. Reproduced by
shrinking the viewport to 1300x800 just before `navigate`: at the moment the screen built, the
window and canvas box were 1300x800 while the backing store and committed viewport were still
1440x882. The old `settle` would have captured whatever came three frames after `assetsReady`,
because its only stillness check, the two-frame tree comparison, never ran (see the note under the
determinism table: an async `waitForFunction` predicate passes on its first poll).

`settle` now polls inside one `page.evaluate` and returns only when the window, the canvas's CSS
box, its backing store and the committed viewport (the tree snapshot's `viewport`, which is
`CanvasViewport.logical`) all equal `FIXED_VIEWPORT`, and the tree has serialised the same for two
frames counted on the frame timer; any disagreement or change restarts the count. It fails after
15 s with the sizes it was stuck at. `openScreen` also asserts the screen's root layer is the
viewport, since a root at another size is a screen that built before the last commit and never
heard it. With the same 1300x800 reproduction, `settle` held until the viewport was restored and
returned with everything at 1440x882. No engine hook was added: reading the CSS box directly is
stronger than asking `CanvasViewport` whether a measurement is pending, since it also covers a
resize the observer has not reported yet.

Stability, measured on CI: a Screenshots run on the branch compared all 35 captures against
`main`'s goldens, minted on other runner instances, and every one differed by 0 pixels. Three
`update_mode=all` mints on the branch each rewrote every golden and each ended "Baselines
unchanged", so the files are byte-identical across mints: runs 36443442482, 36444289171 and 36444931498.

## The cluster rule (DDB-197)

`maxDiffPixels: 200` counts differing pixels wherever they are, so any change with a footprint
under 200 passes, and a changed number is the canonical case: DDB-64's re-mint found `main`'s
combat golden reading 5 where the app drew 15. A game UI golden that cannot see a number change is
missing the regression it exists for.

Options on the ticket: per-scenario budgets near zero, a check of rendered strings against the tree
snapshot, or a limit on the size of any connected region of changed pixels. The cluster limit is
what landed. Per-scenario budgets still count area, so a digit on a noisy scenario hides under that
scenario's allowance. The text check sees strings, not pixels, so it misses a glyph drawn wrong, and
it needs a second committed golden per scenario. The cluster rule sees any dense change, text or
not, and needs nothing new committed.

`expectGolden` in `tests/visual/support/harness.ts` runs `toHaveScreenshot` as before, then takes the
same frame again, marks the pixels pixelmatch counts as different (the suite's threshold,
anti-aliased pixels excluded, so both checks agree on which pixels changed), and joins differing
pixels within 2 of each other on both axes into clusters (`tests/visual/support/diffClusters.ts`).
A capture fails when its largest cluster exceeds 8 pixels, whatever the total. The radius bridges
the gaps between a glyph's strokes and between adjacent digits; scattered noise stays in one- and
two-pixel clusters. Every capture writes `golden-diff.json` (total, cluster count, largest cluster
and its bounds) to its output directory, which the workflow uploads, so the budget can be checked
against real runs rather than re-guessed. On a `changed` mint the harness rewrites a golden the
cluster rule rejects, since `toHaveScreenshot` only rewrites what it rejected itself.

Why 8: the CI measurement above is 0 differing pixels on all 35 captures across runner instances,
so the budget is headroom against a future wobble, not cover for a present one, and the smallest real
change measured (a digit in the 8 px armour badge) is 13.

The mutation table re-run with the cluster rule, one mutation at a time against this machine's
local baselines (macOS, bit-exact across runs). "Largest" is the largest cluster at radius 2.

| Mutation | Differing | Largest | Area (200) | Cluster (8) |
|---|---|---|---|---|
| 3 px shift of one 300x60 main-menu button | 919 | 280 | caught | caught |
| button fill brightened 5% (`#3333cc` to `#3636d6`) | 79,045 | 15,981 | caught | caught |
| `Button.normalColor` set to `hoverColor` | 79,317 | 16,004 | caught | caught |
| dropped character in a button label ("Back to Men") | 380 | 161 | caught | caught |
| one-character typo in the 64 px main-menu title | 248 | 126 | caught | caught |
| 1 px font-size change on the 48 px driver-selection title | 1,172 | 137 | caught | caught |
| 80x30 button removed (buttons scene) | 2,175 | 2,175 | caught | caught |
| main-menu background +2 per channel | 0 | 0 | missed | missed |
| main-menu background +3 per channel | 1,170,848 | 1,168,110 | caught | caught |
| intent badge two digits to one (15 to 5, the DDB-64 case) | 74 | 70 | missed | caught |
| intent badge one digit changed (15 to 16) | 42 | 42 | missed | caught |
| 8 px armour badge one digit changed (5 to 6) | 13 | 13 | missed | caught |
| 10 px quantity badge one digit changed (x3 to x4) | 17 | 17 | missed | caught |

| centred synergy text, final `.` dropped | 674 | 151 | caught | caught |
| centred synergy text, final `.` to `,` | 0 | 0 | missed | missed |
| centred "Starting Deck:" to "Starting Deck;" | 948 | 299 | caught | caught |
| left-aligned card text, final `.` dropped ("Gain 8 Armor") | 2 | 1 | missed | missed |
| left-aligned card text, `.` to `,` | 0 | 0 | missed | missed |
| left-aligned vehicle label, `:` to `;` ("Driver;") | 0 | 0 | missed | missed |

The +2 row is the threshold's cliff and is unchanged by design (the colour cliff section above).

Punctuation is the known miss. The centred rows are caught only because removing or widening a
character re-centres the whole line; the change itself is not what fails. In place, a period, a
comma and a colon at body sizes differ by a few pixels that pixelmatch mostly classes as
anti-aliasing, so `.` to `,` and `:` to `;` produce zero differing pixels and a dropped trailing
period two. No pixel budget reaches that without also failing on runner noise. The fix belongs in
the tree snapshot, which holds every string, and is there now (DDB-206, landed with DDB-80): every
gallery and screen spec also compares a per-scenario text record, one line per visible Text with its
path, string and rect, against `<kind>-<name>-text.json` beside the golden, minted by the same
dispatch. Five of the punctuation rows above were re-run against it and all five fail it, including
the four the pixels miss; the table is
in [tree-snapshot-schema.md](./tree-snapshot-schema.md). Beyond punctuation and strings, what still
passes is any change whose densest region is 8 pixels or fewer.
