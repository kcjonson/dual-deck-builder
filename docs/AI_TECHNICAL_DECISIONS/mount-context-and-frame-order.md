# Mount context, lifecycle, and frame order

Status: implemented (DDB-73, second of two PRs), 2026-09-28
Spec: R1.6, R8.14 to R8.18, R8.21, R8.22, R8.28 of the [UI rendering spec](../ui-rendering-spec/08-object-model.md)
Builds on: [component-base-and-render-walk.md](./component-base-and-render-walk.md)

## Problem

Components reached two process-wide singletons: `RendererContext.getInstance().draw` for drawing and measuring, and `InputSystem`'s static `register*` methods, which Button, Input, Panel, Card and Vehicle called from their constructors. Construction therefore had side effects (R8.14 forbids them), a component built but never attached was still hit-tested, tests had to reset global state between cases, and nothing could hand a component a service that depends on where it is mounted. `unmount` recursed and unregistered, but mounting did not exist, so "attached" and "registered" were two unrelated facts that happened to line up. Every component was updated every frame by a recursive `update`, and there was no layout phase: `Layer.layout()` was a size estimate screens called when they chose.

## Decision

**`MountContext` is a plain interface with four services, built by one factory.** `createMountContext({ draw, viewport })` returns `{ draw, input, viewport, frame }`: the draw API, an `InputSystem` instance, the viewport source (the `CanvasViewport` on the pages), and a `UiFrame`. Both pages and every test build it through the factory; `components/testing.ts` wraps it with a null backend and a fixed viewport. The services later phase 3 tasks add (clock and animator, the dispatcher, focus, drag, popups, tooltips, placement, overlays, clipboard, assets) become fields on the same interface; nothing about how components get it changes.

An interface rather than a class, because the context has no behaviour of its own, and a test that needs a spy or a stub replaces a field without subclassing anything.

**`RendererContext` is deleted and `InputSystem` is an instance.** Its static API became instance methods with the same names, its DOM handlers are bound once as fields (the old `unmount` removed freshly bound functions, so nothing was ever removed; `detach` now does), and it takes a `beforeHitTest` hook the factory points at `frame.layout`. The instance lives only in the context. DDB-75 replaces it with the dispatcher; the global key table becomes the root hotkey table.

**Lifecycle on `Component` (R8.15).** `mount(context)` is top-down and idempotent: `onMount(context)` here, then the children. `unmount()` is bottom-up and idempotent: children, `onUnmount()`, then the base releases the component from `input` and `frame` and drops the context. `addChild` on a mounted parent mounts the child at once; `insertChild` of a child under the same root is a move that keeps it mounted, and one from another root is unmounted first (R8.5). Registration moved from constructors to `onMount` in Button, Input, Panel, Card and Vehicle; Vehicle and CombatLogLayer release their model subscriptions in `onUnmount`.

**Screens mount their root with the context.** `Screen.mount(context, data)` sizes the root from `context.viewport` (R8.21), mounts it, then runs `onMount`, so everything the screen builds is mounted as it is added. `ScreenManager.initialize(context)` holds the context for `navigate`. `Screen` exposes `this.context` to subclasses between mount and unmount, which is how CombatScreen and DeveloperScreen reach input. The developer overlay is mounted as a root of its own; the gallery's `SceneHost` mounts its root at construction.

**`UiFrame` owns R8.16's two component phases.** `update(dt)` runs the components that called `requestUpdate()` since the last frame, once each (R8.17); an invisible one keeps its request, an unmounted one is dropped. The recursive `update` is gone: `Input` requests updates while focused for its caret blink, and it was the only component with an `update`. `layout()` runs every dirty relayout boundary, outermost first, and repeats if an `onLayout` invalidated something, up to eight passes before it throws rather than hangs.

**Upward invalidation (R8.18).** Setters for `width`, `height`, `margin` and `visible`, `Text.setText` and `setFontSize`, and child insertion and removal call `invalidateLayout()`, which marks the component and every ancestor up to the nearest relayout boundary and schedules the boundary. `x`, `y`, `transform`, `zIndex`, `opacity`, `layer` and colours do not. Every component is a boundary today, because every component is fixed-size; `isRelayoutBoundary` is the hook phase 4's sizing modes answer. The pass calls `layoutChildren()` on dirty components (a no-op until Stack), then reports `onLayout(bounds)` to every component whose margin box changed, including every component on the first layout after mount.

**Frame order.** Both loops are now update (frame update requests, then screen logic), layout, render, flush, and the `layout` section of R13.7 is measured instead of null. The input system lays out on demand before each hit test, so a click never lands on geometry from before a change. Render never lays out.

## What this does not do

- **The event queue drained at frame start** is not here. Input still dispatches from DOM listeners between frames; queueing it belongs with DDB-75's Pointer Events adapter, which replaces those listeners. Layout on demand before each hit test keeps the ordering guarantee that matters today.
- **Screens that build UI in their constructors** (DeveloperScreen, CardShowcaseScreen) still size from the window there, so `Screen`'s constructor keeps its window-sized root until DDB-79 moves that UI into `onMount`; mount then resizes it to the viewport.
- **Vehicle and CombatLogLayer subscribe to their models in the constructor** and release in `onUnmount`, as before. A remount does not resubscribe; DDB-79 rewrites both.
- **The legacy `layout()` size estimate** stays as an explicit call. It is not the frame's layout pass and runs only where screens call it; phase 4's measure and assign replace it.

## Consequences

- A component constructed and never attached touches no service. Unit tests no longer need to clear a global input system between cases.
- A test that drives input builds a context, mounts its tree, and calls `context.input.setup(canvas)`; the injection hook takes `{ canvas, input }`.
- The `InputSystem` listener-removal bug is fixed as a side effect; `InputSystem.paused.test.ts` now sets up per test and checks a second setup delivers each key once.
