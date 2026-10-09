# Cards won: cargo on the road, the locker at home, the debrief (DDB-316)

Date: 2026-10-09. Code: `src/renderer/game/campaign/CardsWon.ts` (`addCardsWon`, `getDebrief`), `Campaign.ts` (`unloadRun`, `loseRun`, `addToLocker`), `DeckRules.ts` (`readCardCatalogue`, `readNewCards`), and `OpenFights.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Resources; Buildings; Decks and the locker, After the run; The drive; Return; A failed run) and [Card System Design](../specs/Card%20System%20Design.md) (1.3, signature cards). Builds on [combat-bridge.md](./combat-bridge.md), [run-decks.md](./run-decks.md), [locker-and-deck-rules.md](./locker-and-deck-rules.md), and [campaign-state-model.md](./campaign-state-model.md).

## Context

The bridge carried `RunParty.cargoCards` from fight to fight and reported them as `cargoCardsLost` when a run failed, but nothing put a card in, and nothing took one out at home. Kevin's rule is that what a run brings back is cargo until it gets home, and a failed run loses it; counting the cards it wins as loot is the bridge's provisional call. The reward screen (DDB-259), the run controller (DDB-322), and the garage (DDB-44) each need something to call, and the debrief needs to know who can take each card.

## On the road

`addCardsWon({ party, cardsWon })` returns the party with the cards added to its `cargoCards`, leaving the party it was given as it was, the way the bridge's write-back hands on a new party. A fight's reward, a Find: cards stop, and a roadside garage's sale all call it with card counts. The campaign doesn't change: cards won aren't the compound's until the run is home, and they never go in a run deck, so a later fight on the run doesn't deal them.

## New copies are checked against cards.json

A card coming into the compound, won or bought, has to be one cards.json lists, and not an escort's signature card, which comes with its escort and is never the compound's (Card System Design 1.3; [campaign-founding.md](./campaign-founding.md)). `readNewCards` checks both and throws a RangeError naming the card. A bad card here is the caller's bug, not a disabled button, so there's no blocker.

It reads the bundled cards.json, as eligibility already did, now as one catalogue: `readCardCatalogue` gives each card's name (for the log), the archetype it's marked for, and the escort it's the signature of, in place of the archetype map. The reason is [locker-and-deck-rules.md](./locker-and-deck-rules.md)'s: the campaign checks synchronously, and `CardLoader` loads asynchronously. Rejected: the bridge's own card map passed in, which would make `addToLocker` the one campaign method that needs a lookup handed to it.

Copies the compound already holds, cargo included, are still checked for shape only. A card cards.json drops after it was won still comes home, as a save holding one still loads; refusing it at the unload would leave a run that can never get home.

## Arrival: one call unwinds, then unloads

`campaign.unloadRun({ party })` is a run that got home. It unwinds the run decks exactly as `unwindRunDecks` does, then puts the cargo's resources in the stores and the cards won in the locker, and returns what it unloaded (`{ resources, cards }`) for the debrief. Every copy is then in exactly one place, and `cardsOwned` is up by the cards won.

Everything is checked first. Then the records are stored, in seat order, each getting their default deck back, and the campaign last, in one `set` of its run decks, locker, and stores, so its `change` comes once the run is home. The run controller checkpoints after it, as after any step ([campaign-save-and-load.md](./campaign-save-and-load.md)).

One call rather than `unwindRunDecks` followed by an unload, because:

- The run decks going is what stops a second unload. Once a run is unloaded no run is out, so another unload is refused whatever party it's handed: the same object, a copy, or one rebuilt from ids after a load. An unload of its own would have only the party object's identity to go on, and a copy or a load gets past that.
- The debrief needs the run's drivers home. A seated driver's default deck is in their run deck, and the Crew screen's move refuses it (`on_run`) until it's unwound, so unwinding has to come first; one call can't be ordered wrong.
- Campaign listeners hear one change, with the decks back and the cargo in.

It refuses, changing nothing, while a card move is being stored or a fight is open or being written back (below), with no run out, for a party whose seats aren't the run decks' drivers in seat order, for a seat who's dead or missing (only a failed run leaves one), and for cargo that isn't whole numbers or card counts. An injured seat is fine, since the infirmary's `injureOnArrival` can come first.

`unwindRunDecks` stays for a load out given up, where there's no cargo.

## A failed run

`campaign.loseRun({ result })` takes the bridge's `FailedRun`. It unwinds the run decks as `unwindRunDecks` does, the dead losing what went with them, and the cargo is lost: none of it reaches the stores or the locker. In the same `set` it logs what was lost, "Cargo lost with the run: 2 fuel, 30 scrap, and Headshot.", or nothing when the run carried nothing. It refuses unless the result's dead and missing are the run decks' drivers and every one of them is dead or missing. After it no run is out, so the party the run set off with can't be unloaded either, and `unloadRun` refuses that party before it too, since its seats are dead or missing.

The log line covers the cargo only. What it says about the dead and the missing is still the debrief's call (combat-bridge.md).

## Nothing settles while a fight is open

Unloading partway through a fight would put the cargo in the stores before the fight decides whether the run fails, and a death written back after the unwinding would empty a default deck it had just given back. So `unloadRun`, `loseRun`, and `unwindRunDecks` refuse while `hasOpenFight`, as `injureOnArrival` does, and a listener partway through a write-back is refused the same way.

The registry (`openFights`, `storingWriteBacks`, `hasOpenFight`) moved from `CombatBridge.ts` to `OpenFights.ts`, which imports only types, so `Campaign.ts` can ask without a runtime import cycle (the bridge imports the campaign). Only the bridge writes to it.

## The debrief

`getDebrief({ campaign, cardsWon })` lists each card won, in card-type order, with the copies left to offer and every driver in the pool, each with the reason one copy can't go from the locker to their default deck now, or null if it can. The reason is `getCardMoveBlocker`'s own for that move: `driver_away` (dead or missing), `on_run`, `too_few`, `other_archetype`, or `deck_full`. Accepting is the Crew screen's `moveCards({ cardType, from: 'locker', to: driver })`, so a debrief button and the move can't disagree, and the deck rules live in one place. It changes nothing; the caller passes the cards still to offer and asks again after each move.

Every driver in the pool is listed, the dead and missing with `driver_away`, so the screen decides whom to show.

## Bought at home

`campaign.addToLocker({ cardType, count })` puts new copies in the locker in one `set`, checked by `readNewCards`, for the garage at the compound (Buildings: cards bought at home go to the locker). Paying for them is the garage's, at the same step's checkpoint. On the road the garage's sales are cargo, through `addCardsWon`.

## Saves

Nothing new is saved. Cards won live on the run party, which the run controller saves with the run ([combat-bridge.md](./combat-bridge.md), The run party), and the campaign's format is unchanged, so `CAMPAIGN_SCHEMA_VERSION` stays at 4.

## Provisional calls

None of these is in the spec; each is a line or two to change.

- Cards won count as loot (combat-bridge.md's call, which this builds on): cargo on the road, the locker at home, lost with a failed run.
- The debrief offers each card to any driver at the compound, injured ones included, not only the two who went on the run. The spec says "a driver's default deck".
- A full deck refuses a card in the debrief (`deck_full`), with no swap offered. The player makes room on the Crew screen and moves the card from the locker there.
- A card nobody takes in the debrief stays in the locker. The debrief isn't saved, so quitting partway leaves the rest in the locker too.
- A failed run logs the cargo it lost, resources and cards won, in one line, and logs nothing when it carried nothing.

## Consequences

- The reward screen (DDB-259) calls `addCardsWon` with the pick, on the party the run controller holds, never the locker or a driver's deck. So does a Find: cards stop.
- The run controller's arrival (DDB-322): `unloadRun({ party })`, `injureOnArrival`, `runsCompleted`, `endDay`, then a checkpoint, then the debrief over `unloadRun`'s cards with `getDebrief` and `moveCards`, a checkpoint after each move. A failed run is `loseRun({ result })` and a checkpoint. It calls `unwindRunDecks` for neither, and drops its saved party at the same checkpoint.
- The garage (DDB-44) calls `addToLocker` at home and `addCardsWon` on the road.
- `unwindRunDecks` refuses while a fight is open or being written back.
