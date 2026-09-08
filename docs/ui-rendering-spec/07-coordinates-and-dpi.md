# 7. Coordinates, device pixels, and resizing

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

Every public number in this specification is a logical pixel. The ratio between device pixels and logical pixels is consumed in a small, named set of places and never by layout, components, or the tree walk. Two of worldsim's recorded clipping bugs and its early "shapes scale with the window" bug all came from letting the ratio leak somewhere else. The graphics review corrected the hairline rule and its test (a 1 px border at ratio 2 is two device rows, not one) and folded the UI scale factor into the ratio every snap uses.

Rules are numbered R7.n.

## 7.1 Spaces

- R7.1 Logical space: origin at the top-left of the viewport, x right, y down, one unit per logical (CSS) pixel. Layout, component positions, draw calls, clip rects, input positions, the tree snapshot, and the lint all use it.
- R7.2 Device space: the framebuffer. `ratio` (device pixels per logical pixel) is `dpr * uiScale` (R7.5); it is the value every rule in chapters 4 to 7 snaps and tests against and the value the mount context exposes as the viewport's ratio. `dpr` alone is used only to size the canvas backing store. The ratio is consumed by the viewport, by pixel snapping, by the per-draw device-pixel constants the batcher computes at submission (anti-aliasing footprint, feather width, shadow padding, distance-field range, fallback raster size), and by screenshots. It is never read by layout, components, or the tree walk, and it is not a shader input (chapter 4, R4.4).
- R7.3 `dpr` is read from the platform (window content scale, `devicePixelRatio`) and re-read on every resize and monitor change. Both `dpr` and `ratio` are per-frame constants; a change takes effect at the next `beginFrame`.
- R7.4 The projection is an orthographic map from logical space to clip space rebuilt from the current logical viewport at every flush (chapter 5, R5.28). It is never hard-coded to a design resolution; shapes keep their logical size when the window resizes.

## 7.2 UI scale

- R7.5 A global UI scale factor `uiScale` (a settings value; 1 by default) is applied by defining the logical viewport as `framebuffer / (dpr * uiScale)`. Layout and input then work in the scaled logical space unchanged; nothing is rendered as a bitmap zoom. This is the design worldsim recorded (requirements only, not built) for its UI scale setting, and it is how a handheld (the Steam Deck in the deck builder's design document) gets larger UI without a second layout.
- R7.6 Because glyphs are distance fields and shapes are SDF quads, a non-integer `uiScale` stays crisp; the only artefacts are hairlines, which snapping handles.

## 7.3 Pixel snapping

- R7.7 Text run origins are snapped under translate-only transforms (chapter 6, R6.16).
- R7.8 Under translate-only transforms, an axis-aligned rectangle whose border width is at or below 1 logical pixel SHOULD snap each of its four edges independently to the device grid (`round(edge * ratio) / ratio`) and its border width to `max(1, round(width * ratio)) / ratio`, so hairlines occupy whole device pixels rather than two half-covered ones; each edge moves by less than half a device pixel and the size changes by at most one device pixel per axis. Rectangles with larger borders or radii rely on SDF anti-aliasing and are not snapped.
- R7.8a Clip rects of containers (chapter 4, R4.4) and the shared edges of abutting rects (chapter 5, R5.10) are snapped the same way, so a resizing panel's clip edge does not shimmer and tiled cells show no seam.
- R7.9 Nothing is snapped under scale or rotation.
- R7.10 Layout positions are not rounded by the layout engine; components hold fractional positions and the draw layer snaps at submission. Rounding in layout accumulates error across a stack of siblings.

## 7.4 Resizing

- R7.11 The viewport (logical size, `dpr`, `uiScale`, and the derived `ratio`) has one owner, the application shell, which updates the framebuffer, the projection inputs, and the roots' boxes, then invalidates layout. Components read the viewport from the mount context or their `screenBounds` (chapter 8, R8.13); they never read the window.
- R7.12 A resize re-runs the same layout path as the first layout. Screens that position by hand express their positions as functions of the root size and re-run those functions on resize; there is no separate resize layout.
- R7.13 Render targets that are not the window (an off-screen composite, an asset preview) carry their own logical size and ratio; the draw API takes the target's viewport, not the window's, and clips pushed while drawing into a target are captured in the target's space (chapter 3, R3.26).

## 7.5 Input coordinates

- R7.14 Pointer positions arrive in platform units (CSS pixels relative to the page in a browser, window coordinates natively) and are converted to logical space once, at the dispatcher's entry: subtract the canvas origin (in the same platform units), then divide by `uiScale`. Everything downstream is logical.
- R7.15 The injection API (chapter 13, R13.35) takes logical coordinates, the same space the tree snapshot reports, so a test can click the centre of a node's snapshot bounds.

## 7.6 World-space overlays

- R7.16 A world renderer that draws UI over world objects (health bars, names, targeting lines) converts world positions to logical screen positions itself and draws through the draw API in a world-space UI domain (chapter 3, R3.21), or pushes a transform (chapter 2, R2.4) and draws in world units. Either way the UI domain that follows is unaffected.

## 7.7 Rationale

Keeping the API in logical pixels and naming every consumer of the ratio is what makes DPI bugs local: when a hairline blurs, the answer is in snapping; when a clip is off, the answer is in the clip conversion at push (the fragment test no longer involves the ratio at all); when everything is the wrong size, the answer is in the viewport. Worldsim reached this by elimination; the sibling engine has the ratio in the atlas rasteriser, in the scissor code (with its own y flip), in per-glyph rounding, and in thirteen window-size reads.

## 7.8 Required tests

- Viewport 1440 by 882 at ratio 2: framebuffer 2880 by 1764; a rect at logical (10, 10) covers device (20, 20).
- Clip test with ratio 2 (chapter 4 test).
- Hairline snap: a 1 px border at y 10.4 with ratio 2 covers device rows 21 and 22 fully and no part of rows 20 or 23; with ratio 1 it covers row 10 fully; a 1.3 px border at ratio 1 snaps to one device row.
- UI scale 1.25 at `dpr` 1: logical viewport 1152 by 705.6; `ratio` 1.25; a full-width stack's children fill 1152; a click at CSS (720, 441) with the canvas at the page origin hits logical (576, 352.8); a text run origin snaps to multiples of 0.8 logical pixels.
- Resize: after a resize event, layout has run once and the tree snapshot's viewport matches the new size; no component read the window.

## 7.9 Conformance checklist

| Item | Level |
|---|---|
| Logical pixels everywhere public, y down, top-left origin | required |
| `ratio = dpr * uiScale` confined to the viewport, snapping, per-draw submission constants, and screenshots; not a shader input | required |
| Projection from the current logical viewport at every flush | required |
| Text run snapping | required |
| Single viewport owner, resize through the normal layout path | required |
| Input converted to logical space once at the dispatcher, origin before scale | required |
| UI scale via logical viewport definition | recommended |
| Hairline edge and width snapping; clip and shared-edge snapping | recommended |
