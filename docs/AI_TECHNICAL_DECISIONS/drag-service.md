# Drag service

Date: 2026-09-28. Task: DDB-77 (DDB-55 phase 3). Spec: R9.12 (a to e) in `docs/ui-rendering-spec/09-input-and-focus.md`, R9.1, R9.31, R11.11's `dropActive`.

## Context

DDB-75's dispatcher left drag and drop as a flag: `Component.dragSource`, set by hand, made movement past the threshold cancel a click. Nothing synthesised drag events, so a captured drag could never tell the enemy under it that it was there (capture suppresses that enemy's `pointerenter`, which is R9.12's whole reason). The game has no drag today: a card is played by clicking it and then its target, and the hand layer's doc comment claiming "drag targeting" was wrong. Drag to play, with highlights and a preview line, is DDB-88 in phase 6.

## Decision

`input/DragService.ts`, one per dispatcher, constructed by it and handed out as `context.drag`.

- **Start.** `context.drag.start({ event, source, data, ghost?, threshold? })` from a `pointerdown` handler. The service captures the pointer for the source unless something already has. The threshold is the pointer type's `control` token (`drag_threshold_mouse` 4, `drag_threshold_touch` 10) unless given; `dragThreshold(pointerType)` is exported and the dispatcher's touch hold uses it too, so the constants `DRAG_THRESHOLD_MOUSE` and `DRAG_THRESHOLD_TOUCH` are gone. One drag at a time; a second `start` returns false.
- **Active.** Past the threshold the ghost (the source by default) goes to the `drag` layer with `pointerEvents: 'none'`, and follows the pointer through its transform's translation: the pointer's travel since the press, taken into the ghost's parent space and added to the ghost's own translate. Translate is the outermost part of the transform, so a rotated or scaled card moves without turning, and layout never sees the move. Everything is put back when the drag ends, before `drop` fires.
- **Targeting.** Every move hit-tests with the ghost excluded. A change of target fires `dragleave` on the old one and `dragenter` on the new, then `dragover`, all bubbling, as HTML's drag events do. Each dispatch frame also re-targets under a still pointer (enter and leave only), so a target that moves or unmounts under the ghost is noticed without a move.
- **Accept.** `event.accept()` during `dragenter` or `dragover` names `currentTarget` as the acceptor, innermost first. Acceptance belongs to the target it was given for: kept while the pointer stays on that target, collected afresh on each enter. The acceptor's `dropActive` is set (`Component.dropActive`, `onDropActiveChange`); `drag.canDrop` is the source side. An ancestor can accept for its children (the enemy for its portrait), and moving between them keeps `dropActive` without a flicker.
- **End.** A release over an acceptor fires `drop` at the component under the pointer, bubbling up to the acceptor, then `dragend { dropped: true, dropTarget }` on the source. Any other release fires `dragleave` there and `dragend { dropped: false }` (HTML's order). `pointercancel`, window blur, pause, `releasePointer`, and unmount of the source or ghost end with `dragend { dropped: false }`; unmount delivers `pointercancel` first. `drag.cancel()` does the same for game code (Escape, a right-click chord) and spends the press, so the release that follows cannot click.
- **Click.** A release that ends an active drag is never a click. A press that started no drag, or whose drag never passed its threshold, clicks as before. This replaces `Component.dragSource`: the drag service now decides what the flag used to, per gesture instead of per component, and the flag is deleted.
- **Tooltips (R9.12e).** `drag.isDragging` and `drag.onDraggingChange(listener)`, which returns its unsubscribe. The tooltip service (DDB-78) reads these; the drag service knows nothing about tooltips. `drag.current` gives `{ source, data, target, acceptor }` while active.
- **Component callbacks.** `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`, `onDragEnd`, run by `handleEvent` like the pointer callbacks. `UiDragEvent` carries `source`, `data`, `screen`, `local`, `pointerId`, `pointerType`, and on `dragend` `dropped` and `dropTarget`.

## Options considered

- Keep `dragSource` as a declared flag and have `start` set it: rejected. A flag that must be true before a press, for a drag that may or may not start, is two sources of truth; the dispatcher only needs to know whether this release ended a drag.
- Move the ghost by reparenting it into an overlay root: rejected for now. Promotion to the `drag` layer already escapes the hand's clip (R4.8) and keeps the ghost's coordinates, so there is nothing to translate back on a cancel. A caller that wants a separate ghost passes one.
- Acceptance only through `dragover` on every move (HTML's `preventDefault`): rejected as ceremony. Accepting once on enter is what the game's targets want; `dragover` can still accept when acceptance depends on where in the target the pointer is.
- A per-pointer map of drags for multi-touch: deferred. One drag at a time is what the game and the tooltip suppression need.

## Spec departures

- `start` takes the `pointerdown` event as well as R9.12a's `{ source, data, ghost, threshold }`: the pointer, its type and the press position come from it.
- R9.12c's "source's `canDrop`" is `context.drag.canDrop` rather than a flag on the source component; R11.11 lists no `canDrop` state.

## Consequences

- No gameplay or pixel change: nothing in the game starts a drag yet. DDB-88 makes hand cards drag sources, with the enemies accepting.
- The DDB-75 departure (the threshold cancels clicks only on drag sources) stands, restated: only on a press that started a drag.
- `MountContext` gains `drag`.
