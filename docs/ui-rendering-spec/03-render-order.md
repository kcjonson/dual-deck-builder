# 3. Render order

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

This is the chapter everything else depends on. The renderer draws with a painter's algorithm, no depth buffer, and alpha blending, so the order in which quads reach the GPU is the correctness mechanism for transparency, for drop shadows, and for the one-pixel anti-aliased edges of every SDF shape and glyph. Get the order wrong and shadows paint over their owners, text vanishes under panels, popups hide behind siblings, and shape edges show dark seams. Worldsim hit every one of those before settling on the rules below; the incidents are listed in 3.7.

Rules are numbered R3.n. MUST, SHOULD, and MAY carry their RFC 2119 meanings.

## 3.0 The model in one paragraph

A frame is an ordered sequence of sort domains separated by barriers. Inside a domain, every draw call becomes one draw group tagged with the ordinal of the layer it belongs to. When the domain flushes, groups are stable-sorted by layer ordinal and emitted; groups with equal layer keep their submission order. Submission order comes from a depth-first walk of the retained tree: a parent's own draws, then its children sorted by local `zIndex` with ties broken by insertion order. A component may promote its subtree to a higher layer (popups, tooltips, toasts, drag ghosts); the promotion is what lets a menu nested deep inside a scroll container paint over everything else in the domain without a portal. Component `zIndex` never reaches the batcher; the only sort key the batcher sees is the layer ordinal. Barriers exist so that passes which bypass the batcher (a world renderer, an off-screen blit) can interleave correctly, and so that no world draw can ever sort above the UI.

## 3.1 Terms

- Draw call: one call on the immediate draw API (chapter 2), for example one rounded rectangle, one text run, one image.
- Draw group: the contiguous vertex and index range produced by one draw call, plus its sort key. Sorting operates on groups, never on triangles.
- Submission order: the order draw calls reach the batcher.
- Sort domain: the set of draw groups between two barriers. Keys are compared only inside a domain.
- Barrier (`flush`): ends the current domain. Everything before it paints beneath everything after it, regardless of keys.
- Layer: a named stacking band inside a domain (3.3). The batcher's sort key.
- Local order (`zIndex`): an integer on a component that orders it among its siblings only.

## 3.2 Painter's algorithm

- R3.1 The 2D path MUST NOT use a depth test or depth writes. Correct output depends on back-to-front emission only. A depth test hard-rejects fragments and tears the alpha ramps that give SDF shapes and MSDF glyphs their anti-aliasing; worldsim rejected it for the UI and, separately, for the world.
- R3.2 The 2D path MUST NOT partition draws into opaque and transparent passes with a depth buffer; the benefit is one ordering rule instead of two. An implementation MAY drop groups submitted earlier in the same domain that lie entirely within a later group that is an opaque (alpha 1, no gradient alpha, radius 0, no border alpha), unclipped, axis-aligned `rect` or `image`, since the painter's algorithm makes them invisible and no pixel changes; dropped groups are counted as `occluded` (chapter 13, R13.12). Overdraw of full-screen layers is the cost that makes this worth having on integrated GPUs at high resolutions.
- R3.3 Blending is premultiplied `over` (chapter 5). Every draw composites over whatever is already in the framebuffer.
- R3.4 Given the same tree, the same open popups, and the same viewport, emission order MUST be identical from frame to frame. No ordering decision may depend on iteration order of a hash table, on allocation addresses, or on timing.

## 3.3 Layers

