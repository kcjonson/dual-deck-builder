# The uber shader: one program, coverage in the fragment stage, the clip as data

DDB-64 (with the per-draw clip carried over from DDB-65), DDB-55 phase 1. 2026-09-28.

## The problem

After the resource layer (#73) every draw went through the batcher, but through the legacy
program: a model matrix per vertex, a border computed in UV space, `smoothstep` for the edge,
GL lines for strokes and circle outlines, a 32-segment fan for circles, SRC_ALPHA blending, MSAA
for every other edge, and the clip as scissor state. Chapter 5 wants none of that, and three
things chapter 4 and 13 want could not happen until it went: the clip as per-draw data (R4.1),
`clipChange` and `topologyChange` reading zero, and a context without multisampling (R5.29).

This is the first of the phase's two deliberate re-baselines. Pixels were expected to move; the
job was to make every moved pixel a correction.

## Options considered

**Per-vertex quads or instances (R5.4).** The spec allows both. Instancing needs a second vertex
stream per upload, a unit-quad buffer, and a `drawElementsInstanced` path, and polygons (R5.17)
are not quads, so it would be two formats and two draw paths inside one program. Four vertices
per quad with per-vertex data fits the batcher exactly as it is (one float buffer, one index
buffer, contiguous ranges per group) and costs upload bandwidth. Taken: 32 floats, 128 bytes,
ten attributes. `bytesUploaded` is up 43 percent on every screen (card showcase 1.21 to 1.73 MB a
frame), against a frame budget phase 1 was never short of. The packed instance layout is a
follow-up (DDB-191) rather than a prerequisite.

**Where the transform is applied.** On the CPU, per R5.3: positions arrive in screen space,
logical pixels. That removes the model matrix, makes the vertex stage a single projection
multiply, and gives the fragment stage R4.4's `v_pos` for free.

**How the coverage footprint `w` is found (R5.6).** The spec offers `length(dFdx(d), dFdy(d))`
or a per-draw constant under translate-only transforms. Neither was taken as written. The
gradient of `d` vanishes across a thin shape's centre line (a 2 px bar has `d = -0.5` on both
rows), which divides by zero; the constant needs a second path for transformed draws. The shader
takes the derivatives of the interpolated local position instead, which is linear, so they are
exact and constant over the quad: `w = sqrt((|dFdx(local)|^2 + |dFdy(local)|^2) / 2)`. It is
exactly `1 / ratio` under translation, exact under rotation and uniform scale, and the mean of
the two axes under a non-uniform scale.

**Lines and polygon strokes (R5.16).** Each segment is a `rect`-mode quad oriented along it, so
it gets the rectangle's coverage ramp with no new mode. Round caps and interior joints are per
corner radii on the segment's ends (R5.7a), so a polyline joint is a round join. Joints overlap,
which darkens a translucent stroke at its corners; nothing draws a translucent stroke. A capsule
mode was not added since `rect` with radii already is one.

**What `text` mode means before chapter 6.** The atlas is still a canvas-rasterised bitmap, so
the glyph path is a temporary `mask` mode: coverage from the red channel, times the premultiplied
colour. The MSDF `text` branch is in the shader (median of three, `clamp(range * (sd - 0.5) +
0.5)`), with the range per draw as R5.21 wants, and nothing emits it until DDB-70.

## Decision

- `src/assets/shaders/uber.vert` and `uber.frag` replace `vertex.glsl` and `fragment.glsl`.
  Modes `flat`, `rect`, `shadow`, `circle`, `image`, `text`, `mask` (R5.2), selected by an
  integer in the vertex. `rect` and `circle` compute `co` and `ci` from the outer and inner edge
  (the inner box with radius `max(0, r - inset)`), and output `(ci * fillP + (co - ci) *
  borderRegionP) * opacity` (R5.8). `shadow` is Evan Wallace's erf form with sigma `blur / 2`,
  falling back to the coverage ramp when sigma is under half a device pixel (R5.12). Discard is on
  coverage below 1/1024 (R5.23), and `additive` zeroes the output alpha (R5.22a). The clip test is
  half-open on the `highp` interpolated position, before any mode runs (R4.4).
