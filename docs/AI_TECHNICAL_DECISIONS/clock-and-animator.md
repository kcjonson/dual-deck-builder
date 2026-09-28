# Clock and animator

Status: implemented (DDB-74), 2026-09-28
Spec: R8.28, R8.15, R8.27, R11.13, R13.37 of the [UI rendering spec](../ui-rendering-spec/08-object-model.md)
Builds on: [mount-context-and-frame-order.md](./mount-context-and-frame-order.md)

## Problem

UI code had no time source of its own. The one timed behaviour, `PlayerHandLayer.animateCardToDiscard`, was a `setTimeout` of 300 ms with no caller, and the input caret blinks off the `dt` it is handed. A platform timer runs whether the page is paused or not, cannot be driven by a test, and was the first thing the screenshot harness's notes said would need Playwright's Clock API, which collides with the frame timer's `performance` use. R8.28 asks for one `clock` and one `animator` in the mount context, tweens that retarget without snapping, reduced motion, and cancellation on unmount; R11.13's style transitions, the dialog, meter, toast and hover lifts are all meant to be built on it.

## Decision

**`Clock` (`engine/animation/Clock.ts`) reads no platform time.** It has `now`, `dt` and `frame`, and moves only when `advance(ms)` is called. `frozen` makes an advance count the frame and move no time. `UiFrame.update(dt)` advances it by the frame's clamped delta, so every shell that already runs the update phase drives it and a paused shell (which skips `update`) stops it. `createMountContext` takes an optional `clock`, which `createTestContext` passes through, so a test can hold, freeze and read the same clock the tree sees.

Milliseconds, because the motion tokens are milliseconds and so is `performance.now`. `Component.update(dt)` keeps R8.17's seconds; converting in one place (`UiFrame.update`) beat changing a signature every component overrides.

**`Animator` (`engine/animation/Animator.ts`) interpolates numbers and number arrays.** `tween({ from, to, duration, ease, onUpdate, onComplete, owner })` returns a handle with `value`, `running`, `done`, `cancel()` and `retarget(to, options?)`. Duration defaults to `motion.dur` and ease to `motion.ease_standard`; an ease is a token's control points (solved as CSS's `cubic-bezier`, one curve built per token array) or a function. `onUpdate` fires with `from` when the tween starts, so an entrance never shows a frame of the value it is leaving, then on every tick, and with `to` before `onComplete`. Arrays are handed out fresh each call, because a colour setter may keep the array it is given.

- **Order.** `UiFrame.update` ticks the animator after the clock and before component updates; tweens tick in creation order, and one started during a tick first moves on the next, so every tween's first step is one frame long whether it began in an input handler or in an `update`.
- **Reduced motion.** Every tween completes on its first tick, including one already in flight when the setting turns on. `followReducedMotion` (`engine/rendering/reducedMotion.ts`) is the platform half: both pages point the animator at `prefers-reduced-motion` and follow changes. Electron answers the same media query from the OS.
- **Retargeting.** `retarget(to)` starts from the current value. Heading back to where the run started is CSS Transitions' reversal: the new run's duration is scaled by the reversing shortening factor, which compounds across repeated reversals, so a hover in and out takes as long as the way back and never snaps or dawdles. Any other target restarts the full duration. A finished handle restarts on `retarget`, which is how a component keeps one handle per property.
- **Owners.** The base component's `unmount` calls `animator.cancelOwnedBy(this)` for every component in the subtree (R8.15). A tween whose owner is not mounted when it is created never starts, since nothing would ever cancel it.
- **`done` settles, never rejects**, on completion or cancel. That makes it the value `reconcileChildren`'s `remove` returns for an exit animation (R8.27): the child stays drawn until its tween ends, and a cancelled exit (the list's parent unmounting) still detaches instead of waiting forever.

**No platform timers in UI code, by lint.** `.eslintrc.js` forbids `setTimeout`, `setInterval`, `requestAnimationFrame` and their cancels, bare or on `window`, under `engine/components`, `engine/ui`, `engine/animation`, `game/ui`, `game/screens`, `game/core` and `src/gallery`, tests excepted. The frame loop and profiling code in `engine/rendering` and `engine/debug` are the platform side and stay outside it. `animateCardToDiscard` and the empty `fanCards` stub are deleted rather than ported: neither had a caller, and the phase 6 hand builds discard flights and the fan on the animator and `reconcileChildren`.

**The screenshot harness settles animations instead of photographing their first frame.** Pausing already stops the clock. `window.__app.settleAnimations()` (both pages) runs every tween, and any its completions start, to its end, and returns how many it finished; `settle` in `tests/visual/support/harness.ts` calls it on each pass and restarts the two-frame hold whenever it finished something. `Animator.settle` throws after 64 rounds of a chain that keeps starting tweens, since no golden can hold one. This is R13.37's time freeze plus a settle, not R14.5's fixed-step clock: a fixed step would make a capture depend on how many frames ran before it, where the settled end state does not.

## Consequences

- No tween exists in the game yet, so no pixel moved: all nineteen chromium captures compared at zero differing pixels against local captures of `main`.
- A looping animation (a pulse, a spinner) cannot be settled and will fail the harness when it arrives. It needs a phase the clock decides, captured frozen, which is a harness change for whoever adds the first one.
- `Input`'s caret blink still counts its own `dt`, which is frame time and pauses correctly; moving it onto the clock is part of rebuilding `Input` as R12.10's TextInput.
