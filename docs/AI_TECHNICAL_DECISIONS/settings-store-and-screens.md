# Settings store, Settings and Credits screens (DDB-38)

## Context

The main menu's Settings and Credits buttons logged "not implemented". The implementation plan asks for both as the first screens authored on the new catalog. There was no settings store of any kind: nothing in the game read or wrote local storage, and the only player-facing preference with a working effect was reduced motion, which `followReducedMotion` pinned to the system's `prefers-reduced-motion` with no way to override it. There is no audio, so no volume. UI scale (R7.5) has the viewport arithmetic but is fixed at construction in `CanvasViewport` and `PointerAdapter`, and the plan lists the setting as deferred in phase 7.

## Decisions

**Settings offers only reduced motion.** A control with no effect is worse than no control, so the screen has one panel, Motion, with a segmented control: System (follow the device), Reduced, Full. A change applies on the spot, so the fade back to the menu already obeys it. Volume, UI scale, and anything else join when the game has something for them to change.

**A minimal store, `game/core/GameSettings.ts`.** One JSON record under `dual-deckbuilder.settings` in local storage, which both builds have (Electron keeps it for its `file://` page). Loading validates each value and falls back to its default, so a corrupt or stale record never throws; a storage that throws on read or write (private browsing, quota) leaves the settings working for the session. `GameSettings.shared` is the game's instance, following the `CardLoader` singleton the screens already use, since `ScreenManager` constructs screens with no arguments; `SettingsScreen` takes `{ settings }` for tests. Listeners hear every change.

**Reduced motion becomes a class with an override.** `ReducedMotion` (`engine/rendering/reducedMotion.ts`) replaces `followReducedMotion`: it still follows the system preference, and `override` (true, false, or null for the system) wins over it. The engine knows nothing of the game's settings; `Game` takes the `ReducedMotion` the page built and maps the motion setting onto `override` at startup and on every change. The gallery builds one and never overrides it.

**Credits come from the repository only.** `screens/credits/credits.ts` lists the licence from `LICENSE`, the commit authors from the git history, and each bundled typeface and the icon set with the copyright line and licence their own files carry. `credits.test.ts` fails when a directory under `src/assets/fonts/` has no entry, and checks each entry's copyright holder and licence against its file, so the list cannot drift from what ships.

**Both screens follow DDB-90's pattern.** A fill root `Stack`, built in `onMount` and cleared in `onUnmount`, navigation through `ScreenManager.navigate` (so through the transition), focus on the primary control (the selected motion segment; Back on credits, the only control), and Escape registered on the root (R9.15), which keeps `Game`'s document listener out of the way. The credits panel fills what the title and Back leave and holds a `ScrollContainer`, so a short viewport scrolls the list instead of pushing Back off screen. Page Up, Page Down, Home, and End are root hotkeys that scroll the list from Back; a press on the list focuses it for the arrows too.

## Consequences

- The plan's "dialog, checkbox, slider, select" for this task shrinks to Panel, SegmentedControl, Button, and ScrollContainer, because the settings that would have used a slider or select do not exist yet. A Select fits once a setting has more options than fit in a row.
- Both screens join the layout lint gate and get goldens. The settings golden shows System selected, the default for an empty storage.
- Settings persist per origin: the web build's playtest deploys on different paths of one domain share a record.
