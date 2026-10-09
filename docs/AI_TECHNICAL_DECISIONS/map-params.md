# Map parameters in code (DDB-287)

Date: 2026-10-06, revised 2026-10-07 in DDB-404 and 2026-10-09 for the realistic map's table (DDB-440). Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Map parameters. Follows [compound-and-area-map.md](./compound-and-area-map.md), decision 5, and [realistic-map.md](./realistic-map.md), which changed the table.

## Context

Every stage of the area map generator reads one `MapParams` object, which the Map Lab edits, presets and campaign saves store, and `rollParams` draws for the finished game. The spec gave the parameters with their tuning ranges and defaults, and asked for environment presets, a parameter validator, and `rollParams`. It left open the shape in code, how an environment's defaults and explicit values combine, what a preset file holds, what rolling "around" an environment means, the campaign ranges, the environments' values, and any validator rule past `highways` at least `strongholds` plus 2. The code lives in `src/renderer/game/map/`: `MapParams.ts`, `ParamValidator.ts`, `MapPresets.ts`, and `RollParams.ts`.

## One flat object, one table

`MapParams` is flat (`params.highways`, not `params.network.highways`) and plain JSON, matching how the spec names parameters; the group is a column of the table, not a level of nesting. `MAP_PARAMETERS` gives each parameter its group, kind (int, float, or enum), label, tuning range, step, default, and campaign range, keyed by name in the Map Lab's order. Its type maps over `MapParams`, so a parameter missing from either side fails to compile, and the Map Lab can build every control from it. The environments and the groups are each one list with their labels, and `Environment`, `ENVIRONMENTS`, and `ParamGroup` come from those lists, so the Map Lab's choices and the types can't disagree.

The seed and `stopTables` have no row. The seed is neither tuned by a slider nor rolled. Stop tables are an optional JSON override meaning the shipped tables when absent, and the stops stage owns their shape, so until then the type only promises JSON.

## Environments set defaults, overrides are explicit

`ENVIRONMENT_PRESETS` holds what each environment sets over the table's defaults: world, road network, and dressing parameters, never gameplay ones, so picking a region changes the land and not the balance. Mixed sets nothing, which makes the table's defaults Mixed's.

Every environment's value sits at least a step inside its campaign range. Half an environment's rolls land on each side of its value whatever room that side has (see below), so a value on an end of the range puts half or more of them exactly on the end: with the first values, 88% of Rust Belt maps had 3 broken highways and 72% of Badlands maps had 5 hotspots. A test lists the values allowed on an end, and High Desert's 0 lakes is the only one, since most High Desert maps having no lakes is the point (about two in three). Where a step in would land on the table's default and erase the difference, the campaign range grows a step instead: Rust Belt keeps its 3 broken highways, and their range runs 1 to 4. That tilts the four environments that keep the default of 2 toward 3, with 22% of their rolls on 3 against 12.5% on 1 and none on 4, which is the cost of keeping Rust Belt off the end.

A `MapParamSet` is what a person sets: a seed, an environment, and any parameter values. `resolveMapParams` fills it out and reports where each number came from (the table, the environment, or an override) by presence, so a value set explicitly stays an override even when it equals the environment's and survives a change of environment. The alternative, inferring overrides by comparing values with the environment's defaults, needs no extra state but forgets a deliberate choice that happens to match, and the Map Lab can't tell the two apart.

Those sources describe the set as written, before validation, so a NaN override the validator replaces reads as an override and a default a combination rule moves reads as the default. The Map Lab shows the values generation runs on, so `validateMapParamSet` resolves and validates in one call and marks each value the validator changed as `clamped`, whoever set it.

Resolving needs a known environment: `environmentDefaults` throws a RangeError on any other name, so a typo, or a name the presets object inherits from `Object` such as `constructor`, can't pass for Mixed. The validator on its own still swaps an unknown environment for Mixed and reports it, since it also reads params that came from outside the type.

## Presets hold only overrides

A preset file is a `MapParamSet` as JSON: seed, environment, then the values it overrides in table order, tab-indented. A complete `MapParams` is a preset too, every value an override, so the Map Lab can save a campaign's resolved parameters as one. An unknown key is an error rather than ignored, since a misspelt parameter would otherwise vanish: presets are written by hand or by the Map Lab, so a key the reader doesn't know is a mistake to fix.

Campaign saves don't load through the preset reader. They keep their params whole and load through `repairMapParams` ([campaign-state-model.md](./campaign-state-model.md)), which drops an unknown key with a warning, because the table will lose parameters while the Map Lab settles it and refusing every older save would be worse. The two readers take opposite stances on unknown keys for opposite reasons, and `readMapPreset` has no switch to drop them while nothing that reads presets wants that.

