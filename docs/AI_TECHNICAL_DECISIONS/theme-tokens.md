# Theme tokens: file format, generator, starting palette

Status: decided 2026-09-28 with DDB-83 (phase 4 of DDB-55). Rules R11.1 to R11.9 in [chapter 11](../ui-rendering-spec/11-style-and-theme.md); the toolchain line in the [implementation spec](../specs/ui-rendering-engine-implementation.md) section 5.

## What exists

- `src/renderer/engine/theme/tokens.json`: the only place a theme value is written.
- `scripts/generate-tokens.mjs`: plain Node, no dependencies. `npm run tokens` writes `tokens.ts`; `--check` exits 1 when it is stale; `--stdout` prints it; `--input <file>` reads another source (the tests use it).
- `src/renderer/engine/theme/tokens.ts`: generated, committed, `as const`. Consumers read `tokens.color.accent`, `tokens.control.control_h_md`, and so on (R11.4's namespacing).
- `src/renderer/engine/theme/tokens.test.ts`: the drift test (spawns the generator and compares its output to the committed file byte for byte), the round trip of 11.6 (every token present with the file's value, css-only tokens absent, nothing extra), the generator's rejections, and the 11.2 structure rules as assertions.

Nothing consumes the tokens yet. DDB-84 migrates components; that PR is where pixels move.

## File format

Top-level keys are R11.3's categories (`$description` is ignored). A token is either `{ value, css?, cssOnly?, description? }` or `{ alias: "category.name", description? }`, and inside any value an object that is exactly `{ alias: "category.name" }` resolves to that token, which is how `elevation.glow_accent` takes `color.accent_glow` and `typography.role_body` takes `fontSize.fs_base`.

Choices made, with what lost:

- Numeric value first, css beside it. R11.1 says the file holds the renderer's form. Worldsim went the other way (prototype CSS first, floats derived), which suits a repo whose source of truth is a web prototype; ours is not. The cost is that a colour is written twice, so the generator parses the css form and rejects a pair more than half an 8-bit step apart. Same for an easing's `cubic-bezier()`. The floats are rounded to four places.
- Aliases are fully qualified (`radius.r_sm`, never `r_sm`) so a cross-category alias reads the same as a same-category one. Leaf names are unique across the whole file anyway (R11.4), enforced by the generator, so the qualification is for the reader.
- The generated module carries resolved values, with `// = radius.r_sm` beside an alias. It exports no alias table; nothing needs one until a theme switch exists.
- `cssOnly` tokens (the three font stacks) are kept for the design mocks and skipped by the generator, which 11.6 requires a test for; the test also asserts at least one exists so that skip path can't go untested by accident.
- The drift test spawns the real script rather than importing it. Jest here is ts-jest over CommonJS, which can't load an `.mjs` without `--experimental-vm-modules`; spawning costs about 80 ms and tests the actual CLI CI would run.
- Validation lives in the generator (categories, shapes, colour ranges, cycles, duplicate leaves), so a bad edit fails at `npm run tokens` with the token's path in the message. The one check that needs TypeScript, that `layer` tokens name exactly the chapter 3 ladder in `draw/layers.ts`, is in the test.

## Starting palette

The colours in today's screens are not a theme: about 130 distinct colour literals under `src/renderer`, several blue-purple panel greys (`#2a2a3a`, `#4a4a5a`, `#1a1a33`), a developer style guide of saturated primaries (`#3366ff`, `#ff6600`), and nothing resembling two accents over five surfaces. The decided visual direction is the battle screen mock (`docs/design/battle-screen/index.html`, linked from [Battle Screen Design](../specs/Battle%20Screen%20Design.md)), whose `:root` already is most of a token set. The theme takes its values from there and fills what the mock lacks.

| Token | Value | From |
|---|---|---|
| `bg_void`, `bg_base`, `bg_inset`, `bg_panel`, `bg_panel_raised` | `#111214` `#1a1c1e` `#212427` `#26292c` `#30343a` | mock `--ground`, `--asphalt`, `--asphalt-2`, `--panel`, `--panel-2` |
| `line_hairline`, `line_edge`, `line_strong` | bone at 0.10, 0.20, 0.36 | mock `--line`, `--line-2`; 0.36 from R11.5 |
| `accent` (warm) | `#efd25a` | mock `--warn`: keywords, warnings, focus outline, synergy highlight |
| `data` (cool) | `#6fb3e0` | mock's cool blue; the muted descendant of the old style guide's Info `#33ccff` |
| `text`, `text_dim`, `text_faint` | `#e9e4d6` `#a39e92` `#6f6b63` | mock `--bone`, `--muted`, `--dim` |
| `status_ok`, `status_crit` | `#8fbf5c` `#d4513f` | mock `--struct`, `--enemy` |
| `scrim` | black at 0.8 | the combat log and the mock both use it |
| `accent_bright`, `data_bright` | 35 percent toward white | derived |
| `accent_dim` | `#4a3a12` | mock's major-severity chip |
| `data_dim`, `text_disabled` | `#1c3a4f` `#55524c` | derived, not in the mock |

Why yellow rather than amber for the warm accent: Battle Screen Design section 7 gives amber and teal to the two drivers and says nothing else uses them, and gives yellow to keywords, warnings, and the centre line. R11.6's warm accent is interaction and warnings, so it is the yellow, and the mock already draws its focus outline in it.

Departures from worldsim's defaults, all allowed by 11.2 ("values are its defaults and any theme may replace them"):

- Line tint is the warm bone of the mock, not a cool blue-grey. R11.5 names the cool tint; the structure it cares about (tinted, not white, three alphas) holds and is tested.
- `scrim` is 0.8 rather than 0.72, matching what the game and mock use.
- `fs_2xs` (10 px) is gone: R6.4a says the scale defines nothing below 11.
- `shadow_pop` blurs 24 where the mock's inspected card blurs 40; R11.5 says large blurs aren't used for elevation.
- Added tokens the spec names only in prose: `dur_tooltip_hide` (R12.22's 80 ms), `press_offset` (R11.12's 1 px), `control_fs_sm/md/lg` (R11.10's 13, 15, 18), `inset_field` and `inset_row` (R11.9), `tone_auto_crit` and `tone_auto_warn` (R11.10's 0.25 and 0.5), `tooltip_delay` 500 and `hover_move_tolerance` 4 (worldsim's literals). Icon sizes 14, 16, 20 are new; worldsim had no icon tokens.

## Not in this file yet

- Game identity colours: the driver amber and teal, raider red, structure, armor, and HP hues from Battle Screen Design section 7. They are content colours, not UI accents, and R11.6 keeps the UI to two accents plus ok and crit. They land when the combat screen migrates, as their own names in the `color` category, and the R11.6 test keeps checking only the accent structure.
- Type role faces. `typography.role_*` names the mock's families (Barlow Condensed, Open Sans, JetBrains Mono) and a guess at the weights each will load. DDB-69 decides the faces; whichever PR lands second makes the two agree. `role_body.boldRole: 'display'` is R11.8's fallback for `bold` on body when no body bold face is loaded.
- Card-specific text sizes (16 and 14 px card names in the battle screen text budget) are not on the scale; add them as named tokens when the card is migrated rather than widening the general scale.

## Map for DDB-84

The literals most used today and the token each most likely becomes. Several are judgement calls that the phase 4 re-baseline will show.

| Literal | Uses | Token |
|---|---|---|
| `#ffffff` text | 69 | `text` (body) or `text_bright` (titles, values) |
| `#cccccc`, `#aaaaaa` | 14 | `text_dim` |
| `#666666`, `#888888` | 13 | `text_faint` |
| `#1a1a1a`, `#262626`, `#1a1a33`, `#0d0d1a` | screen backgrounds | `bg_base` (splash may want `bg_void`) |
| `#2a2a3a`, `#1a1a2a` | panels, hand area, log | `bg_panel` |
| `#4a4a5a`, `#4a4a6a`, `#3a3a5a` | raised panels, buttons | `bg_panel_raised` |
| `#1a1a1a` inputs | developer input showcase | `bg_inset` |
| `#ffcc00`, `#ffaa00` | warnings, highlights | `accent` |
| `#33ccff`, `#3366ff` | info, primary buttons | `data` for information; primary buttons become the `primary` variant on `accent` |
| `#00cc66`, `#4a8a4a` | success, structure bars | `status_ok` |
| `#ff3333`, `#aa4a4a` | danger, enemy | `status_crit` |
| `rgba(0, 0, 0, 0.8)` | log backdrop | `scrim` |
