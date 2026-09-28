# Component catalog, Wave A

Status: in progress, 2026-09-28, DDB-85 (DDB-55 phase 5). Chapter 12 of the [UI rendering spec](../ui-rendering-spec/12-component-catalog.md); styles through [style-states-and-variants.md](./style-states-and-variants.md); focus through [focus-manager.md](./focus-manager.md).

Wave A lands as sequential pull requests by component group:

1. Controls: `Pressable`, Button's remaining R12.7 options, ListRow, Checkbox, Toggle, RadioGroup, FocusGroup. This document covers it.
2. Containers: Container, Panel (R12.19), ScrollContainer with the standalone Scrollbar (R12.20, R12.37), closing DDB-32.
3. Leaves on the closed style set: Rectangle, Circle, Line, Text, Image, and the deletion of the legacy `Style` type (DDB-209).

The leaves go last, not first, because moving them onto the closed set rewrites style objects in roughly forty game files, which DDB-79 (game code onto the tree) is changing at the same time. Controls and containers are engine files plus new gallery scenes, so they can land without colliding with it.

## Decisions

**One press machine.** Button, ListRow, the checkables, and a radio item share `Pressable`: a primary press captures the pointer (R9.10) and sets `pressed`; while armed, `pressed` follows whether the pointer is over the control, so dragging off and back shows the press returning, as a native button does; the dispatcher's `click` is honoured only when the release landed on the control. Capture is what makes that last test necessary: R9.31 sends a captured pointer's click to the captor wherever it was released, so the control consumes a click whose release was outside, which also keeps a parent list from selecting on it. The drag threshold does not cancel these clicks, per the dispatcher's recorded departure from R9.31 (it applies only to presses that started a drag).

**Groups hear presses through `memberPressed`, not the bubble.** A control consumes `activate`, or Space on a focused checkbox would also reach a Space hotkey on the screen. So a focus group cannot learn about a keyboard press from the bubble; instead `Pressable` calls `memberPressed(member, event)` on its nearest focus-group ancestor after its own handling. `Component` has a no-op `memberPressed`; `FocusGroup` and `RadioGroup` override it. A click and an `activate` reach the group the same way.

**Enter versus Space.** R12.9 has a checkbox toggle on Space and not Enter, but `activate` is one event for both keys (R9.27). `UiActionEvent` now carries the `key` that produced a keyboard action (null for other sources), and `Pressable.acceptsActivation` lets the checkables refuse Enter, which then bubbles on unconsumed to a dialog's default action or a hotkey.

**Button keeps `tone`; `ghost` is a flag.** R12.7 lists `variant` values (`primary`, `secondary`, `ghost`, `danger`, `data`), while R11.10 makes `tone` the cross-component vocabulary and DDB-84 built Button on it. Four of the five map onto tones (`accent`, `default`, `crit`, `data`); ghost is a treatment rather than a colour, so it is `ghost: true` combined with any tone: clear at rest, no border, the label in the tone's colour, and the usual hover wash and glow, pressed wash and nudge, and focus ring. `block` is `widthMode: 'fill'`. `iconPosition: 'only'` keeps the label as the button's name (tree snapshot, tests) but hides it, and requires an icon.

**RadioGroup handles its own arrows.** The focus manager's group movement moves focus without selecting; ARIA radios move the selection with focus, wrap, and skip disabled items. The group consumes arrows, Home, and End from a focused radio, focuses the target by keyboard, and selects it. It stays a `focusGroup` so it is one Tab stop entered at the selection (`activeChild` follows `value`).

**FocusGroup's selection is the members' `selected` flags.** Single, multiple, or none. A press selects (multiple toggles), `onSelect` fires with the new selection only when it changed, and `activate` also fires `onActivate`. `select()` is the programmatic form and never fires. Type-ahead (optional in R12.34) is not implemented.

**Marks.** Checkbox, toggle track, and radio ring share `markLayers`: an inset well with a strong edge when off, the accent filled when on, hover washing the well or brightening the accent with its glow, disabled back to the well. The check and the indeterminate bar are icon-atlas glyphs (`check`, `remove`), per R12.6; the radio dot and toggle thumb are SDF circles. Sizes come from R11.10's `size`: the row is the control height, the mark the size's icon size, the toggle track twice that wide. The toggle's thumb slides over `dur_fast` through the animator, so reduced motion jumps it.

**Rows draw their ring inside.** List rows abut and live in scroll containers, so an outside ring would be covered by the next row or clipped. ListRow draws its own ring (`drawsOwnFocusRing`) as an inside border and reports no ink.

## Departures

- `cursor` (R12.7's `pointer` default) is still not accepted: there is no cursor service, as DDB-84 recorded.
- "No click after a drag-threshold move" (R12.7's test list) follows the dispatcher's departure: a wandering press that ends on the button clicks.
- Button's label is still the positional first argument (`new Button('Go', { ... })`); the named form comes with phase 6's accessor rename. The new controls take named options only.

## Gallery

`button-variants`, `lists`, `checkboxes`, `radio-group`, each built by `CatalogSection` (a title and captioned rows in one column stack). All four lint clean. The `icons` scene draws every glyph in the atlas, so it gains `check` and `remove`; that is the only existing golden that moves.