A preset reads back exactly what was written. `readMapPreset` refuses anything JSON can't write back the same, anywhere in a set: NaN and Infinity (JSON parses `1e999` to Infinity), and in the stop tables also undefined, functions, class instances such as a Date, and cycles. It names every problem with its path and the value it found, and `serializeMapPreset` runs the same checks before it writes, so it throws rather than write NaN as null or a Date as a string. `parseMapPreset` reads past a byte order mark and reports bad JSON as an invalid preset.

Reading, resolving, and validating each copy the stop tables with `copyJson` (`core/Json.ts`), so a set never shares them with where it came from. The copy is built from this realm's objects and arrays. `structuredClone` was the first choice, but under Jest it builds its copies in Node's outer realm, which the campaign's plain-object check refuses, so founding on a set with stop tables would fail. It also lets a Date through, which JSON writes as a string, and quietly flattens a class instance. The shipped presets are frozen through; `readMapPreset(preset.params)` gives an editable copy.

Storing every value instead would reproduce a map through any later tuning of the environment, but a loaded preset would show as all overrides and its environment would stop meaning anything. The trade is that a sparse preset follows its environment's tuning. Campaigns aren't affected, since saves keep resolved parameters (decision 3 of the compound record).

## The validator reports, and has two combination rules

`validateMapParams` returns the clamped parameters and a list of clamps (parameter, from, to, reason), which `describeClamp` words for the readout: "highways raised to 6 (strongholds + 2)", "seed wrapped to 5 (uint32)". Past clamping into tuning ranges it rounds whole-number parameters, puts the environment's default in place of a value that isn't a number, swaps an unknown environment for Mixed, and wraps the seed to uint32 the way the PRNG coerces it, so validating a seed never changes the map it makes.

Stop tables aren't clamped: the validator copies them as plain JSON, and anything in them JSON can't hold (NaN, a Date, a cycle) throws, naming its path, since there's no value to put in its place.

Two combinations are clamped. `highways` is raised to `strongholds` plus 2, as the spec says: a stronghold sits where two branches of the route tree meet in its sector's outer band, highways lead the branches, and two more highways than sectors keeps a sector with no seam between branches rare. And `highwaySeparation` is lowered to 360 / `highways`: nine exits can't each sit 60 degrees from the next round the rim, and the tuning ranges allow both. Nothing else in the realistic map's table constrains another parameter. `rivers` 0 is a closed basin, which still has streams by `riverDensity` and can hold reservoirs, and broken highways are only taken where every place stays reachable, which is the roads stage's check, not the validator's.

The first rule leaves two things open (Area Map Generation, open questions). The tuning ranges allow 8 strongholds against at most 9 highways, so the validator lowers `strongholds` to 7 first when that's the only way, a stand-in that keeps a value the slider offers out of reach. And with `strongholds` at least 2, `highways` 3 never survives validation, a notch on its slider that does nothing. Narrowing the tuning ranges would settle both; until that's decided the stand-in stays.

## Rolls split at the environment's value

`rollParams` picks the environment evenly, then draws each number around the environment's value, reaching at most half the campaign range either side and never past the range (`rollBounds`), snapped to the parameter's step on the grid the Map Lab's controls use (`snapToStep`, from the engine's `stepGrid`, which Slider and NumberInput share). The draw is u1 + u2 - 1, a triangle on (-1, 1), with each sign stretched to its own side of the value. Half the draws land below the environment's value and half above, whatever room each side has, each half likeliest at the value and thinning to nothing at its bound, so the value is the median and a short side packs its half in close. That's why environment values keep a step from the ends of their ranges. Two uniforms in plain arithmetic draw the same on every engine.

A triangle across the whole campaign range, peaking at the environment's value, was simpler but gave a High Desert a long tail into wet ground: about one roll in seven above 0.5 aridity. Uniform draws ignored the environment altogether. The cost of bounded reach is a constraint on the table, which a test checks: every campaign end has to be within reach of some environment's value, so a range no environment moves sits evenly round its default.

Every parameter draws on its own fork of the seed's `params` stream, `new Rng({ seed }).fork('params').fork(name)` with the parameter's key, the environment included. One stream drawn in table order was the first draft, but then adding, removing, or reordering a parameter while the Map Lab settles the table, or a player option that pins one parameter and skips its draw, would shift every later parameter's roll for every seed. A fork costs a short hash and 15 warm-up draws, nothing at 34 parameters. The realistic map's table bore that out: every parameter it kept rolls what it did before, and only the new ones and the renamed `dressing`, which draws on a fork of its new name, roll anything new.

That independence holds for each parameter's draw, not for what `rollParams` returns, which is coupled three ways:

