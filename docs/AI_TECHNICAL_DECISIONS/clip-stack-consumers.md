# The clip stack's consumers: cull, snapshot, hit test

DDB-65, the clip half of the third PR (DDB-55 phase 1). 2026-09-28. Follows [batcher.md](./batcher.md).

## The problem

The three-state clip stack landed with the draw API (`draw/clip.ts`, R4.2 and R4.3), and `Layer` and
`Panel` push through it. Three things still decided clipping on their own:

- `Panel`'s `ScrollableContentLayer.render` skipped whole children whose bounds missed the scrolled
  viewport, a second CPU cull beside R4.2a's, uncounted and with its own edge rules.
- `treeSnapshot` re-derived each node's clip with its own overflow test and its own rect
  intersection, which could not express R4.2's `empty` state and could drift from the renderer.
- Hit testing ignored clips entirely. `Layer.containsPoint` tested bounds only, so a row scrolled out
  of a panel was clickable where nothing was drawn (R4.12).

## Decisions

**One fact decides whether a layer clips.** `Layer.clipsChildren` (overridden by `Panel`, which
clips when scrollable or overflow-hidden) is read by `Layer.render`, `Panel.render`, `treeSnapshot`
and the hit test. None of them can disagree about where a clip is.

**The panel cull is the draw API's.** `ScrollableContentLayer.render` is deleted; the content layer
renders like any layer and R4.2a drops what misses the panel's clip, counted as `culled`. Removing it
naively would have regressed text, which R4.2a exempted because a run's extent needs a glyph walk. So
`DrawBackend.textInk` is added: an optional per-run ink extent from whatever owns the atlas.
`LegacyGeometryEncoder.textInk` takes the same pen and glyph walk `encodeText` does, unions the glyph
quads, and grows the result by one pixel for the rounding that happens after translation. The draw
API asks only under a rect clip and a translate-only transform, because the legacy path places a
rotated run at its transformed anchor without rotating the glyphs, and a cull that can be wrong is
worse than none. The card showcase now draws 145 groups and culls 524, where before the panel
skipped subtrees and nothing counted them.

**The snapshot uses the clip stack's arithmetic.** `treeSnapshot` carries a `ClipState` down the walk
and intersects with `intersectClip`, the function the draw API's stack uses. An intersection that
comes out empty is reported as a zero-sized rect rather than omitted, because a node clipped away
entirely has a clip and it contains nothing. A test renders a scrolled panel and checks that the
snapshot's clip for a row equals the clip the recording backend received for it.

Recording the clip during render and reading it back was considered and rejected: `Card`, `Button`,
`Input` and the leaf components override `render` without calling `Layer.render`, so a render-time
record would be missing on exactly the interactive nodes the hit test cares about, and the snapshot
would stop working on a tree that has not been drawn, which every snapshot test builds.

**R4.12 ships its scrolled-out half now.** `Layer.containsPoint` also requires the point to be inside
every clipping ancestor, each asked in its own local space through `globalToLocal`, which already
removes a panel's scroll (R4.11). The test is half-open like R4.4's fragment test. The recon left this
open because the dispatcher is phase 3 (DDB-75); it did not need the dispatcher, only the walk up the
parent chain, and leaving a scrolled-out row clickable for another phase was a real input bug with a
five-line fix.

Not shipped, and why: promotion resetting the clip for hit testing (R4.8) needs components to have a
layer to be promoted into, which is phase 3's object model, and nothing in the app promotes. Hit order
in reverse paint order (R3.28) is DDB-75.

**Offset before clip (R4.9 to R4.11) needed no change.** `Panel.render` takes the clip rect from its
unscrolled position and hands the content layer the scrolled offset, which is R4.10's order. It is
now pinned by 4.7's fixture: content offset 100, a child at local y 150 draws at panel y 50 with the
clip fixed on the panel.

## What moved

No pixel. All six reachable screens and all seven baselined gallery scenes hash identically against
`main` in Chromium, as they did after the batcher.

One test changed its premise. `CombatScreenTeardown` clicked a Headshot placed first in the hand; at
the test's 1024 px viewport the first driver's hand starts off the left edge, outside the hand
layer's clip, so the click reached a card nobody could see. It now places the card last, where it is
on screen. The off-screen hand at 1024 px is a layout issue that predates this work.
