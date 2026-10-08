# Scrolling what a component draws into view

Date: 2026-10-07. Task: DDB-406 (DDB-256). Spec: R4.8, R8.8, R9.9, R9.23, R11.12, R12.20, R12.22. Builds on [panel-and-scroll-container.md](./panel-and-scroll-container.md), [focus-manager.md](./focus-manager.md), [subtree-ink-cull.md](./subtree-ink-cull.md), and [mini-card.md](./mini-card.md).

## Context

The focus manager asked every ancestor of a component focused by keyboard or code to `scrollIntoView` it, and `ScrollContainer` brought the component's content box inside its clip, moving the least. Going down, that put the box's bottom on the clip's bottom and cut whatever the component draws below its box: the focus ring's bottom 3 px (on a card face in the pile dialog, and on driver selection's old 50x70 minis at 800x450), and a stacked mini's edges and count (DDB-311), up to 7 px. Going up, it put the box's top on the clip's top and cut what's drawn above: a card face's cost hex, 9 px, with the ring's top edge, or a mini's hex and state tag, 7 px. A margin round the content protects only scroll 0 and the end of the range; every position in between is the reveal's to get right.

What a reveal shows has to be what is drawn, and no more: a bound that over-counts moves the view as surely as one that under-counts cuts it. The bound the subtree cull and the ink audit use, `ownInkBound`, is a maximum over every state plus the walk's ring for any focusable, so it counts a ring a list row draws inside its box, a button's hover glow, and a ring the pointer modality never draws. A reveal also has to hold where the geometry is awkward: a box exactly as tall as the clip in a fractional layout, the same reveal asked twice, ink it can't measure, a reveal at the end of the range while the scroller is following its end, an inner scroller's clip hiding part of what is drawn, and a dialog that moves focus in before it has a size.

## Decision

What a reveal shows is what the component draws in its current state. `Component.revealInk` is the union of `restingInk` and, while the render walk draws it, the walk's focus ring (`focusVisible`, enabled, and not `drawsOwnFocusRing`, the walk's own test). `restingInk` is the one hook: protected, `cullInk` by default, which is right for ink a component draws in every state (a border, a shadow, a card's cost hex, a mini's stack edges, count, and tag). Controls whose `inkExtent` covers more than they draw override it with what they draw with the pointer away:

- Button, Select, and TextInput answer `restingInkExtent` from their look layers: layer 6's ring outside the box while focus shows, and the base's own shadow. Never a glow or a press nudge.
- Checkbox, Toggle, and Radio answer the same from the mark's layers; the walk adds the ring round the row.
- A segment of a segmented control draws its ring inside its box and answers its box; its selected chip's glow is left out as a look's glow is.
- List rows, tabs, and the tree view draw their ring inside and have no ink, so the default already answers their box.

The union never adds one ring to another: a card's 7 or 9 px of static ink already holds the 3 px ring it draws itself. A component with no bound (an unmeasured `Text`, a draw fixture) reveals its box.

The reveal is computed once and handed up the chain. `revealInAncestors` in `components/reveal.ts` carries the box and `revealInk` up a level at a time through each transform, origin, and content offset, asks each ancestor to `scrollRectIntoView` them in its content space, and cuts both to each clip it passes. An outer scroller never scrolls for ink an inner clip hides, and once a clip has cut the box away the walk stops, since nothing further up can bring it back. A promoted layer ends the walk, as no clip above it applies. `scrollRectIntoView` is a no-op on `Component` and the entry point on `ScrollContainer`, for anything that knows a rect in a scroller's content (a menu's rows, DDB-408); `ScrollContainer.scrollIntoView(descendant)` runs the same walk with that one container scrolling.

`revealDelta` is the rule along the scroll axis, and R12.20 states it:

