# The campaign's end: death, missing drivers, and the compound falling (DDB-305)

Date: 2026-10-09. Code: `src/renderer/game/campaign/CampaignEnd.ts`, with the end itself in `Campaign.ts` (`end`, `tally`, `loseRun`, `returnMissingDriver`), `DayClock.ts` (`endDay`), `DriverRecord.ts`, and `CampaignStore.ts` (`checkpoint`, `save`, `end`), and the thresholds in `src/renderer/game/data/compound-rules.json`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The driver pool, A failed run, Stops) and [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 6.3. Builds on [combat-bridge.md](./combat-bridge.md), [run-decks.md](./run-decks.md), [day-clock.md](./day-clock.md), [injuries.md](./injuries.md), and [campaign-save-and-load.md](./campaign-save-and-load.md).

## Context

A failed run already did most of what death needs: the bridge marks a driver at 0 HP dead and one who crashed out missing, and `loseRun` unwinds the run decks so the dead lose what went with them. Nothing ended a campaign, though. `endDay` reported `abandoned` at 0 People and left the rest to its caller, the compound screen showed a stand-in notice that left the save at 0 People, nothing put a fall in the history, nothing could bring a missing driver back, and the defeat screen (Game Flow 6.3) had nothing to count runs or fights from. This record covers the mechanics; the defeat screen itself is a later step.

## Death is permanent, on the record too

What was there held: dying is one `set` of status, 0 HP, and an empty deck; the dead driver's run deck, their own copies and what they borrowed, is lost when the run is unwound, and what they left at home goes to the locker; a missing driver's run deck unwinds as if they came home. The gap was the record: any `set` could make a dead driver ready again. `DriverRecord.set` now refuses every status but dead once a driver is dead. Storing the same death again still passes, since a write-back that threw part way stores it a second time.

## A missing driver coming back

`Campaign.returnMissingDriver({ driver })` is what the Find: driver stop (DDB-279) calls. The driver is back in the pool, injured for the HP they're missing by the infirmary's own rule (`injuryDays`), or ready at full HP, with their default deck as their run deck left it. Their vehicle comes back at `RETURN_STRUCTURE`, 1, which is Kevin's returning-vehicle rule (DDB-432, entry 15), and keeps the armor the crash left it, 0 for a wreck. It works with a run out, since a Find is found on the road. It refuses a driver who isn't missing (the dead stay dead), one outside the pool, a campaign that's over, and a card move partway through being stored. The record is stored, then the campaign emits `change`, so a screen listening to the campaign hears it.

## When the campaign is lost

Kevin's call (DDB-432, entry 2) is that a loss is the last driver's death or People reaching 0. Each cause is checked by the step that can bring it about, inside that step's own `set`:

- `last_driver`: a failed run (`loseRun`) leaves nobody at the compound, every driver in the pool dead or missing.
- `no_people`: a night (`endDay`) leaves no People, with no run out.

The missing count as lost (Provisional calls). A missing driver only comes back through a Find on a run, and a run needs drivers at the compound, so a pool of only the dead and the missing could never send one again. A pool that never had a driver isn't a lost one, so a campaign built empty, as tests build them, never ends that way.

Nobody dies at the end of a day and nobody leaves on a run, so neither step checks the other's cause. A campaign standing at 0 People (only a test builds one) ends at its next day end.

The end needs the run home first: a campaign that's over has no run decks out. A night that leaves no People while a run is out still reports `abandoned`, and the first day end after the run gets home ends the campaign.

The day stops on the day the compound fell. `loseRun` never turns the day, and the night that empties the compound doesn't either, so `campaign.day` is the day it fell on, which the history's `day` and the defeat screen's days held both read.

## How it fell

`fallOf` reads the stores and unrest after the step (after the night's eating, for a day end), in this order:

1. Starved: food at or below `fall.starveAtFood`, 0.
2. Rioted: unrest at or above `fall.riotAtUnrest`, 10.
3. Disbanded, otherwise.

Hunger comes first because an empty larder is a fact and unrest is a mood; a starving compound with high unrest starved. The spec names food only. A compound emptied by thirst usually riots, since every unit short adds unrest. Both thresholds are starting values in `compound-rules.json`, read as strictly as the rest of the file.

## The end is one checked set, and final

`Campaign.end` is `{ ending, cause }`, or null while the campaign stands. It's stored in the same `set` as the rest of the step (run decks, locker, the tally, the stores), with one log line: "No drivers are left, and the compound starved." The campaign's own reader checks it, as it checks everything: a fall and a cause that exist, no run out, and a cause the state shows (no People, or a pool with nobody at the compound).

Once it's set, nothing changes the campaign. `Campaign.set` throws a `CampaignOverError`, carrying the end, and so does every method that would change the campaign, its records, or its run decks, before it changes anything: `recruitDriver`, `moveCards`, `scrapCards`, `addToLocker`, `addLogEntry`, `startRunDecks`, `resetRunDeck`, `moveEscortCard`, `addEscortCards`, `removeEscortCards`, `unwindRunDecks`, `unloadRun`, `loseRun`, and `returnMissingDriver`. Outside the class, so do `endDay`, `injureOnArrival`, `treatDriver`, `startCampaignFight`, and `writeBackFight`. Driver records and the convoy are models of their own, and their own `set` stays open, as it is for every other campaign rule; nothing in the game reaches them except through those calls.

## Saved, and ended in the store once

The save keeps `end` and `tally`, so the format is version 6 and the fixture is `campaign-v6.json`, a standing campaign with a tally. A campaign that's over saves and loads as it is, and still refuses every change.

The store never writes one as the save, though. A `checkpoint` or `save` of a campaign that's over ends it in the store instead, as `end` does: its line goes into the history and its save is removed. So the checkpoint the screens already make after the step that lost the campaign writes the history line, once, and the main menu has no lost campaign to Continue.

- Every later checkpoint resolves false, and `end` and `save` reject as `retired`, recording nothing.
- A removal that fails part way is owed, and the next checkpoint finishes it with no second line.
- A crash between the line and the removal leaves the save from before the losing step. The next session plays that step again to the same end, and the history's newest-entry check keeps it to one line.
- A save that holds a campaign already over (another tab, or a hand-made save) loads, and its next checkpoint or save ends it.

`CampaignStore.end` records a campaign that's over with its own ending, whatever it's given, so the menu's `abandoned` can't relabel a fall. A campaign still standing ends there as won or abandoned only, since a fall comes from the campaign's state.

The history entry is unchanged (`seed`, `day`, `strongholdsTaken`, `ending`). The bump to version 6 starts every build's history over, as every bump does.

Considered: keeping the lost campaign as the save until the defeat screen closes. Continue would then offer a campaign that can't be played, and a quit on the defeat screen would leave the history without its line. The defeat screen gets the campaign from the step that lost it.

## The defeat screen's numbers

`campaignStats({ campaign })` returns days held, runs (home and failed), fights won and lost, drivers dead and missing, and strongholds taken. Most of it is derived: the day, the pool's statuses, the strongholds taken, and fights lost, since a run fails in the one fight it loses and only then. The rest needed counters, kept in `Campaign.tally`, each only going up:

- `runsHome`, counted by `unloadRun`. The run counter can't give it, since a load out given up uses a run id, and nothing counts a driver's `runsCompleted` yet (the return's job, DDB-322).
- `runsFailed`, counted by `loseRun`. The dead and the missing can't give it, since a driver who's found stops being missing.
- `fightsWon`, counted by `writeBackFight` after a win, as its last stored step, so a write-back that throws earlier leaves the fight uncounted for its second try.

A load refuses a tally that counts more runs ended than run ids handed out, less the run out.

The rest of 6.3 isn't in the campaign. The last fight's damage and turns are the fight's, the explored percentage waits for the map's fog (DDB-275), and unlocks don't exist yet.

## Provisional calls

Kevin's calls applied as decided: a loss is the last driver's death or People reaching 0 (DDB-432, entry 2), and a missing driver who returns comes back with their vehicle at 1 structure (entry 15). These are mine, and each is a line or a value to change:

- The missing count as lost: the campaign is over when nobody is left at the compound, every driver dead or missing, not only once the last one dies. A single driver left at the compound keeps it going, since a lone driver can still go out: a run with one driver at home goes solo, one driven vehicle and the escorts, and a pool at home that shares one archetype may send a same-archetype pair (DDB-432, entry 35; the solo fight is DDB-166).
- People reaching 0 ends the campaign only with no run out. A night at 0 People with a run out waits for the run, and the first night after it's home ends it.
- The night that empties the compound doesn't turn the day: the compound fell on the day that ended.
- It starves at 0 food, riots at 10 unrest, and otherwise disbands, hunger before unrest, and water isn't counted.
- A missing driver who's found is injured for the HP they're missing, from the day they're found, as one coming home from a run is, and keeps the armor the crash left.
- The fall writes one log line, dated the day it fell.

## Consequences

- The defeat screen (this task's second step) replaces the compound screen's fallen notice, and reads `campaign.end` and `campaignStats`. `DayEnd.outcome` can go once the compound screen reads `campaign.isOver` instead.
- The run controller (DDB-322) calls `loseRun`, then `endDay` unless the campaign is over, then checkpoints, which ends a lost campaign in the store.
- The Find: driver stop (DDB-279) calls `returnMissingDriver` for a missing driver it turns up.
- Anything later that drops People (an event) has to end the campaign in its own `set` too, as `endDay` does.
- Winning (DDB-307) adds `won` to the end, with a cause of its own, and a save bump.
