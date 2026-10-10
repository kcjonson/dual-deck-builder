# The compound screen, the campaign's hub (DDB-301)

Date: 2026-10-09. Code: `src/renderer/game/screens/compound/CompoundScreen.ts` and `compoundText.ts`. Specs: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 3.1, [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The compound, The driver pool), and the wireframe `docs/design/supply-runs/compound.png`. Registered as `compoundScreen` with the `{ campaign }` contract the main menu hands it ([main-menu-campaigns.md](./main-menu-campaigns.md)), and uses [day-clock.md](./day-clock.md) and [campaign-save-and-load.md](./campaign-save-and-load.md) as built.

## Context

New Campaign and Continue open `compoundScreen` with `{ campaign }`. The hub needs the buildings as its menu, the day and resources along the top, a needs panel, and Plan a supply run, but none of the screens the buildings open exist yet, nor the area map, load out, or the run route. The one thing the compound can already do is rest: `endDay` turns the day and `forecastNeeds` says how long the food and water last.

## Decisions

### Layout

A top bar (Back to menu, the title over the day, the Area map button, the resources as chips at the right end), then a body of two parts. The buildings take the room on the left: two rows of three tiles in the wireframe's order, each filling its share, where the illustrated scene will go. Each tile has the building's name at the top, as the wireframe does, and at its foot a description and a reason over a block button, so the buttons line up whatever the text above them wraps to. The side column is 320 wide: the needs panel fills it, over Rest and Plan a supply run. A long needs list scrolls inside the panel (R12.20), with Page Up and Page Down.

The top bar has to hold its chips at 1024 px (R13.29). It does with every store at four digits, about 30 px to spare: the Area map's reason lives on the Map room's tile rather than in the bar, and the bar's gaps are 16. Past four digits an amount is rounded down to thousands, millions, and on ("12k", "999k", "1M"), so no chip is ever wider than a four-digit one. Until there's a campaign the day and the chips are hidden rather than drawn empty.

Considered: a pressable tile drawing its name and text itself, closer to the wireframe's clickable boxes. It needs its own draw, look states, and parts for the lint, and a disabled tile would still need its reason as text; a button in a box is the main menu's pattern with a border round it.

### Disabled with the reason on screen

A building with nothing behind it, the Area map, and Plan a supply run are disabled, each with a line of text saying why, as Continue on the main menu is. A disabled control takes no focus and shows no hover (R9.5), and a tooltip needs one or the other (R12.22), so the reason can't be a tooltip. The Area map and the Map room open the same thing, so the Map room's line is the reason for both. A building whose screen exists has a null reason and the `screen` its button opens, handed the campaign on show; until there's a campaign it's disabled too, with a line saying it opens with a campaign in progress, and it doesn't open while a Rest is being saved. The bunkhouse is the first, opening the Crew screen ([crew-screen.md](./crew-screen.md)).

### Rest

Rest calls `endDay`, shows the new day, stores, and needs straight away, then awaits `CampaignStore.checkpoint`. A second press before the checkpoint resolves does nothing, so the next step starts after it, as the store asks. Rest's own line says what the night costs ("Ends day 9. The compound eats 5 food and 5 water."). Under it, a report says what the last night did: the day that ended, any shortfall in the words the log uses ("Ran short of 2 food; 2 people lost.", in the warning colour), and who is fit again. A save that fails gets a line of its own under that, the store's message from `onSaveFailed` in the critical colour, so the night's report stays; the next Rest clears it.

### The needs panel

Boxed lines, as the wireframe draws them: a forecast for food and for water from `forecastNeeds` ("Food runs out in 6 days"; "Food runs out tonight, 2 short" or, with none left, "No food: 5 short tonight", both in the critical colour), then each injured driver ("Mechanic 1 is injured, fit in 2 days"), then "Radio: no new rumors" until rumors exist (DDB-337).

### The fallen compound

When `endDay` reports `abandoned` (People reached 0) and the day has been saved, a small modal notice opens (R12.21): "The compound has fallen", one Back to menu button, and whatever closes it (the button, Escape) goes to the menu. A save at 0 People opens it as the screen shows the campaign. If the save fails that night, there's no notice: the save still holds the day before, the failure shows under Rest, and Rest tries the save again without ending another day. The notice's kicker is the campaign's day, which stops on the day the compound fell, so "Day 9 / dawn" after the report's "Day 9 ended." (with a run out, the day still turns). It's one method, `compoundFell`, so the defeat screen (DDB-305) replaces its body with a navigate. The day end ends the campaign, and the checkpoint before the notice ends it in the store, writing its history line and removing the save ([campaign-end.md](./campaign-end.md)).

### Focus and keys

Focus starts on Back to menu. Tab reaches only live controls (R9.18, R9.19): Back, the buildings with a screen behind them, and Rest. The buildings are one focus group (R9.29) whose Left and Right move through them in reading order; Up and Down go unconsumed to directional focus (R9.24, R9.26), which moves between the rows. Rest and Plan a supply run are another group. Escape goes back to the menu with focus restored on the button that opened the compound, as Back does from the menu's other screens; under the notice the modal scope takes Escape instead (R9.20).

## Provisional calls

Each is the simplest option where the spec leaves a choice open, and a line or two to change.

- Rest is a button in the side column above Plan a supply run, not a building or the wireframe's gate, and it asks nothing first.
- Focus starts on Back to menu rather than Rest, so a stray Enter can't spend a day.
- Escape on the compound goes back to the main menu, as Back to menu does. Game Flow 8.1 has Escape open a pause and settings menu, which doesn't exist yet.
- The forecast shows for food and water whenever anyone is there to eat, however far off the shortage; only tonight's shortfall is marked urgent. A warning threshold ("runs out in 2 days or less") would be one comparison.
- The resource chips show amounts only, abbreviated past four digits. The wireframe's "Food 18 (6 days)" is in the needs panel instead.
- The top bar's Area map button has no reason beside it; the Map room's tile gives it.
- The compound is "The Compound": campaigns have no names.
- The wireframe's driver pool list, its escorts and losses lines, and the gate tile are left out. The needs panel lists the injured; the roster is the bunkhouse's Crew screen (DDB-314), and the convoy is load out's and the garage's.
- Each Rest reports the night under it. Nothing else shows the log.

## Consequences

- Each building screen that lands gives its `BUILDINGS` entry a `screen` and drops its reason; the Area map button and Plan a supply run follow the area map, load out, and the run route. With a building live, focus could start on the buildings instead of Back.
- The needs panel takes rumors when the radio mast has them (DDB-337). The infirmary's meds line ("out of meds, a driver can't heal") comes with the infirmary screen, from `getTreatmentBlocker`'s `too_few_meds` ([injuries.md](./injuries.md)).
- DDB-305 replaces `compoundFell` with the defeat screen.
- The scavenging party (DDB-303) is a second day-ending action beside Rest, with the same end-then-checkpoint shape.
