# Combat bridge: fights from the campaign, results written back (DDB-286, DDB-158)

Date: 2026-10-08. Code: `src/renderer/game/campaign/CombatBridge.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Resources, The driver pool, The drive, A failed run) and [Combat Rules](../specs/Combat%20Rules.md) (Losing vehicles and drivers, Owning escorts). Builds on [campaign-state-model.md](./campaign-state-model.md), [escorts.md](./escorts.md) (decisions 21 and 32), [per-driver-hand-limit.md](./per-driver-hand-limit.md), and [seeded-prng.md](./seeded-prng.md).

## Context

The combat screen dealt both drivers their archetype's starting deck at full HP for every fight, and nothing read the `AfterFight` that `Battle.endCombat` returns. A supply run is a string of fights over one campaign, so something has to build each fight from the campaign and carry each result back to it.

Kevin's rules for what carries (2026-10-08):

1. Scrap, fuel, and loot from a run reach the compound only if the run succeeds. Until then they're the run's cargo, and a failed run loses it.
2. Vehicles carry damage forward between fights.
3. A wrecked driven vehicle limps on: it comes back for the next fight at minimal structure.
4. The Med Truck's heal is capped at max HP.
5. No true death while the partner stands. A driver at 0 HP in a won fight is revived by the partner. True death, and drivers who crashed out going missing, happen only when the run fails.

DDB-158 folds in the crash-out rule (escorts.md decision 21): a driver with no free seat after a wreck is out of the fight but alive, and if the partner wins it, they go back for them.

The run controller (DDB-322) is what calls the bridge, so the bridge is two functions over the campaign, a run party, and the fight: `startCampaignFight` and `writeBackFight`.

## The run party

`RunParty` is what the run controller holds between fights:

- `seats`: the seated drivers' records, Driver 1 first.
- `escorts`: the convoy's escorts that came along. Load out picks up to four and the rest stay home (Game Flow 1.2), and a failed run loses the ones that went.
- `cargo`: what the run has picked up, in the stores' six resources, checked with the campaign's own reader (`readResources`). It starts empty and reaches the stores only when the run controller unloads it at home.

A fight deals each driver's default deck. Run decks aren't part of the party: a run deck needs to know which cards are the driver's own and which were borrowed from the locker, or a death on a failed run destroys cards left at home and leaves borrowed ones in the locker. DDB-315 designs run decks.

Nobody is crashed out between fights. A won fight's write-back picks up anyone who crashed out of it, and a lost one ends the run, so the party never has to say who's crashed out; the write-back's result names who was picked up, revived, killed, or lost.

## Building a fight

`startCampaignFight({ campaign, party, enemyTeam, rng, cards, enemyAI })` returns a `CampaignFight`: the campaign, the started battle, each seat's combat driver, and each seat's own vehicle.

- A seat's combat driver takes their record's name ("Road Warrior 2"), HP, max HP, hand limit, and deck, and everything else (skills, adrenaline, vehicle stats) from `DRIVER_CONFIGS`, since a record keeps only what varies. The deck is a fresh copy of every card in the default deck, built in card-type order, and `Battle.start` shuffles it on the seat's deck stream before the opening deal; the driver's `startingDeck` describes the same cards. A card type with no template throws: `createStartingDeck` warns and skips one, but a campaign's copy skipped at the start of a fight would be gone at its end.
- Each driver drives their own signature vehicle at the structure and armor their record carries (`DriverRecord.vehicle`).
- The run's escorts take the road in the convoy's roster order, whatever order the party lists them in, since roster order settles preferred slots and Rally the Convoy.
- The battle draws from `rng`, which the run controller forks as `run.fork('fight', i)` off a saved fight count (seeded-prng.md). The enemy team is the encounter's, and its AI defaults to aggressive, the combat screen's own.
- A `CampaignFight` is a `PreparedCombat`, with the run's cargo for the top bar, so the combat screen mounts it the way it mounts the gallery's scenes: `ScreenManager.navigate('combatScreen', { prepare: async () => fight })`. The dev fight and Start Run still build their own fights through `DriversCombatMount`.

It throws, building nothing, for a party that doesn't seat two drivers; two drivers of one archetype, named; a record from outside the pool, or one that isn't ready (load out never seats an injured driver, and a status only changes when a run fails or comes home); cargo that isn't whole numbers from 0; an escort that isn't the campaign's, or is still in a fight that wasn't written back; and a card that doesn't exist. `Team` refuses a fifth escort, and `Battle` refuses an encounter the road can't take. Battle plans the whole opening and checks it before moving anyone, so a refused encounter leaves the escorts off the road for the next try.

## Writing a fight back

`writeBackFight({ fight })` reads the ended battle and writes to the campaign the fight was built from. Each seat's driver ends the fight still in it, at 0 HP, or crashed out:

| Driver | Won | Lost, so the run fails |
| --- | --- | --- |
| Still in the fight | HP and vehicle written back | can't happen: a lost fight has nobody in it |
| At 0 HP | revived: REVIVE_HP, deck untouched, vehicle written back | dead: status dead, 0 HP, and no cards, in one `set` |
| Crashed out | picked up: HP and vehicle written back | missing: status missing, HP and vehicle written back, default deck kept |

- **Vehicles.** A seat's vehicle is its own whatever happened to it: wrecked and off the team, carrying on as an escort with nobody at the wheel, or driven by the partner. Its structure and armor go on the driver's record. A wreck limps on at LIMP_STRUCTURE, and since `Vehicle.destroy` empties its armor, it comes back with none. A vehicle that carried on unmanned is never the convoy's: `endCombat` leaves it out of `AfterFight.escorts`, and its driver gets it back.
- **Heals.** The Med Truck's heal lands in `endCombat`, on every driver who fought and is still alive, crashed out or not, so the HP written back already holds it.
- **Cargo.** After a win, the next party's cargo is this one's plus the haulers' fuel and scrap. A lost fight pays nothing, and the result's `cargoLost` is the cargo the run was carrying. The bridge never touches the compound's stores.
- **Escorts.** Wrecked ones leave the convoy, and the rest keep their structure, their armor back to full (`endCombat`). A failed run loses every escort that came along, wrecked or not.

The result is `{ outcome: 'won', party, revived, pickedUp, escortsLost }` or `{ outcome: 'run_failed', party: null, dead, missing, escortsLost, cargoLost }`. A won fight always leaves both seats.

### One order

Everything is worked out and checked first: each record's next state goes through the record's own reader, and the cargo through the stores' reader. Then it's stored in this order:

1. The records, in seat order.
2. The convoy (`Convoy.afterFight`), then the seats of every escort that came along, emptied. `endCombat` leaves seats as they are, and each driver drives their own vehicle into the next fight, so a driver left aboard would be in it twice.

The campaign itself never changes, so it emits nothing. The step's checkpoint saves after the write-back, and has to: until a fight is written back its wrecked escorts are still in the convoy, and `Campaign.toJSON` refuses a convoy holding a wreck.

### Partial writes

A listener can't stop a write-back by throwing, since `EventEmitter.emit` catches and logs whatever a listener throws. A store can still throw part way when a listener changes a later record in between, say kills the second driver when the first one's record changes; that record's `set` then refuses the result. The fight is marked as written before anything is stored, so a write-back started from inside it is refused, and the mark comes off again when a store throws. Every step stores the same thing a second time, so once whatever changed the record is put right, writing the fight back again finishes the job.

### Refusals

It refuses a fight that's still on, a tie, a fight it has already written back, and a result its records no longer fit (a record changed under the fight), storing nothing. A campaign fight has no turn limit, so it ends won or lost; a tie needs a turn limit set by hand, and nothing says what one would mean for a driver who crashed out.

## Provisional calls (pending Kevin)

These unblock the build and aren't settled rules; the specs point here wherever they need one of the values. Each is a small change to flip:

- **A revived driver comes back at 1 HP** (`REVIVE_HP` in `CombatBridge.ts`). The Med Truck's heal doesn't reach them, because `endCombat` heals only drivers above 0 HP and revival happens after it.
- **A wreck limps on at 1 structure** (`LIMP_STRUCTURE` in `CombatBridge.ts`).
- **Driven vehicles carry their armor damage too, while escorts refill theirs every fight**, so a wreck comes back at 0 armor. Escorts' refill is `Battle.endCombat`'s, and covers only the convoy's own escorts.
- **On a run, the combat top bar shows the cargo, not the stores.** It's set once, when the fight mounts, so a dividend shows from the next fight on.
- **The fight log says a driver at 0 HP "is down"**, not "is dead" (`Battle.logDeaths`), since they're only dead if the run fails.

## Options considered

- Picking up a crashed-out driver when the next fight starts, not at the write-back. The party would then carry who's crashed out, and anything between fights (an event, the debrief) would see a driver who's neither seated nor missing. The rule has the partner go back for them once the fight is won, and the Med Truck's heal already counts them as part of the run.
- Fielding the whole convoy on every run. Simpler, but load out couldn't leave an escort at home, and a failed run would lose escorts that never left the compound.
- Keeping the vehicle's damage on the `Vehicle` and carrying the object from fight to fight. The record is what a save holds, so the damage has to be on it anyway, and a vehicle that converted mid-fight has an escort profile that would follow it into the next one.
- An overlay run deck (card counts with no record of where they came from). Dropped until run decks are designed, for the reason in The run party.

## Consequences

- The combat screen navigates to the battle result screen on every `battleEnded`, so it can't hand a campaign fight back to the run. The run controller (DDB-322) adds an end hook to `PreparedCombat`, and calls `writeBackFight` from it.
- Escort signature cards aren't dealt into decks. A copy carries `broughtBy` so it can leave when its escort is lost, and card counts can't; that's for run decks (DDB-315) and escorts joining (DDB-153).
- Coming home isn't a fight. Unloading the cargo, injuring a driver who comes home hurt, and counting `runsCompleted` are the return's, so the bridge never writes injured days.
- The bridge adds nothing to the campaign log. What the log says about a death or a missing driver is the debrief's call.
