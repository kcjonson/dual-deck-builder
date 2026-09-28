# State flags, layered style resolution, and the closed style set

Status: decided 2026-09-28 with DDB-84 (phase 4 of DDB-55). Rules R11.10 to R11.16 in [chapter 11](../ui-rendering-spec/11-style-and-theme.md); tokens from [theme-tokens.md](./theme-tokens.md); transitions run on the animator from [clock-and-animator.md](./clock-and-animator.md); `hovered` and focus come from the dispatcher in [input-dispatcher.md](./input-dispatcher.md).

## What exists

- `engine/style/look.ts`: `StateFlags` (R11.11's nine flags), `Look` (what a control draws with), `LookLayers` (a variant's bases and overlays), and `resolveLook(layers, flags)`, the pure R11.12 resolver.
- `engine/style/styleObject.ts`: the closed property set, `validateStyle`, and the value readers (colour token or CSS colour, length number or token, padding, letter spacing, shadow token or value, the `fontFamily` alias).
- `engine/style/variants.ts`: R11.10's `tone` and `size`, `CONTROL_SIZES`, `autoTone`, and the two layer builders, `buttonLayers(tone, style)` and `fieldLayers(style)`.
- `engine/style/LookTransition.ts`: R11.13's transitions over the mount context's animator.
- `Component` carries every flag: `hovered` and `focused` as before, plus `pressed`, `focusVisible`, `selected`, `open`, `active`, `dropActive` as ES6 accessors, and `stateFlags` for the set (with the effective `enabled`). Any change calls `onStateChange()`; an `enabled` change reaches every descendant, since the effective value is inherited. Unmount clears the framework's four without callbacks.
- `Button` and `Input` build their look from these and draw their own box, glow, and focus ring. Their label, icon, value, placeholder, and caret stay parts and follow the look through `LookTransition`'s `onChange`.
- One new token, `color.bg_pressed` (black at 0.16): R11.12 says the pressed layer is "the pressed fill" but also that layers are relative to the base, and a wash is the only pressed fill that stays relative when a caller overrides `backgroundColor`.

## Decisions

**Resolution is a pure function over a layer table.** A variant builds `{ normal, selected, hover, pressed, active, disabled, focusRing }` once per tone and style; each state change resolves the table against the flags. Overlays are relative (a wash composited over the fill) or replacing (a fill, border, or text colour), so R11.15's "an override keeps hover, pressed, focus, and disabled feedback" falls out: the instance style replaces the base's values and the overlays sit on top. The table test in `look.test.ts` is 11.6's state-resolution table.

**Where a tone decides an overlay.** Hover on a filled tone is the tone's bright fill with its glow (R11.12 layer 2). When the caller has overridden `backgroundColor`, the builder uses the white wash plus glow instead, otherwise a hovered override would snap back to the tone's colour. Tones without a bright token (`ok`, `crit`) always get the wash. This is the variant builder's choice, not the resolver's, so the resolver stays generic.

**Disabled filled tones drop to the neutral surface.** Layer 5 as written only changes the text and removes washes and glows, which leaves a disabled accent button bright yellow with grey text, reading as enabled. The battle screen mock's waiting End Turn is the neutral surface with muted text, so a filled tone's disabled overlay is `bg_panel_raised` fill, `line_edge` border, `text_dim` text. That text is a departure from R11.12 layer 5, which names the disabled token: `text_disabled` on the raised surface is about 1.6:1 and the label all but disappears (START RUN opens disabled), where `text_dim` is about 4.5:1 and is the mock's `--muted`. The box, the edge line, and the lost glow still read as disabled. It is the variant's default disabled overlay, which a `disabled` sub-object replaces, so it stays inside R11.15. The neutral tone and overridden fills keep `text_disabled` as the spec says.

**Layer 4 when disabled keeps only the border lift.** "Glows and washes are removed" is read as applying to layer 4's `bg_active` wash too.

**Focus ring is its own draw, outside, and never animated.** A second rect inflated by `focus_ring_offset`, border `outside`, width `focus_ring_width`, accent. It switches at once: the ring is independent of every other layer, so it should not lag a colour tween. Button and Input answer `drawsOwnFocusRing` true, so the generic ring DDB-76's render walk draws for other focusables skips them; the focus manager only has to set `focusVisible`.

**Ink extent covers everything outside the box (R8.8).** `layersInkExtent` is the largest of the ring's outset (`focus_ring_offset + focus_ring_width`), the accent glow when any state layer can raise one, and the style's own shadow, using the draw API's `shadowInk` bound (spread plus 1.5 blur plus offset), all plus the pressed nudge. It is a maximum over states, not the current look, so a clip sized from it never cuts a hover glow or a ring that appears later. The snapshot's `inkBounds` follows.

