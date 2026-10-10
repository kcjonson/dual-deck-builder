# Combat bridge: fights from the campaign, results written back (DDB-286, DDB-158)

Date: 2026-10-08, revised the same day for escort ids and write-backs in progress (DDB-403), and 2026-10-09 for run decks (DDB-315). Code: `src/renderer/game/campaign/CombatBridge.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Resources, The driver pool, The drive, A failed run) and [Combat Rules](../specs/Combat%20Rules.md) (Losing vehicles and drivers, Owning escorts). Builds on [campaign-state-model.md](./campaign-state-model.md), [escorts.md](./escorts.md) (decisions 21 and 32), [per-driver-hand-limit.md](./per-driver-hand-limit.md), and [seeded-prng.md](./seeded-prng.md).

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

- `seats`: the seated drivers' records, Driver 1 first: two, or one for a run down to its last driver ([solo-driver-fights.md](./solo-driver-fights.md)).
- `escorts`: the convoy's escorts that came along. Load out picks up to four and the rest stay home (Game Flow 1.2), and a failed run loses the ones that went.
- `cargo`: what the run has picked up, in the stores' six resources, checked with the campaign's own reader (`readResources`). It starts empty and reaches the stores only when the run controller unloads it at home.
- `cargoCards`: the cards won on the run, cargo too (Provisional calls), added with `addCardsWon` and bound for the locker ([cards-won.md](./cards-won.md)).
- `run`: the id of the run it set off on, `Campaign.currentRun` once load out has started the run decks. A fight refuses a party from another run than the one out, and so does the run's end, so a party left over from an earlier run with the same two seats can't fight this one or bring its cargo home twice. The bridge hands it on in every party it returns, and in a failed run's result.

The party holds models, which the bridge checks by identity against the campaign's pool and convoy. A save between fights holds it by id instead: each seat's `driver-<n>` and each escort's `escort-<n>`, which stay the same through every fight and every load, and which a load finds again in the pool and the convoy ([campaign-state-model.md](./campaign-state-model.md), Escort ids come from the convoy's saved counter).

A fight deals each seat their run deck, which the campaign holds and saves (`Campaign.runDecks`), not the party: load out starts them and the run controller unwinds them when the run ends ([run-decks.md](./run-decks.md)). A run deck knows which cards are the driver's own, which they left at home, and which they borrowed, so a death on a failed run loses what went with the driver and nothing else.

Nobody is crashed out between fights. A won fight's write-back picks up anyone who crashed out of it, and a lost one ends the run, so the party never has to say who's crashed out; the write-back's result names who was picked up, revived, killed, or lost.

## Building a fight

`startCampaignFight({ campaign, party, enemyTeam, rng, cards, enemyAI })` returns a `CampaignFight`: the campaign, the started battle, each seat's combat driver, and each seat's own vehicle.

- A seat's combat driver takes their record's name ("Road Warrior 2"), HP, max HP, and hand limit, and everything else (skills, adrenaline, vehicle stats) from `DRIVER_CONFIGS`, since a record keeps only what varies. The deck is a fresh copy of every card in their run deck: their own and borrowed copies in card-type order, then each escort card, its copy carrying the `broughtBy` of the escort that brought it. `Battle.start` shuffles it on the seat's deck stream before the opening deal, and the driver's `startingDeck` describes the same cards. A card type with no template throws: `createStartingDeck` warns and skips one, but a campaign's copy skipped at the start of a fight would be gone at its end.
- Each driver drives their own signature vehicle at the structure and armor their record carries (`DriverRecord.vehicle`), clamped to the archetype's maximums as they stand. The record checks only that structure is at least 1 and armor at least 0, so a retune that lowers a maximum leaves old saves loading, and the next write-back stores the clamped values.
- The run's escorts take the road in the convoy's roster order, whatever order the party lists them in, since roster order settles preferred slots and Rally the Convoy.
- The battle draws from `rng`, which the run controller forks as `run.fork('fight', i)` off a saved fight count (seeded-prng.md). The enemy team is the encounter's, and its AI defaults to aggressive, the combat screen's own.
- A `CampaignFight` is a `PreparedCombat`, with the run's cargo for the top bar, so the combat screen mounts it the way it mounts the gallery's scenes: `ScreenManager.navigate('combatScreen', { prepare: async () => fight })`. The dev fight and Start Run still build their own fights through `DriversCombatMount`.

It throws, building nothing, while the campaign's last fight hasn't been written back (the bridge keeps each campaign's open fight from its start to its write-back) or is partway through being written back (Partial writes, below), while the campaign is storing records (`Campaign.isStoring`: a record's listener partway through a card move, or a run starting or ending), and for a party that doesn't seat one or two drivers; a record from outside the pool, or one that isn't ready (load out never seats an injured driver, and on the road only a failed run changes a status), seat by seat; then, with two seats, one driver in both, or two drivers of one archetype, named; cargo that isn't whole numbers from 0; an escort that isn't the campaign's; a seat with no run deck, a run deck holding the card of an escort that isn't in the party, since that escort isn't on the road to carry the order out, a party that doesn't seat every driver on the run out and nobody else (a party short a seat could win fights that `unloadRun` and `loseRun` would then refuse forever), or an escort in the party whose card no run deck holds; a party from another run than the one out; and a card that doesn't exist. `Team` refuses a fifth escort, and `Battle` refuses an encounter the road can't take. Battle plans the whole opening and checks it before moving anyone, so a refused encounter leaves the escorts off the road for the next try. The seat refusals are load out's own check, `getSeatBlocker`, asked of each seat alone before the pair, so a seat's own reason wins over the pairing's ([injuries.md](./injuries.md)). `hasOpenFight` (`OpenFights.ts`, beside the registry only the bridge writes) says whether a fight is open or partway through its write-back, so nobody comes home, and no run ends, in the middle of one.

## Writing a fight back

`writeBackFight({ fight })` reads the ended battle and writes to the campaign the fight was built from. Each seat's driver ends the fight still in it, at 0 HP, or crashed out:

| Driver | Won | Lost, so the run fails |
| --- | --- | --- |
| Still in the fight | HP and vehicle written back | can't happen: a lost fight has nobody in it |
| At 0 HP | revived: REVIVE_HP, run deck untouched, vehicle written back | dead: status dead, 0 HP, and an empty default deck, in one `set` |
| Crashed out | picked up: HP and vehicle written back | missing: status missing, HP and vehicle written back |

A seat's default deck is in their run deck while the run is out, so the dead's is already empty. Run decks outlive the write-back: unwinding them when the run ends (`Campaign.loseRun`, for a failed run) is where the dead lose what went with them, and the missing get their cards back ([run-decks.md](./run-decks.md)).

- **Vehicles.** A seat's vehicle is its own whatever happened to it: wrecked and off the team, carrying on as an escort with nobody at the wheel, or driven by the partner. Its structure and armor go on the driver's record. A wreck limps on at LIMP_STRUCTURE, and since `Vehicle.destroy` empties its armor, it comes back with none. A vehicle that carried on unmanned is never the convoy's: `endCombat` leaves it out of `AfterFight.escorts`, and its driver gets it back.
- **Heals.** The Med Truck's heal lands in `endCombat`, on every driver who fought and is still alive, crashed out or not, so the HP written back already holds it.
- **Cargo.** After a win, the next party's cargo is this one's plus the haulers' fuel and scrap, and its cards won go on as they were. A lost fight pays nothing, and the result's `cargoLost` and `cargoCardsLost` are what the run was carrying. The bridge never touches the compound's stores or the locker.
- **Escorts.** Wrecked ones leave the convoy, and the cards they brought leave the run decks; the rest keep their structure, their armor back to full (`endCombat`). A failed run loses every escort that came along, wrecked or not.

The result is `{ outcome: 'won', party, revived, pickedUp, escortsLost }` or `{ outcome: 'run_failed', party: null, dead, missing, escortsLost, cargoLost, cargoCardsLost, run }`. A won fight always leaves every seat it started with.

### One order

Everything is worked out and checked first: each record's next state goes through the record's own reader, and the cargo through the stores' reader. Then it's stored in this order:

1. The records, in seat order.
2. The run decks, without the cards the lost escorts brought (`Campaign.removeEscortCards`), before the convoy lets those escorts go, so the campaign never holds a card from an escort that isn't in the convoy.
3. The convoy (`Convoy.afterFight`), then the seats of every escort that came along, emptied. `endCombat` leaves seats as they are, and each driver drives their own vehicle into the next fight, so a driver left aboard would be in it twice.

The campaign changes only when a lost escort's card leaves a run deck, and emits a `change` then. The step's checkpoint saves after the write-back, and has to: until a fight is written back its wrecked escorts are still in the convoy, and `Campaign.toSaveText` refuses a convoy holding a wreck.

### Partial writes

A listener can't stop a write-back by throwing, since `EventEmitter.emit` catches and logs whatever a listener throws. A store can still throw part way when a listener changes a later record in between, say kills the second driver when the first one's record changes; that record's `set` then refuses the result. The fight stops being the campaign's open fight before anything is stored, so a write-back started from inside it is refused, and it's open again when a store throws. Every step stores the same thing a second time, so once whatever changed the record is put right, writing the fight back again finishes the job.

Closing the fight first would let a listener start the next one partway through, on one record written back and the other not, with the wreck still in the convoy. So the bridge also keeps a set of the campaigns storing a write-back, as `Campaign.moveCards` keeps the ones storing a move, and `startCampaignFight` refuses a campaign in it. When a store throws, the fight is open again, so the next fight waits for the write-back to finish either way.

### Refusals

It refuses a fight that's still on, a tie, a fight it has already written back, and a result its records no longer fit (a record changed under the fight), storing nothing. A campaign fight has no turn limit, so it ends won or lost; a tie needs a turn limit set by hand, and nothing says what one would mean for a driver who crashed out.

## Provisional calls

These unblock the build and aren't settled rules; the specs point here wherever they need one of them. Each is a small change to flip:

- **A revived driver comes back at 1 HP** (`REVIVE_HP` in `CombatBridge.ts`). The Med Truck's heal doesn't reach them, because `endCombat` heals only drivers above 0 HP and revival happens after it.
- **A wreck limps on at 1 structure** (`LIMP_STRUCTURE` in `CombatBridge.ts`).
- **Driven vehicles carry their armor damage too, while escorts refill theirs every fight**, so a wreck comes back at 0 armor. Escorts' refill is `Battle.endCombat`'s, and covers only the convoy's own escorts.
- **On a run, the combat top bar shows the cargo, not the stores.** It's set once, when the fight mounts, so a dividend shows from the next fight on.
- **The fight log says a player's driver at 0 HP "is down"**, not "is dead" (`Battle.logDeaths`), since they're only dead if the run fails. A raider's driver still "is dead": theirs is final.
- **Cards won count as loot** under the cargo rule: they ride home as cargo, go to the locker when it's unloaded, and a failed run loses them. The party holds them as `cargoCards`: `addCardsWon` adds them, the bridge passes them on after a win and reports them as `cargoCardsLost` when the run fails, and `Campaign.unloadRun` puts them in the locker when the run gets home ([cards-won.md](./cards-won.md)). They never go in a run deck.

## Options considered

- Picking up a crashed-out driver when the next fight starts, not at the write-back. The party would then carry who's crashed out, and anything between fights (an event, the debrief) would see a driver who's neither seated nor missing. The rule has the partner go back for them once the fight is won, and the Med Truck's heal already counts them as part of the run.
- Fielding the whole convoy on every run. Simpler, but load out couldn't leave an escort at home, and a failed run would lose escorts that never left the compound.
- Keeping the vehicle's damage on the `Vehicle` and carrying the object from fight to fight. The record is what a save holds, so the damage has to be on it anyway, and a vehicle that converted mid-fight has an escort profile that would follow it into the next one.
- An overlay run deck (card counts with no record of where they came from). Dropped, for the reason in The run party; [run-decks.md](./run-decks.md) has the run decks built instead.

## Consequences

- The combat screen navigates to the battle result screen on every `battleEnded`, so it can't hand a campaign fight back to the run. The run controller (DDB-322) adds an end hook to `PreparedCombat`, and calls `writeBackFight` from it.
- Escort signature cards are dealt from the run decks, each copy carrying `broughtBy`, its escort's `escort-<n>`, so it leaves the fight's decks when its escort is lost, and the write-back takes the run deck's card out too. The id outlives a load, so a run deck saved between fights keeps the card as its type and `broughtBy`, and the loaded escort still takes it out when it's lost. An escort joining mid-run (DDB-153) brings its card in with `Campaign.addEscortCards`.
- The run controller (DDB-322) holds the `RunParty` and saves it with the run, as ids (The run party), its cargo, cards won, and the escorts that came along included, since a save between fights has to come back to the same run. It settles the run when it ends, after the last write-back: `Campaign.unloadRun` when it gets home, which unwinds the run decks and unloads the cargo, and `Campaign.loseRun` when it fails, which unwinds them and loses it ([cards-won.md](./cards-won.md)).
- Coming home isn't a fight. Unloading the cargo, injuring a driver who comes home hurt, and counting `runsCompleted` are the return's, so the bridge never writes injured days.
- The bridge adds nothing to the campaign log. What the log says about a death or a missing driver is the debrief's call.
