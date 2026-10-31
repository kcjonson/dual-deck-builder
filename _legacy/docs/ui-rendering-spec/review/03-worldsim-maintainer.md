# R3: worldsim maintainer review of the UI rendering specification (draft 2)

Reviewer lens: maintainer of worldsim (C++, OpenGL 3.3, libs/renderer and libs/ui). Every "worldsim does X" statement in chapters 0 to 16 was checked against the source at C:/Users/kevin/Code/worldsim, main at c2e06dd (2026-07-06), plus the dev log, technical docs, and git history. No branch, local or on origin, carries libs/ui or libs/renderer work newer than 1cd6e69 (2026-07-06); the only UI-relevant branch work since the spec's research pass is what merged as PRs #258, #259, #263, #264, #265, #266 and is already on main. The claude/whats-next branches sit at main.

Citations: `path:line` is relative to the worldsim repo root; hashes are worldsim commits; dev-log entries are under docs/development-log/entries/.

Overall: the provenance is good. Of roughly ninety checked statements, about seventy are accurate as written, a dozen are overstated or attribute a mechanism to the wrong place, and four are wrong in a way that would mislead a reader porting from worldsim (W1, W23, W31, W40). One structural fact is missing from the spec entirely (W60: worldsim positions are absolute, not parent-local), and it changes the size of the object-model migration the gap list implies.

## Part 1. Provenance findings

Format: id, severity (blocker | major | minor | nit), location, claim, evidence, verdict (accurate | inaccurate | outdated | overstated), proposed change.

### Chapter 3 (render order)

W1
- severity: major
- location: R3.14, 3.10, 3.11 last-but-one bullet, 16.2 item 1, chapter 14 rows "Stable group sort" and "Component zIndex never reaches the batcher"
- claim: "Worldsim forwarded it for Rectangle, Circle, Line, and Icon but not for Text or composite widgets."
- evidence: Rectangle, Circle, and Line forward the parent-set thread-local (Shapes.cpp:16,22,27 via RenderContext::getZIndex, set per child in Component.h:312). Icon forwards its own member (Icon.cpp:202,244). Nine composite widgets forward their own `zIndex` member with integer or fractional offsets: ContextMenu.cpp:300-334 (+0,+1,+2), DropdownButton.cpp:308-348 (+0.1F, chevron +1), Menu.cpp:143-173 (+1,+2), Select.cpp:311-365 (+0.1F), TextInput.cpp:546-671 (+1,+3, reading RenderContext), Toast.cpp:196-267 (+0.1F,+0.2F,+1), Tooltip.cpp:44-188 (+0.1F), TreeView.cpp:175-253 (labelZ = z+0.1F), ToastStack.cpp:60 (per-toast +index). Not forwarded at all (z 0): the Text shape (Shapes.cpp:222-229, addTextQuad with no z), Button.cpp:171-228, Dialog.cpp:293-304 (the scrim and panel of a z_modal dialog are z 0), Panel, Slider, TabBar, ScrollContainer, ProgressBar, ListRow, and the seven draw-only classes.
- verdict: inaccurate
- proposed change: "Three shapes forward the parent's z through a thread-local; nine composite widgets forward their own z with hand-picked offsets (+1, +2, +0.1); Text, Button, Dialog chrome, and the rest forward nothing. Two z sources coexist and no widget agrees with its neighbour." The "+0.1 fractional z" sentence is accurate and should stay.

W2
- severity: minor
- location: R3.14, 16.2 item 1 ("a close button's background hides its own label", "HUD shapes given a z for the layout lint float above open dialogs")
- claim: two specific incidents.
- evidence: Close button: TaskListView.cpp:66-92 adds a Rectangle at zIndex 2 and its label Text at zIndex 3; the Rectangle forwards 2, the Text forwards nothing, so the background sorts above the label. This is live code, not a logged incident. HUD shapes: EntityInfoView.cpp:191 sets z_panel (10) "exempts root-sibling overlaps in the layout lint" and WorldCreatorScene.cpp:501 z_modal "for the lint's sibling rule"; 037e113 "HUD lint pass: layered zIndexes". Because a Dialog draws its scrim and panel at z 0 (W1), any Rectangle child at z 10 does sort above an open dialog's chrome. The mechanism is real; no dev-log entry records either symptom.
- verdict: accurate (mechanism verified, symptoms uncited)
- proposed change: cite TaskListView.cpp and EntityInfoView.cpp so the claim is checkable, and note that the dialog chrome itself is z 0.

W3
- severity: nit
- location: R3.5, R3.9
- claim: token ordinals 0, 10, 20, 100, 200, 300, 400; literal values context menu 400, tooltip 500, menu 1000, toast 2000.
- evidence: Tokens.h:107-113; ContextMenu.cpp:19; TooltipManager.cpp:112; Select.cpp:40 and DropdownButton.cpp:44; GameUI.cpp:152 (the toast value is the game's literal, not the library's). In-game dialogs are z_modal 200 (GameUI.cpp:121-123) while ContextMenu.cpp:19 and the construction dev log say "dialogs 500"; worldsim is internally inconsistent here, the spec's ladder comparison still holds (tooltip 500 under menu 1000).
- verdict: accurate
- proposed change: none; optionally note that 2000 is app code.

W4
- severity: minor
- location: R3.7, 3.10 "Deferred overlay queue (worldsim commit b5dc8be, reverted in f1ff5ac)"
- claim: built and reverted the same day; needed opt-in routing in every popup host.
- evidence: b5dc8be and f1ff5ac both 2026-06-16; 2026-06-16-ui-salvage-reconcile-onto-main.md:13-29 records the revert of `submitOverlay`; b5dc8be touched only DropdownButton.cpp and Select.cpp, which is the opt-in routing.
- verdict: accurate
- proposed change: none.

W5
- severity: minor
- location: R3.13, 3.11 "Child handles pointed at the wrong child after the first z-sort"
- claim: in-place sort broke handles.
- evidence: 7d325e9 (2026-07-03) "stable child handles under z-sort"; Component.h:368-371 comment; Layer.test.cpp:115 HandlesSurviveZIndexSort. The in-place sort had existed since 2025-12; it bit when the HUD lint pass (037e113, same day) gave siblings distinct z.
- verdict: accurate
- proposed change: none.

W6
- severity: minor
- location: R3.21 "Worldsim's construction pass sorted above dialogs for a month"
- claim: duration.
- evidence: foundation drawing landed 2026-06-12 (a886921), the barrier 2026-07-03 (3cdb9b1): three weeks. Per 2026-07-03-construction-layering-story-b.md:17-24 it was previews (z 899-910) that beat dialogs; committed construction (z 50-64) beat plain panels.
- verdict: overstated
- proposed change: "for three weeks" or drop the duration; say previews beat dialogs and committed construction beat panels.

