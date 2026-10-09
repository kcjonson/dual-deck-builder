# Locker and default deck rules (DDB-310)

Date: 2026-10-08. Code: `src/renderer/game/campaign/DeckRules.ts` and `Campaign.ts` (`getCardMoveBlocker`, `moveCards`, `getScrapBlocker`, `scrapCards`, `cardsOwned`), with the numbers in `src/renderer/game/data/deck-rules.json`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Decks and the locker, The rules; At the compound: the Crew screen). Builds on [campaign-state-model.md](./campaign-state-model.md), which describes the rules as they stand.

## Context

`Campaign.moveCards` already moved copies between the locker and default decks without making or losing any, but it left the deck rules to the Crew screen: decks between 8 and 20 cards, and a card marked for an archetype only going to that archetype. Scrapping a locker card didn't exist. The Crew screen (DDB-314) has to show why an action is disabled, and run decks (DDB-315) need the same rules, so they belong under the screen, not in it.

## The rules live in `moveCards`

Every move goes through one check, `getCardMoveBlocker`, which `moveCards` runs before it touches anything. The Crew screen asks the same function to grey out an action, so the reason it shows and the error the move throws can't drift apart.

Rejected:

- A Crew screen layer of add and remove methods over an unchecked `moveCards`. The debrief's "add straight into a default deck" and load out would each have to remember to call it, and the unchecked path would still be public.
- Limits as a record invariant, checked by `DriverRecord`'s reader. A dead driver's deck is empty, a save would stop loading the day the limits are retuned, and the combat bridge writes records the rules have nothing to say about.

So the limits are checked on each move, by the direction it goes: a deck can't take cards past the most, or give them up past the fewest. A deck that's outside the limits anyway (set directly, or loaded after a retune) can still move back toward them.

## A typed reason, and an error that carries it

`getCardMoveBlocker` and `getScrapBlocker` return a `CardBlocker` or null: a reason code (`driver_away`, `too_few`, `other_archetype`, `deck_full`, `deck_at_minimum`, and with run decks `on_run`, `already_borrowed`, and `card_locked`, in [run-decks.md](./run-decks.md)), the place that refuses, and the number behind it (the limit, the archetype, the copies held). The screen words its own message from that; tests assert on codes, not prose. `moveCards` and `scrapCards` throw a `CardRuleError` carrying the same blocker. It extends `RangeError`, which is what these refusals threw before. A call no rule covers (a malformed count, a driver from another campaign) is a bug, not a disabled button, so it still throws from the check as well as the action.

## Eligibility reads the bundled cards.json

`cards.json` already marked archetype cards, with `driverRestriction` (Precision Shot is the Interceptor's), but nothing read the mark or validated it. Now `CardData.driverRestriction` is typed as an archetype or null, `CardLoader` rejects a card restricted to an archetype that doesn't exist, and the campaign reads the marks itself as `DeckRules` loads.

The campaign checks eligibility synchronously, and `CardLoader` fetches `cards.json` asynchronously, so `DeckRules` imports the file and webpack bundles it beside the copy the loader fetches: about 16.5 KB minified, 3.4 KB gzipped. It costs nothing until something outside `campaign/` imports `Campaign`, which nothing does yet. Rejected: passing a card lookup into `Campaign`, which every constructor, `fromJSON`, and founding would then need, and a registry filled when `CardLoader` finishes, which a test or an early screen could read empty. A card type the file doesn't list (dropped since a save was made) can go in any deck.

## Provisional calls

- Deck size: 8 to 20, the spec's starting values, in `deck-rules.json` until the limits decision (DDB-317) settles them.
- Scrap: 5 a copy, flat whatever the rarity. Paying by rarity would turn scrapping into income, where the spec wants it for thinning out what you'll never use; revisit beside the garage's prices.
- Order of refusals: a card for another archetype is reported before a full deck, since it's the reason that won't go away.
- Moves straight from one driver's deck to another's stay, under the same rules at both ends, though the spec only names the locker and a deck.

## Consequences

- The Crew screen asks `getCardMoveBlocker` or `getScrapBlocker` for each action it offers, words the reason from the code, and calls `moveCards` or `scrapCards`, then `CampaignStore.checkpoint`.
- Run decks (DDB-315) are a `CardPlace`. `deckAddBlocker` and `deckRemoveBlocker` take any deck's counts, so a move between the locker and a run deck runs the same rules on the run deck's own and borrowed copies, its escort cards outside them, and a seated driver's default deck takes no Crew screen moves until it's unwound (`on_run`). `cardsOwned` adds every run deck to its sum ([run-decks.md](./run-decks.md)).
- Retuning `deck-rules.json` changes what moves are allowed and never makes a save unloadable.
- Copies that land after a listener has run go to a deck only if the rules still let it take them, falling back to the giving deck and then the locker. A listener's own `set` of a deck still steps outside the rules, as any `set` does.
- A record's listener can see half a move, so the Crew screen recomputes on the campaign's `change`, not a record's.
- Nothing new is saved, so `CAMPAIGN_SCHEMA_VERSION` stays where it was.
