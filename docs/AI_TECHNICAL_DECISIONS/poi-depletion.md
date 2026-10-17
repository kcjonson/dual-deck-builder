# POI depletion: looted, depleted, and refilling (DDB-483)

Date: 2026-10-16. Code: `src/renderer/game/campaign/PoiStock.ts` (the stock and its rules), `MapState.ts` (its reader), `SupplyRun.ts` (`routesOnOffer`, `arrivedAt`), `DayClock.ts` (`DAY_END_HOOKS.poiRefills`), `MapRoutes.ts` (`poiOf`), `SaveUpgrades.ts` and `CampaignStore.ts` (version 8 saves), `CampaignHistory.ts`, and the screens' text and markers in `screens/area-map/` (`planningMap.ts`, `areaMapText.ts`, `AreaMapScreen.ts`), `screens/run-route/RunRouteScreen.ts`, and `screens/run/RunScreen.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The area map, POIs) and [Area Map Generation](../specs/Area%20Map%20Generation.md) (Saving). Builds on [area-map-route-pick.md](./area-map-route-pick.md) (its call 93 is superseded here), [mvp-supply-run.md](./mvp-supply-run.md), [day-clock.md](./day-clock.md), and [campaign-save-and-load.md](./campaign-save-and-load.md).

## Context

Until now every POI showed as unvisited and gave its full yield however often it was run. The spec says a POI holds a limited amount, each successful run takes a share, two or three runs deplete it, which pushes the compound outward, and a depleted POI refills over many days, starting value 20. The area map view already draws `MapMarker.state` (looted, depleted); nothing set it.

## The stock

A POI holds `POI_SHARES` (3) runs' worth. Each run that reaches it takes one. Shares come back one at a time over `POI_REFILL_DAYS` (20) nights from the last run: a share on each night that passes another third of 20, so a depleted POI has a share back after 7 nights, two after 14, and is full after 20. Every POI that isn't full refills, a looted one too, and a run that takes a share starts the refill over from that night.

