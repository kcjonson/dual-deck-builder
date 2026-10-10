# Area map and run route: the supply run's pick on the real map (DDB-43, DDB-319, DDB-479)

Date: 2026-10-10. Code: `src/renderer/game/screens/area-map/` (`AreaMapScreen.ts`, `planningMap.ts`, `areaMapText.ts`), `screens/run-route/RunRouteScreen.ts`, `ui/RouteCard.ts`, the view's new inputs in `ui/areaMap/` (`layers.ts`, `AreaMapView.ts`, `areaMapStyle.ts`), `campaign/SupplyRun.ts` (`routesOnOffer`, `getPlanBlocker`, `departRun`), `campaign/MapRoutes.ts`, and the compound's Plan button. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The area map, The run route screen, Racing the dark), [Game Flow and UI](../specs/Game%20Flow%20and%20UI%20Specification.md) 3.1, 3.3, and 3.4, and [Area Map Generation](../specs/Area%20Map%20Generation.md) (World space, Routes, Rendering). Builds on [mvp-supply-run.md](./mvp-supply-run.md), [area-map-view.md](./area-map-view.md), [stops-and-routes.md](./stops-and-routes.md), and [map-pipeline-worker.md](./map-pipeline-worker.md).

## Context

The run loop (mvp-supply-run.md) picked from seeded mock routes on a route pick screen. The map now has POIs, a route tree, stops, and route descriptors, and a campaign keeps its map for the session (`getAreaMap`), founded on it or made again on Continue. The MVP is a playable run on the real map: start a game, pick a destination on the area map, pick one of its routes, drive it, come home. Fog, atlas styling, POI states, the legend, and opening the map from everywhere are later work, so every POI shows as known and unvisited.

## The flow

Compound, Plan a supply run, then the area map screen, then a POI's run route screen, then Load out the crew, which runs the quick load out and departs into the run screen. Back goes the other way at each step: the run route to the area map with its POI still chosen and Plan a run here focused, the area map to the compound with Plan a supply run focused.

## The routes on offer are the map's

`routesOnOffer({ map })` is every route `routeOffers(map)` gives, but a stronghold's. Every caller hands it the campaign's own map: `getPlanBlocker({ campaign, map })`, `departRun({ campaign, map, route, escorts })`'s check that a route is on offer, both screens, and the compound. The offer is worked out once a map (a `WeakMap` on the map object), since the compound asks on every refresh.

- The mock routes (`supplyRoutes`) are gone, and so is `offersForDay`. Every test that departs runs on a mesh map (`meshMap`), which has POIs, strongholds, routes, and stops, so nothing needs a mapless campaign. The route model's types live in `SupplyRoutes.ts` alone; `MapRoutes.ts` builds them and gives the id helpers (`destinationId`, `routeId`) the screens use to find a descriptor's run route.
- No day gates the map: any known POI can be picked, at any tier, past dark or not (calls 89 and 91 below). `departRun` still finds the route by id, so what's checked is what's paid.
- A stronghold's routes aren't offered, so `departRun` refuses one even if a screen asked (call 90).

## Getting the map to a screen

