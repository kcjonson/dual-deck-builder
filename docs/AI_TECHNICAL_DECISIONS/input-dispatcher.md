# Input dispatcher and the Pointer Events adapter

Date: 2026-09-28. Task: DDB-75 (DDB-55 phase 3). Spec: chapter 9 of `docs/ui-rendering-spec/`, R8.1, R8.2, R8.16, R8.29, R3.28, R4.8, R4.12.

## Context

`InputSystem` kept per-component maps of mouse handlers and, on every mouse event, asked every registered component `containsScreenPoint` and fired the handler of each one that said yes. Nothing knew paint order, so overlapping components all received the press; a popup promoted out of a clip could not be hit outside it; hover was recomputed per component; there was no bubble, no capture, no click synthesis, and wheel deltas were multiplied by 30. It dispatched straight from DOM listeners, between frames, so R9.2's queue and R8.16's frame order did not hold.

## Decision

`input/Dispatcher.ts` owns input for one mount context and is `context.dispatcher`. `InputSystem` is deleted; its global key map survives as `input/HotkeyTable.ts`, the scene table the dispatcher falls back to.

- **Queue.** `input/PointerAdapter.ts` listens for DOM Pointer Events, `wheel`, and keys, converts to logical pixels, and enqueues. Both frame loops call `dispatchPending()` in a new timed `input` section before update (R8.16, R9.2). Consecutive moves of one pointer coalesce, keeping the skipped positions. Pause drops input at the queue.
- **Hit walk.** `input/hitTest.ts` walks the mounted roots in mount order and each tree exactly as `renderTree` does: own box, then children in `renderOrder`, carrying the point down by removing the origin, inverting the transform, and adding the content offset. A hit replaces the best when its effective layer is at least as high, which is reverse paint order without a sort. Clips gate hits below them and a promotion resets the clip, so a popup declared inside a clipped panel is hit outside it. `none` skips a subtree, `unit` stops descent, `passthrough` is never a target, invisible and zero-opacity subtrees are skipped. Disabled components are targets (they occlude) and the bubble skips them. `dispatcher.hitTest(point, { exclude })` is public.
- **Delivery.** `Component.handleEvent(event)` runs the matching callback property (`onPointerDown`, `onClick`, `onWheel`, `onKeyDown` and the rest of R8.2's input set) and composites override it, calling `super` first. Events bubble through `parent` until consumed.
- **Hover.** The dispatcher keeps the hovered chain (target and ancestors), sets `hovered` through `setHovered`, and delivers `pointerleave` innermost first then `pointerenter` outermost first. It re-derives hover from the still pointer when layout ran (`UiFrame.layoutVersion`), a root came or went, a scroll happened, a capture was released, or a hovered component unmounted.
- **Click.** Synthesised on release at the nearest common inclusive ancestor of the press and release targets (or the captor), only for the primary pointer and button, not past the drag threshold (4 px mouse, 10 px touch), never on a disabled target. A secondary release synthesises `contextmenu`.
- **Capture.** `event.capturePointer()` from `pointerdown`, or `dispatcher.capturePointer`. Touch is captured implicitly. Unmount, hidden, disabled, and window blur cancel with `pointercancel` then `lostpointercapture`.
- **Wheel.** Pixel deltas as is, lines times 16, pages times the scroller's viewport, Shift swaps a vertical-only delta. The first event of a gesture latches the innermost ancestor of the hit whose `canScroll` says yes; events within 150 ms stay with it. `Panel` implements `canScroll` and scrolls by exactly the delta, and a scrollable `Panel` is `pointerEvents: 'auto'` so its gaps take the wheel.
- **Keys and focus.** Keys go to `dispatcher.focused`, bubble, and an unconsumed keydown reaches the hotkey table. Focus is a seam, not DDB-76's manager: `focus(component)` fires blur then focus, and a press outside the focused component clears it. The adapter prevents a key's default when a hotkey or a focused component will take it, since dispatch itself waits for the frame.

## Options considered

- Keep `InputSystem`'s registration API and put a dispatcher behind it, then migrate: rejected because registrations are exactly what the tree replaces; every call site changes shape anyway, and the implementation spec's ground rules forbid the parallel path.
- Roots supplied by the shell in paint order: rejected for mount order, which equals paint order for both shells. The one root that paints over a screen without being a target, the F5 overlay, is `pointerEvents: 'none'`.
- Injection straight into the queue: rejected. The hook dispatches DOM events at the adapter's listeners (a `PointerEvent`, or a `MouseEvent` under the pointer type name in jsdom), so injected input takes the real path (R13.35).

## Consequences

- Behaviour changes, all per the spec: a click needs press and release on the same thing and no drag past the threshold (Card, Vehicle, Button); Vehicle targets on click rather than on press; one wheel notch scrolls about 100 px instead of 3000; Escape now reaches combat (it was registered on a root that never had focus); only the topmost of overlapping components receives a press.
- Input takes effect on the frame after it arrives. Tests call `dispatchPending()` or `injectNow` from `components/testing.ts`.
- `Button.onClick` is the base callback property, assigned rather than called.
- Left for later: touch-hold `contextmenu` (needs DDB-74's clock), the injection grammar's `pointerId`, `pointerType` and `cancel` fields, per-root and overlay hotkey tables (DDB-78), `activate`/`cancel` actions and the focus manager (DDB-76), drag and drop on top of capture and `hitTest({ exclude })` (DDB-77), `detachTransform` (R3.8).
