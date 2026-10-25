# Dashed strokes: a line style the shader draws

## Date
2026-10-25, DDB-554. Rules: [ui-rendering-spec](../ui-rendering-spec/02-draw-api.md) R2.8 (one draw group per call), R2.10 (`drawLine`, `drawPolyline`), R2.10a (`dash`), R5.16 (lines as quads), R5.16a (dashed strokes in the fragment stage), R15.8 (derivatives before the mode switch).

## Context

Three things on the combat screen draw broken lines: the aiming line from a card to its reticle (`TargetingArrow`) and the hand's target preview (`TargetPreview`, [hand-target-preview.md](./hand-target-preview.md)) draw dotted arcs, a dot of radius 2.5 every 12 px, and the end-turn preview (`EndTurnPreview`) draws its intent lines in 6 px dashes with 5 px gaps. Each dot was a `drawCircle` and each dash a `drawLine`, so every one was a capture of the ambient state, a copied command, and a draw group. A review of PR #276 measured the preview on a board where Fall In fans out over three escorts and their empty slots at 303 draw groups, against 714 for the rest of the combat screen.

## Options considered

- A bare `drawPolygon` triangle list of small polygons, one call an arc. One group, but R2.11 gives a bare list no feather, so 5 px dots would draw jagged.
- `drawCircles({ centers, radius, fill })`, a batched circle call: one group an arc, each dot the same `circle`-mode quad `drawCircle` writes. This was built first and cut the groups the same way, but it's a new primitive for what is a property of a line, the caller still walks the curve placing dots, the dashed intent lines would have needed a batched line call of their own, and the GPU still gets a quad a dot.
- A `dash` style on `drawLine` and `drawPolyline`, the way SVG's `stroke-dasharray` and `stroke-dashoffset` work, with the dashes found in the fragment stage. A dotted line is a dash of length 0 with round caps.

## Decision

The dash style (R2.10a). `Dash` is `{ length, gap, offset? }` on `DrawLineOptions` and `DrawPolylineOptions`; `DrawApi` resolves it into the command with `offset` defaulting to 0. A dash whose length or gap is negative, or that is all zero, never repeats: the encoder reports it through `onUnpaintable`, which logs an error, and draws nothing.

The encoder writes a dashed line or polyline as one draw group in a new `dash` mode, one quad a segment, as R5.16 has it for solid lines. Each segment's lanes carry its half length and its phase, how far into the pattern it starts, in the float32 `halfSize` lanes, and the dash length, gap, half width, and flags (round caps, last segment) in the half-float radius lanes. The phase is accumulated along the line on the CPU, so it doesn't drift with the half floats and neighbouring segments agree on every dash's start to well under a pixel.

The fragment stage (`MODE_DASH` in `uber.frag`) finds the dash that starts at or before the fragment and the one after, and takes the larger coverage of the two as capsules (round) or boxes (butt), with the footprint `w` the other modes use, computed before the mode switch (R15.8). A segment draws only the dashes that start on it, and its quad reaches a dash and a cap past its far end, so a dash across a joint is drawn once, whole, running straight on past the joint. On a sharp bend that overshoots the corner by up to a dash; the arcs here are sampled at 48 points and don't show it. The last segment of an open line clips its final dash at the line's end, as SVG does. The vertex stage is unchanged.

`TargetingArrow` and `TargetPreview` draw each dotted arc as one polyline with `DOTTED` (`CombatFxLayer.ts`: `{ length: 0, gap: 12, offset: 6 }`, width 5, round caps), so the first dot sits 6 along as the hand-placed ones did. `EndTurnPreview` draws each intent line as one polyline with butt caps and its 6 and 5 dash. Each passes its points through `leading`, which keeps a list for each length, so a frame of arcs allocates nothing on the game's side. `drawCircles` went with the change.

## What was measured

The preview drawn alone into a `DrawApi` over a `NullBackend`, at 1280x720, medians over 1000 frames on a loaded machine. The group counts are exact; the times are rough, and a run's whole-screen numbers wander by half a millisecond.

| Card, board | Groups, a draw a dot | Groups, dashed | Draw-API time, a draw a dot | `drawCircles` | Dashed |
|---|---|---|---|---|---|
| Fall In, three escorts and their empty slots | 303 | 24 | 404 µs | 181 µs | 119 µs |
| Covering Fire, nine raiders | 187 | 18 | 148 µs | 130 µs | 95 µs |
| Ramming Run, seven raiders | 130 | 14 | 108 µs | 94 µs | 70 µs |
| Far Shot, four raiders | 115 | 8 | 148 µs | 121 µs | 79 µs |

The GPU gets a quad a segment rather than a quad a dot: up to 48 an arc, against a dot every 12 px, each a thin strip about as many pixels as the dots it holds, so the fill is about the same.

## Consequences

- Any line or polyline can be dotted or dashed; nothing else in the engine draws broken lines dot by dot.
- The shading fixture (`ShadingFixturesSection`) has a dotted and a dashed polyline round a bend, for R5.10's visual review.
- `UberGeometryEncoder.test` pins the phases, lanes, and flags of a dashed polyline and line and the unpaintable case. The screen tests spy on `drawPolyline` and check the dash.
- A translucent dashed stroke doesn't darken at its joints, since each dash is drawn once; a translucent solid polyline still does (uber-shader.md).
