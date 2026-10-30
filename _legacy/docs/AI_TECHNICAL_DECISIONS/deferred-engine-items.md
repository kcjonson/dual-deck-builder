# Deferred engine items (DDB-94)

## Date
2026-10-02

## Context

Phase 7 of the [implementation spec](../specs/ui-rendering-engine-implementation.md) ends with a catch-all checkbox: "Deferred and optional: off-screen group opacity composite, stencil clips, the gamepad adapter (DDB-51), the UI scale setting (R7.5), instruction-list reuse (R8.19), cross-fade transitions." DDB-94's notes added IME composition (decided not now in DDB-220) and the UI scale slot in Settings, and DDB-237 (a D-pad walking past selects) waits on the gamepad adapter. The instruction was to split the checkbox when it was picked up, build only what the spec requires, and record the rest.

The test for "required" is the spec's own: a MUST or SHALL that this engine's conformance depends on, which in practice means a row marked required in a chapter's conformance checklist (14.4 scores those, and section 8's first success criterion is every required row at yes), or one of section 8's other criteria. The DDB-93 re-score (#136) puts the engine at 85 yes and 15 partial of 100 required rows, and none of the fifteen partials is one of these items. The required rows these items sit next to all score yes, with the item noted as deferred: inherited opacity (3), input converted once at the dispatcher (7, "the UI scale setting is deferred"), `activate`, `cancel`, and `inputMode` (9, "the controller source is deferred"), directional focus (9, DDB-237 deferred), TextInput (12), and ScreenTransition (12). The chapter 15 backend row is partial, but for runtime card fetches (R15.34), not for IME.

## Decision

None of the eight is required. Each is decided not now; no task was filed. The table is the summary, the sections below have the reasons and what would reopen each one.

| Item | Rule | Level | Decision |
|---|---|---|---|
| Group opacity via off-screen composite | R3.26, R8.20 | MAY; optional row in 3.13 | not now |
| Stencil clips for arbitrary shapes | R4.15 | MAY; optional row in 4.8 | not now |
| Gamepad adapter | R15.40, R9.27 | optional (row added to 15.13 by this change) | not now, with DDB-51 |
| D-pad past selects in controller mode | R9.24, DDB-237 | open in the spec; needs the gamepad adapter | not now, with DDB-51 |
| UI scale setting | R7.5 | recommended row in 7.9 (SHOULD after this change) | not now, with DDB-51 |
| Instruction-list reuse and draw caches | R8.19 | MAY; optional row in 8.10 | not now |
| Cross-fade screen transition | R12.38 | optional row in 12.10; the fade is required and built | not now |
| IME composition | R12.10, R15.39 | out of baseline scope; optional row in 12.10 after this change | not now (DDB-220) |

### Group opacity composite (R3.26, R8.20)

R3.26 accepts per-draw opacity at the baseline ("a half-transparent panel shows its own background through its own text") and lets an implementation offer true group opacity. The engine multiplies inherited opacity per draw, which scores yes on chapter 3's required "Inherited opacity multiplier" row. The MUST in R3.26 (fall back to scalar opacity for a subtree with a promoted descendant) only binds an implementation that composites, so it doesn't apply.

Nothing on screen shows the artefact badly enough to pay for it. ScreenTransition fades with one full-viewport quad over the scene, so screen changes never fade a subtree. The subtree fades that exist (the splash root, the discard flight, the turn banner, damage numbers) last a fraction of a second, and the artefact during them, a card's frame showing through its own text for a few frames, hasn't been reported. A composite needs off-screen targets with their own viewport (R7.13), a pool (R5.34), `targetSwitches` counting, and nested sort domains, which is the largest single piece of renderer work left, for a fix nobody can see today.

Reopen when a fading panel, card, or dialog with overlapping children shows its insides during the fade, or when the cross-fade below is picked up, since both need the same off-screen target. That also answers chapter 17.6's open question for this engine: not yet.

### Stencil clips (R4.15)

The clip stack carries a rect and a rounded rect as per-draw data (R4.14, recommended, built), which covers every clip the game draws: scroll containers, panels, popovers, card frames. No screen asks for a circle or polygon clip. R4.15's MUST is that an implementation without a stencil path rejects non-rect shapes at the API instead of approximating them; `DrawApi` only has `pushClip(rect)`, `pushClipRounded(rect, radius)`, and `pushClipReset()`, so there is no shape to reject, and the context is created with `stencil: false` as R15.2 and R5.29 ask. The `stencilLevel` split counter stays at zero.

Reopen when a design needs a non-rect mask (a circular portrait crop, a shaped reveal). A circle crop of an image is probably cheaper as an SDF image mode in the uber shader than as a stencil pass, so that would be its own decision.

