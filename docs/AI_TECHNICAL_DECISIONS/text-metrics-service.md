# Text metrics service and the text shader mode

DDB-70, DDB-55 phase 2. Chapter 6 sections 6.2 to 6.5.

## Context

Until this change every run of text went through `rendering/FontAtlas.ts`: 32 px Arial rasterised into a canvas at startup, uploaded as a coverage mask, scaled bilinearly to whatever size a component asked for, and drawn in the uber shader's temporary `mask` mode. Measurement was a second walk over the same table (`FontAtlas.measureText`), which `Input` called for its caret and nothing else did, and `DrawApi.measureText` threw because no backend implemented it. DDB-69 committed the three MTSDF atlases and a validating loader but drew nothing with them.

## Decision

### One iteration, two readers

`text/TextLayout.ts` is the glyph iteration of R6.8. `layoutText(atlas, request)` returns a `TextLayout`: lines of placed glyphs (pen x per glyph), each line's width, the widest line, line height, the face's ascent and descent at the size, per-code-point caret advances, and the quad count. Both readers take that object:

- `TextMetricsService.measure` summarises it as R2.14's `TextMetrics` (width, height, line count, line widths, advances);
- `UberGeometryEncoder.encodeText` writes one quad per placed glyph with an image, and `textInk` (R4.2a's cull extent) bounds the same quads.

There is no second loop to drift. The pen that decides where a line breaks is the pen that places its glyphs, so the widths the wrap compared are the widths drawn.

`TextMetricsService` holds the atlases by role and an LRU of layouts (1024 entries) keyed on role, text, size, letter spacing, transform, wrap, overflow, wrap width, box height and line height (R6.12). The key is normalised (`layoutRequest`) so a box width that neither wrap nor ellipsis reads does not split the cache. Loading an atlas empties it. The encoder remembers the last command it laid out, since the batcher calls `shape` then `encode` on the same command back to back.

### What the iteration does

- Uppercase transform before lookup (R6.9). `advances` are per code point of the transformed text.
- Kerning from `kerning[]` keyed on the glyphs' own code points, letter spacing between glyphs only. Letter spacing is in em, like the `letterSpacing` tokens.
- Missing code points draw and measure as U+FFFD, or `?` in a face without it (R6.3).
- Default-ignorables (U+00AD, U+200B, U+2060, U+FEFF, and a stray CR) place nothing, take no letter spacing, and do not reset kerning, so neighbours kern across them. This is the DDB-182 review note: Barlow has 32 pairs against the soft hyphen, which apply only when it shows.
- R6.13's break opportunities, greedy fill, trailing spaces hanging at a soft break, leading spaces dropped on a continuation line, an overlong word on its own line. Scripts written without spaces break between grapheme clusters, from `Intl.Segmenter` when the paragraph has such a script (it never supplies the other break opportunities). `tsconfig` gains `ES2022.Intl` for its types.
- No break is offered before a line's first ink, so a first line's leading spaces stay with its first word instead of becoming an empty line.
- The soft hyphen is also a break opportunity (UAX #14 has it; R6.13 lets an implementation go further than its list). Breaking there shows the face's U+00AD glyph at the line end, kerned against the glyph before it.
- R6.14's ellipsis: a single line keeps the longest prefix that leaves room for U+2026; wrapped text keeps the lines that fit the box height and ellipsizes the last. The cut reuses the prefix's pen positions, so it is linear in the line. `overflow: 'clip'` pushes the box onto the clip stack for that one draw.

### Placement

`text/textPlacement.ts` turns a layout and R2.13's anchor or box into each line's pen origin. With a box, `top` and `bottom` put the first or last line box on the box edge (a line box is `lineHeight` tall with the face's ascent and descent centred in it); lines align per line (R6.15). Without a box, `position.y` is the first baseline (R2.13), which is the new default `verticalAlign: 'baseline'`, or a zero-height box for `top`, `middle` and `bottom`, which is how `Text` still calls it until DDB-71 gives it real line boxes.

### `middle` centres the ascent plus descent, not the ascent alone

This began as a departure from R6.11 and the spec now says it: DDB-200 amended R6.11, R12.4 and the chapter 6 checklist row on 2026-09-28.

R6.11 says vertical centring is computed on the font ascent. Taken literally that centres the span from the baseline to the ascender line, and both body and display faces have ascenders well above their caps (Open Sans 1.069 em against a 0.714 em cap height; Barlow Condensed 1.0 against 0.7), to leave room for accents. The first render did exactly that and every centred label in the game sat low: 16 px Open Sans caps 2.9 px below centre in a 30 px input, visibly on the bottom border in the interactive-controls scene. Centring the face's ascent plus descent (CSS's content area) puts the same caps 0.5 px low.

What R6.11 exists for, per its own sentence and worldsim's comment, is that the baseline comes from the face and not from the measured glyphs, so a line with descenders sits where one without them does. That holds unchanged: the block is `ascender + descender` from the face metrics, and `x` and `A` centre to the same baseline (tested). Recommended spec amendment: "computed on the font's ascent and descent, not on the measured glyph bounds".

### The `text` mode

Median-of-three coverage with the linear ramp (R6.5), `clamp(range * (median - 0.5) + 0.5, 0, 1)`. Under a translate-only transform the range is a per-draw constant, `max(distanceRange * size * ratio / atlas.size, 1)`, in the vertex's `shape.z`; otherwise `shape.z` is zero and the shader derives it from the texture coordinate's footprint as msdfgen's reference shader does, with the unit range in `halfSize`. A shadow run (R6.6) carries its blur in device pixels in `mode.w` and is shaded from the `mtsdf` alpha channel's true distance with a smoothstep; the atlas range caps what a blur can reach at half the range (about `size / 12` logical pixels), which covers R11.8's one-pixel meter-label shadow and nothing much larger.

Glyph quads go through the whole transform, so rotated and scaled text rotates and scales (the old path moved only the anchor). Under a translate-only transform each line's origin is snapped to the device grid and every glyph and decoration on it moves by that one delta (R6.16, R6.17); no glyph is snapped on its own. Decorations (R12.4, `decoration: 'underline' | 'strike'`) are `rect`-mode quads in the same group after the glyphs, one logical pixel on whole device rows.

`mask` mode and `MODE_MASK` are gone; the canvas atlas, `rendering/fonts.ts` (`DEFAULT_FONT`), `Renderer.getFontAtlas` and `RendererContext.getRenderer` are deleted.

### Loading and residency

Both bootstraps (`src/index.ts`, `src/gallery/index.ts`) await `loadFontAtlases` before building the draw API. `createDrawApi` uploads each image as an immediate `mask`-content texture (raw, no premultiply, no colour conversion, R6.4b) that keeps its image for a context restore, and hands it to `WebGL2Backend.loadFontAtlas`, which adds the role to the metrics service, registers the texture with the encoder, and makes the set of atlases the batcher's resident units (R6.4, R5.20). Three roles share every flush. `FontAtlasOptions` carries the parsed `FontAtlas` rather than raw JSON, since the loader already validated it.

### Components

`Text` resolves its role from the style's `fontFamily` and `fontWeight` through `text/fontRoles.ts`, which reads the typography tokens (R11.8): a role name, a role's family or `monospace` picks the role; `bold` on body goes to `boldRole` (display, since no body bold face is loaded); any other weight falls back to the role's one face. Every `fontWeight: 'bold'` title is therefore Barlow Condensed SemiBold now. `Input` measures its caret through `draw.measureText` with its text's role and size. `Text`'s layout, its estimated wrap and the other estimate sites are DDB-71's.

## Consequences

- Every golden moved: new faces, SDF edges, baselines from face metrics (text sits a few pixels lower than the canvas atlas's `textBaseline = 'top'` put it), and bold titles in the condensed display face.
- The six symbol glyphs the screens used (armor, fuel, shield, wrench, gear, and the back arrow) are out of their strings. The engine draws an absent code point as the fallback glyph, as R6.3 requires, and that put U+FFFD diamonds on the combat HUD, where the canvas atlas had drawn nothing; removing the symbols restored the old look until the icon atlas (DDB-72, R12.6) brought them back as icons; see [icon-atlas.md](./icon-atlas.md).
- A font atlas that fails to load stops startup (there is no text without it, R2.18), and both pages say so in the status line `Renderer` uses for a lost device, rather than showing a blank canvas.
- The raster fallback for sizes whose screen range falls below 1.5 device pixels (R6.4a, recommended) is not built. The screens use 8 and 9 px in seven places, whose screen range at ratio 1 (1.33 and 1.5 device pixels) is at or under that threshold; they render soft rather than wrong.
- `measureText` works on the WebGL2 backend. The null and recording backends still refuse it.