- `rendering/UberGeometryEncoder.ts` replaces `LegacyGeometryEncoder.ts`. On the CPU at
  submission: premultiplied colours, gradients premultiplied per corner and extrapolated to the
  inflated quad (R5.9), radii clamped to the half extent (R5.5), the border's outset from its
  position (R5.7), one device pixel of inflation in local units, R5.11's shadow geometry with
  CSS's spread radius cubic and 3 sigma of padding (`bounds.shadowInk` is the same box), line
  quads, the polygon feather ring (R5.17: one device pixel, outward by the outline's signed area,
  mitred and limited to `FEATHER_MITER_LIMIT`, four device pixels, on the outline and not per
  triangle), and images with a source rect and tint (R5.18).
- The feather needs `points` to be one outline. `DrawPolygonOptions` now says so: with
  `indices`, the points in order MUST be one simple closed outline that the indices cover once.
  `draw/triangulate.ts`'s `isSingleOutline` checks it in linear time with no allocation (the
  outline has area, every triangle is wound like it, every outline edge is walked exactly once,
  through collinear vertices the triangulation dropped, and the areas add up). A list that fails
  is drawn without the feather rather than with a ring across its interior, and a development
  build reports `polygon-not-one-outline`. A bare triangle list is feathered only when it is one
  triangle.
- The R4.2a cull bound covers the feather: a polygon's ink grows by `FEATHER_MITER_LIMIT`
  device pixels rather than the one R5.7 needs, so no visible miter pixel is ever culled.
  `shadowInk` clamps a negative blur to zero, as the encoder draws it.
- `WebGL2Backend`: the uber program, `ONE, ONE_MINUS_SRC_ALPHA` (R5.22, R15.25); `multiply` and
  `screen` set their own blend function and split (`blendChange`), `additive` does not. Eight
  sampler units selected by slot (R5.20): the font atlas resident on unit 0, images on the
  dynamic units the batcher hands out, and a 1x1 transparent placeholder, owned by the texture
  store so it survives context loss, on every unit nothing else holds. A texture whose upload is
  still queued draws as the placeholder (R5.32). No scissor anywhere; `scissorBox` is deleted.
- `Renderer`: `antialias: false` (R5.29, R15.2).
- `Batcher`: `clipIsState`, the scissor field, topology and `topologyChange` are gone. The split
  reasons are R13.13's three. `DrawStats.clipChange` is a structural zero like `shaderChange`.
- `LegacyPaintOrder` no longer splits a bordered circle into a fan and a GL line strip.
- Components: `Rectangle` passes its corner radius, which it had parsed and dropped since the
  first commit (35 configured sites). `Triangle` and `Polygon` map their points onto their box
  on the CPU instead of pushing a scale transform, so a stroke width is in pixels and not scaled
  by half the box.

## What moved

Every committed golden, for the reasons below and no others. Compared capture by capture against
`main` before the mint (chromium, SwiftShader, 1440x882, ratio 1) and cropped at 6 to 8 times;
nothing is missing, no fill colour changed and nothing moved position. Glyphs draw as before
with one exception that is not this PR's: the enemy intent badge on the combat screen reads 15
where `main`'s golden read 5. `main`'s combat golden was stale; the number changed in an earlier
PR and the capture still passed, since a two-glyph change is about 108 pixels and the gate allows
200. This re-mint is the first capture of the current value (DDB-197).

- **Rounded corners where the style asked for them.** Buttons (5 px), inputs (3 px), panels (5
  px), cards (8 px, 4 px mini), and the developer screen's swatches and examples. The card icon
  badge (`borderRadius` 12.5 at 25 px) is now the circle its radius describes, and so is the
  enemy's damage badge.
- **Borders at their configured width on all four sides.** The legacy shader measured the border
  in UV space scaled by the shorter side, so a 2 px border on a 300x60 button was 2 px on the
  left and right and 0.4 px on the top and bottom. Panel borders were nearly invisible top and
  bottom for the same reason. They are uniform now, which is the biggest visible change on the
  developer screen and the gallery scenes.
- **Edges anti-aliased by coverage, not MSAA.** Whole-pixel axis-aligned edges are identical;
  corners and the circle, triangle, polygon and star edges in `primitive-shapes` are smooth by
  the one-pixel ramp and the feather ring.
