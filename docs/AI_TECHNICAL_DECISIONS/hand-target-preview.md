# Hand target preview and blocked cards

## Date
2026-10-24, DDB-554 (DDB-272). Design source: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) section 6, Planning, and the mock's `.cant` and `.pblock`. Builds on [targeting-preview.md](./targeting-preview.md), [slot-targeting.md](./slot-targeting.md), and [intent-pills-and-enemy-turn-presentation.md](./intent-pills-and-enemy-turn-presentation.md).

## Context

The hand disabled a card only for what `Battle.canPlayCard` checks: adrenaline, a passenger's attack, and the card rules (`getCardBlocker`: already flanking, boxed in, no room to move, a signature card's escort gone). A targeted card with every raider out of reach passed, so it showed as playable and, when picked, waited for a target nothing could be. And a dimmed card never said why, apart from the red cost on an unaffordable one.

Nothing showed what a card would hit, or where a movement card would put anyone, before it was picked.

## Decisions

### The targeting rules in one module

`cardTargets.ts` holds the rules the screen used to keep as private methods: `targetableVehicleIds` (the card's side of the road by target type, then `Battle.getTargetBlocker`) and `aimSlots` (the battle's destinations, kept to slots that put a target in reach when a vehicle step follows). On top of them:

- `cardHasTargets`: whether a card the rules allow has anything to land on, by the aim's steps (`aimStepsOf`, skipping a slot step the battle says isn't needed). It stops at the first target it finds.
- `cardTargets`: everything the card would offer. `vehicleIds` or `slots` for its first step, `picks`, `links` (who acts on whom, one arrow each), and `moves` (where each vehicle it moves would go).

A link runs from the playing driver's vehicle, or for an attack order the escort `orderCarrier` picks, to each target, never from a vehicle to itself. Rally the Convoy is the exception the shape exists for: it acts through every ready escort, each on its nearest raider within the card's range (`Battle.rallyConvoy`), so its links run from each escort to its pick. A card that only stuns (EMP Blast) leaves Steady raiders out, as the battle skips them.

### The deal asks yes or no; the preview asks the rest

`updateUIFromBattle` deals the hand on every `stateChanged`, which a card play and a turn start each fire, and on a team's roster changing. It asks `cardHasTargets` of each card `canPlayCard` lets through, on one `BoardProjection` for the whole hand (`canPlayCard`, `getTargetBlocker`, `moveDestinations`, and `needsDestination` take an optional `board`; none of them changes it). It remembers the driver of each playable card. `refreshTargetPreview` works out `cardTargets` the first time a card is previewed after a deal and keeps it until the next deal.

The screen used to deal again straight after a card play and after the enemy turn's last beat, each already dealt by the battle's `stateChanged`. Both repeats are gone: clearing the selection after a play enables the cards the battle's deal dealt.

Considered: working out every card's full targets on every deal. It cost 0.6 to 1.5 ms a deal on a large board, twice per play, mostly in attack orders' carriers and movement cards' plays, for a list only the one previewed card needs. A test checks that the yes-or-no answer matches `hasTargets(cardTargets(...))` for every card in cards.json, for both drivers, on two boards.

Considered: putting the "has a target" check in `Battle.canPlayCard`. The candidate list by target type is the screen's reading of who a card can be dropped on, and the AI asks its own projection; the battle's rule stays the per-target one both share.

### A blocked card says why

`buildPlayerHandView` takes a `hasTarget` callback beside `canPlay`, asked only of a card `canPlay` passed, and returns `blocked`, a label for each card its driver can pay for but can't play (`BLOCK_LABELS`, calls 365 and 366). An unaffordable card keeps the red cost section 6 gives it and no strip.

The card face shows the label on `CardBlockStrip`, the mock's `.pblock`: 6 in from each side and 64 down, 16 tall, light pink mono on a dark red band. It's a child built the first time a card is blocked, declared at `zIndex` 1 so it paints over the art icon it crosses. It draws at full strength and starts its words at the left (call 367).

Considered: one label per `getCardBlocker` reason (FLANKING, BOXED IN, NO ROOM). The reasons are sentences for the log; mapping them to labels would mean matching strings, so they share CAN'T PLAY until the blockers carry a code.

### Arrows from the vehicle, like the raiders' lines

Kevin's call: the arrows run from the vehicle on the road the card acts from to each target on the road, as the raiders' intent lines run from their pills, not from the card in the hand. `TargetPreview` draws while a playable card is `presented` (pointed at, or keyboard or controller focused, while enabled) on your turn, with nothing aimed or dragged.

