# Movement cards: the swerve model (DDB-545)

## Date
2026-10-24

## Context

The road model gave rows a job ("pull ahead of a rammer, drop behind to line up a shot"), but flanking was the only way to change slots, so nothing on the board ever used them. Combat Rules now has Swerving (under Game State) and twenty movement cards (Movement cards, under Cards), and raiders get the six that move only themselves (DDB-546, DDB-552).

Before this, `change_position` knew one thing, `position: "flanking"`, and Battle's flank was the only code that moved a vehicle mid-turn. The twenty cards need a one-step swerve in a fixed or picked direction, a move further than one step (to a picked slot, or behind the partner), a swap, a drop-back to the reserved slot, a formation-wide lane switch, and the same moves made on a raider (shoves, Brake Check). Four tasks start from this one in parallel: the fixed-destination batch (DDB-549), the raider-moving batch (DDB-550), slot targeting (DDB-548), and raider swerve planning (DDB-546). So the shape had to cover every card now, even the ones no task here builds, and the core paths had to exist before any card does.

## Options considered

1. **A new effect type per move** (`swerve`, `move_to_slot`, `swap`, `shove`, `drop_back`).
   - Pros: each type reads plainly in card data.
   - Cons: every place that switches on effect types (Battle, BoardProjection, the five AIs, intents, the card validator) grows five cases, and each batch would add its own, all in the same switch statements at the same time.
2. **Card-specific handlers keyed on the card's `type`.**
   - Pros: no data design at all.
   - Cons: the cards stop being data. Raiders get the same cards, upgrades replace the effects list, and the simulator reads effects, so all of it would need special cases.
3. **Extend `change_position` with a discriminator and a few fields (chosen).** `position` says which move, `to` says where, `target` says who moves, `optional` says whether a move that can't happen blocks the card. One parser (`moveSpecOf`) reads it and throws on anything it doesn't know, and the card data check runs it over cards.json.
   - Pros: one effect type, one place that resolves it, every card expressible as data now. Existing flank data keeps working untouched.
   - Cons: a few fields only mean something for some positions (`to` for swerve and move). The parser catches the wrong combinations.

