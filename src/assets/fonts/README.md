# Font atlases

MSDF atlases for the text roles of R11.8, built by `scripts/build-fonts.sh` (macOS, Linux) or `scripts/build-fonts.ps1` (Windows). The PNG and JSON pairs are committed, so neither CI nor a fresh checkout needs the generator; run the script only when a face or `charset.txt` changes, then commit what it writes.

| Role | Face | Source | Licence | Atlas |
|---|---|---|---|---|
| body | Open Sans Regular 3.000 | [googlefonts/opensans](https://github.com/googlefonts/opensans) | SIL OFL 1.1, `open-sans/OFL.txt` | `open-sans-regular.{png,json}` |
| mono | JetBrains Mono Regular 2.304 | [JetBrains/JetBrainsMono release v2.304](https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304) | SIL OFL 1.1, `jetbrains-mono/OFL.txt` | `jetbrains-mono-regular.{png,json}` |
| display | not chosen yet | | | |

Every face has to ship with its licence file (R6.2), and the web and Electron builds copy the `OFL.txt` files into `assets/fonts/`. System fonts (Arial) cannot be redistributed, so they cannot be atlased.

## Generator

[msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen) v1.4.0. The scripts refuse any other version, because a different generator writes different pixels for the same input and the committed atlases would churn; set `MSDF_ATLAS_GEN_ANY_VERSION=1` to override, and bump the pinned version in both scripts if you commit the result.

- macOS: `brew install msdf-atlas-gen` (the formula is 1.4 at the time of writing).
- Windows: download `msdf-atlas-gen-1.4-win64.zip` from the [v1.4 release](https://github.com/Chlumsky/msdf-atlas-gen/releases/tag/v1.4), unzip it, and put the folder on `PATH` or point `MSDF_ATLAS_GEN` at the exe.
- Linux: build the v1.4 tag from source with CMake as its README describes (no release binary exists), then set `MSDF_ATLAS_GEN` if it is not on `PATH`.

Parameters (implementation spec section 5, R6.4a): `-type mtsdf -size 48 -pxrange 8 -yorigin top -potr`. The range-to-size ratio of 8/48 is the R6.4a minimum of 1/6, and the loader rejects an atlas below it. The output is deterministic: two runs with the same tool, face, and charset produce byte-identical files.

## Charset

`charset.txt` is msdf-atlas-gen's charset syntax (hex code points and `[first, last]` ranges; the format has no comments). It holds the R6.3 coverage: printable ASCII, Latin-1 Supplement (which includes the degree sign and middle dot), the general punctuation text uses (typographic spaces, zero-width space, dashes, quotes, dagger, bullet, ellipsis, per mille, primes, single guillemets, fraction slash, word joiner), the euro and trademark signs, U+FEFF, and U+FFFD.

A face may lack some of these: Open Sans has no U+2010 to U+2012, and JetBrains Mono has none of the typographic spaces. The generator warns about them and the loader (`src/renderer/engine/text/FontAtlas.ts`) substitutes the glyph a typesetter would use, a hyphen for a non-breaking hyphen, for example. `fontAssets.test.ts` fails if any code point in the charset still resolves to nothing, so extending the charset means checking both faces cover it or adding a substitute.

Symbols, arrows, and emoji are not text (R6.3); they belong in the icon atlas.
