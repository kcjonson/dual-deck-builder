# The batcher: where it sits, and how the legacy backend uses it without moving a pixel

DDB-65, the batcher half of the third PR (DDB-55 phase 1). 2026-09-28.

## The problem

After the first two PRs the draw API already did chapter 3's ordering: state captured into each
command, R4.2a's cull, R3.10's per-layer partition. What reached `LegacyGLBackend.submit` was one
domain in emit order, and the backend painted it one command per `drawElements`, plus one draw per
text colour from `TextRenderer`. The combat screen issued 91 GPU draws, the card showcase 61.

What was missing is the part R13.12 to R13.15 measure: geometry merged into shared buffers, GPU
submissions split only for a named reason, a resident texture set (R5.20), and counters for all of
it. The constraint was the same as the previous PR: the 26 committed goldens must not move.

The recon note (`.claude/notes/ddb55-phase1-recon.md`, section 4) said this could not reduce draw
counts before the uber shader, because the legacy program takes a per-draw model matrix, colour and
border as uniforms. That turned out to be a property of the shader, not of WebGL1, and the shader is
two small files.

## Options considered

**Where the batcher lives.**

A. In `DrawApi`, upstream of the seam, with `submit` receiving a packed buffer instead of commands.
Rejected: what a group's geometry looks like is the backend's vertex format, and R5.4 leaves the
layout open until the uber shader settles it. A packed format chosen now would be the legacy
program's, and the recording and null backends would have to learn it.

B. Behind the seam, as a class every backend composes with its own `GeometryEncoder`. Taken.
`Batcher` owns what is identical for every backend (typed-array growth, one contiguous range per
group, the split decision and its reason, texture slot selection through `ResidentTextureSet`, and
the counters), and the encoder owns only the bytes. `DrawApi` stays the front half (capture, cull,
partition), `Batcher` is the back half, and no two backends can count a split differently. The
WebGL2 backend reuses `Batcher` with an instance encoder.

**How the legacy backend merges.**

A. Keep one draw per command until DDB-64. Honest, zero risk, and the counters would have been real
but would have measured nothing interesting.

B. Turn the legacy program's per-draw uniforms into per-vertex attributes. Taken. `vertex.glsl`
takes the six non-trivial entries of the old model matrix, the colour, the border colour, the border
width, the shape size and a mode as attributes, rebuilds the same 4x4, and multiplies
`P * V * M * p` in the same order. `LegacyGeometryEncoder` computes the model matrix with the same
`gl-matrix` calls on the same Float32Array state the per-draw path used, so the GPU receives the same
floats and does the same float work. The fragment shader is the old one reading varyings where it
read uniforms. Text glyphs go into the same buffer as shapes with mode 1, so `TextRenderer` is
deleted.

## What was measured

Byte comparison of the rendered canvas against `main`, both served side by side in Chromium (ANGLE
on Metal, 1440x882 at device pixel ratio 2), each capture paused and taken inside a frame callback
after the game's: all six reachable screens (splash, main menu, driver selection, card showcase,
developer, combat) and all seven baselined gallery scenes hash identically. The eighth scene,
`primitive-shapes`, differs, as expected (below).

The first attempt ordered each domain's text in plain submission order after its shapes. Every
screen but one was byte-identical; driver selection differed by one level on a few glyph-edge pixels
where differently coloured runs overlap. `TextRenderer` had grouped runs by colour, in order of first
appearance, and restoring that grouping in `LegacyPaintOrder` made it byte-identical too. The
previous PR's note that "per-colour grouping is not observable" was true at the goldens' tolerance
and false at the byte level; the difference is one level, below the three the golden threshold can
see.

GPU draws per frame, before and after, same states:

| Screen | Draw groups | GPU draws on main | GPU draws now |
|---|---|---|---|
| combat | 205 | 91 | 6 |
| card showcase | 288 | 61 | 2 |
| developer | 35 | 19 | 2 |
| main menu | 12 | 7 | 1 |

Combat's six are its six non-empty sort domains: five `legacyTextOrder` barriers at its clip pushes
and pops, plus `endFrame`. `batcher.gpuDraws` equals `renderer.glDrawCalls` on every screen, which is the
R13.5 cross-check between the batcher's count and the backend's own call-site count.

## Decision

