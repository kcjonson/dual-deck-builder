# The day clock and the end of a day (DDB-302)

Date: 2026-10-08. Code: `src/renderer/game/campaign/DayClock.ts` and `CompoundRules.ts`, with the rules in `src/renderer/game/data/compound-rules.json`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Hours on the road, days at home; The driver pool; POIs; Fog of war), [Area Map Generation](../specs/Area%20Map%20Generation.md) (What changes after generation). Builds on [campaign-state-model.md](./campaign-state-model.md) and [campaign-founding.md](./campaign-founding.md).

## Context

The campaign holds a day, the stores, People, and unrest, and founding sets day 1 at dawn, but nothing turned the day or ate the stores. A day ends when a run gets home, when the compound rests without one, and when a scavenging party goes out on foot (DDB-303). Each time the compound eats, a shortfall costs people and raises unrest, injured drivers heal, and the map's stops and POIs come back over time. The compound screen's needs panel (DDB-301) also wants a forecast: "Food runs out in 6 days".

`Campaign.ts` and `DriverRecord.ts` are being changed by save and load and by the combat bridge at the same time, so this works through their public API only: getters and the checked `set`.

## Options

Where the day end lives:

- A method on `Campaign`, beside `recruitDriver` and `moveCards`. That's where model rules go, but the day end reaches past the campaign's own fields (driver records, the map's hooks, a rules file), and the file is mid-change in two branches. Not now; since it only uses `set` and getters, moving it in later is mechanical.
- A `DayClock` object holding the campaign, rules, and hooks. It would have no state of its own: the day is on the campaign and saved there, and with one run a day there's no hour to keep.
- Module functions with named params, as founding is (chosen): `endDay({ campaign, rules?, hooks? })` and `forecastNeeds({ resources, rules? })`.

How stop cooldowns and POI refills plug in:

- Hooks that change the campaign themselves. A hook failing after upkeep was stored leaves a half-ended day, and each hook's `set` is another `change`.
- A registry the exploration epic registers into: global mutable state, and tests would have to reset it.
- Pure map steps (chosen): `({ campaign, map }) => map`, given the campaign's state at dusk and the map so far. The state is a frozen snapshot from `getState()` without its map, not the live `Campaign`, so a step can't `set` anything through it, and POI refills see the map stop cooldowns returned. Stop state and POI stock are map state (Area Map Generation, What changes after generation), so the map is all they return. `DAY_END_HOOKS` is the default, the way `CAMPAIGN_START` is founding's, and holds two no-ops until the map keeps that state; tests pass their own.

## Decision

`endDay` runs, in order:

0. A haul, when the caller brings one (a scavenging party's), comes into the stores at dusk, and its line goes in the log ([scavenging-party.md](./scavenging-party.md)).
1. Upkeep: food and water for the People there at dusk, each People over the people one unit feeds, rounded up.
2. Shortfalls: the compound eats what there is, and each unit it couldn't cover costs people (never more than it has) and raises unrest.
3. Healing: each injured driver is a day closer to fit, and one who gets there is ready at full HP.
4. Stop cooldowns, then POI refills.
5. The day turns, and a short day gets a log line dated the day it happened: "Ran short of 1 food and 2 water; 3 people lost."

Everything is worked out and checked before anything is stored: the hooks' maps with the save's reader, the stores with the haul in with the save's resource reader, and the next day and unrest with the integer reader the campaign's own check uses. So a hook that throws or returns something a save can't hold, or a haul, day, or unrest past a safe integer, changes nothing. Then the healed records are stored, and the campaign last, in one `set` that carries the haul too, so its `change` comes once the day end is whole, as with a card move. The log is read after the records are stored, so a line a record's listener adds while a driver heals stays in. Saving stays with the caller's checkpoint after the step.

It returns a frozen `DayEnd`: the day that ended, the upkeep, the shortfall, people lost, unrest gained, the drivers healed, and an `outcome`, `abandoned` whenever People is 0 at dawn and `continues` otherwise.

`forecastNeeds` gives food and water each a stock, a daily upkeep, `days` (how many more day ends the stock covers in full, if People holds and nothing comes in), and `shortTonight`. `days` is 0 when tonight is already short and null when nobody's there to eat. People only changes on a short night, so the forecast is exact up to the first shortage: the first short night is the one after the smaller `days`, which the tests check against `endDay` itself.

The rules are in `data/compound-rules.json`, a sibling of `campaign-start.json`: these hold for the whole campaign rather than starting it. Its reader is as strict as the start's, with ceilings far past any tuning (100 people a unit feeds, 100 people or unrest a unit short costs) so a slip in the file fails as it loads. The infirmary's values ([injuries.md](./injuries.md)) and the scavenging party's ranges ([scavenging-party.md](./scavenging-party.md)) sit beside these.

| Value | Start | Why |
| --- | --- | --- |
| `upkeep.peoplePerUnit.food`, `.water` | 4 | the spec's 1 of each per 4 people |
| `shortfall.peopleLostPerUnit` | 1 | a provisional call, below |
| `shortfall.unrestPerUnit` | 1 | a provisional call, below |

Nothing here draws randomness. A later step that needs a draw forks a stream per day end from the seed and the day, `new Rng({ seed }).fork('day', day)`: the day is already a saved counter that never repeats, so it needs nothing new in the save. A hook rerolling a stop forks the stop's own stream from its saved roll count ([seeded-prng.md](./seeded-prng.md)).

## Provisional calls

Each is a value or a line or two to change.

- One run a day (DDB-327). A run's return ends the day, so the compound between runs is always at dawn. Two runs in a day's light would have the run controller skip `endDay` while there's light for another; the day end itself wouldn't change, though the compound would then need an hour on the campaign.
- People reaching 0 loses the campaign (DDB-308). `endDay` reports `outcome: 'abandoned'`; ending the campaign is DDB-305's. It reports it on every day end at 0 People, not just the first, so a caller can't miss it, and an empty compound eats nothing.
- A shortfall costs 1 person and 1 unrest per unit short, counting food and water separately and adding them. Short 1 food and 2 water costs 3 people and 3 unrest. Counting the larger of the two instead (the same people go hungry and thirsty) is one line.
- Upkeep counts People at dusk, before the night's losses, and the compound eats what's there before counting what's short.
- Unrest only rises. Nothing in the spec lowers it, so nothing here does; cooling on a fed day would be one rule value and one line.
- Healing takes a day off `injuredDays` per day end, and a driver who reaches 0 is ready at full HP. A ready driver below max HP isn't touched: only the injured are in the infirmary. Meds (DDB-304) take days off through the same step ([injuries.md](./injuries.md)).
- A short day writes one log line, dated the day that ended. A fed day, a rest, and healing write none.

## Consequences

- The compound screen's Rest calls `endDay` then checkpoints, and its needs panel reads `forecastNeeds`. The scavenging party hands its haul to `endDay`, which stores it in the day end's own `set`. The run controller's arrival can hand over the cargo the same way, so a run's haul feeds that night and lands with the day end or not at all, then checkpoints.
- DDB-305 acts on `abandoned`. The last driver's death is its own check, since nobody dies at the end of a day.
- The exploration epic replaces the no-ops in `DAY_END_HOOKS`. The stop cooldown (5 days) and POI refill (20 days) are its values to keep with the map's.
- The save format doesn't change: a day end writes only fields the campaign already has.
