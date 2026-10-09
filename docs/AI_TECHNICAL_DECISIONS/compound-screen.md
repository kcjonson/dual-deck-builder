# The compound screen, the campaign's hub (DDB-301)

Date: 2026-10-09. Code: `src/renderer/game/screens/compound/CompoundScreen.ts` and `compoundText.ts`. Specs: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 3.1, [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The compound, The driver pool), and the wireframe `docs/design/supply-runs/compound.png`. Replaces the placeholder from [main-menu-campaigns.md](./main-menu-campaigns.md) under the same registry name and data contract, and uses [day-clock.md](./day-clock.md) and [campaign-save-and-load.md](./campaign-save-and-load.md) as built.

## Context

New Campaign and Continue open `compoundScreen` with `{ campaign }`, and until now that was a placeholder showing the summary and the stores. The hub needs the buildings as its menu, the day and resources along the top, a needs panel, and Plan a supply run, but none of the screens the buildings open exist yet, nor the area map, load out, or the run route. The one thing the compound can already do is rest: `endDay` turns the day and `forecastNeeds` says how long the food and water last.

## Decisions

### Layout

A top bar (Back to menu, the title over the day, the Area map button, the resources as chips at the right end), then a body of two parts. The buildings take the room on the left: two rows of three tiles in the wireframe's order, each filling its share, where the illustrated scene will go. Each tile is a description and a reason over a block button carrying the building's name, at the tile's foot so the buttons line up whatever the text above them wraps to. The side column is 320 wide: the needs panel fills it, over Rest and Plan a supply run. Both gate sizes lint clean (R13.29); a long needs list scrolls inside the panel (R12.20), with Page Up and Page Down.

Considered: a pressable tile drawing its name and text itself, closer to the wireframe's clickable boxes. It needs its own draw, look states, and parts for the lint, and a disabled tile would still need its reason as text; a button in a box is the main menu's pattern with a border round it.

### Disabled with the reason on screen

The six buildings, the Area map, and Plan a supply run are disabled, each with a line of text saying why, as Continue on the main menu is. A disabled control takes no focus and shows no hover (R9.5), and a tooltip needs one or the other (R12.22), so the reason can't be a tooltip. When a building's screen lands, its entry in `BUILDINGS` gets a null reason and an action, and the button enables.

### Rest

Rest calls `endDay`, shows the new day, stores, and needs straight away, then awaits `CampaignStore.checkpoint`. A second press before the checkpoint resolves does nothing, so the next step starts after it, as the store asks. The screen listens to `onSaveFailed` while mounted and puts the store's message under Rest in the critical colour. Rest's own line says what the night costs ("Ends day 9. The compound eats 5 food and 5 water."), and a report line under it says what the last night did: the day that ended, any shortfall and the people it cost, and who is fit again.

### The needs panel

Boxed lines, as the wireframe draws them: a forecast for food and for water from `forecastNeeds` ("Food runs out in 6 days", or "Food runs out tonight, 2 short" in the critical colour), then each injured driver ("Mechanic 1 is injured, fit in 2 days"), then "Radio: no new rumors" until rumors exist (DDB-337).

### The fallen compound

When `endDay` reports `abandoned` (People reached 0), the screen saves the day first, then opens a small modal notice (R12.21): "The compound has fallen", one Back to menu button, and whatever closes it (the button, Escape) goes to the menu. It's one method, `compoundFell`, so the defeat screen (DDB-305) replaces its body with a navigate. It doesn't end the campaign in the store; that's DDB-305's, with the ending the spec picks by the compound's state.

### Focus and keys

Focus starts on Back to menu. Tab reaches only live controls (R9.18, R9.19), so with everything else disabled it moves between Back and Rest. The buildings are one focus group with arrows in both axes, and Rest and Plan a supply run another (R9.29), ready for when they're live. Escape goes back to the menu with focus restored on the button that opened the compound, as Back does from the menu's other screens; under the notice the modal scope takes Escape instead (R9.20).

## Provisional calls

Each is the simplest option where the spec leaves a choice open, and a line or two to change.

- Rest is a button in the side column above Plan a supply run, not a building or the wireframe's gate, and it asks nothing first.
- Focus starts on Back to menu rather than Rest, so a stray Enter can't spend a day.
- The forecast shows for food and water whenever anyone is there to eat, however far off the shortage; only tonight's shortfall is marked urgent. A warning threshold ("runs out in 2 days or less") would be one comparison.
- The resource chips show amounts only. The wireframe's "Food 18 (6 days)" is in the needs panel instead, which keeps the top bar inside 1024 px.
- The compound is "The Compound": campaigns have no names.
- The wireframe's driver pool list, its escorts and losses lines, and the gate tile are left out. The needs panel lists the injured; the roster is the bunkhouse's Crew screen (DDB-314), and the convoy is load out's and the garage's.
- Each Rest reports the night under it. Nothing else shows the log.
- The fallen notice leaves the save in place at 0 People, so Continue reopens it until DDB-305 ends the campaign, and every Rest there reports `abandoned` and shows the notice again.

## Harness

`compoundScreen`'s goldens are re-minted at both sizes, still opened with no campaign so the screen loads the in-progress save. The escort card's three gallery scenes joined `SCENE_SCENARIOS` with `lintShort`, so the gallery and lint specs hold them and the electron project gets goldens for them, and their own spec (`escortCards.spec.ts`) is gone. The area map's scenes stay where they are until its PR (#176) lands.

## Consequences

- Each building screen that lands gives its `BUILDINGS` entry an action and drops its reason; the Area map button and Plan a supply run follow the area map, load out, and the run route. When the first building is live, focus could start on the buildings instead of Back.
- The needs panel takes rumors when the radio mast has them (DDB-337), and the infirmary's meds line ("out of meds, a driver can't heal") when meds speed healing (DDB-304).
- DDB-305 replaces `compoundFell` with the defeat screen and ends the campaign in the store.
- The scavenging party (DDB-303) is a second day-ending action beside Rest, with the same end-then-checkpoint shape.