**Transitions: two tweens per control.** One packs fill, border, text, and the pressed offset over `dur_fast`; the other is the glow over `dur`. The animator's `retarget` gives the reversal from the current value and reduced motion's collapse. Unmounted there is no animator and the look snaps; mount and unmount snap to the current state. Width, radius, and the style's own shadow switch at once, since they are not state layers.

**Closed set, rejected rather than ignored.** `validateStyle` runs at construction and in the `style` setter. A key outside the set throws in development builds and is skipped in production (R11.14 calls it a development-build error); a key in the set that the component does not render throws in every build, since ignoring it is exactly what the rule forbids. State sub-objects are accepted per component and carry colours only (`backgroundColor`, `color`, `borderColor`), because the state layers are colour and offset overlays; `borderWidth` in `hover` throws rather than silently doing nothing.

Values: colours are a colour token name, `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `transparent`, or floats; an unrecognised string throws, where the old `StyleParser` quietly drew white. Lengths are numbers or a token from the property's category (`borderRadius: 'r_pill'`, `fontSize: 'fs_xl'`, `padding: 'space_4'`). `px` strings are no longer accepted on Button and Input.

**Label font is the display role.** R11.8 lists control labels under display. Every button label moves from 16 px Open Sans to Barlow Condensed at the size's `control_fs_*` (15 px for `md`), which is most of the pixel change in this PR.

**Button icons follow `size`, not the label.** R11.10: `icon_sm`, `icon_md`, `icon_lg`. The old icon was 1.25 times the label size.

**Input's editing state is its own `active` flag.** A field focused by the pointer has no focus-visible ring (that is the keyboard's), but it has to show it is taking keys. `onFocus` sets `active` and layer 4 lifts the border to the accent; `onBlur` clears it. Unmount drops focus without `onBlur` (R9.21), so `onUnmount` clears `active` and hides the caret too.

**`pressed` is a Component flag the Button sets.** The dispatcher maintains `hovered` and focus; pressing is still local to the button's `handleEvent` (down on it sets it, up, cancel, or leave clears it). The flag lives on the base with a public setter, so the dispatcher, which already tracks presses, can own it later without touching the style code. A press also ends when the component becomes effectively disabled, including through an ancestor: the release will not reach it (R9.5), so the base clears it while notifying the enabled change.

**Runtime restyle is construction's path.** A new style object that drops `opacity` puts the style's opacity back to 1 (opacity given as a component option is left alone). `size` sets the height as well until the caller sizes the control (a `height` option or `setSize`), after which the height is theirs.

## Departures

- `cursor` is in the closed set but neither Button nor Input accepts it: nothing renders a cursor yet, so by R11.14 a style naming it throws. It becomes accepted when a cursor service exists.
- `Input` rejects `textAlign`, `textTransform`, and `textDecoration`; a single-line field's value is left-aligned and plain.
- Inset elevation presets (`shadow_inset`) throw as a `shadow` value; the draw API has no inset box shadow.
- The rest of the engine (Rectangle, Text, Panel, Circle, and the game components) still takes the legacy `Style` type. Moving them onto the closed set, and deleting `border`, `verticalAlign`, `whiteSpace`, `display`, `visibility`, `transform`, and `zIndex` from it, is the phase 5 catalog's work, component by component.

## What moved on screen

Every Button and Input: tokens instead of the old blue and grey literals, display-role labels at the size's font, 1 px `line_edge` borders at `radius_ui`, the new focus ring and glow. START RUN is `tone: 'accent', size: 'lg'`. END TURN follows the mock's `.endturn .btn` through a style object on the default tone: a bone face (`text`) with dark text (`accent_contrast`), `r_md`, a 21 px display label tracked 0.1 em, white with an accent edge on hover, and the neutral surface with `text_dim` when disabled; the bar gives it 150 px. What it does not have yet: the mock's 3 px warn ring on hover (a state override carries colours only, so the 1 px border takes the accent), its hard 3 px drop edge (`#7a7568` is not a token), the SPACE key hint, and the 64 px box, which belongs to the dock the combat screen gets in phase 6; the green and grey `setFillColor` calls are gone, and `setFillColor`, `setBorderColor`, `setBorderWidth`, `setCornerRadius`, and `setFontSize` are gone from both widgets in favour of `style`, `tone`, and `size`. Continue on the battle result is accent; the card showcase's back button lost its grey override. The developer button scene shows the tones, a token-radius and a transparent override, the three sizes, and a row with disabled, selected, active, and focus-visible. The focus-visible button is focused through the dispatcher on mount (so it is the one focused component and a press elsewhere takes the ring away) and its `focusVisible` flag is set as the focus manager will set it.
