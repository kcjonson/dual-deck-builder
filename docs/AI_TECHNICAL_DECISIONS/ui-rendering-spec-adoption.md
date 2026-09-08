# Adopt the layered UI rendering specification and rebuild the renderer to it

## Date
2026-09-07

## Context

The engine under `src/renderer/engine` was written in a few weeks in mid-2025 and has not been touched since. It renders through a WebGL1 context with one draw call per shape, batches only text and flushes that batch on every scissor change (so text always paints above shapes in the same clip scope), drops `borderRadius`, `opacity`, `fontFamily`, `fontWeight`, and `zIndex` after parsing them, rasterises a single 32 px Arial bitmap and scales it to every text size, has no layout engine, no theme, no popups, no focus manager, and no machine-readable way to verify a screen. The live rendering bugs on the board (doubled card titles, hand overflow, overlapping turn banner, off-centre titles, deck preview through a button) are all consequences of those gaps, and panel scrolling and the splash fade are blocked on them.

The sibling project worldsim (C++, OpenGL) built a full UI system for its game over the past year: a batched painter's renderer with a stable draw-group sort and flush barriers, shader-side clipping, an SDF uber shader, MSDF text, a fixed/hug/fill layout engine, a focus manager, a token pipeline, and a sandbox with a JSON tree snapshot, a layout lint, screenshot and input-injection endpoints. Its development log records the ordering, clipping, and text bugs that shaped each of those. The owner wants that work carried over and the UI here polished on top of it, and wants the shared design written down so both projects can learn from it.

## Options considered

1. Fix the current engine incrementally (sort text into the shape order, implement `borderRadius`, add scrolling, add opacity).
   - Pros: smallest first step; no new concepts.
   - Cons: every fix touches the same per-shape draw path and the text batch; no batching, no layout, no theme, no popups, no verification would follow; the same bugs worldsim spent a year on would be rediscovered one at a time.
2. Adopt a third-party 2D renderer or UI library (PixiJS v8 with its UI and layout packages, or a DOM overlay for UI).
   - Pros: batching, masks, text, and an event system exist today; large community.
   - Cons: PixiJS's ordering model (per-container `sortableChildren`, render layers, filters for group effects) and its text options (canvas-rasterised or bitmap fonts) differ from what the owner has already validated; SDF shapes, shader clipping, the layout lint, and the snapshot would still be custom; a DOM overlay splits the UI across two renderers with two ordering models and breaks the Electron and screenshot story. The project's stated preference is a single super shader and its own engine.
3. Write a backend-agnostic specification abstracted from worldsim, challenged against published designs, and rebuild this engine to it in phases while keeping the game playable.
   - Pros: the design is already proven in production on the sibling project; the specification makes the ordering contract testable and gives both projects a conformance score; the tooling (snapshot, lint, gallery, screenshots) lands first and gates everything after.
   - Cons: a multi-phase rewrite of the engine and a visual pass over every screen; a font asset pipeline; Playwright and a WebGL2 requirement.

## Decision

Option 3. The specification lives at `docs/ui-rendering-spec/` (self-contained, liftable into its own repository, with its research inputs under `research/` and the review reports under `review/`), the implementation specification for this repository at `docs/specs/ui-rendering-engine-implementation.md`, and the work will be tracked as one epic on the board with that implementation document linked as its spec. Phase 1 of the effort (this decision) is documentation only; no engine code changed.

Headline design choices the specification fixes, each with the incident behind it in the spec's rationale sections:

- Painter's algorithm with no depth buffer; draw groups per call stable-sorted by a named layer (`base`, `raised`, `overlay`, `modal`, `popup`, `toast`, `tooltip`, `drag`) with a single-layer fast path; component `zIndex` orders siblings only and never reaches the batcher; explicit flush barriers separate world and UI sort domains.
- Clipping as per-draw data with a three-state clip stack, no scissor state, content offset decoupled from clip.
- One uber shader with explicit modes, SDF rounded rectangles with borders and shadows, premultiplied alpha end to end, sRGB-space blending.
- MSDF text in the same batch as shapes, measurement sharing the render iteration, run-origin pixel snapping.
- A retained tree with a mount context instead of singletons, a hit-test walk mirroring paint order with bubbling and pointer capture, a focus manager with scopes, a fixed/hug/fill stack layout engine, a generated token module with variant-by-state style tables.
- Development tooling as part of the engine: frame timer, batcher counters with flush reasons, tree snapshot, layout lint as the merge gate, an addressable gallery, screenshot and input-injection hooks, Playwright goldens.

## Rationale

The bugs on the board are symptoms of missing ordering, clipping, text, and layout foundations, not isolated defects; fixing them in place would leave the next screen to hit the same wall. Worldsim's design is the one the owner has already iterated on visually, and its recorded incidents are the strongest evidence available for which rules matter. A written specification with numbered rules and conformance tables turns "port worldsim's UI" into checkable work and lets worldsim adopt the corrections the review surfaced (its own gap list is chapter 16). Building the verification net first is worldsim's most repeated lesson and the reason the plan starts with the snapshot, lint, gallery, and screenshots rather than with the shader.

## Consequences

- Every screen changes appearance during the migration (text ordering, working corner radii, honoured button styles, real font metrics); the plan schedules three deliberate re-baselines and forbids polishing screens until the engine phases are done.
- WebGL2 becomes a hard requirement; WebGL1-only environments are dropped.
- A font asset pipeline (MSDF atlases from licensed fonts) and Playwright join the toolchain; CI needs the software-GL flags for headless WebGL.
- The engine's public surface (`Layer` tree API, `Style` keys, `Text`, `Panel`, `Button`, `Input` names) is preserved where the audit found call sites depend on it, and the singletons, `getX`/`setX` pairs, positional constructors, and dead modules are removed as each area is touched.
- The specification adds a maintenance duty: rule changes are recorded, and both projects' conformance tables are re-scored when they change.
- Risk: the specification was written and reviewed in one session; its rules will meet reality in phase 1, and the review log (`docs/ui-rendering-spec/17-review-log.md`) is where disagreements found during implementation are recorded before the rule text changes.

## Implementation notes

See `docs/specs/ui-rendering-engine-implementation.md` for phases, toolchain decisions, the board structure to create, the success criteria, and the risk list. Rule ids in PR descriptions are the link between code and specification.
