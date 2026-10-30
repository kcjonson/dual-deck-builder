# Screen transitions and root-stack screens (DDB-90)

## Context

Phase 6 of the [implementation plan](../specs/ui-rendering-engine-implementation.md) moves the main menu, splash, and battle result onto root stacks with centred titles, and routes navigation through R12.38's `ScreenTransition`, which DDB-87 built but nothing used. Before this, each of the three screens placed its parts by hand from the root's size in `onMount` and `onResized`, the splash ran its own fade out, and `ScreenManager.navigate` swapped screens on the spot.

## Decisions

**Every navigation fades by default.** `ScreenManager` owns one `ScreenTransition` and `navigate(name, data)` runs the swap through it: fade to `bg_void` over `dur`, unmount, close popups and overlays, mount, one layout, fade in, input blocked throughout (R8.22). The alternative was a second method (`transitionTo`) for the three screens' hand-offs only, leaving `navigate` immediate. That would have meant editing call sites in combat and driver selection while other work is in flight there, mocks in their tests that only know `navigate`, and a game where some screen changes fade and others cut. R8.22 describes the scene manager doing this for every scene change, so the default follows the spec.

`navigate(name, data, { immediate: true })` swaps at once and ends any transition under way (closing its overlay settles its promise and drops its pending swap). The boot into the splash uses it, since there is nothing to fade from and the splash fades itself in, and so does the dev `__app.navigate` hook: a capture navigates while paused, when no tween ticks, so the screenshot goldens are unaffected by the transition.

The document key listener in `Game` (F12 and the global Escape) is outside the dispatcher, so the transition's modal root does not block it. It now returns early while `ScreenManager.transitioning`, except for F5, which only toggles the diagnostic overlay.

**Back can return focus to the opener (DDB-232).** `navigate` notes the id of whatever has focus on the screen it leaves, keyed by screen name, but only on the first navigate away: under a transition or inside a swap the focused component is the transition's empty scope, not the player's choice. `navigate(name, data, { restoreFocus: true })` looks that id up in the new mount after `onMount` and focuses it, which under a transition becomes the focus manager's held request, so it wins over the screen's own first focus once the scope pops. Settings and Credits go back this way, so the menu comes back on the button that opened them. The other options were navigation data (the menu passing its button's id to Settings and Settings handing it back), which threads the menu's ids through screens that shouldn't know them, and a back stack, which the game's forward loop (menu, selection, combat, result, menu) would grow without bound. An id that's gone or can't take focus does nothing, and the screen keeps its default.

**A screen can bring its own root.** `Screen` takes `{ root }`. A root stack with `fill` on both axes is sized from the viewport by the frame (R8.21) and re-laid out by `viewportChanged`, so `Screen.mount` and `Screen.resize` skip their `setSize` for it; a positive `setSize` would have turned its `fill` axes into `fixed`. Screens without a root keep the plain container they had.

**The three screens build in `onMount` and clear in `onUnmount`**, per the repo's screen guidelines, so a remount (the splash test does one) never doubles the tree.

## Consequences

- Leaving a screen is no longer synchronous. Code that navigated and then expected the new screen in the same call (the combat teardown test) settles the animator first. The old screen stays mounted under the fade out, but the transition's quad takes every press and its focus scope keeps keys from it.
- Focus that the incoming screen asks for on mount is held by the focus manager and handed over when the transition's scope pops (R9.20), so focus lands on the primary action once the fade in ends.
- Under reduced motion the animator completes each tween on its first tick, so a transition takes two frames.
- The splash's own fade out is gone; the leave is the transition's 200 ms fade. Its 1 s fade in and 2 s hold are unchanged.
- Double navigations coalesce: a second `navigate` during the fade out replaces the pending swap, and the transition's modal root keeps a second key press from reaching the screen beneath.
