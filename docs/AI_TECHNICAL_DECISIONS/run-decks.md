# Run decks: copy, borrow, leave home, escort cards, unwind (DDB-315)

Date: 2026-10-09. Code: `src/renderer/game/campaign/RunDeck.ts`, and `Campaign.ts` (`startRunDecks`, `moveCards` with a run deck at one end, `moveEscortCard`, `addEscortCards`, `removeEscortCards`, `resetRunDeck`, `unwindRunDecks`, `cardsOwned`), with the combat bridge dealing from them (`CombatBridge.ts`). Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Decks and the locker: The rules, At load out, After the run) and [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 1.2 (Load Out, Customize). Builds on [locker-and-deck-rules.md](./locker-and-deck-rules.md), [campaign-state-model.md](./campaign-state-model.md), [combat-bridge.md](./combat-bridge.md), and [escorts.md](./escorts.md).

## Context

A campaign fight dealt each driver their record's default deck, and the bridge's record said why that couldn't last: a run deck has to know which cards are the driver's own and which were borrowed, or a death on a failed run destroys cards left at home and leaves borrowed ones in the locker. Escort signature cards had nowhere to live either, since card counts can't carry `broughtBy`. Load out (DDB-320) and Customize (DDB-321) need the mechanics under them, and the run controller (DDB-322) saves after every step, so a run deck has to round-trip mid-run.

## The default deck goes out in the run deck

`startRunDecks({ seats, escorts })` empties each seated driver's default deck into their run deck. While a run is out, a run deck holds the driver's whole default deck split two ways, `own` (going) and `leftHome` (staying), beside `borrowed` (locker copies going) and `escortCards`. `unwindRunDecks` puts `own` and `leftHome` back in the default deck and `borrowed` back in the locker.

It seats the drivers by load out's own check, `getSeatBlocker` ([injuries.md](./injuries.md)), asked of each seat alone and then of the pair, so it refuses what load out refuses and words it the same way. The records are emptied before the campaign stores the run decks. If a record's listener leaves the run decks unstorable in between (dismissing an escort whose card one would hold, say), the copies go back to the default decks before the error is thrown on, so nothing is lost.

While its driver is out, a seated driver's record holds no cards. The campaign checks it on every change to the run decks, on load, and in `toSaveText`, since records change outside its checks: cards a `set` put on the record would come back on top of the run deck at unwinding, past limits nobody checked.

Moving the copies, rather than marking which of them go, keeps "every copy in exactly one place" a plain sum: `cardsOwned` is the locker, every default deck, and every run deck's `own`, `leftHome`, and `borrowed`, and no move, start, or unwind changes it. It also leaves the bridge's death write alone. A dead record holds no cards, so the bridge writes status, 0 HP, and an empty default deck in one `set`; with the default deck in the run deck, that `set` empties nothing, and unwinding decides what went with the driver.

Rejected:

- An overlay, the default deck left on the record and the run deck saying which of its copies go. "The default decks never change" would hold in the data, but each copy going would be counted in two places, and the bridge's death write would destroy the copies left at home unless it learned about run decks.
- Card counts with no record of where each copy came from, which the bridge's record dropped already: unwinding can't tell a borrowed copy from the driver's own.
- Copies left at home put back in the locker for the day, as the spec words it. The other driver could borrow them, and if they died with one, unwinding would hand the owner a default deck short a card they never chose to risk. They wait on the run deck instead, which is how Customize's wireframe draws them: faded with a HOME tag in the run deck, and not in the locker the other driver sees.

## A run deck is a CardPlace

`CardPlace` is `'locker' | DriverRecord | RunDeck`. Run decks are immutable, replaced on every change, and as a place any snapshot stands for its driver's run deck as it is now, so a screen holding last frame's still moves the right cards. Customize's one-more and one-fewer controls are `moveCards` between the locker and a run deck, each stored in one `set`:

- Into a run deck: the driver's own copies left at home come back first, then the locker's, borrowed.
- Out of a run deck: borrowed copies go back to the locker first, then the driver's own stay home.

So a run deck never holds a copy of a card left at home and another of it borrowed, which is what the wireframe's +1 and HOME tags assume, and the run deck's reader refuses one that does. Either order loses the compound the same number of copies if the driver dies; returning borrowed copies first frees them for the other driver. A move between a run deck and anything but the locker throws, since no rule covers it: a driver's own cards don't go to the other seat, and a borrowed copy gets there by going back and being borrowed.

The check keeps `checkMove`'s order, and the deck rules are the same `deckAddBlocker` and `deckRemoveBlocker`, run on the run deck's own and borrowed copies (`RunDeck.cards`) and its driver's archetype. Three reasons are new:

- `already_borrowed`: the locker holds too few, and the other run deck borrowed enough to make up the difference (`by`). Short of that it's `too_few`, with `held` counting the driver's own left at home too.
- `card_locked`: what a run deck holds of the card are escort cards (`broughtBy`, the first of them), so nothing takes one out.
- `on_run`: a Crew screen move on a seated driver's default deck. It's in their run deck until it's unwound, and a card added to the record now would come back on top of the run deck, past the limits nobody checked.

Moves into a run deck say what's short as copies available, since `held` counts the driver's own left at home as well as the locker's.

A move can name which copies it's for (`CardMove.copies`, added for Customize, [customize-screen.md](./customize-screen.md)): coming out, the driver's own (`own`) or borrowed ones (`borrowed`); going in, the driver's own from home (`home`) or new ones from the locker (`borrowed`). The order above still holds, so the rules refuse a move whose copies wait their turn, with two more reasons: `own_at_home`, borrowing a card while some of the driver's own are left at home, and `borrowed_first`, leaving the driver's own at home while copies of it are borrowed, each with `held` the copies that come first. A screen asks for exactly the stack a control sits under and words the refusal from the reason, and none of it restates the order. `getCardMoveBlocker` works out no stores, only the counts, so it's cheap to ask of every control on every change.

`resetRunDeck` puts everything left at home back in `own` and everything borrowed back in the locker. It refuses, and `getResetRunDeckBlocker` says so first, once the campaign is over (`campaign_over`) and for a driver who's dead or missing (`driver_away`, as a `CardRuleError`): after a failed run, folding what a dead driver left at home into what went would lose it when the run deck is unwound. `RunDeck.isCustomized` says whether there's anything to reset: something left at home or borrowed.

## Escort cards

An escort card is `{ cardType, broughtBy }`, the escort's signature card and its `escort-<n>`. Starting the run decks puts one in Driver 1's for each escort that came along. `moveEscortCard` gives one to the other seat and back, `addEscortCards` and `removeEscortCards` follow escorts joining and leaving (load out picking one, a garage dismissing one, a fight losing one), and unwinding drops them all. They sit outside the limits (`deckSize` doesn't count them), aren't the compound's (`cardsOwned` doesn't either), and are locked: anywhere but a run deck is `card_locked`.

The campaign checks each against the convoy: brought by an escort still in it, as that escort's signature card, and held by one run deck. The convoy changes outside the campaign's checks, so `toSaveText` checks again, as it re-reads the convoy. So `Convoy.dismiss` mid-run needs `removeEscortCards` beside it. Without it the save refuses with the path, rather than writing one that won't load, and so does every change to the run decks after it (a borrow, a move, a reset), since each one checks them against the convoy again, until `removeEscortCards` takes the card out.

## After the run

A run deck unwinds the same way however the run ends: `unloadRun` for a run that comes home, `loseRun` for one that fails (both in [cards-won.md](./cards-won.md), since each settles the cargo too), and `unwindRunDecks` for a load out given up. A driver who isn't dead gets `own` and `leftHome` back in their default deck, and what they borrowed goes back to the locker. A dead driver took `own` and `borrowed` with them, and what they left at home goes to the locker. `unwindRunDecks` and `loseRun` return the run decks lost, for the debrief. The records are stored first, in seat order, then the campaign, and each driver's status is read as their deck's turn comes, so one a listener kills partway through is unwound as dead. None of the three runs while a fight is open or being written back (`hasOpenFight`), since the write-back has to find the run decks as the fight left them.

## The bridge deals from the run deck

`startCampaignFight` deals each seat their run deck: own and borrowed copies in card-type order, then a copy of each escort card with its `broughtBy` set, so a lost escort's copy leaves the fight's decks as before (`Driver.removeCardsBroughtBy`). It refuses a seat with no run deck, a run deck holding a card brought by an escort that isn't in the party, since that escort isn't on the road to carry the order out, and an escort in the party whose card neither run deck holds, since its order would never be dealt. Every other guarantee stands.

`writeBackFight` takes the cards of the escorts it loses out of the run decks, after the records and before the convoy, so the campaign never holds a card from an escort the convoy has let go. When a lost escort brought one, the campaign emits a `change`, where before the write-back never changed the campaign. The bridge doesn't unwind: the run controller does, when the run ends.

## Cards won are cargo

Kevin's rule (a) counts loot as cargo (combat-bridge.md, Kevin's rules), and cards won as loot is the provisional call on DDB-432. `RunParty.cargoCards` holds them, the bridge carries them to the next party after a win and reports them as `cargoCardsLost` when a run fails, and they never go in a run deck. `addCardsWon` adds to it, and `unloadRun` unloads it into the locker after unwinding the run decks, where the debrief (`getDebrief`) offers each card to a default deck ([cards-won.md](./cards-won.md)).

