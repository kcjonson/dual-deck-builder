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

1. **The hand as it stands.** Counts the card being played, which leaves the hand before its draw resolves, and misses what a plan's earlier picks did to the hand.
2. **The hand as the draw will find it (chosen).** Without the played card, after the plan's earlier plays and draws.

## Decision

- `ai/DrawEstimate.ts` holds the estimate. `cardsDrawn(card)` is what a card's `draw_cards` effects draw, counted as the battle counts them. `cardsKeptFromDraw({ board, card, player, drawer })` is how many of those cards stay in the drawer's hand: it reads the hand's size from the board and drops the played card when it leaves the drawer's own hand first. The rule itself, fill to the limit and burn the rest (none kept from a hand already at or over it), is `cardsKept` in `mechanics/BoardProjection.ts`, since the projection applies it too.
- A burned card is worth nothing. None of the AIs values the discard pile, so there's no small negative to follow.
- The drawer is the card's player. Draws are the caster's own action (`EffectTargets`), so no card makes another driver draw; Card System Design's Supply Line ("partner draws 3 cards") is a synergy example, not in the card data or the rules. `drawer` is there for when one does: the drawer's hand and limit count, and playing the card frees no room in a partner's hand.
- The planning projection counts draws. `BoardProjection.apply` adds the cards a planned draw keeps to the drawer's hand size (`handSizeOf`), without putting cards in the hand, since nobody knows them until they're drawn. A raider that plans two Nitro Boosts counts the second's draw against the cards the first kept.
- Each AI keeps its own scale. RammingAI scores 40 a kept card before its adrenaline and early-turn multipliers. MCTSAI scores `CARD_DRAW_WEIGHT` a kept card, once for the whole card as it scores a flank and speed; its combo bonus for a draw needs at least one kept card, and so does a draw card left in hand counting as a reason not to end the turn. SalvageAI scores a draw flat, 80 (120 when behind on cards), so it scales that by the share of the draw kept.
- `CardEffectValidator` calls a draw beneficial only while it keeps a card. RammingAI and AggressiveFlankerAI skip a card whose only effect is a draw that would burn; every draw card in the data has another effect, so neither changes today.
- A draw that keeps every card is scored as it was.

## Consequences

- An AI still plays a draw card for its other effects when the draw burns. Nitro Boost's speed keeps it worth playing at the limit.
- A raider's mid-turn draws go unplayed ([enemy-intent-planning.md](./enemy-intent-planning.md), smaller calls), so a raider still values a draw that keeps cards it will never play.
- The draw pile isn't counted. A draw from an empty deck and discard keeps nothing, and the AIs still value it by the room in the hand.
- The AIs count what a draw effect's value says, as the battle does. An upgraded Nitro Boost's text says it draws 3, but the card has no upgrade data, so it draws 2 and is valued at 2.
