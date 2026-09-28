# Focus manager

Date: 2026-09-28. Task: DDB-76 (DDB-55 phase 3). Spec: 9.6 and 9.7 of `docs/ui-rendering-spec/09-input-and-focus.md` (R9.15 to R9.29), R11.11 and R11.12's focus ring, R12.7.

## Context

DDB-75 left focus as a seam inside the dispatcher: one `focused` pointer, `focus(component)` firing blur then focus, and a press outside the focused component clearing it. Nothing but `Input` ever took focus, there was no Tab order, keys went to one scene-wide hotkey table, and the combat screen registered Escape there because nothing in combat could be focused. Keyboard-only play was impossible.

## Decision

`input/FocusManager.ts` is the focus service, one per mount context. The dispatcher constructs it (so a bare `Dispatcher` in a test has one) and `createMountContext` exposes it as `context.focus`; the frame calls its `fixup` after every layout through a new `UiFrame.afterLayout` hook.

- **Order from the tree, cached.** Nothing registers. A walk of the active scope (or of every root, in mount order, when none is pushed) collects Tab stops: focusables with `tabIndex > 0` ascending, then the rest in depth-first insertion order; `tabIndex < 0` is focusable by press and code but never a stop. The walk is cached per scope and dropped whenever a mounted tree gains, loses, or reorders a child, or a `focusable`, `tabIndex` or `focusGroup` changes. Visibility and enablement are not part of the cache; `canReceiveFocus()` (focusable, mounted, effectively visible and enabled) filters every move.
- **Scopes.** `pushScope(root)` / `popScope(root)` is the public API DDB-78's overlays use for modal trapping. Push focuses the scope's first focusable (or clears focus when it has none, so keys cannot reach what the modal covers); pop restores what was focused at push if it can still take focus. A scope root that unmounts pops itself.
- **Fixup.** Unmount drops focus without callbacks (R9.21). At the end of every layout, a focused component that can no longer take focus is blurred with its callback, and when a scope is active focus moves to its first focusable (R9.28). `setEnabled(false)` no longer blurs directly; the fixup does it.
- **Groups.** `focusGroup: true | { orientation, wrap }` makes a container one Tab stop. Its members are focusable descendants not inside a nested group; Tab enters at `activeChild` (the last member focused) or the first; arrows along the orientation, Home and End move within it, skipping members that cannot take focus.
- **Directional.** `focusDirection` scores candidates beyond the focused component's centre by distance along plus twice the distance across, less the cross-axis overlap; `focusUp`, `focusDown`, `focusLeft`, `focusRight` override. With nothing focused it lands on the first focusable.
- **Focus-visible.** One modality flag: a press clears it, Tab, arrows, and `activate` set it, programmatic focus keeps it. `Component.focusVisible` is `focused` under a visible modality. `renderTree` draws the ring after a component's children when `focusVisible && effectivelyEnabled`: a `focus_ring_width` accent border, `outside`, `focus_ring_offset` out from the content box, radius `radius_ui + offset`, transparent fill. Mouse and no-input goldens never show it. A component whose resolved look draws its own ring from `focusVisible` (DDB-84's Button and Input, the phase 5 catalog) answers `drawsOwnFocusRing` true and the walk leaves it alone, so the walk's ring is the fallback for focusables without state layers (cards, vehicles). The focus manager owns focus and the flag; the widget owns the drawing.
- **Keys.** The dispatcher, per keydown: Tab moves focus unless the focused component sets `handlesTab`; the focused component and its ancestors; a text field (`acceptsText`) keeps printable and caret keys whether it consumed them or not; Enter or Space (first press only) becomes `activate` and Escape `cancel` at the focused component, bubbling; arrows, Home and End go to the focused group, then directional focus; then the hotkey tables. Button and the hand's cards treat `activate` as a click; Vehicle treats it as the target choice.
- **Scoped hotkeys.** Every component has a lazily created `hotkeys` table, meaningful on roots. The search is the focused component's root, then every other root from the topmost down, stopping at the topmost root with `modal = true` (whose own table is searched), then the dispatcher's scene table when no modal root is mounted. `claimsKey` answers from the same search.
- **Events.** `focus` and `blur` (`UiFocusEvent`, not bubbling, with `relatedTarget` and `focusVisible`) and `activate` and `cancel` (`UiActionEvent`) go through `handleEvent`, with `onFocus` and `onBlur` callback properties (R8.2). The old protected `onFocus()`/`onBlur()` hooks and `setFocused` are gone. `onClick` is typed for a pointer click or an `activate`. `UiPointerEvent.preventFocus()` keeps a press from moving focus. `dispatcher.inputMode` is `pointer`, `keyboard`, or `controller` from the last input.

## Game

Buttons are focusable by default. The hand is a horizontal focus group of focusable cards. A vehicle is focusable only while it is a target choice, so Tab and the arrows visit exactly the targets; focusing one previews it as hover does. When a keyboard player picks a card that needs a target, focus moves to the first target; after the play, or Escape, focus returns to the hand at the same slot, or to END TURN when nothing is playable. Combat's Escape and F6 moved to the screen root's table; driver selection's Escape goes back to the menu.

## Options considered

- **A registry of focusables maintained on mount and unmount**, as worldsim had: rejected by R9.18, and the ordering bug it produced is the reason the rule exists.
- **The ring drawn by each component.** Only Button would have drawn it, and Card and Vehicle are Layers with their own visuals. Drawing it in the render walk gives every focusable the ring with no per-component code; DDB-84's state layers can move it into component style later.
- **Focus-visible for any keydown** (the browser heuristic): R9.23 names Tab, arrows, directional focus, and `activate`, which is what is implemented.
- **Keep `Dispatcher.focus()` as a forwarding method.** Deleted instead; the two call sites and the tests use `context.focus`.

## Departures

- R9.15 says a text field consumes every keydown except Tab, Escape, and modifier chords. Here it keeps printable keys and the caret and editing keys; named keys such as F6 still reach the hotkey tables, which is what an existing test and the combat log toggle rely on, and matches how browsers treat function keys.
- R9.28's fixup also runs after the dispatcher's on-demand layout before a hit test, not only at the frame's layout. It is idempotent and cheap, and blur handlers that run there see the same state they would a moment later.
- `focusable` has a backing property now but stays out of the tree snapshot until DDB-80: reporting it wakes the dormant `unreachable-interactive` and `target-size` lint rules. `state.focusVisible` is reported.
