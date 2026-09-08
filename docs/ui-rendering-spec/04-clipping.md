# 4. Clipping and scrolling

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

Clipping decides which pixels of a draw survive; scrolling decides where content sits. The two are independent properties of a container (the Flutter and Unity decomposition worldsim adopted): a container may clip, offset, both, or neither. The design constraint that shapes this chapter is batching: a clip change must never split a batch or issue a GPU state change, because scrollable lists are exactly where draw counts are highest. The graphics review moved the fragment test off the device-pixel framebuffer coordinate and onto an interpolated logical position, which removes the device pixel ratio, the target height, and the y flip from the shader entirely (the three places worldsim's DPI bugs lived), and added the CPU cull that keeps a scrolled list from rasterising its hidden rows.

Rules are numbered R4.n.

## 4.1 Clip as per-draw data

- R4.1 The rectangular clip MUST be carried as data on every draw (per vertex or per instance), in screen space, in logical pixels, as `(minX, minY, maxX, maxY)`. The fragment stage discards fragments outside it. No scissor state, no flush, no state change. Clipped and unclipped geometry share one GPU draw. A draw under `none` carries the current target's rect or an all-covering rect such as `(-1e8, -1e8, 1e8, 1e8)`, a draw under `empty` is never uploaded, and the fragment test is unconditional. An implementation MAY instead keep a private "no clip" encoding that its fragment stage treats as pass-all (worldsim's instanced and baked branches rely on `(0, 0, 0, 0)` for that), provided `empty` is culled on the CPU and can never produce the encoding: worldsim's empty-intersection bug came from the two meeting, not from the encoding itself.
- R4.2 The clip stack has three states, not two: `none`, `rect`, and `empty`. Pushing a rect intersects it with the current rect; a disjoint intersection yields `empty`. While the state is `empty` the batcher MUST drop draws on the CPU; it MUST NOT collapse to `none`. Worldsim's nested region that should have been fully hidden became fully unclipped.
- R4.2a At submission the batcher MUST drop a draw whose transformed bounds (including shadow padding and ink extent) do not intersect the current clip rect, and MUST count it as `culled` (chapter 13, R13.12). For text the test is per run, not per glyph. An implementation MAY additionally clamp an axis-aligned, translate-only quad's vertices to the clip rect (moving the rect-local coordinate and UV by the same amount) so that clipped fragments are never rasterised; the fragment test remains as the general case. Without this rule a scrolled list of 500 rows transforms, uploads, and rasterises 488 hidden rows every frame; GPUI, Dear ImGui, and WebRender all reject against the clip on the CPU.
- R4.3 Nesting is intersection. `pop` restores the parent's precomputed rect; depth is unbounded.
- R4.4 The fragment stage tests an interpolated logical-space position (`v_pos`, `highp`, the untransformed screen-space vertex position passed down as a varying) against the logical clip rect with half-open edges: a fragment survives when `v_pos.x >= minX && v_pos.x < maxX && v_pos.y >= minY && v_pos.y < maxY`. Under an orthographic projection the interpolated value at a fragment centre is that centre's logical coordinate, so no device pixel ratio, framebuffer height, or y flip is involved and the test is identical for the window and for off-screen targets. The rectangular clip edge is not anti-aliased: a clip rect that is not on the device pixel grid discards or keeps whole pixels by their centres, so containers snap their clip rects (chapter 7, R7.8a) or an animating clip edge shimmers by one pixel.
- R4.5 Every primitive honours the clip: shapes, images, text, and flat triangles. Worldsim's text input wrapped its glyphs in a legacy scissor call that had no GPU effect, so overflowing input text was never clipped.
- R4.6 The clip is captured into the draw at submission time. Sorting (chapter 3), texture splitting, and later pushes and pops cannot change what a vertex is clipped to.

## 4.2 Local space and transforms

