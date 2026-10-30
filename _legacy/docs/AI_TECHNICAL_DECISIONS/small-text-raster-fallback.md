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

- `text/rasterGlyphs.ts`: the threshold (`RASTER_RANGE_THRESHOLD`, strict less-than, with `RASTER_RANGE_HYSTERESIS` for a size already on the raster; the encoder keys that state on font and raster pixel size, the quarter-pixel device size the glyphs are built at, and holds it while the size was drawn from the raster this frame or the last. Two runs that share it share glyphs, so they look alike; the first cut's key, font and logical size within a 6.7 percent scale band, let a run at range 1.47 put another at exactly 1.5 on the raster (DDB-223)), `rasterGlyphBox` (a glyph's plane rounded out to whole device pixels from the pen, plus a column for the phases), and `rasterizeGlyphs`: a run's missing glyphs drawn in white side by side on one scratch canvas four times as wide, a blank gap between them in place of a clip per glyph, read back once, and box-filtered in JS into four phase cells each; the texels, premultiplied white, are what gets written to the page.
- `text/platformFaces.ts`: the TTFs behind the atlases, registered as `FontFace`s under private family names (`ddb-<face>`), so no page font can stand in for them. Loading is not awaited; a role draws small text from the distance field until its face is ready. `document.fonts.ready`, which the screenshot harness awaits, covers them.
- `rendering/RasterGlyphPage.ts`: one 1024 by 1024 page texture for every role and size, so a frame's small text spends one of R5.20's dynamic units however many sizes it uses. Glyphs are shelf-packed on it on demand, keyed on (role, device font size, code point), the size rounded to a quarter pixel so a zoom or resize reuses a few sizes, and written with the texture store's new `writeRegion` (`texSubImage2D` on the upload unit). The page's texels are its kept source and `writeRegion` updates them, so a restored context uploads the page as it stands. A frame may spend 3 ms rasterising; a run whose glyphs are not all in by then draws from the field that frame and gets them the next. `DrawApi.prewarmText`, which `ScreenManager.navigate` and the gallery's `SceneHost` call after a mount, lifts the budget for the next frame, so a screen's first frame already draws its small text from the raster and never pops from soft to sharp. The page is the memory cap. When it fills, the run that did not fit draws from the field, and the page starts over at the next frame only if it holds dead space: a size no run asked for in two frames, or cells a reloaded role left behind. A page full of glyphs still in use is kept, the runs that did not fit stay on the field steadily until the set in use changes, and the page warns once (DDB-223). Starting over every time it filled, as the first cut did, never settles when a frame's glyphs do not fit: the page cleared and refilled every frame, spent the whole budget doing it, and some runs flipped between soft and sharp. The spec builds these atlases "at load time"; the sizes in use are not known then, so this builds on demand instead, with the mount prewarm standing in for load time.
- `UberGeometryEncoder`: an unblurred run under a translation or a uniform positive scale, whose device size (`size * scale * ratio`) puts it under the threshold, draws its glyphs as `image`-mode quads from the raster page (premultiplied white coverage times the text colour, which is exactly what image mode computes, so the shader is unchanged). Placement is the same `TextLayout` through the transform; each baseline rounds to a device row and each pen to its nearest quarter pixel, drawn as the whole pixel's cell in that phase, so a cell is one texel to one pixel and glyphs sit within an eighth of a pixel of the layout. Rotated, skewed or unevenly scaled runs and blurred shadow runs stay on the distance field. Supporting the uniform scale is what makes the fallback reach the game at all, since the combat stage and the scaled cards are drawn under one.
- R6.3 substitutes: a glyph that stands in for an absent code point (U+FFFD drawn as `?`, U+2011 as `-`) now carries `outlineCodePoint`, and the rasteriser draws that, so the raster holds the outline the atlas does rather than a system fallback font's.
- A size on the raster stays there until its range passes 1.6, not 1.5, keyed on role, logical size and the device scale it went raster at (so the fresh command objects of each frame keep it, and the same size drawn at another scale does not inherit it). The paths differ in sharpness (and, before DDB-217, in weight on macOS), and a zoom that hovered at the threshold would flicker between them otherwise.
- Font files ship as asset modules: URLs in the web build, data URIs in Electron (R15.34). About 550 KB for the three faces on the web and about 730 KB of base64 in the Electron renderer bundle; the icon font is not loaded, and icons stay on the distance field at every size. They load at startup on every display, including ratio 2 where the fallback only engages under 4.5 logical px. Loading a face on its first use would cost one soft frame for that role and nothing for everyone else, but it would start a font load mid-session that the screenshot harness's `document.fonts.ready` wait does not see, and a golden could then catch the soft frame. Eager loading keeps captures deterministic; revisit if startup cost shows up.

## The scored gate (6.9)

