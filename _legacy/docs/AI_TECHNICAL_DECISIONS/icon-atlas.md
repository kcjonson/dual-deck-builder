# Icon atlas and the Icon component

Date: 2026-09-28. Task: DDB-72 (DDB-55 phase 2). Rules: R12.6, R12.7 (the button's `icon`), R6.3.

## Context

DDB-70 moved text onto the MTSDF atlases, whose charset is text only (R6.3), so the six symbol glyphs the screens used (armor, fuel, the defend and repair intents, the scrap gear, the back arrow) would have drawn as the fallback glyph. #80 took them out of their strings and left a comment naming DDB-72 at each site. R12.6 says where they belong: a distance-field icon atlas built by the same pipeline as the text atlases, from an icon font, addressed by name through a generated module and drawn in `text` mode.

## Options for the source

msdf-atlas-gen v1.4 reads fonts only (`-font`, `-varfont`), not SVG, so the source has to be a font.

- Lucide (ISC). Outline icons, a 2 px stroke on a 24 grid. The battle screen mock's icons (`docs/design/battle-screen/index.html`, the `<symbol>` sprite) are solid silhouettes, so a stroked set reads thin next to them, and at 12 px the stroke is under a device pixel.
- Tabler Icons (MIT). Same outline style as Lucide; the filled variants cover only part of the set (no filled wrench or fuel pump).
- Material Symbols (Apache 2.0). Fill is an axis of a variable font, reachable with `-varfont`, but the npm package ships only woff2 and the repo's variable TTFs are several megabytes for five glyphs.
- Material Icons (Apache 2.0), the static filled face. Solid silhouettes on a 24 grid with a 2 unit margin, a static TTF with a `.codepoints` file mapping names to private-use code points. Every site has a direct match: `shield`, `local_gas_station`, `build`, `settings`, `arrow_back`.
- game-icons.net (CC BY 3.0). Detailed 512 unit pictograms that turn to mush at 12 to 18 px, no font build, and attribution in the shipped game.

## Decision

Material Icons Regular from google/material-design-icons at `bd8cb85` (`font/MaterialIcons-Regular.ttf` and its `.codepoints`), committed under `src/assets/fonts/material-icons/` with its Apache 2.0 `LICENSE.txt`, which the web and Electron builds copy beside the OFL files. Implementation spec section 5 named an OFL or MIT font (Tabler or Lucide); this departs from it for the style match, and Apache 2.0 permits bundling a derived atlas with the licence alongside.

- `src/assets/fonts/icons.txt` lists the icons by their Material name. `scripts/generate-icons.mjs` resolves them through the `.codepoints` file and writes `src/renderer/engine/text/icons.ts` (`ICON_CODE_POINTS`, `IconName`), and with `--charset` prints the same code points for msdf-atlas-gen, so the module and the atlas are built from one list. `iconAssets.test.ts` fails when `icons.ts` is stale.
- `scripts/build-fonts.(sh|ps1)` builds `material-icons.{png,json}` after the three faces with the same parameters (`mtsdf`, 48 px per em, range 8, `-potr`) and no kerning step. Five glyphs pack into 256x128. The font atlases rebuild byte-identical.
- `fontFaces.ts` adds `ICON_ATLAS` under the name `icons` and `ATLAS_ASSETS`, the loader's default list, so both bootstraps load and validate it with the faces and `createDrawApi` makes it a fourth resident texture (R5.20: an icon beside a label is still one GPU draw).
- `components/Icon.ts` is R12.6's `glyph`, `size`, `tint`, with accessors for each. It draws one `drawText` in the icon atlas, `box` the component's bounds, centred both ways. The atlas's em box is the whole line (ascender 1, descender 0), so `middle` centres the 24 unit design square and a 16 px icon is 16 px square whatever its ink. Tint defaults to `tokens.color.text`; the six sites pass `tokens.color.text_bright`, matching the white labels beside them.
- `Button` takes `icon` (R12.7's leading position only). Icon, a gap of 0.375 em and the label centre as one group, placed against the label's measured width (R2.14). The measure needs the draw API, which screens are built without in unit tests, so the placement runs at the next render after the label, size or font size changes.

## The six sites

- Vehicle armor badge: `game/ui/ArmorBadge.ts`, which draws its own fill, a 12 px shield and the value, and is as wide as those need (inset, icon, gap, measured value, inset), the old quarter of the plate at least. With the icon in a fixed-width badge, "5 SH3" (21.5 px at 8 px Open Sans) already ran onto the shield and "10 SH12" (30.7 px) out of both sides; the badge now grows instead, measured once per value change at the next render.
- Enemy intent marker: `game/ui/IntentMarker.ts`, the disc with an 18 px shield (defend) or wrench (repair), or the attack value and the special "!", all centred. The value used to sit at a fixed point to the right of the disc's centre; it is centred now.
- Driver fuel stat and the scrap readout: the pump and the gear at three quarters of their square, as the old symbol text was, with the value beside it.
- Driver selection back button: `arrow_back` leading "Back to Menu".

## Gallery

The `icons` scene (`IconExamplesSection`) draws every icon at 12, 16 and 24 px, bare and on a badge fill, a button with a leading icon beside one without, the four intents, and the armor badge at 0, 5, "5 SH3" and "10 SH12". A new line in `icons.txt` appears there without touching the scene, and the scene's golden is where an icon's placement is checked by pixels.

## Consequences

- The icon atlas is the fourth resident texture, so of `UBER_TEXTURE_UNITS` (8) four are left for images instead of five. Nothing draws images yet; the card art phase (R5.30, section 5's art pages in the resident set) has to budget for it.
- Every icon is tinted `tokens.color.text_bright`. The mock tints the scrap gear `#c9b27a` and the armor shield `#a9bccd`; neither is a token (the nearest, `data_bright` and `accent_dim`, are other hues), so they wait for phase 4's combat restyle, which adds the palette the mock's HUD uses.
- `Button` and `ArmorBadge` measure at render because there is no layout pass yet and unit tests build screens without a draw API. DDB-73 makes render emit draws only and replaces the `RendererContext` singleton; both placements move into its measure step then (noted on DDB-73).

- Adding an icon is a line in `icons.txt` and a run of `build-fonts`; the atlas grows by a cell.
- The mock's own glyphs are close but not identical (its fuel is a jerry can, Material's is a pump, which is also what the old U+26FD was). If the mock's art has to be exact, the route is a font built from its SVGs, which needs a font tool this repo does not have.
- The screens are still hand-positioned; the icons move with their badges when phase 4's stacks replace that.
