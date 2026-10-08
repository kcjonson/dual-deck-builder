# Combat bridge: fights from the campaign, results written back (DDB-286, DDB-158)

Date: 2026-10-08. Code: `src/renderer/game/campaign/CombatBridge.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The driver pool, Decks and the locker, The drive, A failed run) and [Combat Rules](../specs/Combat%20Rules.md) (Losing vehicles and drivers, Owning escorts). Builds on [campaign-state-model.md](./campaign-state-model.md), [escorts.md](./escorts.md) (decisions 21, 32, and 33), [per-driver-hand-limit.md](./per-driver-hand-limit.md), and [seeded-prng.md](./seeded-prng.md).

## Context

The combat screen dealt both drivers their archetype's starting deck at full HP for every fight, and nothing read the `AfterFight` that `Battle.endCombat` returns. A supply run is a string of fights over one campaign: HP carries from fight to fight, the dead stay dead, escorts keep their damage, and haulers pay out. Something has to build each fight from the campaign and write each result back.

DDB-158 folds in the crash-out rule (escorts.md decision 21). A driver with no free seat after a wreck is out of the fight but alive; if the partner wins it, they go back for them, and both go on with the run. If nobody is left in the fight the run fails, and a driver who crashed out alive is missing.

The run controller (DDB-322) doesn't exist yet, so the bridge is two functions, `startCampaignFight` and `writeBackFight`, over the campaign, a run party, and the fight.

## The run party

`RunParty` is what the run controller will hold between fights: the seats, Driver 1 first, each a `DriverRecord` and an optional run deck, and the convoy's escorts that came along.

- A run deck is card counts. A seat without one fights from the record's default deck, which is what every run takes until load out builds run decks (DDB-315).
- The escorts are listed because load out picks them: up to four go and the rest stay home (Game Flow 1.2), and a failed run loses the ones that went.
- Nobody is crashed out between fights. A won fight's write-back picks up anyone who crashed out of it, and a lost fight ends the run, so the party never has to say who's crashed out; the write-back's result names who was picked up and who went missing.
- The run's fight count, which names each fight's stream, and its route and cargo are the run controller's.

## Building a fight

`startCampaignFight({ campaign, party, enemyTeam, rng, cards, enemyAI })` returns a `CampaignFight`: the battle, started, and each seat's combat driver.

- A seat's combat driver takes their record's name, HP, max HP, and hand limit, and everything else (skills, adrenaline, vehicle) from `DRIVER_CONFIGS`, since a record keeps only what varies. The name is the record's, "Road Warrior 2", which is what the campaign calls them (Compound and Supply Runs, open question 9).
- The deck is a fresh copy of every card in the run deck, in card-type order. No fight shuffles a deck before its opening draw yet; that's DDB-411. A card type with no template throws. `createStartingDeck` warns and skips one, but a campaign's copy skipped at the start of a fight would be gone at its end.
- Each driver drives their own signature vehicle, built whole for every fight, as the combat screen has always built it. Only escorts carry damage between fights. A record has no vehicle to carry, and whether it should is open question 4.
- The run's escorts take the road in the convoy's roster order, whatever order the party lists them in, since roster order settles preferred slots and Rally the Convoy.
- The battle draws from `rng`, which the run controller forks as `run.fork('fight', i)` off a saved fight count (seeded-prng.md). The enemy team is the encounter's, and its AI defaults to aggressive, the combat screen's own.
- A `CampaignFight` is a `PreparedCombat`, with the compound's scrap and fuel for the top bar, so the combat screen mounts it the way it mounts the gallery's scenes: `ScreenManager.navigate('combatScreen', { prepare: async () => fight })`. The run controller loads the cards first (`CardLoader.getAllCardsAsMap`) and listens for the battle's end itself. The dev fight and Start Run still build their own fights through `DriversCombatMount`.

It throws, building nothing, for a party that doesn't seat two drivers; two drivers of one archetype; a record from outside the pool, or one that isn't ready (load out never seats an injured driver, and nothing changes a status mid-run); an escort that isn't the campaign's, or is still in a fight that wasn't written back; a card that doesn't exist; and a fifth escort, which `Team` refuses.

## Writing a fight back

`writeBackFight({ campaign, fight })` reads the ended battle. Each seat's driver is still in the fight, dead, or crashed out, and their record follows:

| Driver | Won | Lost, so the run fails |
| --- | --- | --- |
| Still in the fight | HP written back | can't happen: a lost fight has nobody in it |
| Dead | status dead, 0 HP, and no cards, in one `set` | the same |
| Crashed out | picked up, HP written back | missing, keeping their HP and their default deck |

The HP written back after a win includes the Med Truck's heal, which `endCombat` lands on every driver who fought, the crashed out too (decision 32). After a win the run goes on with every living seat and the escorts still with it: the ones that came along and survived, then any driven vehicle that carried on unmanned (decision 33). A lost fight fails the run. There's no next party, and every escort that came along is lost with it, wrecked or not (Compound and Supply Runs, A failed run). Cargo isn't in the campaign, so losing it is the run controller's.

### One order

Everything is worked out and checked first: each record's next state goes through the record's own reader, and the dividends are added up. Then it's stored in this order:

1. The records, in seat order.
2. The convoy: `Convoy.afterFight` with the battle's result, or, on a failed run, a result that loses every escort that came along. Then every escort going on has its passenger seat emptied. `endCombat` leaves seats as they are, and each driver drives their own vehicle into the next fight, so a driver left aboard would be in it twice.
3. The stores: the haulers' fuel and scrap, in one `Campaign.set`.

Records and escorts emit on their own models, not the campaign's (campaign-state-model.md), so the campaign's own `change` comes last, once the records and the convoy hold the fight; a card move stores decks before the locker for the same reason. Nothing makes the three steps atomic. A listener that throws partway leaves what was stored before it, and atomic writes across models are filed separately. Saving is the caller's, a checkpoint at the end of the step.

Fuel and scrap go straight into the stores rather than the cargo, like a fight's rewards (Compound and Supply Runs, The drive), so a failed run never takes back what an earlier fight paid. `Battle` pays only after a win.

It refuses a fight that's still on, a tie, and a fight it has already written back. A campaign fight has no turn limit, so it ends won or lost; a tie needs a turn limit set by hand, and nothing says what one would mean for a driver who crashed out. A second write-back would pay the dividends twice, so the fight is marked as written before anything is stored.

## Options considered

- Picking up a crashed-out driver when the next fight starts, not at the write-back. The party would then carry who's crashed out, and anything between fights (an event, the debrief) would see a driver who's neither seated nor missing. The rule has the partner go back for them once the fight is won, and the Med Truck's heal already counts them as part of the run.
- Fielding the whole convoy on every run. Simpler, but load out couldn't leave an escort at home, and a failed run would lose escorts that never left the compound.
- Carrying a driven vehicle's damage between fights. That needs somewhere in the campaign to keep the vehicle, and an answer to open question 4; building it whole is what every fight has done so far.

## Consequences

- A run down to one driver can't start a fight. A player team has exactly two driven vehicles, and the dock a half for each. What the survivor does is Compound and Supply Runs, open question 10.
- A won fight can leave a run with five escorts. The run controller has one dismissed (`Convoy.dismiss`) and taken out of the party before the next fight.
- Escort signature cards aren't dealt into run decks. A copy carries `broughtBy` so it can leave when its escort is lost, and card counts don't; that's for run decks (DDB-315) and escorts joining (DDB-153).
- Coming home isn't a fight. Injuring a driver who comes home hurt, unwinding run decks, and counting `runsCompleted` are the return's, so the bridge never writes injured days.
- The bridge adds nothing to the campaign log. What the log says about a death or a missing driver is the debrief's call.
