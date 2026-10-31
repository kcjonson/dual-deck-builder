# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**Wasteland Wheels** is a roguelike deckbuilder with vehicular combat in a
post-apocalyptic setting: the player drives two vehicles at once, each with its
own driver and deck (the "Symbiotic Driver System"). The repo is still named
dual-deck-builder.

It started as a TypeScript proof of concept that nobody outside has played. That
version is frozen in [`_legacy/`](_legacy/), and the game is being rebuilt in
C++20 on salal (`../salal`, github.com/kcjonson/salal), Kevin's 2D engine, as
the **early alpha**. All game development is halted until the port is done.

The alpha owes the concept nothing:

- **No compatibility of any kind.** No TypeScript saves, settings, save format
  versions, generator versions or RNG streams carry over, and there are no
  migrations. The C++ game starts fresh.
- **Things don't have to stay the same.** Keep what worked, fix what didn't,
  simplify where the concept grew awkward. The specs and decision records in
  `docs/` say what the game should be; change them when the alpha changes it.
- **The TypeScript is a reference, not an oracle.** Read it to see how something
  worked. Don't match its output, its draw order or its quirks.
- **No pixel diffing, golden images or screenshot baselines.**

The port plan is [docs/technical/port-plan.md](docs/technical/port-plan.md).

## Project management: Specboard

Work is tracked in Specboard over the Specboard MCP. `.mcp.json` binds the repo
to its project, so never ask which one, and never write the project name or
UUID into any other committed file, commit message or PR body.

- Work, status and progress live on the board, never in the repo: no task lists,
  status sections, progress logs or changelogs, and no "done in DDB-x" notes in
  specs. Record what you did, decided or are waiting on as a `note` on the item.
- Specs live in git, items on the board. A planning session ends in an epic with
  a linked spec under `docs/`, not code.
- **Specs** (`docs/specs/`) say what to build and why. Keep them current when the
  design changes; don't annotate them with what has been built.
- **Decision records** (`docs/AI_TECHNICAL_DECISIONS/`), one file per significant
  decision: context, options, the decision and why, the trade-offs. Add the new
  one to its README's index.
