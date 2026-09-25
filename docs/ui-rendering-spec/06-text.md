# 6. Text

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

Text is most of what a UI draws and where most of its visible quality lives. The requirements: crisp at every size and device pixel ratio, batched with shapes in the same sort, measured exactly as rendered, and wrapped and aligned by one shared algorithm. Worldsim's MSDF pipeline meets these after two rounds of fixes (run snapping, unified measurement, atlas validation), and those fixes are rules here. The sibling TypeScript engine's canvas-rasterised 32 px bitmap atlas, scaled bilinearly to 8 px and 64 px, is the anti-pattern this chapter exists to retire. The graphics review corrected the atlas parameters (the first draft's range failed msdfgen's own minimum below 16 px on ratio-1 displays), added the small-size raster fallback, and replaced the wrapping rule with explicit break opportunities.

Rules are numbered R6.n.

## 6.1 Glyph source

- R6.1 Glyphs MUST be sharp at every size the UI uses and at every device pixel ratio. A signed distance field atlas (multi-channel, MSDF, preferred; single-channel SDF acceptable) satisfies this with one atlas per font face. A rasterised atlas MAY be used instead only if it holds a separate rasterisation for every (face, size, ratio) combination in use; a single-size bitmap stretched to other sizes is not conforming.
- R6.2 Atlas generation is a build step producing the texture and a metrics file. The normative metrics schema is msdf-atlas-gen's JSON (`atlas` with type, size, width, height, `distanceRange`, `distanceRangeMiddle`, and `yOrigin`, which the loader MUST honour; `metrics` with em size, line height, ascender, descender; `glyphs[]` with code point, advance, plane bounds, atlas bounds; `kerning[]` pairs); a generator that emits another format (msdf-bmfont-xml's BMFont JSON, for example) is accepted only through a converter to that schema, so the loader validates one shape. Validation on load: required fields present, every glyph has both bounds; a glyph missing bounds is dropped with a warning rather than given a full-cell fallback that samples its neighbours (a worldsim bug). Font faces ship with their licence file; faces that cannot be redistributed (system fonts) cannot be atlased and are not used.
- R6.3 Coverage: the text atlases MUST include the printable ASCII range, Latin-1 supplement, general punctuation (dashes, quotes, ellipsis, bullet, middle dot), and degree; any code point absent from the atlas renders a visible fallback glyph (`?` or tofu) and measures as that glyph's advance, never as zero width. Arrows, chevrons, geometric shapes, emoji, and pictograms are not text; they are icons from the icon atlas (chapter 12, R12.6). The sibling engine rendered nothing for the six symbol glyphs its screens used; worldsim's ASCII-only atlas rendered the degree sign, the middle dot, and superscript two as fallback boxes until its 2026-07-03 polish pass.
- R6.4 One atlas per font role (chapter 11, R11.8) at minimum. Several atlases MUST be able to share a frame and a flush, with the pixel range carried per draw (chapter 5, R5.21); the font-role atlases are part of the resident texture set (chapter 5, R5.20), so alternating roles never splits a submission.
- R6.4a Atlas parameters: the ratio `pxrange / emSize` MUST be at least 1/6, so that the screen-space range is at least 2 device pixels at 12 logical px and ratio 1 (for example 48 px per em with `-pxrange 8`, or 32 with 6); the shader clamps the computed range to a minimum of 1 as msdfgen's reference shader does. msdfgen documents that a screen-space range below 2 makes the anti-aliasing likely to fail, and the first draft's 32 px em with range 4 gave 1.25 to 1.6 pixels at the 10 to 13 px token sizes on a 100 percent Windows desktop. The `mtsdf` variant (MSDF in RGB plus a true SDF in alpha) SHOULD be used so outlines and glows can be derived from the alpha channel without a second atlas. Sizes whose screen-space range would fall below 1.5 device pixels at the current ratio (below about 9 logical px at ratio 1 with the parameters above) SHOULD be rendered from a rasterised per-(face, size, ratio) atlas built by the platform's 2D text API at load time (R6.1's permitted alternative); measurement still follows R6.8 using the distance-field metrics scaled by `size / em`, so layout does not change when the renderer switches path. Distance fields have no hinting, so the 10 to 13 px rows of the visual fixture at ratio 1 are a scored gate compared against a platform-rasterised reference for stem weight and evenness, and a token scale SHOULD define no text size below 11 logical px.
- R6.4b Atlases are distance data, not colour data: upload them with colour-space conversion off and without premultiplication (in WebGL `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL = false`), linear filtering, no mipmaps.
- R6.4c Colour glyphs (emoji) and scripts the atlas does not cover MAY be supported by rasterising the run through the platform's 2D text API at `size * ratio` into a premultiplied RGBA sprite page (uploaded with premultiplication on and colour-space conversion off, or via `createImageBitmap` with `premultiplyAlpha: 'premultiply'` and `colorSpaceConversion: 'none'`), keyed on (text, face, size, ratio) and re-rasterised on a ratio change, and drawn as an `image` quad from a resident unit; the run's platform-measured advance enters the shared iteration of R6.8 as that run's width so measurement and rendering agree for mixed strings. Without this fallback such text renders as fallback glyphs, never as nothing.