- Across the road a link arcs as the intent lines do (`RoadArc.trace`), up from the top of the acting vehicle's plate and down onto the top of the target's token, over the band a raider's pills take. Its last control sits 40 above the target (`trace`'s `drop`), so the head comes down onto it rather than in from the side.
- Between two vehicles in one lane, where that arc would run straight through the target (the opening formation's two drivers, Leapfrog, Triage, an escort order), it goes the short way between the plates' facing edges, bowed (`RoadArc.traceMove`).
- Solid when there's nothing to choose: one target, or a card that lands on every one it lists. Dotted, with the aiming line's dots and head, when the player picks one of several; each arrow's dots are one `drawCircles` group ([draw-circles.md](./draw-circles.md)). Red to a raider, the interaction yellow to your convoy, as their outlines light while aimed, at the intent lines' 80%. No arrow from a vehicle to itself (call 368).

`RoadArc` is the arc `EndTurnPreview` drew, lifted out so both previews share it; with no `drop` it traces exactly what the end-turn preview drew before. The target preview is an absolute, road-sized child of the road band: the end-turn preview at `zIndex` 1, the target preview at 2, the log drawer at 3, the turn banner on `overlay`.

Considered: arrows from the card in the hand, bending up out of it as the aiming line does. That was the first build; with several targets in one lane the arrows to the far raiders ran over the near raiders' plates and pills, and Kevin asked for the road-to-road version.

### Moves: every vehicle the card would move, and where

Kevin's call, after the first build: every movement card shows where vehicles go, its own and any it moves (Juke and Strafe's slots, a fixed swerve, a shove, a flank, a swap, Formation Shift). `cardMoves` plays the card each way the player could play it (each slot a first slot step offers; each vehicle a vehicle step offers, then each slot a later slot step offers for it; or the one way a card with no pick plays) on its own copy of the board, through `BoardProjection.apply`, the battle's own move rules with hit checks and on-hit shoves, and diffs the slots. A hit that would take its target out (`previewAim`'s losses against its structure or its driver) leaves the wreck where it is, as `Battle.applyMove` does, so Shoulder Check shows no shove of a raider the ram wrecks. A move every play makes is certain; one only some plays make is a choice, so a flank that lands on the same shoulder slot whichever raider it outruns is solid.

`TargetPreview` draws each move from the middle of the mover's plate to the middle of the slot (`RoadArc.traceMove`), bowed left of the way it goes so two vehicles trading slots draw two arcs, and starting where it comes out from under the mover's token (`RoadArc.leaves`). Solid when certain, dotted when it hangs on a pick, in the mover's side's colour. A first slot step's slots are drawn as these moves.

Considered: per-card move rules in the screen (Lane Change goes to the other lane, Formation Shift swaps every row). `apply` already is the rule, kept true by the battle's tests; restating it would drift.

### Which preview has the road

`Card.presented` is hover or visible focus while the card is enabled, the same condition that lifts it, and `onPresentedChange` reports it, unmount included (which clears hover and focus without a state change). `PlayerHandLayer.presentedCard` keeps the latest presented card, falling back to any other that still is. A hand card's preview and END TURN's never draw together: whichever started previewing last has the road, and when it stops the other has it back if it's still previewing (call 369). The screen ignores presented changes while it deals, when a card leaving can present another whose new state isn't dealt yet, and refreshes once the deal is done; a presented card outside targeting that the deal didn't find playable throws.

## Consequences

- A card with nothing it could pick can't be picked or dragged. Strafe with no slot that puts a raider in reach is one, so `enterAimStep`'s put-back for it only fires if the board changes between deal and pick.
- The dock's gallery scene shows a NO TARGET card in its first hand.
- The preview isn't in a gallery scene of its own; `CombatScreenTargetPreview.test.ts` checks where its arrows start and land, their colour and heads, the solid and dotted cases, moves, keyboard focus, the aim and END TURN taking over, and the gates; `cardTargets.test.ts` checks the rules.
- An arrow to a raider in a far row crosses whatever sits between, as the intent lines do.
- Leapfrog draws three arrows: the target and both ends of the swap. A card whose moves fan out over two picks (Fall In: each escort, then each empty slot) draws every combination, dotted. Rally the Convoy shows each escort's pick on the board as it stands, though the battle picks again after each shot.

## Provisional calls

Pending Kevin's approval in [gameplay-calls.md](../gameplay-calls.md) (Hand target preview).

- 365: a card with nothing it could pick is disabled in the hand, because picking it could only end in putting it back.
- 366: a disabled card its driver can pay for says why on its strip: NO ATTACKS (the mock's), NO TARGET for nothing to pick, CAN'T PLAY for every rule the battle checks before targets, because the battle's blockers are log sentences without codes.
- 367: the strip draws at full strength over the dimmed card with its words at the left, where the mock dims it with the card and centres them, because it's the one thing on a dimmed card to read and a fanned card at the cap shows only its left side.
- 368: a card on the vehicle it acts from draws no arrow to itself, because an arrow needs two ends.
- 369: a hand card's preview and END TURN's never draw together; whichever was asked for last has the road, because both draw lines over the same tokens.
