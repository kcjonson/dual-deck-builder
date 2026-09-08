# AI Development Log

This document contains the chronological log of completed development tasks for Wasteland Wheels. Most recent entries are at the top.

=========================================

**Date correction (2026-08-22):** the repo's first commit is 2025-05-17, but many entries below carry dates in December 2024 or January 2025 — the AI that wrote them used its assumed date instead of the real one. Entries dated 2025-07-03 and 2025-07-02 have been corrected from "2025-01-03"/"2025-01-02" (verified against git history). Remaining Dec 2024 / Jan 2025 dates are wrong by roughly six months; the real work happened May–July 2025. Trust git history over these dates.

## Scene gallery behind ?scene=, phase 0 task DDB-58 (2026-09-08)

**What changed:**
- A second application over the same engine at `public/gallery.html` and `src/gallery/index.ts`: one scene mounted at a time, chosen by `?scene=`, no menu and no scene picker in the picture (R13.30). It is a separate webpack entry added only when `NODE_ENV !== 'production'`, so `npm run build:web` and both deploy workflows emit neither the entry nor the page. The bootstrap deliberately mirrors `src/index.ts`: same `Renderer`, same `RendererContext` singleton, same `InputSystem.setup`, same shader, same frame-loop shape, because a gallery that renders through a different path proves things about the gallery rather than about the game.
- Eight scenes, one per developer-screen section: `interactive-controls`, `style-guide`, `input-showcase`, `rectangles`, `buttons`, `text`, `primitive-shapes`, `nested-panels`. The names mirror the `dev_section_*` ids the sections already carry, so a scene name and the node id it selects are derivable from each other, and a rename invalidates a golden.
- The section list lives at `src/renderer/game/screens/developer/sections.ts`, beside the sections it names. `DeveloperScreen` builds its scroll container from it and `src/gallery/registry.ts` wraps each entry as `{name, factory}`, so the screen and the gallery cannot drift apart while the dependency still points from the development-only tool to the game. It pointed the other way first, which put the gallery directory in the production web bundle and in the packaged Electron renderer.
- `src/gallery/SceneHost.ts` owns mount, unmount, reload, resize, pause and resume (R13.32) with no DOM, no canvas and no GL: the viewport arrives as a supplier and the scene list as an argument, so the whole mount discipline is exercised in Jest (R13.4, R14.1).
- `src/gallery/sceneSelection.ts` is the pure `?scene=` parser. `resolveScene` answers `requested`, `default`, `unknown` or `empty`, and the host records which of them produced the mounted scene: `window.__app.status()` reports `{scene, requested, resolution}` alongside the pause counters. A capture asserts `resolution === 'requested'` before it shoots.
- `window.__ui.tree()` and `window.__ui.lint()` install on the gallery page through the same `installDebugHooks` the game app uses, with the host's root layer as the single root (R13.33), and `window.__app` gains `scene`, `reload`, `pause`, `resume` and `status`.
- `InputSystem` gained a `paused` flag, since this engine dispatches input straight from DOM listeners rather than from the frame loop: stopping the loop's update alone would leave clicks and keystrokes landing on components, which is the half of R13.35 that makes "injected input is ignored while paused" true.

**How:**
- An unknown `?scene=` mounts the default rather than nothing, because a blank canvas is the one outcome a screenshot harness cannot tell apart from a GL failure. The substitution is reported twice: a console error naming what was asked for and what was mounted, and `status().resolution === 'unknown'`, which is the half a script can act on. A stale golden name therefore fails loudly instead of producing a plausible screenshot of the wrong scene. `reload` and `resize` re-enter through the same private path and keep the recorded provenance, since how the scene was chosen is not state the scene accumulated.
- Resize re-enters the scene, because a section lays itself out from the width it was constructed with and has no reflow path. Re-entering is destructive though, so the host stores the viewport the current scene was built for and returns early when a resize event reports that same size (the browser fires resize for zoom, for a `devicePixelRatio` change, and on some platforms for a window move). A real resize while paused is deferred rather than applied, and resume applies it: pause exists so a capture can read the tree and inject input against a still scene, and swapping every component instance underneath it would break exactly that promise.
- Scene switching is a teardown path the developer screen never exercises, since it builds its sections once and lives as long as the screen does. Two sections construct `Input`s, and an `Input` registers a mouse-down and a keydown handler with the `InputSystem` singleton from its constructor, so a switch that merely dropped the reference would leave every scene ever mounted hit-tested on every mouse move. `Layer.removeChild` unmounts the subtree it detaches (DDB-62), so the registration maps stay flat across switches; focus is the one pointer that is not per-component bookkeeping, so the host clears it explicitly.
- The host runs `rootLayer.layout()` on mount. `Text` takes its size from `Layer.layout()`, which the frame loop never calls, so without that pass every label in a scene reports `w = h = 0` and DDB-57's zero-or-negative-size rule fires on all of them. `DeveloperScreen` does the same thing in `onResized`.
- A registry entry carries no size and no viewport. A section computes its own height from its content and publishes it with `setSize` on the last line of its constructor, so the height does not exist until the factory has returned; `status().content` reads it off the constructed scene.
- Deleted rather than kept for a caller that does not exist yet: `sceneUrl`, written for a DDB-59 spec that has not been written, and the registry's `findScene` and `sceneNames`, which had no non-test caller. `SceneHost` could not have used the last two anyway: it holds an injected scene list, which is what lets its tests run against synthetic scenes, while those two are bound to the module-level registry.

**Lint counts on the gallery scenes,** through `window.__ui.lint()` at 1440x882: interactive-controls 4, style-guide 1, input-showcase 8, rectangles 1, buttons 9, text 3, primitive-shapes 1, nested-panels 3. Thirty violations across the eight, so R13.29's `count: 0` gate is not met yet. Twenty-eight of the thirty are `sibling-overlap` on a pair that overlaps by construction: a section's background `Rectangle` against the content `Layer` drawn over it, and a `Button`'s `Rectangle` against its own label `Text`. R13.25.1 exempts a pair on differing `zIndex` or effective layer and the phase-0 snapshot emits neither, so nothing is exempted; those counts drop to near zero the moment the snapshot carries `zIndex`, and they are not defects to fix in the scenes. The remaining two are one node: a right-aligned label in the `text` scene reports a width estimated from `fontSize` (`Text.layout` has no measurement service until phase 2) that puts its box about 105 px past the section's right edge, so it fires `child-outside-parent` and `outside-viewport` together. No `zero-or-negative-size` violation anywhere, which is the mount-time `layout()` pass doing its job: that same rule accounts for 44 of the developer screen's violations, where no layout pass runs.

**The developer screen is unchanged by the section-list move.** Re-measured at 1440x882 after the move: 164 nodes, 156 visible, 191 violations (32 sibling-overlap, 44 zero-or-negative-size, 6 child-outside-parent, 109 outside-viewport), identical to the row committed in `perf-results/phase0-layout-lint.json` before this task.

