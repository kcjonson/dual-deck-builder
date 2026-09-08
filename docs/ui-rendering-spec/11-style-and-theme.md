# 11. Styling, tokens, and theme

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

Style values come from one token file, generated into a typed module, and components resolve their look by layering interaction states over a variant's base look. Nothing in a component file is a literal colour, radius, or duration. Worldsim built the pipeline (a web prototype's CSS custom properties become `tokens.json`, which becomes a C++ header) and then wired only part of it (motion tokens generated but unused; of the z tokens only `z_modal` and `z_panel` used while the library's own popups sit on literals; hard-coded seconds in components); this chapter requires the whole loop, and the review replaced the first draft's exclusive state precedence with composable state layers.

Rules are numbered R11.n.

## 11.1 Tokens

- R11.1 One token file (`tokens.json`) is the single source of truth. Each token has a name, a category, and a value in a numeric form the renderer can use directly (colours as normalised RGBA floats, lengths in logical pixels, durations in milliseconds, letter spacing in em, z layers as layer names). A `css` form MAY sit beside the numeric one for a web prototype; tokens that only make sense in CSS are flagged and skipped by the generator.
- R11.2 A generator produces a typed module for each implementation from the same file (a TypeScript module with `as const`, a C++ header of `constexpr`). The generated module is committed, and a unit test regenerates it in memory and fails on any difference, so it cannot drift. Hand-edited theme files are prohibited; worldsim deleted its hand-maintained theme header as the last step of its token cutover, once nothing consumed it.
- R11.3 Required categories: `color` (surfaces, lines, accents, text, status, scrim), `space` (a 4 px base with 2 px and 6 px half steps, plus `scroll_step` for keyboard scrolling), `radius`, `borderWidth`, `fontSize`, `lineHeight`, `letterSpacing`, `motion` (durations and easing control points), `layer` (the chapter 3 ladder), `elevation` (shadow and glow presets: colour, blur, spread, offset), `typography` (font roles, weights, and the weight resolution table of R11.8), `control` (`control_h_sm`, `control_h_md`, `control_h_lg`, `icon_sm`, `icon_md`, `icon_lg`, `focus_ring_width`, `focus_ring_offset`, `drag_threshold_mouse`, `drag_threshold_touch`, `tooltip_delay`, `hover_move_tolerance`; a specification addition, worldsim's equivalents are literals in components). Optional: `texture` (overlay opacities), `density`. Numbers that both implementations must agree on are tokens, never prose constants.
- R11.4 Token names are stable identifiers shared by the prototype, the spec, and the implementations (`accent`, `bg_panel_raised`, `space_3`, `r_sm`, `dur_fast`). An implementation MAY namespace them (`tokens.color.accent`); the leaf names do not change.

## 11.2 Portable design rules

These are the structural rules the worldsim design language settled on; values are its defaults and any theme may replace them, the structure stays.

- R11.5 Elevation is expressed by surface tint, line weight, and shadow together: five surface tints from deepest to most raised (`void`, `base`, `panel`, `panel_raised`, and `inset` for wells, inputs, and tracks, which sits below `panel`), three line alphas (hairline 0.10, edge 0.20, strong 0.36) in a cool tint rather than white, a drop shadow on raised surfaces, a coloured glow (accent at 0.45 alpha) on active or interactive elements, an inset shadow on wells. Large blurs are not used for elevation.
- R11.6 Two accents only: a warm one for interaction and warnings, a cool one for read-only data and information. Status colours alias them (`warn` is the warm accent, `info` is the cool one); `ok` and `crit` are the only additional hues.
- R11.7 Radii come from a short scale (0, 1, 2, 4, 8, 14, pill) and every structural surface uses the same small value (2 px in worldsim); a theme changes the mood by re-aliasing `radius_ui` and `radius_panel`, not by editing components.
- R11.8 Type has three roles, not three fonts: display (titles, values, control labels; uppercase with 0.08 em tracking for titles), body (13 px over 1.4 line height default), mono (numerics, kickers, keycaps, uppercase with 0.16 em tracking). `fontWeight` resolves through a theme table, not per component: `bold` on `body` resolves to the body bold face when one is loaded, else to the `display` role; a weight the theme does not have falls back to the nearest loaded one. Text drawn over a fill (a meter label) gets a 1 px dark text shadow.
- R11.9 Spacing uses the token scale only; component heights, insets, and gaps are derived from it (`control_h_sm`, `control_h_md`, `control_h_lg` default 26, 34, 46; 12 px horizontal inset inside fields and menus; 8 px inside badges and rows).

## 11.3 Variants and states

- R11.10 Cross-component variant vocabulary: `tone` (`accent`, `data`, `ok`, `warn`, `crit`, `auto`, `default`) and `size` (`sm`, `md`, `lg`). `size` sets height, padding, font size, and icon size together (13, 15, 18 px fonts and `icon_sm`, `icon_md`, `icon_lg` for the three sizes); a component MUST NOT derive its font size from its height. `tone: auto` bands a normalised value (below 0.25 critical, below 0.5 warning, else ok) for meters and badges.
- R11.11 Every interactive component carries a set of boolean state flags maintained by the framework, `hovered`, `pressed`, `focused`, `focusVisible`, `enabled`, plus the component's own `selected`, `open`, `active`, `dropActive`. States compose; there is no single winning state. The tree snapshot reports the set (chapter 13). The sibling engine's buttons reverted their fill on hover and worldsim's tab bar resolves one exclusive state (disabled, then active, then hover), so a hovered selected tab shows no hover treatment; both are symptoms of states being modelled as one exclusive value.
- R11.12 Style resolution layers the flags over the variant's base look in this fixed order:
  1. Base: the selected base when `selected` (the accent-glow wash with bright text, plus the component's own selection mark, a tab's 2 px underline, a segmented control's filled chip, a list row's 2 px left bar), else the normal base.
  2. Hover wash, when `hovered && enabled && !pressed` and the pointer type can hover: a white 4.5 percent wash, accents brightened to their bright variant with glow.
  3. Pressed treatment, when `pressed && enabled`: the pressed fill and a 1 px downward offset.
  4. `open`, `active`, and `dropActive` accents: the border lifts to the accent colour, the wash to `bg_active`.
  5. Disabled treatment, when `!enabled`: text becomes the disabled token, glows and washes are removed.
  6. Focus ring, whenever `focusVisible && enabled`: a 1 px accent outline at `focus_ring_offset` in the `outside` border position, independent of every other layer, so a keyboard user never loses the ring to a hover.
- R11.13 Transitions between states interpolate colour, glow, and offset through the animator (chapter 8, R8.28) over the motion tokens: `dur_fast` (120 ms) for hover colour and transform, `dur` (200 ms) for glow and scrim, `dur_slow` (360 ms) for meter fills and entrances, with the standard ease (0.4, 0, 0.2, 1) and the emphasised entrance ease (0.16, 1, 0.3, 1). A reduced-motion setting collapses every duration to zero. Worldsim's components snapped between states with hard-coded seconds (dialog and tooltip fades at 100 and 150 ms, toasts at 200 and 300 ms); the tokens exist so this can be uniform, and a port to them changes those timings by design.

## 11.4 Style objects on components

- R11.14 The authoring surface is a style object with exactly this closed set of CSS-named properties, each with a defined meaning on every component that accepts it: `backgroundColor`, `color`, `borderColor`, `borderWidth`, `borderRadius`, `opacity`, `fontSize`, `fontRole` (`display`, `body`, `mono`; the alias `fontFamily` maps `monospace` to `mono` and anything else to `body` with a development-build warning), `fontWeight`, `letterSpacing`, `textTransform`, `textAlign`, `textDecoration`, `padding` (a number or per side), `shadow` (an elevation token name or `{ color, blur, spread, offset }`), `cursor`. Any other key is a development-build error. Values are numbers in logical pixels, colour strings in the accepted forms, or token references. A component that accepts a property MUST render it; a component that does not accept one MUST reject it at construction, never ignore it. In a statically typed language, typed style structs carrying the same names (worldsim's `RectStyle`, `TextStyle`, `BorderStyle`) satisfy this rule; the closed set with rejection is the authoring surface of a dynamically typed one. The sibling engine parsed `borderRadius`, `opacity`, `fontFamily`, and `fontWeight` and ignored all four, and its button and input ignored the whole style object.
- R11.15 Resolution order for any drawn value: the variant base from tokens -> the per-instance style object (replaces the corresponding value of the `normal` and `selected` bases) -> the state layers of R11.12, which are defined relative to the base (a wash with alpha, an offset, a ring), so an override keeps hover, pressed, focus, and disabled feedback -> transitions. Per-state overrides are written `style: { hover: { ... }, pressed: { ... } }` and replace that state's overlay only. There is no inheritance between components except the propagated properties of chapter 8.
- R11.16 Style changes at runtime go through the same accessors as construction and trigger the same invalidation (chapter 8, R8.18): measurement-affecting properties invalidate layout, the rest invalidate render only.

## 11.5 Rationale

The pipeline exists so that colour cannot drift between a design prototype and the game, and so that a second game can adopt the structure with a different palette. Worldsim's experience: the generated token header worked, the parts that stayed hand-coded (durations, z values, per-widget style structs for five states) drifted or died. Composable state layers are how CSS works (`.selected:hover`, `:focus-visible` independent of both) and the only model that lets one table serve every component; an exclusive precedence cannot express a hovered selected row or a focused button under the pointer. The closed style property set is what keeps two implementations accepting the same authoring surface.

## 11.6 Required tests

- Generator round trip: every token in the file appears in the generated module with the same numeric value; CSS-only tokens are absent; the committed module equals the regenerated one.
- State resolution: a table of flag combinations for a button (`hovered`, `pressed`, `focused` with and without `focusVisible`, `enabled`, `selected`) produces the expected layered result; a focused button under the pointer keeps its ring; a hovered selected row shows both treatments.
- Override semantics: `backgroundColor` on a button replaces the normal fill and the hover wash still applies over it; a `hover` sub-object replaces only the hover layer.
- Transition: after a hover begins, the fill reaches the hover value at `dur_fast`; a hover that ends mid-transition reverses from the current value; with reduced motion it is immediate.
- Style object: each accepted property changes the recorded draw list; an unknown key throws in development builds; a property a component does not accept throws at construction.

## 11.7 Conformance checklist

| Item | Level |
|---|---|
| Single token file, committed generated module with a drift test, no hand-edited theme | required |
| Required token categories including `control` and `typography` weight table | required |
| Variant vocabulary (`tone`, `size`) and framework-maintained state flags | required |
| Layered state resolution in the R11.12 order, focus ring independent | required |
| Closed style property set, rejected rather than ignored | required |
| Override resolution order with per-state overrides | required |
| Token-driven transitions with reduced-motion collapse | required |
| Texture and density tokens | optional |
