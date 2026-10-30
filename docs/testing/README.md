# Testing

We test for actual regressions. The art is prototype and changes all the
time, so nothing is protected pixel for pixel: no golden images and no
screenshot diffs, in CI or locally. Decided 2026-10-30, the same strategy as
salal's (`salal/docs/testing/README.md`), which this game moves onto with its
C++ port.

| Layer | Where | When |
|---|---|---|
| Unit tests | Jest (`npm test`, `npm run test:slow`) | while iterating, and CI |
| Boot smoke | `tests/smoke/` (`npm run test:smoke`) | after changing boot, loading or a screen's mount |
| Happy-path scripts | `docs/testing/happy-path/*.md` | before every commit that touches what they cover |
| Perf capture | `scripts/perf-capture.mjs`, `perf-results/` | before committing rendering or hot-path changes |

## Happy-path scripts

Test scripts written for a human, one file per flow (start a run, a battle,
the shop, rewards). Each is a numbered list, one line a step: what to do, then
what you should see. As short as they can be. A feature that lands adds its
lines; a feature that goes removes them.

Before committing, the relevant scripts are run as a manual regression pass:
one cheap subagent (Haiku-class) per script, playing the build with judgement
and fuzzy matching the way a human tester would, and reporting each step as
pass or fail with a screenshot of anything that failed.

## Layout lint and tree

Helpers for building screens, not tests. While building or checking a
screen, call `window.__ui.lint()` (the layout invariants: overlaps, children
outside parents, off-screen nodes, zero sizes, overflowing text, unreachable
controls) and read bounds from the tree snapshot rather than judging
coordinates by eye. On the C++ port these become salal's `/api/ui/lint` and
`/api/ui/tree`. On demand only; never in CI.

## Boot smoke

Opens every screen and fails on a console error. It checks that things run,
not how they look; it never compares images.

## Performance

Strict. Capture with `perf-capture.mjs` and compare against `main` with
`--compare`. After the C++ port, when the frame rate drops following a salal
bump, run salal's perf suite at the old and new engine tags on the same
machine: if the engine's numbers moved, file it in salal; if not, it's the
game.

## Unit tests

Bounded: before adding a test, look for one covering the same path, and merge
duplicates when touching a suite. Determinism and replay tests compare data,
never pixels.