`tests/visual/web/uberShader.spec.ts` renders the body face at 10, 12 and 13 px through the uber shader and through the platform's canvas from the same TTF, and scores stem weight (total ink of a word) and evenness (variation of the darkest column of each `l` in a row). The reference is the platform's, so the numbers depend on it:

| | 10 px | 12 px | 13 px |
|---|---|---|---|
| Weight, field over platform, Linux CI (FreeType) | 0.97 | 1.00 | 0.95 |
| Weight, macOS Chromium (CoreText) | 0.64 | 0.67 | 0.72 |
| Stem variation, field | 0.24 | 0.17 | 0.18 |
| Stem variation, platform, Linux | 0.00 | 0.00 | 0.00 |
| Stem variation, platform, macOS | 0.15 | 0.09 | 0.05 |

On the reference platform the field's weight matches; what it lacks is evenness, since its stems land at whatever sub-pixel phase the layout gives them and the hinted platform raster puts every stem on a pixel. DDB-218 looked at closing the evenness gap and kept it as a documented tolerance instead, with a placement score added; see [small-text-evenness.md](./small-text-evenness.md).

## Spacing: quarter-pixel phases

The first version rounded each glyph's pen to a whole pixel. The advances are the field's unhinted ones (R6.8), so the rounding alternated with the pen's sub-pixel phase and gaps varied by a pixel: on the card footers "attack" at about 7 device px read "atta ck". That was not acceptable on player-facing text. What was tried:

- **Whole-pixel advances pinned to the layout per word** (each gap its advance rounded down or up, chosen for the word at once, the ends within half a pixel, no pen more than a pixel off). Better on paper and still "atta ck": at 7 px the `t` advances 2.5 px, so any whole-pixel scheme alternates 2 and 3 and "tta" packs tight next to an open "a c". Hinted platform text avoids that only by making the word wider, which measurement cannot follow.
- **Quarter-pixel phases** (kept). Each glyph is rasterised once at four times the horizontal resolution (`setTransform(4, 0, 0, 1, 0, 0)`) and box-filtered into four variants a quarter pixel apart. Pens take the nearest variant, so a 2.5 px advance stays 2.5 px. The shift is done in JS rather than with a fractional `fillText` x because Chrome snaps canvas text to whole pixels on Linux at ratio 1 (the 6.9 reference row of `l`s scores exactly zero variation there), which would have silently collapsed the phases. The cost is a little horizontal softness from the box filter, the same trade Skia's sub-pixel text makes; vertical edges keep whatever hinting the platform applies.

Each glyph takes four phase cells on the page, so the page holds a quarter of the glyphs a one-phase page would; at 1024 by 1024 that is still every size the combat screen uses at 800x500 several times over.

## Budget and frame times (review of #108)

The first cut built a whole-charset atlas per (role, size), up to four a frame, each its own texture. On the combat screen at 1000x620 that was nine atlases, three GPU draws a frame with two `textureSlotsExhausted` splits and eleven binds, and building them cost 3 to 10 ms apiece. Measured in headless Chromium on an M-series Mac, render plus flush per frame on combat:

| | median | p95 | p99 | max | frames over 8 ms |
|---|---|---|---|---|---|
| Drag 1440 to 800 wide, 8 px a step, distance field only | 1.30 | 1.69 | 1.93 | 2.04 | 0 |
| Same drag, an atlas per size (first cut) | 1.51 | 11.37 | 21.02 | 44.53 | 23 |
| Same drag, shared page, per glyph, 3 ms budget | 1.49 | 3.42 | 4.41 | 4.68 | 0 |

A cold mount of combat at 800x500 costs about 10 to 12 ms on its prewarmed frame against about 5 ms on the field, once per session; mounting it again, with the glyphs on the page, costs what the field does. `tests/visual/web/smallText.spec.ts` opens combat at 1000x620 and 800x500 and asserts one GPU draw, no `textureSlotsExhausted` split, and the page as the one bound texture.



## Consequences

- Text under 9 device px keeps the layout's spacing to an eighth of a pixel, and on the Linux goldens its ink is within about a percent of the distance field's. On macOS CoreText draws it a quarter to a third heavier than field text a pixel larger; DDB-217 matches it to the field ([small-text-weight-match.md](./small-text-weight-match.md)).
- Goldens moved where runs are under the threshold at 1440x882: `cardShowcaseScreen` (the card footers' tag and target lines), `combatScreen` (the same lines on the hand's scaled cards) and the 8 px armor badge values in the `icons` scene. Combat's 8 px HP lands on exactly 9 device px at scale 1.125 and does not move.
- Any future run under 9 device px takes this path with no call-site change.
- DirectWrite under the 4x horizontal transform has not been looked at: nothing here captures Windows. Worth one look at the card showcase in the Windows build before DDB-199 is closed.