**R15.37 is half met, and stays half met.** The rule names four globals in development builds only. `window.__ui` (DDB-56, DDB-57) and `window.__app` are live; `window.__dev` arrives with DDB-60 and `window.__perf` with DDB-61. The development-builds-only half is satisfied without a second gate, because `build:web` forces `NODE_ENV=production` and the gallery entry is spread in only when it is not, which also means a Playwright run has to point at a development build rather than at a deployed artifact.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors and 9 pre-existing warnings, all in `RammingAI.test.ts`; `npm test` 268 passing across 15 suites, up from 222 across 11; `npm run build:web` compiles. A production bundle built to a scratch output directory contains no `gallerySceneRegistry`, `SceneHost`, `mountFromSearch`, `resolveScene`, `__ui`, `__app` or `__DEV_TOOLS__`, and its module graph lists no `./src/gallery/*` module at all.

## Layout lint behind window.__ui.lint(), phase 0 task DDB-57 (2026-09-08)

**What changed:**
- `src/renderer/engine/debug/layoutLint.ts` implements R13.25's seven rules as a pure function over the R13.23 tree snapshot document: `sibling-overlap`, `child-outside-parent`, `outside-viewport`, `zero-or-negative-size`, `text-overflow`, `unreachable-interactive`, `target-size`. It imports nothing, not even the serializer: the input types are declared locally as a structural superset of `SnapshotDocument`, so the same code runs in Jest over hand-built objects and in the browser over `window.__ui.tree()` (R13.4), and stays assignable as phases 2 and 4 add fields. Epsilon is exactly 0.5 logical pixels (R13.27) on rules 1, 2 and 3.
- `window.__ui.lint(options?)` in `debug/hooks.ts` runs those rules over a freshly taken snapshot. Dev-only, behind the same `__DEV_TOOLS__` branch as `tree()`.
- Output is R13.28's shape, `{count, violations: [{rule, path, bounds, otherPath?, otherBounds?}]}`, plus a `rules[]` array of per-rule diagnostics that R13.28 does not require. A rule that cannot fire for want of a field must not read as a silent pass, so every rule reports what it evaluated, what it exempted, what it skipped and which field was missing, and summarises that as `dormant`.
- Sixty-one unit tests in `layoutLint.test.ts`, all on hand-built snapshot objects with no GL context.
- Committed the phase-0 baseline at `perf-results/phase0-layout-lint.json` (R13.38's shape): eight scenarios at 1440x882, captured through `window.__ui.lint()` after a rendered frame. Every screen except splash, main menu and battle result is in the hundreds of violations, which is expected rather than alarming and is explained below.

**How:**
- All geometry is computed in screen space. Rule 2 compares a child against its parent and rule 3 compares a node against the viewport, and those two live in different coordinate spaces if `bounds` is used, because R13.22 makes `bounds` parent-relative and `screenBounds` absolute. The rect *reported* on a violation is still the node's own `bounds`, which is the field R13.28 names. Rule 2's tests pin this with a parent away from the origin, where a bounds-against-bounds compare reports a 490 px escape for a child that is fully contained.
- Rule 2 measures the child as its margin box, since R13.25.2 names the child's `bounds` and R13.22 defines `bounds` as the margin box. Phase 0 emits no `margin` and the two boxes coincide, so this is inert today and correct the moment phase 1 emits margins.
- Absence never exempts. Where an exemption depends on a field the snapshot may not carry (`zIndex`, `layer`, `wrap`, `overflow`), it applies only when the field is present on *both* sides of the comparison. Reading an absent `zIndex` as 0 would turn "no stacking declared" into "same stacking declared" and silently exempt every pair in phase 0.
- No exemption for scroll containers either. R13.25.2 grants none, and the signal that would carry one, `contentOffset`, sits on the `Panel`, whose only two children are a background and a content layer both sized exactly to it. The rows that actually overflow are a level below that, so a parent-side carve-out would have let off only the two nodes that can never violate while leaving every real overflow reported. The test now uses the shape the serializer actually emits.
- Rule 4 splits its findings into `unmeasured-text` and `zero-box` buckets and reports both. Suppressing Text would hide the only class of node the rule can currently see; reporting it undifferentiated buries the case the rule exists for, a Rectangle or Button that really collapsed. The discriminator is the type *and* the absence of `text.measured`, not the type alone, so a phase-2 Text that genuinely collapses moves to `zero-box` by itself instead of being filtered away as a phase-0 artefact.
- The walk mirrors the serializer's guards: a 256-deep cap and a walk-wide `seen` set. `Layer.addChild` never detaches from a previous parent, so one instance can sit in two children arrays and a diamond expands exponentially; a node in its own children array is an immediate `RangeError`. A repeat is still linted where it reappears, only its subtree is left unexpanded.
- One deliberate deviation from R13.28's letter: when an id repeats among its siblings the path segment is `id[index]` rather than the bare id. Taken literally the rule gives the two nodes the same path and a baseline diff silently collapses their rows; reporting the collision is the lesser departure. The current eight-screen baseline has no collisions, so no path in it changes.
- `layoutLint(document, null)` is accepted as well as `layoutLint(document)`. A default parameter only fires on `undefined`, and DDB-59 will be calling this across a `page.evaluate` boundary where an explicit null is easy to produce.

**Three of the seven rules are dormant against the live tree.** `text-overflow` needs `text.measured`, which no measurement service exists to supply until phase 2. `unreachable-interactive` and `target-size` need `focusable` or `pointerEvents`, which is R8.29's vocabulary and arrives in phase 3. All three are fully implemented and unit-tested on synthetic snapshots, and they report `dormant: true` with the field they wanted rather than a clean pass. Two related latent problems were fixed now rather than left for those phases to inherit: rule 6 treated a `pointerEvents: 'passthrough'` sibling as an occluder, which R8.29 says it cannot be, since passthrough makes the node's own box transparent to hits and this rule never descends into a sibling's children; and rule 4's bucket discriminator, described above. R3.27 gives `opacity: 0` the same property as passthrough, but R13.22 emits no opacity, so that case defers to phase 3 with the rest.

**Why the counts are high, and what the baseline is for.** R13.25.1 exempts a sibling pair on differing `zIndex` or effective layer, and the phase-0 snapshot emits neither, so nothing is exempted and every overlapping sibling fires. That is the intended maximally-catching behaviour. Separately, rule 4 fires on nearly every Text node: `Text.render` reads width and height for alignment and assigns neither, only `Text.layout()` writes them, and the frame loop never calls it, so an unsized Text reports 0x0. Across the eight captured scenarios that is 596 of 704 visible Text nodes, all of them in the `unmeasured-text` bucket, and no Rectangle, Button, Panel or Layer ever reports zero. The counts and the command that re-derives them are in `.claude/notes/ddb55-phase0-recon.md`; the code comments carry the mechanism only, since a comment citing a number nobody can re-derive rots the first time the capture is retaken. R13.29's `count: 0` merge gate therefore applies to the gallery first and to each screen as it migrates, per the implementation spec's ground rules, and nothing here is wired into CI.

**Known bugs the lint already catches.** `child-outside-parent` reports 24 violations on card showcase, driver selection and combat start, 20 on combat after a card is played, and 6 on the developer screen: content overflowing its panel, not a snapshot artefact. Splash, main menu and battle result report no `child-outside-parent` at all, and their totals (3, 11 and 6) are almost entirely the full-screen background rectangle overlapping the content it sits behind, which is exactly the pair R13.25.1 will exempt once the snapshot carries `zIndex`.

**Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors and 9 pre-existing warnings, all in `RammingAI.test.ts`; `npm test` 222 passing across 11 suites, 61 of them this file's; `npm run build:web` compiles. A production bundle contains no `layoutLint` and no `__ui`, confirming the dev-only exclusion still holds.

## UI tree snapshot behind window.__ui.tree(), phase 0 task DDB-56 (2026-09-07)

**What changed:**
- Added the shared `__DEV_TOOLS__` plumbing the rest of phase 0 sits on: a `webpack.DefinePlugin` constant in `webpack/webpack.common.js` (so the packaged Electron renderer gets it too, not just the web build), `declare const __DEV_TOOLS__: boolean` in `src/types.d.ts`, and `global.__DEV_TOOLS__ = true` in `jest.setup.js`.
- `LayerOptions` gained `id?: string`, with a private backing field and an ES6 `get id(): string | null` on `Layer`. Because `ComponentOptions = LayerOptions` and `PanelOptions extends LayerOptions`, that one edit covers every primitive, Button, Input, and Panel. `Screen` passes its own id to its root layer. Named about sixty elements across the seven screens; `ui/Card` and `ui/Vehicle` derive their internals from the composite's own id (`<card>_title`, `<card>_driver_badge`, `<vehicle>_structure_fill`), and the card showcase, which renders the same cards twice, prefixes the second pass `showcase_{rarity}_card_{type}` so ids stay unique within the root. Ids never come from `Model.id`, which is the constructor name plus `Math.random()` and so re-rolls every load: a hand card is `hand_card_{slot}_{type}`, a showcase card keys off the card type (`CardLoader` maps one card per type), and a battlefield vehicle is `{side}_vehicle_{lane}_{ordinal within lane}`.
- `src/renderer/engine/debug/treeSnapshot.ts` serializes the live tree to the R13.23 document as a pure function over `(roots, viewport)`: no GL, no DOM, no `window`. It emits only what this engine can honestly back (id, type, bounds, screenBounds, visible, children, plus clip, contentOffset, enabled, state.hovered/focused, and value where they apply) and omits everything else rather than filling in a default; `zIndex: 0` in particular would change what DDB-57's sibling-overlap rule exempts.
- `src/renderer/engine/debug/hooks.ts` installs `window.__ui.tree()`, with the roots being the mounted screen plus the developer overlay while it is actually drawn. Reached through small accessors (`Screen.root`, `ScreenManager.activeScreen`, `DeveloperOverlay.shown`) rather than by exporting internals.
- Thirty-three unit tests in `treeSnapshot.test.ts`, run in Jest with no GL context on hand-built Layer trees.

**How:**
- Two geometry traps, both from the DDB-55 recon and both confirmed in the code. `Panel.getChildren()` forwards to the content layer, so a walk through it never sees the background rectangle or the scrollable content layer and reports content children one level too shallow; the walk uses a new `Layer.debugChildren` getter onto the real child array instead. And `localToGlobal` does not subtract panel scroll while `Panel.render` hands its content layer `offsetX: screenX - scrollOffsetX`, so `screenBounds` re-accumulates along the render path and special-cases the panel subtraction. Both are pinned by tests.
- Serialization never throws (R13.24): an ancestor set breaks child-graph cycles, non-finite coordinates report as 0 (which lands them on the lint's zero-or-negative-size rule rather than vanishing), a non-string id reports as null, unpaired surrogates are replaced, and a node whose accessors throw degrades to one `Unserializable` entry instead of failing the document. The degraded entry keeps the id, bounds and children computed before the throw and reports `visible: true`, because R13.27 lets the lint skip an invisible subtree whole and the broken node is the one worth seeing. The cycle guard is joined by a walk-wide `seen` set: `Layer.addChild` never detaches from a previous parent, so one instance can sit in two children arrays, and a per-path guard alone let a depth-18 diamond expand to 524,287 nodes. A repeat is emitted once more as a childless stub.
- Dev code is kept out of production by requiring `debug/hooks` inside the `if (__DEV_TOOLS__)` branch rather than importing it. With `tsconfig` on `module: commonjs`, webpack cannot tree-shake an unused ES import, but it does drop a `require` in a branch DefinePlugin folded to false. Verified: a production bundle contains no `__ui`, `treeSnapshot`, `installDebugHooks`, `screenBounds`, or `contentOffset`; a development bundle contains all of them.

**Finding for DDB-57:** `Text` still reports `w = h = 0` after any number of rendered frames. `Text.render()` never writes width or height; only `Text.layout()` does, and the frame loop never calls it (the only two callers are `CardShowcaseScreen.onResized` and `DeveloperScreen.onResized`). The snapshot deliberately does not run layout, because a read hook must not mutate the tree it observes. So `zero-or-negative-size` will fire on nearly every unsized text node on the live screens until a layout phase exists in phase 3.

## Dead engine code purge and unmount fixes, phase 0 task DDB-62 (2026-09-07)

**What changed:**
- Deleted nine modules nothing imported: `engine/components/Arrow.ts`, `engine/rendering/ScissorBatcher.ts`, `engine/rendering/Texture.ts`, `game/core/Assets.ts`, `game/core/State.ts`, `game/ai/MCTSNode.ts`, `game/ai/index.ts`, `utils/helpers.ts`, `utils/math.ts`. Eight had zero importers; `helpers.ts` had exactly one, `Assets.ts`, which went with it.
- Swept the dead members those deletions and earlier refactors left behind, about 1,960 lines across 32 files: `Renderer.drawLine`, `destroy`, `hasTextToFlush` and the scissor-state notification (all dead once ScissorBatcher went); `ScreenManager.resize` and `destroy`, and `Screen.resize`, which lost its only caller with them; the whole keyup half of `InputSystem` (`keyUpComponents`, `globalKeyUpHandlers`, `handleKeyUp`, both window listeners, `registerKeyUp`, `registerGlobalKeyUp`, `unregisterGlobalKeyUp`) plus `getMousePosition`; `Component`'s semantic event system (`select`, `deselect`, `activate`, `target`, `untarget`, `cancel` and the six protected hooks behind them), which had no caller anywhere, `DriverPanel.activate` being its own method on a `Layer` subclass rather than an override; `Card`'s `activateHandler` and `targetHandler` with their setters; `Input`'s focus and blur callbacks with their setters and guards, and `setPlaceholder`, `setMaxLength`, `setTextColor`, `setPlaceholderColor`; `ResourceBarLayer.clearElements`; `CombatModel.determineTargetableVehicles`; `AIController.findVehicleByDriver`; and unread getters and setters on Circle, Polygon, Triangle, Text, Panel, Button, Shader, FontAtlas, TextRenderer, and DeveloperOverlay.
- Fixed four unmount leaks found while doing the sweep. `Layer.removeChild` now calls `child.unmount()` before detaching, so a removed subtree stops being hit-tested instead of sitting in the InputSystem handler maps forever. `Card` gained an `unmount()` override that unregisters itself, since it extends Layer rather than Component and so inherits no unregistering unmount. `CombatLogLayer.unmount` now calls `super.unmount()`, so its children unmount too. `CombatScreen.onUnmount` unregisters `rootLayer`, a plain Layer that does not unregister itself.

**How:**
- Every deletion was justified by an importer count or a ripgrep caller count from the DDB-55 recon notes, and re-verified with ripgrep after the cut; nothing was removed on a hunch about naming.
- `removeChild` is the only behavioural change. It is safe because no call site removes a node and re-adds the same instance: every clear-and-rebuild path constructs fresh objects. Two sites now double-unmount (PlayerHandLayer, CardShowcaseScreen), which is harmless because `Layer.unmount` is pure recursion and `InputSystem.unregisterComponent` is a map delete.
- Deliberately kept: `RenderContext.ts` (13 importers) and `RendererContext.ts` (9, retired in phase 3), and every `Style` field, since `opacity` and `zIndex` are re-added in phase 4.

## UI rendering specification and implementation plan (2026-09-07)

**What changed:**
- Wrote a backend-agnostic layered UI rendering specification at `docs/ui-rendering-spec/` (README, glossary, architecture, draw API, render order, clipping, shading, text, coordinates, object model, input and focus, layout, style and theme, component catalog, observability, testing and conformance, WebGL2 and OpenGL backend notes, review log), abstracted from worldsim's C++/OpenGL UI system after reading its renderer, component library, sandbox tooling, design docs, and development log, plus an audit of this engine and a sourced survey of published designs (GPUI, PixiJS, Skia, Flutter, WebRender, ImGui, egui, Unity, Godot, CSS stacking contexts) and WebGL2 specifics.
- Ran five independent challenge reviews against the draft (graphics engineer with web verification, UI architect, worldsim maintainer, implementer for this codebase, consistency editor). The UI-architect and implementer reviews produced 74 findings, five of them blockers (a layout-freeze defect inherited from worldsim, a coordinate ambiguity in layer promotion, deferred callbacks, an undefined hit-target model, a one-sentence drag protocol), resolved into draft 2. The graphics review produced 37 findings including a blocker in the border-over-fill compositing formula (a one-pixel halo on every bordered control), plus corrections to the clip test, anti-aliasing ramp, shadow padding, buffer ring sizing, resident textures, the text atlas range, hairline snapping, GPU timing, and several WebGL version claims; the consistency review produced 24, including a stale conformance table and glossary contradictions; both were resolved into draft 3. Every resolution is recorded in chapter 17. The worldsim-maintainer provenance review produced 65 findings (about seventy of ninety checked claims verified with file-level evidence; five wrong in a way that would mislead a port, among them the tab bar hover claim, the ellipsis row, and which widgets forward z; one structural omission, worldsim's absolute coordinates) and was resolved into draft 4, which also gained a migration order for worldsim (chapter 16.4) and a not-applicable scoring rule (R14.9) so the drag service, transform, and animator do not fail a project with no use for them.
- Preserved the research and review reports verbatim under `docs/ui-rendering-spec/research/` and `review/` so the spec's provenance survives the session.
- Wrote the implementation specification for this repo at `docs/specs/ui-rendering-engine-implementation.md` (seven phases, toolchain decisions, board structure, success criteria, risks) and the decision record `docs/AI_TECHNICAL_DECISIONS/ui-rendering-spec-adoption.md`. No board items were created; that is the next step when implementation starts.

**How:**
- Research fan-out to five parallel agents writing structured reports with file-and-line citations; the spec was written from those plus direct reading of worldsim's ordering commits (global draw-group z-sort, the reverted overlay queue, the world/UI flush barrier) and design docs.
- Rules are numbered per chapter so reviews, tests, and PRs can cite them; each chapter carries its incidents, rationale, required tests, and a conformance checklist; chapter 14 scores both worldsim and this engine against every required item.

**Notable findings about this codebase (from the audit, evidence in the research folder):** text always paints above shapes drawn in the same clip scope because the text batch flushes on scissor changes, which is the mechanism behind DDB-28 and DDB-31; `borderRadius`, `opacity`, `fontFamily`, `fontWeight`, and `zIndex` are parsed and ignored; `Button` and `Input` ignore their style objects entirely; hit testing ignores occlusion, clipping, and visibility; the combat screen has two different layouts (construction and resize); the F5 overlay measures only the frame interval.

## Migrated task tracking to Specboard (2026-08-22)

**What changed:**
- All planning moved from AI_DEVELOPMENT_HUB.md to Specboard: https://specboard.io/projects/6b4e4cdd-15bc-4001-8280-706838168f2e
- Created six epics with ~40 bugs/tasks: Security and correctness fixes (P0 defects as bugs), Dead code purge, Toolchain modernization, Code convention cleanup, Combat UI and gameplay debt (live-verified rendering bugs), and Game feature roadmap (the unbuilt Game Flow spec phases 4-6 from the old hub, spec docs linked).
- Hub's to-do and roadmap sections replaced with a pointer to the board; CLAUDE.md todo-management instruction updated to use the Specboard MCP tools.
- Old planning docs audited for open items: PERFORMANCE_OPTIMIZATION_PLAN.md is fully implemented; VEHICLE_POSITIONING_AND_WAVE_SYSTEM.md's remaining phase (waves + movement cards) became a roadmap task.

## Project Survey and Documentation Rebuild (2026-08-22)

**What changed:**
- Full re-survey of the dropped project: tests (128/128 pass), lint (0 errors), web build (compiles), live click-through of menu → driver selection → combat with working enemy AI, plus a code audit for stubs, dead code, and doc drift.
- Rewrote AI_DEVELOPMENT_HUB.md around a verified current-state (working / built-but-broken / never-built) and a prioritized modernization to-do list.
- Deleted MISSING_COMBAT_FEATURES.md: nearly every "missing" feature (range, hit calc, flanking, ram formulas, occupant damage, targeting restrictions) was implemented in the June–July 2025 combat work. The two genuinely missing pieces (`Battle.endCombat()` never called in production, no post-combat effects pass) moved to the hub's P0 list.
- Corrected fabricated doc dates (see note above) and the stale screen-lifecycle instructions in CLAUDE.md (activate/deactivate → mount/unmount, registration in ScreenManager not Game.ts).

**Key findings:** battle-end double navigation, dead per-property Model listeners in ui/Vehicle.ts, Electron build broken since early on, production deploys ship dev-mode bundles (no NODE_ENV=production), CI shell injection via `github.head_ref` in cleanup-pr.yml, stale `public/cards.json` fork, ~10 dead modules, CI pinned to EOL Node 18. Details and priorities in the hub.

## UI Component Lifecycle Standardization (2025-07-03)

### Fixed Ghost Click Bug and Standardized Component Lifecycle

**What Changed:**
- Fixed bug where main menu buttons remained clickable after navigating to combat screen
- Standardized all component lifecycle methods to use mount/unmount terminology
- Screen base class now properly unmounts all child components when unmounting

**Technical Details:**
- **Screen.unmount()**: Now calls `rootLayer.unmount()` to recursively clean up all children
- **Component Renames**: 
  - `cleanup()` → `unmount()` in Component, Layer, Panel, Input classes
  - `destroy()` → `unmount()` in Vehicle UI component
  - `dispose()` → `unmount()` in FontAtlas class
- **Button Fix**: Buttons now properly unregister from InputSystem via unmount chain

**Benefits:**
- No more ghost clicks from previous screens
- Consistent lifecycle terminology across entire codebase
- Proper memory cleanup and event handler removal
- Clear component lifecycle: mount (if applicable) → unmount

## Screen Manager Architecture Implementation (2025-07-03)

### Implemented ScreenManager with Lazy Loading

**What Changed:**
- Created ScreenManager as a static class for global screen navigation
- Removed all screen creation from Game.createScreens() 
- Screens now created on-demand when navigated to
- Removed callback-based navigation in favor of direct ScreenManager.navigate() calls
- Fixed CardShowcaseScreen creating cards in constructor

**Technical Details:**
- **ScreenManager**: Static class with `navigate()`, `update()`, `render()` methods
- **Screen Creation**: Map of screen names to constructors, screens created fresh on each navigation
- **Navigation Pattern**: Screens call `ScreenManager.navigate('screenName', data)` directly
- **Memory Management**: Screens fully destroyed when navigating away (no caching)
- **Data Passing**: Combat screen receives drivers via navigation data in `onMount()`

**Benefits:**
- Fixes input handler bug where inactive screens intercepted clicks
- Reduces memory usage - only active screen exists
- Cleaner architecture with separation of concerns
- Simpler navigation without callback spaghetti

### Fixed Combat Screen Initialization Issues

**What Changed:**
- Fixed async initialization timing issues in combat screen
- Added proper promise handling in Screen base class for async onMount
- Combat screen now properly updates UI after async initialization completes
- Added development fallback for direct navigation to combat

**Technical Details:**
- Screen base class now properly handles async onMount methods
- Added explicit `updateUIFromBattle()` call after combat initialization
- Development mode: If no drivers provided, loads default drivers automatically
- Fixed timing issue where UI was rendering before battle data was ready

## Layer Rendering and Overflow Fixes (2025-07-03)

### Fixed Layer Stacking Issues in Combat Screen

**What Changed:**
- Fixed card text showing through bottom resource bar
- Added overflow clipping to all combat layers
- Improved card positioning with vertical padding

**Technical Details:**
- Added `setOverflow('hidden')` to PlayerHandLayer, ResourceBarLayer, and BattlefieldLayer base class
- Modified card layout logic to ensure cards stay within layer bounds with 10px vertical padding
- Prevents UI elements from bleeding across layer boundaries

## AI Integration and Combat Enhancements (2025-07-03)

### Integrated AI System into Main Game

**What Changed:**
- Enabled AI controller in CombatScreen - enemies now use AggressiveFlankerAI
- Removed placeholder enemy turn logic
- Enhanced combat logging to match battle simulator's comprehensive output
- Fixed card click routing bug causing navigation to wrong screens

**Technical Details:**
- **AI Integration**: 
  - Added `battle.aiController.setEnemyAI('aggressive')` in CombatScreen.initializeCombat()
  - Battle system already handles AI turns automatically via executeEnemyAction()
  - Same AI strategies from battle simulator now work in main game
- **Enhanced Logging**:
  - Added 6 new CombatLogType entries: MISS, ARMOR, RESOURCE, POSITION, BATTLE_START, BATTLE_END
  - CombatLog.addBattleMessage() method maps Battle message types to log types
  - Added turn numbers to log entries with `[Turn X]` prefix
  - Enhanced color coding for all message types
- **Card Click Bug Fix**:
  - Root cause: Cards not unregistered from InputSystem when screens unmount
  - Solution: Added unmount() calls in screen unmount methods
  - CardShowcaseScreen tracks and cleans up card components
  - CombatScreen calls unmount() on all layers
  - Leveraged existing Layer/Component unmount() architecture

=========================================

## Combat Targeting System Fix (2025-07-03)

### Fixed Card Targeting Not Working

**What Changed:**
- Removed arrow visualization that was causing complexity
- Fixed CombatModel to properly emit 'targetedVehicle' event
- Fixed CombatLogLayer to handle Model change events correctly
- Removed global click handler that was interfering with vehicle clicks

**Technical Details:**
- **Root Cause**: Model base class only emits generic 'change' events, but CombatScreen was listening for specific 'targetedVehicle' event
- **Solution**: Added manual emit of 'targetedVehicle' event in CombatModel.targetVehicle()
- **CombatLog Fix**: Updated to handle Model's state-based change events instead of expecting added/removed arrays

## Combat Interface Bug Fixes (2025-07-03)

### Fixed High-Priority Combat UI Issues

**What Changed:**
- Fixed card targeting system - removed arrow, simplified to click-based targeting
- Fixed card removal from hand after playing
- Fixed end turn functionality to properly draw new cards
- Fixed resource display updates with per-driver adrenaline tracking
- Added victory/defeat screen with proper data passing

**Technical Details:**
- **Card Targeting**: Simplified system - select card, then click enemy vehicle
- **Card Playing**: Cards properly removed via Driver.playCard() method, UI updates after
- **End Turn**: 
  - Added `emit('stateChanged')` in startPlayerTurn for UI updates
  - Fixed card discard order - hands now discarded before drawing
- **Resource Display**: 
  - Modified PlayerHandLayer to track per-driver adrenaline Map
  - Added setDriverAdrenaline() method replacing single pool
  - canPlayCard() now checks correct driver's adrenaline via cardDriverMap
- **Victory/Defeat Screen**:
  - Enhanced Screen base class with mount(data?: unknown) support
  - Updated Game.showScreen() to accept optional data parameter  
  - Created BattleResultScreen with DRY layoutUI() method
  - Integrated with CombatScreen via getBattleState() method

=========================================

## Battle Log Display for Human Player Interface (2025-07-02)

### Added Real-time Battle Log to Human Player UI

**What Changed:**
- Added a scrollable battle log pane on the right side of the human player interface
- Battle messages are displayed in real-time as the game progresses
- Each message type has its own color coding for better readability
- Log automatically scrolls to show the newest entries
- **Driver names now include team prefixes** (Player1/Player2 or Enemy1/Enemy2) for clarity

**Technical Details:**
- Modified HTML structure to use a flex layout with game board on left and log on right
- Battle log pane is 400px wide with scrollable content area
- Forwarded battle message events from Battle instance to window events
- Added event listener to capture and display battle messages
- Color-coded message types:
  - Damage dealt: Red
  - Healing: Green
  - Turn start/end: Blue
  - Card played: Purple
  - Miss: Gray (italic)
  - Battle start/end: Yellow
- Messages include turn numbers for context
- Log clears when starting a new battle
- Added `getDriverDisplayName()` helper method to Battle class that prefixes driver names with:
  - Player1/Player2 for player team drivers
  - Enemy1/Enemy2 for enemy team drivers
- Updated all battle log messages to use the new display names

=========================================

## Adrenaline System Configuration Update (2025-07-02)

### Changed Default Max Adrenaline from 10 to 5

**What Changed:**
- Added `maxAdrenaline` property to the `DriverConfig` interface
- Updated all driver configurations to include `maxAdrenaline: 5`
- Modified `DriverLoader` to use the configured max adrenaline value instead of hardcoded 10
- Fixed `getConfig()` method to include maxAdrenaline in returned configuration

**Technical Details:**
- `maxAdrenaline` is now exposed alongside `maxHitpoints` in driver configurations
- All four driver archetypes (road_warrior, interceptor, mechanic, raider) now have 5 max adrenaline
- Starting adrenaline remains at 3
- This change makes the game more tactical by limiting the energy pool for playing cards
- Players must be more strategic about card usage with the reduced adrenaline capacity

=========================================

## Human Player Interface for Battle Simulator (2025-07-02)

### Added Human Player Support to Battle System

**What Changed:**
- Implemented human player option in battle.html, allowing manual card play instead of AI-only battles
- Created HumanPlayerInterface class to manage player decisions and UI interactions
- Modified BattleSimulator to support human input through promise-based decision system
- Added comprehensive interactive UI overlay for human players

**Technical Details:**
- Created event-driven architecture using custom events for UI updates
- UI Components:
  - Team displays showing vehicle status (structure, armor, position, drivers)
  - Driver sections with hand display showing cards with costs and effects
  - Visual feedback for playable vs unplayable cards (based on adrenaline)
  - Target selection interface that highlights valid targets
  - End turn button for passing control to enemy AI
- Card selection flow:
  1. Player clicks card → Card is highlighted
  2. If card needs target → Valid targets are highlighted
  3. Player clicks target → Card is played
  4. UI updates to show new game state
- Maintained full compatibility with existing AI vs AI battles
- Fixed TypeScript issues with TargetType enum values and Team method names

=========================================

## Ramming AI Implementation (2024-12-30)

### Created Ramming-Focused AI Strategy

**What Changed:**
- Implemented RammingAI strategy that prioritizes vehicle collision attacks
- Added 'ramming' as a new AI type in AIController
- Created comprehensive test suite for RammingAI behavior
- Updated AI Development Hub documentation with new strategy details

**Technical Details:**
- Strategy prioritizes ramming attacks with highest score (+300)
- Speed boosts are high priority (+250) to enable effective ramming
- Armor is valued (+200) for protection during collisions
- Detects ramming cards by:
  - Card type/description containing 'ram'
  - Effects with scaling: 'ramming'
  - Formula-based damage (e.g., 'armor/10 + speed_diff')
- Estimates ram damage based on armor, speed difference, and driver skills
- Prefers front position for optimal ramming range
- Targets low-health enemies for kill bonuses
- Still maintains survival instincts (healing at <30% health)
- Full test coverage validates all strategic priorities

## Salvage AI Implementation (2024-12-30)

### Created AI Strategy for Vehicle Salvage

**What Changed:**
- Implemented SalvageAI strategy that minimizes vehicle damage for salvage opportunities
- Added 'salvage' as a new AI type in AIController
- Updated AI Development Hub documentation with new strategy
- **Major revision**: Redesigned AI to be competitive while maintaining salvage focus

**Technical Details:**
- Initial implementation was too passive and lost to RandomAI
- Redesigned with game state awareness:
  - Evaluates health ratios to determine if in danger or winning
  - Switches strategies based on game state (survival mode when losing)
  - Prioritizes flanking position for 50% damage bonus (+150 score)
  - Values card draw to find headshots faster (+80 score)
  - Focuses fire on damaged vehicles for efficiency
- Headshot priority reduced from +1000 to +500 for better balance
- Structure damage penalty reduced from -10 to -5 per damage
- Added team detection to properly evaluate game state
- Demonstrates strategic depth while maintaining salvage theme

## AI Evaluation System (2024-12-30)

### Created Comprehensive AI Evaluation System

**What Changed:**
- Created AIEvaluator class to run automated AI vs AI tournaments
- Built `/evalai.html` endpoint for running and visualizing AI evaluations
- Implemented round-robin tournament system with configurable parameters
- Added detailed metrics tracking and reporting

**Technical Details:**
- AIEvaluator runs matches between all AI type combinations
- Tests with different driver configurations to assess adaptability
- Tracks win rates, head-to-head records, average turns per game
- Provides both summary rankings and detailed match results
- Web interface allows configuration of:
  - Which AI types to test
  - Number of games per matchup
  - Driver randomization settings
- Results consistently show:
  - MCTS AI performs best (highest win rate)
  - Aggressive Flanker AI second
  - Random AI baseline performance

## Monte Carlo Tree Search AI Implementation (2025-06-30)

### Implemented MCTS AI Player

**What Changed:**
- Created MCTSNode class for tree structure with UCB1 selection
- Implemented MCTSAI player using Monte Carlo Tree Search algorithm
- Added MCTS to AIController as a selectable AI type
- Created comprehensive test suite for MCTS functionality
- Updated battle simulator to support MCTS AI selection
- **Improved MCTS to be competitive**: Fixed evaluation issues that made it lose to Random AI

**Technical Details:**
- Uses UCB1 (Upper Confidence Bound) for balancing exploration vs exploitation
- Simplified implementation using action evaluation rather than full game state cloning
- Improved parameters: iterations (2000), exploration constant (1.4)
- Enhanced evaluation with strategic weights:
  - ELIMINATION_SCORE = 10.0 (huge bonus for finishing enemies)
  - FLANKING_BONUS = 1.5 (50% damage bonus consideration)
  - Position changes and speed boosts for flanking strategy
  - Better resource management (penalizes ending turn with good plays available)
- Context-aware evaluation:
  - Considers target health, armor, and position
  - Evaluates card synergies with driver skills
  - Prioritizes low-health target elimination
  - Values self-preservation when critical

**Performance Improvements:**
- No longer loses to Random AI consistently
- Makes strategic decisions similar to Aggressive Flanker AI
- Better adrenaline usage (doesn't waste turns)
- Smarter target prioritization

## AI Battle Simulator Web Page (2025-06-29)

### Created Web-Based Battle Simulator

**What Changed:**
- Created `/battle` webpage for running AI vs AI battles
- Built interactive UI for selecting AI strategies and drivers for both teams
- Implemented BattleSimulator class that runs battles headlessly
- Added battle result display with team stats and complete battle log
- Modified webpack config to support multiple entry points
- Integrated with existing AI system (Random AI, Aggressive Flanker AI)

**Technical Details:**
- Created `public/battle.html` with team setup forms and result display
- Implemented `src/battle-simulator.ts` as separate webpack entry point
- Modified webpack configs to build both main game and battle simulator
- Battle simulator runs complete battles using AI decisions
- Displays color-coded battle log with all events
- Shows final team stats (vehicle health, driver HP)
- Max 50 turns to prevent infinite loops

**Features:**
- Select AI strategy for player team (Random, Aggressive Flanker)
- Select AI strategy for enemy team (Simple default, Random, Aggressive Flanker)
- Choose drivers for each vehicle (Road Warrior, Interceptor, Mechanic, Raider)
- Run battles and see winner/loser/tie
- View complete battle log with turn-by-turn events
- See final vehicle and driver health stats

**Usage:**
- Navigate to http://localhost:9000/battle.html when dev server is running
- Select AI and drivers for both teams
- Click "Run Battle" to simulate
- Results and battle log display immediately

**Fixes Applied:**
- Fixed cards.json to use `type` instead of `id` for card identifiers
- Updated battle simulator to use `createDriverWithStartingDeck` instead of `getDriver`
- Fixed mismatched card references (coordinated_strike → coordinated_attack)
- Ensured all drivers have properly initialized decks with valid card types

=========================================

## Battle Event Logging System (2025-06-29)

### Implemented Battle Message Logging

**What Changed:**
- Added comprehensive battle event logging system to Battle.ts
- Created `BattleMessage` interface with type, message, timestamp, turn, and metadata
- Added `BattleMessageType` enum for categorizing messages (damage_dealt, heal_applied, etc.)
- Replaced all 30 console.log and 9 console.warn calls with internal log() method
- Implemented public methods for message retrieval:
  - `getMessages()`: Get all battle messages
  - `getMessagesByType(type)`: Get messages of specific type
  - `clearMessages()`: Clear all messages
- Messages stored in WeakMap to work with frozen Model instances
- Each log entry emits 'battleMessage' event for real-time updates

**Technical Details:**
- Messages include metadata for structured data (driver names, card names, damage values)
- Maintains console.log output in non-test environments for debugging
- Updated all Battle.test.ts tests to check battle messages instead of mocking console
- All 39 Battle tests now pass with the new logging system

**Purpose:**
- Provides structured logging for combat UI to display battle events
- Enables filtering and searching through battle history
- Supports future features like combat replay and analytics
- Removes direct console dependencies from production code

=========================================

## Aggressive Flanker AI Strategy (2025-06-29)

### Implemented Advanced AI Strategy

**What Changed:**
- Created `AggressiveFlankerAI` - first advanced AI strategy
- Strategy focuses on maximizing damage through flanking position (50% bonus)
- Implemented intelligent decision scoring system:
  - Prioritizes movement to flanking position when not already there
  - Values speed-boosting cards when below flanking threshold (60 total speed)
  - Scores damage cards higher when in flanking position
  - Targets low-health enemies for elimination
  - Considers vulnerable status effects for additional damage
- Added card effect analysis to understand:
  - Damage potential
  - Position change capabilities
  - Speed modifications
  - Healing and armor effects
- Implemented resource management:
  - Cost efficiency calculations
  - Avoids spending all adrenaline early
- **Critical health healing**: Prioritizes healing when below 30% health

**Technical Details:**
- Extended `AIPlayer` base class with `AggressiveFlankerStrategy`
- Score-based decision making (evaluates all possible actions)
- Factors in position bonuses, target health, and kill potential
- Modular design allows easy creation of additional AI strategies
- Integrated into AIController as the 'aggressive' AI type
- Full test coverage (6/6 tests passing) with edge case handling

## AI Player System Implementation (2025-06-29)

### Created Computer-Run Player System

**What Changed:**
- Created AI player system architecture with swappable implementations
- Implemented core AI components:
  - `AIPlayer` abstract base class for all AI implementations
  - `AIController` for managing AI players for both teams
  - `AIDecision` interface for representing AI actions
  - `GameStateEvaluation` for analyzing current battle state
- Implemented `RandomAI` as baseline strategy
- Integrated AI system with Battle class using WeakMap pattern (to work with frozen Model instances)
- Modified battle system to support async AI decisions
- Created comprehensive unit tests covering all AI functionality

**Technical Details:**
- Used strategy pattern for different AI personalities
- Support for AI controlling either player or enemy teams
- Fallback to simple AI when no AI configured
- Clean integration without UI changes
- Test coverage includes AI vs AI battles

## Cards.json Update to Match Combat Rules (2025-06-28)

### Updated Card Implementations to Follow Current Combat Rules

**What Changed:**
- Updated cards.json to include all cards specified in Combat Rules document
- Added new cards: Point Blank, Far Shoot, Headshot, Ram, Flank, Oil Slick, Caltrops, Medical Kit, Berserker
- Updated existing cards to match rule specifications:
  - Coordinated Strike → Coordinated Attack (3 damage, doubles if partner attacked)
  - Repair Kit (8 healing with overflow to armor)
  - Nitro Boost (3 speed for 2 turns, draw 2 cards)
  - EMP Blast (upgraded cost reduction)
- Updated starting decks to use cards from the Combat Rules
- Created comprehensive unit tests for Battle system

**How:**
- Reviewed Combat Rules document and compared against existing cards.json
- Maintained backward compatibility by keeping existing cards not in rules
- Used consistent effect structures for all card types
- Added proper upgrade effects where specified in rules
- Created Battle.test.ts with full test coverage for battle mechanics

**Key Implementation Details:**
- Range system implemented with `range` property on damage effects
- Hit modifiers for Headshot implemented with `hit_modifier` property
- Formula-based damage for Ram card using `formula` property
- Status effect duration of -1 indicates permanent effects
- Conditional effects use nested `effect` objects
- Target types include: enemy_single, enemy_all, self, ally, same_vehicle, self_driver

=========================================

## Vehicle UI Architecture Refactor and Combat Log Toggle (2025-01-08)

### Completed Major Vehicle Display System Refactor

**What Changed:**
- Refactored vehicle display and targeting system with event-driven architecture
- Created `/game/ui/Vehicle.ts` component that handles its own click/hover events
- Implemented `CombatModel` to manage UI state (selected cards, targeting, focused vehicles)
- Refactored `BattlefieldLayer` hierarchy to pass full Vehicle models instead of just IDs
- Renamed `EnemyLayer` → `EnemyBattlefieldLayer` for consistency
- Moved `/engine/ui/Card.ts` → `/game/ui/Card.ts` for better organization
- Added F6 key to toggle combat log visibility (hidden by default)
- Enhanced InputSystem with global keyboard handler support

**How:**
- Vehicle components now handle their own input events instead of parent layers checking coordinates
- CombatModel uses our Model base class with automatic getters/setters for state management
- Vehicles listen to CombatModel for state changes and update their visual appearance
- Implemented ES6-style property accessors (get/set) throughout
- Used dimmed colors instead of transparency for non-targetable vehicles
- Added global keyboard handlers to InputSystem that work regardless of focus
- Combat log toggle uses new `InputSystem.registerGlobalKeyDown('F6', handler)`

**Key Architecture Decisions:**
- Event-driven UI where components manage their own interactions
- Clear separation between game state (Battle, Vehicle models) and UI state (CombatModel)
- Components receive full model objects, not just IDs, even if they don't use all properties
- Input abstraction using "focused" instead of "hovered" for future controller support
- Global keyboard handlers checked before component-specific handlers

**Technical Details:**
- `combatModel.targetedVehicle` property automatically emits change events when set
- Vehicle onClick handlers simply set `combatData.targetedVehicle = vehicle`
- CombatScreen listens for 'targetedVehicle' changes to handle card plays
- InputSystem stores global handlers in separate Maps from component handlers
- Proper unmount of global handlers on screen unmount

=========================================

## FPS Limiting Investigation and Fix (2025-06-08)

### Fixed Frame Rate Measurement and Removed Broken Frame Limiting

**What Changed:**
- Fixed FPS measurement to show actual frame rate (was showing ~8500 FPS due to timing bug)
- Removed broken frame limiting code that wasn't actually limiting frames
- Now correctly shows 120 FPS on 120Hz displays (browser's natural vsync)
- Simplified game loop to use browser's built-in frame synchronization

**How:**
- Fixed `lastFrameTime` initialization - was comparing against 0 causing huge initial delta
- Removed artificial frame limiting attempts (setTimeout/setImmediate)
- Let browser handle frame timing naturally through requestAnimationFrame
- Now respects display refresh rate automatically

=========================================

## Combat Log System Implementation (2025-01-07)

### Added Combat Event Logging with Scrollable Display

**What Changed:**
- Created CombatLog model class to track all combat events
- Implemented CombatLogLayer UI component with auto-scrolling
- Added comprehensive event logging throughout Battle system
- Color-coded entries by type (damage, heal, turn changes, etc.)
- Driver-specific formatting with [D1]/[D2] prefixes

**How:**
- CombatLog extends Model base class for automatic property management
- Efficient rendering with view window calculation (only renders visible entries)
- Automatic scrolling to bottom when new entries added
- Integrated with Battle system to log all major events
- Each entry typed as CombatLogEntry with timestamp and formatting

=========================================

## Framerate Display Enhancement (2025-01-07)

### Improved FPS Counter Visibility and Stability

**What Changed:**
- Moved FPS display to top-right corner with dark background
- Added 100ms update interval to prevent flickering
- Improved contrast with yellow text on dark background
- Made performance metrics more readable

**How:**
- Added semi-transparent black background panel
- Positioned in top-right to avoid overlapping game content
- Implemented update throttling in PerformanceMonitor
- Only updates display when 100ms have passed since last update

=========================================

## Combat UI Clarity Improvements (2025-01-06)

### Phase 1: Resource Display and Card Ownership

**What Changed:**
- Split resource display to show both drivers' stats separately
- Added card ownership indicators (D1/D2 overlays with color coding)
- Created reusable DriverStatsDisplay component
- Implemented turn/phase display with clear indicators
- Added draw pile and discard pile counts per driver

**How:**
- Extended ResourceBarLayer to show two DriverStatsDisplay components
- Modified Card UI component to show driver badges and tinted backgrounds
- Created TurnPhaseDisplay component with color-coded phase indicators
- Used Model's state management for reactive UI updates

### Phase 2: Vehicle Positioning System

**What Changed:**
- Implemented 3-lane positioning system (Flanking, Back, Front)
- Added visual lanes with proper labels
- Support for multiple vehicles per position (up to 3)
- Smart stacking and spacing within lanes

**How:**
- Created lane-based layout in battlefield layers
- Calculated vehicle positions based on lane and stack index
- Added translucent background rectangles for lane visualization
- Maintained 30px spacing between stacked vehicles

**Technical Decision:**
- See [Vehicle Positioning and Wave System Design](./AI_TECHNICAL_DECISIONS/VEHICLE_POSITIONING_AND_WAVE_SYSTEM.md)

=========================================

## Performance Optimization Implementation (2024-12-30)

### Major Performance Improvements Through Text Batching

**What Changed:**
- Reduced draw calls from 500+ to ~30 per frame (94% reduction)
- Implemented efficient text batching system
- Added real-time performance monitoring (F5 to toggle)
- Fixed upside-down text rendering issue
- Resolved scissor test compatibility with batching

**How:**
- Created TextBatchRenderer with pre-allocated vertex buffers
- Batch all text rendering into single draw call per frame
- Integrated seamlessly with existing immediate-mode rendering
- Added PerformanceMonitor to track metrics in real-time

**Results:**
- Text-heavy screens now performant (DeveloperScreen: 500+ → 30 draw calls)
- Maintains 60 FPS on all screens
- No visual differences - exact same output with better performance

=========================================

## Basic Combat System Implementation (2024-12-29)

### Dual Driver Combat with Individual Resources

**What Changed:**
- Implemented Team-based battle system (Player: 2 vehicles, Enemy: variable)
- Each driver has individual hand, deck, and adrenaline pool
- Created visual combat screen with all major components
- Added turn-based flow with enemy AI
- Implemented card playing mechanics and battle resolution

**How:**
- Refactored from single BattleEntity to Team/Vehicle/Driver architecture
- Created combat UI layers: Enemy, Battlefield, PlayerHand, Resources
- Connected driver selection to combat with proper data flow
- Added Model base class for reactive state management

**Key Features:**
- Players always have initiative (enemy AI simplified)
- Passengers can't play attack cards (role restrictions)
- Click-to-play cards (drag-and-drop deferred)
- Visual feedback for playable/unplayable cards

=========================================

## Driver Selection Screen (2024-12-28)

### Created Two-Panel Driver Selection Interface

**What Changed:**
- Built complete driver selection screen with synergy preview
- Added 4 driver archetypes with full metadata and starting decks
- Implemented dynamic synergy detection between selected drivers
- Created mini-card previews for starting decks

**How:**
- Extended Layer class for DriverPanel components
- Created SynergyPreviewPanel with real-time analysis
- Used singleton DriverLoader for driver instance management
- Connected to main menu and combat screen flow

=========================================

## Card System Foundation (2024-12-27)

### Implemented Complete Card Loading and Display System

**What Changed:**
- Created flexible JSON-based card configuration system
- Built CardLoader singleton for parsing and validation
- Implemented visual Card UI component with full styling
- Added card showcase screen to preview all cards

**How:**
- Designed extensible card effect system with variables
- Added CSS-like text formatting (wrap, ellipsis, shadows)
- Created scrollable grid layout organized by rarity
- Fixed JSON loading from public directory

=========================================

## Driver System Architecture (2024-12-26)

### Built Complete Driver Data Management

**What Changed:**
- Created Driver class with skills, vehicle stats, and metadata
- Implemented DriverLoader for managing driver instances
- Built DriverSynergy system for analyzing driver combinations
- Added driver archetypes: road_warrior, interceptor, mechanic, raider

**How:**
- Structured driver data to match game design specs
- Created flexible synergy detection based on cards and skills
- Integrated with deck building system

=========================================

## Scrollable Panel System (2024-12-23)

### Complete Overhaul of Coordinate System

**What Changed:**
- Implemented RenderContext for proper coordinate transformations
- Added mouse wheel scrolling support
- Fixed hit testing in scrollable containers
- Added keyboard input with focus management

**How:**
- Coordinate transform stack for nested scrolling contexts
- Scissor test integration for proper clipping
- Component-aware coordinate transformation for input events

**Technical Decision:**
- See [Scrollable Panel Architecture](./AI_TECHNICAL_DECISIONS/scrollable-panel-architecture.md)

=========================================

## UI Primitive Expansion (2024-12-20)

### Added Geometric Shapes and Modular Architecture

**What Changed:**
- Added Circle, Triangle, Polygon, Arrow components
- Refactored DeveloperScreen into modular sections
- Added gradient rendering capabilities
- Improved Panel styling with borders and shadows

**How:**
- Extended Component base class for all shapes
- Created section-based architecture for demo screen
- Used efficient triangulation for complex shapes

=========================================

## Developer Screen Creation (2024-12-15)

### Built Comprehensive Component Showcase

**What Changed:**
- Created interactive developer/demo environment
- Added examples of all UI components
- Implemented visual style guide
- Built modular section system

**How:**
- Organized into panels: primitives, text, buttons, inputs, etc.
- Real-time interactive testing capabilities
- Visual demonstration of theming system

=========================================