# Font atlases

MSDF atlases for the three text roles of R11.8 (R6.4), one atlas per face, and the icon atlas (R12.6), built by `scripts/build-fonts.sh` (macOS, Linux) or `scripts/build-fonts.ps1` (Windows). The PNG and JSON pairs are committed, so neither CI nor a fresh checkout needs the generator; run the script only when a face, `charset.txt` or `icons.txt` changes, then commit what it writes (and `src/renderer/engine/text/icons.ts`).

| Role | Font name | Weight | Face | Source | Licence | Atlas |
|---|---|---|---|---|---|---|
| body | `body` | 400 | Open Sans Regular 3.000 | [googlefonts/opensans](https://github.com/googlefonts/opensans) | SIL OFL 1.1, `open-sans/OFL.txt` | `open-sans-regular.{png,json}` |
| body | `body-600` | 600 | Open Sans SemiBold 3.000 | [googlefonts/opensans at 27d060e](https://github.com/googlefonts/opensans/tree/27d060e1aad6886daeda67629ee28189f795f534/fonts/ttf) | SIL OFL 1.1, `open-sans/OFL.txt` | `open-sans-semibold.{png,json}` |
| mono | `mono` | 400 | JetBrains Mono Regular 2.304 | [JetBrains/JetBrainsMono release v2.304](https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304) | SIL OFL 1.1, `jetbrains-mono/OFL.txt` | `jetbrains-mono-regular.{png,json}` |
| display | `display` | 600 | Barlow Condensed SemiBold 1.422 | [jpt/barlow tag 1.422](https://github.com/jpt/barlow/tree/1.422) | SIL OFL 1.1, `barlow-condensed/OFL.txt` | `barlow-condensed-semibold.{png,json}` |
| display | `display-700` | 700 | Barlow Condensed Bold 1.422 | [jpt/barlow tag 1.422](https://github.com/jpt/barlow/tree/1.422) | SIL OFL 1.1, `barlow-condensed/OFL.txt` | `barlow-condensed-bold.{png,json}` |

The font name is what `drawText` and `measureText` select the atlas by: each role's base face goes by the role's name, another weight by `<role>-<weight>`. Components don't name faces; a style's `fontRole` and `fontWeight` resolve to one through the theme's weight table (R11.8, `src/renderer/engine/text/fontRoles.ts`), and a weight with no face falls back to the nearest one the role has. Adding a weight means a line in both build scripts, an entry in `fontFaces.ts`, the weight in the role's `typography.role_*.weights` token, and its field ink in `fieldInk.ts` (the 6.9 web suite in `tests/visual/web/uberShader.spec.ts` measures it).

Every face has to ship with its licence file (R6.2), and the web and Electron builds copy the `OFL.txt` files into `assets/fonts/`. System fonts (Arial) cannot be redistributed, so they cannot be atlased.

## Generator

[msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen) v1.4.0. The scripts refuse any other version, because a different generator writes different pixels for the same input and the committed atlases would churn; set `MSDF_ATLAS_GEN_ANY_VERSION=1` to override, and bump the pinned version in both scripts if you commit the result.

- macOS: `brew install msdf-atlas-gen` (the formula is 1.4 at the time of writing).
- Windows: download `msdf-atlas-gen-1.4-win64.zip` from the [v1.4 release](https://github.com/Chlumsky/msdf-atlas-gen/releases/tag/v1.4), unzip it, and put the folder on `PATH` or point `MSDF_ATLAS_GEN` at the exe.
- Linux: build the v1.4 tag from source with CMake as its README describes (no release binary exists), then set `MSDF_ATLAS_GEN` if it is not on `PATH`.

The scripts also need `npm ci` and Node 22.18 or later for the kerning step below.

Parameters (implementation spec section 5, R6.4a): `-type mtsdf -size 48 -pxrange 8 -yorigin top -potr`. The range-to-size ratio of 8/48 is the R6.4a minimum of 1/6, and the loader rejects an atlas below it. The output is deterministic: two runs with the same tool, face, and charset produce byte-identical files.

The scripts also pass `-nopreprocess -overlap -scanline`. Those are the defaults of a generator built without Skia, which is how Homebrew builds it; the Windows release is built with Skia, whose default path preprocessing draws different pixels for the same face. With the flags spelled out, the Windows binary reproduces the committed atlases byte for byte. It writes its JSON with CRLF, so `build-fonts.ps1` rewrites each file to LF.

## Kerning

msdf-atlas-gen reads only the legacy `kern` table, and none of these faces has one. After each atlas, the scripts run `scripts/merge-kerning.mjs`, which reads the face's GPOS `kern` feature with fontkit and rewrites the JSON's `kerning` array (nothing else in the file) with every non-zero pair among the atlas's own code points. Both Barlow Condensed weights get their pairs this way. Open Sans 3.000 (both weights) has no kerning of any kind and JetBrains Mono is monospaced, so their arrays stay empty. No OFL Open Sans kerns (3.003, static and variable, is the same), and the battle screen mock renders the same unkerned face from Google Fonts, so body text is unkerned on purpose (DDB-189). `fontAssets.test.ts` fails if a committed array differs from what its face gives. Details in `docs/AI_TECHNICAL_DECISIONS/font-pipeline.md`.

## Charset

`charset.txt` is msdf-atlas-gen's charset syntax (hex code points and `[first, last]` ranges; the format has no comments). It holds the R6.3 coverage: printable ASCII, Latin-1 Supplement (which includes the degree sign and middle dot), the general punctuation text uses (typographic spaces, zero-width space, dashes, quotes, dagger, bullet, ellipsis, per mille, primes, single guillemets, fraction slash, word joiner), the euro and trademark signs, U+FEFF, and U+FFFD.

A face may lack some of these: Open Sans has no U+2010 to U+2012, JetBrains Mono and Barlow Condensed have none of the typographic spaces, and Barlow Condensed has no U+FFFD. The generator warns about them and the loader (`src/renderer/engine/text/FontAtlas.ts`) substitutes the glyph a typesetter would use (a hyphen for a non-breaking hyphen) or, for a typographic space, a blank of its defined width. `fontAssets.test.ts` fails if any code point in the charset still resolves to nothing, so extending the charset means checking every face covers it or adding a substitute.

Symbols, arrows, and emoji are not text (R6.3); they belong in the icon atlas.

## Icon atlas

`material-icons.{png,json}` is R12.6's icon atlas, built by the same scripts with the same parameters and no kerning step, from [Material Icons](https://github.com/google/material-design-icons) Regular at commit `bd8cb85` (`font/MaterialIcons-Regular.ttf` and `.codepoints`), Apache License 2.0, `material-icons/LICENSE.txt`, which the builds ship beside the OFL files. The glyphs are the ones `icons.txt` names, by their Material name. The scripts first run `scripts/generate-icons.mjs`, which looks the names up in the `.codepoints` file and writes `src/renderer/engine/text/icons.ts`, then pass the same code points to msdf-atlas-gen, so the module and the atlas agree. To add an icon, add its name to `icons.txt`, run the script, and commit the atlas and `icons.ts`; `iconAssets.test.ts` fails if either is stale. Why Material Icons: `docs/AI_TECHNICAL_DECISIONS/icon-atlas.md`.
