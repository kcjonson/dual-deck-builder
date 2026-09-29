# Panel padding and where a padded panel clips

DDB-196 (DDB-55). 2026-09-28. Builds on [component-base-and-render-walk.md](./component-base-and-render-walk.md).

Superseded in part by [panel-and-scroll-container.md](./panel-and-scroll-container.md) (DDB-85): the panel no longer scrolls, and its inset is a stack's padding placed by layout rather than a content offset. The clip inside the border and radius described here still holds.

## The problem

Every developer section, and so every gallery scene, placed its title at (0, 0) of a bordered `Panel`. Since the uber shader drew borders at their real width, the glyphs sat on the border and the corner. The fix belongs to `Panel`: R12.19 says a panel's content is inset, and without a content inset every caller has to hand-offset its children.

## Decisions

**Padding is the content offset.** `Panel` takes `padding`, measured from the border edge with the border included. `contentOffset` returns the scroll position less the padding. DDB-73's render walk, `Component`'s hit test and `treeSnapshot` already read that one value, so children land inside the padding in all three with no second offset. The padding scrolls with the content. R4.13 puts the padding inside the content size, so the scroll extent is the content plus both paddings, less the box, on both axes.

**A padded panel clips inside its border and corner radius.** The rect is the border box inset by `max(borderWidth, cornerRadius)` on every side.

- A clip at the content box would cut rows that are still inside the scroll range as they cross the padding band. R4.13's model has them scroll through it.
- A clip at the border box lets scrolled children paint over the border and past the rounded corners that `Panel.render` drew first.
- The corners are cleared by inset rather than by R4.14's rounded clip (`pushClipRounded`). The walk pushes `clipRect` with `pushClip`, and the hit test and snapshot test against a plain rect. A rounded clip would mean a radius on the component clip contract across all three. Insetting the straight edges by the radius under-clips nothing and over-clips at most the radius along each edge. R12.19 already asks for that inset when content is not clipped by a rounded rect.

An unpadded panel keeps the border-box clip it always had. The two scrolling panels in the game (card showcase, developer screen) are unpadded, so no golden moves. Moving them to the inset clip is a deliberate re-baseline for later.

**`treeSnapshot` reads `clipRect`.** It used to intersect with the node's whole box. The walk and the hit test already used `clipRect`, so any override would have made the snapshot disagree with them.

## Departure from the spec

R4.9 defines scrolling as "`clip = own bounds` plus `contentOffset = (0, -scrollY)`". A padded panel departs from both halves:

- Its clip is inside its bounds, as above.
- Its content offset is `scroll - padding`, not `-scroll` alone.

The intent of R4.9 holds: the clip is fixed in the panel's unscrolled space and the offset is applied inside it, so content moves while the clip stays put (R4.10). An unpadded panel matches R4.9 exactly.

## Consequences

- A section in `developer/` extends `DeveloperSectionPanel` (inset `bw + space_3`, 13 px), lays out from (0, 0) within `innerWidth`, and sizes itself with `fitContentHeight`.
- When R4.14's rounded clip reaches the component contract, the corner inset can become a rounded clip at the border's inner edge, so the straight edges stop over-clipping.
- Chapter 10's stack container has per-side padding (R10.2). This option is a single inset and is Panel's alone; it goes away when Panel's content slot becomes a stack container (R12.19).