W7
- severity: minor
- location: R3.24, 16.2 item 25
- claim: "+0.9 ms at one extra flush with 90 buildings, partly a same-buffer reuse stall".
- evidence: 2026-07-03-construction-layering-story-b.md:78-84: scene-render CPU median 2.19 to 3.11 ms at 90 buildings; the change added two mid-frame flushes (committed pass and the UI barrier), and the entry says entityRenderMs rose "pointing at driver-side buffer sync on the shared batch VBO ... the same-VBO in-frame reuse hazard already flagged in the Story A review, tracked under Story C".
- verdict: accurate (detail: two flushes, not one; "suspected" is the right word and item 25 uses it)
- proposed change: "two extra flushes".

W8
- severity: minor
- location: 3.11 first bullet
- claim: text invisible because "text was drawn immediately while rects were batched, and again after batching text because of a premature text flush inside the layer walk".
- evidence: 2025-11-25-completed-sdf-text-rendering-epic-phase-5-polish.md:35 records the premature text flush in LayerManager::RenderLayers; 2025-11-30-uber-shader-epic-complete.md:6 records merging text into the uber shader "enabling correct z-ordering". A separate TextBatchRenderer existed before the merge; "drawn immediately" is not in the log.
- verdict: accurate for the second half, unrecorded for the first
- proposed change: "text lived in a separate batch with its own flush" for the first half.

