# Stack container and the layout protocol

Status: implemented (DDB-81, DDB-55 phase 4), 2026-09-28
Spec: chapter 10 of the [UI rendering spec](../ui-rendering-spec/10-layout.md) (R10.1 to R10.18), R8.1's `measure` and `assignSize`, R8.18, R8.21, R13.25.1
Builds on: [mount-context-and-frame-order.md](./mount-context-and-frame-order.md) (the layout phase, relayout boundaries, upward invalidation) and [text-component-metrics.md](./text-component-metrics.md) (Text's hug sizing)

## Problem

DDB-73 left the frame a layout phase with nothing to run: `layoutChildren` was a no-op hook, every component was a relayout boundary because every component was fixed-size, and screens placed everything by hand. Chapter 10 specifies a stack container to the number, and worldsim's `LayoutContainer` test suite is its conformance suite. Worldsim's engine also carries the defect chapter 10 was written around: once an axis was resolved it stayed definite, so a nested hug container froze at its first measured size.

## Decision

**Sizing lives on `Component`, the passes on `Stack`.** Every component carries R10.1's `widthMode` and `heightMode` (`fixed`, `hug`, `fill`), `fillWeight`, `minSize`, `maxSize`, `aspectRatio`, `alignSelf`, `positioned`, `anchor` and `pivot`, as options and accessors; the ones that affect size invalidate layout (R8.18). The default mode is `fixed`, except `Text` and `Stack`, which hug an axis given no size (a `defaultSizeMode` hook the base constructor calls). `Stack` extends `Layer`, so it has a background and nothing else, and implements the three passes in `layoutChildren`.

**The protocol is R8.1's pair, plus one argument.** `measure(availableWidth, availableHeight, definite)` returns the content size a component would take with at most that much space, and is stateless: a stack measures by recursing into its children, a text through the metrics service, anything else reports the size it was given. `definite` names an axis the parent will assign exactly (a stretched cross axis), because a hug stack stretched to 300 lays its wrapping text out at 300, and measuring it at its own narrower hug width would get the height wrong. `assignSize(width, height)` is the parent's resolution for the pass: it sets the content size, never a mode, does not invalidate upward (the parent doing the assigning is already laying out), and marks the subtree when the size changed so its own children follow. NaN keeps an axis.

**Per-pass resolution without flags.** R10.5 wants a hug axis re-measured on every pass in which something below it is dirty. A stack knows whether its size was assigned by asking whether its parent `sizesChildren`: a non-fixed stack is never a relayout boundary, so any change inside it reaches its parent, which re-measures and re-assigns before descending. There is no stored "resolved" state to go stale, which is exactly what froze worldsim's containers. A stack outside a stack (under a plain `Layer`, or a root) measures itself on every non-fixed axis in its own layout and invalidates its parent when that changes its size, since the parent may anchor it.

**The passes, as specified.** Own size first; pass 1 assigns stretched and cross-`fill` children the content box and measures the rest against it, shrinking to fit; pass 2 measures fixed and hug main sizes at the settled cross size and shares the leftover among `fill` children by weight as exact floats, clamps, and re-runs once with the clamped children frozen; pass 3 positions with the six distributions and the four alignments, never at a negative offset. Worldsim's separate "pass 0, nested first" is not needed: `measure` recurses, so a nested hug measurement is always current. On a hug main axis (not fixed, not assigned by a leftover share or a stretch) there is no leftover and fill children keep their intrinsic size, which the stack decides from its parent's direction and alignment rather than by comparing numbers.

**One addition to R10.7's order.** After pass 2, a child whose main size came from the leftover has its cross size measured again at that size. R10.7 puts cross before main, which is right for a column (a text's width decides its height) and wrong for a row, where a fill text's width is the leftover and its height is only known after. CSS does the same.

**Text.** A text's `fixed` axis is its authored size; otherwise the stack's assignment for the pass is its box, so an assigned or shrink-to-fit width is the wrap width (R10.13). Outside a stack nothing assigns and it hugs unwrapped as DDB-71 left it, which is why no existing pixel moves. The assignment is forgotten when the text moves to another parent (`onParentChanged`). `automaticMinSize('width')` is CSS `min-width: auto`: the longest word (measured by wrapping at a width narrower than any glyph), the whole line for `nowrap`, zero for `clip` and `ellipsis` (R10.4). It applies on a stack's main axis only, as in CSS, so a stretched column still wraps as narrow as it is given.

**Anchors on every container.** `positioned: 'absolute'` children of a stack, and every child of a plain container, are placed after `layoutChildren` by R10.15's formula against the parent's content box (inside the padding, for a stack). The placement is stored apart from `position` (`placedX` is position plus the anchor's shift), so `position` stays the authored offset, moving it invalidates nothing (R8.18), and the default `topLeft` anchor and pivot shift nothing: every hand-placed component in today's screens is where it was. The render walk, `screenMatrix`, `bounds` and the snapshot all read the placed origin. A padded `Panel` anchors inside its padding, since its children already sit under it through `contentOffset`. An absolute child's `fill` axis takes the whole content box; its hug axes measure against it.

**Roots from the viewport.** A root with a `fill` axis takes the viewport's logical size on it at the top of its layout (R8.21). `UiFrame` keeps its mounted roots, and `viewportChanged()` invalidates the ones that fill; both shells call it from the viewport owner's change event, so a resize runs the same layout as the first one. Screens still size their roots by hand until DDB-82.

**Relayout boundaries are the fixed components.** `isRelayoutBoundary` is now both modes `fixed` (R8.18). Every component was already fixed, so the only kinds that stop being boundaries are text (no children) and non-fixed stacks.

**Negative gap and the lint.** The snapshot reports a stack's `direction` and `gap` as `stack` on its node (R13.22 names no such field, but R13.25.1's "beyond what a negative stack gap allows" cannot be computed without it), and rule 1 exempts siblings of a negative-gap stack whose overlap along its main axis is no deeper than the gap.

## Departures from the spec, recorded

- `measure` takes a third argument, `definite`, for the reason above.
- R10.11's `layout(bounds)` is not a method here: the final rectangle arrives through `position` and `assignSize` in the same top-down pass. `layout()` remains the legacy size estimate a few screens call by hand.
- R10.6's pass 0 is subsumed by recursive `measure`.
- The cross re-measure after fill distribution is an addition to R10.7.
- Clamps never apply to a `fixed` axis, which is authoritative.
- A `fill` axis on a non-root outside a stack has nothing to share and is measured like `hug`.
- `Circle` ignores `assignSize`, since it draws from its radius: worldsim's non-resizable leaf contract.

## Tests

`Stack.test.ts` is worldsim's suite case for case (construction, both directions, invalidation, the A2 characterisation cases, gap and padding, every distribution with one, two and five children, fill, stretch, the edge cases, zero as a resolved size, wrap-aware sizing) with worldsim's expected numbers, followed by spec 10.9's additions and the anchor, viewport and boundary cases. `Stack.text.test.ts` has the cases that need real text, against the committed body face: shrink-to-fit wrapping in a column, the longest-word floor in a crowded row, a fill text wrapping to its share, the freeze regression with a text that grows, invalidation from a text change stopping at the fixed boundary. The gallery's `stack` scene is the R13.31 layout fixture, laid out by stacks throughout, and is lint clean.

## Consequences

- DDB-82 can make combat one full-viewport stack with weighted bands and anchored drawers; nothing in this change migrates a screen.
- A generic component in a stack hugs the size it was given, so a box stretched once returns to its own size when the stretch goes.
- Worldsim's zero-weight early return is gone: fill children with zero total weight get zero (spec 10.9).
