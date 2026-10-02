# Small distance-field text: evenness and weight against the platform (DDB-218)

## Context

R6.4a and 6.9 score the body face at 10, 12 and 13 px, ratio 1, through the uber shader against the platform's canvas raster of the same TTF, for stem weight and evenness (`tests/visual/web/uberShader.spec.ts`, set up in DDB-199; see [small-text-raster-fallback.md](./small-text-raster-fallback.md)). DDB-199 left the test as a ratchet and filed this item to close the gap, first framed as weight (macOS) and then, once the Linux numbers came in, as evenness.

What the scores say, per platform (field numbers do not depend on the platform; the field renders through SwiftShader on both):

| | 10 px | 12 px | 13 px |
|---|---|---|---|
| Weight, field over platform, Linux CI (FreeType) | 0.97 | 1.00 | 0.95 |
| Weight, field over platform, macOS Chromium (CoreText) | 0.64 | 0.67 | 0.72 |
| Stem variation, field | 0.24 | 0.17 | 0.18 |
| Stem variation, platform, Linux | 0.00 | 0.00 | 0.00 |
| Stem variation, platform, macOS | 0.15 | 0.09 | 0.05 |
| Placement error, field (px) | 0.06 | 0.02 | 0.02 |
| Placement error, platform, Linux (px) | 0.00 | 0.00 | 0.00 |
| Placement error, platform, macOS (px) | 0.07 | 0.08 | 0.13 |

Placement error is new with this item: the standard deviation, in device pixels, of each `l`'s ink centre from where its advance puts it. Each raster is scored against its own advance: the field's from the atlas metrics, the platform's from `measureText`.

## Cause

Weight is not a field defect. On the reference platform (the Linux runner every golden comes from) the field's ink is within 5 percent of FreeType's. macOS is lighter because CoreText draws a third heavier than both; that is CoreText's rendering, not the threshold.

Evenness is the absence of hinting. The run origin is snapped (R6.16), but each glyph's pen is the sum of unhinted advances, so each `l` stem lands at a different sub-pixel phase. A stem about 0.9 px wide centred on a pixel gives one column near full coverage; centred between two it gives two columns near half. The shader's ramp is the one-pixel linear ramp R6.5 requires, so this is the coverage a box filter would give, and no change to the ramp or the threshold removes it: a sharper ramp aliases, a softer one blurs every stem the same way and lowers the peaks without evening them. Linux Chromium scores zero on both evenness and placement because at ratio 1 it hints the advances too: `measureText` gives the `l` a whole-pixel advance, so every glyph starts on a pixel and the word is as wide as the rounded advances make it, not as wide as the font's. That is what the field cannot copy. R6.16 forbids changing advances, and R6.4a keeps layout on the distance-field metrics so it does not change with ratio or path; a whole-pixel advance at ratio 1 would make measurement, wrapping and centring depend on the display. CoreText keeps sub-pixel positions and shows the same kind of variation the field does, smaller because its stems are heavier.

## Options

1. **Per-glyph whole-pixel snapping at sizes under 16 px and ratio 1.** R6.16 allows it (a MAY), provided the run's width and R6.8 hold. Tried in the encoder: stem variation goes to 0.000 at all three sizes, and placement error goes to 0.26, 0.14 and 0.22 px. Enlarged, the 10 px word reads "Hambur gefonstiv", the same defect DDB-199 rejected for the raster fallback ("atta ck"). Every small run in every golden would move to buy it.
2. **Half-pixel per-glyph snapping.** Worse on both counts where it matters: 10 px goes to zero variation, but 12 px rises to 0.31 (stems alternate between one column and two), 13 px only drops to 0.16, and placement error is 0.13 to 0.15 px at every size.
3. **Stem darkening** (bias the median threshold up as the screen range shrinks, as FreeType and Skia do). Addresses weight, not evenness. On Linux the weight already matches, so it would make the reference platform's text heavier than its own raster to chase CoreText on macOS, and every small run in every golden would move.
4. **Accept the gap as a documented platform tolerance** and hold the field's side of the trade in the test.

## Decision

Option 4.

With advances fixed by R6.8 and R6.16, the only lever left is where each glyph is drawn relative to its pen, and moving it buys stem evenness with spacing (option 1). The field keeps every glyph where measurement puts it and lets stem phase vary. For a game whose layout, carets and centred labels read the measured width, spacing that follows the layout is the better side to keep, and it is the side the project already chose for the raster fallback. The spec asks for the comparison as a scored band ("Distance fields have no hinting"), not for equality, and the token scale's 11 px floor keeps UI text out of the worst row.

The test changes from a ratchet pointing at this item to the tolerance itself:

- Weight: unchanged, a platform-dependent floor (0.9 on Linux, 0.55 elsewhere) and a ceiling of 1.25.
- Stem variation: ceilings tightened to 0.26, 0.19 and 0.20 (from 0.30, 0.22 and 0.23), about 10 percent over today's field, since the field's numbers are the same on every platform.
- Placement error: a new ceiling of 0.1 px on the field. It passes today (0.02 to 0.06) and fails option 1 at every size (0.14 to 0.26), so the trade cannot be flipped without a test saying so.

No shader, atlas or encoder change, so no golden moves.

## Consequences

- On ratio-1 Linux displays, small field text has stems that vary in darkness along a word, a little softer than hinted platform text beside it. The game draws no platform text beside it except the raster fallback under 9 device px, which matches the field's weight on Linux.
- On macOS at ratio 1 (external monitors), field text is lighter than CoreText and the 8 px raster fallback is heavier than 9 px field text next to it, as in `Vehicle`. DDB-217 (moving those literal sizes onto the token scale) removes the case that shows it. Most Macs run at ratio 2, where the fallback engages only under 4.5 logical px and the field's range is twice as wide.
- Windows (DirectWrite) has not been scored; nothing captures Windows. If a Windows run ever shows weight outside the band, that is a platform row to add to this table, not a reason to darken the field everywhere.
- Revisit if text below 11 px becomes common in the design, or if a hinting-aware glyph source (for example per-size raster atlases for the 10 to 13 px rows too) is wanted for crispness; that would be the R6.1 alternative, not a shader change.
