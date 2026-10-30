# Port plan

How Wasteland Wheels goes from the TypeScript proof of concept in `_legacy/` to the C++ early alpha on salal. Written 2026-10-30, against salal `v0.19.0`.

## What the port is

A rebuild, not a translation. The concept proved the game was worth making; nobody outside has played it, so nothing about it has to survive except what's good.

- No compatibility of any kind: saves, settings, save format and generator versions, and RNG streams all start fresh, with no migrations.
- The alpha can differ. Where the concept's code is awkward, write what it should have been. Where a rule changes, the spec or decision record changes in the same PR.
- The TypeScript is a reference for how something worked. Read it and its tests; don't match its output.
- No pixel diffing or golden images, here or in the TypeScript.

## What there is to port

TypeScript source and test lines under `_legacy/src/renderer/game/`:

| area | source | tests | depends on |
|---|---|---|---|
| core (the pure files: card and driver loading, JSON, models, settings) | 1,300 | 1,500 | salal's `Rng` replaces `Rng.ts` |
| data (cards, encounters, events, factions, POIs, routes, stops, rules) | 100, plus 13 JSON files | 200 | core |
| map (area map generation) | 15,100 | 8,500 | core, data |
| mechanics and ai (cards, decks, drivers, vehicles, the battle, the road grid, intents, the AIs) | 11,700 | 14,500 | each other, core |
| campaign (state, saves, the day, runs, stops, the compound) | 8,200 | 10,800 | all of the above |
| sim (the balance simulation) | 900 | 140 | all of the above |
| screens and game ui | 34,700 | 18,900 | salal's `ui` |

Everything but the last row is the game's rules and runs headless on `salal::foundation`, so it ports now, alongside salal's phase 3. The screens wait for salal's `ui`.

## Order

1. **Sim foundations** (`libs/sim/core`, `libs/sim/data`). Card, driver and vehicle definitions, JSON loading on nlohmann-json, and the game's data files moved to a root `data/` folder that the C++ owns from then on (the TypeScript keeps its own copies). Named streams from salal's `foundation::Rng` and `fork`. The placeholder `Sim.cpp` goes.
2. **Two tracks at once**, each in its own worktree:
   - **Map generation** (`libs/sim/map`): the pipeline stage by stage, params and terrain, erosion and water, places, roads, routes and POIs, stops, dressing, one PR a stage or two. Area Map Generation and the map's decision records are the spec.
   - **Combat** (`libs/sim/mechanics`, `libs/sim/ai`): cards, decks and hands, drivers and vehicles, the road grid and movement, the battle and its turn, intents, escorts, raider waves, then the AIs. Combat Rules and Card System Design are the spec.
3. **Campaign** (`libs/sim/campaign`), once both tracks are in: the campaign model and its JSON, founding, the day clock, the compound, supply runs and stops, the combat bridge. The sim produces the state; writing it to a save slot is the game app's job through salal's `app`, since the sim can't depend on it. The save format starts at version 1.
4. **Balance sim** (`apps/balance-sim`): the command line tool over the sim, for tuning. Balance Simulation is the spec.
5. **Presentation** (`apps/<game>`): the screens as salal scenes, the game ui on salal's `ui`, the area map view and the battle screen. Starts when salal's phase 3 has its controls and popups in (ui-plan PRs 13 and 14). Needs the UI art decision below first.
6. **Cutover**: playtest builds from the C++ game, then `_legacy/` is deleted whole.

Each step is PRs of a size someone can review in a sitting, each building, passing `ctest`, and formatted. Tests come with the code they test: port a TypeScript test when what it pins is still what the alpha wants, and write a new one when the alpha changes the rule.

## Decisions for Kevin

- **UI art.** UI Art Direction and the ui-art-atlas record build the playtest look from a raster atlas with nine-sliced paper and stroke icons. salal's `ui-design.md` decided against raster images, nine-slice and stroke icons. One of them has to give before step 5.
- **The game's executable and folder name**, for step 5: `apps/wasteland-wheels` or something else.
- **Playtest distribution.** The playtest-distribution spec moves playtesting to downloadable builds before the port lands, by way of the Electron build. With the TypeScript frozen and CI off, it may be simpler to go straight to C++ builds at cutover.