- **Provisional gameplay calls** (a design question decided for now so work
  isn't blocked) go in `docs/gameplay-calls.md`, numbered, one a line as "the item
  that made it: the call, because why", and in the decision record. Never in a
  spec, never on the board. Kevin approves or changes them there.
- Branch names follow `<type>/DDB-123-title` when the item is obvious, a short
  descriptive name otherwise. Personal preferences are in the claude-config
  repo's `specboard.md`.

## Layout

```
CMakeLists.txt, CMakePresets.json, vcpkg.json   the C++ build (salal's arrangement)
cmake/            build helpers (ddb_add_tests)
libs/
  rules/          the game's rules: fight state, effects, packs, map, campaign; salal::foundation only
  ai/             the policies opponents and the player stand-ins play with, and whole fights played by them, over the rules only
  scripting/      the Lua host for packs, over the rules (once needed)
packs/            content: base/ is the game, expansions and mods are packs too
apps/             executables, once there is one: the game, and the balance sim
docs/             specs, decision records, design art, the port plan
scripts/          Node tooling (format.mjs)
_legacy/          the TypeScript proof of concept, frozen, with its own CLAUDE.md
```

`libs/rules` is organised by area, `core/`, `packs/`, `map/`, `battle/`,
`campaign/`, and included as `<rules/map/RoadNetwork.h>`. The screens and game
ui come after salal's phase 3 lands its `ui`, in `apps/` beside the rules, as
worldsim's `apps/world-sim/scenes/` are. How the rules, the AI, and packs fit
together is `docs/AI_TECHNICAL_DECISIONS/rules-ai-and-packs.md`; read it before
touching the fight state, effects, or an opponent.

## Hard rules

**The dependency rule** (salal's `docs/architecture.md`). `libs/rules` depends
on `salal::foundation` and nothing above it: no renderer, no ui, no app, no GL,
and no Lua. That keeps it deterministic and testable headless.
`ddb_check_layering()` in the root `CMakeLists.txt` fails the configure if it
slips. The AI, scripting, and presentation depend on the rules, never the
other way.

**One place interprets effects.** `apply(state, action)` is it. A preview, a
projection, or an AI estimate runs `apply` on a copy of the fight; it never
re-reads effect fields with its own switch.

**Engine work belongs in salal.** If the game needs something generic from the
engine, it's salal work on salal's board, not a workaround here. salal is pinned
to a tag; bump it deliberately.

**Do not touch `_legacy/`** beyond keeping it runnable. No features, no fixes.
It's deleted once the alpha replaces it.

**Fail loud.** An assert or `LOG_ERROR` beats a quiet default, a swallowed error
or a fallback that hides a broken state.

## Conventions

Worldsim's and salal's, so code reads the same across the three repos.
**`../worldsim/docs/technical/cpp-coding-standards.md` is the source of truth**
and overrides whatever existing code does.

| Thing | Style |
|---|---|
| Classes, structs, enums | `PascalCase` |
| Functions and methods | `camelCase` |
| Variables and members | `camelCase`, no prefix |
| Constants | `k` prefix |
| Namespaces | lowercase: `rules`, `ai` |
| Files | `PascalCase.h` and `.cpp` side by side, `#pragma once`, tests as `Name.test.cpp` beside them |

Tabs, width 4, column limit 140, braces attached, designated initializers where
a call takes several parameters. Prefer stack allocation and smart pointers
over raw; structured logging with categories, `LOG_DEBUG` through `LOG_ERROR`.
Worldsim says "scene", not "screen", in code.

**Clean code, no legacy** (worldsim's rule). When you replace something, delete
what it replaced in the same commit. No flags for old paths, no fallbacks, no
functions kept for reference, no version suffixes, no TODOs about removing old
code. `_legacy/` is the one exception, and it goes whole.

**Formatting and lint.** `.clang-format` and `.clang-tidy` are worldsim's.
`node scripts/format.mjs` checks every C++ file with clang-format 21 (the
version worldsim and salal check with), and `--fix` rewrites them; run it before
committing. clang-tidy runs through clangd off `build/compile_commands.json`,
which the presets export.

**Scripts and tooling** are Node (ESM, `.mjs`, no dependencies unless there's a
`package.json` for them). No Python.

## Build and test

salal's arrangement: CMake 3.25+ with vcpkg (`VCPKG_ROOT` set), Ninja on macOS
and Linux, Ninja Multi-Config with MSVC on Windows, ccache in front of both.

```
cmake --preset windows        # or: cmake --preset default -DCMAKE_BUILD_TYPE=Debug
cmake --build --preset windows
ctest --preset windows        # the fast lane; or: ctest --preset default
ctest --preset windows-slow   # the slow lane; or: ctest --preset default-slow
```

Configure from a shell with the MSVC environment (`cl` on PATH plus `INCLUDE`
and `LIB`; worldsim's `scripts/setup-msvc-env.ps1` persists them), not a Visual
Studio developer shell: that repoints `VCPKG_ROOT` at the bundled vcpkg, and the
configure refuses it. salal comes through FetchContent at the tag in
`CMakeLists.txt`; to build against the sibling checkout, configure with
`-DFETCHCONTENT_SOURCE_DIR_SALAL=C:/Users/kevin/Code/salal`.

Tests are gtest, in two lanes, the way the TypeScript split `npm test` from
`npm run test:slow`. `ddb_add_tests` builds a library's `*.test.cpp` into
`ddb_<lib>_tests`, the fast lane, and its `*.slow.test.cpp` into
`ddb_<lib>_slow_tests`, labelled `slow`: the tests that run the whole map
pipeline or otherwise take half a second or more, which go in a
`Name.slow.test.cpp` beside the fast file. CTest can't leave a label out by
default, so the lanes are test presets: `ctest --preset windows` skips the slow
lane and takes about 10 s in Debug, `ctest --preset windows-slow` runs only it,
and a bare `ctest --test-dir build -C Debug` runs both (`-LE slow` and `-L slow`
pick a lane there too). Run the slow lane when you change map generation, and
before merging map work. Test real logic, keep tests bounded, and look for one
covering the same path before adding another. Port a TypeScript test only when
the behaviour it pins is still what the alpha wants.

## Merging

GitHub Actions are off. The merge bar is local: the build, both test lanes
(the slow one for map work) and `node scripts/format.mjs` pass. Open PRs as drafts, describe the change and how
it was checked, and commit as Kevin would, with no AI attribution.

## Debugging

`/debug <issue>` runs the formal protocol in
[docs/technical/debugging-strategy.md](docs/technical/debugging-strategy.md):
scouts, ranked hypotheses, one at a time, nothing fixed until Kevin confirms,
tracked in the Specboard bug's notes.

## The TypeScript version

`_legacy/` builds and tests as it always did, from inside it:
`cd _legacy && npm ci && npm test`. `node _legacy/scripts/balance-sim.mjs`
runs from the repo root. Its `CLAUDE.md` describes it, and its docs are in
`_legacy/docs/`.
