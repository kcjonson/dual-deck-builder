# Component base and the framework render walk

Status: implemented (DDB-73, first of two PRs), 2026-09-28
Spec: chapter 8 of the [UI rendering spec](../ui-rendering-spec/08-object-model.md), R3.11 to R3.13, R3.25 to R3.27, R4.8 to R4.12

## Problem

Phase 3 needs one base class that every node implements (R8.1), with R8.2's properties and effective values, a children API that can move and reconcile without tearing state down, screen geometry that agrees with what is drawn, and a render walk owned by the framework rather than by each component. Before this change:

- `Layer` was the base and `Component` extended it with hover, focus and enabled. The base had public `x`, `y`, `width`, `height` fields and nothing else from R8.2.
- Every component's `render(context)` drew itself at `context.offset + position` and then looped over its own children. Five leaves, `Button`, `Input`, `Panel` and `Layer` each carried a copy of the loop; `Card` borrowed `Layer.prototype.render`. Nothing could sort siblings, push a transform, or apply opacity uniformly.
- `Panel` inserted two implicit children, a background `Rectangle` and a `ScrollableContentLayer`, redirected `addChild`, `removeChild` and `getChildren` into the latter, and overrode `globalToLocal` to subtract its scroll. The tree snapshot special-cased it.
- `localToGlobal` ignored panel scroll, and hit testing had no transform to invert.

## Decision

**`Component` is the base, `Layer` is a container on top of it.** The inheritance flips: `Component` (abstract) carries R8.2's properties as accessors (`id`, `visible`, `enabled`, `opacity`, `layer`, `zIndex`, `x`, `y`, `width`, `height`, `margin`, `transform`, `pointerEvents`, `overflow`), the effective values of R8.3, the children API, screen geometry, and the legacy method-style setters, which stay until the accessor codemod. `Layer` adds only a background fill and `pointerEvents: 'passthrough'`. Every `new Layer(...)` and `extends Layer` in the game is unchanged; code that needs "any node" now types it `Component`.

Properties that belong to later phases are left out rather than stubbed: sizing modes and `measure`/`assignSize` (phase 4), `focusable`, `tabIndex`, `focusGroup` (DDB-76), `tooltip`, `popupTrigger` (DDB-78), the event callbacks and `handleEvent` (DDB-75). `cursor` waits for the dispatcher that would read it.

**`render(draw)` emits the component's own draws in its content box's local space.** The walk is a free function, `renderTree(component, draw)`: origin (position plus the left and top margin) as a translate, then the transform, opacity, and layer; then `render`; then, around the children only, the clip in the component's unscrolled space and the content offset inside it; then the children in `renderOrder`. Defaults push nothing, so a component at its parent's origin with no transform costs one `render` call. Invisible and zero-opacity subtrees are skipped whole (R3.27). Layer promotion pushes the layer and `pushClipReset` (R3.8, R4.8); a layer at or below the inherited one is handed to `pushLayer`, which reports R3.6's authoring error and keeps the higher layer.

Drawing in local space and letting the draw API's transform carry the origin changes no pixel: under a translation, the encoder's `a*x + c*y + e` is `local + origin`, the same single addition the old code did as `origin + local`. The local screenshots of every screen and gallery scene against `main` pass the golden tolerance, and the CI goldens are unchanged.

**`render(draw)` takes the draw API as an argument.** The spec writes `render()`. Passing it keeps components free of a singleton at draw time now and of a context lookup later, and it is what the recording-backend tests hand in.

**Panel has no implicit children (R8.6).** Its background is its own draw through the same `drawBox` helper `Rectangle` uses, so the draw call is identical; scrolling is `contentOffset`, which the walk and `screenMatrix` both apply. `addChild`, `getChildren` and `globalToLocal` are no longer overridden, `getContentLayer` is gone, and the snapshot's Panel special case collapses into a generic content offset.

**`zIndex` orders a separate view (R3.12, R3.13).** `renderOrder` is the children list itself while every child is at zIndex 0, so the common case allocates nothing; any nonzero zIndex builds a stable-sorted copy, rebuilt only after a child or a zIndex changes.

**Children have one parent.** `addChild` and `insertChild` detach a child from a previous parent (the old `addChild` did not, which is how the snapshot's diamond guard came to exist). Inserting a child the parent already holds is `moveChild`: no unmount, state kept (R8.5). `removeChild` and `clearChildren` unmount (R8.7). `reconcileChildren` (R8.27) keys only the children it created, so a list container can hold a header beside its reconciled rows; removed keys leave the children list at once and unmount after `remove`'s promise settles.

**Screen geometry is computed on demand, not cached at layout.** `screenMatrix` concatenates each ancestor's origin, transform and content offset exactly as the walk pushes them, and `localToScreen`, `screenToLocal`, `screenQuad` and `screenBounds` read it. R8.13 says these are valid after layout; computing them on demand makes them valid always, and costs a walk up the ancestors, which only hit testing and tests do. A cache would need invalidation on every position change, and position of an absolute child is on R8.18's list of things that must not invalidate layout.

**Hit testing is `containsPoint(localX, localY)` on the content box, half-open (R8.12).** The legacy `InputSystem` asks `containsScreenPoint(x, y)`, which adds effective visibility, zero opacity and `pointerEvents: 'none'` on the chain, the inverse transform, and R4.12's ancestor clips up to a promotion. Paint-order occlusion and `passthrough` and `unit` are the dispatcher's (DDB-75), which replaces this call.

## Trade-offs and consequences

- Every positioned node pushes one transform per frame, a small allocation in `DrawApi.pushTranslate`. The old walk allocated a `RenderContext` object per node per frame, so the count is about the same.
- Composites (`Button`, `Input`, `Card`, `DeveloperOverlay`) still build their visuals from child shapes marked with `addPart`. R8.8 allows that; converting them to own draws is phase 5's catalog work.
- The snapshot still reports `enabled` and `state` only on non-`Layer` nodes, which is what "Component" used to mean. DDB-80 replaces the schema.
- `InteractiveControlsSection` called `setBackgroundColor` on a `Rectangle`, which set a field the rectangle never drew. It now calls `setFillColor`, so the colour sliders in the developer screen do what they say.
- Subtree ink bounds for DDB-184 are not built here. They need a per-component ink rect and invalidation on every position, size and transform change anywhere below, and position does not invalidate layout, so the invalidation work of the next PR does not produce them for free. The seam is `inkExtent` plus the accessors: every geometry write now goes through a setter on `Component`.