- `src/renderer/engine/draw/Batcher.ts`: `GeometryEncoder`, `GeometrySink`, `GpuDraw`,
  `GeometryUpload`, `Batcher.flush(commands, execute)`. Split reasons in fixed order: blend, topology,
  clip, texture. A group that does not fit the upload starts a new one, counted as a `bufferFull`
  flush. A steady-state frame allocates nothing in it: arrays grow and are reused, draw records are
  pooled, and the upload and the returned `GpuWork` are one reused object each. With a `verify`
  callback (development builds) it fences every group and reports an encoder that writes a count
  other than the one it reported, or an index outside its own vertices, since every group shares one
  buffer and such a write would draw a neighbour.
- `src/renderer/engine/draw/ResidentTextureSet.ts`: R5.20's fixed resident units plus dynamic units,
  compared by identity, with `textureSlotsExhausted` the only texture split.
- `src/renderer/engine/rendering/LegacyGeometryEncoder.ts` and the two shader files: the legacy
  vertex format, 22 floats, seven attributes (WebGL1 guarantees eight).
- `LegacyGLBackend`: `LegacyPaintOrder` (per layer: shapes, then text grouped by colour), one upload
  per domain, one resident texture bound once per frame, the scissor applied per GPU draw. The text
  hoist is per layer, not per domain as `TextRenderer` had it, so a `base` label cannot paint over a
  `popup` panel; it is the same order today because every domain in the app is one layer.
- Allocations left in the legacy path, each owned by code that dies: two `subarray` views per upload
  (WebGL1's `bufferData` has no source offset or length), and `FontAtlas.measureText`'s result per
  text run (chapter 6 replaces it). The paint order, circle outlines, model matrices and faded colours
  are all reused scratch.
- `GpuWork` gains `flushes` (backend-caused `bufferFull` and `targetChange`) and `clipChanges`.
  `DrawStats.clipChange` is now measured rather than hard-wired to zero.
- `PerfSnapshot.batcher` carries `DrawApi.getStats()` for the last completed frame on both pages,
  null before the first frame. The F5 overlay shows groups in and GPU draws out.

## Departures

**`topologyChange` is a fourth split reason**, not in R13.13. The legacy program still draws
polylines and circle outlines as GL lines, which cannot share a draw with triangles. It exists so the
split total still accounts for every GPU draw, and like `clipChange` it must read zero once lines are
capsule quads under the uber shader. It reads zero on every screen today; only the primitive-shapes
scene draws lines. Line width does not split: `gl.lineWidth` is clamped to 1 on every WebGL
implementation this ships on (ANGLE's `ALIASED_LINE_WIDTH_RANGE` is `[1, 1]`), so the backend no
longer calls it, and primitive-shapes renders byte-identically without it.

**The clip is still GPU state.** R4.1 wants it per draw; the legacy program has no clip varying. The
encoder declares `clipIsState: true`, the batcher splits wherever the resolved clip changes and
counts it as `clipChange`, and the backend applies the scissor per GPU draw. That is the seam DDB-64
changes: its encoder writes `clipRectOf(command.clip)` per instance and declares `false`. Today the
count is zero on every screen because every clip change is also a `legacyTextOrder` domain boundary.

**`occluded` stays null.** R3.2's occlusion drop is a MAY and is not implemented.

**Barriers are not yet the only flush.** `legacyTextOrder` still ends a domain at every clip push and
pop, which R3.20 forbids. It is the price of the goldens and is deleted by the ordering re-baseline,
together with `LegacyPaintOrder`.

## Consequences

**Circles and polygons no longer inherit a stale border.** The per-draw path never set
`uStrokeWidth` for them, so a circle drawn after a bordered rect was stroked in that rect's border
colour. They now carry a border width of zero. Only the primitive-shapes scene draws them.

**DDB-103's overrun is gone by construction.** The circle outline no longer reallocates a shared
1024-vertex dynamic buffer; every group goes through the batcher's growing arrays. The
primitive-shapes scene renders cleanly with outlines. Its golden is still unminted; minting it is a
pixel change and belongs with DDB-103's close-out, not here.

**A malformed polygon is refused rather than drawn.** An index outside the polygon's own points
would now address a neighbouring group's vertices in the shared buffer, so the encoder reports it and
draws nothing. A trailing partial triangle is dropped for the same reason.

**`Renderer.projection` and `Renderer.view` are gone**; the text flush was their only reader.

## How this dies

With the WebGL2 backend (DDB-63) and the uber shader (DDB-64): delete `LegacyGLBackend.ts`,
`LegacyGeometryEncoder.ts` and its test, the two files under `src/assets/shaders/`, and the
`topologyChange` split reason. `Batcher` and `ResidentTextureSet` stay. `LegacyPaintOrder` goes
earlier, with `legacyTextOrder`, in the ordering re-baseline.