What's saved is the campaign's map state (`Campaign.map`), which held nothing until now: its `pois` is a list of `{ poi, left, nights }`, one entry for each POI that isn't full, in POI order, where `left` is what the last run left and `nights` the nights since. Shares now are `left` plus the shares the nights have brought back. A POI with no entry is full, so a fresh campaign's map state is still `{}`, and an entry is dropped the night its POI fills up. The reader (`readPoiStocks`, called by `readMapState` whenever the map state has `pois`) refuses an entry for a POI twice or out of order, a `left` of 3 (that's no entry), and `nights` at or past the night it'd be full, so there's one way to write each state. The rest of the map state stays opaque until stop state and fog exist.

The state a screen shows follows the shares: unvisited when full, depleted at none, looted between. A POI back to full reads as unvisited again (call 6).

Options considered for the refill:

- Shares worked out from the day of the last run and `Campaign.day`, with no nightly step. Simpler storage, but the day end's `poiRefills` hook (day-clock.md) was put there for exactly this and would stay a no-op, and every reader would need the day.
- A nightly step on the hook (chosen): `refillPois` adds a night to each entry and drops those full again. The map state is what's true at dawn, and only the reader needs the arithmetic.
- A continuous stock (a fraction or a count of days owed) instead of whole shares. It reads less clearly on the map ("2 of 3 shares left") and makes "after two or three runs it's depleted" depend on how often the player runs it.

## The yield

`routesOnOffer({ map, campaign })` now takes the campaign, and scales each destination's yield by the shares its POI has left (`scaledYield`): each resource times shares over 3, rounded up, so full, two thirds, a third, then nothing (call 2). The full offer is still worked out once a map; the scaled one once a map state, since the campaign replaces its map state whole when the stock changes. Routes to full POIs are the same objects as in the full offer. Every caller already had the campaign beside the map, so the area map's details, the run route screen's line, the compound's Plan, and `departRun` all read the same yield, and `departRun` stores the scaled route on the run as before, so what the screens show is what the run carries.

The share is taken when the run reaches the POI (`arrivedAt`), in the same `set` that loads the yield into the cargo, so the two can't come apart and a save never has one without the other (call 4). The POI is found from the destination id (`poiOf`, the inverse of `destinationId`); a run saved before the real map, whose id isn't a POI's, takes nothing, as the fixture's run does. One run is out at a time and departure and arrival fall on one day, so the stock a run was scaled to at departure is the stock it takes from.

## The screens

- The area map's markers carry the state, so looted and depleted POIs draw as the view already draws them. Strongholds never have one.
- The destinations list dims a depleted POI's row, as it dims a stronghold's, and keeps its trailing text to the tier and past dark: naming the state there ("tier 4, depleted, past dark") left the far rows' names too little room to tell apart at 1024 px. A looted POI's row is as before; its marker and details say it.
- The details: the kind line ends with the state ("General store, tier 1, looted"), the yield line gives what's left ("Yields 4 food and 3 water.") or "Nothing left to take until it refills.", and a new line under it gives the shares and when the next comes back ("2 of 3 shares left, the next back in 4 days.", "No shares left, the next back in 7 days.", "3 of 3 shares left."), in warn colour when depleted.
- The run route screen's line and marker say the same, and the run screen at a depleted destination says nothing was left to load.

## Version 8 saves load

The map state changed shape, so the save format went to version 9. Unlike every bump before it, saves of the version before still load: version 8 never wrote anything into the map state, and every POI being full is exactly what a version 8 campaign meant. `SaveUpgrades.ts` lists the versions a build upgrades (`UPGRADABLE_SCHEMA_VERSIONS`, `[8]`) with one step per version (`UPGRADE_STEPS`; version 8's drops any `pois` from the map state, which it never wrote), and a test holds every listed version to a chain of steps up to the current one, so a bump that forgets its step fails the suite rather than every old save on Continue; and `CampaignStore` reads a save stamped with one of them as if it were this version's after the upgrade: `saveStatus` calls it saved, `load` upgrades it before `Campaign.fromJSON`, a malformed one is damage and kept like any other, its generator version is checked the same way, and the next checkpoint writes it as version 9, leaving the version 8 text as the save before. Histories stamped with an upgradable version are read too, since an entry is the same in both. A store built with another `version`, as tests build them, upgrades nothing unless given `upgradesFrom`.

Options considered: a plain bump with no upgrade, the store's rule until now (every playtester's campaign lost, for a field whose starting value is obvious); and reading the version 8 text as version 9 with no upgrade step (it would load, since `{}` is a valid map state, but a version 8 build would load a version 9 save the same way and drop its stock silently, and the stamp is what keeps an older build off a newer save).

Only bumps whose old saves have an obvious meaning in the new format belong in the list; a bump that can't say what an old save meant leaves its version out, and those saves stay outdated as before.

## Provisional calls

None of these is in a spec. They're on DDB-497.

1. A POI holds three runs' worth, so the third run depletes it: the spec's "two or three", taking three because the yield already falls by thirds, so the third run is a small one.
2. A run's yield is its POI type's, scaled by the shares left, each resource rounded up: full, two thirds, a third, then nothing. A POI with anything left gives some of everything it yields.
3. Shares come back one every third of 20 nights from the last run, so a depleted POI is full again 20 nights on, the spec's starting value. Looted POIs refill too, and each run starts the refill over.
4. The share goes when the run reaches the POI and loads its yield, in the same step, so a run that later fails has still emptied it. Nothing can fail a run after the POI yet; the return ambush will make that matter.
5. A depleted POI can still be planned and run, for nothing at the POI: the fights on its routes still pay cards. The details, marker, and run route screen say it's depleted and when a share comes back, and its row in the list is dimmed.
6. A POI that fills up again shows as unvisited.
7. Version 8 saves load with every POI full, and their Campaign History is kept.

## Consequences

- The objective (mvp-supply-run.md, What the full run controller replaces) moves the yield from reaching the destination to winning the objective; the share moves with it, in the same step.
- The return ambush makes call 4 visible: a run that empties a POI and loses its cargo on the way home.
- Fog (DDB-294) decides which POIs are known; the stock is kept for every POI regardless, by index.
- Map state indices are the POI layer's, which the generator version pins: a change that renumbers POIs bumps `AREA_MAP_GENERATOR_VERSION`, which already makes older saves outdated.
- The next format bump decides whether version 8 stays upgradable (it needs a step to 10 through 9) or drops out of the list.
