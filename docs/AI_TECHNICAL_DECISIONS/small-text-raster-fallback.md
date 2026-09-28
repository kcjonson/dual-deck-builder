# Small-text raster fallback (DDB-199)

## Context

R6.4a: a run whose screen-space distance range falls below 1.5 device pixels SHOULD be drawn from a per-(face, size, ratio) atlas rasterised by the platform's 2D text API, with measurement unchanged; and a token scale SHOULD define no text size below 11 logical px. With the committed atlases (48 px per em, range 8) the range is `8 * size * ratio / 48`, so at ratio 1 that is 8 px and below. 9 px sits exactly on 1.5 and is not below it.

The token scale already stops at 11 (`fs_xs`). The game still draws literal 8 and 9 px in `Vehicle` (driver name 9, driver HP 8, structure value 9, the SPENT chip 9); the other literal sites went with DDB-82's combat rework. What matters is device size, though, not the number in the style: DDB-82 draws the combat stage under a uniform scale transform (`min(W / 1280, H / 720)`), and cards are drawn scaled elsewhere. At the capture viewport (1440x882) the runs that fall under the threshold are the cards' footer lines in the card showcase and the combat hand, and the 8 px armor badge values in the `icons` scene; combat's 8 px HP lands on exactly 9 device px at scale 1.125 and stays on the field. At 1280x720 it is under; at 800x450 (scale 0.625) every combat run under 14.4 px is.

## Options

1. **Move the literal sites to the token scale (11 px) and skip the fallback.** Meets the token half of R6.4a with no engine work, but `Vehicle` places its driver name and HP rows at 30 and 42 percent of the card height, about one line of 9 px text apart on the enemy cards, so 11 px overlaps and needs a re-layout, which is a design decision. And it would not be enough: 11 px on the combat stage at 800x450 is under 7 device px, and scaled cards go lower still.
2. **Sharpen or darken in `text` mode at small sizes.** Not what R6.4a asks for, and it would move every small run in every golden.
3. **Build the fallback R6.4a describes.** Layout does not move (placement is still the distance-field layout), and only runs under the threshold change.

## Decision

Option 3, with option 1 filed for design (DDB-217).

- `text/rasterGlyphs.ts`: the threshold (`RASTER_RANGE_THRESHOLD`, strict less-than), `planRasterGlyphs` (four cells per glyph with a plane, one per quarter-pixel phase, each the plane rounded out to whole device pixels from the pen plus a column to shift into, shelf-packed with a one-texel gutter), and `rasterizeGlyphs` (white `fillText` per glyph into a canvas four times as wide, then box-filtered into the phases in JS; the texels, premultiplied white, are the upload).
- `text/platformFaces.ts`: the TTFs behind the atlases, registered as `FontFace`s under private family names (`ddb-<face>`), so no page font can stand in for them. Loading is not awaited; a role draws small text from the distance field until its face is ready. `document.fonts.ready`, which the screenshot harness awaits, covers them.
- `rendering/SmallTextAtlases.ts`: builds an atlas the first time a run needs one, synchronously, and uploads it immediately. The spec says "at load time", but the sizes in use are not known then; building inside the first frame that needs it means that frame already draws from it, so there is no soft first frame and captures do not depend on frame counts. Keyed on (role, device font size), the size rounded to a quarter pixel so a zoom or resize reuses a few atlases; at most four built a frame (a run past that draws from the field for one frame); replanned when a role's atlas is reloaded; freed after 300 idle frames. The canvas is the kept source, so a restored context uploads it again.
- `UberGeometryEncoder`: an unblurred run under a translation or a uniform positive scale, whose device size (`size * scale * ratio`) puts it under the threshold, draws its glyphs as `image`-mode quads from the raster atlas (premultiplied white coverage times the text colour, which is exactly what image mode computes, so the shader is unchanged). Placement is the same `TextLayout` through the transform; each baseline rounds to a device row and each pen to its nearest quarter pixel, drawn as the whole pixel's cell in that phase, so a cell is one texel to one pixel and glyphs sit within an eighth of a pixel of the layout. Rotated, skewed or unevenly scaled runs and blurred shadow runs stay on the distance field. Supporting the uniform scale is what makes the fallback reach the game at all, since the combat stage and the scaled cards are drawn under one.
- R6.3 substitutes: a glyph that stands in for an absent code point (U+FFFD drawn as `?`, U+2011 as `-`) now carries `outlineCodePoint`, and the rasteriser draws that, so the raster holds the outline the atlas does rather than a system fallback font's.
- Font files ship as asset modules: URLs in the web build, data URIs in Electron (R15.34). About 550 KB for the three faces; the icon font is not loaded, and icons stay on the distance field at every size.

