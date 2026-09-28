# What the lint counts as interactive

DDB-208. Normative: R13.22, R13.25.2, R13.25.6, R13.25.7, R8.29, R3.8, R12.20. Amends R13.22 and
R13.25 in chapter 13.

## Context

Rules 6 (`unreachable-interactive`) and 7 (`target-size`) sat dormant from phase 0 because the
snapshot emitted neither `focusable` nor `pointerEvents`. Both became backed (DDB-73, DDB-76) and
were still withheld, because R13.25.6 as written counts a node as interactive when it is focusable
or its `pointerEvents` is `auto` or `unit`, and R8.29 makes `auto` the default for every leaf.
Emitting the fields under that reading, measured on today's trees with the same captures run
through `main`'s lint:

| | main | fields emitted, main's lint |
|---|---|---|
| gallery (13 scenes) | 0 | 106 (stack 45, icons 36, style guide 8, text 7, input showcase 7, interactive controls 2, buttons 1) |
| screens (6) | 1,818 | 2,882 |

None of the gallery's 106 was a control: labels, icons and swatches that take hits because every
leaf does.

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
  `focusable`'s question. `Panel` handles the wheel in `handleEvent` and is not overridden for that
  reason.
- The snapshot emits `focusable`, `pointerEvents` (the component's own value) and `handlesPointer`
  on every node.
- Interactive is `focusable`, or `handlesPointer` with a `pointerEvents` that makes the node's own
  box a target (`auto`, `unit`, or undeclared). A `passthrough` container with an onClick hears its
  children's bubbled clicks but its box is never hit, so it is not a target.
- A document that carries neither `focusable` nor `handlesPointer` leaves the rules skipped and
  reports `missingInput: ['focusable', 'handlesPointer']`, rather than falling back to the literal
  reading.

Three narrower calls the change forced, each with a test:

- **Rule 6 compares parts and children together for cover.** DDB-104 kept a composite's parts out
  of rule 1's pairing because R3.18 prescribes how parts overlap each other; rule 6 inherited the
  split by accident. Cover is a paint and hit question, and a part painted over a control takes
  its clicks, so rule 6 gets the owner's parts and children in submission order. Rule 1 is
  unchanged.
- **Rule 6's clip half exempts content a scroll container scrolled away.** A control outside a
  scroller's clip is reachable by the wheel, and focus scrolls it in (R12.20). Without this the
  card showcase and developer screens gained 48 findings that were all scrolled rows. The document
  says only that some ancestor clipped the node, so a control under a scroller hidden by an inner,
  non-scrolling clip is let off too; stated in the code. The cover half still runs.
- **Rule 2 exempts a child raised into another layer.** Found by DDB-205's component fixture: an
  open menu declared at its select (R13.31's "open popup") hangs past the select by design, since a
  raise resets the inherited clip (R3.8). R13.25.1 already reads a differing layer as declared
  intent for rule 1; rule 2 now reads it the same way.

## Result

Same captures, `main`'s lint against this lint (`node` over saved `__ui.tree()` documents, all
fourteen scenes and the six capturable screens, after merging DDB-79 and DDB-78):

| | main's lint, fields emitted | this lint |
|---|---|---|
| gallery | 146 (with DDB-205's scene) | 0, rules 6 and 7 evaluating on every scene |
| screens | 2,951 | 1,834 |

Against `main` as it is (fields withheld, old paint-order scene), the screens go 1,722 to 1,834,
and all 112 are `outside-viewport` on the developer screen: DDB-205 turned the paint-order fixture
from one `DrawFixture` node into about a hundred component nodes, and that section sits below the
developer screen's viewport. Rule 3 deliberately reports content scrolled out of view; the
scroll-container question is DDB-85's. Rules 6 and 7 add nothing on any screen. Before DDB-79
merged, rule 6 did report 8 on driver selection, DDB-108's coincident deck-preview `Layer`s, each a
hover target covered by the copy stacked on it; DDB-79's rebuild of that screen took them away.

Rules 6 and 7 evaluate 12, 2, 3, 3, 4 and 1 nodes on the buttons, icons, input showcase,
interactive controls, overlays and nested panels scenes, zero on scenes with no controls.

## What is still open

- `handlesPointer` is a declaration. A widget that acts on the pointer in `handleEvent` and does not
  override it reads as a label. Today that is `Button`, `Card` and `Vehicle`, and all three
  override; a new one needs to.
- Hover callbacks count. A tooltip trigger is a pointer target and gets the target-size check; if
  that turns out to be noise the list is one getter.
