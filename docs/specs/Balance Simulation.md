# Balance Simulation

Status: designed 2026-10-17. The tools that say whether runs and fights hit their targets ([Runs and Encounters](./Runs%20and%20Encounters.md), Just hard enough): one deterministic simulation core, a command line tool over it for sweeps and CI, and a browser Balance Lab for trying a change and seeing what it does. It grows out of raider-sim, the fight simulator in [raider-tuning.md](../AI_TECHNICAL_DECISIONS/raider-tuning.md), and takes over from the old evalai.html harness.

## What it answers

- Does the generator make the runs the rules ask for? (`gen`)
- Is each encounter the fight its skulls say it is? (`fights`)
- Does a run come out where its tier's targets say? (`runs`)
- What is each raider worth? (`calibrate`)
- Can a compound keep going? (`campaign`, later)

## The core

The core lives in `src/renderer/game/sim/`, as game code under the same rules:

- Relative imports only, since the build scripts resolve `./` paths, and JSON through imports.
- No DOM, `fetch` or `CardLoader`, localStorage, or `__DEV_TOOLS__`, so the same code runs in Node and in a Web Worker. No `const enum`, which per-file transpiling can't see through.
- It plays everything through the game's own code: `Battle`, the AI controller, the combat bridge (`seatOf`, and the write-back with `REVIVE_HP` and `LIMP_STRUCTURE`, through `seatWriteBack`), the encounter builder, and the run. Never a copy of them, so a rule change reaches the sim without touching it.

Its input is a config, plain data: the crews (archetypes, seat order, decks; one driver, or two of different archetypes, as load out seats them), the raider profiles, the encounter templates, the stop tables, the game stage, the player stand-in, the seed, and runs a cell. Tuning comes in as data rather than being patched into the shipped tables: the encounter builder and `raiderVehicle` take the config's raiders and profiles, and fall back to the shipped ones. A raider's patch merges its skills and vehicle stats and replaces its deck.

Its output is plain JSON: a row per cell with the measures below, and any fight logs asked for.

It's deterministic, and no cell's numbers depend on which other cells were asked for. A `gen` map is its own `rollParams` seed. In `fights` and `runs`, a cell is named by its crew and route, and its stage once there is one (`road_warrior+interceptor:1+2`; a crew asked for twice, on other decks, adds `#` and its place in the crews), and run n of every cell draws from the seed's `fork('run', n)`, its fight f from that run's `fork('fight', f)`. Every cell plays the same fixed list of seeded runs, so two crews, two tunings, or a route fresh and the day after its neighbor's run are compared on the same draws, and a difference between them is the change rather than the luck. The cost is that cells share their luck: a lucky seed lifts every cell a little, so a figure pooled across cells needs more runs than its intervals suggest. The same config and seed give the same JSON in Node and in the browser.

## Measures

For each cell, a crew against an encounter or a crew over a route:

- won (a fight) or home (a run), and for a pair, by who sits in seat 1;
- stalled (still going at the turn cap), broken off, routed;
- HP and structure lost over the runs won, as a share of the crew's maximum;
- won runs where a driver went down;
- turns, over a route's fights;
- injury days the crew brings home;
- raiders killed, and waves seen.

Every rate carries its count and a 90% interval, so a 3-point move on 100 runs isn't read as a change.

## The command line tool

`node scripts/balance-sim.mjs <mode> [options]` transpiles the code it reaches into a temporary folder and runs it in a child process, clear of Jest. The transpile walker is one shared helper, `scripts/transpiled.mjs`, that balance-sim, road-network, terrain-bench, and area-map-bake-bench all use. Cells run in parallel in `worker_threads`, two by default to keep the machine responsive.

### gen

Generates campaign maps (`rollParams` seeds, `--maps` of them), reads every route to every POI the way a run gets it (`routeOffers`), and reports by destination tier:

- stops a route (mean, range, distribution) against the band;
- fights a route, and routes with none;
- stop types, and any placed with no resolver;
- skulls;
- hours out and back, and routes past dark;
- the band and fight-floor shortfalls the stops stage recorded;
- each route's own road (legs no other POI's routes use): its share of the route's stops, and whether the route's floor fights are on it;
- for each POI, its nearest neighbor by shared road, and how many of its stops a run to that neighbor would leave cleared.

It also writes a route corpus (`--corpus <file>`), those maps' routes as JSON with each stop's type and each route's audit, its neighbor's run among it, so `runs` doesn't have to regenerate maps.

