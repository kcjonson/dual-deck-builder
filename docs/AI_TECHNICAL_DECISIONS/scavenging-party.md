# The scavenging party (DDB-303)

Date: 2026-10-09. Code: `src/renderer/game/campaign/Scavenging.ts`, the `haul` option on `endDay` in `DayClock.ts`, and the ranges in `src/renderer/game/data/compound-rules.json`. Spec: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Never stuck; Hours on the road, days at home; Resources). Builds on [day-clock.md](./day-clock.md) and [seeded-prng.md](./seeded-prng.md).

## Context

Routes are paid in fuel at departure, so a compound that has burned its fuel, with no scrap to trade for more, could never send another run. The spec's answer is a party on foot: it costs a day, brings back a little fuel and scrap, and has no fight, and it's always there. It has to end the day the way Rest does (upkeep, shortfalls, healing, the map's hooks) and put its haul in the stores with no moment where one is stored and the other isn't.

## Options

Where the haul goes in:

- A `set` adding the haul, then `endDay`. Two sets and two `change`s, and a day end that throws after the haul landed (a hook, a day past a safe integer) leaves the fuel in the stores and the day unturned: a free haul that the next press repeats.
- `endDay`, then a `set` adding the haul. The same gap the other way round.
- A `haul` option on `endDay` (chosen): `{ resources, message }`, checked with everything else before anything is stored, and stored with its log line in the day end's one `set`. A run's cargo can come in the same way.

When it lands against upkeep:

- At dusk, before the compound eats (chosen). The party gets home the way a run does, and a run's cargo feeds the night it comes home ([day-clock.md](./day-clock.md)). It's the kinder order. Since the haul is fuel and scrap and upkeep eats food and water, it changes no numbers today; it shows in the dusk state the map's steps see, and it would matter if a haul ever brought food or water.
- After upkeep. Nothing gains from a haul that can't feed the night it came.

Who has to be there:

- A ready driver. The spec sends the party on foot, which reads as settlers, and an injured pool would have to wait out the infirmary before it could get fuel.
- At least one person (chosen). People 0 is the fallen compound, so this is available in every state where the compound still stands, which is what the guarantee needs.

The stream is `new Rng({ seed }).fork('scavenge', day)`, off the campaign's root. A party ends its day, so there's one a day, and the day is a saved counter that never repeats: every party has a stream of its own and the save keeps nothing new. Fuel draws first, then scrap, one `int` each, and a golden pins the first six days of one seed at `RNG_VERSION` 1. day-clock.md plans `fork('day', day)` for night steps that draw; the party's roll is the day's action, not a night step, so it has its own name and moves none of those.

## Decision

- `scavenge({ campaign, rules?, hooks? })` checks `getScavengeBlocker`, rolls the haul from the day's stream, and calls `endDay` with it and the line "A scavenging party brought back 2 fuel and 15 scrap." It returns the haul and the `DayEnd`, frozen. Saving is the caller's checkpoint after it, as with Rest.
- `getScavengeBlocker` refuses only People 0, as `{ reason: 'abandoned' }`, and `scavenge` throws it as a `ScavengeRuleError`, changing nothing.
- `rollScavengeHaul({ seed, day, rules? })` is pure, so the screen or a test can ask what a day would bring.
- `endDay`'s `haul` adds to the stores at dusk. Each amount has to be a whole number from 0, for a resource the campaign keeps, and no sum can pass a safe integer; all of that is checked before anyone heals. Its log line is dated the day that ended, ahead of any shortfall line, since the party was home before the compound ate.

| Value | Start | Why |
| --- | --- | --- |
| `scavenging.fuel` | 1 to 2 | a little: the founding 10 fuel is "a few runs", so a run's worth takes a few days on foot |
| `scavenging.scrap` | 5 to 15 | a little: one to three locker cards' scrap (`scrapPerCard` is 5), against the founding 150 |

The reader holds fuel's min at 1 or more, so every party brings fuel and the file can't be tuned into a soft-lock. Its ceilings are 100 fuel and 1,000 scrap, and a range's min can't pass its max.

## The guarantee

- A party can go whenever People is above 0. Nothing about drivers, stores, meds, or unrest refuses it.
- Every party brings at least 1 fuel, and a night eats only food and water, so a compound fed for d days has at least d more fuel after d parties.
- It can't save a starving compound. With no food or water People shrinks every night, and the compound can fall before it has a run's fuel; that's the campaign lost, not stuck.
- Route costs aren't set, so the tests take 5 fuel, half the founding stores, as a run's. A founded compound with no fuel and no scrap gets there inside the week its food lasts. A sweep of 300 seeds and stranded states (1 to 200 people, stores from empty to a month's, any day and unrest, drivers ready, injured, dead, or missing) finds a party available every day People is above 0, adding its fuel and scrap and nothing else; every compound fed for the days it needs reaches that fuel with nobody lost, and every one that fell is refused.

## Provisional calls

Each is a value or a line or two to change.

- The haul lands at dusk, before upkeep.
- Settlers go, not drivers: the party needs People 1 or more and nothing else. Injured, dead, or missing drivers don't stop it.
- The haul is 1 to 2 fuel and 5 to 15 scrap, flat: it doesn't scale with People, the day, or unrest.
- A party carries no risk. Nobody is lost or hurt, and it never comes home empty; the spec rules out a fight and says nothing of other risks.
- The only refusal is People 0. A run being out isn't checked, any more than Rest checks it: both are compound steps between runs.
- The log line names what came back, and leaves out scrap tuned to 0: "A scavenging party brought back 1 fuel."

## Consequences

- The compound screen's Scavenge sits beside Rest with the same end-then-checkpoint shape ([compound-screen.md](./compound-screen.md)).
- When routes have fuel costs, the tests' stand-in becomes the cheapest tier-1 route's, and the fuel range gets tuned against it.
- The save format doesn't change: the haul goes into stores the campaign already keeps, and the stream is named by the day.
