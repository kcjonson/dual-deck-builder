# Font pipeline: faces, atlases, and the loader

## Date
2026-09-28

## Context

DDB-69, the first item of DDB-55's phase 2. Implementation spec section 5 fixed most of the toolchain: msdf-atlas-gen, `-type mtsdf -size 48 -pxrange 8 -yorigin top`, a hand-run `scripts/build-fonts.(sh|ps1)`, committed PNG and JSON under `src/assets/fonts/`, msdf-atlas-gen's JSON as the one schema (R6.2), JSON bundled as modules and images as asset modules (R15.34). What it left open: the display and mono faces, what R6.2's "every glyph has both bounds" means for a space, what to do when a face lacks part of the R6.3 charset, and how to check the packaged Electron build without a dev hook. Nothing draws with the atlases yet; DDB-70's `text` mode does, after the uber shader.

## Decisions

### Faces

Body is Open Sans Regular 3.000, the TTF that was already in `public/assets/fonts/` and referenced by nothing, moved to `src/assets/fonts/open-sans/` with the OFL text from googlefonts/opensans. Mono is JetBrains Mono Regular 2.304 from JetBrains' own GitHub release, OFL 1.1. JetBrains Mono over Roboto Mono because it is OFL with no licence history to check (Roboto Mono shipped under Apache 2.0 for most of its life) and has the larger x-height, which matters for the numerics and kickers R11.8 gives the mono role at 11 to 13 px. Display is Barlow Condensed SemiBold 1.422 from jpt/barlow, OFL 1.1: the battle screen mock (`docs/design/battle-screen/index.html`) and DDB-83's `typography.role_display` token already name Barlow Condensed, and the mock sets its display text at 600. One weight per role, because R6.4 asks for one atlas per role at minimum and nothing yet needs a second; body has no bold face, so R11.8's table resolves body `bold` to this face. Adding 700 later is one more line in the build scripts and one manifest entry.

### Atlas layout

`-potr` rather than `-pots`: Open Sans and JetBrains Mono fit 1024x512 and Barlow Condensed 512x512, where the power-of-two square would leave the first two half empty. The generator is pinned at v1.4.0 by the scripts, since another version writes different pixels and the committed files would churn; two runs of the same version are byte-identical.

### Blank glyphs are valid

msdf-atlas-gen writes every whitespace glyph with an advance and no bounds. Reading R6.2 literally would drop the space. The loader distinguishes: neither bound is a blank glyph (kept, advance only); exactly one bound, malformed numbers, inverted bounds, or atlas bounds outside the image is a malformed glyph, dropped with a warning. That keeps the rule's point, which is that a glyph is never given a full-cell fallback that samples its neighbours.

### Coverage completion in the loader

