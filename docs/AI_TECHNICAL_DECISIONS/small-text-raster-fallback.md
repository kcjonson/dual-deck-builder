# Small-text raster fallback (DDB-199)

## Context

R6.4a: a run whose screen-space distance range falls below 1.5 device pixels SHOULD be drawn from a per-(face, size, ratio) atlas rasterised by the platform's 2D text API, with measurement unchanged; and a token scale SHOULD define no text size below 11 logical px. With the committed atlases (48 px per em, range 8) the range is `8 * size * ratio / 48`, so at ratio 1 that is 8 px and below. 9 px sits exactly on 1.5 and is not below it.

The token scale already stops at 11 (`fs_xs`). The game still draws literal 8 and 9 px in `Vehicle` (driver name 9, driver HP 8, structure value 9, the SPENT chip 9); the other literal sites went with DDB-82's combat rework. What matters is device size, though, not the number in the style: DDB-82 draws the combat stage under a uniform scale transform (`min(W / 1280, H / 720)`), and cards are drawn scaled elsewhere. At the capture viewport (1440x882) the runs that fall under the threshold are the card showcase's 8 px body text, the driver selection's scaled cards (display role at 4 and 7 device px) and an 8 px caption in the `icons` scene; combat's 8 px HP lands on exactly 9 device px at scale 1.125 and stays on the field. At 1280x720 it is under; at 800x450 (scale 0.625) every combat run under 14.4 px is.

## Options

1. **Move the literal sites to the token scale (11 px) and skip the fallback.** Meets the token half of R6.4a with no engine work, but `Vehicle` places its driver rows at 30 and 42 percent of the card height (8.6 px apart on a 72 px card), so 11 px overlaps and needs a re-layout, which is a design decision. And it would not be enough: 11 px on the combat stage at 800x450 is under 7 device px, and scaled cards go lower still.
2. **Sharpen or darken in `text` mode at small sizes.** Not what R6.4a asks for, and it would move every small run in every golden.
3. **Build the fallback R6.4a describes.** Layout does not move (placement is still the distance-field layout), and only runs under the threshold change.

## Decision

Option 3, with option 1 filed for design (DDB-217).

- `text/rasterGlyphs.ts`: the threshold (`RASTER_RANGE_THRESHOLD`, strict less-than), `planRasterGlyphs` (one cell per glyph with a plane, the plane rounded out to whole device pixels from the pen, shelf-packed with a one-texel gutter), and `rasterizeGlyphs` (white `fillText` per cell, clipped to it, pen on a whole texel).
- `text/platformFaces.ts`: the TTFs behind the atlases, registered as `FontFace`s under private family names (`ddb-<face>`), so no page font can stand in for them. Loading is not awaited; a role draws small text from the distance field until its face is ready. `document.fonts.ready`, which the screenshot harness awaits, covers them.
- `rendering/SmallTextAtlases.ts`: builds an atlas the first time a run needs one, synchronously, and uploads it immediately. The spec says "at load time", but the sizes in use are not known then; building inside the first frame that needs it means that frame already draws from it, so there is no soft first frame and captures do not depend on frame counts. Keyed on (role, device font size), the size rounded to a quarter pixel so a zoom or resize reuses a few atlases; at most four built a frame (a run past that draws from the field for one frame); replanned when a role's atlas is reloaded; freed after 300 idle frames. The canvas is the kept source, so a restored context uploads it again.
- `UberGeometryEncoder`: an unblurred run under a translation or a uniform positive scale, whose device size (`size * scale * ratio`) puts it under the threshold, draws its glyphs as `image`-mode quads from the raster atlas (premultiplied white coverage times the text colour, which is exactly what image mode computes, so the shader is unchanged). Placement is the same `TextLayout` taken through the transform; each glyph's pen and each baseline is rounded to a device pixel (R6.16 allows per-glyph snapping under 16 px), advances untouched. Rotated, skewed or unevenly scaled runs and blurred shadow runs stay on the distance field. Supporting the uniform scale is what makes the fallback reach the game at all, since the combat stage and the scaled cards are drawn under one.
- R6.3 substitutes: a glyph that stands in for an absent code point (U+FFFD drawn as `?`, U+2011 as `-`) now carries `outlineCodePoint`, and the rasteriser draws that, so the raster holds the outline the atlas does rather than a system fallback font's.
- Font files ship as asset modules: URLs in the web build, data URIs in Electron (R15.34). About 550 KB for the three faces; the icon font is not loaded, and icons stay on the distance field at every size.

## The scored gate (6.9)

`tests/visual/web/uberShader.spec.ts` renders the body face at 10, 12 and 13 px through the uber shader and through the platform's canvas from the same TTF, and scores stem weight (total ink of a word) and evenness (variation of the darkest column of each `l` in a row). On macOS Chromium the field scores 0.64, 0.67 and 0.72 of the platform's ink, with stem variation 0.24, 0.17 and 0.18 against the platform's 0.15, 0.09 and 0.05. Enlarged, the field is lighter and softer than the hinted raster. The test is a ratchet with floors under those numbers, not a target; closing the gap is stem darkening in `text` mode at small screen ranges (DDB-218), which moves most text in most goldens and wants its own review.

## Consequences

- Text under 9 device px is crisper and heavier than before. Where it sits beside field text a pixel larger it is now the heavier of the two, since the platform's raster is heavier than the field at every small size; the darkening follow-up would bring 9 to 13 px toward it.
- Goldens move where runs are under the threshold at 1440x882: `cardShowcaseScreen`, `driverSelectionScreen` and the `icons` scene. `combatScreen` does not move at that size.
- Any future run under 9 device px takes this path with no call-site change.
