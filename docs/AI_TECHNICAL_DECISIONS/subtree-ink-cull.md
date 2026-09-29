# Skipping culled subtrees on a cached ink bound

DDB-184 (DDB-55, phase 3). 2026-09-28. Follows [clip-stack-consumers.md](./clip-stack-consumers.md), which
deleted `Panel`'s private subtree cull in favour of R4.2a's per-draw cull and left the walk visiting every
group of a scrolled-out subtree.

## The problem

R4.2a's cull is per group: the walk enters every component under a scroll panel, calls `render`, and the
draw API transforms each group's ink and rejects it, text by a glyph walk. The card showcase culls 245 groups
a frame that way, the developer screen 849. A bounds early-out on a component's own box is not sound,
because nothing keeps descendants inside their parent's box (overflow defaults to visible), and a shadow,
glow or focus ring draws outside the box that owns it.

## Decisions

**Each component caches a conservative bound on its whole subtree's ink, in its parent's space.**
`Component.subtreeInk` is the union of the component's own ink and every visible child's cached bound, less
the content offset, placed through the component's origin and transform. Own ink is `cullInk` (by default
`inkRect`, the content box grown by R8.8's `inkExtent`), grown by the render walk's fallback focus ring when
the component is focusable or showing focus. The bound is four numbers on the component, mutated in place,
so recomputing it allocates nothing.

Children are not intersected with the component's clip, although that would tighten a scroller's bound. The
clip is snapped to device pixels at push (R7.8a), so the local `clipRect` is not exactly what it keeps, and
an under-sized bound is the one error this cannot have. Only the scroller itself is looser for it; it is on
screen whenever its rows are.

**Some subtrees have no bound, and are never skipped.** `subtreeInk` is null when anything in the subtree
has a `layer` (a promotion resets the clip, R4.8, so no ancestor's clip rules it out), or a `cullInk` of
null: a `Text` that has not been measured, since nothing then bounds what `drawText` lays out, and the
developer screen's `DrawFixture`, whose paint callback promotes layers and pushes its own clips.

**Invalidation marks the component and every ancestor, always to the root.** `invalidateInk` is called
from the `x`, `y` and `transform` setters, every content size change (`storeSize`, `resizeInLayout`,
`applyLayoutSize`), a changed anchor placement, `layer`, `setDragOffset`, `focusable`, a change of
focus-visible, `Panel`'s scroll, and `invalidateLayout`, which covers content changes that do not resize
(a new label in a fixed box, a restyle, a child added or removed). It walks to the root rather than
stopping at an ancestor already stale, because the group count below is taken during the walk and can be
recorded while the ink is still stale; stopping early would leave a stale count above. A walk up is a few
pointer hops, and nothing invalidates more than a handful of components a frame outside a layout pass.
Opacity does not invalidate: the bound ignores it, which over-bounds a faded subtree and never under-bounds.

**The skip is the render walk's, before anything is pushed.** At the top of `renderTree`, a component
whose subtree has been walked before is tested: under a `none` clip never, under `empty` always (when
bounded), under a rect clip when its bound, through the draw API's current transform and grown by four
device pixels, misses the clip rect. Four device pixels is `SUBTREE_INK_OUTSET`, the most any group's cull
ink grows past its local extent (R5.17's polygon feather miter), so a bound that misses holds no group the
per-draw cull would keep. The screen rect is a module scratch rect; the test allocates nothing.

**A skipped subtree's groups count as culled, from its last walk.** The walk records `walkedGroupCount` as
the change in `apiDraws + culled` across the subtree, and a skip adds it through `DrawApi.cullGroups`, so
R4.2a's `apiDraws + culled` still counts every group requested. A subtree is never skipped before it has
been walked once, and every invalidation forgets the counts on the way to the root, so a changed subtree is
walked, and recounted, the frame after it changes. A change that alters the group count without
invalidating (a colour, a run growing from empty) keeps the old count until the next walk; the counter is a
diagnostic, and the pixels do not depend on it.

**Text and the composites that draw text say how far their runs can reach.** `Text.cullInk` is its
`inkRect`: the box unioned with the run's measured ink, per side, from the same layout and placement
`render` draws (`DrawApi.measureTextInk`, which is the backend's `textInk`, the extent R4.2a culls the run
by). A nowrap run past a narrow box, wrapped lines past a fixed height and glyphs past a tight line height
are all inside it, on the side their alignment sends them. It does not rely on `overflow: clip`, since the
audit below compares the unclipped run. The same rect is the snapshot's `inkBounds`, and `inkExtent` is its
furthest side (DDB-214). On a backend that measures text but offers no `textInk` the cull falls back to the
box grown on every side by the layout's overrun and an em of slack. `Icon`, `ArmorBadge` and `IntentMarker`
grow their boxes by an em of their glyphs. `Circle.cullInk` covers the disc its radius draws, which a size
given without `setRadius` does not change.

**A development build audits the promise the skip trusts.** Around each component's `render` (and the
walk's focus ring) `renderTree` hands the draw API the component's own bound, `ownInkBound`, and the draw
API checks each group's cull ink against it where it computes that ink anyway, under a rect clip, which is
also the only place a skip can happen. A group outside is reported once a frame as `ink-outside-bound`,
which the visual suite fails on as a console error, and which a strict draw API (the unit tests) throws. A
production build builds no rect and checks nothing. Driving every screen through 40 scroll steps with Tab
focus in between, and every gallery scene, reported nothing.

**The walk's per-frame allocations from #85's review are gone.** `clipRect` is `computeClipRect`'s answer,
frozen and kept until the size changes (`Panel` overrides `computeClipRect`); `transformMatrix` is kept
until the transform, size or drag offset changes; `Panel.contentOffset` is rebuilt only when the scroll
moves. The draw API's own matrix concatenation per push is unchanged.

## What moved

No pixel. Screenshot hashes of every screen at 14 scroll positions each (developer and card showcase
scrolled through their range) match `main` exactly, apart from the splash screen at the step where its
timed transition lands, which varies with wall-clock timing and has no clip to cull against.

Counters: `apiDraws + culled` is unchanged on every screen. The developer screen moves one group from
`apiDraws` to `culled` (two at some scroll positions): an `Input` with an empty value draws a text run with
no glyphs, which the per-draw cull cannot bound and so always counted as drawn; its subtree is now skipped.
`clipPushes` would drop where a skipped subtree held a clipper; no screen has one.

Median `render` section, Chromium dev build, 1440x882, static builds of `main` and this branch alternated
four times, 40 samples each, on a loaded machine (load average 14 to 22); the captures are
`perf-results/ddb-184-ab-{main,branch}-{4,5,6,7}.json`:

| Screen | main | this branch | Groups drawn / culled |
|---|---|---|---|
| card showcase | 0.81, 0.79, 0.83, 0.82 ms | 0.65, 0.69, 0.61, 0.59 ms | 198 / 245 |
| developer | 0.84, 0.86, 0.93, 0.80 ms | 1.21, 0.49, 0.47, 0.51 ms | 58 / 849 to 57 / 850 |
| combat | 1.08, 0.51, 0.50, 0.47 ms | 0.64, 0.99, 0.52, 0.52 ms | 153 / 33 |

The showcase numbers in clip-stack-consumers.md (1.2 to 1.75 ms, 145 drawn and 524 culled) are from an
earlier showcase and an earlier machine state and do not reproduce on today's `main`; the comparison above
is the like-for-like one. The developer screen gains most even though every section holding a
`DrawFixture` is walked in full. Combat has little under a clip and sits within the noise. The branch's
figures include the development-only ink audit.
