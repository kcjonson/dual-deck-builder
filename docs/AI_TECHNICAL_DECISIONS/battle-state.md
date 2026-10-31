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
- **Turns.** The player's side plays from either hand until `EndTurn`. The enemy turn then goes raider by raider in seat order: `BattleState::actingRaider` names the one whose behavior picks from `legalActions`, its `EndTurn` passes to the next, and a raider wrecked or left without its driver mid-turn passes on by itself. A raider acts only from the wheel; one riding as a passenger draws but doesn't play, as in the TypeScript. A stunned raider is passed over. Each side's turn ends with flankers that are no longer faster than the vehicle they outran dropping back, and the wrecks clearing; the raiders' then closes up. The last raider's `EndTurn` starts the next player turn, ticks the statuses, discards every hand still held, refills everyone's adrenaline, clears Shield, and deals five. Until intents land, a raider chooses during the enemy turn from the hand it drew at the start of the player's.
- **Statuses** live on the vehicles in the state, each application its own with a value and the player turn starts it has left, or none for the rest of the fight. They count down at the start of the player's turn, as enemy-intent-planning.md has them, so one put on during the player's turn lasts through the enemy turn after it. Speed boosts and slows add to speed, but a Heavy vehicle (armor past its base) drops the boosts; Evade adds to what a hit check has to beat; Vulnerable takes half again; a stunned raider skips its part of the enemy turn, and one whose stun just wore off is Steady and shakes off the next until the player turn after; triple_damage and damage_bonus raise the vehicle's attacks; a death_mark takes whoever is at the wheel when its side's turn ends; boxed_in stops a new flank. The spec only says what a stun does to a raider, so a card that would stun one of the player's vehicles isn't a legal play.
- **Movement** (movement-cards.md and Combat Rules' Flanking and Swerving are the rules). A vehicle on a shoulder carries its flank state, the slot it left (kept reserved) and the vehicle it outran, or neither for an ambusher, which a raider seat can start as in a row with one of the player's vehicles. Every change_position move plays, from `Movement.h`, which targeting and play both ask, so a move is legal by the rule it's carried out by. A card's own moves walk the caster along as targeting reads the card, so range counts from where they leave it (Strafe, Cut Off) and a flank counts the boost before it (Overtake). Target conditions (target_flanking, target_flanking_in_row, target_in_formation) decide who the card can be played at and are checked again as each effect lands; target_ambusher and driven_vehicles_within only decide whether that effect lands. A vehicle a card moves has swerved this turn, which caster_swerved reads; the drop-back and close-up between turns don't count. A move that has to happen and can't, at play, cancels the rest of the card; an optional one is skipped.
- **Actions.** `PlayCard` names the driver, the hand index, the target vehicle for a card played at one, for a card that lands on one person aboard (Medical Kit) which of the driver and passenger, and for a card whose move picks its slot (Juke, Strafe, Shoulder Check) which slot. `legalActions` lists every play `actionBlocker` passes, each target, occupant, and slot spelled out, then `EndTurn`. `apply` throws on anything `actionBlocker` refuses, and `cardBlocker` says why a card can't be played at all, for the hand to grey it out.
- **Events.** `apply` returns what happened in order, each event saying what changed and by how much: draws, burns, shuffles, the hit check's numbers, where a hit went (Shield, armor, structure, then each occupant), who went down, took the wheel, jumped aboard, or crashed out, a vehicle carrying on as an escort, every change of slot and why, a move that couldn't happen, statuses going on and wearing off, stuns skipped and shaken off, death marks taken, wrecks leaving the road, and the fight's end. The log words them; a renderer animates them.
- **What plays.** Damage with its hit check, range, hit modifier, the ramming or gunnery skill, the ram formula, its modifiers, and bonuses on the caster's row or the target's; apply_status; draw_cards, gain_shield, gain_armor, gain_resource, grant_adrenaline, heal, heal_driver; change_position; conditionals on partner_attacked, target_has_status, and self_has_status; and every condition an effect or a bonus can carry. Anything with draw_fire or an order tag, a move inside a conditional or a second picked slot, or the both_drivers, any, or escort target type isn't a legal play yet. That leaves every base card but the ten orders.
- **Small readings of the card format**, where the TypeScript was quiet or did the same: `scaling` adds nothing to damage, and ramming scaling only picks the ramming check, as the card texts read; a hit modifier raises the evade a ram checks against too, though no ram has one; a card's target has to be within the range of every effect landing on it, where the TypeScript took the longest, which no card tells apart; and an effect on someone an earlier effect of the same card took out of the fight does nothing.
- **How a fight ends**, for now: lost once none of the player's drivers is in the fight, won once no raider is, lost if one card does both. Routs, break-offs, and waves come with the encounters.

## Provisional calls

Pending Kevin's approval in [gameplay-calls.md](../gameplay-calls.md) (The battle state).

- 372: Coordinated Attack's partner_attacked holds when the partner has played a card tagged attack this turn, whether it hit or missed, because the card says "attacked", and a miss is still the partner taking their shot.
- 373: a raider has no partner, so partner_attacked never holds for one, because raiders each act alone and no raider deck carries the card.
- 374: Precision Shot's Speed+ is a speed_boost, so its data reads `self_has_status speed_boost` and speed_plus is gone from the rules, because Card System Design 2.2 has Nitro Boost giving Speed+ and nothing ever gave speed_plus; the bonus lands while the boost is on the vehicle, even when Heavy cancels its speed.
- 375: each application of a status is its own and they stack, boosts, slows, Evade, and damage bonuses adding up and the rest on or off, each wearing off on its own turns, because that's how the cards read, and nothing says a second Nitro Boost refreshes the first.
- 376: an attack's damage takes the attacker's damage_bonus, then its triple_damage, then flanking's half again, then the target's Vulnerable, rounding down at each, and none of them touch a cost a card charges its own caster, because the attacker's own modifiers come before the target's, and Combat Rules already keeps Berserker's cost flat.
- 377: Witness Me's death_mark takes whoever is at the wheel of the marked vehicle at the end of that side's turn to 0 HP, so a player's driver is down and can still be revived if the partner wins, while a passenger who then takes the wheel rides on, because "die at end of turn" is the driver's, and Kevin's rule makes a player's death in a fight a down.
- 378: triple_damage triples every attack from the vehicle for as long as it lasts, the rest of the turn for a player's Witness Me, while damage_bonus (Flanking Maneuver's) is used up by the vehicle's next attack card, hit or miss, because Witness Me says "all damage this turn" and Flanking Maneuver says "next attack".
- 379: a flanker whose reserved slot trades lanes in a Formation Shift hasn't swerved, so its Weave gets no +1 for it, because its own slot on the shoulder never changed, and call 290 counts a change of slot.
- 380: a partner riding as a passenger in your own vehicle has no vehicle of their own, so Slipstream has nobody to slip behind and Leapfrog nobody to swap with, because both cards move you against another vehicle, and call 292 makes the partner's vehicle the one they're in.

## Consequences

- Every starter deck and every raider deck plays whole. What's left is intents on the behavior seam, escorts with the orders and Draw Fire, and the encounter's waves, routs, and break-offs.
- Coordinated Attack's second hit lands for a pair, closing what [solo-driver-fights.md](./solo-driver-fights.md) calls DDB-121's gap, and reads false for a lone driver, as that record's call 1 wants.
- A preview is `apply` on a copy, and the tests hold a copied fight to replaying exactly as the original.
- No escorts are seated yet, so a vehicle that carries on as an escort does nothing until orders land, which is what an escort does unordered anyway.
