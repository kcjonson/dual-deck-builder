# Atlas theme tokens and per-screen theme selection

Date: 2026-10-16, with DDB-502 (epic DDB-500). Spec: [UI Art Direction](../specs/UI%20Art%20Direction.md), Palette and Tokens, and its open question 1. Rules: R11.1, R11.2, R11.4, R11.7, R11.15 in [chapter 11](../ui-rendering-spec/11-style-and-theme.md); propagated properties in [chapter 8](../ui-rendering-spec/08-object-model.md). The atlas is the playtest direction, not the final UI.

## Context

The meta screens move to the road atlas look while combat keeps the current dark look until its own pass. Until now there was one theme: `tokens.ts` exported one `as const` table and about a hundred files imported it directly, the engine's style resolution included (`resolveColor('accent')` read the dark table, `variants.ts` built its tone palettes from it at module load). Tokens were global, so either every screen changed at once or a screen needed a way to pick its theme.

Two questions: where the second theme lives in the token file, and how a screen selects it.

## Token file

Options:

1. A `themes` object in `tokens.json` whose entries are partial files of the same shape, each token replacing the base's whole. Chosen.
2. A second file, `tokens.atlas.json`. Breaks R11.1's single source of truth, and the generator would have to reconcile two files anyway.
3. Every token carrying a value per theme (`{ value: { dark, atlas } }`). Doubles every entry in the file, including the hundred or so that never differ.

How option 1 works:

- The file's own categories are the base theme, `dark`. `themes.atlas` holds only what the atlas changes: 31 colours and `radius_ui` and `radius_panel`, re-aliased to `radius.r_0` (R11.7).
- A theme only re-values names the base has (R11.4). The generator rejects a theme token the base lacks, so the spec's additions (`driver_a`, `driver_a_casing`, `driver_b`, `driver_b_casing`, `hand_highlighter`, `hand_grease`, `hatch_rust`, `built_up`, `sheet_margin`) sit in the base, at their atlas values in both themes. Nothing dark draws them yet; if combat wants its own driver colours on tokens (DDB-246), dark gets its values then.
- Aliases resolve inside the theme, so `status_warn` (alias `color.accent`), `status_info`, and the elevation presets that alias colours follow the atlas without being listed. That's why the atlas's glow presets come out transparent: they alias `accent_glow` and `data_glow`, which the spec makes transparent.
- A theme may re-value paint only: `color`, `radius`, `elevation`, `texture`. Space, type sizes, motion, layers, typography, and control geometry are the same in every theme, which the generator enforces. Layout is therefore identical in both themes, so text never needs re-measuring on a theme change and `CONTROL_SIZES`, `autoTone`, and the focus ring geometry can keep reading the base.

