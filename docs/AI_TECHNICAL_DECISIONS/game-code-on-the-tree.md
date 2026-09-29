# Game code on the tree

DDB-79, DDB-55 phase 3. Closes DDB-41 (splash fade).

## Context

Phases 1 to 3 built the component base, the mount context, the dispatcher, and the animator, and moved most game input to `handleEvent`. What was left in game code was the old shape: screens sized their UI from `window.innerWidth` in constructors, `Screen` built a window-sized root so they could, driver selection tore down and rebuilt its whole screen on every resize (and lost its panels' state doing it), `Vehicle` rebuilt every child on resize and on a driver's death, a handful of sites reached into `children[n]`, the combat log and vehicles subscribed to models in constructors, and `Card` shadowed the base's `enabled` and lifted itself by moving its own `y` with a `y % 10` test to tell whether it was lifted.

## Decisions

**Screens build in the constructor and place in `onMount` and `onResized`.** The root starts zero-sized and `Screen.mount` sizes it from `context.viewport` before `onMount` runs, so every screen has one `placeElements` (or equivalent) that reads `rootLayer.width` and `height` and is called from both hooks. Nothing in `src/renderer/game` reads the window's size. Building in `onMount` instead was considered; it makes a remount of the same instance duplicate its UI unless every screen guards it, and the driver selection tests remount one instance. Construction that needs no size is fine under R8.14, which forbids registration in the constructor, not construction. `DeveloperScreen` still builds its sections in `onMount` (once, guarded), because a section takes its width at build time; each is measured detached, as the gallery does, before it is added.

**Composites place their parts in `layoutChildren`.** `DriverPanel`, `SynergyPreviewPanel`, `Vehicle` and `CombatLogLayer` create their parts once and place them from their own size in the frame's layout phase, which runs whenever they are resized (R8.18). A resize moves things; it never rebuilds. `Vehicle` creates its driver row and SPENT chip for every plate and shows or hides them from the data, so a driver dying mid-fight is a visibility change, not a rebuild.

**`Card` and `Vehicle` extend `Component` directly**, with component types `Card` and `Vehicle` in the snapshot. Neither used anything of `Layer` (a passthrough container with a background fill). `Card`'s state is the base's flags: `enabled` is the base's, and `onStateChange` draws hover, selection and disabled. The lift is a transform (`translate: [0, -5]`, R8.26), so layout never sees it and hit testing follows it. The old `y % 10` test meant a hand card placed at y 25 was pushed to 30 by its first visual update and rested there; the hand now places cards at 30 on purpose, one lift below the seat labels, which is also what keeps a lifted card clear of them. No pixel moves.

**`setOverflow('hidden')` is a mode.** It used to refuse, with a warning, on a zero-sized box, which forced components to set it only once they had a size (three combat layers carry that workaround). A screen that sizes its panels on mount needs to say "this clips" at construction. `clipsChildren` already answers false while the box is zero-sized, so the refusal protected nothing.

**The splash fades through its root's opacity with the animator.** The fade-in is a tween owned by the root, started in `onMount`; the hold is timed in `onUpdate` against `context.clock`; the fade-out is a second tween whose completion navigates. The hold is deliberately not a chained tween: `Animator.settle` runs chains to their end, so a chain would carry the screenshot harness's settle all the way to the main menu. As it is, a paused page settles the fade-in to opacity 1 and the splash golden is unchanged.

**The starting deck preview is built once per selection.** Driver selection used to load drivers from both its constructor and `onMount`, and the preview cleared its container before awaiting the card data, so the first mount's overlapping loads left the left panel's deck drawn three times over (visible in the old text golden as three copies of every mini card). The load is `onMount`'s alone, the preview clears after the await, and a build that awaited gives way to any build that started since.

## Consequences

- Only the driver selection text record moved: it loses the left deck preview's duplicate entries, and unnamed mini cards are addressed as `Card[n]` rather than `Layer[n]`. No PNG golden changed; the triple overdraw sat inside the pixel budget.
- `ArmorBadge.minWidth` is settable, so a plate's badge follows the plate's width.
- The remaining `onResized` overrides in combat layers work as before; moving them to `layoutChildren` is phase 4's Stack work.
