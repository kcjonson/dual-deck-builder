# Prototype CI: move fast, fail loud

## Date
2026-10-19

## Context

DDB-536. The game is an early prototype for playtesting. The UI changes every day, and playtesting happens on the SFTP deploy of main (bearcavinteractive.com/playtest/dual-deckbuilder/) and locally; the Electron builds and the other channels exist so we don't fall too far behind on them. Main is allowed to break, as long as it breaks loudly and the next session fixes it.

CI had been built for the opposite: every pull request had to be green, screenshots included, before it merged. Measured from Actions history and the session transcripts, Sep 21 to Oct 19:

- Every push ran five workflows, about 87 runner-minutes: jest four times (CI, Web Build, and the Windows and macOS Electron builds, each with coverage on), Windows and macOS packaging at about 10 minutes each, and the Screenshots job.
- The Screenshots job was 479 tests on one worker. Its weekly median went 5.6, 22.7, 34.9, 51.8 minutes over four weeks, and every push to every pull request waited on it. No run was cancelled by a newer push; about 250 were still going when one landed.
- A screenshot change cost three full runs back to back: the failing one, the baseline dispatch (which ran the whole suite again, up to 65 minutes), and an empty "Run the checks on the minted baselines" commit to trigger checks on the bot's push. 97 of 215 branches went through it, 257 dispatches, a median 1.65 h (p90 5.4 h) from the first visual failure to green, and 58% needed a second update, mostly because main moved or a stacked rebase rewrote the committer the provenance check keys on.
- Test, CI, and baseline work was 38% of agent-active time (59% outside the Oct 6 to 10 orchestrator, 86% on Oct 19): 89 h waiting on CI, 43 h on baselines, 52 h running tests locally. Local tests were the smallest part; commits averaged 0.45 full jest runs.
- Jest was 301 suites and 7,103 tests, 318 s on CI and 350 s locally at two workers. Map generation's tests in `src/renderer/game/map/` were about half of it.
- 28% of the commits that triggered CI changed nothing in `src`: docs, baselines, and the empty retrigger commits.

The repository is public, so Actions minutes cost nothing. The cost was wall clock and agent time, and every UI change paid it.

## Options considered

1. **Keep the gates and make them cheaper**: shard the Screenshots job, accept the failing run's images instead of re-running the suite, push baselines with a token that triggers checks, key provenance on the run id.
   - Pros: keeps pixel coverage; cuts a screenshot change from three serial runs to one.
   - Cons: a baseline update for every UI change, which is every day, and merges still wait on CI.
2. **No CI at all.**
   - Cons: a broken main reaches playtesters before anyone hears about it.
3. **No baselines, merge on local checks, and run everything on main after merge, loudly (chosen).**

## Decision

Option 3.

- **Deleted:** `visual.yml` (the provenance job, Screenshots, and the baseline dispatch), `tests/visual` (specs, harness, cluster rule, the battle fit suite, and the 276 committed baseline files), `scripts/check-baseline-provenance.sh` and its test, and this harness's decision record (`visual-golden-harness.md`, in history at `caa6815f`). `ci.yml`, `web-build.yml`, and `electron-build.yml` are replaced by the two workflows below. The gallery, its scenes, the dev hooks, and `window.__ui.lint()` stay as tools.
- **`pr.yml`, advisory:** lint, typecheck, and `jest --changedSince=<base>`, which runs only the tests that import a changed file, slow ones included. A newer push cancels the older run, and docs-only changes skip it. Nothing waits on it.
- **`main.yml`, on every push to main, nightly, and on dispatch.** Four checks:
  - `checks` runs lint, typecheck, and `npm test`;
  - `slow tests` runs the whole slow project when anything it imports changed since main's previous commit, and always at night;
  - `boot smoke` is described below;
  - `electron package` packages Windows and macOS and smokes them, nightly or when `electron/`, `webpack/`, `build/`, the fonts, or the package files change.

  Each step of `checks` runs whatever the step before it did, so one run reports every failure. A newer push cancels the older run, since it carries the older one's changes. The nightly is skipped when main hasn't moved since the last nightly that passed.
- **Fail loud:** `report-main` (`.github/actions/report-main`) turns each check's result into an issue. A failure opens `main is broken: <check>` under the `main-broken` label, or comments on the open one, and a pass closes it. Skipped checks leave their issue alone, and the slow check only counts when the slow tests ran. `deploy-sftp.yml` reports a failed playtest deploy the same way, and the deploy waits for none of the checks. CLAUDE.md tells every session to look for open `main-broken` issues first.
- **Boot smoke** (`tests/smoke`, `playwright.config.ts`, `npm run test:smoke`): two projects.
  - `production` builds `dist/web`, serves it the way the host does (no cross-origin isolation headers, `scripts/serve-static.mjs`), and checks it initializes, loads its font atlases, and runs past the splash with a clean console.
  - `screens` opens each of 28 screen cases (every screen `ScreenManager` accepts, plus the save states and payloads that change a screen's path) through the dev hooks, one fresh page each. Each case has to be accepted, mount, finish loading, draw 30 more frames with updates running, still be on that screen, have layout content, and log no console error.

  No pixels are compared.
- **Jest:** coverage is off by default (`npm run test:coverage` keeps it), and ts-jest transpiles without typechecking (`tsconfig.jest.json` sets `isolatedModules`), since `npm run typecheck` already checks the tests. Two projects: `fast` (`npm test`) and `slow`, which is `src/renderer/game/map/` (`npm run test:slow`). `npm run test:changed` runs whatever imports a change since `origin/main`, both projects. Locally at two workers with a cold cache, the whole suite with coverage took 350 s. Without coverage, `fast` took 125 s (261 suites) and `slow` 122 s (37 suites), and transpiling only took `fast` to 90 s.
- **CLAUDE.md:** the move-fast, fail-loud section, testing like a developer with a day's work (targeted tests while iterating, the full suite once per block), and the merge bar (local lint, typecheck, and tests; push at the end of a block; don't wait on or poll CI).

## Rationale

Every UI change invalidates screenshots, and the UI changes daily, so a pixel gate costs a baseline update a day and catches what a playtester sees in the first minute anyway. What a playtester can't easily tell us is that the build didn't boot, a screen threw on mount, or a test that guards game rules went red, and those are what main now checks and shouts about. Running them after merge instead of before means nobody waits; a red main is an issue the next session picks up.

## Consequences

- No longer caught by anything automated: pixel and text-content regressions, layout overlaps (the R13.29 lint gate), the renderer's in-browser pixel tests (uber shader, small-text raster fallback, context loss), the battle screen fit matrix, and Electron-only rendering differences. Playtesting is the check, and a bug gets filed when someone sees it.
- Main can go red. The issue is the signal, and it stays open until the check passes again.
- An Electron packaging break surfaces within a day rather than within the push.
- A change to map generation runs the slow tests in the PR lane only through `--changedSince`, and on main when they're affected; `npm run test:slow` locally is the habit CLAUDE.md asks for.
- Comments across `src/` still explain hooks and fixtures by the goldens they held still (`settleAnimations`, `holdFrames`, `assetsReady`, the developer sections). The mechanisms are still there and the smoke uses some of them; the comments describe their history.
- R14.5 to R14.7 (goldens, a perf gate, required checks) are suspended for the prototype, not removed from the spec. When the UI settles, bring screenshots back from the harness in history, with option 1's changes: shard the suite, accept the failing run's images rather than re-running, and key provenance on the run id. DDB-252, DDB-378, and DDB-532 closed with this change, and DDB-253's and DDB-248's screenshot halves with them.