## 6.2 Shading

- R6.5 Coverage is `clamp(screenPxRange * (median(r, g, b) - 0.5) + 0.5, 0, 1)` with `screenPxRange = max(pxrange * size * ratio / emSize, 1)`; under translate-only transforms it is a per-draw constant computed at submission, otherwise derived from `fwidth` of the texture coordinate as in msdfgen's reference shader. This is the same linear one-pixel ramp as chapter 5, R5.6, so glyph edges and the border one pixel away have the same softness. The `mtsdf` alpha channel is a true SDF used for outlines, glows, and shadows; the body uses the median. Coverage multiplies premultiplied colour and alpha together (chapter 5, R5.22).
- R6.6 Text shadow is a second run of the same glyph quads at `offset`, in the shadow colour, emitted immediately before the main run (chapter 3, R3.17).
- R6.7 Text is blended in sRGB like everything else (chapter 5, R5.24). No per-channel subpixel positioning or LCD filtering; a game canvas has no guarantee about the display's subpixel layout, and WebGL has no dual-source blending outside a draft extension.

## 6.3 Metrics and measurement

- R6.8 One glyph iteration serves both measurement and rendering: the same advance, kerning, letter spacing, transform, and fallback rules. `measureText` of a string equals the horizontal extent `drawText` produces, and a string drawn twice end to end lands its second copy exactly one measured width later. Worldsim's centred and right-aligned text drifted until this was enforced.
- R6.9 Letter spacing is added between glyphs only (not after the last); text transform (uppercase) is applied before measurement; kerning pairs from the metrics file are applied when present (a specification addition; worldsim's font renderer reads no kerning table).
- R6.10 Sizes: a text draw specifies its size in logical pixels; the implementation scales the atlas metrics (which are stored per em) by `size / em`. Line height defaults to the font's line height times the `lineHeight` token and MAY be overridden per draw.
- R6.11 Vertical alignment inside a box is computed on the font ascent, not on the measured glyph bounds, so lines with and without descenders sit on the same baseline. This is worldsim's convention and every component in its catalog relies on it.
- R6.12 Measurement results are cached keyed on (face, role, text, size, letter spacing, transform, wrap width) with a bounded LRU; the cache is invalidated when the atlas changes.

## 6.4 Wrapping and overflow

- R6.13 Word wrap is greedy (first fit): break at break opportunities; a hard newline always breaks; leading spaces on continuation lines are dropped; a single word wider than the wrap width is placed on its own line and overflows (no mid-word break in the baseline; an implementation MAY add character-level breaking as an option). Break opportunities in the baseline are: after U+0020 and U+0009; after U+200B (zero-width space); after U+002D and U+2010 when followed by a letter or digit; never at U+00A0, U+202F, U+2011, U+2060, or U+FEFF. For runs of scripts without spaces (Han, Hiragana, Katakana, Thai) an implementation SHOULD allow a break between grapheme clusters (`Intl.Segmenter` with `granularity: 'grapheme'` in a browser, UAX #29 elsewhere); full UAX #14 and kinsoku rules are optional. `Intl.Segmenter` is a grapheme and word segmenter, not a line breaker, and MUST NOT be the sole source of break opportunities (its word boundaries would break at a no-break space and never at a zero-width space). Wrapped measurement returns the line count, each line's width, the widest line, and `lines * lineHeight`.
- R6.14 `overflow: 'ellipsis'` on a single line truncates at the last glyph that leaves room for the ellipsis glyph within the box; on wrapped text it applies to the last line that fits the box height. `overflow: 'clip'` clips through the clip stack; `visible` draws past the box (and the lint's `text-overflow` rule reports it).
- R6.15 Alignment of wrapped text is per line against the box width. The wrap width is the assigned or constrained layout width when the text is in flow (chapter 10, R10.13).

## 6.5 Pixel snapping

- R6.16 Under identity or translate-only transforms, each text run's origin (the pen position of the first glyph) is snapped to the device pixel grid: `round(origin * ratio) / ratio`. Every glyph in the run moves by the same delta, so kerning and advances are untouched. Snapping the origin puts the baseline on a device row and keeps a run's stems at the same sub-pixel phase from frame to frame, which is what stops shimmer and weight flicker as a run's origin animates; it is not about texel alignment (a distance field's edge is analytic and needs none). Per-glyph snapping MUST NOT change advances; an implementation MAY snap each glyph's x origin independently at sizes under 16 px and ratio 1 for stem consistency, provided the run's total width and R6.8 are unchanged. Under scale or rotation nothing is snapped.
- R6.17 The snap delta is computed once per run and cached with the transform, not per glyph.

## 6.6 Batching and order

- R6.18 Glyph quads are draw groups like any other (one group per `drawText`, shadow run first), in the same batch, the same layer, and the same sort as shapes (chapter 3). There is no separate text pass and no flush on text. One group per run is a change for worldsim, which records one group per glyph and sorts them individually, so its sorted path is O(glyphs) on any frame with a popup. This is the rule the first two ordering bugs in worldsim's history violated and the rule the sibling engine violates today.
- R6.19 Glyph quads carry the current clip (chapter 4, R4.5) and opacity like every other draw, and runs entirely outside the clip are culled per run (chapter 4, R4.2a).

## 6.7 Shaping and scripts

- R6.20 Baseline scope is left-to-right text with per-pair kerning. Complex shaping (Arabic joining, Indic reordering, bidirectional text) is out of scope; an implementation that needs it integrates a shaper (HarfBuzz) in front of the glyph iteration, and the iteration contract of R6.8 still applies to the shaped glyph sequence.

## 6.8 Rationale

MSDF gives one atlas for every size, crisp edges under scaling and animation, and a shader path that shares the batcher with shapes. The costs (a build step, a metrics file, a fallback glyph policy, a raster fallback for the smallest sizes on low-density displays) are one-time. The measurement rules are not stylistic: centred labels, text field carets, tab widths, and the layout lint all read the measured width, and any divergence between measured and rendered text shows up as drift somewhere. The break-opportunity list exists because the two reference implementations must wrap the same string the same way.

## 6.9 Required tests

- Measure equals render: for a set of strings including kerned pairs, letter spacing, and uppercase transform, the rendered advance of the last glyph equals the measured width; a doubled string's second copy begins at exactly one measured width; a string containing a fallback-rasterised emoji still satisfies both.
- Fallback: a string with an absent code point measures the fallback advance and renders the fallback glyph.
- Wrap: hard breaks, greedy fill, long-word overflow, leading-space dropping, line count and heights; ellipsis on single and multi-line; U+00A0 never breaks; U+200B breaks.
- Snap: with ratio 2 and a run origin at x 10.3, the emitted quads start at 10.5 and glyph spacing is unchanged.
- Order: a text drawn before a rectangle in the same layer is covered by it.
- Small sizes: at ratio 1 the 10, 12, and 13 px rows of the fixture are compared against a platform-rasterised reference for stem weight and evenness; the raster fallback engages below the R6.4a threshold and measurement is unchanged when it does.
- Visual fixture (chapter 13): each font role at 10, 12, 13, 15, 18, 22, 28, 38 px, light on dark and dark on light, at ratio 1 and 2, plus a wrapped paragraph, right-aligned numerals, uppercase tracked labels, and text with shadow over a gradient.

## 6.10 Conformance checklist

| Item | Level |
|---|---|
| Size-independent glyph source with the R6.4a range ratio, validated msdf-atlas-gen metrics, fallback glyph, licensed faces | required |
| Median-of-three MSDF shading with the linear ramp and clamped range, premultiplied output | required |
| Shared measure and render iteration; kerning, letter spacing, transform | required |
| Ascent-based vertical centring | required |
| Greedy wrap with the normative break opportunities, ellipsis, per-line alignment | required |
| Run-origin pixel snapping under translate-only transforms | required |
| Text in the same batch and sort, culled per run | required |
| Multiple atlases per flush | required |
| `mtsdf` atlases | recommended |
| Raster fallback for sizes below the range threshold | recommended |
| Measurement cache | recommended |
| Emoji and uncovered-script fallback, character-level breaking, complex shaping | optional |
