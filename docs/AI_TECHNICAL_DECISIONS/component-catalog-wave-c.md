# Component catalog, Wave C

Status: in progress, 2026-09-28, DDB-87 (DDB-55 phase 5). Chapter 12 of the [UI rendering spec](../ui-rendering-spec/12-component-catalog.md); built on [overlay-and-popup-services.md](./overlay-and-popup-services.md), [focus-manager.md](./focus-manager.md), [clock-and-animator.md](./clock-and-animator.md), and [component-catalog-wave-a.md](./component-catalog-wave-a.md).

Wave C lands as sequential pull requests by group:

1. Overlays: Dialog (R12.21), Popover (R12.33), the Tooltip surface (R12.22), Toast and ToastStack (R12.23), and KeyCap (R12.29), which the tooltip's key hint uses.
2. Display: ProgressBar, Counter, Badge, Avatar, Stat, Divider (R12.24 to R12.29, R12.39).
3. TreeView (R12.25) and ScreenTransition (R12.38), the second for ScreenManager to adopt in DDB-90.

## Decisions

**The dialog is its own scrim.** A modal overlay needs a full-viewport surface that takes presses, and the panel on top of it. Two siblings (a scrim and a panel) would overlap by construction and fail the lint's rule 1, so the dialog component is the viewport-sized box: it draws the scrim in its own `render`, and the panel is its part, centred by R10.15's anchor. The overlay service gained a `fill` option that sizes the content to the viewport at open and on every `resize`, which is what makes that work (a root's children are not sized by the root). The panel is the service's `inside`, so a press on the scrim is outside: it closes the dialog only with `dismissOnOutsidePress`, and the modal consumes it either way (R12.21).

**First-frame blocking comes from the colour, not the opacity.** R3.27 skips a subtree at opacity 0, hits included, so a scrim faded in through `opacity` would let the first frame's press through to the scene. The scrim's fade is its colour's alpha; the dialog component stays at opacity 1 and takes every press from the frame it opens (R3.29). The panel fades through `opacity` with the emphasised entrance (scale 0.96, 8 px rise) in its `transform`.

**`show`, not `open`.** R12.21 names the method `open()`, but `open` is R11.11's state flag on every component. `Dialog.show(context)` opens it (and sets the `open` flag while it is anything but closed); `close()` runs the fade. The same goes for `Popover.show`. The context is passed in because a dialog is not mounted before it opens: whatever opens it (a screen, a button handler) has one.

**Escape only when fully open.** The overlay service hands Escape and outside presses to the dialog's `onDismiss`; the dialog ignores Escape unless its state is `open`, and treats an outside press as `close()`, which is legal while opening. A modal consumes Escape even when it ignores it, so nothing beneath hears it.

**Initial focus.** The modal's focus scope focuses the first focusable in the root, which is the header's X. The dialog then moves focus to `initialFocus`, or the first focusable in the content, or in the footer, falling back to the X: an X focused by default is one Enter away from dismissing whatever the dialog asked.

**Popover takes no scope.** R12.33: it never takes focus unless it has focusables, and then pushes no scope. `show` focuses its first focusable, if any; Tab leaves it like any other part of the screen. Outside presses dismiss and are never consumed, so one click closes an inspector and lands on the next card. It fades in over `dur_fast` and closes at once.

**The catalog Tooltip replaces TooltipSurface.** `createMountContext` passes `surface: (spec) => new Tooltip({ spec })` to the tooltip service, whose `surface` option is now required, and `TooltipSurface` is deleted. The service lays any surface out as soon as it is mounted (`layoutSubtree`) rather than calling a special `fit()`, so a text surface and a factory tree are sized the same way before placement. The Tooltip is a column stack: the title and a KeyCap for the hotkey on one row, the description below. A hugging stack measures itself unconstrained and then clamps to `maxSize`, so the description carries its own `maxSize` width, which is what makes it wrap inside `maxWidth`.

**Toast order is visual order plus `zIndex`.** R12.23 wants paint oldest first and input newest first, and the newest toast nearest the corner. The stack is a column stack whose children are in visual order (newest first from a top corner, last from a bottom one), and each toast's `zIndex` is its age, so paint and hit order follow age whichever corner the stack sits in. The stack hugs its toasts, so its bounds are their envelope; it is placed by R10.15's anchor in its overlay root, which re-anchors on a viewport change with no code here, and it is invisible while empty. A dismissed toast keeps its slot while it fades (`dur_slow`) and the rest close up when it leaves.

**The auto-dismiss countdown is `update(dt)`, not a tween.** Like the tooltip delay, it is a wait, not an animation: reduced motion must not collapse it, and the harness's `settleAnimations` must not run it out. It counts in `update` while the toast is `visible` and not `hovered`, so a paused page keeps its toasts and a golden holds them.

**`LabelledLeaf`.** KeyCap (and Badge in the display PR) is a box around one measured label that hugs it; the shared base does R10.5's measure, the self-sizing outside a stack, and re-placing the label on resize. The label hugs its own width so its measure on mount invalidates the leaf.

**Display components hug their measured text and animate on the animator.** ProgressBar's fill and Counter's number move over `dur_slow` as tweens, so reduced motion and the harness's settle land them at once, and a value set while unmounted is shown directly. ProgressBar's `tone: 'auto'` bands by the target value through `toneColor`, a new helper in `style/variants.ts` that gives every tone its own colour for marks that are not controls (meter fills, badges, stat values). Badge refuses `auto`, as Button does, since it has no value to band.

**Stat's unit sits on the value's baseline from the measured runs.** `TextMetrics` gained `baseline` (half the leading plus the face's ascent, the first baseline below the top of the line box), which `TextMetricsService.metricsOf` fills from the layout it already has. Two runs of one role at different sizes then align exactly: `unit.y = value.y + value.baseline - unit.baseline`. The alternative, bottom-aligning two boxes, is off by the difference in descent.

**Text gained `shadow` (R12.4).** An inline meter draws its label and value over the fill with the `text_shadow` elevation; `Text.shadow` passes it through to `drawText`, which already draws the shadow run (R3.17).

**Avatar's rings are ink.** The mood ring and the selection ring are drawn outside the disc and reported as `inkExtent`, so avatars of one `size` line up by their discs whatever rings they carry. The hue is FNV-1a over the seed's UTF-16 code units modulo 360 at fixed saturation and lightness, so it is the same on every machine; `selected` is R11.11's flag.

**Divider hugs across and fills along.** Horizontal by default: `fill` width in a stack, and a height that is the caption's line (or the hairline without one); vertical fills the height and refuses a caption.

## Departures

- `Dialog.show` and `Popover.show` rather than R12.21's `open()` (above).
- R12.21's ported worldsim suite (18 cases) is not available here; `ui/Dialog.test.ts` covers the same ground in 21 cases of its own: lifecycle, the `open()`/`close()` guards, dismissal defaults modal and not, first-frame blocking, focus trapping and restore, and hotkeys beneath a modal.
- A dialog whose content is taller than the viewport is clipped, not scrolled: put a ScrollContainer (#105) in the content.
- The Dialog draws its own panel rather than composing R12.19's Panel, which is being rewritten in #105 concurrently; once that lands the header can be shared.

## Gallery

Display components are developer-screen sections, so they are scenes too: `meters` (ProgressBar and Counter) and `data-display` (Badge, Avatar, Stat, KeyCap, Divider). The overlay components have gallery-only scenes, since each opens overlay roots over its host: `dialog` (the modal open over its trigger), `popover` (a stat breakdown open against its button, and a row of key caps), `toasts` (one of each severity in the top-right stack). The `overlays` scene's tooltip is now the catalog Tooltip with a KeyCap, so its golden moves. The icon atlas gained `close`, `info`, `warning`, `error`, `chevron_right`, and `expand_more` (the last two for TreeView), so the `icons` scene moves.
