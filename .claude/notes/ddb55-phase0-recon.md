# DDB-55 phase 0: recon map

Working notes from the ddb55-phase0-recon workflow (2026-09-07). Not a spec. The spec is docs/ui-rendering-spec/ and docs/specs/ui-rendering-engine-implementation.md.

## Ordered tasks

### DDB-62 - Dead engine code removal + removeChild unmount stopgap

Depends on: nothing

Mechanical, zero dependencies, and it shrinks the surface every later task walks. Two concrete reasons to go first rather than last: (a) Arrow.ts silently drops any new LayerOptions field because it hand-copies four fields into super({...}) at src/renderer/engine/components/Arrow.ts:36-41 with its own ArrowOptions interface (Arrow.ts:6-14) - deleting it before DDB-56 removes the one class where an added `id` would not thread; (b) the snapshot walker in DDB-56 otherwise has to reason about three files that render nothing. The removeChild stopgap also stops the InputSystem handler maps from filling with detached nodes, which would otherwise pollute any lint rule that keys off interactivity.

Files to create:
- none

Files to edit:
- src/renderer/engine/components/Arrow.ts (delete, 0 importers)
- src/renderer/engine/rendering/ScissorBatcher.ts (delete, 0 importers)
- src/renderer/engine/rendering/Texture.ts (delete, 0 importers)
- src/renderer/game/core/Assets.ts (delete, 0 importers)
- src/renderer/utils/helpers.ts (delete; sole importer is Assets.ts:1)
- src/renderer/game/core/State.ts (delete, 0 importers)
- src/renderer/utils/math.ts (delete, 0 importers)
- src/renderer/game/ai/MCTSNode.ts (delete, 0 importers)
- src/renderer/game/ai/index.ts (delete, 0 importers)
- src/renderer/engine/components/Layer.ts:236-244 (removeChild calls child.unmount())
- src/renderer/game/ui/Card.ts (add unmount() override calling InputSystem.unregisterComponent)
- src/renderer/engine/rendering/Renderer.ts:306 drawLine, :733 destroy, :797 hasTextToFlush (dead once ScissorBatcher goes)
- src/renderer/game/screens/combat/CombatModel.ts:139 determineTargetableVehicles
- src/renderer/game/ai/AIController.ts:119 findVehicleByDriver
- src/renderer/game/core/ScreenManager.ts:125 resize, :139 destroy

Risk: The removeChild change is the only behavioural edit. Safe only because no call site removes a node and re-adds the same instance; every clear-and-rebuild site constructs fresh objects (DriverSelectionScreen.onResized -> createDriverPanels, DriverPanel.clearPanelContents -> createDriverDisplay, PlayerHandLayer.layoutCardElements nulls its fields first). Two sites now double-unmount (PlayerHandLayer.ts:176-178, CardShowcaseScreen.ts:274-281); harmless because Layer.unmount is pure recursion and InputSystem.unregisterComponent is Map.delete. State that invariant in the PR. Do NOT delete RenderContext.ts (13 importers) or RendererContext.ts (9 importers, retired in phase 3); DDB-15's claim that only one is imported is false. Leave every Style field alone - opacity and zIndex are re-added in phase 4.

### DDB-56 - Tree snapshot over the existing Layer tree (window.__ui.tree)

Depends on: DDB-62

First task that adds a window hook, so it carries the shared __DEV_TOOLS__ plumbing (DefinePlugin, types.d.ts, jest.setup.js) that DDB-57, 58, 60 and 61 all sit on. Everything downstream reads its output: DDB-57 is a pure function over this JSON, DDB-59's specs assert against it, DDB-60's coordinates are defined as 'the same space the tree snapshot reports' (R7.15).

Files to create:
- src/renderer/engine/debug/treeSnapshot.ts (pure serializer, no GL, no DOM)
- src/renderer/engine/debug/treeSnapshot.test.ts
- src/renderer/engine/debug/hooks.ts (window.__ui installer, wrapped in if (__DEV_TOOLS__))

Files to edit:
- src/renderer/engine/components/Layer.ts:8-16 (add id?: string to LayerOptions), :23-32 (private _id field), :40-45 (assign), plus an ES6 get id()
- src/renderer/game/core/Screen.ts:10 (expose rootLayer via a getter)
- src/renderer/game/core/ScreenManager.ts:36 (expose currentScreen, or a getRoots())
- src/renderer/game/Game.ts:121 (register developerOverlay as a second root)
- webpack/webpack.common.js (DefinePlugin)
- src/types.d.ts (declare const __DEV_TOOLS__)
- jest.setup.js (global.__DEV_TOOLS__ = true)
- ~32 tier-1 id sites listed in idProposal

Risk: Panel is the trap. Panel.getChildren() returns the content layer's children (src/renderer/engine/ui/Panel.ts:194-196), so a walk via getChildren() never sees the background Rectangle or the ScrollableContentLayer and reports the content children one level too shallow; the children's actual parent pointer is the content layer. Use getContentLayer() (Panel.ts:201-203) or walk the protected children array through a dev-only accessor. Second trap: screen bounds. localToGlobal (Layer.ts:280-282, 308-321) does NOT subtract Panel scroll, while Panel.render hands its content layer {offsetX: screenX - scrollOffsetX, ...} (Panel.ts:315-318) - ScrollableContentLayer overrides only globalToLocal (Panel.ts:21-31). Re-accumulate along the render path (Layer.ts:384-385, 423-426) and special-case the Panel subtraction, or screenBounds will be wrong inside every scroll container. Third: LayerOptions has no id today, verified at Layer.ts:8-16.

### DDB-57 - Layout lint as a pure function, seven rules, window.__ui.lint

Depends on: DDB-56

Consumes DDB-56's snapshot document and nothing else (R13.25: 'It is a pure function over the tree snapshot'). Landing it right after the snapshot means the schema is exercised by a second consumer while it is still cheap to change, and it produces the 'lint violations per screen' row of the phase 0 baseline table before DDB-61 has to collect it.

Files to create:
- src/renderer/engine/debug/layoutLint.ts
- src/renderer/engine/debug/layoutLint.test.ts (positive and negative case per rule, on hand-built snapshot objects)

Files to edit:
- src/renderer/engine/debug/hooks.ts (add window.__ui.lint)

Risk: Build SEVEN rules, not four. docs/ui-rendering-spec/13-observability-and-performance.md:182 still says 'the four required rules' - that row is stale, superseded by R13.25 (seven), 14-testing-and-conformance.md:127, and chapter 17 U20 (17-review-log.md:32). Three rules will find nothing against the live tree in phase 0 because the snapshot cannot carry their inputs: text-overflow needs text.measured (no measurement service exists; Text estimates from fontSize*0.6 at Text.ts:203), unreachable-interactive and target-size need focusable or pointerEvents (neither exists; the InputSystem handler maps are private at InputSystem.ts:27-33). Implement and unit-test all seven on synthetic snapshots; document that three are dormant live. Expect a large non-zero count on day one: sibling-overlap exempts pairs on differing zIndex or layer, and phase 0 emits neither, so nothing is exempted. R13.29's count:0 gate applies to the gallery first (implementation spec ground rule at docs/specs/ui-rendering-engine-implementation.md line 34), not to the game screens yet.

### DDB-58 - Gallery routing: developer sections become ?scene= scenes, dev-only webpack entry

Depends on: DDB-56, DDB-57