W9
- severity: minor
- location: 3.11 "Popup painted on top but clicks went to the widget beneath"
- claim: an incident.
- evidence: the mechanism is real (Component.h:338-359 dispatches each parent's reversed local order; GameUI.cpp:278-314 hand-orders dialogs and the toast stack to compensate), but no dev-log entry records this symptom. Note that Select and DropdownButton route events to their own menu first inside handleEvent, so the menu is reachable wherever its host is; the failure needs an earlier sibling subtree to consume first.
- verdict: accurate (uncited)
- proposed change: cite GameUI.cpp:278-314 as the evidence, or mark it as a consequence rather than an incident.

W10
- severity: nit
- location: 3.11 "Colonists always drew over trees", R3.23 ground-contact Y
- evidence: docs/technical/rendering/world-depth-sorting.md:11,17,26,46,83.
- verdict: accurate
- proposed change: none.

W11
- severity: nit
- location: 3.11 "Top bar and gameplay bar backgrounds given zIndex 500 and 400"; "Dropdown and select menus painted behind sibling widgets"
- evidence: 2025-12-28-information-systems.md:29-31; 2025-12-27-ui-complex-components.md:100 and 2026-06-16-ui-salvage-reconcile-onto-main.md:15-18.
- verdict: accurate
- proposed change: none.

W12
- severity: minor
- location: 16.1 mapping "one DrawGroup {indexStart, indexCount, zIndex} per call", 16.3 "draw groups per call"
- claim: one group per draw call.
- evidence: BatchRenderer.cpp:120-128 records a group per add* call; the Text shape and Primitives::drawText call addTextQuad once per glyph (Shapes.cpp:221-230), so text is one group per glyph. The z-sort (BatchRenderer.cpp:540-549) sorts glyph groups individually.
- verdict: overstated
- proposed change: "per add call, which for text is per glyph"; R6.18's one-group-per-drawText is therefore a change for worldsim, not a codification.

### Chapter 4 (clipping)

W13
- severity: nit
- location: R4.2, 16.2 item 4
- claim: (0,0,0,0) is both "no clip" and the disjoint result.
- evidence: Primitives.cpp:529-551 (IntersectClipBounds returns (0,0,0,0) on no overlap; lines 530-537 treat an empty rect as "use the other"); uber.frag:89-90 treats maxX <= minX as no clip. A clip rect with zero width also collapses to "no clip" the same way.
- verdict: accurate
- proposed change: none.

W14
- severity: minor
- location: R4.7, 4.6 "the transform rule its own code comments flagged as a hazard", 16.2 item 5
- claim: clip rects never transformed; flagged as a hazard in code comments.
- evidence: ComputeClipBounds (Primitives.cpp:471-480) uses the rect verbatim and pushClip never consults g_currentTransform; ScrollContainer.cpp:214-229 and Dialog.cpp:407-417 build their clips from absolute content positions, so nesting inside an offset ancestor mis-clips. No code comment in libs/ui or libs/renderer flags this; the only "hazard" comment in the area is the same-VBO reuse note in the dev log.
- verdict: accurate for the mechanism, overstated for the provenance
- proposed change: drop "its own code comments flagged".

W15
- severity: nit
- location: R4.5, 16.2 item 6
- evidence: Primitives.cpp:630-656 (PushScissor "TODO: Apply to OpenGL state"); TextInput.cpp:129,139.
- verdict: accurate
- proposed change: none.

W16
- severity: minor
- location: R4.4 "Two of worldsim's recorded clipping bugs lived in this conversion (bounds scaled on the CPU while the shader assumed logical, and the Y flip)"
- evidence: 2025-11-29-shader-based-rect-clipping-phase-1-complete.md:44-49 records one bug and its fix, and the direction is the reverse of the spec's wording: the shader compared logical bounds against physical gl_FragCoord, and the fix scaled the bounds. Today the scaling lives in the shader (uber.frag:92, u_pixelRatio) and the flip at uber.frag:96. The Y flip is code, not a logged incident.
- verdict: overstated
- proposed change: "one recorded bug (logical bounds compared against physical fragment coordinates); the Y flip is the other place the ratio must be right".

W17
- severity: major
- location: chapter 14 row "Offset before clip; hit testing honours clip and offset: partial (offset yes; hit testing ignores clip)", R4.12
- claim: worldsim hit testing ignores the clip.
- evidence: ScrollContainer::handleEvent returns false for points outside its viewport before dispatching to children (ScrollContainer.cpp:136-138), so a scrolled-out child is not clickable in the one container that scrolls. The generic Container ignores its clip (Container.h:38-55) and only ScrollContainer and Dialog set one (grep setClip: Dialog.cpp:411, ScrollContainer.cpp:225).
- verdict: inaccurate in the parenthetical
- proposed change: "partial (offset yes; ScrollContainer gates on its viewport, the base Container does not)".

W18
- severity: nit
- location: R4.15, R4.16
- evidence: bounding-box approximation Primitives.cpp:482-522; ClipMode::Outside advertised in ClipTypes.h:52-54 and unimplemented (Primitives.h:305-310).
- verdict: accurate
- proposed change: cite ClipTypes.h as the example R4.16 exists for.

W19
- severity: nit
- location: 4.6 "a list of 35 items in three nested clips into 35 draw calls"
- evidence: clipping.md:273 "3 nested rect clips, 35 shapes: 1 draw vs 35+ draws".
- verdict: accurate
- proposed change: "35 shapes".

### Chapter 5 (primitives and shading)

W20
- severity: minor
- location: R5.2, 16.2 item 7
- claim: tessellated triangles hit smoothstep(0, 0, x).
- evidence: BatchRenderer.cpp:373-377 packs shapeParams (0,0,0,1) and zero data1; uber.frag:121-147 then gives dist 0, pixelSize 0, and smoothstep(0, 0, 0), undefined in GLSL. drawLine also goes through addTriangles (Primitives.cpp:322), as do circle fans and their 64 border segments, and every Icon stroke.
- verdict: accurate, under-scoped
- proposed change: "every line, circle, polygon, and icon", not only tessellated triangles.

W21
- severity: minor
- location: R5.7 "Worldsim's API defaults to center while nearly every one of its components overrides to inside"
- evidence: PrimitiveStyles.h:25 (BorderStyle::position = Center), BatchRenderer.cpp:171; uses across libs/ui and apps: 69 Inside, 5 Outside, 0 Center.
- verdict: accurate
- proposed change: none.

W22
- severity: nit
- location: R5.12 "Worldsim's first version put full strength at the edge"
- evidence: 91d6ed5 diff of uber.frag: smoothstep(0.0, blur, dist) became smoothstep(-blur, blur, dist).
- verdict: accurate
- proposed change: none.

W23
- severity: major
- location: R5.8, R3.25, 16.2 item 8, and by consequence R11.5
- claim: border RGB plus width in one vec4, border forced opaque, fades leave borders solid.
- evidence: BatchRenderer.h:43, BatchRenderer.cpp:173, uber.frag:171 (finalAlpha = mix(fill.a, 1.0, borderBlend)). Accurate, and it has a consequence the spec misses: the design tokens line_hairline, line_edge, and line_strong carry alphas 0.10, 0.20, 0.36 (Tokens.h) and are used as SDF border colours everywhere (Button.cpp:182, Dialog.cpp:302, 69 Inside borders), so every token-coloured border in worldsim renders at full alpha today. The "three line alphas" of R11.5 are unachievable through worldsim's border path until item 8 is fixed, which makes item 8 a visible design-fidelity bug, not a fade edge case.
- verdict: accurate, incomplete
- proposed change: add the token-alpha consequence to item 8 and raise it in the ranking (see Part 3).

W24
- severity: minor
- location: 5.9 "about 25 ALU operations per pixel", "five-times vertex reduction"
- evidence: docs/technical/ui-framework/sdf-rendering.md:45,62 (5x, 20 vertices to 4) and :64 ("~15-20 ALU ops per pixel").
- verdict: overstated on the ALU count
- proposed change: "15 to 20".

W25
- severity: nit
- location: R5.28 uniform defaulting to zero
- evidence: BatchRenderer.cpp:58-62 (u_bakedAlpha, instanced pass).
- verdict: accurate
- proposed change: note it was the baked entity pass, not the UI.

W26
- severity: minor
- location: R2.15, R15.22, 16.2 item 26 "Synchronous glGetIntegerv state save and restore around raw passes", "worldsim used them around every raw pass"
- evidence: glGetIntegerv is used by libs/planet-view/PlanetRenderer.cpp:125-240 and libs/renderer/resources/RenderToTexture.cpp:31-32 (plus the screenshot path and PlanetScene). The entity, chunk/tile, groundcover, construction, and overlay passes do not query GL state.
- verdict: overstated
- proposed change: "the planet renderer and render-to-texture wrap their passes in glGetIntegerv save and restore".

W27
- severity: nit
- location: R5.15, 16.2 item 10
- evidence: Primitives.cpp:341-398; the border is 64 drawLine calls without a zIndex, so 64 groups at z 0 beside one fill group at the owner's z.
- verdict: accurate
- proposed change: none.

W28
- severity: nit
- location: R5.22, R5.27, 16.1 "one VBO and IBO", "80-byte UberVertex"
- evidence: BatchRenderer.cpp:553-568 (GL_SRC_ALPHA blend, glBufferData every flush, single vbo and ibo); UberVertex is two Vec2 and four Vec4, 80 bytes.
- verdict: accurate
- proposed change: none.

W29
- severity: nit
- location: R2.20 "worldsim carried an id on every draw call for this and never read it back"; R2.21; R2.22
- evidence: Primitives.cpp forwards args.id only into the circle's inner drawTriangles (383); nothing stores or reads it. Every Primitives call early-returns without a batcher (Primitives.cpp:326,336,402,554) and ui-tests link no GL context (libs/ui/CMakeLists.txt:57-76). BatchRenderer.test.cpp has two tests (vertex size, constants); the sort has a benchmark (ZSort.bench.cpp) and no test.
- verdict: accurate
- proposed change: none.

### Chapter 6 (text)

W30
- severity: nit
- location: R6.2, R6.3, R6.8, R6.16, R6.17
- evidence: 9bcb4c2 body ("drop the full-cell UV fallback that sampled neighboring glyphs", "stable centered/right-aligned text"); FontRenderer.cpp:26-35 ('?' fallback), :256-262 (missing bounds warned and rendered as whitespace); BatchRenderer.cpp:430-455 and 251a776 (run snap cache). The 2026-07-03 polish entry records the ASCII-only atlas with degree, middle dot, and superscript two rendering as fallback boxes, which is exactly R6.3's coverage list.
- verdict: accurate
- proposed change: cite the follow-up for R6.3.

W31
- severity: major
- location: chapter 14 row "Ascent centring, greedy wrap, ellipsis: yes"
- claim: worldsim has ellipsis overflow.
- evidence: no "ellipsis" anywhere in libs/ui; Text has no overflow mode (Shapes.h:172-248).
- verdict: inaccurate
- proposed change: "partial (no ellipsis)".

W32
- severity: nit
- location: R6.9 kerning "applied when present", 16.1 mapping of FontRenderer
- evidence: FontRenderer has no kerning support (no kern table use); wrapText "breaks at spaces/punctuation, not mid-word" (FontRenderer.h:126). The mapping does not claim kerning, but R6.9 could be read as codified practice.
- verdict: accurate (no claim), worth a note
- proposed change: mark kerning as a spec addition.

W33
- severity: nit
- location: R6.4 multiple atlases per flush
- evidence: BatchRenderer.cpp:610-658 splits GPU draws per atlas in emit order; but the Text shape never passes a family (Shapes.cpp:222-229), so wrapped and shape text always uses Roboto, a recorded follow-up ("font-family threading for wrapped text").
- verdict: accurate
- proposed change: note the follow-up in the chapter 14 row for multiple atlases.

### Chapters 8 and 9 (object model, input, focus)

W34
- severity: nit
- location: R8.7, R8.15, R8.16, R8.18, R8.1
- evidence: no removeChild (Component.h:246-332, clearChildren only); FocusManager::Get throws before setInstance (FocusManager.cpp:12-18) and FocusableBase registers in the constructor (FocusableBase.h:45-47); layout runs in LayoutContainer::render (LayoutContainer.cpp:63-69) and LayoutContainer.test.cpp calls render() 46 times to lay out; manual invalidation is documented (LayoutContainer.h:50-51); the seven draw-only classes are plain (panel/Panel.h:29, badge/Badge.h:21, avatar/Avatar.h:21, stat/Stat.h:19, keycap/KeyCap.h:20, divider/Divider.h:20, segmentedcontrol/SegmentedControl.h:24).
- verdict: accurate
- proposed change: none.

W35
- severity: minor
- location: R8.12 "Worldsim mixed margin-box and content-box hit tests and <= versus < per component"
- evidence: Button.cpp:232-235 and Slider.cpp:241-244 test the margin box; ScrollContainer.cpp:177-183 tests the content box; all three use closed edges (<=). I found no site using `<`.
- verdict: half accurate
- proposed change: keep the margin-box versus content-box half, drop "<= versus <" or cite the `<` site.

W36
- severity: minor
- location: R8.1 "a component MUST NOT render its children itself", chapter 14 row "Single interface incl. primitives: partial (seven draw-only primitives)"
- evidence: worldsim composites render children directly and outside Component::render's sorted walk: Button.cpp:213 (icon), Select.cpp:371 and DropdownButton.cpp:349,355 (menu, chevron), ToastStack.cpp:227 (toasts). That is the "popup drawn inline with a special key" pattern R3.19 forbids.
- verdict: accurate for the primitives, incomplete
- proposed change: add "composites render their own children" to the row and to gap item 17 or a new item.

W37
- severity: minor
- location: R8.2 margin "per side ... a number as the uniform shorthand", R8.11 "This is worldsim's convention", 16.1 mapping
- evidence: IComponent::margin is one float (Component.h:76); reported size is content plus margin times two (Component.h:211-214). Per-side margin is a spec change; padding is per side (LayoutTypes.h:36-49).
- verdict: accurate on the reporting convention, silent on the change
- proposed change: say per-side margin is new.

W38
- severity: major
- location: R9.8 "which is what every worldsim widget did", 16.2 item 12 "Every widget recomputes hover from containsPoint per frame", 9.10
- claim: per-frame hover polling in widgets.
- evidence: no widget's update() polls containsPoint (every update body in libs/ui/components checked); hover is set on MouseMove in handleEvent (Button.cpp:268-273, TabBar.cpp:77-79, Slider.cpp:277-284, Menu.cpp:91-95), and InputEvent.h:9 records the design ("MouseMove events are used for hover state instead of per-frame polling"). But Application.cpp:163-164 synthesises a MouseMove every frame whether or not the pointer moved, so in effect every widget's containsPoint runs every frame through dispatch.
- verdict: accurate in effect, mechanism misdescribed
- proposed change: "the application synthesises a MouseMove every frame and every widget recomputes hover from it; nothing derives enter and leave centrally". The fix is two-sided: emit MouseMove only on movement, and derive hover in the dispatcher.

W39
- severity: nit
- location: R9.10, R9.11, R9.14, R9.15, R9.18, R9.20, R9.21, R9.23, R9.2, R13.36
- evidence: Slider.cpp:258-284 `dragging`, ScrollContainer.cpp:115-131 `isDraggingThumb`; ContextMenu.cpp:37,166-167 ignoreNextMouseUp; DropdownButton.cpp:224-225 ("Request focus - this will close other dropdowns via onFocusLost"), Select.cpp:381-383; FocusManager.cpp:207-211 routes keys to the focused component only and Dialog.cpp:65-66 takes focus "so we receive keyboard input (Escape to close)"; registration-order tab index FocusManager.cpp:31-52; contentFocusables declared (Dialog.h:126) and read (Dialog.cpp:39,70-71) but written nowhere in libs or apps, with 21 scope references in FocusManager.test.cpp; pure-virtual crash 2025-12-24-focusmanager-simplification.md:42-46 and FocusManager.cpp:66-72; Button never focuses on click (Button.cpp:243-249) and draws the ring whenever focused (200-204); per-frame synthesis from polled state Application.cpp:163-190 with scroll arriving through a GLFW callback and dispatched once per frame; the collapse note DebugServer.cpp:607-612 and InputManager.h:71-74.
- verdict: accurate
- proposed change: none.

W40
- severity: major
- location: R9.6 "Worldsim had no bubbling and its dialogs and menus had to be dispatched first by hand in every scene", 9.10
- claim: the absence is presented as an omission.
- evidence: docs/technical/ui-framework/event-system.md:235-247 records "Why Single Top-Down Pass (No Bubbling)" as a decision with reasons (flat UI, no default actions to prevent, z sorting gives layering). GameUI.cpp:278-314 is the hand ordering.
- verdict: accurate but unfair to the record
- proposed change: acknowledge the recorded decision and answer its reasons in 9.10 (the reasons stopped holding once popups were nested and dialogs needed Escape).

W41
- severity: minor
- location: R10.14 "Worldsim's dropdown and tab bar drifted until they measured the transformed string, and its tooltip still estimates seven pixels per character"
- evidence: 8681dfd (2026-06-16) "measure with the rendered font/case" touched Stat.cpp, TabBar.cpp, Tooltip.cpp; the dropdown was restyled separately (190bb96). Tooltip.h:81 kEstimatedCharWidth 7.0F; TooltipManager.cpp:215-233.
- verdict: accurate except "dropdown"
- proposed change: "stat and tab bar".

### Chapter 10 (layout)

W42
- severity: nit
- location: 10 intro, R10.5, R8.18, 16.2 items 15 and 16
- claim: engine shipped July 2026; resolved axes permanently definite; freeze recorded in the log.
- evidence: 3c9d00e and 7201ef6 (2026-07-03, PR #263); LayoutContainer.h:30-37, LayoutContainer.cpp:78-89 (setLayoutSize sets definite and nothing clears it) and :304-306 (a parent passes a nested container its own measured size through layout(), so both axes become definite after the first pass); 2026-07-03-game-ui-prototype-polish.md Known follow-ups ("Nested layout() freezes a Hug container at its last measured size; EntityInfoView resets hug axes on content change as a workaround").
- verdict: accurate
- proposed change: none.

W43
- severity: minor
- location: 10.9 "Port worldsim's stack container suite"
- evidence: 57 tests in LayoutContainer.test.cpp; every listed behaviour has a named test (PlainChildLayoutIsNotCalled, FillContainerResolvedToZeroReportsZero, NestedContainerReceivesResolvedSize, WrapAwareFillChildGrowsHugHeight, OverflowDegradesToStart, CrossOverflowDegradesToStart, NestingThreeDeepPropagatesStretch, StretchResizesHugChildMinusMargin, StretchLeavesFixedChildrenAlone, CrossAxisFillStretchesWithoutStretchAlign, FillChildMarginComesOutOfLeftover, FillWithNoLeftoverGetsZero, six Distribution tests, GapGrowsHugMainAxis, PaddingOffsetsChildrenAndGrowsHugSize). One divergence: R10.8 says fill children receive 0 when totalWeight is 0; LayoutContainer.cpp:211-213 returns early and they keep their intrinsic size, and no ported test pins it.
- verdict: accurate; the totalWeight rule is a change
- proposed change: mark "totalWeight 0 gives zero" as new in 10.9's second list (it is listed there, but the intro says the port is the conformance suite).

### Chapter 11 (tokens)

W44
- severity: major
- location: 11 intro, R11.3, 16.2 item 18 "Motion and z-layer tokens generated but unused"
- evidence: dur_fast, dur, dur_slow (Tokens.h:102-104) are referenced nowhere outside the header. Of the z tokens, z_modal is used four times (GameUI.cpp:121-123, ColonistDetailsDialog.cpp:81, WorldCreatorScene.cpp:501) and z_panel once (EntityInfoView.cpp:191); z_base, z_raised, z_overlay, z_toast, z_tooltip are unused and the library's popups use literals (400, 500, 1000).
- verdict: overstated
- proposed change: "motion tokens unused; of the z tokens only z_modal and z_panel are used, and the library's own popups use literals".

W45
- severity: nit
- location: R11.13, 16.2 item 18 hard-coded seconds
- evidence: Dialog.h:129-130 (0.15, 0.10), TooltipManager.h:86-87 (0.1, 0.08), Toast.h:117-118 (0.2, 0.3), Tooltip.h:24 (0.5 hover delay), TooltipManager.h:90 (4 px move tolerance).
- verdict: accurate
- proposed change: R12.22 and R12.23 assign dur_fast (120 ms) and dur_slow (360 ms) where worldsim uses 100 ms and 300 ms; say the port changes the timing, or take worldsim's values.

W46
- severity: minor
- location: R11.2 "worldsim deleted its hand-maintained theme header once the generator existed because the two had drifted"
- evidence: 6bab77e / f798661 body: "PanelStyle.h had zero consumers; deleted ... Tokens.h is the single source of truth"; drift is not the recorded reason.
- verdict: overstated
- proposed change: "deleted its hand-maintained theme header as the last step of the token cutover".

W47
- severity: major
- location: R11.11 "worldsim's tab bar tracked hover without drawing it"
- evidence: TabBar.cpp:244-257 selects m_appearance.hover for TabState::Hover and TabBarStyle.h:64-74 gives it a distinct fill and text colour; what is true is the exclusive priority Disabled > Active > Hover > Normal (TabBar.cpp:268-278), so a hovered selected tab shows no hover.
- verdict: inaccurate
- proposed change: "worldsim's tab bar resolves one exclusive state, so a hovered selected tab shows no hover treatment", which is the point R11.11 needs.

W48
- severity: nit
- location: R11.5 to R11.10, 16.2 item 19
- evidence: five surfaces bg_void, bg_base, bg_panel, bg_panel_raised, bg_inset; line alphas 0.10, 0.20, 0.36; accent and data with status_warn equal to accent and status_info equal to data; radii 0, 1, 2, 4, 8, 14, 999; space_0_5 2 and space_1_5 6 on a 4 px base; ls_wide 0.08 and ls_wider 0.16; fs_base 13 (Tokens.h). Button font size from height: Button.cpp:25-34. Select caret letters: Select.cpp:356. The `control` category (control_h_*, icon_*, focus_ring_*, drag_threshold_*, tooltip_delay, hover_move_tolerance) does not exist in worldsim's token file; those values are literals today.
- verdict: accurate; the control category is an addition
- proposed change: mark `control` as new in R11.3.

W49
- severity: minor
- location: chapter 14 row "Accepted style properties rendered: yes" (worldsim)
- evidence: worldsim has no CSS-named style object; it has typed RectStyle, TextStyle, BorderStyle structs.
- verdict: inaccurate
- proposed change: "not applicable (typed style structs)".

### Chapter 12 (catalog)

W50
- severity: nit
- location: R12.21, R12.12, R12.8, R12.15, R12.27, R12.28, R12.26, R12.19, R12.24, R12.25, R12.22
- evidence: Dialog.test.cpp 18 tests; Dialog.h:98-102 Closed/Opening/Open/Closing, open ignored unless Closed (Dialog.cpp:48), close ignored when Closed or Closing (76); Select.cpp:356 ("^" / "v"); 2026-06-18-dialog-listrow-migration.md:5 (Button always centres and uppercases); Slider.cpp:59-73 (pow and log with positive-bounds guard); Avatar.cpp:26-32,74-77 (FNV-1a, 0.3 and 0.55 bands); Stat.cpp:75 (0.62); Badge.h:37 (static MeasureWidth); Panel.h Args (title, kicker, variant, accent, corners, compact, flush, glow; no actions slot); ProgressBar.h Args (value, tone Auto, label, valueText, size, segmented, inlineLabel); TreeView has no onSelect; Tooltip.h:29-31 title/description/hotkey, fade out 0.08, move tolerance 4.
- verdict: accurate
- proposed change: none.

W51
- severity: minor
- location: R12.11 Menu "items (label, onSelect, enabled, separator, shortcut), width, hoveredIndex, maxHeight ... Tests: port"
- evidence: MenuItem is label, onSelect, enabled (Menu.h:28-32); no separator, shortcut, or maxHeight, and a tall menu does not scroll.
- verdict: partly additions presented as port
- proposed change: mark separator, shortcut, maxHeight, and internal scrolling as additions to the ported suite (26 tests).

W52
- severity: minor
- location: R12.30 "worldsim had three copies with different flip rules"
- evidence: TooltipManager.cpp:179-187 flips on both axes; ContextMenu::openAt clamps (ContextMenu.cpp:22-32); DropdownButton uses an explicit openUpward flag with no viewport check (DropdownButton.cpp:26,89).
- verdict: roughly accurate
- proposed change: "two placement routines (flip, clamp) and one manual flag".

W53
- severity: nit
- location: R12.20 ScrollContainer, chapter 14 "Catalog: mostly (no image, checkbox, toggle)"
- evidence: scrollTo, scrollBy, scrollToTop, scrollToBottom exist (ScrollContainer.h:50-53); no scrollIntoView; not focusable; wheel is 40 px per tick (ScrollContainer.h:79); 15 tests. Also absent from worldsim: Popover, RadioGroup, FocusGroup, NumberInput, ScreenTransition, Counter, standalone Scrollbar.
- verdict: accurate; the parenthetical undercounts
- proposed change: list the absent components once, in 14.4.

### Chapter 13 (observability)

W54
- severity: nit
- location: R13.5, R13.7, R13.9, R13.11, R13.15, R13.16, R13.19, R13.20, 13.12
- evidence: 352 ms GPU timer and "query window also misses the uber-batch flush" 2026-06-09-render-performance-analysis.md:43; draw calls 3 at :36-37; inputHandleMs spans the scene update (Application.cpp:131-236); dt clamp 0.25 (Application.cpp:119-121); SystemResources.cpp is macOS-only and the 2026-06-10 follow-up says "SystemResources still returns 0 on Windows"; GPU timer begins and ends inside GameScene::render (GameScene.cpp:964,1046) while the final UI flush runs in the overlay renderer's endFrame (AppLauncher.cpp:461), and the construction entry's "Metric caveat" confirms the scope; glFinish 6-15 ms docs/debug-swapbuffers-performance.md:19-22; 15.6 ms tick 2026-06-10-render-performance-overhaul.md:31-32 and Application.cpp:105; p99 64 ms hitches :65; 50 concurrent curl requests 2025-10-27-ui-sandbox-implementation-lock-free-performance-mo.md:34.
- verdict: accurate
- proposed change: none.

W55
- severity: minor
- location: 13.12 "A mutex-guarded metrics buffer could block the game thread; it was replaced by a lock-free single-writer ring"
- evidence: 2025-10-26-observability-web-ui-with-real-time-logging.md:9-14 describes the design as lock-free from the start ("Zero mutex/locks in game thread path"); no replacement of a mutex version is recorded.
- verdict: overstated
- proposed change: "was designed as a lock-free single-writer ring and stress-tested".

W56
- severity: minor
- location: 13.12 "Windows __FILE__ backslashes produced invalid JSON and a silently empty log view"
- evidence: not in the dev log; it is commit d8f480c (2026-06-28) "Fix developer-client logs silently dropping every entry".
- verdict: accurate, uncited
- proposed change: cite the commit.

W57
- severity: nit
- location: R13.10 "The last item is the one worldsim lacked and listed as its top follow-up"; R13.22; R13.25; 13.11 mapping
- evidence: 2026-06-10 Known follow-ups lists "per-frame attribution tooling (Phase 4 max-breakdown metrics)" first; the window is 60 frames (MetricsCollector.cpp:15-16). UiTreeSerializer.cpp:18-24 emits id, type, bounds, margin (a number), zIndex, visible, children, and the root carries viewport and roots; the spec's list omits id and type. LayoutLint.h:28-36 has the four rules plus a reserved SiblingGapMismatch whose comment ("not implementable until LayoutContainer grows a gap property") is now stale; epsilon 0.5 (LayoutLint.cpp:11). Endpoints, control actions, injection grammar, --scene, DEVELOPMENT_BUILD (logging only, foundation/CMakeLists.txt:25, Log.h:51,77), renderer-benchmarks target, scripts/perf-capture.ps1: all as mapped.
- verdict: accurate
- proposed change: add id and type to the R13.22 sentence.

### Chapter 14 (worldsim column)

W58
- severity: minor
- location: 14.4 table
- claim: several worldsim cells.
- evidence: see W17 (hit testing and clip), W31 (ellipsis), W36 (composites render children), W49 (style properties). "State stacks captured per draw: partial (transform, clip; no opacity, no layer)", "Draw calls incl. image and flat: partial", "Mount lifecycle: no", "Frame order: no (layout in render)", "Focus manager: partial", "Tree snapshot: partial", "Dev-only exclusion: partial", "Batcher counters with reasons: no" are all accurate.
- verdict: four cells wrong or incomplete
- proposed change: apply W17, W31, W36, W49.

### Chapter 16 (mapping, gap list, 16.3)

W59
- severity: minor
- location: 16.2 items 1 to 27
- evidence: items 1, 12, 18, 26 need the corrections in W1, W38, W44, W26; item 7 should cover lines, circles, and icons (W20); item 8 should carry the token-alpha consequence (W23); item 27 is accurate (BatchKey, DrawCommand, g_commandQueue at Primitives.cpp:26-61,84; text.vert and text.frag referenced only in comments; batched-text-rendering.md sections 3 and Phase 4 two-pass; primitive-rendering-api.md DrawTexture at :129 and scissor flush at :230; clipping.md phases 3 to 5 at :299-313) and could add three more stale spots: Primitives.h:6 ("RmlUI backend"), LayoutLint.h:33-35 (gap property comment), ContextMenu.cpp:19 ("below dialogs (500)" while dialogs are 200). Items 2 to 6, 9 to 11, 13 to 17, 19 to 25 are accurate as written.
- verdict: mostly accurate
- proposed change: as listed.

W60
- severity: major
- location: R8.10, R8.11 "This is worldsim's convention", R8.13, R13.22, 16.2 (missing item), 16.3 "the tree snapshot and layout lint"
- claim: coordinates are local to the parent's content box, and the snapshot's `bounds` is in that space; the object model chapter presents this as codified practice with the margin-box convention.
- evidence: worldsim positions are absolute. Component::render does not translate children by the parent's position (Component.h:305-315); Rectangle, Text, Button, and LayoutContainer all place themselves in screen space (LayoutContainer.cpp:226 computes contentOrigin from its own absolute position and calls child->setPosition with absolute values); only Container's content offset translates (Container.h:84-87), and ScrollContainer and Dialog set that offset to their own absolute content origin so their children can be authored at (0,0) (ScrollContainer.cpp:229, Dialog.cpp:416). The serializer emits absolute bounds (uiElementBounds from getPosition) and the lint's containment and overlap tests compare absolute rectangles. Only the margin-box reporting (W37) is worldsim's convention.
- verdict: inaccurate by omission
- proposed change: (a) in R8.11 say only the margin-box reporting is worldsim's; (b) add a gap-list item "positions are absolute; a parent-local coordinate space, screenBounds, and a local-space snapshot are new", ranked with items 14 to 17 because every screen's positioning code is touched; (c) in 16.3 qualify "tree snapshot and layout lint" (schema and coordinate space change) and likewise "the focus manager" (tab order derivation, scopes as subtree roots, and the singleton all change) and "the fixed, hug, fill layout engine with its test suite" (definite-axis rule, minimums, shrink-to-fit, anchors, totalWeight rule change).

W61
- severity: minor
- location: 16.2 (missing items)
- evidence: (1) one draw group per glyph (W12), which makes the sorted path O(glyphs) on any frame with a popup; (2) composites rendering their own children (W36); (3) the Text shape ignoring font family (W33); (4) closed-interval clip test (uber.frag:99-100 uses `<` and `>`, so the edge pixel column survives); (5) no window-size flag for multi-resolution lint (2026-07-03 follow-up), which R13.37's fixed viewport needs.
- verdict: incomplete
- proposed change: add (1), (2), and (3) as items; (4) and (5) as nits.

### Other chapters (1, 2, 7, README)

W62
- severity: nit
- location: 1.8 "recorded in its integration architecture in 2025 as components, primitives API, batch renderer, OpenGL"
- evidence: docs/technical/ui-framework/colonysim-integration-architecture.md (created 2025-10-29), layers 4 to 1 at :25-70.
- verdict: accurate
- proposed change: none.

W63
- severity: minor
- location: R1.6 "There are no globally reachable singletons in layers 2 to 4", chapter 14 row "Mount context, no singletons: no (focus, tooltip, input singletons)"
- evidence: the draw API itself is process-wide static state (Primitives.cpp:64-84, g_batchRenderer and friends) reached from every shape's render(). By the rule's letter worldsim also fails on the draw API, which the spec elsewhere treats as fine ("Renderer::Primitives free functions" in 16.1).
- verdict: the rule and the mapping disagree
- proposed change: scope R1.6 to services (focus, popup, tooltip, input, clock) and say the draw API MAY be a process-wide instance in C++ as long as components do not reach GPU objects through it.

W64
- severity: nit
- location: R7.5 "This is the design worldsim recorded for its UI scale setting"
- evidence: docs/design/ui/ui-scale-setting.md, status "planned (requirements only)", requirement "Applies to layout, not just zoom".
- verdict: accurate
- proposed change: say "recorded, not built".

W65
- severity: nit
- location: README "after a year of production use"
- evidence: the UI library's first entries are 2025-10 to 2025-11; the Salvage cutover was 2026-06; the layout engine 2026-07. About ten months of development, a few months of the current shape.
- verdict: overstated
- proposed change: "after a year of development".

## Part 2. Design critique from worldsim's point of view

Each item: would I accept it, is it feasible without a rewrite, what breaks, what the spec underestimates, cheaper alternative.

1. Named layers replace forwarded component z as the batch key; component zIndex never reaches the batcher.
   Accept. It is the correct fix for gap items 1 to 3 and the batcher side is a one-line change: DrawGroup.zIndex becomes a layer ordinal, the stable sort and fast path stay (BatchRenderer.cpp:120-128, 540-549). Feasible without a rewrite. What breaks: the 35 or so `.zIndex = zIndex + n` and `+ 0.1F` sites in nine widgets become submission order, which is what the widgets already draw in; RenderContext goes; GameUI's z_modal and 2000 become layer pushes around dialog and toast rendering; the lint's "differing zIndex exempts overlap" rule keeps working because local zIndex stays. Two things the spec underestimates. First, the HUD lint-exemption idiom (EntityInfoView z_panel, WorldCreatorScene z_modal) exists only to satisfy the lint; after the change those become layer promotions, and the lint must exempt pairs that differ in layer as well as in zIndex, or the exemption idiom moves to `raised`. Second, the world domain uses numeric z for intra-world ordering (previews 899-910 above committed 50-64, DrawingSystem) and R3.23 forbids reusing the UI ladder there; the spec should state that a non-UI domain MAY use any integer key with the same batcher (the batcher does not care what the ordinal means). Cheaper alternative that keeps worldsim's behaviour: keep integers. Add `Primitives::pushLayer(int)` used by the six popup hosts, make `zIndex` purely local by deleting RenderContext and the per-widget offsets, and leave the batcher's key an int. That is the spec's design minus the names; names are a constexpr table on top and cost nothing in C++. I would land the integer form first and adopt the names when the tokens are regenerated.

2. Inside as the default border position.
   Accept; trivial (PrimitiveStyles.h:25, BatchRenderer.cpp:171). No caller uses Center today (69 Inside, 5 Outside, 0 Center), so nothing breaks; the only risk is a caller that relied on the default and never said so, and there are none.

3. Premultiplied alpha.
   Accept in principle, low priority for worldsim. It is a real cross-cutting change, not a shader tweak: every vertex colour path (addQuad, addShadowQuad, addTriangles, addTextQuad), the instanced and baked branches of the same shader, drawInstanced's blend state (BatchRenderer.cpp:868-869), the tile pass, and planet-view's compositing (landed in #261) must all agree, and text and shadow alpha outputs change form. Feasible in one PR with screenshot goldens, but the native window is opaque, so worldsim gains nothing visible; the reasons are shader sharing with the TypeScript port and correctness if the UI is ever composited over the planet view. The spec should say plainly that on an opaque native target straight alpha is not wrong, only different, so a C++ implementation can defer it.

4. A mount context replaces the focus, tooltip, and input singletons.
   Accept, incrementally. Worldsim's blocker is constructor-time registration (FocusableBase.h:45-47) and the move-constructor re-registration dance that exists only because of it. Adding mount(context) and unmount() to IComponent, called from addChild (which already does the placement-new), removes both. FocusManager::Get() can stay as a shim during the migration. What the spec underestimates: the arena stores children by value with no parent pointer, so unmount on clearChildren must run before the arena destructors, and the context pointer must outlive every component; both are one-liners but they are invariants the C++ side has to state. What breaks: nothing at runtime; every test fixture that installs a FocusManager keeps working through the shim. See W63 for the draw API.

5. A hit-test pre-pass with bubbling, capture, and framework-derived hover replaces per-parent reversed dispatch.
   This is the largest input change and the one worldsim recorded a reason against (W40). I would accept the pre-pass and framework hover, and take capture as a service, but I would not require bubbling for conformance; a consume-to-stop top-down pass over the same layer-ordered walk gives the observable behaviour the spec's tests check (popup first, scrim blocks, scrolled-out child not hit) without touching every widget's handleEvent. Feasibility issues the spec glosses over: worldsim's leaves return false from containsPoint (Rectangle, Text), so a pre-pass needs the pointerEvents modes and real bounds on every node; there is no parent pointer, so the bubble path is the hit walk's ancestor stack (fine, but it must be said); and every widget's state machine assumes it sees events for points outside itself (Button's release-outside, Slider and scrollbar drags, TextInput's drag selection), which capture replaces one widget at a time. What breaks if done wholesale: all thirteen tested widgets at once. Cheaper alternative that preserves working behaviour: (a) walk layers first using the same layer stamps as paint (this alone fixes gap item 3 and removes GameUI's hand ordering), (b) derive enter and leave centrally from the existing MouseMove and stop synthesising MouseMove every frame (gap item 12), (c) add one captor pointer in the dispatcher for drags, migrating Slider, ScrollContainer, and TextInput. Bubbling can come later, if ever.

6. removeChild and keyed reconciliation.
   removeChild: accept, with a tombstone rather than a freeing allocator. MemoryArena is a bump allocator that never frees and cannot grow because moving polymorphic objects would break vtables (Component.h:121-123); the cheap design is to mark the slot dead, skip it in children and renderOrder, bump nothing, and reclaim on clearChildren. Handles stay valid, which is the invariant R8.6 wants. reconcileChildren: make it recommended, not required, at least for C++. Worldsim's documented idiom is clear-and-rebuild (Component.h:323-325) and only the task list, dossier tabs, and log would benefit; a keyed diff with three closures is fine in C++20 but it is a game-side convenience, and requiring it puts a library feature worldsim does not need on its conformance sheet.

7. Upward layout invalidation with relayout boundaries.
   Accept; highest value per hour of anything in the spec for worldsim (see Part 3). Needs a parent pointer set in addChild (LayoutContainer.h:50 says v1 has none); invalidate walks up until a Fixed-on-both-axes container or a root. Nothing breaks; the manual invalidateLayout calls become redundant and the EntityInfoView workaround goes away once item 12 below lands with it.

8. Layout before render instead of lazily in render.
   Accept, medium value. Scenes already expose UI roots for the lint (Scene::getUiRoots since 26c6a96), so a per-frame "layout dirty roots" step before render is a small addition to Application's loop; keep the lazy call in LayoutContainer::render as a fallback for a release. Tests then lay out without rendering. The pre-game scenes' post-layout UiStateDrain in render() would move to the same step.

9. Static primitives become tree components.
   Accept; mechanical. The seven classes already carry position, size, and render; they need getWidth, getHeight, setPosition, and the IComponent base. They were extracted from the prototype as plain structs for speed (2026-06-15 design-system extraction), not for a reason that still holds. Panel is the one with layout consequences (its content slot as a LayoutContainer) and should go last.

10. Explicit flat shader mode.
    Accept today; a constant in data2.w and one branch in uber.frag. It also removes the undefined smoothstep from lines, circle fans, and icon strokes (W20).

11. Three-state clip.
    Accept; small. Keep (0,0,0,0) as the shader's "no clip" because the instanced and baked branches rely on it (uber.vert:57,73) and drop draws on the CPU while the state is empty; that is one flag on the clip stack entry and an early return in the add functions.

12. Per-pass resolved sizes instead of permanently definite axes.
    Accept; it is the recorded wart's fix. Minimal form: a container clears its parent-resolved flags at the start of each parent pass (or records the pass number it was resolved in), keeping constructed Fixed axes definite. The characterisation suite plus the two freeze tests the spec lists are the safety net; both should be written first because the current 57 tests pass with the freeze in place.

13. A component transform.
    Defer. Worldsim has the transform stack in Primitives but no fanned cards, and a per-component transform is only meaningful once the hit walk can invert it, which needs item 5's pre-pass. At the object-model level I would make it a MAY for implementations without rotated content; the spec lists it as required for every component.

14. An animator.
    Accept later. Worldsim's fades are per-component timers (Dialog, Toast, Tooltip) and the motion tokens are unused because nothing consumes them; an animator is that consumer. It should not gate the ordering or clipping work.

15. A drag service.
    Not needed by worldsim (its drags are pointer drags on sliders and scrollbars, not drag-and-drop with targets). Requiring the full protocol for conformance makes worldsim score "no" forever on a feature it has no use for. Make R9.12 required only when the application declares drop targets, or split conformance into profiles.

Things the spec requires that worldsim has good reasons not to do, and whether it leaves room:
- Arena and generational handles: 8.8 says they are C++ concerns, and R8.6 is the invariant that matters. Room exists, but R8.5's moveChild and insertChild imply a reorderable list; the spec should say storage is implementation-defined and MAY tombstone removed slots, so the arena design survives.
- Polled input: R9.2 explicitly allows one down and one up per frame. Good. R9.1's pointerId, pointerType, pressure, and isPrimary are listed as required fields; make them optional with defaults for a mouse-only platform.
- The HTTP server, SSE, lock-free rings: 13.11 keeps them as the native transport. Good.
- C++ conventions: R8.23 forbids get and set method pairs, which is a TypeScript property idiom; C++ has no properties and worldsim's getWidth, setPosition, setClip style is fine. Scope the rule to languages with accessors. R11.14's closed CSS-named style object with rejection at construction is likewise a TypeScript authoring surface; C++ SHOULD keep typed structs with the same names.
- The draw API as a process-wide instance: see W63.
- The world domain's numeric z: see item 1.
- Layer names as strings: R3.5 allows implementation-defined ordinals; C++ should use constexpr ints from the generated tokens. Fine as written.

## Part 3. Recommended order for worldsim

Context: the "Game UI to Prototype Polish" epic closed 2026-07-04 with zero lint violations on every screen; nothing has touched libs/ui or libs/renderer since 2026-07-06; the queued epics are gameplay and world rendering (minimap terrain, living environment wind, construction C6 baked emitter). UI engine work therefore has to pay for itself in bugs prevented on the next screens, not in conformance. Ranked by that:

1. Layout freeze and upward invalidation (gap items 15, 16 partially, spec items 7 and 12). Small, in one file plus a parent pointer, removes the EntityInfoView workaround, and every dynamic screen (task list, dossier, log) needs it. Partially addressed: 7201ef6 introduced the definite flags, so the cause and the fix live in the same 30 lines.
2. One z key (items 1 to 3, spec item 1 in its integer form, plus layer-ordered dispatch from spec item 5a). The only class of ordering bug still open; the batcher change is trivial, the widget migration is a day. Land the sort unit test (the gap R2.22 names) in the same PR and delete BatchKey, DrawCommand, RenderContext, and the legacy text shaders with it (item 27).
3. Small renderer corrections in one PR: three-state clip (item 4), real clip on TextInput (item 6), explicit flat mode (item 7), RGBA border (item 8). Item 8 is the visible win: hairline and edge tokens finally render at their designed alphas (W23).
4. Focus scope wiring (item 11): derive a dialog's focusables from its subtree instead of the never-populated vector; small, and needed before any keyboard-driven screen.
5. Central hover and a captor (item 12): stop synthesising MouseMove every frame, derive enter and leave in one place, one captor pointer for Slider, ScrollContainer, and TextInput. Medium; do it when the next widget bug lands rather than speculatively.
6. Metrics hygiene (items 20 to 22): GPU timer scope to include endFrame, flush reasons, split inputHandleMs, per-window section max. Small; do with the next perf capture (C6 will want it).
7. Mount lifecycle and layout-before-render (items 14, 16): larger; do when the next new screen is built so the migration has a customer.
8. Everything else (items 9, 10, 13, 17, 19, 23, 24, 25, 26, and the absolute-coordinates item of W60) is opportunistic. Premultiplied alpha and local coordinates only pay off if the UI is composited or shared with the TypeScript implementation; SDF circles and tree primitives are quality-of-life.

Already partially addressed on recent branches (all merged): layout-engine #263 (definite flags, three-pass engine), text-render-fixes #258 (snapping, unified measurement, atlas validation), ui-layout-harness #259 (tree and lint), #264 (stable handles under z-sort, HUD lint pass), splash-layout-fixes #266 (glyph UV clamp). No unmerged branch carries UI engine work.

## Summary

1. Provenance is largely sound: about seventy of ninety checked statements are accurate with file-level evidence; the incident list in 3.11 and 13.12 is real, with two items uncited (W9, W56) and one duration overstated (W6).
2. The z-forwarding description (R3.14, item 1) is wrong in detail: nine composite widgets forward their own z with +1/+2/+0.1 offsets, and Text, Button, and Dialog chrome forward nothing (W1); the mechanism claim and the +0.1 claim stand.
3. Four other claims are wrong: the tab bar does draw hover (W47), worldsim has no ellipsis (W31), hit testing in ScrollContainer does gate on its viewport (W17), and "motion and z tokens unused" is half true (W44).
4. Hover is recomputed every frame in effect, but through a per-frame synthesised MouseMove, not widget polling (W38); the fix is on both sides.
5. The spec misses that worldsim positions are absolute, not parent-local (W60); R8.10 and R13.22 are a bigger migration than the gap list implies and 16.3 overstates what is taken unchanged.
6. Border alpha being discarded (item 8) also discards the design tokens' line alphas, so it is a visible fidelity bug today (W23) and should rank higher.
7. Of the fifteen design changes, I would accept twelve; bubbling should be optional, the drag service profile-gated, and the component transform a MAY, with room left for arenas, polled input, the HTTP transport, and C++ method conventions (W63 and Part 2 tail).
8. Cheaper worldsim-preserving paths exist for the two big ones: integer layers with a pushLayer call instead of names, and a layer-ordered top-down dispatch with central hover and one captor instead of bubbling.
9. Recommended order for worldsim: layout freeze and invalidation, then the single z key with a sort test, then the four small renderer fixes, then focus scopes, then hover and capture, then metrics; lifecycle and premultiplied alpha wait for a customer.
10. No branch newer than 2026-07-06 touches the UI engine; the recent work the spec should credit is already on main (#258, #259, #263, #264, #266).
