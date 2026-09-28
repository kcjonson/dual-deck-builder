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

All three committed atlases have zero kerning pairs. JetBrains Mono is monospaced; Open Sans 3.000 and Barlow Condensed keep their kerning in GPOS, and msdf-atlas-gen reads only the legacy `kern` table. The loader reads `kerning[]` and the tests cover it, so R6.9 works for any face that has a `kern` table, but body and display text are unkerned until a GPOS extraction step exists. Filed as a follow-up.

### Loading at startup, not drawing

`src/index.ts` starts `loadFontAtlases` alongside the rest of startup and keeps the promise for DDB-70. It validates the metrics, decodes each image, and checks the image size matches the metrics (the one mismatch JSON validation cannot see). No pixel changes: nothing reads the result.

### R15.34 check

The web build emits the atlases as hashed files under `assets/fonts/`; the Electron renderer inlines them as data URIs. `scripts/smoke-electron-package.mjs` launches the packaged app from `release/` with Playwright's Electron launcher, reloads with request listeners attached, and fails unless the page is on `file://`, the `font-atlases-ready` mark appears (set by `src/index.ts`; a production bundle has no dev hooks to ask), and no image was requested as a file. It runs after packaging in both Electron Build jobs. Checked locally on macOS against an unpacked `electron-builder --dir` build: passes as built, and fails with the two atlas PNG URLs listed when the Electron rule is switched to `asset/resource`. That experiment also showed a file-scheme image would have loaded, so inlining is R15.34's belt rather than a fix for a live failure; the JSON-as-module half is the part that avoids the known `fetch` failure.

## Consequences

- DDB-70 takes `LoadedFontAtlas[]` (role, face, validated `FontAtlas`, decoded image) and uploads with R6.4b's pixel-store flags.
- The metrics service (R6.8) reads `FontAtlas.glyph` and `kerning`, and owns the fallback-glyph policy for code points that are still absent.
- About 800 KiB of PNG: three web requests, or a little over 1 MiB of base64 in the Electron renderer bundle.
