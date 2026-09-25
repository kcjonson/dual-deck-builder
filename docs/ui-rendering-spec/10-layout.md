# 10. Layout

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

Absolute positioning stays available: every component has a position, and screens may place their top-level panels by hand or by anchoring. Flow layout happens inside a stack container that resolves its children's sizes and positions from a small Figma-style vocabulary (fixed, hug, fill) with minimum and maximum sizes, rather than a full flexbox or constraint solver. Worldsim shipped this engine in July 2026 with a characterisation test suite that is the conformance suite for this chapter; the review found one defect worldsim's own log had recorded and the first draft had carried over (a hug container freezing after its first layout), and added the minimums, shrink-to-fit, and anchors a dense HUD needs.

Rules are numbered R10.n.

## 10.1 Vocabulary

- R10.1 Per-axis sizing modes on every component: `fixed` (use `size`), `hug` (size to content), `fill` (take a share of the parent's leftover space, weighted by `fillWeight`). Text defaults to `hug` on both axes unless given an explicit size; everything else defaults to `fixed`. A stack container constructed with a zero size on an axis is `hug` on that axis. Sizing mode is authored (by construction or by setting `widthMode` and `heightMode`) and is never changed by layout.
- R10.2 Stack container properties: `direction` (`vertical` or `horizontal`), `gap` (MAY be negative, for overlap; the lint exempts siblings that overlap by at most the negative gap), `padding` (per side), `distribution` along the main axis (`start`, `center`, `end`, `spaceBetween`, `spaceAround`, `spaceEvenly`), `crossAlign` (`start`, `center`, `end`, `stretch`).
- R10.3 Percent sizes are expressed as `fill` with weights, not as a separate mode. Weights divide the leftover after padding, gaps, and non-fill children, not the container's whole size; three `fill` children with weights 25, 40, and 35 in an otherwise empty container without padding or gaps split it 25/40/35.
- R10.4 Per-child constraints: `minSize` and `maxSize` per axis clamp the resolved size after fill distribution and before positioning; when a clamp changes a fill child's size, distribution re-runs once with clamped children treated as fixed (the CSS flexbox "frozen items" step). A text's default main-axis `minSize` is its longest unbreakable word (CSS `min-width: auto` semantics) unless its `overflow` is `clip` or `ellipsis`, in which case it is 0; without this a fill text in a crowded row is assigned width 0 and wraps every word onto its own line. `aspectRatio` (width over height) resolves an unassigned axis from the assigned one. `alignSelf` overrides the container's `crossAlign` for one child. Wrap (multi-line flex) and grid are out of scope.

## 10.2 Resolved sizes

- R10.5 A stack container tracks, per axis and per layout pass, whether its size has been resolved for this pass. A `fill` or stretched axis is resolved when the parent assigns it (an assignment of zero is a valid resolved size, and the container reports zero, not its hug measurement; without this a fill container squeezed to zero pushes its siblings, a worldsim review catch). A `hug` axis is resolved by measuring children during the pass in which it is asked, and MUST be re-measured on every pass in which the container or a descendant is dirty. `assignSize` and `layout(bounds)` assign the resolved rectangle for the current pass and MUST NOT convert a `hug` or `fill` axis into `fixed`. Worldsim's implementation made any resolved axis permanently definite, so a nested hug container froze at its first measured size, a defect its own log records and the first draft of this chapter repeated.

## 10.3 The algorithm

Run on a dirty stack container before render or before a hit test (chapter 8, R8.16, R8.18). Invisible children and `positioned: 'absolute'` children are excluded from every pass; absolute children are placed by R10.15 after pass 3.

- R10.6 Pass 0, nested first: every visible child that is itself a stack container resolves its own child sizes so its hug measurements are current.
- R10.7 Pass 1, cross axis: `contentCross = resolved ? max(sizeCross - paddingCross, 0) : max(child cross sizes)`. For each child whose cross mode is `fill`, or whose cross mode is not `fixed` when `crossAlign` (or the child's `alignSelf`) is `stretch`, assign `contentCross - childMarginCross` on the cross axis. Every other child with a `hug` cross axis receives `contentCross` as a measurement constraint, not an assignment: text and any component with a `measure` hook resolve to `min(intrinsic, available)` and wrap or reflow accordingly (shrink-to-fit, as CSS auto-width items do), so a wrapping text in a start-aligned column wraps at the column's width. A child that is a stack container is re-resolved immediately, because its main size may depend on its new cross size.
- R10.8 Pass 2, main axis: when the main axis is resolved, `contentMain = max(sizeMain - paddingMain, 0)`; `used` is the main sizes of all non-fill children plus the main margins of every fill child; `leftover = max(contentMain - used - gap * (n - 1), 0)`; each fill child receives `leftover * weight / totalWeight` as an exact float, then clamps apply and distribution re-runs once if any clamp bit (R10.4); if `totalWeight` is 0, fill children receive 0. On a hug main axis `contentMain` is the hug measurement of R10.12, `leftover` is 0, and fill children keep their intrinsic (clamped) size.
- R10.9 Pass 3, positioning: `contentOrigin = position + (margin.left, margin.top) + (padding.left, padding.top)`; `totalMain` is the sum of the children's main sizes after pass 2; `leftover = max(contentMain - totalMain - gaps, 0)`. Distribution offsets: `start` 0; `center` leftover / 2; `end` leftover; `spaceBetween` 0 before the first, leftover / (n - 1) between; `spaceAround` between / 2 before the first, leftover / n between; `spaceEvenly` leftover / (n + 1) before and between. The distributed space stacks on top of `gap`. Cross positioning per child, using `alignSelf` when set: `start` and `stretch` at the origin; `center` adds `max((contentCross - childCross) / 2, 0)`; `end` adds `max(contentCross - childCross, 0)`.
- R10.10 Offsets are never negative (CSS `safe` alignment): on overflow every distribution degrades to `start` and children run past the end edge. Overflowing children are drawn unless the container clips (chapter 4); the layout lint reports the overflow.
- R10.11 Each child receives its margin-box origin through `position`; a child that is a stack container also receives its final rectangle through `layout(bounds)` and lays out its own children (subject to R10.5). A plain child's `layout` is never called by a parent.
- R10.12 Hug measurement: main axis is the sum of visible flow children's main sizes plus `gap * (n - 1)`; cross axis is the maximum visible flow child cross size; both plus padding, and plus margin in the reported bounds.

## 10.4 Text in flow

- R10.13 Assigning or constraining a text's width (pass 1) sets both its alignment box and its wrap width; its reported height is then the wrapped height from the metrics service (chapter 6). Because the cross pass runs before the main pass, a wrapping text in a column reflows and its hug parent grows with it.
- R10.14 Measurement MUST use the same font, size, letter spacing, and text transform the text will render with (uppercase labels measure as uppercase). Worldsim's stat and tab bar drifted until they measured the transformed string, and its tooltip still estimates seven pixels per character.

## 10.5 Absolute positioning and anchoring

- R10.15 A child with `positioned: 'absolute'` (and any component outside a stack container) is excluded from flow measurement and distribution and placed against its parent's content box: `origin = parentContent.origin + anchor * parentContent.size - pivot * child.size + position`, where `anchor` is a fraction pair of the parent's content box (default `[0, 0]`), `pivot` a fraction pair of the child's own margin box (default equal to `anchor`), and `position` an offset. Named anchors (`topLeft`, `top`, `topRight`, `left`, `center`, `right`, `bottomLeft`, `bottom`, `bottomRight`) are shorthands for both. This is the Unity RectTransform and Godot anchor model; it covers a badge in a card's corner, an end-turn button at the end of a bar, a toast stack in a corner, and a centred dialog without any component reading its parent's size.
- R10.16 A screen's top-level regions are a full-viewport stack (bands with fill weights) or anchored children of the root; a root's box is the viewport (chapter 8, R8.21), so a resize re-lays out through the same code path as first layout with no screen code involved. The sibling engine had two different combat layouts, one for construction and one for resize, and any resize rearranged the screen.

Worked example, the combat screen of the sibling project's design document (enemies 25%, battlefield 40%, hand 20%, resource bar 5% at the bottom): one vertical stack filling the root with four `fill` children weighted 25, 40, 20, and 5 (no padding, no gap, so the weights are the bands); the turn counter and the combat log are `positioned: 'absolute'` children of the root with `anchor: topLeft` and `anchor: topRight`; the end-turn button is an absolute child of the resource band with `anchor: right` and a negative x offset; the hand is a horizontal stack with a negative gap, `crossAlign: end`, and no clip, whose cards carry `zIndex` for overlap and `transform` for the fan. A resize re-runs exactly this.

## 10.6 Scroll content sizing

- R10.17 A scroll container's content size is the union of its children's margin boxes plus padding, measured after layout; the conventional shape is one child, a stack container with a fixed width and hug height. Manual content size is allowed as an override. Scroll extent, thumb geometry, and clamping are in chapter 12 (scroll container).

## 10.7 Invalidation

- R10.18 A stack container is dirty when a child is added, removed, moved, shown, hidden, resized, or re-measured (text change, font change), or when any of its own layout properties change. Dirtiness propagates to the nearest relayout boundary (chapter 8, R8.18), and layout of the dirty subtree runs once before render and on demand before a hit test.

## 10.8 Rationale

Full flexbox (Yoga, used by React Native and Unity UI Toolkit; Taffy, used by Zed and Bevy) is a larger dependency and a larger mental model than a game HUD needs; Figma's fixed, hug, and fill vocabulary covers menus, panels, dialogs, toolbars, and lists, and worldsim's screens reached zero lint violations with it. Clay (a small C layout library used for game UIs) ships the same vocabulary, fit, grow, fixed, percent plus floating elements, and reports microsecond layouts; its one warning applies here too: the text measure callback must be fast and cached. The review's additions are the three places the pure vocabulary fails in practice and CSS flexbox has answers for: automatic minimum sizes (`min-width: auto`), shrink-to-fit for auto-width items, and `safe` alignment; plus the anchor model every game engine uses for corner placement. Wrap and grid can be added later without changing the sizing model, and a flexbox engine can be adopted behind the same component properties if a project ever needs designer-authored flex layouts. The engine is specified to the number (the pass order, the clamps, the resolved-size rule) because those details are where the bugs lived and because the existing test suite already pins them.

## 10.9 Required tests

Port worldsim's stack container suite as the conformance suite. It covers, with expected numbers: gap grows hug size; padding offsets children and grows hug size; fill child margin comes out of leftover; fill with no leftover gets zero; stretch resizes hug children minus margin and leaves fixed children alone at start; cross-axis fill stretches regardless of `crossAlign`; three-deep nesting propagates stretch; a plain child's `layout` is never called; a wrapping fill child in a narrow column doubles its height and the hug container grows; every distribution's offsets; overflow degrades to start on both axes; zero is a valid resolved size; nested containers receive real bounds.

Add: a nested hug container whose child text grows after the first layout grows on the next layout (the freeze regression); a fill text in a row that is too narrow keeps its longest word's width and the row overflows rather than the text collapsing; a hug text in a start-aligned fixed-width column wraps at the column width; `alignSelf: center` centres one fixed child in a stretch row; `maxSize` on a fill child returns the excess to its siblings; weights 25/40/35 with padding and gap divide the leftover, not the container; `totalWeight` 0 gives fill children zero (a change: worldsim's engine returns early and leaves them at their intrinsic size); an absolute child with `anchor: topRight` and `pivot: topRight` sits in the corner regardless of the parent's size; a negative gap overlaps siblings and the lint accepts it; invalidation propagates from a text change to a hug ancestor and stops at a fixed boundary; a resize of the viewport re-lays out a full-viewport stack through the same code path.

## 10.10 Conformance checklist

| Item | Level |
|---|---|
| Fixed, hug, fill with weights on both axes; modes never changed by layout | required |
| Stack container with direction, gap (negative allowed), per-side padding, six distributions, four cross alignments, `alignSelf` | required |
| Per-pass resolved sizes including zero; hug re-measured when dirty | required |
| Three-pass algorithm as specified, shrink-to-fit on the cross axis, safe alignment | required |
| `minSize` and `maxSize` with the frozen-items re-run; text's automatic minimum | required |
| Text wrap width from the cross pass, measured with render-equivalent metrics | required |
| Absolute children with anchor, pivot, and offset; roots sized from the viewport | required |
| Upward invalidation to relayout boundaries | required |
| `aspectRatio` | recommended |
| Wrap, grid | out of scope |