- R4.7 A clip rect is specified in the current local coordinate space and converted to screen space when pushed, using the current transform. Under translate-only transforms the conversion is exact. Under rotation or non-uniform scale the implementation MUST do one of three things: use the axis-aligned bounds of the transformed rect (a documented approximation that under-clips: content leaks past a tilted container's edges), carry an oriented-rectangle clip (centre, half size, rotation) in the per-draw clip slot of R4.14 and evaluate it in the fragment stage (the axis-aligned bounds then serve only the CPU cull of R4.2a), or fall back to stencil clipping (4.4). A development build MUST warn when a clip is pushed under a non-translate transform and only the approximation is implemented. Worldsim never transformed clip rects, so a scroll container nested inside an offset container clipped at the wrong place unless its position happened to be absolute.
- R4.8 Layer promotion (chapter 3, R3.8) resets the clip stack to `none` for the promoted subtree. A menu declared inside a scroll container is not clipped by it. A promoted subtree MAY push its own clip.

## 4.3 Scrolling (content offset)

- R4.9 A container has a `contentOffset` vector applied as a translation to its children, independent of clipping. Scrolling is `clip = own bounds` plus `contentOffset = (0, -scrollY)`.
- R4.10 The content offset MUST be applied before the clip is pushed, so the clip rect stays fixed on screen while the content moves inside it.
- R4.11 Input dispatched into an offset container MUST have the offset removed from the pointer position before children are hit-tested, and restored afterwards, so hit testing agrees with painting.
- R4.12 Pointer hit testing MUST reject points outside any ancestor's clip. A child scrolled out of view is not clickable even though its bounds still exist. Worldsim's scroll container gates its children on its viewport, its base container does not; the rule makes the gate part of the walk so no container has to remember it.
- R4.13 Content size for scrolling is the union of children's margin boxes (chapter 10) plus the container's padding; scroll extent is `max(0, contentSize - viewport)`. Wheel routing (innermost scroller that can move, latched for the gesture) is chapter 9, R9.32.

## 4.4 Non-rectangular clips

- R4.14 A rounded-rectangle clip SHOULD be supported without breaking batching by carrying the clip's rounded-rect SDF parameters as per-draw data and evaluating a second SDF on `v_pos` in the fragment stage; its edge is anti-aliased over one device pixel and multiplies coverage (not a discard). The cost is one extra SDF per fragment for every draw inside the clip, text included, which is acceptable. This covers the common case of a rounded panel clipping its children and an avatar mask. Nesting: a draw carries the axis-aligned intersection of every clip on the stack plus the SDF parameters of the innermost rounded clip only; outer rounded clips contribute their bounding rect (a documented approximation: content may show in an outer clip's corners by at most that clip's radius, which is why chapter 12's panel and scroll container inset their content by the radius when a second rounded clip would nest). A development build warns once per frame when two rounded clips nest; an implementation with the stencil path MAY route the outer clip through it instead.
- R4.15 Arbitrary clips (circle, polygon, or rounded rect if R4.14 is not implemented) MAY use the stencil buffer: flush, draw the mask into the stencil with colour writes off using an incrementing reference per nesting level, flush, then draw content with `stencil == depth`; pop restores the parent's reference. Each such clip costs at least two GPU draws and requires a stencil attachment on the target. An implementation that offers no stencil path MUST reject non-rect clip shapes at the API rather than silently approximating them with their bounding box, which is what worldsim does today.
- R4.16 `ClipMode.outside` (punch a hole) is optional and MUST NOT be advertised unless implemented (worldsim's `ClipTypes.h` advertises it and its draw API does not implement it).

## 4.5 Statistics and inspection

- R4.17 The batcher counts `clipPushes` and `culled` per frame (chapter 13, R13.12 and R13.14), and the tree snapshot carries the effective clip rect of each node (chapter 13, R13.22) so the layout lint can report content that is entirely clipped away.

## 4.6 Rationale

Per-command scissor (colonysim, worldsim's predecessor) forced a flush on every clip change and turned 35 shapes in three nested clips into 35 draw calls. Per-vertex clip data gives one draw call for the same list and, because it is data rather than state, it survives the group sort of chapter 3 unchanged. Stencil is kept for shapes the rectangle cannot express; it is the standard technique (PixiJS masks, Skia clip stacks), and its cost is proportional to the number of non-rect clips, which in a game UI is a handful per screen.

Testing an interpolated logical position rather than the framebuffer coordinate is the graphics review's correction: worldsim's fragment test compares `gl_FragCoord` against bounds scaled by the pixel ratio and flipped by the viewport height, and two of its three recorded DPI bugs were in that conversion; the varying costs nothing and makes the test target-independent. The three-state clip and the CPU cull are the other two corrections; the rest of the chapter is worldsim's design as built.

## 4.7 Required tests and fixtures

- Intersection: nested rects intersect; disjoint rects produce `empty`; draws under `empty` are not emitted; `pop` restores the parent exactly.
- Fragment test: with ratio 2, a clip at logical `(10, 10, 20, 20)` keeps the device pixel whose centre is `(20.5, 20.5)`, discards the one at `(19.5, 19.5)` and the one at `(40.5, 40.5)`; the same clip gives the same result on an off-screen target of a different size.
- Cull: a scroll container of 500 rows with 12 visible emits draw groups for the visible rows only and reports the rest as `culled`.
- Offset before clip: a container with `contentOffset (0, -100)` and a clip equal to its bounds keeps the clip rect fixed while a child at local y 150 renders at y 50.
- Hit test: a child scrolled out of the clip does not receive a click; a promoted popup declared inside the clip does.
- Nested rounded clips: a rounded scroll container inside a rounded panel clips with the inner radius and the outer bounding rect, and the development warning fires once per frame.
- Gallery fixture (chapter 13): nested rect clips, a rounded clip, a stencil clip if implemented, an animated content offset with a snapped clip edge (no shimmer), a rotated container with the oriented clip if implemented, and a text input whose text overflows its box.

## 4.8 Conformance checklist

| Item | Level |
|---|---|
| Per-draw rect clip, no flush on clip change, no encoding that `empty` can produce | required |
| Three-state clip stack with `empty` | required |
| CPU cull of draws outside the clip, counted | required |
| Fragment test on an interpolated logical position, half-open, target-independent | required |
| Clip converted to screen space through the current transform at push | required |
| Content offset decoupled from clip, applied before it | required |
| Hit testing honours clip and offset | required |
| All primitives including text honour the clip | required |
| Clip reset on layer promotion | required |
| Rounded-rect clip via per-draw SDF with the nesting rule | recommended |
| Oriented-rectangle clip for rotated containers | optional |
| Stencil clip for arbitrary shapes | optional |
| Outside (hole) clip mode | optional |
