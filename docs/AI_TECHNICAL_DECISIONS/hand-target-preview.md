# Hand target preview and blocked cards

## Date
2026-10-24, DDB-554 (DDB-272). Design source: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) section 6, Planning, and the mock's `.cant` and `.pblock`. Builds on [targeting-preview.md](./targeting-preview.md) and [slot-targeting.md](./slot-targeting.md).

## Context

The hand disabled a card only for what `Battle.canPlayCard` checks: adrenaline, a passenger's attack, and the card rules (`getCardBlocker`: already flanking, boxed in, no room to swerve, a signature card's escort gone). A targeted card with every raider out of reach passed, so it showed as playable and, when picked, waited for a target nothing could be. And a dimmed card never said why, apart from the red cost on an unaffordable one.

Nothing showed what a card would hit before it was picked either. The legal targets only lit up once a card was aimed.

## Decisions

### What a card would offer, worked out once per deal

`cardTargets.ts` holds the targeting rules the screen used to keep as private methods: `targetableVehicleIds` (the card's side of the road by target type, then `Battle.getTargetBlocker`), `aimSlots` (the battle's destinations, kept to slots that put a target in reach when a vehicle step follows), and `cardTargets`, which answers for a card in the hand what its first step would offer if it were picked now, as the aim's steps run it (`aimStepsOf`, skipping a slot step the battle says isn't needed). A card that takes no pick lists what it acts on instead (`actsOnVehicleIds`: the caster's vehicle, every raider, both drivers' vehicles), with `picks` false. It also carries the vehicle the card acts from: the playing driver's, or for an attack order the escort `orderCarrier` picks for each raider.

`updateUIFromBattle` works it out for every card the rules let through and keeps it by card, so hovering reads a map and computes nothing. One `BoardProjection` serves the whole hand: `canPlayCard`, `getTargetBlocker`, `moveDestinations`, and `needsDestination` take an optional `board`, as `getCardBlocker` already did, since the team's `change` events re-deal the hand several times in one play.

Considered: putting the "has a target" check in `Battle.canPlayCard`. The candidate list by target type is the screen's reading of who a card can be dropped on, and the AI asks its own projection; the battle's rule stays the per-target one both share.

### A blocked card says why

`buildPlayerHandView` takes a `hasTarget` callback beside `canPlay`, asked only of a card `canPlay` passed, and returns `blocked`, a label for each card its driver can pay for but can't play: NO ATTACKS for a passenger's attack (the mock's own words), CAN'T PLAY for a card rule, NO TARGET for nothing to pick. An unaffordable card keeps the red cost section 6 gives it and no strip.

The card face shows the label on `CardBlockStrip`, the mock's `.pblock`: 64 down across the art, 16 tall, light pink mono on a dark red band. It's a child built the first time a card is blocked, after the art icon so it covers it. It draws at full strength over the dimmed card rather than dimmed with it as the mock's filter would, since it's the one thing on a dimmed card to read. The words start at the left rather than the mock's centre: at the hand's cap a fanned card shows about its left 68 px.

Considered: one label per `getCardBlocker` reason (FLANKING, BOXED IN, NO ROOM). The reasons are sentences for the log; mapping them to labels would mean matching strings, so they share CAN'T PLAY until the blockers carry a code.

### Arrows from the vehicle, like the raiders' lines

`TargetPreview` draws while a playable card is `presented` (pointed at, or keyboard or controller focused, while enabled) on your turn with nothing aimed or dragged. Kevin's call: the arrows run from the vehicle on the road the card acts from to each target on the road, as the raiders' intent lines run from their pills, not from the card in the hand. Each arrow leaves the top of the acting vehicle's plate and lands on the top of the target's token, over the band a raider's pills take, so the head never covers them; a slot target takes the arrow into its middle. A card on the vehicle it acts from (Armor Plating, Nitro Boost) draws no arrow to itself.

Solid when there's nothing to choose: one target, or a card that lands on every one it lists (Volley on all raiders). Dotted, with the aiming line's dots and head, when the player will pick one of several. Red to a raider and the interaction yellow to your convoy, as their outlines light while aimed, at the intent lines' 80%.

The arc is `RoadArc`, lifted out of `EndTurnPreview`, which now draws along it too: up from one end, across, and down onto the other, rising 20 over the higher end and never into the lane header. Like the end-turn preview, the preview is an absolute, road-sized child of the road band under the log drawer, and reads both ends from the road's tokens at paint time into buffers it reuses.

### Moves: every vehicle the card would move, and where

Kevin's call, after the first build: every movement card shows where vehicles go, its own and any it moves (Juke and Strafe's slots, a fixed swerve, a shove, a flank, a swap, Formation Shift). `CardTargets.moves` lists them: `cardMoves` plays the card each way the player could play it (each slot a first slot step offers; each vehicle a vehicle step offers, then each slot a later slot step offers for it; or the one way a card with no pick plays) on its own `BoardProjection` through `apply`, the battle's own move rules with hit checks and on-hit shoves, and diffs the slots. A move is a `choice` unless the card can play only one way. Only cards with a `change_position` effect pay for this, once per deal.

`TargetPreview` draws each move from the middle of the mover's plate to the middle of the slot (`RoadArc.traceMove`), bowed left of the way it goes so two vehicles trading slots draw two arcs, and starting where it comes out from under the mover's token (`RoadArc.leaves`). Solid when certain, dotted when it hangs on a pick, in the mover's side's colour. A first slot step's slots are drawn as these moves, not as target arcs from the plate.

Considered: per-card move rules in the screen (Lane Change goes to the other lane, Formation Shift swaps every row). `apply` already is the rule, kept true by the battle's tests; restating it would drift.

Considered: arrows from the card in the hand, bending up out of it as the aiming line does. That was the first build; with several targets in one lane the arrows to the far raiders ran over the near raiders' plates and pills, and Kevin asked for the road-to-road version.

### Which card is presented

`Card.presented` is hover or visible focus while the card is enabled, the same condition that lifts it, and `onPresentedChange` reports it, unmount included (which clears hover and focus without a state change). `PlayerHandLayer.presentedCard` keeps the latest presented card, falling back to any other that still is, and its `onPresentedChange` drives the screen's `refreshTargetPreview`, which also runs on every deal, on `isTargeting` changing, and when a drag starts or ends.

## Consequences

- A targeted card with nothing in reach can no longer be picked, so the "no slot that puts a target in reach" put-back in `enterAimStep` only fires if the board changes between deal and pick.
- The dock's gallery scene shows a NO TARGET card in its first hand.
- The preview isn't in a gallery scene of its own; `CombatScreenTargetPreview.test.ts` checks what it draws (polylines, dots, heads) for one, several, and all targets, slots, keyboard focus, and the aim taking over.
- The arrows to a raider in a far row cross whatever sits between, as the intent lines do.
- A swap (Leapfrog) draws three arrows: the target arc and both moves, and a move into an occupied slot lands on the other vehicle's plate.
- A card whose moves fan out over two picks (Fall In: each escort, then each empty slot) draws every combination, dotted.