- **Strokes at their width.** GL lines were one pixel whatever the width; triangle and polygon
  strokes in `primitive-shapes` are now their 2 or 3 px, with round joins.

One now-visible layout issue, not caused here: on the developer screen each section title is
placed at (0, 0) of a bordered `Panel`, so it sits on the panel's top border, which used to be too
thin to see. That is a layout fix (an inset for the title), not paint order (DDB-196).

## What was measured

GPU draws per frame, `perf-capture.mjs`, 1440x882, same states as `main`:

| Screen | Draw groups | GPU draws on main | GPU draws now | Without `legacyTextOrder` |
|---|---|---|---|---|
| splash | 4 | 1 | 1 | |
| main menu | 12 | 1 | 1 | |
| developer | 37 | 2 | 2 | 1 |
| card showcase | 288 | 2 | 2 | 1 |
| driver selection | 88 | 1 | 1 | |
| combat | 173 | 6 | 6 | 1 |

No count moves in this PR. The scissor split was already zero on every screen, because every clip
push and pop is also a `legacyTextOrder` barrier, and the barrier is what cuts each domain. What
this PR changes is that nothing but the barrier cuts one: with the barrier turned off (measured,
then turned back on), every screen is one GPU draw and `clipChange` reads zero. Deleting the
barrier is the ordering re-baseline's (DDB-67), which is also where the text-over-shapes order
changes.

Pixel conformance runs on the real shader in `tests/visual/web/uberShader.spec.ts`: geometry from
the production encoder in Node, drawn by `uber.vert` and `uber.frag` on a bare WebGL2 canvas in
the harness's SwiftShader, read back with `readPixels`. It covers chapter 4's fragment fixture at
ratio 2 on two target sizes and chapter 5.10's pixel tests: no halo, translucent border stays
opaque, symmetric one-pixel ramps at x 10.25, `center` border not clipped by the quad,
premultiplied output over a transparent clear, a flat triangle, a gradient to transparent with no
dark midpoint, a 24 px shadow with no cutoff, abutting rects with no seam, and rounded corners.

## Departures

**R5.4's packed layout.** Floats throughout, four vertices per quad. Allowed by R5.4; the
bandwidth figure is above. DDB-191 replaced it with 104-byte packed instances, one per quad
([packed-instance-layout.md](./packed-instance-layout.md)).

**R5.6's footprint** is the derivative of the local position, not of `d`, for the reason above.

**R5.10's snapping and R7.8's hairlines** were left out of this re-baseline so it stayed
attributable to chapter 5. DDB-188 applied them in `encodeRect` (see
[resource-layer-and-viewport.md](./resource-layer-and-viewport.md)).

**R4.14's rounded clip** was left out of this re-baseline. DDB-190 added it as a per-frame table
in the frame uniform block, indexed by the instance's spare mode byte
([rounded-clip.md](./rounded-clip.md)).

**R5.19 nine-slice** landed with DDB-203: `draw/nineSlice.ts` computes the grid (corners at one logical
pixel per texel, insets fitted to the source per axis, and every corner scaled by one factor when the
destination is smaller than two of them, CSS border-image's rule), and the encoder writes one `image`
quad per cell with a destination extent, all in the image's group. Image mode has no edge ramp, so cells
that share float edges meet with no seam. What it does need is a sampling clamp: at a cell's inner edge
linear filtering blends in the neighbouring cell's texel, and in a stretched cell that blend is smeared
over half a stretched texel (a 10 px ramp of border colour inside a 20x-stretched panel centre). Sliced
cells carry half a texel in UV in the image mode's unused shape lanes and their UV rect reaches the
fragment stage through the flat `vRadii`; the image branch clamps to that rect inset by half a texel (its
midpoint for a cell under a texel wide). Texel centres of a 1:1 corner are never moved, and an unsliced
image carries no inset and is not clamped, so its pixels are unchanged. A negative destination extent runs
the grid's edges the other way and mirrors, as an unsliced draw does.

**R3.17's blurred text shadow** is still drawn unblurred: the bitmap atlas has nothing to blur.
Chapter 6's distance fields fix it.

## How the rest dies

`mask` mode and the bitmap `FontAtlas` go with DDB-70's MSDF atlases, which use `text` mode.
`LegacyPaintOrder` and `legacyTextOrder` go with DDB-67.
