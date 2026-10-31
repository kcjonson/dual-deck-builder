# The UI art atlas

## Date
2026-10-16

## Context

The playtest look ([UI Art Direction](../specs/UI%20Art%20Direction.md), [ui-art-direction.md](./ui-art-direction.md)) needs baked art: paper at three wear levels, tape, hand marks, stamps, card backs, the splash's closed atlas, the logo and small mark, and stroke icons. The canvas mocks fake all of it with SVG filters, and the engine draws none of that at runtime, so it has to be rasterised once and drawn as images.

Drawing it takes an image draw with a source rect, a multiplied tint, and nine-slice insets (R5.18, R5.19).

## Decisions

### One page, built offline

The art is one 2048x2048 RGBA PNG, `_legacy/src/assets/ui-art/ui-art.png`, built offline, loaded at startup, and kept for the whole run beside the font atlases.

A failed load is not fatal, unlike the fonts: it is logged, and the art draws fall back. A paper piece draws a flat rect of its tint, and a baked surface piece (the cover, card stock) its `ground` colour, so ink laid on paper never lands on the dark table; marks and icons draw nothing.

No mipmaps. The pieces are drawn near their native size, and the 1x/2x pairs cover device pixel ratio. A downscaled piece (a stamp at 0.5) aliases a little.

Every sliced piece (paper, cover, card edge, highlighter) has a 2x raster beside its 1x one, drawn when the frame's pixel ratio is above 1. Its insets are in 2x texels at a scale of 2: the corners draw at one logical pixel per two texels, so a 2x corner is the 1x corner's size, only sharper.

Size: 67 pieces on one 2048x2048 page (the result screens added the LOST and FALLEN stamps and a tag's tear, DDB-511). The logo at 2x (1400x686) is a third of it; the 2x paper about another quarter. Shelf packing no longer fit once the 2x paper arrived, so pieces are packed with MaxRects (best short side fit). A rebuild pins every piece the committed manifest already places at its size and packs only new or resized pieces round them, so adding art never moves existing pieces (DDB-511).

### Built by a script, from SVG

`_legacy/scripts/build-ui-art.mjs` rasterises every piece in `_legacy/scripts/ui-art/pieces.mjs` with Playwright's Chromium. Each piece is SVG with geometry and colours lifted from the canvas sources; texture comes from `feTurbulence` with fixed seeds, and every other random choice from a PRNG seeded by the piece's name. Pieces are packed by MaxRects (largest first, ties by name) with a 4 px gutter their edge texels are extruded into, so linear filtering never reads a neighbour. The script writes the page and a generated, typed manifest (`_legacy/src/renderer/game/art/uiArtManifest.ts`). `--check` rebuilds in memory and compares bytes; it is stable on one machine, but another Chromium or OS can anti-alias a stroke differently, so it is not a CI gate. It ignores line endings in the manifest, so a Windows checkout with autocrlf does not read as stale.

### Paper is white, wear is multiplied, the tint is the paper

Paper pieces are authored on white with the wear multiplied in (`tint: 'surface'`). The draw tints them with the surface's paper token, so the flat centre slice comes out exactly that colour and the wear darkens it the way the mock's `multiply` grime does, at normal blend (R5.22a: no blend change). The closed-atlas cover is the exception and is baked in colour, because its spine highlight is lighter than the paper and a multiplied tint cannot lighten.

Wear sits only in corner and edge slices; the centre is flat white, and a test checks every centre texel. The edge band follows the spec (full grime to the band, gone by twice it). A tear, a stain or a hero mark lives inside a corner slice, never an edge slice.

The edge slices are the same all along their length: only the band's even tone reaches them, and the turbulence mottle is masked to the corners, fading out by the inset. A full-screen sheet stretches an edge slice about ten times (1412 px from the few texels between corners), and a slice that varied along its length streaked; one that does not cannot. The cost is that a long edge reads as an even band, with the mottle at the corners, and a test checks every edge row and column is one colour. Tiling the edge would have kept mottle along it, but needed seamless noise that also met each corner, for a look the playtest doesn't need yet.

Insets: W1 is 16 px with a 48 px grab corner bottom right; W2 is 96 px; W3 is 128 px to hold its hero mark. W2 and W3 carry 8 texels of edge between corners, so any surface of at least two corners stretches rather than squeezes. Below two corners, R5.19 scales the corners down; W1 is the right piece there anyway, and the spec keeps W2 for sheets and backdrops.

Contrast: the mock's grime at full strength takes ink on Sheet to 3.2:1 at its darkest blot. Grime strength is scaled (W2 0.55, W3 0.54, W3's specks faded) until ink holds 4.5:1 on every opaque texel of every paper piece, tinted as it draws, outside W3's hero corner. A test measures it on the committed page.

### Icons go in the art atlas, not the MSDF icon atlas

The icon atlas is Material Icons through `msdf-atlas-gen`, which builds from a font. The resource strip's stroke icons are six SVG paths and would need a custom font build and an external binary to join it; the deck glyph is two colours and cannot be a distance field at all. So all seven are in the art atlas, at 1x (18 px, the deck 20x18) and 2x. The six resource icons are white coverage (`tint: 'ink'`) for an ink or stronghold tint; the deck glyph is baked. The cost is resolution independence: at a ratio above 2 they soften. If the strip grows past a handful of icons, a small custom icon font through the existing MSDF pipeline is the better home.

### The highlighter is a baked tone

R5.20 and the spec: no `multiply`. Each swipe is baked in Highlighter yellow at about 0.6 to 0.75 alpha with streaks and a darker start, drawn at normal blend before the label it marks, so ink sits on top at full strength. Swipes are three-sliced: the chisel ends keep their shape and the middle stretches to the row.

## Drawing a piece

A piece is drawn by its 1x name at a rect with a tint, paper nine-sliced, and the 2x raster stands in above a pixel ratio of 1. The TypeScript did this in `drawUiArt` (`_legacy/src/renderer/game/art/uiArt.ts`). Tape is drawn level; the component placing it rotates it onto a corner.

## Deferred

- Mipmaps, until the R5.31 texture array.
- The compound plate: the spec's open question 2 recommends vector, so it is not baked here.
- The reversed logo for dark grounds, and the app icon and favicon from the small mark.
- Section-tab icons other than the deck glyph; the spec's tabs are text.
- Wear that accrues over a campaign (yellowing, tears per injury).
- Folds are a separate strip (`paper_fold`) a component draws across a W2 sheet, since a crease crosses the reading window and the centre slice has to stay flat.

## In the C++ alpha

None of this ports (2026-10-31, [procedural-paper.md](./procedural-paper.md)). salal draws no raster art and has no nine-slice, so the alpha computes its paper in the base shader, a fill hook seeded per surface, and draws the stamps, tape, logo, card backs and cover as flat-fill vector, with the icons through salal's icon pipeline. The page, its build script and its pieces stay in `_legacy/` until cutover deletes them.