Open Sans 3.000 has no U+2010 to U+2012, U+201F, U+202F, or U+2060; JetBrains Mono has none of the typographic spaces U+2002 to U+200A, nor U+2011, U+2012, U+2015, U+202F, or U+2060; Barlow Condensed misses the same spaces and dashes plus U+201B and U+FFFD. R6.3 asks for general punctuation, so those would otherwise render as the fallback glyph. The loader fills these in, only when the face lacks the code point. Typographic spaces become blanks of their defined width (em space 1 em, en space 0.5 em, three-, four-, and six-per-em spaces, thin 1/5 em, hair 1/10 em, figure space a digit's advance, punctuation space a full stop's), not copies of the word space, which in Barlow Condensed is about a fifth of an em. Visible punctuation is copied from the glyph a typesetter would use: non-breaking and plain hyphen to the hyphen-minus, figure dash to en dash, horizontal bar to em dash, U+201B to U+2018, U+201F to U+201D, narrow no-break space to thin space or no-break space, U+FFFD to `?` (R6.3's own fallback glyph). U+200B, U+2060, and U+FEFF are forced to zero-width blanks whether or not the face has them, because JetBrains Mono gives U+200B a full cell advance. A test over the committed atlases fails if any `charset.txt` code point still resolves to nothing.

Alternatives: extend the charset with a second face as a fallback (a second atlas lookup per glyph for a handful of punctuation), or patch the TTFs (modifying OFL fonts triggers the reserved-name rules and needs FontForge in the pipeline). Substitution is a small table with tests and changes nothing on disk. R6.2 and R6.3 in `docs/ui-rendering-spec/06-text.md` were amended to allow both the blank glyphs and the stand-ins, so the spec and the loader agree.

### Normalised on load

The loader converts everything to one convention so no consumer checks `yOrigin` or `emSize`: lengths per em, y down, plane bounds relative to the pen on the baseline, atlas bounds in texels from the top-left, ascender and descender both positive. A bottom-origin file is flipped (R6.2's "the loader MUST honour" `yOrigin`). R6.4a's range-to-size ratio is checked on load as well as in the script flags.

### Kerning

msdf-atlas-gen v1.4 reads only the legacy `kern` table (through FreeType), and none of the three faces has one, so DDB-69 committed three atlases with zero pairs. DDB-182 added a step after each atlas: `scripts/merge-kerning.mjs` opens the face with fontkit, `scripts/gpos-kerning.ts` resolves GPOS pair adjustment for every ordered pair of the code points the atlas holds, and the result replaces the JSON's `kerning[]` in msdf-atlas-gen's own shape (`unicode1`, `unicode2`, `advance` in em), which the loader already read. What that turned up per face:

- Barlow Condensed SemiBold: a `kern` feature over two pair adjustment lookups (one direct, one through type 9 extensions), format 1 exceptions ahead of format 2 class kerning. 4982 non-zero pairs over its 212 glyphs.
- Open Sans 3.000: no kerning at all. No `kern` table, and its GPOS holds only `mark` and `mkmk`. The premise that it kerns in GPOS was wrong for this build; fontkit's own shaper confirms `AV` and `To` come out unkerned. Kept that way on purpose; see the next section (DDB-189).
- JetBrains Mono: monospaced, no `kern` feature, as expected.

How the resolution works: the lookups the `kern` feature names under `latn` (else `DFLT`) default language system, in lookup-list order, adjustments summed across lookups, and within one lookup the first subtable that applies wins. A format 1 subtable that covers the first glyph but lists no record for the second does not apply, so the next subtable is tried; format 2 applies whenever the first glyph is covered, with unlisted glyphs in class 0. Lookup flags that skip a glyph class (via GDEF) mean no pair, since a shaper would kern across that glyph instead; a mark filtering set is not modelled and fails the build. Only the first glyph's x advance fits the pen model the loader and R6.8 use, so any other non-zero value (placement, y advance, second-glyph values) fails the build rather than being dropped, and a contextual kern lookup (types 7 and 8) is reported as skipped. A test runs fontkit's shaper over all 2704 letter pairs in Barlow Condensed and requires the extraction to agree with it; another requires every committed `kerning[]` to equal a fresh extraction from its face, so a face swapped without regenerating fails.

Library: fontkit over opentype.js. opentype.js 2.0.0 was tried first and does not parse GPOS extension lookups (type 9), which is where half of Barlow's kerning lives. fontkit resolves them and ships a shaper to test against. It is a devDependency used only by the hand-run build and the tests, never bundled.

Why a Node step and not fontTools: the repo has no Python dependency, and the extraction is small enough to test in jest with the rest of the loader. The core is TypeScript (`scripts/gpos-kerning.ts`) so jest and `tsc` check it; the `.mjs` entry loads it through Node's type stripping (Node 22.18 or later, which the build scripts' users need anyway for `npm ci`), so the file stays erasable syntax. jest's roots and the root tsconfig now include `scripts/`.

Determinism: code points are deduplicated and sorted, pairs come out in (left, right) order, and only the `kerning` array is spliced into the file, because re-serialising msdf-atlas-gen's 17-digit floats through `JSON.stringify` would rewrite every glyph's text. The merge checks that the rest of the parsed file is unchanged. A full `build-fonts.sh` run reproduced all three PNGs and the Open Sans and JetBrains Mono JSON byte for byte, and running the merge twice gives the same file.

Cost: Barlow's JSON grows from 49 KB to 288 KB, and it is bundled as a module (R15.34), so `main.js` grows by about 240 KB (28 KB gzipped). Dropping pairs under 0.01 em would remove about a third of them; not done, because the loss would be invisible only at small sizes and display text is the large size. If bundle size matters later, the answer is a class-based form of `kerning[]` behind a converter, which R6.2 allows.

The loader now also drops, with a warning, a pair naming a code point the atlas has no glyph for (checked before substitutes, so a stand-in never inherits another glyph's kerning) and the second of two entries for the same pair.

### Body text stays unkerned (DDB-189)

Decided 2026-09-28: keep Open Sans 3.000 as the body face and ship it unkerned. The battle screen mock sets body text in Open Sans from Google Fonts, and that face has no kerning either, so unkerned is the mock's look; every kerned alternative moves away from it.

What was checked, with fontkit over the 225 code points the body atlas holds:

- Every OFL Open Sans lacks kerning. The committed 3.000 static, the 3.003 static in `googlefonts/opensans` `fonts/ttf/`, and the 3.003 variable font (`fonts/variable/OpenSans[wdth,wght].ttf`, upstream commit `bd7e376`, which is the file `google/fonts` ships) all have no `kern` table and a GPOS of `mark` and `mkmk` only. Upstream has tracked this as [googlefonts/opensans#4](https://github.com/googlefonts/opensans/issues/4) since 2018, still open.
- The mock's font is the same drawing as ours. The latin subset `fonts.googleapis.com` serves the mock for `Open Sans:wght@400` (gstatic `v44`, version 3.003) has no kerning, and its outlines and advances match the committed 3.000 for all 213 atlas glyphs it contains; the 3.003 variable font's default instance matches all 225. Instancing the variable font at wght 400 would therefore change nothing, and 3.000 needs no upgrade to match the mock.
- Open Sans 1.10 (`google/fonts` `apache/opensans/` at `4e24bf1`, removed when 3.000 landed in 2021) is the only Open Sans with kerning, in a legacy `kern` table msdf-atlas-gen would read directly. It is Apache 2.0, not OFL, and a different drawing: 214 of the 225 glyph outlines differ from 3.x, 75 of 95 ASCII advances differ (the grave accent by 0.3 em), and its OS/2 typo metrics differ. Taking it trades the mock's exact face for an older revision under another licence.
- Noto Sans 2.015 (OFL, Open Sans's design lineage, GPOS `kern`) kerns, but every ASCII advance differs from Open Sans, the card text sets 1.1% wider, the family name in `role_body` and the CSS stacks changes, and the variable font is 2 MB. It is a near neighbour of the mock's face, not the face.

What kerning would buy, measured on every card name, summary, and description in `cards.json` (4468 adjacent pairs, variables filled with a digit) at 13 px, the middle of the 11 to 15 px body range the mock uses (card rules 12 px, keyword panel 13 px, page body 15 px). With Open Sans 1.10's kern table, 196 pairs (4.4%) are kerned, 26 move by 0.5 px or more, 9 by 1 px or more, and the largest is 1.69 px (`P.`, `P,`). With Noto Sans, 39 move by 0.5 px or more and 22 by 1 px or more, largest 2.08 px (`r.`). So kerning is not invisible at these sizes; a handful of pairs per card's worth of text would tighten by about a pixel. The call rests on fidelity to the reviewed mock, not on the effect being zero.

Nothing in the engine assumes the body face is unkerned. R6.9 applies kerning pairs "when present", `merge-kerning.mjs` picks up a GPOS `kern` feature and leaves a legacy `kern` table's pairs (which msdf-atlas-gen writes itself) alone, and `fontAssets.test.ts` requires the committed arrays to match the face. If upstream Open Sans ever ships kerning, or the direction changes to Noto Sans, the change is a new TTF, a `build-fonts.sh` run, and the zero-pairs assertion for Open Sans in that test; the metrics service needs nothing.

### Loading at startup, not drawing

`src/index.ts` starts `loadFontAtlases` alongside the rest of startup and keeps the promise for DDB-70. It validates the metrics, decodes each image, and checks the image size matches the metrics (the one mismatch JSON validation cannot see). No pixel changes: nothing reads the result.

### R15.34 check

The web build emits the atlases as hashed files under `assets/fonts/`; the Electron renderer inlines them as data URIs. `scripts/smoke-electron-package.mjs` launches the packaged app from `release/` with Playwright's Electron launcher, reloads with request listeners attached, and fails unless the page is on `file://`, the `font-atlases-ready` mark appears (set by `src/index.ts`; a production bundle has no dev hooks to ask), and no image was requested as a file. It runs after packaging in both Electron Build jobs. Checked locally on macOS against an unpacked `electron-builder --dir` build: passes as built, and fails with the two atlas PNG URLs listed when the Electron rule is switched to `asset/resource`. That experiment also showed a file-scheme image would have loaded, so inlining is R15.34's belt rather than a fix for a live failure; the JSON-as-module half is the part that avoids the known `fetch` failure.

## Consequences

- DDB-70 takes `LoadedFontAtlas[]` (role, face, validated `FontAtlas`, decoded image) and uploads with R6.4b's pixel-store flags.
- The metrics service (R6.8) reads `FontAtlas.glyph` and `kerning`, and owns the fallback-glyph policy for code points that are still absent.
- About 800 KiB of PNG: three web requests, or a little over 1 MiB of base64 in the Electron renderer bundle.