Where the rules live was the other choice. Pure slot geometry (what's adjacent, what's in a formation, what's behind a slot) went in `Road.ts` beside `flankLane` and the lane rules, since it needs no board. Occupancy, reservations, flanking, partners, and destinations need a board, so they went in `BoardProjection`, which already holds the flank rules for both the live board and planning. Battle stays the only thing that moves a live vehicle: it asks a fresh projection to resolve the move, then puts the placements on the vehicles. The projection applies the same placements to its own copy, so play, planning, and the preview share one set of move rules.

## Decision: the change_position shape

| Field | Values | Meaning |
|---|---|---|
| `position` | `flanking`, `swerve`, `move`, `swap`, `drop_back`, `formation_shift` | Which move. |
| `to` | swerve: `other_lane`, `outside`, `ahead`, `behind`, `pick`, `pick_row`; move: `pick`, `behind_partner` | Where. `pick` is a slot the player picks (any adjacent one for a swerve, any empty formation slot for a move). `pick_row` is a picked row ahead or behind (Shoulder Check). `outside` is the mover's own outside lane, same row. |
| `target` | `self` (default), `target` | Who moves: the caster's vehicle, or the card's target. A swap is always `target` (the vehicle swapped with); a flank and a formation shift are always `self`. |
| `optional` | `true` or absent | An optional move that can't happen is skipped and the rest of the card plays. Any other move with nowhere legal to go makes the card unplayable (call 285), and failing at resolve cancels the rest of the card, as a failed flank does. |
| `on_hit` | `true` or absent | As for any effect: only after an earlier effect of the card landed. A move never rolls to hit itself. |

A card picks at most one slot. Every move obeys the slot rules: a mover that's flanking can't swerve (so shoves never move a flanker or an ambusher), the destination is in the mover's own formation (never onto, off, or along a shoulder), and nobody is in it or holds it reserved, wrecks included. A swerve's destination is also adjacent, range 1, so never diagonal. A drop-back is the one move off a shoulder: a flanker back to its reserved slot.

What each card will use:

| Card | change_position | Notes for its batch |
|---|---|---|
| Lane Change | `swerve`, `to: other_lane` | |
| Floor It | `swerve`, `to: ahead` | `speed_boost` 2, duration 1 (call 286), so Heavy cancels it |
| Hard Brake | `swerve`, `to: behind` | `gain_shield` 4 |
| Juke | `swerve`, `to: pick` | `draw_cards` 1 |
| Bootlegger Turn | `move`, `to: pick` | +1 Evade needs an Evade status (see below) |
| Strafe | `swerve`, `to: pick`, then a Range 1 `damage` | range counts from the picked slot |
| Point Man, Tail Gunner | none | row conditions are DDB-549's |
| Slipstream | `move`, `to: behind_partner` | `speed_boost` 3, duration 2 |
| Lay on the Horn | `swerve`, `to: outside`, `target: target`, `optional` | "in its formation, in your row" target conditions are DDB-550's |
| Shoulder Check | `swerve`, `to: pick_row`, `target: target`, `on_hit`, `optional` | after a ramming `damage` |
| Cut Off | `swerve`, `to: ahead`, then Range 1 statuses on the target | range counts from the row ahead |
| Box In | none | can't-flank status is DDB-550's |
| Peel Off | `drop_back` | unplayable unless flanking with a reserved slot |
| Brake Check | `drop_back`, `target: target`, `optional` | the ambusher's 4 damage and the "on your shoulder, in your row" condition are DDB-550's |
| Overtake | `speed_boost` then `flanking` | as Run Ahead; targeting and planning count the card's own boost before the flank |
| Fall In | `move`, `to: pick`, `target: target` on an `escort` order | no `spendsEscort` |
| Leapfrog | `swap` (`target: target`) on an `ally` card | |
| Formation Shift | `formation_shift` | Exhaust as usual |
| Weave | none | reads `Battle.swervedThisTurn` |

The two Evade riders (Bootlegger Turn, Weave) need a status the hit check reads; none exists yet. DDB-549 builds it for Weave, which lands first, and Bootlegger Turn reuses it. Suggested name `evade_boost`, its value added to the defender's evade in `Battle.hitCheck`.

## The API the other tasks build on

`Road.ts`, pure geometry: `SwerveDirection`, `swerveSlot(from, direction)`, `adjacentFormationSlots(from)`, `formationSlots(team)`, `isFormationMove(team, from, to)`, `isSwerveStep(team, from, to)`, `slotBehind(slot)`, `otherFormationLane(lane)`, `rowAhead(row)`, `rowBehind(row)`.

`Movement.ts`, the shape: `MoveSpec`, `PickedMove`, `moveSpecOf(effect)` (throws on bad data), `movesOf(card)`, `picksSlot(move)`, `pickedMoveOf(card)`, `cardPicksSlot(card)`, `casterMoveOf(card)`.

`BoardProjection`, the board rules: `slotMoveBlocker({ mover, destination, step })`, `moveDestinations({ move, mover })`, `destinationBlocker({ move, mover, destination })`, `swapBlocker({ caster, target })`, `moveBlocker({ card, caster, target?, destination? })`, `landingSlots({ card, caster, destination? })`, `resolveMove({ move, caster, target, destination? })` returning placements or a blocker, `partnerVehicleOf(vehicle)`, `swervedThisTurn(vehicle)`, `wouldDropBack(vehicle)`. `apply` and `targetBlocker` take an optional `destination`; `apply` also takes an optional `actor` (the escort carrying an attack order) and skips an `on_hit` effect when nothing before it landed, by the same range and hit checks play makes.

`Battle`: `playCard({ ..., destination? })`, `getTargetBlocker({ ..., destination? })`, `moveDestinations({ driver, card, target? })`, `needsDestination({ driver, card, target? })`, `getDestinationBlocker({ driver, card, target?, destination })`, `swervedThisTurn(vehicle)`, `getAllIntents({ preview? })` and `projectEnemyTurnStart({ preview? })` with `PlayPreview { driver, card, target?, destination? }`. `getCardBlocker` greys out a swerve card for a flanker or when it has nowhere to go, which the hand already reads through `canPlayCard`. `PlannedAction.destination` and `AIDecision.destination` carry a picked slot through planning and play. `needsDestination` is when slot targeting should ask for a slot: a card with a picked move needs one unless the move is optional and has nowhere legal to go (Shoulder Check on a flanker, or on a raider boxed in ahead and behind), which plays without a slot and skips the shove (call 293). `playCard` requires a destination exactly when it says so.

## The raider-moving batch (DDB-550)

Lay on the Horn, Cut Off, Box In, Brake Check, and Overtake, built on the shape above; the table's "DDB-550's" notes are what this section answers.

- Target conditions are effect `condition`s, as Oil Slick's `target_flanking` already was, read by `BoardProjection.targetConditionBlocker`, which targeting and a raider's planned card both ask: `target_in_formation` (Lay on the Horn, on its shove) and `target_flanking_in_row` (Brake Check, on its drop-back: flanking, in the caster's row). Lay on the Horn's Range 1 sits on its shove, its only base effect, so the card has a range chip and targeting checks it; "in your row" needs no condition of its own (call 320).
- Landing conditions are judged as the effect lands, by `BoardProjection.landingConditionHolds`, which `Battle.applyDamage`, `Battle.applyStatus`, the projection's own landing, and `AimPreview` all ask: `target_ambusher` (Brake Check's 4, after the optional drop-back has had its go, so a flanker with a reserved slot drops back and takes nothing) and `driven_vehicles_within` with a number `within` (Box In's Vulnerable: two driven vehicles on the caster's side, both in reach; calls 321 and 324). A separate field, not `range`, since an effect's `range` is the card's targeting range. Every condition name card data may use is in `EFFECT_CONDITIONS` (BoardProjection.ts); both checks throw on any other, and the card data check holds cards.json to the list, wrappers included.
- Box In's status is `boxed_in` (`BOXED_IN` and `Vehicle.isBoxedIn` in Vehicle.ts), duration 1, so it covers the enemy turn after the card. `BoardProjection.flankBlocker` refuses a boxed-in flanker, and the projection tracks it (`isBoxedIn`, set when the status lands on it), so play, raider planning (`canFlankAnyone`, `orderCarrier`), a planned flank in the preview, and `getCardBlocker`'s greying all honour it from one check. It never moves a flanker (call 322). The plate shows it as a "Boxed in" chip.
- `effectRecipientOf` reads a move's own target: a `change_position` with `target: "target"` lands on the card's target, so base Lay on the Horn (a shove and nothing else) lands on its target for `landsOnTarget` and `AimPreview`, and the aim shows its sure hit. It's still resolved once as the caster's action, and `rollsToHit` never rolls a caster action.
- An upgrade that adds an effect (Lay on the Horn's slow, Brake Check's Vulnerable) can't print it through a `{variable}`, so its `upgrades` block carries its own `summary` and `description`, which `Card` puts on the upgraded copy. The card data check lets only such an upgrade add effects, after the base ones, and holds its texts to the same budgets (Card System Design 1.1).
- Overtake is Run Ahead on the driver's own vehicle: a `speed_boost` of 2 for 2 turns, then `flanking`; DDB-545's `selfSpeedBonus` in the flank checks does the rest. Cut Off is a fixed `swerve` ahead followed by two Range 1 statuses, and its range counts from the landing slot through `landingSlots`.
- The projection needed nothing new for the moves themselves: the shove, the drop-back, the slows, and the boost already land on it, so each card's fizzle shows in the preview as it's aimed and as it's played.

## Kevin's settled calls

Kevin settled these on 2026-10-24. They're in Combat Rules (Swerving) and out of gameplay-calls.md.

- 281, approved: a flanker can't swerve; shoulders are entered only by flanking and left only by dropping back. DDB-533 already makes a flanker drop back before it flanks again, and sliding along the shoulder is the move it closed.
- 282, changed: raiders do get movement cards. Split out as DDB-546, with the open parts in calls 287 to 289.
- 283, approved: shoves move only raiders in formation, never flankers or ambushers; Brake Check is the flanker card.
- 284, delegated to me and kept: every change of slot counts as swerving for Weave; a Bootlegger Turn is a bigger swerve, not a different thing.
- 285, approved: a card whose swerve has nowhere legal to go is unplayable, so it greys out before you commit.
- 286, approved: Floor It's +2 Speed lasts until the end of the next enemy turn, so it doesn't race the end-of-turn drop-back.

## Provisional calls

Pending Kevin's approval in [gameplay-calls.md](../gameplay-calls.md) (Movement cards).

- 287 (DDB-552): raiders get the movement cards that move only themselves (Lane Change, Floor It, Hard Brake, Juke, Strafe, Cut Off), never a shove, Brake Check, or a partner or escort card, because nothing on your side moves that you didn't move, and the convoy cards mean nothing to a raider.
- 288 (DDB-546): a planned raider swerve shows as a move intent, a swerve icon in the intent row with its destination outlined in raider red while the plan stands, because the player has to read the raider's new range off the road before acting.
- 289 (DDB-546): a planned raider swerve names its destination, and if that slot isn't adjacent and empty when the swerve plays, the swerve fizzles under the usual rule and the cards after it are judged from where the raider really is, because that's how every other stale planned card is handled.
- 290 (DDB-545): every change of slot a card makes during a turn counts as swerving for Weave, a flank, Peel Off, and being moved by your partner's Leapfrog or a Formation Shift included; the end-of-turn drop-back and close-up happen between turns and don't. Call 284 says any change of slot counts, and Weave asks about the turn being played, which those two aren't part of.
- 291 (DDB-545): Formation Shift is playable while its caster is flanking, its reservation switching with its row like every flanker's, and wrecks still on the road switch with their rows. The card moves the formation, not the caster, so it isn't a swerve the flanker rule stops, and rows trading lanes whole means nobody can land on a wreck.
- 292 (DDB-545): your partner's vehicle (Slipstream, Leapfrog) is whichever vehicle your partner is in, driving or riding, at any distance, and only Leapfrog's escort has to be next to you; a driver's vehicle carrying on unmanned is an escort for this. The card names "your partner's vehicle or an escort adjacent to you", which puts the adjacency on the escort, and a partner riding in an escort is still in that vehicle.
- 293 (DDB-545): a shove or drop-back of a raider that can't happen leaves its card playable and does nothing (`optional`): Lay on the Horn on a raider whose outside slot is taken still lands its slow, Shoulder Check on a flanker still hits, and Brake Check on an ambusher deals its damage instead. Call 285 is about your own swerve, and the spec writes these three with "if that slot is empty", "if the target is in its formation", and an ambusher alternative.
- 320 (DDB-550): Lay on the Horn checks Range 1 and "in its formation", and Range 1 to a raider in its formation is always in your row, so the card needs no row check. From your outside lane it has no target, since Range 1 there is only your shoulder, and from the raiders' shoulder its one target is the raider beside you, already in its outside lane, which the shove leaves where it is. The spec's three conditions all hold there, and call 293 keeps a shove that can't happen playable.
- 321 (DDB-550): Box In's Vulnerable needs two driven vehicles in the fight, both within Range 2; with one wrecked or carrying on as an escort, the raider is only boxed in. "Both your driven vehicles" names two, and the card is about pinning a raider between them.
- 322 (DDB-550): Box In stops a new flank and nothing else. A boxed-in flanker keeps its shoulder; one that drops back at the end of your turn can't flank again from its reserved slot that enemy turn. The card says "can't flank", and knocking a flanker off is Brake Check's job.
- 323 (DDB-550): Brake Check's 4 damage to an ambusher is a hit like any card's damage: Vulnerable and a flanking caster raise it, and it goes through Shield and Armor, with no roll. The card says "takes 4 damage", which every other card's damage means that way; Caltrops is the card that says structure.
- 324 (DDB-550): Box In's Vulnerable is judged once, from where your driven vehicles stand as the card lands, and doesn't come or go as they move. Every status lands once and lasts its turns.

## Consequences

- One move path. `Battle.applyMove` resolves through `BoardProjection.resolveMove` and logs each vehicle's move; `relocate` is the one place a card's move sets a slot, and it records `swervedThisTurn`. The flank goes through it too. The set clears as each turn starts.
- Hand greying needed no screen change. The combat screen already asks `Battle.canPlayCard`, which reads `getCardBlocker`, the same path DDB-533 used for Flank.
- Range for a card that moves first (Strafe, Cut Off) counts from where it lands, in targeting (`targetBlocker` through `landingSlots`) and in a raider's planned card (`getPlannedCardBlocker`). Until a slot is picked, a target is legal if any slot the card could pick reaches it, which is what slot targeting wants for highlighting raiders.
- The preview already follows a move once it lands, because `projectEnemyTurnStart` builds from the live board. `getAllIntents({ preview })` also judges a card that's only aimed, applying its moves and speed changes to the projection first, so DDB-548's hover can drop intents that would fizzle before the drop. An attack order lands through the escort that would carry it out (`orderCarrier`), and an `on_hit` move lands only if the hit check before it passes, so the preview never shows a shove a miss would skip. Drop-backs in that projection read projected speeds (`wouldDropBack`), so a boost on the aimed card counts.
- Heavy needed nothing new: a movement card's speed is a `speed_boost` status, and `Vehicle.speedChange` already drops boosts on a Heavy vehicle (heavy-armor.md). The move still happens.
- Moving never spends an escort: `relocate` doesn't touch `spent`, and Fall In carries no `spendsEscort`.
- The road view animates any change of slot as a swerve, so swerves, named-slot moves, and swaps needed no change; RoadView tests cover all three, a swap moving both tokens at once.
- The `[Swerve]` keyword's auto-highlight would have caught Flank and Flanking Maneuver's full text ("swerve onto their shoulder"), which isn't a swerve under these rules, so both now say "pull onto". The Flank keyword's own text changed to match.
- A planned raider card with a target whose own move has gone stale (its picked slot taken or no longer next to it, its fixed slot blocked, or the raider flanking by then) fizzles: `getPlannedCardBlocker` runs `moveBlocker` first, so the preview drops it and play logs the fizzle (call 289). A planned card with no target (a raider's Lane Change, Floor It, Hard Brake, Juke) skips `getPlannedCardBlocker` in both play and the preview, so its stale-move fizzle is still DDB-546's.
- Still open for the tasks that follow: an Evade status (DDB-549), row conditions (DDB-549), the AIs choosing and scoring moves and the no-target stale fizzle above (DDB-546), and the simulator's scoring (DDB-553). A raider's planned picked move has to carry `destination`; with none, a plan's range check reads the first slot it could pick.
