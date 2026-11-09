# The battle scene on salal

## Date
2026-11-09

## Context

The battle scene was the last placeholder in the port: each driver's hand as rows, a row per target once a card was picked (with the same target twice when two plays differed only in their slot), the raiders as lines of text, and an End Turn button that ran the whole enemy turn and showed its end, vehicles a turn later and HP lower with nothing to say why, since the scene dropped every event `apply` returned. [Battle Screen Design](../specs/Battle%20Screen%20Design.md) is the screen, and the TypeScript built it in `_legacy/src/renderer/game/screens/combat/`. What it waited on was salal's drag tier, which v0.39.0 brought (`ui/Drag.h`).

Three questions needed answers the TypeScript didn't give: how the screen shows an enemy turn that the rules play inside one `apply`, how aiming a card fits salal's declared drag and drop, and which theme the scene draws in now that the meta scenes are the atlas.

## Options considered

How the enemy turn plays back:

1. **Step the rules.** The TypeScript's `stepEnemyTurn` played one raider's action a call ([enemy-turn-pacing.md](./enemy-turn-pacing.md)). The alpha's rules play the whole turn inside `EndTurn` by design (battle-state.md, Turns), so a fight never rests mid-enemy-turn and a copy never has to; stepping would put that state back.
2. **Replay the fight on copies,** applying each raider's step to a copy to get the state between beats. The rules have no entry for one step of a plan, so this is option 1 again.
3. **A picture moved by the events (chosen).** The scene keeps a copy of the fight from before the action and moves it beat by beat by each event's own numbers: a hit takes what `VehicleDamaged` says off the bars, a swerve puts the vehicle where `VehicleMoved` says, an arrival takes its seat from the fight after. No rule runs; when the last beat lands, the picture is dropped for the fight itself.

How a card is aimed:

1. **Click a card, then click a target,** the TypeScript's second path. salal has no way to start a drag from code, so a click that picks a card up would be a second targeting mode beside the drag service's.
2. **The drag service throughout (chosen).** A playable card is a drag source; its targets are declared on the road; the keys pick a card up with activate and move it among the targets that take it, which salal's service does for any source.

## Decision

**The scene is five pieces and the scene that stitches them** (`apps/wasteland-wheels/scenes/battle/`, `road/`):

| piece | what it is |
|---|---|
| `road/RoadLayout` | the bands (top bar 36, road, dock 228) and the road's grid, pure functions of the window's logical size, as road-view.md has them |
| `road/RoadPicture` | what the road shows of a fight: a `TokenData` per vehicle on it, planned swerves, intent lines, arrival rows |
| `road/RoadView` | the road drawn through Primitives and a `VehicleToken` per vehicle; every token and slot a drop target; swerves on the animator; the waiting picks of a two-step play; hit numbers and the acting raider's glow |
| `battle/Targeting` | the hand's targeting rules over `legalActions`: a card's steps, the picks at each, the play they make, and what it does, off `apply` on a copy |
| `battle/Dock` | the driver tabs, the fanned hands as drag sources, End Turn |
| `battle/BattleLog`, `TopBar`, `TurnBanner` | the log's words from the events and its drawer, the top bar, the banner |
| `battle/Playback` | the beats and the picture they move |

**Playback.** A play is one beat that lands at once. An end turn is the player's turn closing at once, the raiders' turn opening with its banner, each raider's part a beat (the first 900 ms on, each after a 700 ms beat, as Battle Screen Design 6 has them), the turn's close and any wave a beat of its own, and the player's next turn one beat after, which settles. While it plays, the dock is locked and the road keeps the plan shown when End Turn was pressed. The beats are reading time, so reduced motion keeps them.

**Aiming.** A card's steps come from the plays on offer (which of target, slot and occupant vary), ordered by the one thing read off the card: a picked move of the caster asks its slot first, a picked move of the target after it (slot-targeting.md). The first pick is the drop. A play with picks left waits on the road, its next picks pressable and focusable, the first focused; Escape or End Turn puts it back. A card that takes no pick plays wherever it's dropped on the road. A drop anywhere else, or on a target that refuses it, plays nothing.

**The dark theme.** The game's tokens are one resolver with two modes ([theme-tokens.md](./theme-tokens.md)): the palettes, faces and print styles are a set every mode shares, and each mode points ui's semantic roles at one palette, the atlas's for the meta scenes and the battle mock's for this scene (UI Art Direction, Building it: combat keeps the dark theme until its own pass).

**Layout.** The scene lays out in the ui's logical px as every other scene does, and the ui's scale setting is its scale: the spec's own `s` would have scaled the battle and nothing else. Spare height goes to the rows and spare width to the slots, with the stage capped at 1600 and the road's art bleeding to the window's edges.

## Rationale

The picture keeps "one place interprets effects": the events already say what changed and by how much, so moving a copy by them is bookkeeping, not rules, and when the beats are done the screen shows the fight itself, so the picture can't drift. The drag service is the one path salal gives a card's keys and its pointer alike, and offering only `legalActions`' plays keeps the screen from offering anything `apply` would refuse.

## Consequences

- A click on a card doesn't pick it up: a pointer drags it, and the keys pick it up with activate. Click-then-target waits on salal starting a drag from code (SAL-155).
- The end-turn preview draws each intent's line but not the incoming total on the player's plates, since `rules::Intent` doesn't split an area hit by vehicle.
- A card's id is its place in the hand and salal has no way to rename a component, so a card whose place shifts after a play is built again, and a detail view pinned on it closes.
- The picture moves only what the screen shows: bars, slots and flanks, who's aboard, statuses, spent, and who's on the road. Hands, piles and adrenaline come with the settle. Two of the rules' changes have no event: a Formation Shift moving a flanker's reserved slot, and statuses counting down as a turn opens. Both happen before the settle, so nothing on screen is wrong, but a picture between beats can't show them.
- Not ported yet: the vehicle mods on a driver's tab (the rules have none), the pile dialog, tooltips on status chips and intent pills, the swerve icon on a move intent's pill, and the acting vehicle lighting in its driver's colour while a card is aimed.
- Two raiders of one kind read the same on the road and in the log ("Scavenger's vehicle"), as Words names them.
