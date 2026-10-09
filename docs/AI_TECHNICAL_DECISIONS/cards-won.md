# Cards won: cargo on the road, the locker at home, the debrief (DDB-316)

Date: 2026-10-09. Code: `src/renderer/game/campaign/CardsWon.ts` (`addCardsWon`, `getDebrief`), `Campaign.ts` (`unloadRun`, `loseRun`, `addToLocker`, `getAddToLockerBlocker`, `currentRun`, `nextRunNumber`, `isStoring`), `DeckRules.ts` (`readCardCatalogue`, `readNewCards`), and `OpenFights.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Resources; Buildings; Decks and the locker, After the run; The drive; Return; A failed run) and [Card System Design](../specs/Card%20System%20Design.md) (1.3, signature cards). Builds on [combat-bridge.md](./combat-bridge.md), [run-decks.md](./run-decks.md), [locker-and-deck-rules.md](./locker-and-deck-rules.md), and [campaign-state-model.md](./campaign-state-model.md).

## Context

The bridge carried `RunParty.cargoCards` from fight to fight and reported them as `cargoCardsLost` when a run failed, but nothing put a card in, and nothing took one out at home. Kevin's rule is that what a run brings back is cargo until it gets home, and a failed run loses it; counting the cards it wins as loot is the bridge's provisional call. The reward screen (DDB-259), the run controller (DDB-322), and the garage (DDB-44) each need something to call, and the debrief needs to know who can take each card.

## On the road

`addCardsWon({ party, cardsWon })` returns the party with the cards added to its `cargoCards`, leaving the party it was given as it was, the way the bridge's write-back hands on a new party. A fight's reward, a Find: cards stop, and a roadside garage's sale all call it with card counts. The campaign doesn't change: cards won aren't the compound's until the run is home, and they never go in a run deck, so a later fight on the run doesn't deal them.

Cards go on the newest party. A fight's reward is added to the `WonFight.party` that `writeBackFight` returns, after the write-back. The write-back builds the next party from the one the fight started with, so a card added to a party held from before it, the one passed to `startCampaignFight` say, is dropped without a word when the run carries on with the write-back's party.

## New copies are checked against cards.json

A card coming into the compound, won or bought, has to be one cards.json lists, and not an escort's signature card, which comes with its escort and is never the compound's (Card System Design 1.3; [campaign-founding.md](./campaign-founding.md)). `readNewCards` checks both and throws a RangeError naming the card. A bad card here is the caller's bug, not a disabled button, so there's no blocker.

The check reads the bundled cards.json as one catalogue, `readCardCatalogue`: each card's name (for the log), the archetype it's marked for, and the escort it's the signature of. Eligibility (`cardArchetype`), the log's card names (`cardName`), and `readNewCards` all read it. The reason it's bundled is [locker-and-deck-rules.md](./locker-and-deck-rules.md)'s: the campaign checks synchronously, and `CardLoader` loads asynchronously. Rejected: the bridge's own card map passed in, which would make `addToLocker` the one campaign method that needs a lookup handed to it.

Copies the compound already holds, cargo included, are still checked for shape only. A card cards.json drops after it was won still comes home, as a save holding one still loads; refusing it at the unload would leave a run that can never get home.

## Arrival: one call unwinds, then unloads

`campaign.unloadRun({ party })` is a run that got home. It unwinds the run decks exactly as `unwindRunDecks` does, then puts the cargo's resources in the stores and the cards won in the locker, and returns what it unloaded (`{ resources, cards }`) for the debrief. Every copy is then in exactly one place, and `cardsOwned` is up by the cards won.

Everything is checked first, the stores and the locker it all comes to included. What the locker gets depends on who's dead as each deck's turn comes, so it's checked against the most it could come to: every borrowed and left-at-home copy back beside the cards won. Cargo past what a count can hold is refused before any record is stored, and the run can still come home with cargo that fits. Then the records are stored, in seat order, each getting their default deck back, and the campaign last, in one `set` of its run decks, locker, and stores, so its `change` comes once the run is home. The run controller checkpoints after it, as after any step ([campaign-save-and-load.md](./campaign-save-and-load.md)).

One call rather than `unwindRunDecks` followed by an unload, because:

- The run decks going is what stops a second unload of the same run. Once a run is unloaded no run is out, so another unload is refused whatever party it's handed: the same object, a copy, or one rebuilt from ids after a load. A party from an earlier run is refused by its run id (below).
- The debrief needs the run's drivers home. A seated driver's default deck is in their run deck, and the Crew screen's move refuses it (`on_run`) until it's unwound, so unwinding has to come first; one call can't be ordered wrong.
- Campaign listeners hear one change, with the decks back and the cargo in.

It refuses, changing nothing, while a card move is being stored or a fight is open or being written back (below), with no run out, for a party from another run, for a party whose seats aren't the run decks' drivers (in either order), for a seat who's dead or missing (only a failed run leaves one), and for cargo that isn't whole numbers or card counts, or more than the stores or the locker can count. An injured seat is fine, since the infirmary's `injureOnArrival` can come first.

## Each run has an id

The run decks going stops a second unload of one run, but not of a party left over from an earlier run with the same two seats: while the next run is out, that party's seats match it. So each run gets an id, `run-<n>`, when load out starts its run decks, from a counter the campaign saves (`nextRunNumber`, which never goes back, the way `nextDriverNumber` hands out driver ids). `campaign.currentRun` is the run out's id, or null at home. The run controller builds the party with `run: campaign.currentRun`, the bridge hands it on in every party and in a failed run's result, and `startCampaignFight`, `unloadRun`, and `loseRun` refuse a party or result whose `run` isn't the run out.

The id comes from a counter rather than living on the run decks alone because nothing would remember the last one handed out once a run's decks are gone. With the counter saved, the run out's id is derived from it, so the campaign adds one number to its save, and the run party one string to the run controller's.

`unwindRunDecks` stays for a load out given up, where there's no cargo.

## A failed run

`campaign.loseRun({ result })` takes the bridge's `FailedRun`. It unwinds the run decks as `unwindRunDecks` does, the dead losing what went with them, and the cargo is lost: none of it reaches the stores or the locker. In the same `set` it logs what was lost, "Cargo lost with the run: 2 fuel, 30 scrap, 1 med, and Headshot.", or nothing when the run carried nothing. It refuses a result from another run, and unless the result's dead and missing are the run decks' drivers and every one of them is dead or missing. After it no run is out, so the party the run set off with can't be unloaded either, and `unloadRun` refuses that party before it too, since its seats are dead or missing.

The log line covers the cargo only. What it says about the dead and the missing is still the debrief's call (combat-bridge.md).

## Nothing settles while a fight is open

Unloading partway through a fight would put the cargo in the stores before the fight decides whether the run fails, and a death written back after the unwinding would empty a default deck it had just given back. So `unloadRun`, `loseRun`, and `unwindRunDecks` refuse while `hasOpenFight`, as `injureOnArrival` does, and a listener partway through a write-back is refused the same way. The other way round, `startCampaignFight` refuses while the campaign is storing records (`Campaign.isStoring`), so a record's listener partway through a run's end can't start a fight on run decks about to go.

The open-fight registry lives in `OpenFights.ts`, apart from the bridge, and imports only types, so `Campaign.ts` can ask `hasOpenFight` without a runtime import cycle (the bridge imports the campaign). Its maps are its own: the bridge opens and closes fights through its setters, and nothing else writes to them.

## The debrief

`getDebrief({ campaign, cardsWon })` lists each card won, in card-type order, with the copies left to offer and every driver in the pool, each with the reason one copy can't go from the locker to their default deck now, or null if it can. The reason is `getCardMoveBlocker`'s own for that move: `driver_away` (dead or missing), `on_run`, `too_few`, `other_archetype`, or `deck_full`. Accepting is the Crew screen's `moveCards({ cardType, from: 'locker', to: driver })`, so a debrief button and the move can't disagree, and the deck rules live in one place. It changes nothing; the caller passes the cards still to offer and asks again after each move.

Every driver in the pool is listed, the dead and missing with `driver_away`, so the screen decides whom to show.

## Bought at home

`campaign.addToLocker({ cardType, count, price })` is the garage's sale at the compound (Buildings: cards bought at home go to the locker): new copies into the locker, checked by `readNewCards`, and `price` scrap out of the stores, in one `set`, the way `scrapCards` pays the other way. `getAddToLockerBlocker` says why the stores can't pay (`too_little_scrap`, with the scrap needed and held), and `addToLocker` throws a `CardRuleError` carrying it, so the garage's disabled button and the sale can't disagree. The price is the garage's to set, 0 when it's left out. On the road the garage's sales are cargo, through `addCardsWon`, and paying for them there is the run's.

## Saves

The campaign saves `nextRunNumber`, which bumped `CAMPAIGN_SCHEMA_VERSION` from 4 to 5; the format fixture is `campaign-v5.json`, with a run out, so its counter is past the run's id. A load refuses a run out with no id handed out (`nextRunNumber` below 2 while run decks are saved). Cards won live on the run party, which the run controller saves with the run, its `run` included ([combat-bridge.md](./combat-bridge.md), The run party). The bump starts Campaign History over, as every bump does ([campaign-save-and-load.md](./campaign-save-and-load.md)).

## Provisional calls

None of these is in the spec; each is a line or two to change.

- Cards won count as loot (combat-bridge.md's call, which this builds on): cargo on the road, the locker at home, lost with a failed run.
- The debrief offers each card to any driver at the compound, injured ones included, not only the two who went on the run. The spec says "a driver's default deck".
- A full deck refuses a card in the debrief (`deck_full`), with no swap offered. The player makes room on the Crew screen and moves the card from the locker there.
- A card nobody takes in the debrief stays in the locker. The debrief isn't saved, so quitting partway leaves the rest in the locker too.
- A failed run logs the cargo it lost, resources and cards won, in one line, and logs nothing when it carried nothing.

## Consequences

- The reward screen (DDB-259) calls `addCardsWon` with the pick on the `WonFight.party` the write-back returned, never the locker, a driver's deck, or a party from before the fight. So does a Find: cards stop, on the party the run holds.
- The run controller (DDB-322) builds the party at departure with `run: campaign.currentRun`, and saves it. Its arrival: `unloadRun({ party })`, `injureOnArrival`, `runsCompleted`, `endDay`, then a checkpoint, then the debrief over `unloadRun`'s cards with `getDebrief` and `moveCards`, a checkpoint after each move. A failed run is `loseRun({ result })` and a checkpoint. It calls `unwindRunDecks` for neither, and drops its saved party at the same checkpoint.
- The garage (DDB-44) calls `addToLocker` with its price at home, asking `getAddToLockerBlocker` first, and `addCardsWon` on the road.
- `unwindRunDecks` refuses while a fight is open or being written back.
- Every version 4 save stops loading, and Campaign History starts over.