A leg's room is the most stops the stops stage could deal it: clear of its ends and junctions, the tight gap apart, by the room math the POI and stops stages share. It also reports the POIs each ring aimed for and seated. A POI's nearest neighbor is the other POI whose routes share the most road with its routes, by length, and its run is whichever of the neighbor's routes clears the most of this route's stops.

### fights

Every crew against every encounter template, at each game stage asked for, with waves, the raider-side rules, and each template's solo size for a lone driver. Prints the matrix and the fairness spreads.

### runs

Every crew over routes from the corpus, each stop in order: fights played, calm stops resolved by a stand-in rule (take every find; at a garage, repair what the scrap buys), damage carried from stop to stop as the combat bridge writes it back. Reports by tier against the per-run targets. Each route runs fresh and again the day after a run to its nearest neighbor, with that run's stops still cleared, so the gap shows whether spacing keeps a neighbor's run from getting too easy.

### calibrate

Fits each raider's nominal threat. It plays random mixes of raiders against the crews, regresses the damage each mix does on what it held, and reports how well the fit holds. It's offline: its output proposes threat values and new templates for a person to check into the data.

### campaign (later)

A pool of four played day by day: one run a day to a tier its stage reaches, clearing POIs and stops as it goes, injuries and the infirmary, rewards taken by a simple rule. Reports how long a compound lasts, how often no legal pair is fit, and how many POIs are left open by day.

### Options

- `--config <file>`: the tuning to try, as JSON. The Balance Lab exports the same format.
- `--seed`, `--runs` (a cell), `--maps` and `--corpus <file>` (for `gen`), `--crews` (`all`, `pairs`, `solo`, or a list like `road_warrior+interceptor,mechanic`), `--routes` (for `fights`: `1,2,1+2`), `--turns` (the stall cap), `--stage`, `--player aggressive|intent`, `--workers` (2).
- `--json <file>`: write the rows.
- `--check`: compare every row with the targets and exit non-zero on a miss, naming it. The fairness spreads are reported and don't fail a check until DDB-492 to 495 land.
- `--log <cell>:<run>`: print one fight's battle log.

## The Balance Lab

A browser page for trying a change and seeing what it does. It takes evalai.html's place and its job, as a new typed page built only into dev builds, from a webpack entry of its own like the gallery, so it never ships.