### Gamepad adapter (R15.40) and DDB-237

R15.40 describes how a gamepad adapter works (poll `getGamepads()` once per frame, D-pad and left stick to `focusDirection`, confirm and cancel to `activate` and `cancel`, right stick to a `virtual` pointer) but states no level, and chapter 15's checklist had no row for it. R9.27 makes it conditional: "a platform shell with a controller" drives directional focus and a virtual pointer. Everything the adapter would call already exists and scores yes: `activate` and `cancel`, `inputMode` with a `controller` value, directional focus (R9.26), and the `virtual` pointer type, which already switches `inputMode` to `controller` in the dispatcher. This change adds the missing level: R15.40 is a MAY and chapter 15's checklist lists the gamepad adapter as optional.

The reason to build it is a product one, and it belongs to DDB-51 (Game Flow spec section 8.2, console and Steam Deck), which hasn't decided the controller layout, the shoulder-button and radial-menu mappings, or whether a controller target ships at all. Building the adapter before that would pick those mappings by accident.

DDB-237 goes with it. Under R9.24 a closed Select or DropdownButton opens on Down and a NumberInput steps on Up and Down, so a D-pad walking a column stops on them. That is right for keyboard and pointer users, and the controller-mode alternative (open on `activate` only) can't be tested without a controller driving directional focus. R9.24 now says it waits on the gamepad adapter instead of calling it open.

Reopen with DDB-51: when a controller target is decided, the adapter and DDB-237 are one task, and the adapter's tests are adapter-level like `PointerAdapter`'s (a fake `getGamepads` source, no device).

### UI scale setting (R7.5)

R7.5 is a recommended row and now reads SHOULD. The arithmetic is built and tested: `resolveViewport` defines the logical viewport as `framebuffer / (dpr * uiScale)`, the draw API snaps with `dpr * uiScale`, and `PointerAdapter` divides input by `uiScale`. What's missing is the setting: `CanvasViewport` and `PointerAdapter` take `uiScale` at construction, so it can't change live, and Settings (DDB-38) has a slot for it but nothing to drive. At a scale above 1 the logical viewport shrinks, so combat would also need checking at 1024x600 divided by the scale, which today's two golden sizes don't cover.

The case for it is the Steam Deck ("UI scales appropriately for the 7-inch screen", Game Flow 8.3), so it goes with DDB-51. Reopen with the platform work, or sooner if desktop players at 1024x600 report text too small; the work is a live `uiScale` setter on the viewport owner that re-runs layout through the resize path (R7.12), the adapter reading the same value, a Settings panel, and a third golden size.

### Instruction-list reuse (R8.19)

R8.19 makes the baseline a full re-emit every frame and lets an implementation cache per-component draw data or retain a subtree's sorted draw list. Section 8's performance criterion is met without either: combat is one GPU draw a frame at a frame p99 of 5.32 ms against 16.67 ms (DDB-68), and the batcher reuses its upload and work objects. A retained list adds invalidation on every ancestor change (R8.19's MUST NOT), which is exactly the class of stale-frame bug that's hard to see in a golden.

Reopen when a capture (`perf-capture.mjs`, R13.38) shows CPU emit time is what puts a screen over budget, starting with glyph quad caching on large static text, which R8.19 allows with the smallest invalidation surface.

### Cross-fade transition (R12.38)

R12.38 requires the fade and makes the cross-fade optional; the fade is built (DDB-90) and scores yes. A cross-fade renders the outgoing scene once into an off-screen target and composites it under the incoming one, which needs the same target and pool as group opacity. Every navigation fades through a dark frame today, which suits the game's look. Reopen together with the group opacity composite.

### IME composition (R12.10, R15.39)

Decided not now in DDB-220 (#127), recorded in [component-catalog-wave-b.md](./component-catalog-wave-b.md). R12.10 and R15.39 put composition out of the baseline, and R15.39's MUST (composing keydowns never reach a field) is built in `PointerAdapter`. Every text field is on the developer screen. This change adds IME composition to chapter 12's optional row so the checklist says what the rule text says. Reopen when a player-facing text field appears (a save name, a seed entry).

## Consequences

- The phase 7 checkbox is ticked with this document as its record; DDB-94 closes without children.
- Group opacity and the cross-fade share their reopening trigger and should be one task when it fires.
- The gamepad adapter, DDB-237, and the UI scale setting reopen with DDB-51, which owns the product decision.
- Spec text changed only to make levels consistent with the checklists: R15.40 is a MAY with a row in 15.13, R7.5 is a SHOULD, R9.24 points DDB-237's question at the gamepad adapter, and 12.10's optional row names IME composition.
