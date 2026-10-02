# The rounded clip on the component contract (DDB-231, DDB-234)

DDB-231 and DDB-234, under DDB-55. 2026-10-02. Rules: R4.12, R4.14, R5.27, R12.19, R12.20, R15.15. Builds on [rounded-clip.md](./rounded-clip.md) (DDB-190), which put the rounded clip in the uber shader, and supersedes the corner inset in [panel-padding.md](./panel-padding.md) and [panel-and-scroll-container.md](./panel-and-scroll-container.md).

## The problem

The draw API could clip to a rounded rect since DDB-190, but the component clip was a plain rect: the walk pushed `clipRect` with `pushClip`, and the hit test and the snapshot tested a plain rect. So Panel and ScrollContainer cleared their rounded corners by insetting the clip, and Panel its content, by `max(borderWidth, radius)` on every side, which over-clips each straight edge by up to the radius.

Two loose ends came with it. DDB-190 left a question for this task: a rounded clip added by a later sort domain was appended into the frame's uniform slot after earlier draws had been issued against that bound range, which R5.27 and R15.15 exist to avoid. And DDB-234: `ScrollContainer.clipsChildren` was `width > 0 && height > 0`, so a scroller laid out at zero width drew its whole content unclipped.

## Decisions

**`clipRadius` on Component.** A getter beside `clipRect`, 0 by default, in local units, at `clipRect`'s corners. The render walk pushes `pushClipRounded(clipRect, clipRadius)` when it is positive and `pushClip` otherwise; `containsScreenPoint` and the dispatcher's hit walk reject a point whose rounded-box distance from the snapped clip (or the local clip, under a non-translation) is positive; the snapshot pushes the same rounded clip through `intersectClip`. One fact, three readers, as `clipRect` already was. An override derives it from `clipRect`, so it needs no cache of its own.

**Hit testing honours the corners.** R4.12 says a point outside any ancestor's clip is rejected, and R4.11's stated aim is that hit testing agrees with painting. The rounded clip is the clip the walk pushes, so a point in a cut corner is outside it. The test is the shape's own boundary (distance at most 0), the point where the shader's coverage crosses one half.

**Panel clips at the border's inner edge.** `clipRect` is the box inset by `borderWidth`, and `clipRadius` is `borderRadius - borderWidth`, concentric with the background's corner, so the straight edges keep every pixel inside the border and the corners are cut along the border's inner arc.

**Panel's content inset depends on whether it clips.** R12.19 insets content by the corner radius "unless the implementation clips with the rounded-rect clip". A panel with `overflow: 'hidden'` does, so its inset floor is the border width. A panel that does not clip has nothing keeping a child at its edge off the rounded corner, so it keeps `max(borderWidth, radius)`. Setting `overflow` later recomputes the inset. The only panel in the game that clips is the dialog's; every other panel keeps the inset it had, which is why few pixels move.

**ScrollContainer clips at the border, out into the padding by the child ink (R8.8) as before, with `clipRadius` the radius less the smallest side inset.** Using the smallest inset gives the largest radius, which can over-clip a corner whose sides are inset further but never under-clips: a rounded rect with a larger radius lies inside one with a smaller radius. Once the clip is a full radius in, it is 0 and the clip is a plain rect.

**A rounded clip that cuts nothing is dropped.** This is what makes nesting routine rather than a warning: a rounded ScrollContainer inside a rounded Panel nests two rounded clips, and R4.14 keeps only the innermost, warning once a frame (a console error in a development build, which fails the screenshot harness). But the outer clip only matters where the inner one reaches its corner. `keptRoundedClip` in `draw/clip.ts` checks, at every push, whether each candidate rounded clip takes anything off the merged rect: whether any device pixel centre in it gets less than full coverage from the one-pixel ramp. The signed distance of a convex shape is convex, so the worst centres are the four corner ones, half a device pixel in, and testing those is exact for a rect on the device grid. A rounded clip that passes is exactly its bounding rect there, already in the intersection, so dropping it changes no pixel and spares the fragment SDF. The warning fires only when both the own and the inherited clip cut. The draw API's `ClipStack`, `intersectClip` (the snapshot's arithmetic), and so the walk and the snapshot all go through it. A radius of 0 never cuts, so it gets no table entry on any path.

