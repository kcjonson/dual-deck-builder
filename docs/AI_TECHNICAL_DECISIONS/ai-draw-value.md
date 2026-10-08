# AI draw value and the hand limit

## Date
2026-10-08

## Context

DDB-397 (epic DDB-5). A draw fills a driver's hand up to their hand limit and the rest go straight to discard, a burn (Combat Rules, Driver; [per-driver-hand-limit.md](./per-driver-hand-limit.md)). RammingAI, MCTSAI, and SalvageAI scored a draw card by how many cards it draws, so a driver at their limit still valued a draw it would burn. That matters more now the limit is a per-driver stat, and more again once rewards add draw cards.

Nitro Boost is the only draw card in the data, and it already burns in the AI evaluator. A Mechanic's deck is eight cards, so their played Nitro Boosts are soon reshuffled and drawn again, and once their hand is full of Repair Kits and Armor Platings they don't need, each Nitro Boost they play for its speed burns its draw.

## Options considered

Where the discount lives:

1. **Each AI discounts its own draw score.** Three copies of one rule, free to drift apart.
2. **One estimate in `ai/` that every AI calls (chosen).**
3. **Simulate the draw.** There's nothing to simulate it in: MCTSAI scores each play with a static evaluation and runs no rollouts, and the other two score one play at a time.

What hand the draw counts against:

1. **The hand as it stands.** Counts the card being played, which leaves the hand before its draw resolves.
2. **The player's hand on the board, less the played card (chosen).** While a raider plans, the board is the planning projection, so the plan's earlier plays have already left it.
3. **That, plus what the plan's earlier draws kept.** The projection would carry a count of drawn cards beside each hand. Only raider planning would read it, and raiders never play a drawn card: a plan commits only cards it knows, and the start of the player's turn discards every hand. With today's cards it changes no estimate, and it would put a second hand size beside `AIPlayer.evaluateVehicle`'s `cardsInHand` that disagrees with it mid-plan.

## Decision

- `ai/DrawEstimate.ts` holds the estimate. `cardsDrawn(card)` counts a card's `draw_cards` effects, the only draw effect the cards use; an effect with no value draws none, which is what the battle draws for it. `cardsKeptFromDraw({ board, card, player })` is how many of those cards stay in the player's hand, where every draw lands (`EffectTargets` makes a draw the caster's own): the hand the board has, less the card itself when it comes out of that hand. The rule, fill to the limit and burn the rest (none kept from a hand at or over it), is `cardsKept` in `mechanics/Driver.ts`, and `Driver.drawCards` keeps by it, so the battle and the AIs share one rule.
- A burned card is worth nothing. None of the AIs values the discard pile, so there's no small negative to follow.
- Each AI keeps its own scale, per kept card. RammingAI scores 40 a card before its adrenaline and early-turn multipliers. MCTSAI scores `CARD_DRAW_WEIGHT` a card, once for the whole card as it scores a flank and speed; its combo bonus for a draw needs at least one kept card, and so does a draw card left in hand counting as a reason not to end the turn. SalvageAI scores 40 a card, 60 when behind on cards, for two cards at most: its draw was a flat 80 or 120 tuned on Nitro Boost's two, and the cap keeps a bigger draw from outranking a flank (150).
- `CardEffectValidator` calls a draw beneficial while it keeps a card, or while the card has another effect the validator doesn't judge (Shield, granted adrenaline, Draw Fire, a conditional effect), since it can't rule that one out. RammingAI ends its turn rather than play a card whose only effect is a draw that would burn, because its `chooseBestAction` stops below 0. AggressiveFlankerAI still plays one when nothing better is offered, as it does any card the validator rejects (-500 beats ending the turn at -1000), and SalvageAI, which doesn't use the validator, scores one at 0 and plays it over ending the turn (-100). Nitro Boost passes the validator on its speed, so no card in the data reaches the draw check yet.

## Consequences

- An AI still plays a draw card for its other effects when the draw burns. Nitro Boost's speed keeps it worth playing at the limit.
- A raider values a draw by the room in its hand, though its mid-turn draws go unplayed ([enemy-intent-planning.md](./enemy-intent-planning.md), smaller calls). Whether raiders should value draws at all is DDB-421's question.
- A plan's later draw is estimated without the cards its earlier draws kept, so a raider that plans two draws can count room the first one filled. With today's cards it can't: a raider holds five, with two Nitro Boosts at most, drawing 2 each, under a limit of 7, and no raider holds an upgraded card. Two upgraded Nitro Boosts (3 each) would: the second keeps 1 where the estimate counts 3.
- The deck isn't counted. A draw keeps at most what's left to draw: the deck, then the discard reshuffled, which by then holds the played card unless it exhausts, so a draw card can draw itself back. The AIs value a draw by the room in the hand alone.

