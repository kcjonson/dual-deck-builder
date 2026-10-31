# Dashed strokes: a line style the shader draws

## Date
2026-10-25, DDB-554. Rules: [ui-rendering-spec](../../../docs/ui-rendering-spec/02-draw-api.md) R2.8 (one draw group per call), R2.10 (`drawLine`, `drawPolyline`), R2.10a (`dash`), R5.16 (lines as quads), R5.16a (dashed strokes in the fragment stage), R15.8 (derivatives before the mode switch).

## Context

Three things on the combat screen draw broken lines: the aiming line from a card to its reticle (`TargetingArrow`) and the hand's target preview (`TargetPreview`, [hand-target-preview.md](../../../docs/AI_TECHNICAL_DECISIONS/hand-target-preview.md)) draw dotted arcs, a dot of radius 2.5 every 12 px, and the end-turn preview (`EndTurnPreview`) draws its intent lines in 6 px dashes with 5 px gaps. Each dot was a `drawCircle` and each dash a `drawLine`, so every one was a capture of the ambient state, a copied command, and a draw group. A review of PR #276 measured the preview on a board where Fall In fans out over three escorts and their empty slots at 303 draw groups, against 714 for the rest of the combat screen.

## Options considered

- A bare `drawPolygon` triangle list of small polygons, one call an arc. One group, but R2.11 gives a bare list no feather, so 5 px dots would draw jagged.
- `drawCircles({ centers, radius, fill })`, a batched circle call: one group an arc, each dot the same `circle`-mode quad `drawCircle` writes. This was built first and cut the groups the same way, but it's a new primitive for what is a property of a line, the caller still walks the curve placing dots, the dashed intent lines would have needed a batched line call of their own, and the GPU still gets a quad a dot.
- A `dash` style on `drawLine` and `drawPolyline`, the way SVG's `stroke-dasharray` and `stroke-dashoffset` work, with the dashes found in the fragment stage. A dotted line is a dash of length 0 with round caps.

## Decision

The dash style (R2.10a). `Dash` is `{ length, gap, offset? }` on `DrawLineOptions` and `DrawPolylineOptions`, in the line's own units as its width is; `DrawApi` resolves it into the command with `offset` defaulting to 0. A gap of 0 is an unbroken line through the same path (`UNBROKEN` in `CombatFxLayer.ts`), for a translucent polyline: the solid path's segments overlap at their joints and darken there. The encoder reports a dash it can't draw through `onUnpaintable`, which logs an error, and draws nothing: one that never repeats; a length or gap past the largest half float, which the shader would read as infinite; a period shorter than half the width, whose caps would reach past the three dashes the shader looks at; and a segment longer than 2048 periods, the integers a half float counts exactly.

The encoder writes a dashed line or polyline as one draw group in a new `dash` mode, one quad a segment, as R5.16 has it for solid lines. Each segment draws the part of every dash that lies on it, capped only where the dash starts or ends, or where an open line does, and where a dash crosses a joint it runs on to the joint's bisector, which the next segment cuts at too. So a dash bends with the line through a curve's joints and stops at the line's end, where the first build ran each dash straight on along the segment it started on, off the curve by up to 3 px where `RoadArc` turns hard over its first 1.4 px and past the end by up to 5. The cut is hard, not ramped: two ramps meeting at a joint would each cover half a pixel and leave a seam, and overlapping ends double a translucent stroke. Each side reaches 0.001 past the bisector, so a pixel centre on it is drawn twice rather than left to neither by the two sides' rounding; integer corners hit that tie exactly, and only a translucent stroke shows it. A joint past a right angle would push a bisector cut far along both segments, so it's cut square on both and the segment before it adds a round join, overlapping the next a little.

Which segment each dash starts and ends on is decided once. The encoder works out where every joint falls in the pattern (`DashBoundary`: the period, how far into it, and whether that period's dash started and ended before it) in double precision, and both segments either side read the same one, so neither drops a dot that falls on the joint and neither draws it twice. Each segment's lanes carry its half length and its phase in the float32 `halfSize` lanes; the dash length, gap, half width, and flags (round caps, open start and end, unbroken, the round join, and the first period's dash having started or ended before the segment, and the last dash to start on it running on past it) in the half-float radius lanes; and the two joints' half-turn tangents and the index of the last dash to start on it in the shape lanes. The period the encoder lays the pattern with is the one the shader reads back from the half floats, so a gap like 9.7, which rounds, doesn't drift dashes across joints.

The fragment stage (`MODE_DASH` in `uber.frag`) looks at the dash whose period the fragment falls in and the one either side, and takes the union of their distances, as capsules (round caps) or boxes (butt), with the footprint `w` the other modes use, computed before the mode switch (R15.8). A zero-length dash with butt caps paints nothing, as SVG's does. Each quad reaches half the width past either end, enough for a cap, a round join, or a right-angled miter. The vertex stage is unchanged.

A closed dashed line starts and ends its pattern at its first point and caps its dashes there, as an open line's; where two capped ends meet at that corner they overlap. An unbroken closed line is joined there like any joint. `DrawApi` grows a dashed polyline's ink by root 2 for the miter.

`TargetingArrow` and `TargetPreview` draw each dotted arc as one polyline with `DOTTED` (`{ length: 0, gap: 12, offset: 6 }`, width 5, round caps), so the first dot sits 6 along as the hand-placed ones did, and the preview's solid arrows, at 80%, with `UNBROKEN`. `EndTurnPreview` draws each intent line as one polyline with butt caps and its 6 and 5 dash. Each passes its points through `leading`, which keeps a list for each length, so a frame of arcs allocates nothing on the game's side. `drawCircles` went with the change.

## What was measured

The preview drawn alone into a `DrawApi` over a `NullBackend`, at 1280x720, medians over 1000 frames on a loaded machine. The group counts are exact; the times are rough, and a run's whole-screen numbers wander by half a millisecond.

| Card, board | Groups, a draw a dot | Groups, dashed | Draw-API us, a draw a dot | `drawCircles` | Dashed |
|---|---|---|---|---|---|
| Fall In, three escorts and their empty slots | 303 | 24 | 404 | 181 | 124 |
| Covering Fire, nine raiders | 187 | 18 | 148 | 130 | 98 |
| Ramming Run, seven raiders | 130 | 14 | 108 | 94 | 71 |
| Far Shot, four raiders | 115 | 8 | 148 | 121 | 77 |

The GPU gets a quad a segment rather than a quad a dot: up to 48 an arc, against a dot every 12 px, each a thin strip about as many pixels as the dots it holds, so the fill is about the same.

The shader's branch was checked in a throwaway CPU port run over the real encoder's output: an offset inside a dash draws its partial first dash, nothing runs past a line's end, the dotted, dashed, and unbroken versions of an end-turn arc put no pixel more than three quarters of a pixel off the line and no pixel in two segments, an unbroken arc stays fully covered along its middle, and a 9.7 gap keeps every dot.

## Consequences

- Any line or polyline can be dotted, dashed, or unbroken through the dash style; nothing else in the engine draws broken lines dot by dot.
- The shading fixture (`ShadingFixturesSection`) has a dotted and a dashed polyline round a bend, for section 5.10's visual review.
- `UberGeometryEncoder.test` pins each segment's phase, flags, joint tangents, and last dash for a dashed polyline, a line, a dash across a joint, closed lines dashed and unbroken, a sharp joint, and a transform, and the cases it can't draw. The screen tests spy on `drawPolyline` and check the dash.
- A translucent polyline drawn with the solid path still darkens at its joints (uber-shader.md); one that needs not to uses a gap of 0.