**R12.19's "always when a second rounded clip would nest" is left to the author, with the warning as the check.** A panel cannot know what clips its content will push, and with the drop above, nesting needs a clipping panel whose content reaches within its radius of the corner, which only `flush` or a padding smaller than the radius allows. Nothing in the game does that; the warning catches the first that does.

**Per-flush uniform slots, not a measurement.** DDB-190 offered two ways to settle the append-into-a-bound-range question: measure it on ANGLE Metal with `perf-capture.mjs`, or move to per-flush slots. The cost in question is a driver shadow copy or implicit wait, which a frame-time capture on one machine would most likely not show either way, so a measurement would settle little; the slots are R15.15's own shape and cheap. So:

- Uniform slots live in a `StreamRing` counted in slots (12, growing once with a warning like the instance ring), so a slot is reused only once it is two frames old (R5.27).
- A frame starts in a fresh slot holding the projection.
- An upload that adds rounded clips while no draw has read the bound slot appends them to it, as before: nothing has read that range this frame.
- After a draw has read it, the upload takes a fresh slot, writes the projection and the whole table so far into it in one `bufferSubData` from a staging block, and binds it. A range a draw was issued against is never written again.
- An upload that adds nothing keeps the bound slot. R15.15 describes one slot per flush; writing an identical copy for a flush that changes nothing would only cost bandwidth, so that is the one departure.

Today that means one slot a frame on every screen, and one more only for a frame whose later domain brings a new rounded clip (an overlay dialog over a base domain that already drew).

**Zero-sized clips show nothing (DDB-234).** `Component.clipsChildren` is now `overflow === 'hidden'` with no size guard, and `ScrollContainer.clipsChildren` is always true. The guard dated from the first component base, where a size of 0 meant "not set yet" and `setOverflow` warned on it. Overflow can still be set before a screen sizes the box on mount, but layout runs before the first frame, so the only box still zero-sized when it draws is one laid out at zero, and a viewport of no area should show nothing. The pushed clip intersects to R4.2's `empty`, so every draw under it is dropped, the hit walks reject every point, and the snapshot reports a zero-sized clip. The callers that already guarded themselves (`BattlefieldLayer`, the popover and tooltip surfaces, which set `hidden` only once placed with a size) are unaffected.

## The snapshot

A node whose effective clip carries a rounded clip reports `roundedClip: { x, y, w, h, radius }`, the rounded rect and radius in screen space, beside `clip`. Its rect is the clip that rounds, which can be larger than `clip` when a plain clip inside it was intersected. It is omitted where no rounded clip cuts the node's clip (R13.22's omission rule).

## What moved

No pixel. A full re-mint (`update_mode=all`) wrote every golden back byte for byte, which is what the decisions above predict:

- Every panel but the dialog's does not clip, so its inset and its look are unchanged.
- The dialog clips one pixel further out than it did (inset 1 with a 1 px corner instead of a plain rect inset 2), and nothing it holds reaches its edge.
- No ScrollContainer in the game or the gallery has a `borderRadius`, so their clips are the rects they were.
- The `clipping` scene's rounded fixtures go through the draw API directly; where the drop rule removes a rounded clip it was taking no pixel.
- No golden scene lays a clipping box out at zero size.

A browser pass over the menu, settings, credits, driver selection, a turn of combat, and the developer screen raised no console error, so nothing nests.

## Not done

- R12.19's automatic inset when a nested rounded clip would reach the outer corner (above).
- Popover and tooltip surfaces draw `radius_panel` corners and clip with a plain rect when constrained; they could take a `clipRadius` too (DDB-240).