`getAreaMap` answers with a promise, made again on Continue in the worker in most of a second. `PlanningMaps` sits between the cache and the screens: it keeps each campaign's map once it has arrived, by campaign instance, so a screen mounted after it can draw it and enable its buttons at mount. That's what lets focus come back to Plan a supply run or Plan a run here on Back (ScreenManager restores focus by id at mount, and a disabled button can't take it). A campaign's map never changes, so nothing kept goes stale; a campaign loaded again is another instance and waits once. Each screen waits with `mapProgressText` on its status line (the compound on Plan's line), passes an `AbortSignal` it aborts on unmount, and drops an answer that arrives after it has gone.

The screens read a `PlanningMap`, the parts of a generation they use (the POI and stop layers and params for the routes, the water's land and rivers and the road network for the view), so tests hand them a mesh map on flat ground (`screens/area-map/testing.ts`) instead of a generation.

The screenshot harness gates on `assetsReady`, which now also waits for `CampaignMaps.making`, so a capture of a screen making its map waits for the map, not two still frames of the progress line.

## The area map screen

The whole disc in an `AreaMapView`, fitted to the window, and a 340 px side panel: Back and the heading, the status line, the destinations, and the chosen POI's details over Plan a run here.

- Every POI is a marker with its tier as a badge in its disc. A POI no route gets home from by dark has a night ring. Strongholds are diamonds. Labels are the POI names (`poiNames`, type and bearing until the names stream), placed before anything else is drawn: the chosen one first, then nearest first, each on its marker's right or else its left, and left out when neither side is clear of Home's label, the picked route's stops, another marker, or a label already placed, until the zoom makes room; the chosen one takes its right when neither side is clear (the spec's "placed by priority with collision boxes"). The places' names come after, on the dot's right or else its left (its left too where the right would run off the view's edge), and are left out where both would cover a marker or a POI's label: the markers are what the map is picked by. Home's label is drawn last, over any marker near it, and the picked route's stops over the labels.
- The view draws the generation's land with its hazards and its places, as the gallery's area map does.
- The destinations are a list, nearest first (by tier, then the quickest route's hours out, strongholds last), as `ListRow`s in a single-selection focus group, each with its tier and "past dark" where no route is home by dark. It's the keyboard's way to the POIs, since a marker isn't a focusable child of the view (area-map-view.md). Tab goes Back, the list, Plan a run here, then the map, which pans with the arrows. Focus moving onto a row chooses its POI, so the arrows choose as they move. Picking on the map scrolls the list to the row; picking in the list brings the POI into view on the map if it's out of it.
- A click on a marker picks through the view's own world-space hit test (`AreaMapView.pick`, through `MapCamera`). A click anywhere else, a road included, clears the choice: roads aren't destinations.
- The details: name, type and tier, what it yields, how many routes and the quickest's hours out, and how many get home by dark. The quickest route is the one with the fewest hours out, stops included, as every screen shows hours; the descriptors come in order of driving hours, which their ids follow and which isn't always the same route (`PlannedPoi.quickest`). The list's order and the run route's pick read the same. Plan a run here is off, with the reason, for a stronghold ("Not yet"), for a POI no road reaches, and for whatever keeps the compound's Plan off but fuel (a run out, nobody fit). Too little fuel for this POI doesn't turn it off, since the run route screen says which routes can go.

Options considered for keyboard access: focusable markers inside the view (the view would need focus parts and a roving index, and its arrows already pan), and a key in the view that steps the selection through the markers (invisible, and nothing else in the game works that way). The list is the game's existing pattern for picking one of many, and it reads the destinations in text.

## The run route screen

The view cropped to the compound, the POI, and every route (the spec's crop rule), at least 800 world units each way so a POI near home isn't drawn so close that the baked land shows its texels, and a 360 px side panel.

- Each route draws as an opaque band under the roads, the picked one wide in a colour nothing else on the map uses with its stops marked over everything (a fight a diamond, anything else a square), the others a little narrower in a pale tint of it, so they read on dark ground and under highways, and an opaque band doesn't bead at its joints as a translucent one does. The view's new `routes` input is a polyline per route in world space, built from the route's legs (`legPoints`) end to end.
- A card per route, from its descriptor: name, then "charted / 4 stops / 5.2 h out / fuel 4 / risk 2 of 3" (hours marked "about" off charted road, and no-break spaces inside each part so it wraps only between them), and a warning line: the fuel the stores can't pay, or "Back after dark." The cards are `RouteCard`s, list rows grown to three lines at a fixed height, in a single-selection focus group. Picking one highlights its route and stops on the map, lists its stops in order with a tag for the kind and skulls for a fight, and shows the time it'd be home against dark, "the next morning" past midnight.
- The quickest route the stores can fuel is picked on arrival, or the quickest of all when none can be.
- When the checkpoint finds the store has moved on from this campaign, the screen says nothing more is saved, Load out turns off with that reason, and Back and Escape go to the menu, where Continue picks up the save.
- A route past dark warns, in the card and on the home-by line, and Load out stays on. A route the stores can't fuel is dimmed with the reason on its card, can still be picked and read, and Load out is off while it's picked, with the same reason under it.
- The stops show their real types. The run takes every stop but a fight as a quiet stretch for now (stops-and-routes.md, call 14), and a line under the stops says so.
- Opened with no POI, as a capture does, it shows the nearest destination.

## The compound

Plan a supply run opens the area map. Its blockers are the run loop's, now read against the map: until the map is in, Plan is off and its line says how far it's got; when the map couldn't be made, the line says so. With a run possible, the line counts the destinations on the map. The Map room and the top bar's Area map button stay off: opening the map just to look is a follow-up, and the Map room's line says Plan a supply run opens it.

## Provisional calls

None of these is in a spec. They're on DDB-432 as 89 to 93.

- 89: any known POI can be picked; the day-offer rule (call 81, `offersForDay`: tier 1 plus up to two) no longer gates the map, and `departRun`'s on-offer check accepts any route the map offers.
- 90: strongholds are shown, but Plan a run here is off for them ("Not yet") until assaults exist, and their routes aren't offered.
- 91: a route past dark warns and can still go; there's no night penalty yet.
- 92: Plan a supply run opens the area map; Load out the crew runs the quick load out stub and departs.
- 93: POI state isn't tracked yet: every POI shows as unvisited, and yields don't deplete.

Made here, within those:

- A route the stores can't fuel stays pickable, dimmed with its reason, so its stops can be read; Load out is what's off.
- Too little fuel for a POI's routes doesn't turn off its Plan a run here; the run route screen says which routes can go.
- The destinations list is the keyboard's way to the POIs, nearest first; the map comes last in the focus order.
- The run route frame is at least 800 world units each way.

## Consequences

- Fog and knowledge (DDB-294) change what the descriptors and `routeOffers` are given (`knowledge`), what the markers and the list show, and the area map's frame (`revealedBounds`); the screens already pass every leg as charted, and the cards already show rumored and uncharted routes.
- POI states (looted, depleted) go on the markers (`MapMarker.state`) and the details, and the yield in the details reads the state.
- The atlas styling (DDB-447) restyles the bands, badges, and rings in `areaMapStyle.ts`; the spec's side-by-side bands where routes share road and lettered routes are part of it.
- The load out screen (DDB-320) takes Load out the crew's place after the run route screen, as the quick load out did.
- The full run controller (DDB-322) shows the run's progress on the run route view; the run screen still stands in for it.