- Edit: raider profiles, encounter templates and their waves, the game stage, the stop tables, the crews and their decks.
- Run: the core in a Web Worker (the area map's worker pattern), with progress, and cancellable.
- See: the crew by encounter matrix as heat maps of won and of damage, the per-tier run table against its targets, distributions of damage and turns, and a sample fight log.
- Export: the edited tuning as JSON in the `--config` format, to try in the CLI or check into the data.
- Play it: open any encounter in the game's own combat screen, against any crew, to play by hand.

With the Lab in, evalai.html, `src/ai-evaluator.ts`, and their untyped scripts in `public/` retire, which settles DDB-40 for that harness. battle.html retires once the Lab can open an encounter in the combat screen.

## Player stand-ins

- Aggressive, which exists: plays every card it can afford, damage first, and never reads intents. The floor.
- Intent-aware: before each card it reads the raiders' committed plans and the projected board, and picks the play that most cuts the damage coming next enemy turn, or the kill that removes the biggest intent. One step and no search, so it needs no copy of the battle. The ceiling.

Targets are met by the floor. The ceiling shows how much room a good player has.

## Calibration against people

- Every fight in a dev build logs one record: its seed, the crew and their decks, the encounter and stage, the player's actions in order (card, source, target), and the outcome, turns, and damage.
- The sim replays a logged fight exactly from its seed and actions, and plays the same fight with each stand-in.
- The gap between people and the stand-ins on the same fights is how to read the sim's numbers as a person's, and the targets move if the gap says they should.

## Tests

Jest, with `--maxWorkers=2` and no sweeps:

- Generation invariants on a few seeds: every route in its band, its fight floor met, no stop type placed without a resolver.
- The wave rules, close-up, shake-off, rout, and break-off, each on its own.
- One small balance smoke: one crew, one encounter, a fixed seed, its exact outcome.
- The CLI and the Balance Lab's worker give identical JSON for the same config and seed.

CI runs `balance-sim fights --check` on a few seeds and runs, as its own step, when cards, raiders, encounters, or stop tables change.

## Baseline

The first version must reproduce these, and changes are measured against them. Measured on 2026-10-17, on the generator and fights as they stood.

`gen` over 30 campaign maps (`rollParams` seeds 1 to 30), every route. Tier 5 is the strongholds' routes, which no run is offered yet.

| Tier | Routes | Stops a route, mean (range) | Fights a route | Routes with no fight | Empty stops |
|---|---|---|---|---|---|
| 1 | 322 | 2.4 (0-6) | 0.52 | 56% | 78% |
| 2 | 420 | 4.0 (0-10) | 0.95 | 35% | 76% |
| 3 | 529 | 5.2 (0-13) | 1.25 | 26% | 76% |
| 4 | 513 | 7.7 (1-14) | 1.94 | 11% | 75% |
| 5 | 253 | 7.7 (3-15) | 1.94 | 11% | 75% |

Tier 1 fights are always 1 skull. A route's hours out and back averaged 7.1 at tier 1, 11.1 at tier 2, 14.7 at tier 3, and 19.7 at tier 4.

Own road and neighbors on the same maps, as `gen` prints them. A route's own road is its last leg on all but 2 of the 2,037 routes (own is last leg), so its room is that leg's. Floor is the band's fight minimum, half band half its stop minimum rounded up, and room for both the larger of the two.

| Tier | Own share | Floor on own | Half band on own | Room for both | Last leg, no room | Neighbor clears | Neighbor takes every fight |
|---|---|---|---|---|---|---|---|
| 1 | 27% | 13% | 15% | 39% | 42% | 64% | 64% |
| 2 | 23% | 18% | 28% | 46% | 37% | 67% | 63% |
| 3 | 14% | 3% | 22% | 48% | 33% | 78% | 71% |
| 4 | 26% | 12% | 34% | 62% | 16% | 64% | 43% |
| 5 | 27% | 17% | 37% | 62% | 20% | 64% | 40% |

The last column is over routes with a fight. Every POI shares road with another.

`fights`, as `node scripts/balance-sim.mjs fights --runs 100 --routes 1,2,3,1+1,1+2 --crews pairs` (seed 1, the aggressive AI on both sides). Lost and turns are over the runs won.

| Crew | Route | Won | By seat | Stalled | HP lost | Structure lost | Turns |
|---|---|---|---|---|---|---|---|
| RW + Int | 1 | 100% | 100/100 | 0% | 16% | 8% | 1.7 |
| RW + Int | 2 | 71% | 100/42 | 0% | 60% | 40% | 3.9 |
| RW + Int | 3 | 50% | 100/0 | 0% | 53% | 24% | 3.6 |
| RW + Int | 1+1 | 100% | 100/100 | 0% | 30% | 17% | 3.7 |
| RW + Int | 1+2 | 56% | 98/14 | 0% | 68% | 56% | 6.0 |
| RW + Mech | 1 | 100% | 100/100 | 0% | 1% | 0% | 3.4 |
| RW + Mech | 2 | 99% | 100/98 | 0% | 1% | 0% | 8.4 |
| RW + Mech | 3 | 0% | 0/0 | 97% | - | - | - |
| RW + Mech | 1+1 | 100% | 100/100 | 0% | 2% | 1% | 6.8 |
| RW + Mech | 1+2 | 98% | 100/96 | 0% | 1% | 0% | 11.6 |
| Int + Mech | 1 | 100% | 100/100 | 0% | 1% | 1% | 2.2 |
| Int + Mech | 2 | 98% | 98/98 | 0% | 1% | 1% | 5.2 |
| Int + Mech | 3 | 99% | 98/100 | 1% | 2% | 1% | 4.2 |
| Int + Mech | 1+1 | 100% | 100/100 | 0% | 2% | 1% | 4.4 |
| Int + Mech | 1+2 | 98% | 100/96 | 0% | 1% | 1% | 7.4 |

A first look at groups, with the raiders retuned by hand (60 runs a cell, a pack of light Rust Buggies at 10 structure, 0 armor, 10 HP, refill 2, all on the road at once): against 4, RW + Int won 95% losing 34% of its HP in 2.8 turns, Int + Mech 100% losing 2%, and RW + Mech stalled 95%. Against 6, RW + Int won 48% (97/0 by seat), Int + Mech 98%, and RW + Mech stalled. The stun lock, the Rig's reach, and seat order are what the raider-side rules in Runs and Encounters answer.
