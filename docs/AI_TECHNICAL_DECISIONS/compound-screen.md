# The compound screen, the campaign's hub (DDB-301)

Date: 2026-10-09, Scavenge added the same day (DDB-303). Code: `src/renderer/game/screens/compound/CompoundScreen.ts` and `compoundText.ts`. Specs: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 3.1, [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The compound, The driver pool), and the wireframe `docs/design/supply-runs/compound.png`. Registered as `compoundScreen` with the `{ campaign }` contract the main menu hands it ([main-menu-campaigns.md](./main-menu-campaigns.md)), and uses [day-clock.md](./day-clock.md), [scavenging-party.md](./scavenging-party.md), and [campaign-save-and-load.md](./campaign-save-and-load.md) as built.

## Context

New Campaign and Continue open `compoundScreen` with `{ campaign }`. The hub needs the buildings as its menu, the day and resources along the top, a needs panel, and Plan a supply run, but none of the screens the buildings open exist yet, nor the area map, load out, or the run route. The compound can already spend a day two ways: rest, where `endDay` turns the day and `forecastNeeds` says how long the food and water last, or send a scavenging party on foot (`scavenge`), which brings back a little fuel and scrap as the day ends.

## Decisions

### Layout

A top bar (Back to menu, the title over the day, the Area map button, the resources as chips at the right end), then a body of two parts. The buildings take the room on the left: two rows of three tiles in the wireframe's order, each filling its share, where the illustrated scene will go. Each tile has the building's name at the top, as the wireframe does, and at its foot a description and a reason over a block button, so the buttons line up whatever the text above them wraps to. The side column is 320 wide: the needs panel fills it, over the last day's report, Rest and Scavenge side by side, their lines, and Plan a supply run. A long needs list scrolls inside the panel (R12.20), with Page Up and Page Down.

The top bar has to hold its chips at 1024 px (R13.29). It does with every store at four digits, about 30 px to spare: the Area map's reason lives on the Map room's tile rather than in the bar, and the bar's gaps are 16. Past four digits an amount is rounded down to thousands, millions, and on ("12k", "999k", "1M"), so no chip is ever wider than a four-digit one. Until there's a campaign the day and the chips are hidden rather than drawn empty.

Considered: a pressable tile drawing its name and text itself, closer to the wireframe's clickable boxes. It needs its own draw, look states, and parts for the lint, and a disabled tile would still need its reason as text; a button in a box is the main menu's pattern with a border round it.

### Disabled with the reason on screen

A building with nothing behind it and the Area map are disabled, each with a line of text saying why, as Continue on the main menu is. Plan a supply run opens the route pick ([mvp-supply-run.md](./mvp-supply-run.md)), and its line says how many routes today offers, or, disabled, why (`getPlanBlocker`). A disabled control takes no focus and shows no hover (R9.5), and a tooltip needs one or the other (R12.22), so the reason can't be a tooltip. The Area map and the Map room open the same thing, so the Map room's line is the reason for both. A building whose screen exists has a null reason and the `screen` its button opens, handed the campaign on show; until there's a campaign it's disabled too, with a line saying it opens with a campaign in progress, and it doesn't open while a day end is being saved. The bunkhouse is the first, opening the Crew screen ([crew-screen.md](./crew-screen.md)).

### Rest and Scavenge

The two ways to spend a day at home sit side by side, Rest a day and Scavenge, each half the column, with their lines under the pair. Rest calls `endDay`; Scavenge calls `scavenge`, which rolls the party's haul and ends the day with it in the same set. Either shows the new day, stores, and needs straight away, then awaits `CampaignStore.checkpoint`. They share one guard: a second press of either before the checkpoint resolves does nothing, so the next step starts after it, as the store asks, and the buildings don't open meanwhile. Nor does a press within 300 ms of a day ending, timed on the frame clock: a checkpoint to local storage lands within the frame, so without it a double-click's second half spent a second day.

The buttons stay where the pointer left them. The column's actions sit at its foot under the needs panel, so anything under the buttons that changes height would move them: the report and the save failure go above the buttons, where the column grows upward into the panel, and Rest's and Scavenge's lines are each held at two lines of caption, the most either takes, a longer one ending in an ellipsis.

Rest's line says what the night costs ("Ends day 9. The compound eats 5 food and 5 water."). Scavenge's, under it, says what the party would bring back today, in one line at 320 ("Scavenging ends it too, with 2 fuel and 13 scrap."). The haul is rolled ahead from the day's own stream (`rollScavengeHaul` on the campaign's seed and day), so the line is what the press brings, not a range. Over the buttons, a report says what the last day did: for Scavenge, the party's haul in the words the log uses first ("A scavenging party brought back 2 fuel and 13 scrap."), then the day that ended, any shortfall ("Ran short of 2 food; 2 people lost.", the whole report in the warning colour), and who is fit again. A save that fails gets a line of its own under that, the store's message from `onSaveFailed` in the critical colour, so the day's report stays; the next Rest or Scavenge clears it.

