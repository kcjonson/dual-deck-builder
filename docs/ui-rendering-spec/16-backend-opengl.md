# 16. Backend notes: OpenGL (native), and the worldsim gap list

Status: draft 4 (2026-09-07; revised after all five reviews, see chapter 17)

Worldsim is the reference implementation this specification was abstracted from, and it does not conform to every rule in it: several rules exist precisely because worldsim's own log records the bug they prevent, and a few are corrections its own log already asks for. This chapter records how the abstract chapters map onto desktop OpenGL 3.3 core as worldsim uses it, then lists the gaps between worldsim and the specification so that project can close them on its own schedule. The sibling TypeScript project's gaps are in chapter 14.

## 16.1 Mapping

| Specification | Worldsim today |
|---|---|
| Draw API (chapter 2) | `Renderer::Primitives` free functions with `.Args{}` structs: `drawRect`, `drawLine`, `drawTriangles`, `drawCircle`, `drawText`; `beginFrame`, `endFrame`, `flush`; transform and clip stacks |
| Batcher | `BatchRenderer`: one VBO and IBO, 80-byte `UberVertex` with per-vertex mode, SDF parameters, border, clip rect; one `DrawGroup {indexStart, indexCount, zIndex}` per add call (one per glyph for text); stable sort by z at flush when any group has non-zero z; GPU submission split per font atlas in emit order |
| Order (chapter 3) | Painter's algorithm, depth test disabled, straight alpha; per-parent stable child sort by `short zIndex`; `Primitives::flush()` barriers between world passes and before the UI |
| Clip (chapter 4) | Per-vertex axis-aligned clip rect tested in the fragment shader in device pixels with `u_pixelRatio` and `u_viewportHeight`; nesting by intersection; content offset as a transform pushed before the clip |
| Shading (chapter 5) | Single uber shader (`uber.vert`, `uber.frag`, GLSL 3.30): SDF rounded rect with inside, center, outside borders, per-corner gradient colours, box shadow quad, MSDF text, flat instanced world mode |
| Text (chapter 6) | msdf-atlas-gen atlases per family, `FontRenderer` with a shared glyph iteration for measure and render, greedy wrap, run-origin snapping, LRU caches |
| Coordinates (chapter 7) | `CoordinateSystem`: logical pixels, `ortho(0, w, h, 0)` rebuilt per flush from the window size, `pixelRatio` from framebuffer over window, `glViewport` in device pixels |
| Object model (chapter 8) | `IComponent`, `ILayer`, `Component` (arena-allocated children, generational handles), `Container` (clip plus content offset) |
| Input and focus (chapter 9) | `InputEvent` (mouse down, up, move, scroll) synthesised per frame from polled GLFW state; `dispatchEvent` over the reversed render order, consume to stop; `FocusManager` with tab index, wrap, scopes |
| Layout (chapter 10) | `LayoutContainer`: fixed, hug, fill with weights; six distributions; four cross alignments; three-pass algorithm; definite-axis flags |
| Theme (chapter 11) | `tokens.json` from the React prototype, generated `Tokens.h`; `Tone` and `Size` variants |
| Catalog (chapter 12) | Twenty-five components; seven of them draw-only structs outside the tree |
| Observability (chapter 13) | `DebugServer` over cpp-httplib with lock-free rings, `/api/ui/tree`, `/api/ui/lint`, `/api/ui/screenshot`, `/api/input`, `/api/control`, `/api/metrics`, SSE streams; `ui-sandbox` scene registry; `MetricsCollector` window statistics; `GPUTimer` |

Native specifics that stay native: GLFW window and input polling, `timeBeginPeriod` frame pacing on Windows, the embedded HTTP server as the transport for the chapter 13 hooks, Google Benchmark micro-benchmarks, `glReadPixels` screenshots with a row flip.

## 16.2 Worldsim gap list

Ranked by how often the gap has produced a recorded bug, then by cost to close. Each item cites the rule it would satisfy.

