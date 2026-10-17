# The UI art atlas

## Date
2026-10-16

## Context

The playtest look ([UI Art Direction](../specs/UI%20Art%20Direction.md), [ui-art-direction.md](./ui-art-direction.md)) needs baked art: paper at three wear levels, tape, hand marks, stamps, card backs, the splash's closed atlas, the logo and small mark, and stroke icons. The canvas mocks fake all of it with SVG filters, and the engine draws none of that at runtime, so it has to be rasterised once and drawn as images.

What the engine had: `drawImage` with a source rect, a multiplied tint and nine-slice insets (R5.18, R5.19, `draw/nineSlice.ts`); a resident texture set that keeps textures on fixed units for the whole frame (R5.20, `ResidentTextureSet`) holding only the three font atlases and the icon atlas; and dynamic units for everything else. There was no UI art atlas, so an art draw would have taken a dynamic unit, and the R5.31 card-art array is still deferred.

## Decisions

### One offline page, resident beside the fonts

R5.31 says UI atlases are built offline and never evicted, and R5.20 names the UI art atlas as one of the resident units. The art is one 2048x2048 RGBA PNG, `src/assets/ui-art/ui-art.png`, imported as a bundler asset like the font pages (R15.34), decoded at startup, uploaded as an immediate colour texture that keeps its image for a context restore, and handed to the backend with `DrawApi.loadArtAtlas`. The WebGL2 backend appends it to the resident set after the font atlases, so a list row of paper, icon and label is still one GPU draw. The image mode already samples any unit by slot; the shader's unit count went from 8 to WebGL2's guaranteed 16 (R5.20), because the page is a fifth resident texture and the area map already takes three dynamic units (terrain, fog, small text), so with 8 a fourth image would have split a submission.

A failed load is not fatal, unlike the fonts: it is logged, `DrawApi.artAtlas('ui')` stays null, and `drawUiArt` returns false. A paper piece then draws a flat rect of its tint, and a baked surface piece (the cover, card stock) its `ground` colour, so ink laid on paper never lands on the dark table; marks and icons draw nothing.

No mipmaps. The pieces are drawn near their native size, and the 1x/2x pairs cover device pixel ratio. A downscaled piece (a stamp at 0.5) aliases a little; mips arrive with the R5.31 texture array.

Every sliced piece (paper, cover, card edge, highlighter) has a 2x raster beside its 1x one, and `drawUiArt` picks it when the frame's ratio is above 1. Its insets are in 2x texels and carry `scale: 2`, which `NineSlice` now takes: the corners draw at one logical pixel per `scale` texels, so a 2x corner is the 1x corner's size, only sharper.

Size: 64 pieces on one 2048x2048 page. The logo at 2x (1400x686) is a third of it; the 2x paper about another quarter. Shelf packing no longer fit once the 2x paper arrived, so pieces are packed with MaxRects (best short side fit).

### Built by a script, from SVG

`scripts/build-ui-art.mjs` rasterises every piece in `scripts/ui-art/pieces.mjs` with Playwright's Chromium, which `npm ci` already installs, and the canvases already render in. Each piece is SVG with geometry and colours lifted from the canvas sources; texture comes from `feTurbulence` with fixed seeds, and every other random choice from a PRNG seeded by the piece's name. Pieces are packed by MaxRects (largest first, ties by name) with a 4 px gutter their edge texels are extruded into, so linear filtering never reads a neighbour. The script writes the page and a generated, typed manifest (`src/renderer/game/art/uiArtManifest.ts`). `--check` rebuilds in memory and compares bytes; it is stable on one machine, but another Chromium or OS can anti-alias a stroke differently, so it is not a CI gate. It ignores line endings in the manifest, so a Windows checkout with autocrlf does not read as stale.

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

## How components use it

```ts
import { drawUiArt, uiArtSize } from '../art/uiArt';

drawUiArt(draw, { name: 'paper_w2_a', rect, tint: sheetColour });   // nine-sliced, tinted
drawUiArt(draw, { name: 'icon_water', rect: { x, y, ...uiArtSize('icon_water') }, tint: inkColour });
```

`UiArtName` is the union of piece names, so a typo is a compile error. Pass the 1x name; `drawUiArt` draws the `*_2x` raster itself when the ratio is above 1. Tape is drawn level; rotate it onto a corner with `pushTransform`.

The gallery scenes `ui-art-paper`, `ui-art-cover` and `ui-art-marks` (developer sections of the same names) draw every piece through the engine, and `ui-art-sheet` is the screen sheet whole at the window's size: W2 under the margin, neatline, fold and tape, with a W1 legend box.

## Deferred

- Mipmaps, until the R5.31 texture array.
- The compound plate: the spec's open question 2 recommends vector, so it is not baked here.
- The reversed logo for dark grounds, and the app icon and favicon from the small mark.
- Section-tab icons other than the deck glyph; the spec's tabs are text.
- Wear that accrues over a campaign (yellowing, tears per injury).
- Folds are a separate strip (`paper_fold`) a component draws across a W2 sheet, since a crease crosses the reading window and the centre slice has to stay flat.
