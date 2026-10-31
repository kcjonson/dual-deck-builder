# The tree snapshot's full schema, and strings in the visual gate

DDB-80 (phase 3), with DDB-206 folded in. Normative: R13.21 to R13.29, R8.8, R8.29, R3.6, R3.8, R3.25,
R3.27, R4.7, R4.9, R6.14, R11.11.

## Context

Phase 0's `treeSnapshot` emitted what the old `Layer` could back: id, type, bounds, screen bounds,
visible, a clip, and, on non-containers, enabled plus hovered and focused. Everything else R13.22
names was omitted by the file's own rule, because nothing backed it. DDB-73's component base changed
that: margin, transform, opacity, layer and zIndex are properties on every component now, the render
walk (`renderTree`) applies them, and a `Text` holds its measurement from the metrics service. The
snapshot had to catch up, or the lint would keep reasoning about a tree that no longer exists: a
margin box it cannot see, a promoted popup it thinks is clipped, a text-overflow rule with no input.

## What each node carries now

| Field | Backed by | Emitted |
|---|---|---|
| `bounds` | `Component.bounds`, the margin box | always |
| `screenBounds` | the walk's matrix over the content box | always |
| `margin` | `Component.margin` | always |
| `zIndex` | `Component.zIndex` | always |
| `layer` | effective: `max(own, parent's)`, `base` at a root | always |
| `visible`, `enabled` | own values (the lint skips invisible subtrees itself) | always |
| `opacity` | effective: the product down the tree | always |
| `clip` | the walk's clip, reset at a promotion | when one applies |
| `roundedClip` | the rounded clip the walk's draws carry (R4.14): rect and radius, from `clipRadius` (DDB-231). Informational: the lint (rule 6) and the text-record visibility filter read only `clip`, so a control wholly inside a cut corner is not reported | when one cuts `clip` |
| `contentOffset` | `Component.contentOffset` | on a scroll container, or when nonzero |
| `transform` | `Component.transform` | when not the identity |
| `state` | every R11.11 flag but `enabled`, from `Component.stateFlags` (DDB-84) | always |
| `text` | `Text`: content, wrap, `currentMetrics`, `overflowOutcome` | on a Text; `measured` and `overflow` once measured |
| `value` | `Input.getValue()` | on an Input |
| `style` | `Component.resolvedColors` | when the component draws something |
| `inkBounds` | `Component.inkRect` through the walk's matrix | always |
| `parts` | the `addPart` mark | on Button, Input and the F5 overlay |
| `focusable`, `pointerEvents`, `handlesPointer` | `Component.focusable`, its own `pointerEvents`, `Component.handlesPointer` | always (DDB-208) |
| `scroll` | `Panel.getScrollOffset()` and `Panel.scrollRange` | on a scrollable Panel (DDB-208) |

R11.11's other flags arrived with DDB-84's state resolution.

## Decisions

**The walk mirrors `renderTree` step for step.** Each node's matrix is the parent's content-space
matrix times `translate(x + margin.left, y + margin.top)` times its own transform, which is the order
the render walk pushes them. A promotion (own layer above the inherited one) resets the clip for the
node's own draws and its subtree, as `pushClipReset` does before `render`. A clipping node's clip is
its content box through its own matrix, before the scroll translate, which is the draw API's
`transformedBounds` and R4.7's axis-aligned approximation under rotation. The test that holds this
together compares every node's `screenBounds` with the component's own `screenBounds` accessor through
margins, a rotated and scaled ancestor, a scrolled panel and a composite's parts.

One arithmetic detail mattered more than it looks. Under a translation the size is carried over as
given rather than recovered as `max - min`: the subtraction drifts in the last bit, and the first
capture with it showed every hugging title in the gallery a hair wider than its own measurement, one
text-overflow finding per scene, all of them false.

**Colours come from the component, through one accessor.** `Component.resolvedColors` returns
`{ fill, text, border }` for whatever the component draws, after its current state is applied; null
for a component that draws nothing. Rectangle and Panel share `boxColors` with `drawBox`, the shapes
report their fill and stroke, Text and Icon report text, Button and Input merge their parts. The
alternative, an `instanceof` chain in the serializer, would have had to reach into private fields and
would grow with every catalog component in phase 5. Game components that draw for themselves
(ArmorBadge, IntentMarker) do not implement it yet and so omit `style`, which is the omission rule
working rather than a gap in the schema.

**The reader never measures.** `Text.measured` measures when stale, and measuring can resize the text
and invalidate layout, which a debug read must not do (the snapshot runs inside the harness's settle
loop every frame). `Text.currentMetrics` returns the last measurement or null and never measures;
`overflowOutcome` is computed from it. A text that could not be measured reports `content` and `wrap`
and omits `measured` and `overflow`, and the lint's zero-size bucket still reads it as unmeasured.