1. Two z models that do not compose (R3.14). `Rectangle`, `Circle`, and `Line` forward the parent-set z through a thread-local, nine composite widgets forward their own z with hand-picked offsets (`+1`, `+2`, `+0.1`), and `Text`, `Button`, `Dialog` chrome, and the rest forward nothing; a dialog's scrim and panel therefore sit at z 0, HUD shapes given a z to satisfy the layout lint sort above them, a close button's background hides its own label (live in the task list view), and widgets use `+0.1` fractional z to put their text above their own background. Closing it: adopt the layer ladder (R3.5) as the only batch key, stop forwarding component z, promote popups (menus at 1000, context menus at 400, tooltips at 500, toasts at 2000 in the game) to layers, and delete `RenderContext`'s thread-local z with the thirty-five or so offset sites. The batcher's group sort and fast path stay exactly as they are; 16.4 gives the integer-first form.
2. Tooltips beneath menus (R3.9). A consequence of item 1's literal values.
3. Hit testing disagrees with paint order for promoted popups (R3.28, R9.4). Dispatch walks each parent's reversed local order; a menu floated by key is hit-testable only where its parent's dispatch reaches it, so scenes hand-order dispatch. Closing it: a hit-test pre-pass over layers, then bubble.
4. Empty clip intersection unclips (R4.2). `(0, 0, 0, 0)` is both "no clip" and the result of disjoint clips. Add the third state.
5. Clip rects never transformed (R4.7). A scroll container nested in an offset container clips at the wrong place unless its position is absolute.
6. Legacy scissor calls with no GPU effect (R4.5). `TextInput` overflow is unclipped.
7. Every line, circle fan, polygon, and icon stroke rides the SDF path with `smoothstep(0, 0, 0)` (R5.2). Add an explicit flat mode; ANGLE will not extend the same luck.
8. Border colour has no alpha and borders are forced opaque (R5.8). Fades leave borders solid, and the hairline, edge, and strong line tokens (alphas 0.10, 0.20, 0.36) render at full alpha on every bordered control, so this is a visible design-fidelity bug today rather than an edge case; by visibility it ranks with items 1 to 3.
9. Straight alpha (R5.22). Correct on an opaque native window; becomes wrong the day the UI is composited over anything, and blocks sharing shaders with the WebGL implementation.
10. Circles are 64-segment fans with 64 border line groups that drop the owner's key (R5.15).
11. Focus trapping never wired (R9.20). Scopes are implemented and tested; `Dialog::contentFocusables` is never populated, so Tab cycles the background behind a modal.
12. The application synthesises a mouse-move event every frame and every widget recomputes hover from it, with nothing deriving enter and leave centrally; drags keep their own flags; dropdowns close each other by stealing focus (R9.8, R9.10, R9.14). The fix is two-sided: emit moves only on movement, derive hover in the dispatcher.
13. Inconsistent hit-test boxes and edge rules per component (R8.12).
14. No mount lifecycle; focusables register in constructors against a singleton that throws when absent (R8.14, R8.15).
15. Layout invalidation is manual and upward propagation is missing; "hug container freezes at last measured size" (R8.18, R10.18).
16. Layout runs lazily inside `render()`; positions are valid only after a render (R8.16).
17. Seven draw-only primitives outside the tree (R8.1).
18. Motion tokens generated but unused; of the z tokens only `z_modal` and `z_panel` are used and the library's own popups sit on literals; components hard-code durations (R11.13, R11.3).
19. Size derived from height in buttons (R11.10); tooltip width estimated at 7 px per character (R10.14); select caret drawn as the letters v and ^ (R12.12).
20. GPU timer scope excludes the final flush; no sanity check (R13.16, R13.18).
21. Draw-call statistics without flush reasons, binds, or upload bytes (R13.13, R13.14); memory and CPU fields read zero instead of null on Windows (R13.11).
22. `inputHandleMs` includes update (R13.7); per-window section maxima absent (R13.10).
23. Tree snapshot lacks `enabled`, `text`, and state (R13.22).
24. Golden screenshot comparison designed, never built (R13.37).
25. Same-VBO reuse across mid-frame flushes suspected of driver stalls (R3.24, R5.27).
26. Synchronous `glGetIntegerv` state save and restore in the planet renderer and the render-to-texture path (R2.15); harmless on native drivers, prohibited in the shared design.
27. Dead scaffolding and stale documents: the unused `BatchKey` and `DrawCommand` queue, the legacy `text.vert` and `text.frag`, `batched-text-rendering.md`'s unbuilt two-pass design, `primitive-rendering-api.md`'s scissor rules and `DrawTexture`, `clipping.md` phases 3 to 5, plus three stale spots: the RmlUI backend comment in `Primitives.h`, the gap-property comment in `LayoutLint.h`, and the "below dialogs (500)" comment in `ContextMenu.cpp` while dialogs sit at 200. Delete or mark superseded by this specification.
28. Positions are absolute (R8.10, R8.13, R13.22). Containers do not translate their children, every screen positions in window space, only the scroll container and the dialog offset their content, and the snapshot and lint work on absolute rectangles. A parent-local coordinate space, `screenBounds`, and a local-space snapshot are new and touch every screen's positioning code; ranks with items 14 to 17 by size.
29. One draw group per glyph (R6.18). Text is added a glyph at a time, so the sorted path is O(glyphs) on any frame that has a popup.
30. Composites render their own children (R8.1): the button (icon), select and dropdown (menu, chevron), and toast stack (toasts) draw them from `render()` outside the sorted walk.
31. The text shape never passes a font family (R6.4), so wrapped and shape text always uses the default atlas (a recorded follow-up).
32. Nits: the shader's clip test uses closed edges (`<`, `>`), so the edge pixel column survives (R4.4); the lint has no window-size flag for multi-resolution runs (R13.37).

