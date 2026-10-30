# The area map and run route panels on the atlas sheet

Date: 2026-10-17, with DDB-509 (epic DDB-500). Spec: [UI Art Direction](../specs/UI%20Art%20Direction.md), Screens: area map and run route. Builds on [atlas-components.md](../../_legacy/docs/AI_TECHNICAL_DECISIONS/atlas-components.md) and [theme-selection.md](../../_legacy/docs/AI_TECHNICAL_DECISIONS/theme-selection.md), and supersedes the point in [area-map-atlas-style.md](./area-map-atlas-style.md) that kept the side panels dark. The atlas is the playtest direction, not the final UI.

## Context

The map itself was already drawn as a road atlas; the panel beside it was the old dark UI, a grey column with a Back button, a plain list, and a yellow primary. Both screens move onto the sheet with the atlas's shared parts. There is no canvas board for either screen, so the compound's (`compound.png`) is the reference: a plate on the left, a column of legend boxes on the right, the primary at the foot.

## Decisions

### Layout

Each screen is one atlas sheet, with the atlas as its theme (in salal ui, the scene root's theme). The map view sits in a plate frame on the left with the title above it, the way the compound's plate has its title and resource strip above it; the view draws its own paper inside the frame and is unchanged. The column on the right is 360 px wide.

The title and the day line sit over the plate rather than at the top of the column. At 1024 by 600 the sheet leaves 480 px of height, and with the title in the column the destinations box kept under one row of list once the chosen POI's box and the primary were placed. Over the plate it keeps three.

The status line ("30 destinations and 4 strongholds...", the map's progress, errors) moved under the plate, where it gets the plate's width and rarely wraps.

The scrollbar and the route cards take their colours from the theme: on paper the dark scrollbar's thumb all but vanished.

### Area map column

- Destinations: a legend box holding a scrolling list, one focus group of contents rows (44 px, with a 22 px circled lead), nearest first, each led by the POI's type letter circled as the map draws its marker (a stronghold leads with the red diamond), the tier in mono at the right. Strongholds and depleted POIs are dimmed but stay in reach, since choosing one shows why it can't be planned. Dim is the dim ink, not the faint one, which measures 4.36:1 on the textured paper; since dim ink sits close to full ink, a depleted row's glyph also goes to faded print (a stronghold's diamond keeps its red, and its value says stronghold).
- The chosen row is marked by a hand-drawn highlighter swipe under the list, its variant from the POI's index so the same choice always gets the same swipe. The box below and the map's selection ring are the other two signals.
- The chosen POI's box is fresh paper (W0, the thing in focus), led by the same glyph and the name, then the five fixed-height lines it had.
- Plan a run here is the highway with the shield, its reason in two fixed lines under it.

### Run route column

The destination's box (glyph, name, the day and light in mono, the kind and yield), then the Routes and Stops in order boxes scrolling together, then the home-by line and Load out the crew as the highway. On the atlas a route card's selected wash is the highlighter and its bar the highway.

### Tabs and back

The area map is a sibling of the menu, the compound, and the crew, so it hangs the section tabs (the meta sections' tab set, `_legacy/src/renderer/game/screens/metaSections.ts`) and loses Back; Escape still goes to the compound. The run route is a step under the area map, so it hangs the same tabs open at the area map and keeps a back link as well, a back-road button, "Back to the area map".

Each tab's id is `${id}.${section}` (`area_map_tabs.compound`), so focus can be restored to it by id.

Which tabs can be taken is one rule for every screen that hangs them, `sectionAvailability({ campaign, mapKnown, planBlocked, busy })`: Menu always; Compound and Crew once there's a campaign; Area map once the campaign's map is known and nothing blocks planning; and every tab but Menu held while the screen is busy (the compound's day-end save). Applying it keeps the open tab enabled, since a disabled tab can't show as open. The area map and run route gate when they open, when the campaign loads, and when its map arrives; neither is ever busy.

Focus order follows the tree, which is reading order now: the tabs, the map, the list, then Plan a run here. It was Back, the list, Plan, the map, when Back sat in the column.

### Warnings in stronghold red

The atlas aliases `status_warn` to the Highway orange, which is about 3.4:1 on paper, under the 4.5:1 small text needs (UI Art Direction, Palette). Warning text on these screens (a depleted POI's stock, past dark, the reasons Plan or Load out is off, status errors) uses `status_crit`, the Stronghold red at 6.5:1, which the spec gives to warnings anyway. A route card's note colour can be set for this; its default stays `status_warn` so nothing dark moves.

## Consequences

- Both screens hold their layout at 1440 by 882 and 1024 by 600.
- At 1024 by 600 the destinations list shows three rows and the run route's stops scroll under the routes. Both scroll with the keyboard as before.
- Names in the list ellipsize on the narrowest rows when the value reads "tier 2, past dark". The full name is in the box below once chosen.