**`text.overflow` is an outcome, with one value R13.22 does not list.** R13.22's example says
`"overflow": "none"` and describes the field as whether the text was clipped or ellipsised. The
values are `none` (fits), `clip`, `ellipsis`, and `visible` for a text that ran past its box with
nothing handling it. `visible` is the addition: without it an unhandled overflow would read `none`,
the same as a text that fits. `ellipsis` is only claimed where the layout actually truncates: always
across the width, and down the height only when wrapping (R6.14). `text.wrap` is emitted too, because
R13.25.5's exemption is "without wrap" and the lint already reads it.

**Rule 5 trusts the document's outcome.** When a node carries `text.overflow`, the rule reports
`visible` and nothing else, because the Text compared its measure with its exact own size and
rebuilding that size from `bounds` less `margin` drifts in the last bit under fractional margins.
Without the field it falls back to comparing the measure with the local content box: the
measurement is local, and `screenBounds` is scaled and rotated with the node, so a quarter-turned
label would have swapped its axes.

**`inkBounds` is the seam DDB-184 needs.** `Component.inkRect` is the content box grown by
`inkExtent` in local space, and the snapshot transforms it. Circle, Triangle and Polygon now report
half their centred stroke as `inkExtent` (the draw layer's own cull bound says the same); nothing
else reads `inkExtent`, so no pixel or cull changes. DDB-184's cached subtree union of it is in
[subtree-ink-cull.md](./subtree-ink-cull.md).

**`pointerEvents` was withheld here, and DDB-208 emitted it.** The lint read it as "interactive"
for rules 6 and 7 and R8.29 makes `auto` every leaf's default, so emitting it alone counted every
label as a control. DDB-208 emits it with `focusable` and `handlesPointer` and changes what the
rules count; see [lint-interactivity.md](./lint-interactivity.md).

**`parts` stays.** DDB-104's deletion trigger said DDB-80 removes `addPart` and `parts` once no
component calls `addPart`. Panel no longer does (DDB-73); Button, Input and the F5 overlay still do,
and they become direct draws with phase 5's catalog, so the trigger moves there. Emitting `zIndex`
and `layer` does not change DDB-104's reasoning: every part sits at zIndex 0 in its owner's layer, so
R13.25.1 would not exempt them and `parts` is still what keeps the gallery at zero.

## What the lint counts did

Nothing moved. Before (main at `dc095bd`) and after, per scenario: every gallery scene 0; splash 3,
main menu 6, developer 186, card showcase 1,020, driver selection 184, combat 282. What changed is
what the rules evaluate: text-overflow went from dormant to evaluating every visible measured Text
(71 on the developer screen, 224 on the card showcase) and found nothing unhandled, with the wrapped
ones exempt by R13.25.5. R13.25.1's exemption now has its inputs, and no component in the game sets
`zIndex` or `layer` yet, so it exempts nothing on these trees; the snapshot tests prove it exempts
through a real tree. Captured at `perf-results/phase3-snapshot-lint.json`.

The document roughly doubled (the card showcase from 138 KB to 270 KB). The harness's settle loop
serializes it twice a frame; its cost was not measured separately.

## Strings in the visual gate (DDB-206)

The cluster rule cannot see punctuation: `.` to `,` and `:` to `;` at body sizes differ by a few
pixels that pixelmatch classes as anti-aliasing. `expectTextSnapshot` in the harness asserts the
strings instead: one line per visible Text with its R13.28 path, its content and its rounded screen
rect, compared with `toMatchSnapshot` against `<kind>-<name>-text.json` beside the PNG.

- Beside the PNG, under `__screenshots__/chromium/linux/`, so the same dispatch mints it and the
  provenance job holds it to the same rule. Chromium only: the strings do not depend on the backend.
- Every string that is visible and not at zero opacity through the whole ancestor chain, and not
  clipped or scrolled wholly off screen; the developer screen scrolls most of its content out of the
  viewport. Occlusion is not tested, so a string under an opaque sibling or a modal is recorded and
  a change to it fails the scenario even though the picture is the same. Deliberate: it is still
  text the product shows once the cover goes away.
- Soft and taken before the golden, so a change both checks see reports both.
- The rect is in the record because layout is deterministic arithmetic over committed metrics, so a
  moved label is a real change and the diff names it.

Acceptance, each mutation run alone against local baselines (macOS):

| Mutation | Pixel golden | Text record |
|---|---|---|
| centred synergy text, final `.` to `,` | passed | caught |
| centred "Starting Deck:" to "Starting Deck;" | caught (948 px) | caught |
| left-aligned card text, final `.` dropped | passed | caught |
| left-aligned card text, `.` to `,` | passed | caught |
| left-aligned vehicle label, `:` to `;` | passed | caught |

A mint now writes 18 JSON files beside the 36 PNGs; `update_mode=changed` creates a missing one.

## Spec departures

- `text.overflow` adds `visible`, and `text.wrap` is emitted (both above).
- `contentOffset` is omitted where it does not apply rather than emitted as R13.22's example `null`,
  per R13.22's own sentence that fields which do not apply are omitted.
- `enabled` is the component's own value, like `visible`; R13.22 lists only layer, opacity and clip
  as effective.
- `parts` kept (above). `pointerEvents` and `handlesPointer` are additions R13.22 did not name until
  DDB-208 amended it.
