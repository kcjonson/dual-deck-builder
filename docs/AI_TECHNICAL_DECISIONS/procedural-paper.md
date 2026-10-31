# Procedural paper

## Date
2026-10-31

## Context

[UI Art Direction](../specs/UI%20Art%20Direction.md) builds the meta screens from paper: three wear levels, grime in the edge band and the corners, a flat reading window, folds, tape, stamps, and hand marks. The TypeScript bakes all of it ([ui-art-atlas.md](./ui-art-atlas.md)): a script rasterises SVG pieces whose texture comes from `feTurbulence` filters into one 2048x2048 page, and the paper draws nine-sliced and tinted.

salal draws no raster images and has no nine-slice (salal's `docs/ui-design.md`, "Remaining rules"). Its textures are MSDF atlases and render targets, and its icons are single-colour filled SVG. The alpha's art has to fit that, or salal has to change.

## Options considered

1. **Raster in salal.** An Image component, nine-slice, art residency, decoding and context-loss handling, and RGBA pages that can't share the MSDF pages' slots without splitting draws. Keeps the atlas whole; engine work for one game's prototype art, before any screen starts.
2. **SVG filters at run time.** A filter is per-pixel work over an offscreen buffer, so each filtered element needs its own pass and an interpreter for the filter graph (`feTurbulence`, `feColorMatrix`, `feComposite`, `feDisplacementMap`, the lighting primitives). nanosvg, which salal reads SVG with, parses none of it. A browser compositor, for paper.
3. **Flat vector paper.** Tinted rects with no wear. The fastest; the look goes.
4. **Vector grain and decals.** A tessellated grain tile repeated under a clip, with seeded grime decals at the corners. Needs nothing new in salal, but a sheet is hundreds of small shapes, the tile's grid shows, and a uniform tile can't build up toward the edges the way the wear does.
5. **A fill hook.** The paper computed in the base shader, per pixel, for the rects that ask for it. The same noise a filter makes, where it is drawn, in the batch with everything else.

## Decision

The paper is a fill hook, and the rest of the art is vector.

### The paper

`apps/wasteland-wheels/shaders/paper.frag.glsl`, passed to `salal_base_shader(wasteland-wheels HOOKS ...)`. salal's `docs/shader-hooks.md`, "Fill hooks", is the mechanism: the hook gets the pixel's place in the rect, the rect's half size, its tint, twelve bytes of params, and a pixel's size, and returns the paper's colour there. The rect still draws its border, corners and clip itself.

The params are the surface's, packed by the component that draws it:

- a 32-bit seed;
- the wear level, W0 to W3;
- the grab corner, for W1's smudge;
- for W3, the hero corner and its mark (burn, hole, or rip);
- for W2, the fold count, and the exposed side for things that ride in the vehicle.

The hook's uniform block holds what the look is tuned by: grime strength per wear level, the band and fade fractions, the mottle's frequency and octaves. C++ fills it from constants at startup, so the numbers sit beside the test that checks them.

What it draws follows the spec's wear rules directly, which the nine-slice only approximated with fixed insets:

- The edge band is 6% of the shorter side, and grime fades to nothing over the next 6%. Inside that the hook returns the tint exactly, after one distance test, so the reading window is flat and a full-screen sheet pays for noise only near its edges.
- W1 is an edge tone and one smudge at the grab corner. W2 adds mottled grime in the band, a margin stain, and shallow tears as darker notches. Its folds are low-contrast tone lines that may cross the window. W3 adds its one hero mark: a burn darkens to char, and a hole or rip returns alpha 0, so the table shows through.
- A surface under 120 px on its short side gets the edge tone only.
- The seed comes from what the surface is (the scene and the surface's name, or the POI, driver, or run it belongs to), never from the frame or the layout, so wear never moves or reshuffles.

Contrast is checked without a GPU. The hook darkens the tint by at most its wear level's grime strength, so the darkest paper is the tint times one minus that strength. A unit test computes ink's contrast against it for every paper token at every wear level and fails under 4.5:1, outside W3's hero corner as the spec allows.

### Everything else

- **Vector, through salal's `renderer/vector`:** stamps (LOST, FALLEN, a cleared POI), tape strips, the logo and small mark, the card back's emblem and contour lines, and the closed-atlas cover's spine shadow and page edges. Each is flat-fill SVG with no filters or masks, which nanosvg doesn't read. `mark.svg` and `mark-small.svg` are already that. `logo.svg` gets its brush edges and chipped paint from filters and a mask, so the alpha ships a flattened copy with plain fills (letterforms, casing, the drop shadow as an offset copy, tire tracks, and the wheel), and the paint texture waits until someone redraws it as geometry.
- **Paper-backed pieces** are paper rects with vector on top: the card back is atlas stock (W1 paper with its ink edge as the rect's border), and the closed-atlas cover is a W2 sheet.
- **Hand marks:** highlighter is a second fill hook, `highlighter.frag.glsl`, on the rect behind the label it marks: streaks, a darker start, chisel ends cut by alpha, and Highlighter yellow at normal blend, so ink lands on top at full strength. The grease-pencil loop is a polyline with a seeded wobble. Both take a seed, so two selections never match.
- **Icons, through `salal_icons`:** the resource strip's six stroke icons are outlined into filled SVG. The deck glyph's two card outlines become two icons, each tinted its casing colour and drawn overlapped.
- **The compound plate** was already vector (UI Art Direction, open question 2).

## Trade-offs and consequences

- The real screens wait on salal's fill hooks. Text is still blocked separately, on the game's font atlases.
- The mottle is fractal noise in GLSL. It looks like the mocks' `feTurbulence`, not the same, and two GPUs can differ in its last bits. Nothing compares it pixel for pixel, and the seed is what holds a surface steady.
- Every pixel of a hooked rect runs the hook, so it costs GPU time where the atlas cost a texture read. Most of a sheet is window and exits early, and the cost gets measured against main when the hook lands.
- Paper is rects only. A non-rect paper shape is a rect with the hook cutting it by alpha.
- No 1x/2x pairs: the paper and the vector art are sharp at any pixel ratio.
- The logo is flatter than the mock until its texture is redrawn as geometry.
- The atlas, its build script and its 67 pieces stay in `_legacy/` until cutover deletes them. Nothing is carried over.