Each is disabled with its reason in its line's place while it can't end the day. While a run is out both are, since the run's return ends the day: "A run is out, and its return ends the day." under Rest, and "A run is out, so no party goes until it's home." under Scavenge (`getScavengeBlocker`'s `run_out`). Scavenge also says "The campaign is over, so no party goes out." (`campaign_over`) and "Nobody is left to send out." (`abandoned`, People 0 with a run out). Rest stays live once the campaign is over, to save its end again, and when a scavenged night ends the campaign and disables Scavenge under focus, focus moves to Rest rather than to nothing (R9.28).

### The needs panel

Boxed lines, as the wireframe draws them: a forecast for food and for water from `forecastNeeds` ("Food runs out in 6 days"; "Food runs out tonight, 2 short" or, with none left, "No food: 5 short tonight", both in the critical colour), then each injured driver ("Mechanic 1 is injured, fit in 2 days"), then "Radio: no new rumors" until rumors exist (DDB-337).

### The fallen compound

When a Rest's or a Scavenge's night leaves no People, the day end ends the campaign (`campaign.isOver`), and the checkpoint after it ends it in the store, writing its history line and removing the save ([campaign-end.md](./campaign-end.md)). Once that lands, the screen goes to the defeat screen, handed the campaign, once; nothing else starts on the way. A save holding a campaign already over (another tab's, or a hand-made one) is checkpointed as the screen shows it, which ends it the same way, then the defeat screen opens.

If the checkpoint fails, the screen stays: the failure shows over the buttons, Rest's own line says it saves the end again, Scavenge is disabled as over, and Rest tries the checkpoint again without ending another day. After the night, the save still holds the day before until that checkpoint lands; a save already over stays as it was.

The screen acts on what the checkpoint resolves (`CheckpointResult`). A lost campaign goes to the defeat screen when its end is in the history, from this checkpoint or an earlier one (`ended`). When the store has moved on from this instance (`retired`: the save was loaded again, replaced, or deleted; or `ended` for a campaign still standing, ended elsewhere), the screen is stranded, lost campaign or not: it says over the buttons that nothing more is saved here, Rest, Scavenge, and the Bunkhouse turn off, each saying why, focus on one of them goes to Back to menu, and Back to menu picks up the save. A lost instance stranded this way has no line in the history; the save still holds the day before its fall.

A save at 0 People with a run out isn't over, since the end waits for the run; Rest and Scavenge wait for the run too.

### Focus and keys

Focus starts on Back to menu. Tab reaches only live controls (R9.18, R9.19): Back, the buildings with a screen behind them, and Rest. The buildings are one focus group (R9.29) whose Left and Right move through them in reading order; Up and Down go unconsumed to directional focus (R9.24, R9.26), which moves between the rows. Rest, Scavenge, and Plan a supply run are another group, one Tab stop entered at Rest, or at whichever was last focused (R9.29): Down goes to Scavenge as the group's next member, and Right does too, as directional focus finds it beside Rest. Rest and Scavenge could be a horizontal group of their own inside it, Left and Right between them and Down to Plan, but a nested group is no Tab stop of its own, and while Plan is disabled the outer group would have no member to stop at. Plan is live when a run can go, so that nesting is open again. Escape goes back to the menu with focus restored on the button that opened the compound, as Back does from the menu's other screens.

## Provisional calls

Each is the simplest option where the spec leaves a choice open, and a line or two to change.

- Rest and Scavenge are buttons side by side in the side column above Plan a supply run, not buildings or the wireframe's gate, and neither asks anything first.
- Scavenge's line shows the exact haul the press will bring, since the stream is the day's and nothing between now and the press changes it. A range ("1 to 2 fuel") would hide less of the future but say less.
- Focus starts on Back to menu rather than Rest or Scavenge, so a stray Enter can't spend a day.
- Escape on the compound goes back to the main menu, as Back to menu does. Game Flow 8.1 has Escape open a pause and settings menu, which doesn't exist yet.
- The forecast shows for food and water whenever anyone is there to eat, however far off the shortage; only tonight's shortfall is marked urgent. A warning threshold ("runs out in 2 days or less") would be one comparison.
- The resource chips show amounts only, abbreviated past four digits. The wireframe's "Food 18 (6 days)" is in the needs panel instead.
- The top bar's Area map button has no reason beside it; the Map room's tile gives it.
- The compound is "The Compound": campaigns have no names.
- The wireframe's driver pool list, its escorts and losses lines, and the gate tile are left out. The needs panel lists the injured; the roster is the bunkhouse's Crew screen (DDB-314), and the convoy is load out's and the garage's.
- Each Rest or Scavenge reports the day over the buttons. Nothing else shows the log.
- A press within 300 ms of a day ending ends nothing, the double-click guard. A slower second click is a second day.

## Consequences

- Each building screen that lands gives its `BUILDINGS` entry a `screen` and drops its reason; the Area map button follows the area map, and Plan a supply run moves from the MVP route pick to it. With a building live, focus could start on the buildings instead of Back.
- The needs panel takes rumors when the radio mast has them (DDB-337). The infirmary's meds line ("out of meds, a driver can't heal") comes with the infirmary screen, from `getTreatmentBlocker`'s `too_few_meds` ([injuries.md](./injuries.md)).
- While scavenging costs and risks nothing, it's never worse than a day of rest ([scavenging-party.md](./scavenging-party.md)), so Rest is a button with no reason to be pressed until one of them changes.