- R3.5 An implementation MUST provide this ordered set of layers, back to front: `base`, `raised`, `overlay`, `modal`, `popup`, `toast`, `tooltip`, `drag`, `transition`. Ordinals are implementation-defined (worldsim's tokens use 0, 10, 20, 100, 200, 300, 400 with gaps for insertion); the relative order is normative. An implementation MAY add layers between these.
- R3.6 Every component has a `layer` property. It defaults to "inherit". A component's effective layer is `max(ownLayer, parent.effectiveLayer)` by ordinal, with `inherit` counting as the parent's value, so a subtree never paints beneath its own ancestor's layer; a development build reports a component whose own layer is lower than its parent's effective layer as an authoring error. A component that sets a layer above its parent's promotes its whole subtree. The root of a domain is `base`.
- R3.6a A promoted subtree hosted inside a subtree that is already at or above the requested layer stays in the host's layer and relies on submission order (it is a later draw than its host): a menu opened from a toast paints in `toast` above its host toast and beneath later toasts, so the popup service SHOULD open popups whose host is at or above `popup` as overlay roots instead (chapter 8, R8.21). The overlay service MUST offer `bringToFront(root)`, and the popup service MUST close exclusive popups when a modal root opens, so a `popup` opened before a modal never paints above the scrim; it SHOULD also close a popup whose ancestor scrolls, since a promoted child keeps its host's content offset (R3.8) and would otherwise float detached from a trigger that scrolled away.
- R3.7 Layer promotion is the only mechanism by which a subtree paints above content outside its subtree. There is no deferred overlay queue, no portal registration, and no "render me last" flag. Worldsim built a deferred queue and reverted it the same day in favour of a sort key, because the queue needed opt-in routing in every widget that could host a popup.
- R3.8 Promotion resets the inherited clip stack to `none` (chapter 4, R4.8) and nothing else: not the coordinate origin, the content offset, the transform, opacity, or `visible`. A promoted component is positioned by its `position` in its parent's content box exactly as an unpromoted one, so a hovered card raised to `raised` stays where the hand laid it out, and a menu that is a child of its trigger follows the trigger when the trigger scrolls. A promoted subtree that must stay inside the viewport (menu, tooltip, context menu, drag ghost) asks the placement service (chapter 12, R12.30) with its `screenBounds` and converts the answer back with `screenToLocal` (chapter 8, R8.13). A promoted component MAY set `detachTransform: true`, in which case its subtree is rendered and hit-tested in screen space with the identity transform and positioned directly by its placement result; the hit walk skips ancestor inverse transforms for such a subtree. Popups owned by a transformed component (a menu on a fanned card) SHOULD set it, or they render rotated and lose text snapping.
- R3.9 (informative) Intended use of each layer. `base`: ordinary screen content. `raised`: content that must float above its siblings' neighbours but is not a popup, for example a hovered or dragged-within-hand card, an HUD banner. `overlay`: non-modal floating panels, targeting scrims, damage numbers. `modal`: dialogs and their scrim. `popup`: menus, selects, context menus, comboboxes; above `modal` because a select inside a dialog opens a menu. `toast`: notifications. `tooltip`: hover text, above toasts so a tooltip on a toast is readable. `drag`: the ghost of an item being dragged across the screen. `transition`: the screen-transition overlay (chapter 12), above everything. Worldsim's literal values (context menu 400, tooltip 500, menu 1000, toast 2000) put tooltips beneath menus; this ladder corrects that.

## 3.4 Order within a layer

- R3.10 Within one layer of one domain, the final order is submission order. The batcher MUST produce, per domain, the concatenation of the per-layer submission sequences in layer-ordinal order. The natural implementation appends each group's index (or instance) range to a pre-sized per-layer list at submission and concatenates the non-empty lists at flush: linear in the number of groups, stable by construction, no allocation in steady state. A comparison sort is acceptable only if it is stable; a JavaScript comparator sort over ten thousand groups is measurably slower than the partition and runs on every frame a popup or hovered card is open.
- R3.11 Submission order is produced by a depth-first walk: a component emits its own draws, then visits its visible children in local order. Invisible components and their subtrees are skipped entirely (not drawn, not hit-tested, not laid out unless the implementation documents otherwise).
- R3.12 Local order of siblings is `stable_sort(children, by zIndex ascending)`. Equal `zIndex` keeps insertion order, so backgrounds added first paint first with no annotation. `zIndex` is an integer; default 0; negative values are allowed and paint beneath the default siblings but still after the parent's own draws.
- R3.13 Sorting MUST NOT reorder the children collection itself. Sort a separate render-order view. Handles and indices into the children collection stay valid. Worldsim broke every child handle the first time a child got a distinct `zIndex` because the sort ran in place.
- R3.14 Component `zIndex` MUST NOT be forwarded to the batcher. The batcher's sort key is the layer ordinal only. Worldsim has two z sources that do not agree: `Rectangle`, `Circle`, and `Line` forward the parent-set z through a thread-local, nine composite widgets (context menu, dropdown, menu, select, text input, toast, tooltip, tree view, toast stack) forward their own z with hand-picked offsets (`+1`, `+2`, `+0.1`), and `Text`, `Button`, `Dialog` chrome, and the rest forward nothing. Every remaining ordering bug in that codebase traces to that split: a close button's background at z 2 painted over its own label at z 3 (live in its task list view), HUD shapes given a z to satisfy the layout lint sort above an open dialog's scrim and panel, which are drawn at z 0, and widgets resorted to `+0.1` fractional z to get their text above their own background.
- R3.15 Roots of a domain are visited in this order: the scene's own roots (screen, HUD panels) in the order the scene supplies them, then the overlay roots (dialogs, toast stacks, transitions) in open order as maintained by the overlay service (chapter 8, R8.21), latest last, so the most recently opened dialog paints on top and its scrim covers older ones. The scene's list is the only place order is hand-written.

## 3.5 Order inside a draw call and inside a widget

- R3.16 A rectangle with a box shadow emits two groups, the shadow first and the fill second, in the same layer. Stable sorting keeps them adjacent, so a shadow is always directly beneath its owner and above everything submitted earlier, which is CSS `box-shadow` behaviour. An implementation MAY merge the two into one group whose geometry is ordered shadow-then-fill; it MUST NOT emit the shadow as a separate later or earlier pass.
- R3.17 Text with a shadow emits the shadow glyph run immediately before the main glyph run.
- R3.18 A composite widget draws its parts in this order: shadow, background fill with border (one SDF quad), decorations (focus ring, selection, hover wash), content (text, icons, images), then chrome that must sit on top of content (scrollbar track and thumb, resize grip, a text caret). It MUST NOT use fractional layer offsets or `zIndex` tricks for its own internals; submission order is sufficient because R3.10 guarantees it.
- R3.19 A widget's internal parts share the widget's layer. A widget that hosts a popup (select, dropdown, combobox) creates the popup as a child component with `layer: popup`; it does not draw the popup inline with a special key.

## 3.6 Domains and barriers

- R3.20 The draw API exposes `flush()` as an explicit barrier. Keys never compare across a barrier. Nothing else flushes: not a texture change, not a clip change, not a transform change, not a layer change. All of those are per-group data or resolved at flush time. (A texture change may split the flushed geometry into several GPU draw calls; that is a submission detail and does not change order.)
- R3.21 A frame MUST be organised as an ordered sequence of domains, and the UI MUST be the last domain before any diagnostic overlay. A typical game frame with a world: `[world background] flush [world entities, in whatever order the world's own sorter produces] flush [world-space UI] flush [screen UI] flush [debug]`. A UI-only application's frame is `[screen UI] flush [debug]`; world domains are added in front when a world renderer exists, and an implementation need not build multi-domain machinery before then. The barrier before the screen UI is what makes it structurally impossible for a world draw to sort above a panel, whatever layer or key it carries. Worldsim's construction pass sorted above dialogs for a month because it shared the UI's flush.
- R3.22 Any pass that draws outside the batcher (raw GPU draws, instanced meshes, a framebuffer blit) MUST flush the batcher before it draws, and everything batched after it paints over it. Submission order across the barrier is depth order.
- R3.23 A world that needs 2.5D depth ordering sorts on the CPU by its own key (worldsim: ground-contact Y) and submits in that order, interleaving flushes where raw draws sit between batched ones. It MUST NOT reuse the UI layer ladder as a depth key; the world depth sort and the UI stacking model are different problems with different keys. A non-UI domain MAY use any integer as its group key with the same batcher (worldsim's construction previews and committed buildings do); the batcher orders by ordinal and does not care what the ordinal means, and the barrier of R3.21 keeps the two key spaces from meeting.
- R3.24 Mid-frame flushes cost CPU (worldsim measured +0.9 ms from two extra mid-frame flushes with 90 buildings, suspected to be partly a same-buffer reuse stall). An implementation SHOULD use a ring of vertex buffers so that a mid-frame flush does not write into a buffer the GPU may still be reading, and SHOULD keep the number of barriers per frame constant, never proportional to content.

## 3.7 Opacity

- R3.25 Components have an `opacity` in [0, 1], default 1, multiplied down the tree and applied to every draw as a final alpha multiplier (including borders and shadows; worldsim's fades left borders opaque because border colour had no alpha slot).
- R3.26 Inherited opacity is per draw, not per group of overlapping draws, so a half-transparent panel shows its own background through its own text. This artifact is accepted at the baseline level. An implementation MAY offer true group opacity. If it does: the subtree is rendered as a nested domain into an off-screen RGBA8 target cleared to transparent black and drawn premultiplied, sized to the subtree's `screenBounds` united with its ink bounds, intersected with the current clip, and rounded outward to device pixels, with the target's own projection, clip space, and ratio (chapter 7, R7.13); layers inside the nested domain sort among themselves only, so a promoted descendant does not escape the group (CSS `opacity < 1` stacking-context semantics), and an implementation that cannot honour that MUST fall back to scalar opacity for a subtree containing a promoted descendant rather than composite it; the composite is one `image` draw in the owner's effective layer at the owner's submission position, tinted by the group opacity (multiplying premultiplied colour and alpha together) and carrying the owner's clip; targets are pooled (chapter 5, R5.34) and counted as `targetSwitches` (chapter 13, R13.13).
- R3.27 `opacity: 0` lays out, draws nothing, is skipped by hit testing as if `pointerEvents: none` (neither target nor occluder), keeps focus and focusability, and is not `hovered`; `visible: false` is skipped by layout, render, hit testing, update, and focus. A scrim that must block input from the first frame of its fade sets `pointerEvents: auto` (chapter 8, R8.29); hit-testability never depends on alpha.

## 3.8 Input order

- R3.28 Hit testing MUST walk the same order as painting, reversed: top layer first, and within a layer the reverse of submission order (last painted, first hit), honouring each component's `pointerEvents` (chapter 8, R8.29) and clip. A subtree promoted to `popup` receives the pointer before base content even though its parent was visited early. Worldsim's dispatch walked the reverse of each parent's local order only, so a menu floated by key was hit-testable only where its parent's dispatch reached it, and paint order and event order disagreed.
- R3.29 A modal dialog's scrim consumes pointer events that reach it. Because the scrim is the dialog's first draw and the dialog is in the `modal` layer, everything beneath the scrim is unreachable while a modal is open, without any special "modal input capture" mechanism. Keyboard focus trapping is chapter 9's job.

## 3.9 Worked examples

Panel with a close button. Panel (base) emits: shadow, background. Children in local order: title text (z 0), close button (z 0, added after the title). Close button emits: background, glyph. Final order: panel shadow, panel bg, title, button bg, button glyph. No `zIndex` anywhere. Under worldsim's forwarded-z model the same panel needed the button at z 2 to satisfy the layout lint and then hid its own glyph.

Select inside a dialog inside a scroll container. Scroll container (base) pushes its clip and content offset. The dialog is an overlay root in `modal` (chapter 8, R8.21): it emits scrim, panel, title, then the select trigger. The open menu is a child of the select with `layer: popup`: promotion resets the clip, the menu positions itself in trigger-local coordinates from `placement.place(trigger.screenBounds, ...)` converted with `screenToLocal`, and emits its shadow, background, and rows. Sorted order: all `base` groups, then `modal` groups, then `popup` groups. The menu paints above the dialog and is not clipped by the scroll container, and it moves with the trigger if the dialog scrolls.

Hand of cards. Cards are siblings in a hand container, overlapping by a negative gap and rotated by their `transform`. Hover raises one card: it sets `zIndex: 1` (local, among siblings), tweens a `translate` lift, and, if it must also overlap the resource bar that is a sibling of the hand container, sets `layer: raised`; its position is unchanged by the promotion. Dragging it to a target goes through the drag service (chapter 9, R9.12): the ghost is promoted to `drag` with `pointerEvents: none`, the hand's clip no longer applies (R3.8), and the enemy under the ghost receives `dragenter`.

Targeting mode (click a card, then click an enemy). The dimming scrim is a `raised` child of the battlefield with `pointerEvents: passthrough`, and the valid targets are promoted to `overlay` so they paint above the scrim and receive the click; a screen-level `cancel` handler ends the mode. Putting the scrim in `overlay` as a later sibling would paint it over the enemies and swallow their clicks.

Toast over an open menu. Toast (toast layer) sorts after the popup groups; a tooltip on the toast (tooltip layer) sorts after the toast.

Turn banner over the battlefield. A phase banner that must not be covered by vehicles or cards uses `layer: overlay`; the vehicles are world-domain draws behind the UI barrier anyway, and the cards are `base`.

## 3.10 Rationale and rejected alternatives

Depth buffer with alpha blending: rejected. Blending needs back-to-front order regardless, and the depth test destroys anti-aliased edges (dark seams where two shapes meet). WebRender-style opaque front-to-back plus alpha back-to-front is a real technique for browsers with huge overdraw; UI screens here have tens to hundreds of quads, and the two-pass machinery is not worth its second ordering rule.

Global scalar z forwarded from components (worldsim's current design): rejected for the reasons in R3.14. It is one mechanism instead of two, which is attractive, but it makes every component's `zIndex` a global statement, so composition breaks: no widget can use `zIndex` for its own parts without affecting the whole screen.

CSS stacking contexts (nested z-index scopes): the model the owner knows best, and the closest to what this chapter specifies. In this chapter every container is a stacking context: a child's `zIndex` orders it among its siblings only and a subtree is painted atomically (CSS 2.1 Appendix E order with the parent's own draws first, then negative-z children, then the rest by z and tree order). CSS lets z-indexed descendants of a non-context element escape to the nearest ancestor context; that flexibility is what makes CSS z-index hard to reason about and it is deliberately absent. The other difference is escape for popups. In CSS a popup inside an `overflow: hidden` ancestor or a low-z stacking context cannot escape; frameworks bolt on portals or the top-layer API. Layers here are the top-layer API built in: a small ordered set of named bands that any subtree can be promoted into. Group opacity (R3.26) and off-screen composites are also atomic units, exactly as `opacity < 1` creates a stacking context in CSS.

Unity sorting layers and Godot `CanvasLayer`: prior art for named bands with tree order inside each band; both also warn that ordering by depth inside transparent UI breaks batching, which is why the band, not a per-object key, is the batch sort key here.

Deferred overlay queue (worldsim commit b5dc8be, reverted in f1ff5ac): rejected on the record. It required every popup host to route its popup through a special call, and hit testing did not follow the paint order.

Triangle-level sorting: rejected. O(triangles) per frame for no benefit; groups are per draw call and the index list is rebuilt from group ranges.

Per-scissor flush for clipping (colonysim's original design): rejected; see chapter 4. Clipping is per-draw data so it never breaks a group.

## 3.11 Incidents this chapter exists to prevent

From worldsim's development log, each with the rule that now covers it:

- Text invisible under button backgrounds because text lived in a separate batch with its own flush, and again after merging text into the uber shader because of a premature text flush inside the layer walk. One batch, flush only at domain boundaries (R3.20, R3.21).
- Top bar and gameplay bar backgrounds given `zIndex` 500 and 400 painted over their own children. Backgrounds first by insertion, never by key (R3.12, R3.14).
- Dropdown and select menus painted behind sibling widgets because z was per-parent only and dropped at the batcher. Layer promotion (R3.6, R3.7).
- Committed construction and placement previews sorted above HUD panels and dialogs because they shared the UI's flush. Barrier before the UI domain (R3.21).
- Colonists always drew over trees because dynamic entities were a later pass than baked flora. World sorts by its own key and interleaves flushes (R3.22, R3.23).
- Child handles pointed at the wrong child after the first z-sort because the children vector was sorted in place. Sort a view (R3.13).
- A close button's label hidden by its own background, and HUD shapes floating over dialogs, because component z leaked into the global sort for some shape types and not others (both are live code in worldsim's task list and entity info views, not logged incidents). One key, the layer (R3.14).
- Popup painted on top but clicks went to the widget beneath: a consequence of per-parent dispatch that worldsim's game UI works around by hand-ordering dialogs and the toast stack before everything else. Hit order mirrors paint order including promotion (R3.28).

## 3.12 Required tests and fixtures

Unit tests (no GPU):

- Group order: mixed layers in mixed submission order emit in layer order; equal layers keep submission order; a domain whose groups all carry one layer uploads its submission sequence unchanged (no concatenation copy).
- Effective layer: a `base` child of a `raised` card renders in `raised` and the development build reports the authoring error; a menu opened from a toast renders in `toast` after its host.
- Group opacity (when implemented): a `popup` child inside an opacity group composites inside the group and does not appear after the base groups; the composite carries the owner's clip.
- Barrier isolation: a `tooltip`-layer group submitted before a `flush()` emits before a `base` group submitted after it.
- Shadow adjacency: a shadowed rect's shadow group immediately precedes its fill group after sorting, with other groups of the same layer around it.
- Promotion: a `popup` child of a `base` parent nested under a clip emits after every `base` group and with no clip.
- Children untouched: after a render with distinct `zIndex` values, the children collection is in insertion order and every handle resolves to the same child.
- Hit order: with a promoted popup overlapping base content, a pointer event at the overlap reaches the popup.
- Determinism: two renders of the same tree produce identical group sequences.

Gallery fixture (chapter 13, R13.31): overlapping stacks with ascending and descending `zIndex`, a shadowed panel over a busy background, an open popup declared inside a scroll container, a modal with a select whose menu is open, a toast and a tooltip over the popup. The screenshot of this scene is the visual contract for this chapter.

## 3.13 Conformance checklist

| Item | Level |
|---|---|
| No depth test, no opaque/transparent split, premultiplied over | required |
| Per-layer partition preserving submission order, single-layer fast path | required |
| Named layer ladder in the normative relative order, monotonic effective layer, subtree promotion, clip reset on promotion | required |
| Overlay service `bringToFront`; popups closed when a modal opens | required |
| Tree order: parent first, children by stable local `zIndex`, invisible skipped | required |
| Component `zIndex` never reaches the batcher | required |
| Shadow group immediately before owner | required |
| Explicit `flush()` barrier; UI is the last content domain | required |
| Hit testing in reverse paint order across layers | required |
| Children collection never reordered by sorting | required |
| Inherited opacity multiplier | required |
| Group opacity via off-screen composite with the R3.26 rules | optional |
| Occlusion drop of fully covered groups | optional |
| `detachTransform` for popups under transformed hosts | recommended |
| Vertex buffer ring for mid-frame flushes | recommended |
