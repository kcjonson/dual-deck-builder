# Load out: the screen between the run route and the road (DDB-320)

Date: 2026-10-16. Code: `_legacy/src/renderer/game/screens/load-out/` (`LoadOutScreen.ts`, `LoadOutPlan.ts`, `loadOutText.ts`), `screens/run-route/RunRouteScreen.ts` (Load out the crew), `screens/developer/LoadOutLauncherSection.ts`, and `core/CampaignVisit.ts` (`checkpoint` now settles with the store's result). Specs: [Game Flow and UI](../specs/Game%20Flow%20and%20UI%20Specification.md) 1.2 and 3.4, [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (At load out: run decks). Builds on [area-map-route-pick.md](./area-map-route-pick.md) and [mvp-supply-run.md](./mvp-supply-run.md). Replaces the driver selection screen, which is deleted with its panels.

## Context

The MVP run (DDB-454) stubbed load out: Load out the crew on the run route screen called `quickLoadOut`, which seated the first legal pair on default decks with every escort, then departed. The player never saw who went or with what. A first pass at the screen (October 10) took callbacks for START RUN and Back and was paused before the run route screen existed; this finishes it against the flow as it is now.

## The flow

Run route, Load out the crew, load out, START RUN, the run screen. Load out the crew no longer changes the campaign: it opens load out with the POI, the picked route's id, a heading ("St. Brendan's Hospital by Back roads"), and a summary line. Back from load out gives up any run decks it started and returns to the run route screen with the POI, focus back on Load out the crew. START RUN starts the run decks if Customize hasn't, checks the route against the campaign's map, departs (`departRun`), saves, and opens the run screen.

## Plain data, not callbacks

Options considered:

- Callbacks (`onDepart`, `onBack`), the first pass's contract. Load out stays ignorant of routes and maps, but Customize has to carry the functions through its round trip, and a load out left mid-way can't be described in data.
- The route and POI as data, load out departing itself. Load out needs `PlanningMaps` and `departRun`, the same two things the run route screen already used to depart, and everything it's handed survives a Customize round trip.

Load out takes data. The run route screen keeps the route pick and fuel gate; load out keeps the crew, decks, and escorts, and owns the departure, since it's the last screen before the road. A departure that's refused anyway (the fuel changed, or the route left the map) says why beside START RUN and starts no run decks.

## What's picked lives in `LoadOutPlan`

The screen draws a `LoadOutPlan` and saves through a `CampaignVisit`, as Crew and Customize do. The plan holds the two seats, which escorts stay home, and the run deck lifecycle, so the rules are tested without a screen.

- It opens on `seatableCrew` (the crew the quick load out would send) and the first `MAX_CONVOY_ESCORTS` escorts. A plan made while run decks are out (back from Customize) takes them as its own.
- The crew rule (`getCrewRule`, call 35) decides how many seats a run fills: two, or one when only one driver is ready. A solo run leaves the second seat empty with a line saying why.
- Run decks start the first time they're needed, Customize or START RUN. An escort brought or left after that adds or removes its card in place. A seat change or Swap seats unwinds the decks and, if the new crew can go, deals them fresh; there's no move for a customized run deck between seats, and `startRunDecks` deals escort cards to Driver 1.
- `giveUp` unwinds on Back. A started run is never stranded (DDB-303's review note).

## Continue

A load out left before it set off is still given up on Continue (call 69): the POI and route aren't saved with the campaign, so there's nothing to reopen load out on. Saving the pending route would let Continue go back to load out; that's a follow-up if playtesting wants it.

## Provisional calls

None of these is in a spec. They're calls 177 to 181 in [gameplay-calls.md](../gameplay-calls.md).

- 177: load out opens on the quick load out's crew and every escort up to four; the player changes it from there.
- 178: a seat change or Swap seats after the run decks are out deals them fresh from the default decks, losing any customizing.
- 179: Back from load out gives up its run decks, customizing and all.
- 180: a solo run shows the second seat empty with "Solo run: nobody else is fit to go", and the synergy line says there's no partner.
- 181: the main menu's Skirmish entry goes with driver selection (call 119's condition met).

## Trade-offs

- Losing customizing on a seat change is blunt, but it's honest about what the campaign can do and is a click away from being redone. Moving a run deck between seats would need a campaign operation of its own.
- Load out depends on the area map being made. The run route screen only opens it with the map in hand, so `PlanningMaps.known` answers at once; the developer launcher opens it with no route, and START RUN says so.
