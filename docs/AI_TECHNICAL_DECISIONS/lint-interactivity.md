# What the lint counts as interactive

DDB-208. Normative: R13.22, R13.25.2, R13.25.3, R13.25.6, R13.25.7, R8.29, R3.8, R12.20. Amends
R13.22 and R13.25 in chapter 13.

Every count here was measured once, on `main` after DDB-78 (#97) and DDB-79 (#99) merged: saved
`__ui.tree()` documents of all fourteen gallery scenes and the six capturable screens, run through
`main`'s lint and this one in `node`.

## Context

Rules 6 (`unreachable-interactive`) and 7 (`target-size`) sat dormant from phase 0 because the
snapshot emitted neither `focusable` nor `pointerEvents`. Both became backed (DDB-73, DDB-76) and
were still withheld, because R13.25.6 as written counts a node as interactive when it is focusable
or its `pointerEvents` is `auto` or `unit`, and R8.29 makes `auto` the default for every leaf.
Emitting the fields under that reading takes the gallery from 0 to 146 (stack 45, icons 36, the
component paint-order scene 29, overlays 11, style guide 8, text 7, input showcase 7, interactive
controls 2, buttons 1) and the screens up by 1,229. None of the gallery's findings is a control:
labels, icons and swatches that take hits because every leaf does.

## Options considered

1. **Interactive means focusable.** Cheap and exact for what it covers, but a card, a vehicle, or a
   swatch with an onClick that is not a Tab stop drops out of both rules, and those are the
   "button under the deck preview" class the rule exists for.
2. **Interactive means answers the pointer.** Needs the tree to say which components handle
   pointer input, which `pointerEvents` does not: it says whether a box takes hits, not whether
   anything listens.
3. **Amend R13.25.6 and keep the literal reading elsewhere.** Only moves the question.

## Decision

Option 2 with focusable kept, and the spec amended to say so.

- `Component.handlesPointer`: true when a press, click, hover, or drop-target callback is set
  (`onPointerDown`, `onPointerUp`, `onPointerMove`, `onPointerEnter`, `onPointerLeave`, `onClick`,
  `onContextMenu`, `onDragEnter`, `onDragOver`, `onDrop`). `Button`, `Card` and `Vehicle` override it
  to true, because they act on the pointer in their own `handleEvent` whether or not a caller set a
  callback. Wheel and key callbacks are left out: a scroller is not a target, and keyboard reach is
  `focusable`'s question.
- The snapshot emits `focusable`, `pointerEvents` (the component's own value) and `handlesPointer`
  on every node.
- Interactive is `focusable`, or `handlesPointer` with a `pointerEvents` that makes the node's own
  box a target (`auto`, `unit`, or undeclared). A `passthrough` container with an onClick hears its
  children's bubbled clicks but its box is never hit, so it is not a target.
- A document that carries neither `focusable` nor `handlesPointer` leaves the rules skipped and
  reports `missingInput: ['focusable', 'handlesPointer']`, rather than falling back to the literal
  reading.

## Scrolled away is not unreachable, and not off screen

A control a scroll container has scrolled out of its box is reachable by the wheel, and focus
scrolls it in (R12.20); the same content is not "outside the viewport" in any sense a player would
recognise. Rules 3 and 6 both let it off, and both need to know which nodes scroll.

- **The signal is `scroll`, emitted only by a scroll container**: `{ x, y, maxX, maxY }`, the offset
  and the furthest it goes (`Panel.scrollRange`, which `scroll` and `canScroll` now both clamp to).
  The first draft keyed on `contentOffset`, which a padded Panel that never scrolls also reports
  (its inset), so every control under a `DeveloperSectionPanel` was let off the clip half. A
  snapshot-to-lint test pins the fix: a padded non-scrolling panel's hidden button is reported.
- **Reachable** means some offset in the range shows the node in the scroller's window: the
  scroller's box within the viewport and its own clip. A scroller that is itself clipped away counts
  only if its own scroller can bring it in; one an outer, non-scrolling clip hides lets nothing off.
- **Rule 6** asks for any overlap with the window. **Rule 3** asks for the whole node, or, on a
  scrolling axis it is longer than the window on, a position where it spans the window (a tall
  section in a scrolled page). An axis with no range gets no allowance, so content too wide for a
  vertical scroller is still reported.
- **Raised content** leaves every clip behind (R3.8) but moves with every scroller around it, so it
  is judged against the viewport and any of those scrollers.
- The document says only that some ancestor clipped a node, so a control under a scroller that an
  inner, non-scrolling clip hides is let off rule 6's clip half too. Stated in the code; the cover
  half still runs on it.

## The other two calls

- **Rule 6 compares parts and children together for cover.** DDB-104 kept a composite's parts out
  of rule 1's pairing because R3.18 prescribes how parts overlap each other; rule 6 inherited the
  split by accident. Cover is a paint and hit question, and a part painted over a control takes
  its clicks, so rule 6 gets the owner's parts and children in submission order. Rule 1 is
  unchanged.
- **Rule 2 exempts a raised child only while it touches its parent.** Found by DDB-205's component
  fixture: an open menu declared at its select (R13.31's "open popup") hangs past the select by
  design, since a raise resets the inherited clip (R3.8), and R13.25.1 already reads a differing
  layer as declared intent. An anchored menu always touches or overlaps its anchor, so the
  exemption stops there: a raised child clear of its parent is the popup built in the wrong
  coordinate space, which nothing else in the lint would report. The fixture's menus hang flush
  from their selects for this reason.

## Result

| | main | fields emitted, main's lint | this lint |
|---|---|---|---|
| gallery (14 scenes) | 0 | 146 | 0, rules 6 and 7 evaluating |
| screens (6) | 1,722 | 2,951 | 1,190 |

Per screen, `main` to this lint: developer 323 to 14 (every `outside-viewport` was a scrolled
section), card showcase 1,020 to 797, combat 282, driver selection 88, main menu 6, splash 3,
unchanged. Rules 6 and 7 find nothing on any screen but the card showcase.

The card showcase's remaining 45 `outside-viewport` and 4 `unreachable-interactive` are real: the
screen sets its content size from an estimate, its scroll range stops at 1,428 px, and the cards
below that can never be scrolled into view (DDB-216).

Rules 6 and 7 evaluate 12, 2, 3, 3, 4 and 1 nodes on the buttons, icons, input showcase,
interactive controls, overlays and nested panels scenes, zero on scenes with no controls.

## What is still open

- `handlesPointer` is a declaration. A widget that acts on the pointer in `handleEvent` and does not
  override it reads as a label. Today that is `Button`, `Card` and `Vehicle`, and all three
  override; a new one needs to.
- Hover callbacks count. A tooltip trigger is a pointer target and gets the target-size check,
  which matches WCAG 2.5.8's reading of a target.
- `scroll` is a Panel's today. DDB-85's scroll container should emit the same field.