Items 1 to 3 are one change and would remove the last class of ordering bugs in that codebase; items 4 to 8 are small and item 8 is the visible one; items 11 and 12 are the input model; the rest are independent. 16.4 orders them by what they buy that project.

## 16.3 What worldsim already does that the specification takes from it unchanged

For the record, so the gap list does not read as a verdict: the immediate-over-retained split, one uber shader with per-vertex material data, draw groups per call with a stable sort and a no-sort fast path, flush barriers as sort-domain boundaries, shadow-before-fill adjacency, per-vertex clipping that survives sorting, content offset before clip, logical-pixel coordinates with the ratio confined to the viewport and the clip test, MSDF text with a shared measure and render iteration and run snapping, the fixed, hug, fill layout engine and its 57-test suite (with the definite-axis rule, minimums, shrink-to-fit, anchors, and the `totalWeight` rule changed on top), the focus manager's tab index, wrap, and scope mechanics (with tab order derivation, scopes as subtree roots, and the singleton changed), the token pipeline, the tree snapshot and layout lint as a merge gate (with the schema and the coordinate space changed), the scene gallery with URL-style addressing and input injection, and the rejected-alternatives record (no depth test, no per-scissor flush, no overlay queue, no triangle sort). Those are the specification; the parentheses are where it moved.

## 16.4 A migration order for worldsim

Review 03 (the worldsim maintainer, chapter 17) ranked the gap list by what it buys that project on its next screens rather than by conformance, since its UI polish epic closed with zero lint violations and the queued work is gameplay and world rendering. The order is kept here so the two projects plan against the same list.

1. Layout freeze and upward invalidation (items 15 and, in part, 16; chapter 10, R10.5 and R10.18). One file plus a parent pointer set in `addChild`; removes the entity-info workaround; the definite flags that cause the freeze and its fix live in the same thirty lines. Write the two freeze tests of 10.9 first, because the current suite passes with the freeze in place.
2. One z key (items 1 to 3) in its integer form: add `Primitives::pushLayer(int)` for the six popup hosts, delete `RenderContext` and the per-widget offsets so `zIndex` is purely local, and keep the batcher's key an int; the named ladder is a constexpr table on top and costs nothing, and can wait for the next token regeneration. Walk layers first in dispatch using the same layer stamps as paint, which alone removes the game UI's hand ordering. Land the batcher sort unit test (chapter 2, R2.22) in the same change and delete `BatchKey`, `DrawCommand`, and the legacy text shaders (item 27). Two consequences to plan for: the HUD's lint-exemption z values become layer promotions, and the lint exempts pairs that differ in effective layer as well as in `zIndex` (chapter 13, the `sibling-overlap` rule); the world domain keeps its numeric keys under R3.23.
3. Small renderer corrections in one change: the three-state clip (item 4; keep `(0, 0, 0, 0)` as the shader's no-clip because the instanced and baked branches rely on it, and never upload a draw while the stack is empty, R4.1), a real clip on the text input (item 6), an explicit flat mode (item 7; a constant in `data2.w` and one branch), and an RGBA border (item 8, the visible win).
4. Focus scope wiring (item 11): derive a dialog's focusables from its subtree instead of the never-populated vector.
5. Central hover and a captor (item 12): stop synthesising a move every frame, derive enter and leave in one place, one captor pointer for the slider, scroll container, and text input. The bubble (R9.6) comes last; each earlier step is observable on its own.
6. Metrics hygiene (items 20 to 22) with the next performance capture.
7. Mount lifecycle and layout before render (items 14 and 16) when the next new screen is built, so the migration has a customer. `FocusManager::Get()` can stay as a shim during it. Two invariants the arena imposes: unmount runs before the arena's destructors, and the context outlives every component (chapter 8, 8.8).
8. Everything else (items 9, 10, 13, 17, 19, 23 to 26, 28 to 32) is opportunistic. Premultiplied alpha and parent-local coordinates pay off only if the UI is composited or shares code with the TypeScript implementation.

Removal in that codebase is a tombstone, not a free: the arena is a bump allocator, so `removeChild` marks the slot dead, the children and order views skip it, and `clearChildren` reclaims (chapter 8, 8.8). `reconcileChildren` is recommended there, not required (R8.27), since its documented idiom is clear-and-rebuild. The drag service, the component transform, and the animator score not applicable under chapter 14, R14.9 until a screen needs them.

Work already on worldsim's main that this list credits: the layout engine with its definite flags (kcjonson/worldsim#263), text snapping, unified measurement, and atlas validation (kcjonson/worldsim#258), the tree and lint harness (kcjonson/worldsim#259), stable handles under the z-sort and the HUD lint pass (kcjonson/worldsim#264), and the glyph UV clamp (kcjonson/worldsim#266). No unmerged branch carried UI engine work as of 2026-07-06.