- While the ink fits the clip, `nearest` moves the least that shows all of it, and nothing at all when it shows already, compared rather than subtracted; `center` centres the box, then moves the least that keeps the ink in view, which is the old behaviour exactly when nothing extra is drawn.
- When only the box fits, either block keeps the box whole and splits the room it leaves between the ink above and below, half each unless a side needs less, so a ring all round shows on both sides before a one-sided count takes the room.
- When the box is taller than the clip, `nearest` puts its top at the clip's top, under the ink above it unless that ink would push the top out of view, and `center` centres the box.

The last two depend only on where the component is, never on which side it came from, so focus moving back and forth over something too tall never swings the view. Sizes and positions are compared to a millionth of a pixel, so rounding in fractional layouts neither misclassifies a box exactly as tall as the clip nor moves a settled view; a non-finite input answers 0. `ScrollContainer` clamps the target to its range and scrolls only when that changes the position, so a reveal against the end of the range doesn't cancel a pending `scrollToBottom`.

The focus manager reveals after delivering the `focus` event, so ink a focus handler adds is revealed too (a vehicle offered as a target grows from its dashed outline to its target glow when focused), and not at all when the handler moved focus on. A component focused while a layout is due is revealed again once that layout has run, from the focus manager's after-layout fixup: a dialog moves focus into its content before its first layout, when nothing in the scroller has a size yet.

A tooltip that keyboard focus opened stays on its owner when hover changes only because content moved under a still pointer (R9.9's re-derivation); the dispatcher tells hover observers whether the pointer moved, and only the pointer moving onto another owner takes the tooltip over (R12.22). Without that, a reveal that slid a card under a resting pointer moved the pile dialog's detail view off the focused card.

## Options considered

- The content box, as before: cuts what's drawn past it on the side the reveal stops at.
- `ownInkBound`, the cull and audit bound: a cull can over-bound, but a reveal that does moves the view for ink nothing draws, a row's ring inside its box, a button's hover glow, a ring under the pointer modality.
- `subtreeInk`: covers children drawing past the component, but is null under any layer and isn't cut by the component's own clip, so a focused nested scroller's bound is its whole content. Children past their parent's box are the lint's to catch (R13.25.2).
- A new per-state bound on every component: most components' cull ink is already what they draw, or follows their state as a vehicle's does, so one protected hook with that default, overridden by the controls whose ink bound covers states they aren't in, is the smallest change that does it.
- For ink taller than the clip: `nearest` on the ink, clamped to keep the box, cuts the far side's ring; following the direction focus moved needs the direction, and the obvious versions swing back on the next call; centring the ink cuts a short side's ring when the ink is lopsided.
- For a box taller than the clip: CSS's near edge would show a card reached from below by its foot. Cards and text read from the top.
- For the dialog: moving focus in only after the dialog's first layout fixes dialogs alone; the after-layout reveal covers anything that focuses before it has a size, a screen's first focus included.

## Consequences

- A card's static ink is its `inkExtent` on every side, so a face reveals 9 px below its box where it draws at most the ring's 3 px, and a mini without a stack reveals 7 px where it draws at most 3. A per-side `restingInk` on `Card` would tighten that.
- What scrolls into view can still be cut where the range ends: content whose last row draws past the end of the content needs a margin or padding for it, as driver selection's grid has. The pile dialog's last row is one such case, and a scroller's clip reaches into its padding only by its direct children's ink, filed separately.
- Only y is revealed. The pile dialog's first column draws its hex past the scroller's left edge, a layout gap (DDB-407, DDB-409).
- `InputObserver.hoverChange` takes a second argument, `pointerMoved`.
- A reveal aims at the logical clip, and the draw API snaps the clip it pushes to device pixels, so at a fractional position up to a fraction of a pixel of what was revealed can sit outside it: 0.13 px at driver selection's deck preview, which doesn't show.
- No golden or lint result moves: no scene or screen in them focuses inside a scroller by keyboard, and a programmatic first focus revealed again after its layout lands on content already in view.