## Saves

The campaign saves `runDecks`, each as its driver's id, `own`, `leftHome`, `borrowed`, and `escortCards`, which bumped `CAMPAIGN_SCHEMA_VERSION` from 3 to 4. The format fixture (`CAMPAIGN_FIXTURE`) is a campaign with a run out, so the run deck format is pinned with the rest. A load refuses a run deck for a driver who isn't in the pool, one run deck or more than two, two for one driver, a seated driver whose default deck holds cards, a card both left at home and borrowed, and an escort card whose escort isn't in the convoy, isn't that escort's signature card, or is in both run decks. The bump also starts Campaign History over, since the history list is stamped with the same version ([campaign-save-and-load.md](./campaign-save-and-load.md)).

## Provisional calls

These are the simplest options where the spec leaves the rule open. Each is a small change to flip, but the first:

- Cards left at home wait on the run deck for their driver, not in the locker for the other seat to borrow. Putting them in the locker isn't a small flip: the run deck would need a claim on locker copies, and unwinding a rule for when the other seat borrowed one and lost it.
- Into a run deck, the driver's own cards left at home come back before anything is borrowed; out of one, borrowed cards go back before the driver's own stay home.
- Only escort cards move between run decks.
- A missing driver's run deck unwinds as if they'd come home: their cards to their default deck, what they borrowed to the locker. Only a death loses a run deck, the one loss the spec names.
- "Reset to default" leaves escort cards where they are.
- The campaign doesn't know when a run has left, so run decks can change while it's out. Customizing is load out's, and the bridge reads run decks as each fight starts.
- Cards won are cargo (above).

## Consequences

- Load out (DDB-320) starts the run decks once both seats are filled, and unwinds them if the run is given up or a seat changes. It brings escorts' cards in and out with `addEscortCards` and `removeEscortCards`, gives one to Driver 2 with `moveEscortCard`, and a seat swap is a `set` of `runDecks` in the new order. A run deck is customized (the CUSTOM tag) when it has anything left at home or borrowed.
- Customize (DDB-321) is `moveCards` and `getCardMoveBlocker` with a run deck at one end: HOME tags from `leftHome`, +1 tags from `borrowed`, and the locker as `campaign.locker`, which already lacks what the other seat borrowed. "Reset to default" is `resetRunDeck`.
- The run controller (DDB-322) saves the party by ids with its `cargoCards`, and settles the run after the last write-back with `unloadRun` or `loseRun`, which unwind the run decks.
- An escort joining mid-run (DDB-153) brings its card in with `addEscortCards`, and a garage dismissing one takes it out with `removeEscortCards` beside `Convoy.dismiss`.
- The Crew screen gets `on_run` for a seated driver while a run is out.
- Every version 3 save stops loading, as every format change does, and Campaign History starts over.