## The scored gate (6.9)

`tests/visual/web/uberShader.spec.ts` renders the body face at 10, 12 and 13 px through the uber shader and through the platform's canvas from the same TTF, and scores stem weight (total ink of a word) and evenness (variation of the darkest column of each `l` in a row). The reference is the platform's, so the numbers depend on it:

| | 10 px | 12 px | 13 px |
|---|---|---|---|
| Weight, field over platform, Linux CI (FreeType) | 0.97 | 1.00 | 0.95 |
| Weight, macOS Chromium (CoreText) | 0.64 | 0.67 | 0.72 |
| Stem variation, field | 0.24 | 0.17 | 0.18 |
| Stem variation, platform, Linux | 0.00 | 0.00 | 0.00 |
| Stem variation, platform, macOS | 0.15 | 0.09 | 0.05 |

On the reference platform the field's weight matches; what it lacks is evenness, since its stems land at whatever sub-pixel phase the layout gives them and the hinted platform raster puts every stem on a pixel. The test is a ratchet (a platform-dependent weight floor, a variation ceiling a little above today's), not a target. Closing the evenness gap is DDB-218.

## Spacing: quarter-pixel phases

The first version rounded each glyph's pen to a whole pixel. The advances are the field's unhinted ones (R6.8), so the rounding alternated with the pen's sub-pixel phase and gaps varied by a pixel: on the card footers "attack" at about 7 device px read "atta ck". That was not acceptable on player-facing text. What was tried:

- **Whole-pixel advances pinned to the layout per word** (each gap its advance rounded down or up, chosen for the word at once, the ends within half a pixel, no pen more than a pixel off). Better on paper and still "atta ck": at 7 px the `t` advances 2.5 px, so any whole-pixel scheme alternates 2 and 3 and "tta" packs tight next to an open "a c". Hinted platform text avoids that only by making the word wider, which measurement cannot follow.
- **Quarter-pixel phases** (kept). Each glyph is rasterised once at four times the horizontal resolution (`setTransform(4, 0, 0, 1, 0, 0)`) and box-filtered into four variants a quarter pixel apart. Pens take the nearest variant, so a 2.5 px advance stays 2.5 px. The shift is done in JS rather than with a fractional `fillText` x because Chrome snaps canvas text to whole pixels on Linux at ratio 1 (the 6.9 reference row of `l`s scores exactly zero variation there), which would have silently collapsed the phases. The cost is a little horizontal softness from the box filter, the same trade Skia's sub-pixel text makes; vertical edges keep whatever hinting the platform applies.

Atlases are four times the glyph area (about 512 by 120 at 8 px) and read back from the canvas once when built.

## Consequences

- Text under 9 device px is crisper than before and keeps the layout's spacing to an eighth of a pixel. On macOS it is also heavier than field text a pixel larger beside it; on Linux the two match in weight.
- Goldens moved where runs are under the threshold at 1440x882: `cardShowcaseScreen` (the card footers' tag and target lines), `combatScreen` (the same lines on the hand's scaled cards) and the 8 px armor badge values in the `icons` scene. Combat's 8 px HP lands on exactly 9 device px at scale 1.125 and does not move.
- Any future run under 9 device px takes this path with no call-site change.
