# Theme tokens: the starting palette

Status: decided 2026-09-28 with DDB-83 (phase 4 of DDB-55). Rules in [chapter 11](../ui-rendering-spec/11-style-and-theme.md).

## Format

Salal ui reads a theme as design tokens in the W3C Design Tokens Format (salal's `docs/ui-design.md`, "Theme"): a `.tokens.json` in three tiers, component tokens aliasing semantic tokens, which alias base tokens, and a game's own file overriding any tier, with aliases doing the mapping. The palette below was written for the TypeScript engine's own format (`_legacy/src/renderer/engine/theme/tokens.json`, generated into `tokens.ts` by `_legacy/scripts/generate-tokens.mjs`), so it needs re-expressing in that format: its colours as the game's base tokens, and ui's semantic roles (surfaces, text, lines, scrim, focus ring, the tone set) aliased to them.

## Starting palette

The colours in today's screens are not a theme: about 130 distinct colour literals under `_legacy/src/renderer`, several blue-purple panel greys (`#2a2a3a`, `#4a4a5a`, `#1a1a33`), a developer style guide of saturated primaries (`#3366ff`, `#ff6600`), and nothing resembling two accents over five surfaces. The decided visual direction is the battle screen mock (`docs/design/battle-screen/index.html`, linked from [Battle Screen Design](../specs/Battle%20Screen%20Design.md)), whose `:root` already is most of a token set. The theme takes its values from there and fills what the mock lacks.

| Token | Value | From |
|---|---|---|
| `bg_void`, `bg_base`, `bg_inset`, `bg_panel`, `bg_panel_raised` | `#111214` `#1a1c1e` `#212427` `#26292c` `#30343a` | mock `--ground`, `--asphalt`, `--asphalt-2`, `--panel`, `--panel-2` |
| `line_hairline`, `line_edge`, `line_strong` | bone at 0.10, 0.20, 0.36 | mock `--line`, `--line-2`; 0.36 from R11.5 |
| `accent` (warm) | `#efd25a` | mock `--warn`: keywords, warnings, focus outline, synergy highlight |
| `data` (cool) | `#849bf5` | chosen, see below; not in the mock |
| `text`, `text_dim`, `text_faint` | `#e9e4d6` `#a39e92` `#6f6b63` | mock `--bone`, `--muted`, `--dim` |
| `status_ok`, `status_crit` | `#56d29e` `#f075b3` | chosen, see below; not in the mock |
| `scrim` | black at 0.72 | worldsim's default; the mock has no scrim |
| `shadow`, `shadow_strong` | black at 0.5, 0.8 | the mock's card shadow and inspected-card shadow |
| `accent_bright`, `data_bright` | 35 percent toward white | derived |
| `accent_dim` | `#4a3a12` | mock's major-severity chip |
| `data_dim` | `#2e344c` | 25 percent of `data` over `bg_void` |
| `text_disabled` | `#55524c` | derived, not in the mock |

Why yellow rather than amber for the warm accent: Battle Screen Design section 7 gives amber and teal to the two drivers and says nothing else uses them, and gives yellow to keywords, warnings, and the centre line. R11.6's warm accent is interaction and warnings, so it is the yellow, and the mock already draws its focus outline and synergy highlight in it. Section 7 now lists interaction (focus, hover, primary actions) under yellow too, so the design doc and the theme agree.

### Data, ok, and crit: hues nobody else owns

The mock's legend is titled "One hue, one meaning" and every hue it names already has a job: amber and teal (drivers), bone-grey (escorts), red (raiders and attack intents), green (structure), steel (armor), pink-red (driver HP), yellow (keywords, warnings), and four rarity gems (grey, sky blue `#6fb3e0`, gold, magenta). The debuff intent adds a lavender. The first cut of this file took the uncommon gem's sky blue for `data` and the structure green and raider red for ok and crit, which gave three hues a second meaning; DDB-84 would have spread those meanings over every info badge and status chip.

The three UI hues are chosen from the gaps in that wheel, then checked by CIE Lab distance against every legend colour and by WCAG contrast against the surfaces:

| Token | Value | Hue | Nearest legend colours (Lab distance) | Contrast on inset / panel / raised |
|---|---|---|---|---|
| `data` | `#849bf5` periwinkle | 228 | debuff lavender 24, uncommon gem 31 | 5.9 / 5.6 / 4.8 |
| `status_ok` | `#56d29e` mint | 155 | teal 32, structure green 32 | 8.3 / 7.7 / 6.6 |
| `status_crit` | `#f075b3` pink | 330 | legendary gem 29, driver HP 29 | 5.9 / 5.5 / 4.7 |

All three clear 4.5:1 on every surface, so they work as text. Crit is the uncomfortable one: the red end of the wheel belongs to raiders and HP, so critical is a hot pink rather than a red. That is a readability trade for the one-meaning rule, and it's Kevin's to overrule; if crit should read as danger-red, the honest alternative is to share raider red and say so in section 7, not to pick a near-red that collides anyway. A test asserts each of the three is at least 20 (CIE76) from every legend colour, the debuff and non-attack intent lavenders included since DDB-84 (`_legacy/src/renderer/engine/theme/tokens.test.ts`).

Departures from worldsim's defaults, all allowed by 11.2 ("values are its defaults and any theme may replace them"):

- Line tint is the warm bone of the mock, not a cool blue-grey. R11.5 names the cool tint; the structure it cares about (tinted, not white, three alphas) holds and is tested.
- `fs_2xs` (10 px) is gone: R6.4a says the scale defines nothing below 11 (a SHOULD). The mock sets 10 px mono in three places, including the vehicle plate tag (`index.html`, `.plate .r4 .ptag`) in a fixed 26 px slot that the section 10 fit matrix checks. Those move to `fs_xs` (11 px) and the plate row needs a refit when the plate migrates.
- `shadow_pop` is blur 24 at offset (0, 12) where the mock's inspected card is blur 40 at offset (0, 16); R11.5 says large blurs aren't used for elevation. Its colour is `shadow_strong`, not `scrim`, so re-theming the modal backdrop doesn't move a shadow.
- Added tokens the spec names only in prose: `dur_tooltip_hide` (R12.22's 80 ms), `press_offset` (R11.12's 1 px), `control_fs_sm/md/lg` (R11.10's 13, 15, 18), `inset_field` and `inset_row` (R11.9), `tone_auto_crit` and `tone_auto_warn` (R11.10's 0.25 and 0.5), `tooltip_delay` 500 and `hover_move_tolerance` 4 (worldsim's literals). Icon sizes 14, 16, 20 are new; worldsim had no icon tokens.

## Not in the tokens yet

- Game identity colours: the driver amber and teal, raider red, structure, armor, and HP hues from Battle Screen Design section 7. They are content colours, not UI accents, and R11.6 keeps the UI to two accents plus ok and crit, none of which reuses them. They go in the game's tokens file as base colours of their own.
- Type role faces match what the font pipeline ships: Barlow Condensed 600 and 700 for display, Open Sans 400 and 600 for body (the second weights since DDB-503), JetBrains Mono 400 for mono. With no body bold face loaded, bold on body goes to the display face (R11.8); a weight no role has falls to the nearest loaded one.
- Card-specific text sizes (16 and 14 px card names in the battle screen text budget) are not on the scale; add them as named tokens rather than widening the general scale.
