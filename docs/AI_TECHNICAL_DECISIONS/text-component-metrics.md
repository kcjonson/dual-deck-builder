# Text component on real metrics

DDB-71, DDB-55 phase 2. R12.4, chapter 6. Also settles DDB-198 (card titles under the cost) and DDB-200 (R6.11's wording).

## Context

DDB-70 gave the engine one glyph iteration for measuring and drawing, but `Text` still behaved as it did on the canvas atlas. Its width and height were whatever the caller set, or an estimate `layout()` wrote (`0.6 * fontSize` per character) on the three screens that called it. It wrapped by counting characters at `0.5 * fontSize`, drew each wrapped line as its own run at a bare `position`, and read `textAlign: 'center'` on a zero-width text as "centre on my x". Four more places guessed: the synergy panel's text heights and tag widths, the driver stats' 40 px slot and a static `getRequiredWidth`, and the input caret's 20 to 60 percent band.

## Decision

### Assigned or hugged, per axis

R12.4 makes a text's position the top-left of its line box and its bounds that box. `Text` tracks, per axis, whether the size was assigned (a positive `width` or `height` option, `setWidth`, `setHeight`, `setSize`) or hugs. A hugging axis takes the measured width, or `lines * lineHeight`, and is re-measured whenever the text, size or an assigned width changes. Setting an axis back to zero hugs it again. An assigned width is the alignment box and, unless `whiteSpace: 'nowrap'`, the wrap width (R10.13); an assigned height is the box `verticalAlign` places the lines in and the height a wrapped ellipsis fits.

`render` makes one `drawText` call with R2.13's box. Wrapping, per-line alignment, `ellipsis` and `clip` (`textOverflow: 'hidden'`) are the metrics service's, so what a component measures is what it draws. Line height defaults to the face's own (R6.10); `lineHeight` in a style is a multiple of the size, as before. `letterSpacing`, `textTransform` and `textDecoration` join the style, since the draw call already had them.

### Measuring only when something can

A text measures through `DrawApi.measureText`, which throws on a backend with no metrics (R2.14: an estimate would be the silent disagreement R6.8 forbids). `DrawApi.canMeasureText(font)` and `RendererContext.hasDraw` let `Text` ask first. When the answer is no (a unit test's tree, on the null backend or with no draw API at all), a hugging axis stays zero, the lint's `unmeasured-text` bucket, and the text measures on its first render where it can. The game and the gallery always can, since both bootstraps load the atlases before building a screen.

The alternative was to give the null and recording backends a metrics service fed from `loadFontAtlas`. That changes two backends' contracts for the benefit of tests. Instead `text/testing.ts` has a `MeasuringRecordingBackend` and `installMeasuringDrawApi()`, which component tests use to measure against the committed faces and read back the commands drawn.

### Anchored labels get boxes

Under the new contract a zero-width centred text starts at its x. About thirty call sites had used that x as a centring anchor; each now gets the box it was centred in rather than a compatibility mode that R12.4 does not have: a lane for its label, a badge or icon for its value, a panel or the screen for its title. Three constant or measurable labels are placed from their measured width instead (the escort's SPENT chip, the adrenaline readout, a synergy tag, whose pill is sized from its text). Labels that had been placed with their top at a box's centre are now centred in the box, which moves them up by half a line.

### The estimate sites

- `Text.layout` and its wrap: deleted; `layout()` now only measures a stale text.
- Synergy panel: the description and warning advance by their measured heights; a tag's pill is its measured width plus padding, capped at 80 px with an ellipsis.
- Driver stats: the readout hugs its width (Open Sans digits share one advance, so it holds still as the count changes), each value is centred in its icon, and the display hugs its content. `getRequiredWidth` is gone; the resource bar lays the displays out from their widths.
- Input caret: `x` is the last entry of the value's `advances` (a trailing space counts), and the caret spans the value's line box, centred as the value is.

### Card header (DDB-198) and face text

Both options the ticket named come from R6.14: ellipsis, or a second line. The cost hugs its digits, centred where it was, and the title slot runs from the badge (or padding) to 4 px before the digits' measured left edge, about 71 px on a badged card. A title that fits there stays on one line (Armor Plating, Precision Shot); a longer one wraps to a second line box (at 1.2, the display face's own) and ends in an ellipsis only if a name ever needs a third. Every title in `cards.json`, upgraded or not, badged or not, fits. Shrink-to-fit was not considered: the design specs say never smaller type, and the spec has no such text property.

Real measurement showed the face cutting rules text: at NORMAL size nine of the 27 descriptions need six to thirteen lines in a five-line box. The face now shows the card's `summary` with its `[keyword]` brackets stripped, as Card System Design 1.1 and Battle Screen Design intend (short text on the face, full text in the detail view, DDB-137). The box ends 4 px above the rarity line and keeps an ellipsis as a backstop that nothing reaches: `Card.test.ts` checks that no text on any card face, NORMAL and LARGE, badged or not, upgraded or not, measures larger than its box. `cards.test.ts`'s 60-character summary proxy is a measured three-line check on the face as drawn (DDB-202). The design's redesigned face, 12 px in 114 px, would need a fourth line for three summaries; that content call is DDB-204.

### R6.11 (DDB-200)

Docs only. R6.11, R12.4's last sentence and the chapter 6 checklist row now say vertical centring is on the face's ascent and descent, which is what `textPlacement` has done since DDB-70; the departure note there is gone.

## Consequences

- Every golden with text moved. Titles on the main menu, splash, developer and driver-selection screens are centred (DDB-30's menu half); combat labels sit in their badges, icons and lanes; the synergy panel fits the gap between the driver panels instead of covering both, so the left panel's flavour text is no longer cut.
- The tree snapshot reports real text bounds without a layout pass, which removes the phase 0 lint's flood of zero-size texts. It still omits `text.measured`, so the text-overflow rule stays dormant (DDB-80).
- Open: the combat turn counter and phase banner overlap in a box too short for three lines (DDB-88, predates this).