Needs the __DEV_TOOLS__ constant DDB-56 lands, and R13.33 requires every scene to hand its roots to the snapshot and lint, so both must exist first. Must precede DDB-59, whose specs navigate to /gallery.html?scene=<name>, and precede DDB-60, whose R13.35 clause 'injected input is ignored while paused' references the gallery pause hook (R13.32).

Files to create:
- src/gallery/index.ts (model on src/ai-evaluator.ts:1-41)
- src/gallery/registry.ts ({name, factory} entries, R13.30)
- public/gallery.html (copy public/index.html:1-42, keep <canvas id="game-canvas">, drop the #loading div)

Files to edit:
- webpack/webpack.web.js:5-20 (dev-guarded entry + HtmlWebpackPlugin)
- src/renderer/game/screens/developer/DeveloperScreen.ts:113-160 (sections come from the registry instead of eight inline constructions)

Risk: Low, and the sections are unusually portable: all eight take (x, y, width), none reads window, none holds a back-reference to the screen or ScreenManager. Three caveats. (1) Section height is content-driven and only correct after the constructor returns (each ends with setSize; the screen reads getHeight() at DeveloperScreen.ts:122-157), so the registry cannot pre-declare a viewport. (2) InteractiveControlsSection and InputShowcaseSection create Inputs that register keydown handlers from their constructor (Input.ts:107-113); a gallery that hot-swaps scenes must unmount or it leaks focus handlers - DDB-62's removeChild fix covers the common path. (3) Sections are Panels, so their getChildren() lies (Panel.ts:194-196); the scene's snapshot roots must account for it. Scope note: R13.31 lists a full fixture set (z-order, clipping, text, layout, 10k stress) plus one scene per catalog component - the catalog does not exist until phase 4. Phase 0's deliverable is only 'the developer screen's sections become scenes' (implementation spec phase 0 checklist). Because build:web forces NODE_ENV=production, the gallery is absent from every deployed artifact automatically, which satisfies R15.37 with no extra gate - but it also means Playwright must run against a development build.

### DDB-59 - Playwright screenshot harness, SwiftShader, visual.yml, committed goldens

Depends on: DDB-58

Depends on DDB-58 for ?scene= addressing (R13.30) and on DDB-56 for the tree assertions the specs make alongside the pixels. Landing it before DDB-60 and DDB-61 gives both of those an executable acceptance test and a scripted driver.

Files to create:
- playwright.config.ts (root)
- tests/visual/*.spec.ts (one per screen, one per gallery scene)
- tests/visual/*-snapshots/ (committed goldens, per project and platform)
- .github/workflows/visual.yml (clone .github/workflows/ci.yml's checkout/setup-node-18/npm-ci prefix)

Files to edit:
- package.json (add @playwright/test devDep and a test:visual script)
- jest.config.js (add testPathIgnorePatterns for <rootDir>/tests/)
- .gitignore (add test-results/ and playwright-report/; neither is covered today - dist at :92, coverage at :23)
- webpack/webpack.web.js:19 (port: Number(process.env.DEV_SERVER_PORT) || 9000, so worktrees do not collide)

Risk: Chromium launch args --use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader are mandatory 'regardless of version' (R15.33): Renderer requests a plain webgl context and throws when null (Renderer.ts:35-38), and src/index.ts swallows that into a console.error, so a missing-GL failure renders as a black page, not an exception - assert on console output too (R15.36). Determinism (R13.37) needs an injectable clock; the loop reads performance.now() directly at src/index.ts:86, so either install Playwright's Clock API over performance/rAF or land the injection point here. R14.5: goldens are produced by the CI runner image only, local runs compare and never update - no developer-runnable --update-snapshots path. Do not over-invest in golden content: the implementation spec (ground rules) schedules three deliberate re-baselines in phases 1, 2 and 4. Verify @playwright/test's Node floor before pinning - all six workflows pin node-version 18 and must move together if it forces a bump. Note F12 in Game.ts:65-72 has no preventDefault (unlike F5 at :74-77), so a Playwright key press of F12 opens devtools rather than navigating.

### DDB-60 - Input injection hook window.__dev.input in logical coordinates

Depends on: DDB-56, DDB-58, DDB-59

R13.35 defines the coordinate space as 'the same space as the tree snapshot', so DDB-56 must exist for the contract to mean anything; R7.15 says the point is that a test can click the centre of a node's snapshot bounds. The 'ignored while paused' clause references DDB-58's pause hook. Its acceptance proof (read tree, compute centre, inject, assert the handler fired) is expressible only once DDB-59's harness exists.

Files to create:
- src/renderer/engine/debug/inputInjection.ts
- src/renderer/engine/debug/inputInjection.test.ts

Files to edit:
- src/renderer/engine/debug/hooks.ts (add window.__dev.input)

Risk: The critical ordering fact: handleMouseDown and handleMouseUp ignore their event argument entirely (signatures are (_event: MouseEvent) at InputSystem.ts:145 and :181) and dispatch to this.hoveredComponents, a set populated ONLY by processMouseOverOut(), which is called ONLY from handleMouseMove (InputSystem.ts:134). A down,x,y injection that does not first move the pointer dispatches to whatever was last hovered, or to nothing. Every positional injection must set position first; click must expand to move-down-up, which is also why Button's click synthesis works (Button.ts:209-220 fires only if pressed && hovered). Prefer synthesising a MouseEvent on the canvas over a PointerEvent - the engine listens for mousemove/mousedown/mouseup, not pointer events (InputSystem.ts:77-88); a wheel event must be cancelable:true because handleWheel calls preventDefault (InputSystem.ts:222); key events go to window, not the canvas (InputSystem.ts:87-88). Logical px == CSS px == InputSystem px 1:1 on this page (canvas is position:absolute top:0 left:0 in public/index.html, and Renderer sets style.width/height to innerWidth/innerHeight at Renderer.ts:126-127), but still offset by rect.left/rect.top rather than assuming zero. Document the scroll delta units: the engine's wheel path scales raw deltas, so an injected delta is not logical pixels.

### DDB-61 - Frame timer with disjoint sections and window statistics, plus the committed baseline

Depends on: DDB-57, DDB-58, DDB-59

The timer itself has no code dependency, but its second deliverable - the committed perf-results baseline - is the collection point for the whole phase 0 baseline table (implementation spec section 3): draw calls from the existing F5 overlay, frame p99 from this timer, screenshots from DDB-59, lint counts from DDB-57. R13.38 also requires the capture script to drive the gallery through a fixed scenario list, which needs DDB-58's scenes and DDB-59's driver. Landing it last makes the baseline commit complete in one PR instead of amended three times.

Files to create:
- src/renderer/engine/rendering/FrameTimer.ts (replacing PerformanceMonitor)
- src/renderer/engine/rendering/FrameTimer.test.ts (window statistics as a pure function over a known array)
- scripts/capture-perf.* (R13.38 capture script)
- perf-results/<label>.json (does not exist in the repo today)

Files to edit:
- src/index.ts:83-104 (section brackets; clamp dt at :88 to 0.25 s per R13.9 - it is unclamped today)
- src/renderer/engine/rendering/PerformanceMonitor.ts (replaced, not paralleled - the ground rule forbids parallel code paths)
- src/renderer/engine/ui/DeveloperOverlay.ts:105-113 (stats string moves to the new shape)
- src/renderer/engine/debug/hooks.ts (window.__perf.snapshot)

Risk: Three of the six R13.7 sections cannot be measured honestly in the current architecture, and R13.11 says report null, never zero. `input` runs synchronously inside DOM handlers outside the rAF callback entirely (InputSystem.ts:77-88); the frame-start queue arrives in phase 3 (R9.2). `layout` has no frame phase - Layer.layout() exists (Layer.ts:338-343) but is called only from Text.ts:220, Panel.ts:286, CardShowcaseScreen.ts:315 and DeveloperScreen.ts:182, never from the loop. `present` is not measurable under rAF. `render` and `flush` ARE separable today: Game.render() walks screens then calls flushTextBatch at Game.ts:130 - but say plainly in the PR that `render` includes GPU submission for all non-text geometry, since drawRectangle/drawCircle/drawTriangle/drawPolygon issue gl.drawElements inside the tree walk; only text is deferred. Keep what already works: frame time is already frame-start to frame-start (PerformanceMonitor.ts:42-44), which satisfies R13.8. Change maxFrameHistory from 60 (PerformanceMonitor.ts:19) to 120 (R13.10), and drop Math.min(...arr)/Math.max(...arr) (:99-105) which is O(n) per read and throws on large windows. Do not fake batcher counters - they arrive in phase 1. Two existing sanity-check failures to fix or delete: getStats().verticesPerFrame and textEfficiency always read 0 because the only caller runs from Game.update() after beginFrame() zeroed them and before any draw; and Renderer.drawLine issues a drawElements without recordDrawCall (dead anyway after DDB-62).

## Engine facts

## Object model

`LayerOptions` is `{x?, y?, width?, height?, visible?, style?, overflow?}` and nothing else - verified at `src/renderer/engine/components/Layer.ts:8-16`. There is no `id`, `zIndex`, `opacity`, `key`, or `name`. `ComponentOptions = LayerOptions` (`Component.ts:8`) and `PanelOptions extends LayerOptions` (`Panel.ts:89`), so a single edit at Layer.ts:8-16 plus the constructor assignment block at `Layer.ts:40-45` covers Component, every primitive, Button, Input, and Panel.

Fields: `public x/y/width/height` all default 0, `protected visible`, `protected children: Layer[]`, `protected componentType`, `protected parent: Layer | null` (`Layer.ts:23-32`). `getChildren()` returns the live array (`Layer.ts:249-251`). There is no `getParent()` anywhere. No sort exists in the engine, so paint order is strictly insertion order.

`componentType` is the only identifier-ish field today (`Layer.ts:29`, read via `getComponentType()` at `Layer.ts:90`). `Arrow` and `DeveloperOverlay` never set it, so they report `'Component'` and `'Layer'`.

`grep -rn "__ui\|__dev" src/` returns nothing. No debug hook exists.

## The two structural traps for a tree walker

**Panel.** Verified in `src/renderer/engine/ui/Panel.ts`: the constructor creates a background `Rectangle` and a `ScrollableContentLayer` through `super.addChild` (both inside `Panel.ts:112-160`), then overrides `addChild` (`:178-181`), `removeChild` (`:186-189`), and `getChildren` (`:194-196`) to forward to the content layer. A walk via `getChildren()` therefore never sees the background or the content layer and reports the content children one level too shallow, while those children's real `parent` pointer is the content layer. `getContentLayer()` at `Panel.ts:201-203` is the only public escape hatch and currently has zero callers. Panel also renders its two implicit children by hand (`Panel.ts:305-307`, `:348-350`) rather than through `super.render`, so a Panel's subtree never runs `Layer.ts:429-433`.

**Scroll offset.** `Panel.render` passes `{offsetX: screenX - scrollOffsetX, offsetY: screenY - scrollOffsetY}` to its content layer (`Panel.ts:315-318`), but `ScrollableContentLayer` overrides only `globalToLocal` (`Panel.ts:21-31`), not `localToGlobal`. So `child.localToGlobal(0,0)` on a scrolled panel child returns the unscrolled position while the pixels are drawn `scrollOffset` away. Re-accumulating along the render path (`Layer.ts:384-385` then `:423-426`) is the only faithful route for `screenBounds`, and it must special-case Panel.

`ScrollableContentLayer.render` also CPU-culls children outside the viewport - they stay in `children` but never draw, so the walk and "what got drawn" differ.

## Reaching the roots

`Screen.rootLayer` is `protected` with no accessor (`src/renderer/game/core/Screen.ts:10`, constructed at `:23-29` from `window.innerWidth/innerHeight`). `ScreenManager.currentScreen` is `private static` (`ScreenManager.ts:36`); the only public read is `getCurrentScreenName()` at `ScreenManager.ts:132` (not :133, as one report said). `DeveloperOverlay` is a second root outside every screen tree - `Game` owns it and renders it after `ScreenManager.render()` at `src/renderer/game/Game.ts:121`.

## Text has no size until layout() runs

`Text.layout()` (`src/renderer/engine/components/Text.ts:201-221`) sets width/height from a `fontSize * 0.6` character estimate only when they are 0. `layout()` is called from exactly two game sites, both inside `onResized`: `CardShowcaseScreen.ts:315` and `DeveloperScreen.ts:182` (verified by grep; `Layer.ts:341`, `Text.ts:220`, `Panel.ts:286` are the recursive/super calls). Neither `Screen.update` nor `Screen.render` calls it. On a freshly mounted screen every Text without explicit dimensions reports w=h=0, which makes the lint's `zero-or-negative-size` rule fire on nearly every text node unless the snapshot runs `layout()` first. Also, `setWidth`/`setHeight` do not fire `onResized`; only `setSize` does (`Layer.ts:122-159`).

## Frame loop

One rAF call site in the tree, `src/index.ts:104`. The loop, verbatim structure at `src/index.ts:83-104`: `beginFrame()`, `performance.now()` delta with **no clamp** at `:87-89`, `game.update(dt)` at `:92`, `renderer.clear()`, `game.render()`, `endFrame()`, `requestAnimationFrame`. `Game.render()` at `Game.ts:111-131` does `beginTextBatch`, `ScreenManager.render()`, `developerOverlay.render()`, a scissor teardown, then `flushTextBatch()`/`endTextBatch()` at `:130-131` - a real render/flush boundary.

Existing monitor: `maxFrameHistory = 60` (`PerformanceMonitor.ts:19`), frame time already measured start-to-start (`:42-44`, correct per R13.8), one read method `getStats()` (`:82-130`) with no p99, no histogram, no spikes, no sections, and `Math.min(...arr)` spreads at `:99-105`.

F5 toggles the overlay display (`Game.ts:74-78`, with `preventDefault`); F12 navigates to the developer screen (`Game.ts:65-72`, **no** `preventDefault`, so in a browser it also opens devtools). Both are raw `document.addEventListener('keydown')` in `Game.setupEventHandlers`, not `InputSystem.registerGlobalKeyDown`.

## Input

Listeners: `mousemove/mousedown/mouseup/wheel/mouseleave` on the canvas, `keydown/keyup` on window (`src/renderer/engine/input/InputSystem.ts:77-88`). These are MouseEvents, not PointerEvents. Coordinates: `event.clientX - rect.left` from `getBoundingClientRect()` (`InputSystem.ts:128-132`), which equals logical pixels on this page 1:1.

The ordering fact that matters for DDB-60: `handleMouseDown(_event)` at `InputSystem.ts:145` and `handleMouseUp(_event)` at `:181` **ignore the event entirely** and dispatch to `this.hoveredComponents`, which is populated only by `processMouseOverOut()`, called only from `handleMouseMove` (`InputSystem.ts:134`). A `down,x,y` injection that does not move first hits whatever was last hovered.

`InputSystem.unmount()` (verified at `InputSystem.ts:94-121`) passes freshly-bound handlers to `removeEventListener`, so no listener is ever removed; `setup()` calls `unmount()` first (`:70-73`) believing it cleaned up, and repeated setup stacks duplicates.

## DPR

Read once in `Renderer.resize()` (`Renderer.ts:113-150`): backing store is `innerWidth * dpr`, CSS box is `innerWidth`, ortho matrix uses the logical size. Logical == CSS == layout == input pixels everywhere. The one hand-rolled logical-to-device conversion is the scissor math at `Layer.ts:410-418`, which multiplies by dpr and inverts Y. A snapshot's `clip` must be the logical intersection, not that device rect.

Context is acquired as plain `'webgl'` with no attributes (`Renderer.ts:35`), WebGL1, no `preserveDrawingBuffer`, and `src/index.ts` swallows a null context into a `console.error` - so a headless GL failure looks like a black page, not an exception.

## Id proposal

Add `id?: string` to `LayerOptions` (`src/renderer/engine/components/Layer.ts:8-16`), a `private _id: string | null = null` beside the other fields (`:23-32`), the assignment in the constructor block (`:40-45`), and an ES6 `get id()`. Because `ComponentOptions = LayerOptions` (`Component.ts:8`) and `PanelOptions extends LayerOptions` (`Panel.ts:89`), no second options type needs editing. `Arrow` would be the only class that silently drops the field (it hand-copies four fields into `super({...})` at `Arrow.ts:36-41`), and DDB-62 deletes Arrow first.

`Screen` should pass its own `getId()` (`Screen.ts:37`) as the root layer's id at `Screen.ts:23-29`.

### Tier 1: the ~32 named elements (verified construction sites)

**splashScreen** (`src/renderer/game/screens/splash/SplashScreen.ts`)
- `splash_logo` :42, `splash_title` :53

**mainMenuScreen** (`src/renderer/game/screens/main-menu/MainMenuScreen.ts`)
- `main_menu_title` :46, `main_menu_start_button` :71, `main_menu_card_showcase_button` :112, `main_menu_developer_button` :125
- Ids matter most here: `positionElements` (`:183-193`) finds buttons by `getComponentType() === 'Button'` and lays them out by array index, so any inserted sibling reorders the menu. Ids let the lint and tests address them by name instead.

**driverSelectionScreen** (`src/renderer/game/screens/driver-selection/DriverSelectionScreen.ts`)
- `driver_select_title` :68, `driver_select_panel_left` :94, `driver_select_panel_right` :107, `driver_select_synergy_panel` :130, `driver_select_start_run_button` :161

**DriverPanel** (`src/renderer/game/screens/driver-selection/DriverPanel.ts`), prefixed `driver_panel_left_` / `driver_panel_right_` from `this.panelSide` (`:14`)
- `_driver_name` :204, `_deck_preview` :252 (the container in DDB-31), `_cycle_button` :261 (the button the preview paints through)

**combatScreen** (`src/renderer/game/screens/combat/CombatScreen.ts`, all inside `createLayers` at :438-527)
- `combat_resource_bar` :461, `combat_enemy_battlefield` :472, `combat_player_battlefield` :484, `combat_player_hand` :496, `combat_turn_banner` :505, `combat_log` :516

**ResourceBarLayer** (`src/renderer/game/screens/combat/ResourceBarLayer.ts`)
- `resource_driver1` :66, `resource_driver2` :78, `end_turn_button` :177

**DriverStatsDisplay** (`.../DriverStatsDisplay.ts`), prefixed by `driverNumber` (`:266`)
- `driver{n}_adrenaline_value` :373

**TurnPhaseDisplay** (`.../TurnPhaseDisplay.ts`)
- `turn_counter` :118, `turn_phase` :131

**PlayerHandLayer** (`.../PlayerHandLayer.ts`)
- `hand_card_{card.id}` :193

**Battlefields**
- `player_vehicle_{vehicle.id}` / `enemy_vehicle_{vehicle.id}`, created in `BattlefieldLayer.updateVehicleCards` (`BattlefieldLayer.ts:97-99`), concrete at `PlayerBattlefieldLayer.ts:322` and `EnemyBattlefieldLayer.ts:238`

**battleResultScreen** (`src/renderer/game/screens/battleResult/BattleResultScreen.ts`)
- `result_panel` :57, `result_title` :78, `result_continue_button` :102

**cardShowcaseScreen** (`src/renderer/game/screens/card-showcase/CardShowcaseScreen.ts`)
- `showcase_title` :41, `showcase_scroll` :69, `showcase_card_{card.id}` :145

**developerScreen** (`src/renderer/game/screens/developer/DeveloperScreen.ts`)
- `dev_title` :50, `dev_scroll` :99, `dev_section_{name}` for the eight sections constructed at :120-155

### Composite internals: derive, do not hand-write

`ui/Card` builds nine to eleven nodes and `ui/Vehicle` twelve to fourteen, all in their constructors. Give each composite a prefix from its own id and derive the children (`<card_id>_title`, `<card_id>_driver_badge`, `<vehicle_id>_structure_fill`, and so on). The pair the lint must be able to name for DDB-28 is `<card>_title` (`src/renderer/game/ui/Card.ts:104`) and `<card>_driver_badge` (`Card.ts:191`).

### One collision to design around

`CardShowcaseScreen` renders the same 18 GameCards **twice** - once in `displayCards` (`:119-175`, card constructed at `:145`) and again in `displayCardsByRarity` (`:180-240`, `:213`). A naive `showcase_card_{card.id}` scheme collides 18 times. Use `showcase_card_{id}` for the first pass and `showcase_{rarity}_card_{id}` for the second. (Separately, `CardShowcaseScreen.onRender()` at `:300-302` calls `this.rootLayer.render()` when `Screen.render()` already rendered it at `Screen.ts:170` - the whole showcase tree draws twice per frame. That double render is scheduled for deletion in phase 1, not phase 0.)

## Plumbing edits

All line numbers below were read directly, not taken from a report.

### DefinePlugin / `__DEV_TOOLS__` (rides with DDB-56)

`webpack/webpack.common.js` currently requires `path`, `html-webpack-plugin`, `copy-webpack-plugin` (`:1-3`); entry is `{main, battle-simulator, ai-evaluator}` at `:6-10`; the `plugins` array opens at `:35`.

1. Add `const webpack = require('webpack');` after `:3`.
2. Insert as the first element of `plugins` at `:36`:
   `new webpack.DefinePlugin({ __DEV_TOOLS__: JSON.stringify(process.env.NODE_ENV !== 'production') }),`

This must live in **common**, not in `webpack.web.js`: `webpack/webpack.electron.js:65` merges the same common config into `rendererConfig` over the same `src/` tree, so a constant defined only for web would throw `ReferenceError` in the packaged Electron renderer.

3. `src/types.d.ts` is 15 lines, three `declare module` blocks, no `export` (so it stays a global script-context file). Append `declare const __DEV_TOOLS__: boolean;`. `tsconfig.json` includes `src/**/*`, so both ts-loader and ts-jest pick it up.
4. `jest.setup.js` is 13 lines (`requestAnimationFrame` at :2, a fake `WebGLRenderingContext` at :6-11). Append `global.__DEV_TOOLS__ = true;`. It is wired as `setupFilesAfterEnv` (`jest.config.js:18`), which runs before the test file's imports evaluate, so module-level reads are safe.

ESLint needs no change: `.eslintrc.js` has no `globals` and no `env`, and `no-undef` is off for TS under the `@typescript-eslint/recommended` preset. `jest.setup.js` is `.js` and `npm run lint` is `eslint . --ext .ts` (`package.json:17`), so it is never linted.

### Gallery entry (DDB-58)

Put both additions in `webpack/webpack.web.js` (21 lines), not in common - webpack-merge merges `entry` key-wise and concatenates `plugins`, and common ships into the packaged Electron renderer.

1. After `:3`, add `const HtmlWebpackPlugin = require('html-webpack-plugin');` and `const isDevelopment = process.env.NODE_ENV !== 'production';`.
2. Inside the merged object (`:5-20`), add spread-guarded `entry` and `plugins`:
   `...(isDevelopment ? { entry: { gallery: './src/gallery/index.ts' } } : {})` and
   `plugins: isDevelopment ? [ new HtmlWebpackPlugin({ template: './public/gallery.html', filename: 'gallery.html', chunks: ['gallery'] }) ] : []`
3. `public/gallery.html`, modelled on `public/index.html` (42 lines). It **must** keep `<canvas id="game-canvas">` - `Renderer`'s constructor does `document.getElementById(canvasId)` and throws when absent (`Renderer.ts:28-33`), and `src/index.ts:38` passes that literal. Drop the `#loading` div, which only `src/index.ts:27-32` removes.
4. `src/gallery/index.ts`, modelled on `src/ai-evaluator.ts` (41 lines): imports from `./renderer/...`, augments `Window` via `declare global`, boots on `DOMContentLoaded`.

`splitChunks: {chunks: 'all'}` (`webpack.common.js:30-34`) is not a problem - HtmlWebpackPlugin resolves an entrypoint's split chunks from the chunk graph.

Consequence to state in the PR: `build:web` sets `NODE_ENV=production` (`package.json:9`), and both deploy workflows call it, so the gallery is absent from every deployed artifact with no extra gate (satisfies R15.37) - and Playwright therefore **cannot screenshot the gallery from a production build**. Either point `webServer` at `npm start`, or add a `build:gallery` script that runs webpack with NODE_ENV deliberately unset and serve the output statically.

### Dev server port (DDB-59)

`webpack/webpack.web.js:19` is a literal `port: 9000` with no `host` (so webpack-dev-server v4 defaults to localhost) and no `historyApiFallback` (none needed - `?scene=` is a query string on `/gallery.html`). Two worktrees cannot both run `npm start`, and a Playwright `webServer` with `reuseExistingServer: true` will silently attach to another worktree's server. Change to `port: Number(process.env.DEV_SERVER_PORT) || 9000` and have `playwright.config.ts` read the same variable. `hot: true` (`:17`) injects an HMR websocket into every page; prefer `npm start -- --no-hot` for determinism (R13.37). Note `electron/main.ts:27` also loads `http://localhost:9000` in unpackaged mode.

### Jest (DDB-59)

`jest.config.js` is 19 lines. Verified numbering, correcting one report: `testMatch: ['**/*.test.(ts|js)']` is **:6**, `collectCoverage: true` is **:14**, `coverageDirectory` is :15, `collectCoverageFrom` is **:16**.

Playwright specs at `tests/visual/*.spec.ts` are already unreachable twice over: `roots: ['<rootDir>/src']` (`:4`) and the required `.test.` infix (`:6`). Add defensively after `:6`:
`testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/', '<rootDir>/dist/'],`
It becomes load-bearing the moment anyone widens `roots`.

Note `moduleFileExtensions: ['ts', 'js']` (`:5`) drops Jest's default `json`, so a DDB-57 test importing a `.json` fixture must write the extension out or the array must be extended.

`collectCoverage: true` at `:14` means every `npm test` instruments `src/**`, so a new `src/gallery/` directory drags the coverage number down from the day DDB-58 lands. Moving it to `test:coverage` is DDB-19 and out of phase 0 scope, but if it moves, `.github/workflows/ci.yml:35` must become `npm run test:coverage` or its `coverage/` upload step fails on a missing path.

### CI (DDB-59)

Six workflows exist, all `actions/checkout@v4` + `actions/setup-node@v4` with `node-version: '18'`, `cache: 'npm'`, `npm ci`. Clone `.github/workflows/ci.yml`'s prefix into a seventh, `visual.yml`, same trigger set (push main/master, PR, `workflow_dispatch`), `runs-on: ubuntu-latest`, then `npx playwright install --with-deps chromium`, `npx playwright test`, and an `actions/upload-artifact@v4` step with `if: always()` for `playwright-report/` and `test-results/`. Stay on `@v4` / `github-script@v6`, the versions already in use.

R14.5 (goldens from the CI image only, local runs never update) is encoded nowhere today. Add a `workflow_dispatch` input that switches the run to `--update-snapshots`, or document the rule explicitly.

`.gitignore` (136 lines) covers `coverage` at :23 and `dist` at :92 but neither `test-results/` nor `playwright-report/`. Add both. Goldens go in Playwright's default `<spec>-snapshots/` directory beside the spec, outside `dist/`.

`tsconfig.json` includes only `["src/**/*", "electron/**/*.ts"]`, so `tests/` is not type-checked by any tsc invocation; `.eslintrc.js` has no `ignorePatterns` and no `.eslintignore` exists, so `tests/visual/*.spec.ts` and a root `playwright.config.ts` **will** be linted (cleanly, since `parserOptions` has no `project`).

### perf-results (DDB-61)

No `perf-results/` directory, no perf npm script, no `DefinePlugin`, and no `__DEV__`-style flag exist in the repo today.

## Dead code verdict

## Delete: engine files, zero importers (verified by import grep across `src/` and `electron/`)

- `src/renderer/engine/components/Arrow.ts` - 0 importers
- `src/renderer/engine/rendering/ScissorBatcher.ts` - 0 importers
- `src/renderer/engine/rendering/Texture.ts` - 0 importers

## Delete: non-engine files, zero importers

- `src/renderer/game/core/Assets.ts` - 0 importers
- `src/renderer/utils/helpers.ts` - exactly one importer, `Assets.ts:1` (`loadImage`). Dead as a pair with Assets, not alone. The four other `helpers` grep hits are `./test-helpers` in AI tests, a different file.
- `src/renderer/game/core/State.ts` - 0 importers
- `src/renderer/utils/math.ts` - 0 importers
- `src/renderer/game/ai/MCTSNode.ts` - 0 importers (`MCTSAI.ts` does not import it)
- `src/renderer/game/ai/index.ts` - 0 importers, a stale barrel exporting 4 of 7 AI classes

The epic checkbox says "dead **engine** code" while citing DDB-14, which is broader. Decide the boundary explicitly in the PR description rather than silently including or excluding the six non-engine files.

## Do NOT delete

- `src/renderer/engine/rendering/RenderContext.ts` - 13 importers; it is the `render(context?: RenderContext)` parameter type on every component. **DDB-15's claim that "only RendererContext is imported" is false.** The correction is already recorded in `docs/specs/ui-rendering-engine-implementation.md` (phase 0 checklist) and `docs/AI_DEVELOPMENT_HUB.md:15`.
- `src/renderer/engine/rendering/RendererContext.ts` - 9 importers, one writer (`src/index.ts:41`). It is the singleton phase 3 retires, not DDB-62.
- `TextRenderer.ts` - deleted in phase 1, not now.
- Every `Style` field. `opacity` (`Style.ts:29`) and `zIndex` (`:40`) are read nowhere, but the migration map re-adds them in phase 4; deleting and re-adding is churn.
- `Circle.ts`, `Triangle.ts`, `Polygon.ts`, `ui/Input.ts` - reachable **only** through `DeveloperScreen`, which is live (`ScreenManager.ts:45`, F12 at `Game.ts:65-72`). A grep of the game screens alone would falsely mark them dead. DDB-58 turns those sections into gallery scenes; they stay.
- `Renderer.isScissorEnabled` (`:726`) - live at `Layer.ts:403`, `Panel.ts:328`, `Game.ts:124`. It appears in `ScissorBatcher.ts:56` too, which makes it look like it should go with that file.
- `Renderer.getFontAtlas` (`:680`) - live at `Input.ts:235`.

## Delete: dead methods inside live files

`Renderer.drawLine` (`Renderer.ts:306`, only the definition matches in all of `src/`), `Renderer.destroy` (`:733`), `Renderer.hasTextToFlush` (`:797` - its only callers are `ScissorBatcher.ts:75,89`, so it goes dead in the same PR; the separate `TextRenderer.hasTextToFlush` at `:533` is live from `Renderer.ts:693,711`), `TextRenderer.hasPendingFlush`/`clearPendingFlush`/the `pendingFlush` field, `Shader.setVector3`, `Layer.getBackgroundColor`, `Text.setFontFamily` plus the never-read `fontFamily` field, `FontAtlas.getLineHeight`, the `setStrokeWidth`/`getRadius`/`getPoints` accessors on Circle/Polygon/Triangle, `InputSystem.registerKeyUp`/`registerGlobalKeyUp`/`unregisterGlobalKeyUp`/`getMousePosition`, `Button.getLabel`/`setTextColor`, six unused `Input` setters, `Panel.getContentLayer`/`getContentSize`/`onMouseMove`/`onKeyDown`/`onKeyUp`, `DeveloperOverlay.show`/`hide`, `Component.select`/`deselect`/`untarget`/`cancel`, `ScreenManager.resize` (`:125`) and `ScreenManager.destroy` (`:139`).

**Correction to one report:** `Card.onSelect`/`onDeselect`/`onActivate`/`onTarget` (`src/renderer/game/ui/Card.ts:395-412`) are unreachable overrides - `Card extends Layer` (`Card.ts:29`), not `Component`, so nothing dispatches them. Live click path is `handleMouseUp` -> `selectHandler`.

**Correction to another:** `Panel.getContentLayer` is genuinely uncalled (`grep` finds only the definition at `Panel.ts:201`), but if DDB-56 uses it as the escape hatch for the Panel walk, keep it. Sequence DDB-62 before DDB-56 and either decision is fine; just do not delete it and then re-add it.

**Corrections to the game-side dead methods DDB-15 named:** `determineTargetableVehicles` is at `src/renderer/game/screens/combat/CombatModel.ts:139`, not `src/renderer/game/mechanics/CombatModel.ts` - one report gave the wrong path (the line number was right). `CombatModel.ts` itself is live, imported by `BattlefieldLayer.ts:3`, `CombatScreen.ts:11`, `EnemyBattlefieldLayer.ts:6`, `PlayerBattlefieldLayer.ts:6`, `ui/Vehicle.ts:6`; only that one private method is dead, shadowed by the live implementation at `CombatScreen.ts:699` (called from `:639`). `AIController.findVehicleByDriver` at `src/renderer/game/ai/AIController.ts:119` is confirmed private with zero callers.

## The removeChild stopgap

Current method, verbatim from `src/renderer/engine/components/Layer.ts:236-244`:

```ts
	public removeChild(child: Layer): boolean {
		const index = this.children.indexOf(child);
		if (index !== -1) {
			child.parent = null;
			this.children.splice(index, 1);
			return true;
		}
		return false;
	}
```

It never calls `child.unmount()`. `Layer.unmount` (`:350-355`) only recurses; the unregistration lives in `Component.unmount` (`Component.ts:244-250`), which calls `InputSystem.unregisterComponent(this)`. Interactive nodes register into seven module-global Maps on the InputSystem singleton at construction time (`InputSystem.ts:27-43`), so a detached node keeps being hit-tested on every mousemove and is never collected.

Three edits, none of which changes behaviour on any current call path:

1. `Layer.removeChild` - insert `child.unmount();` before `child.parent = null;` (R8.7).
2. `src/renderer/game/ui/Card.ts` - add the `unmount()` override its callers already assume exists. `Card` registers four handlers in its constructor and has **zero** occurrences of `unmount` in the file, so `PlayerHandLayer.ts:174-177` ("Unmount the card to unregister from InputSystem") and `CardShowcaseScreen.ts:273-276` are both no-ops today. A combat hand re-lays out on every draw and play, so this is the highest-volume leak in the game. Do **not** change `Card extends Layer` to `extends Component`: Card declares its own `private hovered` (`Card.ts:50`) and `private _enabled` (`:51`), which collide with `Component`'s `protected hovered`/`enabled` (`Component.ts:15-17`).
3. Optional one-liner: `CombatScreen.onUnmount` registers `this.rootLayer` for keyDown at `CombatScreen.ts:550` and unregisters only the F6 global at `:833`.

Safety argument for edit 1, which is the part that could break working code: an unmount-on-remove is harmful only if some site removes a node and re-adds the *same instance*. None does - every clear-and-rebuild site constructs fresh objects (`DriverSelectionScreen.onResized` -> `createDriverPanels` builds new DriverPanels; `DriverPanel.clearPanelContents` -> `createDriverDisplay` builds a new Button; `PlayerHandLayer.layoutCardElements` nulls its divider and label fields before rebuilding; `CombatLogLayer.handleFullUpdate`, `SynergyPreviewPanel.clearSynergyContent`, `ResourceBarLayer.clearElements`, `Vehicle.onResized`, both battlefield `onResized`s, `BattlefieldLayer.updateVehicleCards`). Two sites now double-unmount; harmless, because `Layer.unmount` is pure recursion and `unregisterComponent` is `Map.delete`. State the invariant in the PR: unmount on an already-unmounted subtree is a no-op.

Latent, not a live leak: `Panel.unmount` (`Panel.ts:405-412`) unregisters only `if (this.scrollable)`, and no current code removes a scrollable Panel via `removeChild`. Also latent: `CombatLogLayer.unmount` (`:254-259`) never calls `super.unmount()`, so its whole subtree is skipped on teardown.

## Out of scope but worth flagging

`src/utils/logger.ts` has zero importers, but DDB-14's own description reserves it for the logging task in the code-convention-cleanup epic. That is a cross-epic scope call, not a fact question - see openQuestions.

## Spec extract and acceptance checklists

## The rules everything in phase 0 sits on

`docs/ui-rendering-spec/13-observability-and-performance.md:11-16` - R13.1 monitoring never lengthens the frame it observes; R13.2 everything in chapter 13 is dev tooling, excluded from production by a build-time flag; R13.3 machine-readable output first, screenshots last resort; R13.4 the same verification code runs in unit tests and against the live app, so the lint, serializer and statistics are pure functions over plain data; R13.5 every metric has a sanity check or a documented failure mode; R13.6 report distributions, not averages.

`07-coordinates-and-dpi.md:11-12` - R7.1: logical space is one unit per CSS pixel, origin top-left, and layout, component positions, draw calls, clip rects, input positions, **the tree snapshot, and the lint** all use it. R7.2: device space is never read by the tree walk.

`14-testing-and-conformance.md:11` (R14.1) - unit tests without a GPU, in the project's ordinary runner, which requires engine modules importable without a DOM or canvas. `:20-21` (R14.7, R14.8) - the merge gates.

Dev-only exclusion, chapter 13 mapping table `:155`, browser column, verbatim: "a bundler `DefinePlugin` constant (`__DEV_TOOLS__`, declared for the type checker and set in the test setup); dev code wrapped in `if (__DEV_TOOLS__)` so production tree-shakes it; the gallery is a separate bundle entry emitted in development builds only". `15-backend-webgl2.md:78` (R15.37) - the gallery is addressable by `?scene=name` and exposes `window.__ui`, `window.__perf`, `window.__app`, `window.__dev` in development builds only.

---

## DDB-62 acceptance

- `npm test` and `npm run lint` green; web build compiles; click-through of menu, driver selection, combat, result works.
- The removeChild change satisfies R8.7 and relies on the invariant from implementer finding I8 / the proposed R8.15 amendment: unmount on an unmounted subtree is a no-op. Say so in the PR.
- `RenderContext.ts` and `RendererContext.ts` both survive; the PR description records why DDB-15's third claim was wrong.
- Closes DDB-14 and DDB-15.

## DDB-56 acceptance (R13.21-R13.24)

1. `window.__ui.tree()` exists only under `__DEV_TOOLS__`, absent from a production bundle.
2. Document root is exactly R13.23: `{"viewport": {"width", "height"}, "roots": [...]}`, viewport in logical pixels.
3. Field **names** match R13.22 character for character: `screenBounds`, `contentOffset`, `inkBounds`, `zIndex`; every rect is `{x, y, w, h}` while the root viewport is `{width, height}`.
4. `id` is a string or `null` - R13.22 says explicitly "`id` is `null` when the component was not given one", so the key is present even when unset.
5. Every field that does not apply is **omitted**, never `0`, `false`, or `""`. `null` is reserved for "applies but unknown".
6. `bounds` is parent-relative, `screenBounds` viewport-absolute; a test with a nested node under an offset ancestor proves they differ.
7. Serialization never throws (R13.24): test a cyclic parent link, a non-string id, a NaN coordinate, an unmounted child. Output round-trips through `JSON.stringify`.
8. Pure function over the tree, exercised in Jest with no GL and no DOM.
9. Roots are the active screen plus visible overlays; nothing closed or invisible is a root.

**What phase 0 can honestly emit.** The implementation spec scopes this to "id, type, bounds, screen bounds, visible, children, viewport", with the full R13.22 schema arriving in phase 3. Additionally derivable today: `clip` (from `overflow` at `Layer.ts:32`, intersected in logical space - do **not** read GL state via `getParameter(SCISSOR_BOX)` at `Layer.ts:405`, which R15.22 prohibits and phase 1 deletes, and do not report the dpr-multiplied rect from `Layer.ts:410-418`), `contentOffset` for scrollable Panels only, `enabled` and `state.{hovered,focused}` for `Component` subclasses, `value` for `Input`.

**Must be omitted, because the backing property does not exist:** `margin`, `zIndex`, `layer`, `opacity`, `transform`, `focusable`, `inkBounds`, `style`, `text.measured`, and `state.{pressed,focusVisible,selected,open,active,dropActive}`. Do **not** emit `zIndex: 0`, `opacity: 1`, `layer: "base"`, or `margin: {0,0,0,0}` as filler - each is a false statement about a property the engine lacks, and `zIndex: 0` in particular would change what the lint's `sibling-overlap` rule does. Chapter 14's conformance row already scores the tree snapshot "partial" for this engine, which is the expected phase 0 result.

The `id` requirement traces to R8.4 (`08-object-model.md:19`): ids SHOULD be unique within a root and SHOULD be set on every interactive component so tests and the lint address by name rather than index.

## DDB-57 acceptance (R13.25-R13.28)

1. Pure function over the snapshot document; imports nothing from the renderer.
2. **Seven** rules, each with a positive and negative unit test on hand-built snapshot objects: `sibling-overlap`, `child-outside-parent`, `outside-viewport`, `zero-or-negative-size`, `text-overflow`, `unreachable-interactive`, `target-size`.
3. Epsilon exactly 0.5 logical pixels (R13.27), used by rules 1, 2 and 3.
4. Invisible **subtrees** skipped entirely, not just the node.
5. Roots treated as siblings of each other.
6. Touching edges are not overlap - an exact abutment at x=100 must not fire rule 1.
7. Output exactly `{"count": N, "violations": [{rule, path, bounds, otherPath, otherBounds}]}`. On single-node violations, `otherPath`/`otherBounds` should be absent rather than null, by R13.22's omission convention (R13.28 does not state this; it is an inference).
8. `path` uses ids when present, `Type[index]` otherwise, joined with `/`. Test a mixed path.
9. Runs in Jest with no GL context.

**Build seven, not four.** `13-observability-and-performance.md:182` still reads "Layout lint with the four required rules" - a stale row from before chapter 17 U20 (`17-review-log.md:32`) widened R13.25. R13.25 itself, `14-testing-and-conformance.md:127`, and the phase 0 checklist all say seven.

**Expect a large non-zero count on the game screens.** R13.25.1 exempts a pair on differing `zIndex` or effective layer; phase 0 emits neither, so no pair is exempted and every overlapping sibling fires. That is the intended maximally-catching behaviour, and it is why the ground rule gates the gallery first and each screen only as it migrates.

**Three rules are dormant live in phase 0.** `text-overflow` needs `text.measured`, which no measurement service can supply. `unreachable-interactive` and `target-size` need `focusable` or `pointerEvents` (R8.29's vocabulary), neither of which exists. Implement and unit-test all three on synthetic snapshots; document that they find nothing against the live tree until phase 3.

## DDB-58 acceptance (R13.30-R13.33)

1. A registry of `{name, factory}` entries, one scene mounted at a time, addressable by URL query parameter, with no navigation chrome in the picture (R13.30).
2. Control hooks: switch scene, pause (skip input and update, keep rendering), resume, reload, vsync off where applicable (R13.32). Pause is what R13.35's "injected input is ignored while paused" refers to.
3. Every scene provides its UI roots to the snapshot and lint (R13.33).
4. Dev-only entry, absent from production builds (R15.37 and the mapping row).
5. Phase 0's scene set is the eight developer sections, not R13.31's full fixture list - R13.31 requires one scene per catalog component, and the catalog does not exist until phase 4. Say so in the PR.

## DDB-59 acceptance (R14.5, R15.33, R15.36)

1. `@playwright/test` with a `webServer` serving the gallery; projects `chromium` and `electron`.
2. Chromium launch args exactly `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`, "regardless of version" (R15.33) - Chromium removed the automatic SwiftShader fallback from version 137, and without them headless context creation fails.
3. Baselines stored per backend and per platform.
4. Goldens produced by the CI runner image only; local runs compare and never update (R14.5). No developer-runnable path that rewrites a committed golden.
5. `toHaveScreenshot` with `maxDiffPixelRatio` and an anti-aliasing tolerance, never exact equality.
6. All of R13.37's determinism controls: fixed viewport, fixed dpr, a time-freeze or fixed-timestep hook, a seeded random source, a wait-for-assets gate. Playwright's Clock API (`clock.install`, `pauseAt`, `runFor`) covers the timers; the engine side reads `performance.now()` directly at `src/index.ts:86`, so either install the clock over `performance`/rAF or land the injection point here.
7. One spec per screen and one per gallery scene.
8. No `toDataURL`/`toBlob` capture (R15.26); use page capture or `webContents.capturePage`.
9. `visual.yml` runs the suite; the goldens are a required merge gate (chapter 17 K5 raised the chapter 14 rows to required).
10. Do not over-invest in golden content - the ground rules schedule three deliberate re-baselines (phase 1 ordering, phase 2 text metrics, phase 4 button and input styles), each its own PR.

## DDB-60 acceptance (R13.35, R13.36)

1. `window.__dev.input(...)` dev-only.
2. Grammar exactly as R13.35 writes it: `move,x,y` | `down,x,y[,button]` | `up,x,y[,button]` | `click,x,y[,button]` (expands to move, down, up) | `scroll,x,y,delta` | `keydown,<key>` | `keyup,<key>`.
3. `x, y` are logical pixels in the snapshot's space (R7.15), so reading a node's `screenBounds` from `window.__ui.tree()`, computing its centre, injecting `click`, and asserting the handler fired is the acceptance proof.
4. Dispatched through the same path real input takes - not by calling a component's handler directly. Given the engine listens for MouseEvents on the canvas and key events on window (`InputSystem.ts:77-88`), a plain `MouseEvent` dispatched at the canvas is the faithful and safest choice; a `PointerEvent` fires the `mousemove` listener only if the browser synthesises the compatibility event.
5. Injected input ignored while paused. If DDB-58's pause hook is not wired, say so in the PR rather than silently dropping the clause.
6. Document the scroll delta units - R9.3 says wheel deltas are normalised to logical pixels per axis with no per-notch constant, and the current engine's handler scales raw deltas.
7. R13.36's polled-key collapse does not arise here (the engine is event-driven), but the API must still document its behaviour.

## DDB-61 acceptance (R13.7-R13.11, R13.38)

1. `window.__perf.snapshot()` returns a JSON-serializable object matching R13.11's shape. **Field names are normative**: `ms`, `minMs`, `maxMs`, `p99Ms`, `histogram`, `spikesOverBudget`, `spikesOver2xBudget`, `budgetMs`, `windowSize`; sections as `{ms, maxMs}`; `gpu.{ms, valid, passes, spanMs, latencyMs}`; `memory.usedBytes`.
2. `scene` carries the active screen name - `ScreenManager.getCurrentScreenName()` at `ScreenManager.ts:132`.
3. Sections are disjoint (R13.7). Summing them and comparing against the measured frame span is the sanity check R13.5 demands.
4. Frame time is the interval between consecutive frame starts (R13.8). The existing monitor already does this correctly at `PerformanceMonitor.ts:42-44`; keep it.
5. `dt` clamped to 0.25 s (R13.9). One line at `src/index.ts:88`.
6. Rolling window with all seven R13.10 outputs: last, min, max, p99, a four-bucket histogram (< half budget, < budget, < 2x budget, worse), both spike counts, and **the per-window maximum of every section** - the item worldsim lacked and listed as its top follow-up. `windowSize` default 120 (today 60).
7. Unmeasurable values are `null`, never `0`. In phase 0 that means `gpu.ms: null` (timer queries are phase 7), `memory.usedBytes: null` unless cross-origin isolated, `present: null`, and - because of the architecture - `input` and `layout` null too.
8. The window statistics are a pure function over an array of frame records, fed a known array in a unit test.
9. `batcher` is a placeholder; batcher counters arrive with phase 1. Do not fake `apiDraws`/`gpuDraws` - the "one name for two things" mistake is exactly what R13.12 exists to prevent.
10. The old monitor is **replaced**, not paralleled (the ground rule forbids parallel code paths).
11. `perf-results/<label>.json` committed, shaped `[{"scenario", "samples": [snapshot...]}]` (R13.38), with vsync and frame capping off during capture and restored after.
12. The baseline table (implementation spec section 3) has four rows: draw calls / vertices / text characters per frame per screen from the existing F5 overlay, frame p99 per screen at 1440x882 from this timer, a screenshot per screen and gallery section from DDB-59, lint violations per screen from DDB-57.

---

## Spec inconsistencies the implementer will hit

1. **"Four" vs "seven" lint rules.** `13-...md:182` says four; R13.25, `14-...md:127`, chapter 17 U20, and the implementation spec all say seven. Build seven.
2. **`text.overflow` vocabulary.** The R13.22 example emits `"none"`, but R6.14 and R12.4 define the authored values as `visible | clip | ellipsis`. The prose says the field carries the observed outcome, but the outcome vocabulary is enumerated nowhere.
3. **R13.28 is silent** on what to do with `otherPath`/`otherBounds` on single-node violations. R13.22's omission principle is the nearest guidance, but it is stated for the node schema, not the lint output.

## Open questions raised by recon

- DDB-56: should window.__ui.tree() call root.layout() before serializing? R13.21 requires the snapshot to be taken after layout has run for the current frame, but this engine has no layout phase in the loop - Layer.layout() is called only from CardShowcaseScreen.ts:315 and DeveloperScreen.ts:182, both in onResized. Without it, every Text without explicit dimensions reports w=h=0 (Text.ts:201-221 sets size only when 0), so the lint's zero-or-negative-size rule fires on nearly every text node and the geometry rules see phantom boxes. With it, a dev-only read hook mutates the live tree, which observes-by-changing. The alternatives are: run layout in the hook and document it; have the hook estimate text extents without writing them back; or accept the noise and suppress the rule for zero-size Text in phase 0. This is a real tradeoff with no obvious default.

- DDB-62 scope boundary: the epic checkbox says 'dead engine code removed' but cites DDB-14, which also lists six non-engine files (game/core/Assets.ts + utils/helpers.ts as a pair, game/core/State.ts, utils/math.ts, game/ai/MCTSNode.ts, game/ai/index.ts - 909 lines). Include them in this PR, or split them into a separate cleanup? Product judgement about PR size versus leaving known-dead code in the tree for another epic.

- DDB-62: src/utils/logger.ts has zero importers, but DDB-14's own description reserves it for the logging task in the code-convention-cleanup epic. Delete it now, or leave it for that epic to adopt? Cross-epic scope call.

- DDB-59: @playwright/test's recent releases have been raising their Node floor, and all six workflows pin node-version '18'. If the chosen Playwright version requires Node 20+, all six workflows move together. Accept the bump now, or pin an older Playwright that still supports 18?

- DDB-59: R14.5 requires goldens to be produced by the CI runner image only, with local runs never updating them. Nothing in the repo encodes that. Enforce it with a workflow_dispatch input that runs --update-snapshots and commits, or with a documented convention plus a CI check that fails on locally-modified snapshot files? The first is more work but actually enforceable.

- DDB-61: how should the perf baseline reach each game screen? Options are a dev-only window.__app.navigate hook (not on any phase 0 checkbox), DDB-60's input injection clicking through the menu (fragile, and the menu positions buttons by array index at MainMenuScreen.ts:183-193), or restricting the committed baseline to gallery scenes only and filling the per-screen rows by hand. R13.38 says the capture script drives the gallery; the implementation spec's baseline table is per game screen. The two do not fully agree and someone has to pick.
