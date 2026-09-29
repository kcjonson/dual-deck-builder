# Component catalog, Wave B

Status: in progress, 2026-09-28, DDB-86 (DDB-55 phase 5). Chapter 12 of the [UI rendering spec](../ui-rendering-spec/12-component-catalog.md), building on [component-catalog-wave-a.md](./component-catalog-wave-a.md).

Wave B lands as sequential pull requests by component group:

1. Text entry: TextInput (R12.10) replacing the old `Input`, and NumberInput (R12.36). This document covers it so far.
2. Menus: Menu (R12.11), Select (R12.12), DropdownButton (R12.13), ContextMenu (R12.14), on the popup and placement services; Menu's internal scrolling on DDB-85's ScrollContainer.
3. Slider (R12.15), TabBar (R12.16), SegmentedControl (R12.17).

## Text entry

**TextInput draws its own text.** The old `Input` built its value, placeholder, and caret from Text and Rectangle parts and never clipped them, so a long value drew past the field (the note DDB-68 left on DDB-86). TextInput draws the run, the placeholder, the selection wash, and the caret itself inside `pushClip` on the padded content box (R4.5), and places the caret and selection from `DrawApi.measureText`'s advances (R2.14), the same layout the run is drawn with. Scrolling is one number, `scrollX`, subtracted from the run's box. Parts would have needed a clipping container, a scroll offset on it, and a position per part kept in step with the text's measurement; the single draw is shorter and cannot drift from the caret. It also keeps TextInput off the Text component's legacy style keys (`whiteSpace`, `verticalAlign`), which DDB-85's leaves PR is replacing. The tree snapshot reports the value (masked for a password) as `value`, as it did for `Input`.

**Code points, not UTF-16 units.** The value is held as an array of code points, and the caret, selection, `maxLength`, and the validator all count in them, so an emoji or an accented letter pasted from elsewhere is one caret step and one character of the limit. The layout is measured once per change of the code points, the mask, the face, or the mount (a generation counter), so a drag's hit test is linear in the value and a visible field allocates nothing per frame.

**Keys.** Printable keys arrive as `keydown` with a one-code-point key (there is no separate `char` event in this dispatcher). The field consumes printable keys, arrows, Home, End, Backspace, Delete, and Enter (which fires `onSubmit` and keeps focus; `Input` blurred on Enter). It leaves Escape unconsumed so a dialog around it hears it, and Up and Down so a NumberInput can step on them; the dispatcher already keeps both from the hotkey tables (R9.15). Cmd or Ctrl with A, C, X, V are select-all, copy, cut, and paste; Cmd or Ctrl with Left and Right are Home and End (the macOS convention). Other chords pass to the hotkeys. A one-code-point key under Ctrl+Alt without Meta is text, not a chord: Windows reports AltGr as Ctrl+Alt, so `@`, `[`, `{`, `\`, and `€` on German, French, and Polish layouts arrive that way; the dispatcher's `ownedByTextField` and R15.39 (amended) agree. The dispatcher now claims Cmd/Ctrl+A from the browser while a text field is focused, since the browser's default selects the whole page; copy, cut, and paste are left to it, as before.

**Clipboard.** Copy and cut write through the mount context's clipboard service; paste reads through it, asynchronously, and lands when the read resolves if the field is still mounted and enabled. A refused read pastes nothing and a refused write is dropped, never an unhandled rejection. A paste drops C0 and C1 controls and DEL, then goes in one code point at a time while `maxLength` has room and the validator agrees, so pasting `3b4` into a digits-only field inserts `34`. A password field neither copies nor cuts.

**Validator.** `validator(next, inserted)` is asked before every edit with the value the edit would leave and the code point it inserts (`''` for a deletion). A typed character it refuses leaves the value and selection as they were; a deletion it refuses does not happen.

**Pointer and focus.** A press places the caret at the nearest boundary and captures the pointer, so a drag selects past the field's edge; Shift with a press extends from the anchor. The dispatcher focuses the field after the press handler (R9.23), so `selectAllOnFocus` selects everything even on a click-to-focus, and a drag that then leaves the pressed boundary replaces that selection with the dragged range, as a browser's address bar does.

**Blink.** The caret shows for `caret_blink` (500 ms, a new control token) and hides for as long, measured from the context clock since the last edit, caret move, or focus gain; the field asks for frames only while focused. The selection wash is a new colour token, `bg_selection` (the accent at 25 percent, worldsim's value).

**NumberInput composes a field and a stepper column.** It is not a TextInput subclass, because its `onChange` takes a number and TextInput's a string. Its parts are a TextInput (the focus target and the only Tab stop, with room reserved at its right end through the protected `reserveTrailing`) and a stepper column drawing `expand_less` and `expand_more` from the icon atlas, which a press on steps once and returns focus to the field without a ring (it calls `preventFocus` and focuses the field as a pointer would). Up and Down bubble from the field to the NumberInput; the wheel steps while the field is focused, through `canScroll` so a scroll container around it does not take the wheel first (R9.32). Typed text is committed on Enter and on blur: parsed, clamped, and rounded to `precision` (by default the step's decimal places); text that is not a number goes back to the value's text. A step from typed text steps from what was typed and fires `onChange` once. The field's validator accepts only what could become a number: a sign only when `min` is negative, a point only when `precision` allows one.

## Departures

- R12.10's "`char`" is the `keydown` of a one-code-point key: the dispatcher has no separate `char` event, and the key names the platform reports for printable keys are the characters.
- Enter no longer blurs the field, which `Input` did; R12.10 has Enter fire `onSubmit` only.
- IME composition is unsupported, as R12.10 and R15.39 allow for the baseline: the browser's composition `keydown` (`Process`) is neither consumed nor inserted, and composed text goes nowhere. Follow-up DDB-220 under DDB-55 (a hidden text element carrying composition, per R15.39's note).
- Stepper buttons do not auto-repeat while held. R12.36 does not ask for it.

## Gallery

`input-showcase` keeps its name and its "Input Fields" title (the developer screen's golden holds that scene's top 32 pixels), rebuilt as a catalog section: empty with a placeholder, filled, password, disabled; an overflowing value scrolled to its caret and clipped; the three sizes and an instance style; and number inputs at an integer, a quarter step, their maximum (the up chevron greyed), and disabled. The `clipping` scene's overflowing-field item is now the real TextInput, laid inside the fixture layer it is part of. The icon atlas gained `expand_more` and `expand_less` (Select's caret uses the first in the next PR); `remove`'s atlas cell moved, the other seven stayed put.
