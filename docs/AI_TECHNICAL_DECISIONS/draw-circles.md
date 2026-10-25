# drawCircles: a dotted line's dots in one draw group

## Date
2026-10-25, DDB-554. Rules: [ui-rendering-spec](../ui-rendering-spec/02-draw-api.md) R2.8 (one draw group per call), R2.9 (`drawCircle`), R2.10 (`drawPolyline` as a convenience over capsule segments), R2.11 (a bare triangle list has no anti-aliasing feather), R5.15 (circles in `circle` mode).

## Context

The aiming line (`TargetingArrow`) and the hand's target preview (`TargetPreview`, [hand-target-preview.md](./hand-target-preview.md)) draw dotted arcs, a dot of radius 2.5 every 12 px, and drew each dot with its own `drawCircle`. Every call is a capture of the ambient state, a copied command, and a draw group. A review of PR #276 measured the preview on a board where Fall In fans out over three escorts and their empty slots at 303 draw groups, against 714 for the rest of the combat screen, about 0.4 ms of draw-API time a frame while the card is hovered. Covering Fire on nine raiders was 187 groups.

## Options considered

- A bare `drawPolygon` triangle list of small polygons, one call an arc. One group, but R2.11 gives a bare list no feather, so 5 px dots would draw with jagged edges.
- Fewer dots: a wider spacing on the preview. It would no longer look like the aiming line, which the preview is meant to match.
- `drawCircles({ centers, radius, fill })`: circles of one radius and fill as one draw group, each encoded as the same borderless `circle`-mode quad `drawCircle` writes, so each dot is shaded and anti-aliased as a single circle is.

## Decision

`drawCircles`, a convenience beside R2.9 in the way `drawPolyline` is one beside R2.10. `DrawApi.drawCircles` captures once, with the centres' hull grown by the radius as its ink, and emits a `circles` command. `UberGeometryEncoder` shapes it as one instance per centre and writes each with the circle template set once per command (`quad` takes the instance index, as polyline segments already did). The WebGL2 backend needs nothing new: the instances are the `circle` mode it already draws. No centres, or a radius that isn't positive, draw nothing.

`TargetingArrow` and `TargetPreview` collect their dot centres into buffers they keep and pass a list of exactly that many through `leading` (`CombatFxLayer.ts`), which builds the list for each length once, so a frame of dots allocates nothing on the game's side; the draw API copies the centres into the command, as it copies every command.

## What was measured

The preview drawn alone into a `DrawApi` over a `NullBackend`, at 1280x720, medians over 1000 frames on a loaded machine (times are rough; the group counts are exact):

| Card, board | Groups before | Groups after | Draw-API time before | After |
|---|---|---|---|---|
| Fall In, three escorts and their empty slots | 303 | 24 | 404 µs | 181 µs |
| Covering Fire, nine raiders | 187 | 18 | 148 µs | 130 µs |
| Ramming Run, seven raiders | 130 | 14 | 108 µs | 94 µs |
| Far Shot, four raiders | 115 | 8 | 148 µs | 121 µs |

The encoder still writes one instance a dot, so the GPU side is unchanged; what goes is the per-dot capture, command, and group.

## Consequences

- `drawCircles` is in the draw API for any caller with many like dots; it has no border, since a border is per circle and the dotted lines have none.
- The test draw recorder (`drawnInk`) notes a `circles` draw with its hull.
- Tests that spied on `drawCircle` for the dotted lines now spy on `drawCircles`.
