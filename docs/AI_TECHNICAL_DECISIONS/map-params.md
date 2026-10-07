# Map parameters in code (DDB-287)

Date: 2026-10-06. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Map parameters. Follows [compound-and-area-map.md](./compound-and-area-map.md), decision 5.

## Context

Every stage of the area map generator reads one `MapParams` object, which the Map Lab edits, presets and campaign saves store, and `rollParams` draws for the finished game. The spec gave the parameters with their tuning ranges and defaults, and asked for environment presets, a parameter validator, and `rollParams`. It left open the shape in code, how an environment's defaults and explicit values combine, what a preset file holds, what rolling "around" an environment means, the campaign ranges, the environments' values, and any validator rule past `highways` at least `strongholds` plus 2. The code lives in `src/renderer/game/map/`: `MapParams.ts`, `ParamValidator.ts`, `MapPresets.ts`, and `RollParams.ts`.

## One flat object, one table

`MapParams` is flat (`params.highways`, not `params.network.highways`) and plain JSON, matching how the spec names parameters; the group is a column of the table, not a level of nesting. `MAP_PARAMETERS` gives each parameter its group, kind (int, float, or enum), label, tuning range, step, default, and campaign range, keyed by name in the Map Lab's order. Its type maps over `MapParams`, so a parameter missing from either side fails to compile, and the Map Lab can build every control from it.

The seed and `stopTables` have no row. The seed is neither tuned by a slider nor rolled. Stop tables are an optional JSON override meaning the shipped tables when absent, and the stops stage owns their shape, so until then the type only promises JSON.

## Environments set defaults, overrides are explicit

`ENVIRONMENT_PRESETS` holds what each environment sets over the table's defaults: world, drivable network, and scenery parameters, never gameplay ones, so picking a region changes the land and not the balance. Mixed sets nothing, which makes the table's defaults Mixed's.

A `MapParamSet` is what a person sets: a seed, an environment, and any parameter values. `resolveMapParams` fills it out and reports where each number came from (the table, the environment, or an override) by presence, so a value set explicitly stays an override even when it equals the environment's and survives a change of environment. The alternative, inferring overrides by comparing values with the environment's defaults, needs no extra state but forgets a deliberate choice that happens to match, and the Map Lab can't tell the two apart.

## Presets hold only overrides

A preset file is a `MapParamSet` as JSON: seed, environment, then the values it overrides in table order, tab-indented. A complete `MapParams` is a preset too, every value an override, so one reader takes a hand-written preset or a campaign's resolved parameters. An unknown key is an error rather than ignored, since a misspelt parameter would otherwise vanish.

Storing every value instead would reproduce a map through any later tuning of the environment, but a loaded preset would show as all overrides and its environment would stop meaning anything. The trade is that a sparse preset follows its environment's tuning. Campaigns aren't affected, since saves keep resolved parameters (decision 3 of the compound record).

## The validator reports, and has two combination rules

`validateMapParams` returns the clamped parameters and a list of clamps (parameter, from, to, reason), which `describeClamp` words for the readout. Past clamping into tuning ranges it rounds whole-number parameters, puts the environment's default in place of a value that isn't a number, swaps an unknown environment for Mixed, and wraps the seed to uint32 the way the PRNG coerces it, so validating a seed never changes the map it makes.

Two combinations are clamped. `highways` is raised to `strongholds` plus 2, as the spec says, and since the spec's ranges allow 8 strongholds against at most 9 highways, `strongholds` comes down to 7 first when that's the only way. And `highwaySeparation` is lowered to 360 / `highways`: nine departures can't each sit 60 degrees from the next, and the tuning ranges allow both.

## Rolls are triangles round the environment

`rollParams` picks the environment evenly, then draws each number from a triangle that peaks at the environment's value and reaches at most half the campaign range either side, snapped to the parameter's step so a roll reads like a slider value. Two uniforms make the triangle with plain arithmetic, the same on every engine.

A triangle across the whole campaign range, peaking at the environment's value, was simpler but gave a High Desert a long tail into wet ground: about one roll in seven above 0.5 aridity. Uniform draws ignored the environment altogether. The cost of bounded reach is a constraint on the table, which a test checks: every campaign end has to be within reach of some environment's value, so a range no environment moves sits evenly round its default.

Every parameter draws on its own fork of the seed's `params` stream, `new Rng({ seed }).fork('params').fork(name)` with the parameter's key, the environment included. One stream drawn in table order was the first draft, but then adding, removing, or reordering a parameter while the Map Lab settles the table, or a player option that pins one parameter and skips its draw, would shift every later parameter's roll for every seed. A fork costs a short hash and 15 warm-up draws, nothing at 33 parameters. Tests pin it: the table reversed, or with a parameter dropped, or with one parameter's campaign range changed, rolls every other parameter the same, and one seed's roll is pinned outright.

## Consequences

- The Map Lab builds its parameter panel from `MAP_PARAMETERS` and `PARAM_GROUPS`, marks values with `resolveMapParams`' sources, and lists clamps with `describeClamp`.
- Every value in the table is a starting value. Tests hold the invariants (defaults and campaign ranges inside tuning ranges, values on the step grid, environments inside campaign ranges and off the gameplay group, shipped presets valid with no clamps), so tuning can't produce a table the validator or `rollParams` can't honour.
- Retuning a campaign range, or Floodlands' values, can move the pinned roll for the default preset's seed (a Floodlands map), so a tuning change updates that test in the same commit. Only the retuned parameter's value moves.
- `stopTables` stays loosely typed until the stops stage defines it.
