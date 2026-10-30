# Small text: Vehicle on the token scale, raster weight matched to the field (DDB-217)

## Context

R6.4a: a token scale SHOULD define no text size below 11 logical px, and runs under 1.5 device pixels of screen range (9 device px at ratio 1) SHOULD come from a platform raster with measurement unchanged. The token scale already stops at `fs_xs` (11), but `Vehicle` drew literals under it: driver name 9, driver HP 8, vehicle name 10, structure value 9, the SPENT chip 9, and `ArmorBadge` drew its value at 8. Its rows sat at fixed fractions of the plate height (30, 42 and 55 percent), and on the enemy plate (140x91 on the stage) they already overlapped at those sizes.

DDB-218 ([small-text-evenness.md](./small-text-evenness.md)) handed over a second problem. On macOS at ratio 1 the raster fallback is CoreText's weight and the distance field beside it about 0.65 of that, so text that crosses the threshold on a resize changes weight by 40 to 55 percent. Moving `Vehicle` to 11 px does not remove that: the combat stage is drawn under `min(W / 1280, H / 720)`, so at 1024x600 (scale 0.8) every plate run is 8.8 device px and on the raster.

## Plate layout

Every run is `fs_xs` on `lh_tight` lines (12.1 px), so a line is no taller than the old 9 and 10 px ones were. The rows stack from measured heights instead of fractions:

- From the bottom: the armor badge row (16), the structure row (the track beside its value, right-aligned in a column as wide as the full value so the track keeps its width as structure falls), and the portrait takes what is left, 2 px between each.
- In the portrait: the driver's name beside the driver portrait, the HP under both, and the vehicle's name at the foot.
- The driver's name loses its "Driver: " prefix; the portrait beside it says that, and the prefix is what pushed "THE ROAD WARRIOR" past the plate at 11 px. Driver and vehicle names take an ellipsis rather than wrapping or running out of the plate.

Plate sizes and colours are unchanged. DDB-135's plate redesign (132x68, a driver HP bar, the name at 15 condensed) replaces all of this; this is the smallest layout that holds the token size without overlap.

## Weight across the switch

Measured on macOS Chromium, ink of "Hamburgefonstiv" through the raster path (four times as wide, box-filtered) against the field at 9 px:

| | 6 px | 8.75 px |
|---|---|---|
| Open Sans | 1.45 | 1.32 |
| Barlow Condensed SemiBold | 1.29 | 1.26 |
| JetBrains Mono | 1.42 | 1.30 |

On the Linux runner the gap is smaller and varies by face: body within about 5 percent, the display face 13 percent heavier at 8.75 px, mono 10 percent at 6 px. The excess is CoreText's darkening of small text, not a property of the outline: the same raster path at 96 px is within 0.3 percent of the field at 48 px for all three faces.

### Options

1. **Match the raster's ink to the field's.** Measure each size's raster ink once and reshape its coverage to the field's.
2. **Move the threshold.** A lower one keeps more text on the field (soft but even in weight) and moves the step to sizes where less text lives. It departs from R6.4a's 1.5 and leaves the step in place.
3. **Darken the field.** Stem darkening on the field moves every small run in every golden and makes the Linux field heavier than FreeType's raster, which it matches today (DDB-218 rejected it for the same reason).

### Decision

Option 1.

- `text/fieldInk.ts`: the field's ink of the reference word at 9 px (the first field size at ratio 1) per square pixel of font size, the mean of four sub-pixel pens, per face (1.698 body, 1.91 display, 1.9 mono). Baked because the field is not available on the CPU; the atlases load as images. The module has no asset imports, so `FontFaceAsset.fieldInk` and `uberShader.spec.ts` read the same table: the spec measures it through the shader and fails if an atlas rebuild moves it past 1.5 percent, and a jest test holds every face's `fieldInk` to the table.
- `RasterGlyphPage`, the first time a (role, size) rasterises, draws the reference word's glyphs exactly as it draws any glyphs and counts their subsamples over the columns the box filter reads (`inkSample`), then asks `inkCurve` for a table from coverage byte to coverage byte. Within `INK_TOLERANCE` (2 percent, about what the byte table resolves) of `fieldInk * size^2` the table is null; otherwise it is `c^k`, `k` found by bisection over the sample's coverage histogram so the ink lands on the target. A power keeps fully covered pixels full and thins the partial coverage the platform spread past the outline's edge, which is what its darkening is; a gain would dim the stems' cores instead.
- `rasterizeGlyphs` sends each subsample through the table before the box filter.
- The tolerance is small on purpose. The first cut kept anything within 10 percent as drawn, which put a step back inside the raster range: a size at 1.09 kept, the next quarter pixel at 1.11 pulled to 1.00, and body (1.05, kept) beside display (1.13, pulled) on one plate on Linux. JetBrains Mono at 6 px sat at 1.098 on the runner, so a small rasteriser change would have flipped it and moved goldens. At 2 percent every size lands on the field on every platform.
- The first cut sampled the word in one `fillText`. FreeType rounds a word's advances, so on Linux the word and the same glyphs drawn one at a time differed by up to 5 percent (JetBrains Mono at 6 px), and the curve was fitted to coverage it was not applied to. Sampling the glyph path's own subsamples removes that.
- The cost is one canvas draw and read of the reference glyphs at the size, about 500 by 12 texels at 8.75 px, once per (role, size), inside the rasterising budget.

Afterwards, on macOS, the glyphs `rasterizeGlyphs` writes for the reference word are 1.000 to 1.001 of the field at 6, 7, 8 and 8.75 px for all three faces. Two details got it there: the table is floats, not bytes (rounding a byte table over the many faint subsamples at glyph edges moved the ink by up to 3 percent), and the exponent's search runs to 16, since CoreText at 8.75 px needs more than 4. `uberShader.spec.ts` checks that on every platform it runs on (within the tolerance plus half a percent for the byte rounding of the written texels), running `inkSample` and `rasterizeGlyphs` themselves against the page's canvas: once against a recording canvas, whose calls the page replays to answer the reads, then again with those answers.

The hysteresis (1.6 to leave the raster, 1.5 to enter) stays: the two paths now match in weight but not in sharpness, and a zoom that hovers at the threshold would still flicker between soft and crisp.

## Consequences

- Plate text is 11 px everywhere, and on combat at 1024x600 every plate run is on the raster path at the field's weight on both platforms.
- On Linux every raster size takes a mild curve too, a few percent for body and up to 13 percent for display. Goldens with raster text at the capture viewport moved slightly (see the PR).
- Raster text on macOS ratio-1 displays (external monitors) is lighter than CoreText draws it. That is the intent: it reads the same as the field text a pixel larger.
- An atlas rebuild has to re-measure `fieldInk`; the web suite says by how much.
- Windows (DirectWrite) is still unscored. It gets the same correction with no code change; if a platform's darkening is not a spread of partial coverage, a power curve may match the ink and not the look, and this is where to revisit.