The generated module keeps `tokens` as it was (the base, `as const`, so every existing import is untouched) and adds `Theme` (the base's shape with its values widened), `ThemeName`, `BASE_THEME`, and `themes`, a record of full resolved tables. The drift test covers the new output like the old.

## Selection

Options:

1. A global switch: a mutable current theme set on navigation, `tokens` read through it. Rejected. The engine's rule is that nothing in the tree reads a global (R1.6, R8.28); module-level values computed at import would keep the old theme; and two themes on screen at once (a screen transition, a dialog over a screen, the gallery) has no answer.
2. The theme on the `MountContext`. The app builds one context and mounts every screen and overlay with it, so this is the global switch again, mutated on navigate, unless each screen got its own context, which would split the dispatcher, focus, and overlay services that have to span screens.
3. A propagated tree property, like `layer`, `enabled`, and `opacity` (chapter 8), set on a screen's root and resolved through style resolution with the theme passed in. Chosen.
4. Separate atlas components (`AtlasButton`). Rejected: R11.7 says a theme restyles by re-aliasing tokens, not by editing components, and every catalog component would need a twin.

How option 3 works:

- `Component.theme` is the own theme, null to inherit (also a constructor option). `effectiveTheme` walks to the nearest own theme, `dark` at a root without one. `themeTokens` is that theme's table.
- `ScreenOptions.theme` sets it on the screen's root, its own or the default container: `super('compound', { theme: 'atlas' })`. A screen that passes nothing stays dark, which is how combat keeps its look.
- The style resolvers take the theme as a last argument defaulting to the base: `resolveColor`, `resolveLength`, `resolvePadding`, `resolveLetterSpacing`, `resolveShadow`, `resolveBoxStyle`, and the variant builders (`buttonLayers`, `fieldLayers`, `rowLayers`, `markLayers`, `tabLayers`, `segmentLayers`, `toneColor`, `toneGlow`). `variants.ts` builds its tone palettes and pressed and active overlays once per theme instead of once at import.
- Components resolve at construction against `themeTokens`, then hear `onThemeChange(theme)` when their effective theme moves: on a `theme` set, on an insert under a parent with a different theme, and when a detached subtree is mounted as a root. Every component starts on the theme it was built against, and the framework walks a subtree only while the theme differs, so an unthemed tree is never told anything and does no extra work. That's also why no visual baseline moves.
- A theme change snaps; it's not a state change, so it doesn't fade through R11.13's transitions.

## What follows the theme today

The primitives most screens build with, one control, and the overlay chrome:

- `Rectangle`: its style object and the setter overrides (`fillColor`, `borderColor`, `borderWidth`, `cornerRadius`) are kept as authored and re-resolved, so `fillColor = 'accent'` follows the theme.
- `Stack`'s backdrop.
- `Text`'s colour (the only themed thing it draws).
- `Button`, through `buttonLayers`, in every state. On an atlas screen `tone: 'accent'` has the Highway fill, `accent_contrast` text, square corners, and no glow. Its border is `accent_edge` (the Casing on the atlas) and its focus ring `focus_ring` (ink on the atlas), both aliased to `accent` in the dark theme. Border width and label size aren't paint, so the full highway primary is `AtlasButton` ([atlas-components.md](./atlas-components.md)).
- `Panel` (its box, its header text, and the content inset that clears its corner, which moves with `radius_panel`), `Dialog` (scrim and footer hairline), `Popover`, `Tooltip`, and `KeyCap`.

Everything else still reads the base table directly: the rest of the engine catalog (Slider, Toggle, Menu, Toast, TabBar, and so on), the shapes (Circle, Polygon, Triangle, Line, Image tint), and the game's composites. Each converts the same way when an atlas screen first uses it: resolve against `this.themeTokens` (or pass it to the variant builder) and re-resolve in `onThemeChange`. DDB-505 and the screen tasks convert what they use.

Overlays are their own roots, so their theme comes from whoever opens them. `OverlayOptions.theme` sets it on the overlay's root and the content inherits it. The services fill it in from what they already know: the popup service from the trigger, else the anchor component; the tooltip service from the owner; a popover from its anchor component unless `PopoverOptions.theme` says otherwise. A dialog has no opener, so the caller passes one: `dialog.show(this.context, { theme: this.theme })` from a screen.

A detached subtree keeps the theme it was last attached under, and a child added to it while detached inherits that, so re-inserting the subtree under the same theme leaves nothing stale. Syncing reads the parent's applied theme, not a walk up the tree, so an insert costs one comparison when nothing moves.

## Consequences

- Two themes can be on screen at once, in one tree or across roots, with no global state.
- Adding a theme is a `themes` entry in `tokens.json` and a regenerate; `ThemeName` widens by itself.
- Converted components carry the authored values (a token name rather than only its floats), a few more fields each.
- Code that imports `tokens` directly is dark by definition. That's correct for combat and wrong on an atlas screen, so a component that appears on one must go through `themeTokens`. Nothing enforces this yet; a lint against `tokens.color` in engine catalog files would, once enough of the catalog is converted to make it practical.
