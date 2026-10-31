# The battle state, its actions, and its events

## Date
2026-10-30

## Context

The first combat slice of the C++ port, in `libs/rules/battle/`: a fight set up from content and played with the simple cards. [rules-ai-and-packs.md](./rules-ai-and-packs.md) fixes the shape, a `BattleState` value with `legalActions` and `apply`, and this record covers what that shape needed decided to be built: who acts during the enemy turn before intents exist, what `apply` hands back, and what happens to the cards whose effects aren't in yet.

## Options considered

For the enemy turn:

1. **The raiders as one side, any of them acting at any time.** Simple, but it's a whole-team choice, which the packs record rules out.
2. **Each raider in turn, its own behavior choosing its plays (chosen).**
3. **Intents now.** Planning at the start of the player's turn is its own PR, and it needs the behavior seam from option 2 first.

For cards the rules can't play yet (statuses, movement, orders):

1. **Resolve what they can and skip the rest.** That's the TypeScript's conditional effects, which never landed (DDB-121), and the kind of quiet gap the alpha doesn't keep.
2. **Never a legal play, with the reason (chosen).** A card is playable only when every effect, condition, and target it has is implemented, so nothing a played card does is skipped.

## Decision

- **State.** Drivers and vehicles are two vectors that keep every entry for the whole fight, players first, and refer to each other by index. A driver's numbers (skills, HP, adrenaline, hand limit) are copied in at setup, since a campaign driver comes in hurt and a mod can change a limit; cards stay `CardId`s into `Content`. The fight's randomness is `RandomStreams`, one stream per seat's deck (`deck:player:0`), and shuffles are the only draws today: the hit check is a comparison, as the targeting preview already says.
- **Turns.** The player's side plays from either hand until `EndTurn`. The enemy turn then goes raider by raider in seat order: `BattleState::actingRaider` names the one whose behavior picks from `legalActions`, its `EndTurn` passes to the next, and a raider wrecked or left without its driver mid-turn passes on by itself. A raider acts only from the wheel; one riding as a passenger draws but doesn't play, as in the TypeScript. The last raider's `EndTurn` clears the wrecks, starts the next player turn, discards every hand still held, refills everyone's adrenaline, clears Shield, and deals five. Until intents land, a raider chooses during the enemy turn from the hand it drew at the start of the player's.
- **Actions.** `PlayCard` names the driver, the hand index, the target vehicle for a card played at one, and for a card that lands on one person aboard (Medical Kit) which of the driver and passenger. `legalActions` lists every play `actionBlocker` passes, each target and occupant spelled out, then `EndTurn`. `apply` throws on anything `actionBlocker` refuses, and `cardBlocker` says why a card can't be played at all, for the hand to grey it out.
- **Events.** `apply` returns what happened in order, each event saying what changed and by how much: draws, burns, shuffles, the hit check's numbers, where a hit went (Shield, armor, structure, then each occupant), who went down, took the wheel, jumped aboard, or crashed out, a vehicle carrying on as an escort, wrecks leaving the road, and the fight's end. The log words them; a renderer animates them.
- **What plays.** Damage with its hit check, range, hit modifier, the ramming or gunnery skill, the ram formula, the flank's half again, and bonuses on the caster's row or the target's; draw_cards, gain_shield, gain_armor, gain_resource, grant_adrenaline, heal, heal_driver; and conditionals on partner_attacked. Anything with apply_status, change_position, draw_fire, an order tag, a status or movement condition, or the both_drivers, any, or escort target type isn't a legal play yet. That leaves ten of the base pack's cards: Armor Plating, Repair Kit, Medical Kit, Headshot, Point Blank, Far Shoot, Ram, Point Man, Tail Gunner, and Coordinated Attack.
- **Small readings of the card format**, where the TypeScript was quiet or did the same: `scaling` adds nothing to damage, and ramming scaling only picks the ramming check, as the card texts read; a hit modifier raises the evade a ram checks against too, though no ram has one; a card's target has to be within the range of every damage effect landing on it, where the TypeScript took the longest, which no card tells apart; and an effect on someone an earlier effect of the same card took out of the fight does nothing.
- **How a fight ends**, for now: lost once none of the player's drivers is in the fight, won once no raider is, lost if one card does both. Routs, break-offs, and waves come with the encounters.

## Provisional calls

Pending Kevin's approval in [gameplay-calls.md](../gameplay-calls.md) (The battle state).

- 372: Coordinated Attack's partner_attacked holds when the partner has played a card tagged attack this turn, whether it hit or missed, because the card says "attacked", and a miss is still the partner taking their shot.
- 373: a raider has no partner, so partner_attacked never holds for one, because raiders each act alone and no raider deck carries the card.

## Consequences

- Most of the starter decks can't be played until statuses and movement are in: the Road Warrior has only Armor Plating and Repair Kit, with Ramming Speed waiting on target_has_status, and the raiders only Point Blank, Far Shoot, and Armor Plating. The next combat PRs are statuses (with Vulnerable's half again, Heavy, and the speed and evade statuses), then movement and flanking, then intents on the behavior seam.
- Coordinated Attack's second hit lands for a pair, closing what [solo-driver-fights.md](./solo-driver-fights.md) calls DDB-121's gap, and reads false for a lone driver, as that record's call 1 wants.
- A preview is `apply` on a copy, and the tests hold a copied fight to replaying exactly as the original.
- No escorts are seated yet, so a vehicle that carries on as an escort does nothing until orders land, which is what an escort does unordered anyway.