- The validator raises `highways` to `strongholds` plus 2 in about one roll in five, so retuning strongholds moves highways. Highway separation would follow highways if the campaign ranges stopped leaving its rule room.
- Every number centres on the environment's value, so retuning an environment's value, or a table default it inherits, moves that parameter's rolls on that environment.
- The environment pick indexes `ENVIRONMENTS`, so adding, removing, or reordering an environment changes which one a seed picks, and with it every number.

Tests pin the draws: the table reversed, or with a parameter dropped, or with one parameter's campaign range changed, rolls every other parameter the same, and one seed's roll is pinned outright. `rollParamsWithClamps` is `rollParams` with the validator's clamps, for the Map Lab's "Roll campaign params" preview to list.

## The realistic map's table

[realistic-map.md](./realistic-map.md) kept the machinery and changed the rows. Four parameters mean something new with the same ranges: `rivers` counts outlets on the land grid's edge (0 a closed basin), `ruggedness` sets how hard ranges lift and how little they're smoothed, `curviness` weights grade in a road's path cost, and `highwaySeparation` spaces exits at the rim. Five are new: `riverDensity`, `villages`, `roadDensity`, `loops`, and `routeSplit`. `brokenHighways` moved from the scenery group to the road network, since collapsed spans now take roads out of the network. `branchiness`, `roadClearance`, `countyRoads`, and `farmTracks` went, along with the outward growth and the scenery county roads they tuned. The scenery group is dressing, and `sceneryDensity` is `dressing`. Values, environments included, are the spec's.

Choices the spec left to the code:

- Labels. `rivers` reads "Main rivers", beside "River density", and `dressing` reads "Amount" under the Dressing heading. New fractions step by 0.05 like the others; `villages` by 1.
- `routeSplit`'s campaign range is the one value 0.5, a balance knob like `routesTarget`, so every roll takes it.
- No new combination rule (above).

Code that the later stages replace still reads the table. Terrain reads nothing whose values moved (`ruggedness` keeps its range, default, and every environment's value), so `Terrain.test`'s pinned samples hold. `planHighways` reads `highwaySeparation` as degrees between departures from the metro, which is near enough to exits at the rim until settlements place exits. Road growth read `branchiness` and `roadClearance`; it now takes them as options of its own (`GrowthTuning`), defaulting to the old table's 0.5 and 24, so its tests and `scripts/road-growth.mjs` can still sweep them, and they go with growth when road links replace it (Map 7). With `branchiness` gone from the environment rows, High Desert and Rust Belt grow at the shared 0.5 instead of their 0.4 and 0.6, so their networks differ from before; Mixed, Floodlands, and Badlands, which kept the default, grow the same roads from the same set. Rolled params no longer vary either knob, so every rolled map grows at 0.5 and 24.

A table change is repaired on load, not a version bump. Saves keep resolved params, but `repairMapParams` exists so the table can move without refusing older saves (campaign-state-model.md), and the save format's shape doesn't change, since its pin reads map params as data. So the version stays where it was, and a campaign saved under the old table loads: the removed keys drop with a warning each, and the new parameters take its environment's values, which a test holds with a Rust Belt save. A renamed parameter isn't carried over, so a saved `sceneryDensity` drops and `dressing` takes its environment's default; nothing reads either yet. Bumping the version would have made every playtester's save outdated and restarted their history for no gain.

## Consequences

- The Map Lab builds its parameter panel from `MAP_PARAMETERS` and `PARAM_GROUPS`, takes params, sources, and clamps from `validateMapParamSet`, words clamps with `describeClamp`, and previews a roll with `rollParamsWithClamps`.
- Every value in the table is a starting value. Tests hold the invariants (defaults and campaign ranges inside tuning ranges, values on the step grid, environment values a step inside their campaign ranges and off the gameplay group, shipped presets valid with no clamps), so tuning can't produce a table the validator or `rollParams` can't honour. Tests also hold the table and the environments to copies of the spec's tables, so a retune changes the spec, the code, and that test together.
- Retuning can move the pinned roll for the default preset's seed (a Floodlands map), so a tuning change updates that test in the same commit. A parameter's campaign range or step, Floodlands' value for it, or a table default Floodlands inherits (towns, say) moves that parameter's value; renaming a parameter moves its value; retuning strongholds can move highways too; a change to how `snapToStep` rounds can move any value; and changing the list of environments can move all of it. Retuning a default the terrain stage reads (radius, metro size, aridity, mountain coverage, ruggedness, contamination, hotspots, or towns, the table's or an environment's) moves `Terrain.test`'s pinned samples too, so the same change re-pins them.
- `stopTables` stays loosely typed until the stops stage defines it.
