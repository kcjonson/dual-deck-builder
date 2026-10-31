# Testing

We test for actual regressions. The art is prototype and changes all the
time, so nothing is protected pixel for pixel: no golden images, no
screenshot baselines, and no pixel comparisons, in CI or locally. Decided
2026-10-30. Salal's `docs/testing/README.md` covers the engine's side.

| Layer | Where | When |
|---|---|---|
| Unit tests | gtest, `*.test.cpp` beside the code, `ctest --preset windows` | while iterating, and CI |
| Slow unit tests | gtest, `*.slow.test.cpp` beside the code: whole map pipelines and anything over half a second, `ctest --preset windows-slow` | after changing map generation, and before merging map work |
| Launch smoke | the game opened on every scene through the dev server | after changing startup, loading or a scene's mount |
| Happy-path scripts | `docs/testing/happy-path/*.md` | before every commit that touches what they cover |
| Perf | the dev server's `/api/metrics`, and salal's perf suite | before committing rendering or hot-path changes |

The TypeScript proof of concept keeps its own checks, run from `_legacy/`:
`cd _legacy`, then `npm test`, `npm run test:slow`, `npm run test:smoke`, or
`node scripts/perf-capture.mjs`.

## Happy-path scripts

Test scripts written for a human, one file per flow (start a run, a battle,
the shop, rewards). Each is a numbered list, one line a step: what to do, then
what you should see. As short as they can be. A feature that lands adds its
lines; a feature that goes removes them.

Before committing, the relevant scripts are run as a manual regression pass:
one cheap subagent (Haiku-class) per script, playing the build through salal's
dev server (`/api/ui/screenshot`, `tree`, `lint`, `input`, `control`) with
judgement and fuzzy matching the way a human tester would, and reporting each
step as pass or fail with a screenshot of anything that failed.

## Layout lint and tree

Helpers for building screens, not tests. While building or checking a
screen, call the dev server's `/api/ui/lint` (the layout invariants: overlaps,
children outside parents, off-screen nodes, zero sizes, overflowing text,
unreachable controls) and read bounds from `/api/ui/tree` rather than judging
coordinates by eye. On demand only; never in CI.

## Launch smoke

Switches to every scene through `/api/control` and fails on any error log. It
checks that things run, not how they look; it never compares images.

## Performance

Strict. A rendering or hot-path change reads `/api/metrics` (CPU and GPU frame
time, draw calls) on the same scenes from its build and from `main`, on the
same machine. When the frame rate drops following a salal bump, run salal's
perf suite at the old and new engine tags on the same machine: if the engine's
numbers moved, file it in salal; if not, it's the game.

## Unit tests

Bounded: before adding a test, look for one covering the same path, and merge
duplicates when touching a suite. Determinism and replay tests compare data,
never pixels.
