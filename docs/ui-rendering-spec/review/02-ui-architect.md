# R2. UI architect review: object model, input, focus, layout, style, catalog, snapshot

Reviewer role: UI framework architect. Scope: chapters 8, 9, 10, 11, 12, the snapshot and lint sections of 13, with chapters 3 and 4 as ordering context. Read against worldsim's component system (research note B) and the deck builder's current engine (research note D), and against the W3C UI Events and Pointer Events specs, the HTML focus and dialog rules, the ARIA APG, PixiJS v8's event system, CSS flexbox, and Flutter/Unity UI Toolkit where they settle a question.

Severity: blocker = an implementation built to the text as written will be wrong or unusable for the deck builder; major = a contract that is missing, ambiguous, or hostile enough that the two implementations will diverge or authors will fight it; minor = worth fixing in the same pass; nit = wording.

Findings are numbered U1 to U30. Each carries the rule it targets, the claim the spec makes, the problem, and replacement text. The worked authoring example (question 8) is section B; what should not change is section C.

---

## A. Findings

### U1. The definite-axis rule freezes hug containers after their first layout

- severity: blocker
- location: 10.2 R10.5, 10.3 R10.11, 10.7 R10.18
- claim: "An axis is definite once a size has been established for it, either by construction (`size > 0`) or by any layout resolution, including a resolution to zero. On a definite axis a container reports its stored size; on a never-resolved axis it measures its children (hug)." And R10.11: "a child that is a stack container also receives its final rectangle through `layout(bounds)` and lays out its own children."
- problem: Put the two rules together. A hug column nested in a parent stack is measured in pass 0, then in pass 3 the parent calls `layout({x, y, child.width, child.height})` on it, which "establishes a size for the axis by layout resolution". From that frame on the axis is definite, so the container "reports its stored size" and never measures its children again. R10.18's upward invalidation then does nothing useful: the parent re-runs, asks the nested container for its size, and gets the frozen number. This is not hypothetical; it is worldsim's own recorded open defect ("nested `layout()` freezes a Hug container at its last measured size; a consumer resets hug axes on content change as a workaround", research note B, section 9 item 13). The spec copied the definite-axis rule (a good rule, it exists so a fill container squeezed to zero does not report its hug size) and the `layout(bounds)` rule verbatim, without noticing that together they reintroduce the bug the chapter claims to have fixed. The conformance suite would pass (it tests single layouts), and the first screen with a label that changes length inside a hug panel would freeze.
- proposed change: separate *sizing mode* (an author intent, `fixed | hug | fill`, never changed by layout) from *resolved size* (per-pass scratch state). Replace R10.5 with:

  > R10.5 Sizing mode is authored and is never changed by layout. A stack container tracks, per axis and per layout pass, whether a size has been *resolved for this pass*. A `fill` or stretched axis is resolved when the parent assigns it (including an assignment of zero, which is a valid resolved size). A `hug` axis is resolved by measuring children during the pass in which it is asked. `layout(bounds)` assigns the resolved rectangle for the current pass; it MUST NOT convert a `hug` or `fill` axis into `fixed`, and a container whose axis is `hug` MUST re-measure that axis on every pass in which it or a descendant is dirty. A container constructed with `size > 0` on an axis is `fixed` on that axis; constructed with 0 it is `hug`; either may be changed by setting `widthMode`/`heightMode`.

  Add to 10.9: "a nested hug container whose child text grows after the first layout grows on the next layout (regression for the freeze)".

### U2. Layer promotion changes what `position` means, and popups cannot be placed without the screen coordinates R8.13 forbids

- severity: blocker
- location: 3.3 R3.8, 3.9 worked examples, 8.3 R8.13, 8.2 R8.9, 12.8 R12.30
- claim: R3.8: promotion "resets the inherited clip and the inherited content offset, so a promoted subtree positions itself in screen space". R8.13: "components MUST NOT read the window size or compute absolute positions themselves." R3.9: a hovered card "sets `layer: raised`"; the select's menu "emits ... rows at screen coordinates computed from the trigger's screen bounds."
- problem: three contradictions. (1) If setting `layer` moves a subtree's origin to screen space, then the R3.9 hand-of-cards example is wrong: the hovered card that sets `layer: 'raised'` keeps its hand-local `position` and now renders at that offset from the screen origin, i.e. it jumps to the top-left corner of the screen. If instead promotion keeps the accumulated origin and only drops the scroll offset, a menu declared inside a scrolled list is placed at the trigger's unscrolled position. The text does not say which accumulation is reset ("content offset" is defined in chapter 0 as the scroll translation only), so the two implementations will pick differently. (2) A promoted popup must be clamped to the viewport by the placement service, which takes an `anchorRect` in screen space (R12.30), but R8.13 forbids the component from computing its own screen position, and nothing in chapter 8 exposes one. (3) R4.7 requires clip rects to be transformed through the current transform, so a promoted subtree that "resets the clip" but keeps positioning itself locally is fine only if the transform is preserved; R3.8 does not say whether the transform stack is reset.

  CSS makes the same choice explicit: `position: fixed` and the top layer are viewport-relative; a plain `z-index` promotion keeps the element in flow. Here `layer` is used for both the "raised card in place" case and the "menu escaping a scroll clip" case, so it cannot be viewport-relative without breaking the first.
- proposed change: promotion resets only the clip; coordinates are always local, and the framework exposes read-only screen geometry:

  > R3.8 (replace) Layer promotion resets the inherited clip stack to `none` (chapter 4, R4.8). It does not reset the coordinate origin, the content offset, the transform, opacity, or `visible`: a promoted component is positioned by its `position` in its parent's content box exactly as an unpromoted one, so a hovered card raised to `raised` stays where the hand laid it out, and a menu that is a child of its trigger follows the trigger when the trigger scrolls. A promoted subtree that must stay inside the viewport (menu, tooltip, context menu, drag ghost) uses the placement service against `screenBounds` and converts the result back with `screenToLocal`.

  > R8.13 (replace) Every mounted component exposes read-only `screenBounds` (its content box in viewport logical pixels, computed by the framework during layout from ancestor origins, content offsets, and transforms) and `localToScreen(point)` / `screenToLocal(point)`. These are valid after the frame's layout. Components MUST NOT read the window or canvas size and MUST NOT accumulate ancestor positions themselves; they read `screenBounds` or the viewport from the mount context.

  Update the R3.9 select example to "rows positioned in trigger-local coordinates from `placement.place(trigger.screenBounds, ...)` converted with `screenToLocal`".

### U3. Callback timing is contradictory: "after dispatch has finished" vs consume-in-callback, re-entrancy, and open-on-press

- severity: blocker
- location: 8.7 R8.25, 9.3 R9.11, 12.4 R12.15, 12.3 R12.10
- claim: R8.25: "Callbacks fire after the state change they describe is complete and after the frame's dispatch has finished with the event."
- problem: if callbacks are deferred until dispatch has finished, then: a component's `onClick` cannot call `event.consume()` (the event is gone), a Slider's `onChange` cannot be re-entrant with `setValue` inside dispatch (R12.15 describes exactly that re-entrancy), a Dialog opened from an `onClick` opens after the frame's dispatch, so the R9.11 "a pointerdown that opens a popup MUST arrange for the following pointerup not to activate" rule cannot use capture on the opening press (the popup does not exist yet during the press), and a text field's `validator` (R12.10) cannot reject a character, since rejection must happen before the state change. Worldsim's callbacks are synchronous and every ported behaviour test assumes it. Deferral also makes ordering across components observable-but-unspecified (in which order do two deferred callbacks run?).
- proposed change:

  > R8.25 (replace) Callbacks are properties (`onClick`, `onChange`, `onFocus`, ...). A callback fires synchronously, inside dispatch, immediately after the component has completed the state change the callback describes (the value is already updated when `onChange` runs; the popup is already closed when `onSelect` runs). A callback MAY mutate the tree, set properties on its own component (re-entrancy: the component MUST accept a property set from inside its own callback and MUST NOT fire the callback again for it, the Slider rule of R12.15 generalised), open popups, or move focus; it MUST NOT call `dispatch` recursively. Events passed to callbacks carry `consume()`, and a callback that consumes stops the bubble.

### U4. The hit-test target model is undefined for containers, composite internals, and click, so a Button with a label child does not work

- severity: blocker
- location: 9.2 R9.4, R9.5, 9.1 R9.1 (click), 9.2 R9.8 (`hovered`), 8.2 R8.8
- claim: R9.4: the hit walk "finds the topmost visible component containing the point ... A container with no visual of its own is transparent to hits outside its children. The result is the event's `target`." R9.1: click is "down and up on the same target, or on the capturing target". R9.8: "The framework maintains `hovered` on components."
- problem: take the simplest widget, a Button built from a background Rectangle, a Text, and an Icon (R8.8 allows either child shapes or direct draws). The pointer over the label makes the *Text* the target. Then: (a) is the Button `hovered`? R9.8 does not say hover applies to ancestors, so a strict reading gives `hovered` to the Text only and the button loses its hover wash while the pointer is over its own label. CSS `:hover` matches ancestors for this reason. (b) `pointerdown` on the label, `pointerup` on the icon: two different targets, so no `click` is synthesised unless the button captured. The UI Events spec solved this: click fires on the nearest common inclusive ancestor of the down and up targets (w3c.github.io/uievents, mouse events; Chromium and Firefox both implement it). Any custom composite that does not capture (a Card, a ListRow that a game author writes) silently fails to click. (c) "A container with no visual of its own is transparent to hits outside its children" is derived from a visual property; a Panel with a transparent background, a Stack with padding, a Dialog's panel body: hit or not? If the dialog's body is transparent to hits, a press on padding between two buttons in a modal reaches the scrim and closes the dialog (R12.21 + R9.7). (d) A drag ghost in the `drag` layer, a targeting scrim, a damage number: the only way in the spec to keep them out of hit testing is R9.12's special-case "with the dragged item excluded".

  Every surveyed system makes hit-testability an explicit per-node property, not a derived one: CSS `pointer-events: none`, PixiJS `eventMode` (`none | passive | auto | static | dynamic`, default `passive` = children only), Unity UI Toolkit `pickingMode: Position | Ignore`, Flutter `IgnorePointer`/`AbsorbPointer`.
- proposed change: add a base property and three rules.

  > R8.2 (add) `pointerEvents`: `auto` (the component's own content box is a hit target and children are hit-tested; default for leaves and widgets), `passthrough` (own box is transparent, children are hit-tested; default for `Container` and `Stack`), `unit` (own box is the target and the walk does not descend: composite widgets whose internals are implementation detail, default for Button, Select, Slider, TabBar, ListRow, Checkbox, Toast; the widget MAY still route internally), `none` (neither self nor children: drag ghosts, scrims that must not block, decorative overlays). `opacity: 0` behaves as `none` (R3.27).

  > R9.4 (append) The walk descends into a component's children when the point is inside the component's clip (R4.12) and `pointerEvents` is not `none` or `unit`; it reports the component itself as `target` when `pointerEvents` is `auto` or `unit` and `containsPoint` holds. `containsPoint` decides self-hit only; it never gates descent.

  > R9.8 (append) `hovered` is true on the target and on every ancestor of the target (containment semantics, as CSS `:hover`). `pointerleave` is delivered innermost first, then `pointerenter` outermost first, for the components whose containment changed. The tooltip service uses the innermost hovered component with a `tooltip`.

  > R9.1 (replace click) `click` is synthesised on `pointerup` and targeted at the nearest common inclusive ancestor of the `pointerdown` target and the `pointerup` target (UI Events), or at the capturing component when one captured; it bubbles from there. No click is synthesised when the pointer moved more than the drag threshold (U5), when the press was cancelled (U6), or for non-primary buttons (a secondary-button release synthesises `contextmenu` instead).

### U5. Drag-and-drop has no protocol; under capture a drop target cannot highlight

- severity: blocker
- location: 9.3 R9.10, R9.12, 12.9
- claim: R9.12: "the dragged item promotes itself to the `drag` layer, follows the pointer with an offset, and on release the framework hit-tests the drop point with the dragged item excluded to find the drop target." 12.9: cards and hands are "built from the catalog ... by the game"; the library owes "pointer capture".
- problem: this is the deck builder's core interaction and the spec gives it one sentence. Under capture, every pointer event goes to the captor and `pointerleave` is suppressed (R9.10), and per the Pointer Events spec boundary events during capture fire only for the capture target, so the enemy vehicle under the dragged card receives no `pointerenter` and cannot highlight as a valid target. The card would have to hit-test the tree itself on every move, but no hit-test API is exposed (R9.4 describes an internal walk). "Excluded" also has no general mechanism (U4 gives it one). Nothing defines a drag threshold, so a press that wobbles two pixels is either a click or a drag depending on the implementation; the design document's click-and-confirm accessibility mode needs both on the same card. Prior art all converges on synthesised drag events: HTML DnD (`dragenter/dragover/dragleave/drop`), Unity UI Toolkit (`DragEnterEvent`, `DragUpdatedEvent`, `DragLeaveEvent`, `DragPerformEvent`), Flutter (`Draggable`/`DragTarget` with `onWillAcceptWithDetails`, `onAcceptWithDetails`, `onLeave`).
- proposed change: replace R9.12 with a drag service in the mount context.

  > R9.12 (replace) Drag and drop is a dispatcher service. `dispatcher.hitTest(screenPoint, { exclude?: Component[] })` is public and returns the topmost hit under the U4 rules. A component starts a drag from a captured `pointerdown` by calling `context.drag.start({ source, data, ghost?, threshold? })`. The drag becomes active once the pointer has moved `threshold` logical pixels (default token `drag_threshold`, 4 for mouse and pen, 10 for touch); until then the gesture is still a candidate click. When active: the ghost (default: the source itself) is promoted to `drag` with `pointerEvents: none` and follows the pointer with the press offset; on every move the dispatcher hit-tests with the ghost excluded and synthesises `dragenter`, `dragover` (each move), and `dragleave` on the component under the pointer, bubbling, carrying `data`; a component accepts by calling `event.accept()` during `dragenter` or `dragover`, which sets its `dropActive` flag (a visual state, chapter 11) and the source's `canDrop`. On release over an accepting target the dispatcher fires `drop` on the target then `dragend` on the source with `{ dropped: true, target }`; otherwise `dragend` with `{ dropped: false }` and the source animates home if it chooses. `pointercancel`, loss of capture, or unmount of the source ends the drag with `dragend { dropped: false }`. Tooltips are suppressed while a drag is active.

  Add `dropActive` to R11.11's state set and a `dragThreshold` token to R11.3.

### U6. The input model is silently mouse-only; touch, pen, and cancellation are absent

- severity: major
- location: 9.1 R9.1, R9.2, 9.3 R9.10, 12.6 R12.22, 13.7 R13.35
- claim: events carry "button and buttons mask, modifiers, wheel deltas ... timestamp"; the set is `pointerdown/up/move/enter/leave/wheel/click`.
- problem: no `pointerId`, `pointerType`, `isPrimary`, `pressure`; no `pointercancel` (a browser cancels a pointer when the page scrolls, on touch palm rejection, on window blur; a pressed Button whose pointer is cancelled must reset, a drag must abort); no implicit capture for touch (Pointer Events: touch implicitly captures on `pointerdown` and releases on up or cancel, and hover-only affordances never fire). The design document (Game Flow and UI Specification 8.3) requires touch-drag of cards and pinch on the Steam Deck; the tooltip's 500 ms hover delay, `pointerenter`-driven card previews, and hover lift never happen on touch. Multi-button chords are undefined: a right press during a left drag produces, per W3C, a `pointermove` with `button` set and the `buttons` mask changed, not a second `pointerdown`; the spec's polled rule ("one down and one up per button per frame") implies per-button downs. The injection grammar has no pointer id or type.
- proposed change:

  > R9.1 (append) Every pointer event carries `pointerId`, `pointerType` (`mouse | touch | pen | virtual`), `isPrimary`, and `pressure`. Add `pointercancel` (the platform or the framework abandoned the gesture: the target and any captor MUST reset pressed and drag state without firing `click`, `onChange`, or `drop`) and `contextmenu` (secondary-button release or a 500 ms touch hold under the drag threshold). Only the primary pointer synthesises `click` and drives hover; non-primary pointers deliver down, move, up, and cancel for multi-touch consumers. `pointerdown` and `pointerup` are fired for the first button pressed and the last released on a pointer; chorded buttons arrive as `pointermove` with `button` set and `buttons` updated (Pointer Events Level 3).

  > R9.10 (append) Capture is per `pointerId`. A `touch` pointer is implicitly captured by the `pointerdown` target until `pointerup` or `pointercancel`. Hover-only behaviours (`pointerenter` without a press, tooltip delay, hover visual state) apply only to pointer types that can hover; for touch, a 500 ms hold under the drag threshold fires `contextmenu`, which the tooltip service and card previews MAY use.

  > R13.35 (amend) injection grammar gains `[,pointerId,pointerType]` on pointer verbs and `cancel,pointerId`.

### U7. Controller and spatial focus navigation are absent although the game targets them

- severity: major
- location: 9.6 R9.18 to R9.24, 1.6 non-goals
- claim: focus moves by Tab and Shift+Tab; components handle arrows internally.
- problem: Game Flow and UI Specification 8.2 requires D-pad/stick navigation between UI elements with highlighting, a free cursor on the right stick, and confirm/cancel face buttons. The focus model has the pieces (focus, `focusVisible`, activation keys) but no directional navigation and no abstract actions, so every screen would hand-roll it. Unity's automatic navigation, Android's D-pad focus search, and the CSS spatial navigation draft all do the same thing: from the focused element's rectangle, pick the nearest focusable in the pressed direction by a distance-plus-overlap metric, within the current focus scope. A stick-driven cursor is a `virtual` pointer (U6) producing ordinary pointer events. Chapter 1 lists accessibility tree export as a non-goal; it does not list controllers, and the object model needs the hooks now (focus rectangles, an `activate()` entry point) even if the input adapter comes later.
- proposed change:

  > R9.26 (new) The focus manager provides `focusDirection(dir)` for `up | down | left | right`: from the focused component's `screenBounds` (or the scope's first focusable when nothing is focused) select the candidate in the active scope whose bounds lie in the half-plane of `dir`, minimising `distanceAlongDir + 2 * distanceAcrossDir` with a bonus for overlap on the cross axis; components MAY override with explicit neighbours (`focusUp`, `focusDown`, ...). Directional focus sets `focusVisible`. Arrow keys route to the focused component first (R9.24) and fall back to `focusDirection` when unconsumed.

  > R9.27 (new) Input actions `activate` and `cancel` are abstract events synthesised from Enter/Space and Escape, from controller confirm/cancel buttons, and from the injection API; components handle `activate` instead of checking key names. A platform shell that has a controller drives a `virtual` pointer for free-cursor mode and directional focus for navigation mode; the mode is a context setting (`inputMode`) that components MAY read to change affordances (show hints, hide hover-only UI).

### U8. Tab order from registration order is not tree order

- severity: major
- location: 9.6 R9.18, R9.20
- claim: "auto-assigned indices in registration order, which for a mounted tree equals tree order."
- problem: false as soon as anything is built out of order. `insertChild(0, x)` after mount registers x last; a dialog whose footer is built before its body tabs footer first; re-parenting unregisters and re-registers at the end; a lazily built section lands after everything. Worldsim got away with it because its scenes are built once, statically. R9.20's "refreshed if the subtree changes while open" is a symptom of the same design: with a registry there is nothing to derive the order from except registration time. HTML derives sequential focus order from the tree ("sequential focus navigation order": positive `tabindex` ascending, then tree order), never from insertion time.
- proposed change:

  > R9.18 (replace the ordering sentence) Tab order is derived from the tree, not from registration: within the active scope root, focusables with `tabIndex > 0` come first in ascending `tabIndex` (ties in tree order), then every other focusable in depth-first tree order (children in insertion order, not `zIndex` order). The order is computed lazily and cached until the tree, a `tabIndex`, or a `focusable` flag changes. Registration on mount exists only so the manager knows the set and can clear focus on unmount (R9.21).

  > R9.20 (simplify) A focus scope is a subtree root. Pushing a scope makes that root the active scope root; the order is derived from its subtree on demand, so no refresh step exists.

### U9. Focus rules missing: focus on pointerdown for non-focusables, focused element becoming unfocusable, modality for programmatic focus, and composite (roving) groups

- severity: major
- location: 9.6 R9.19, R9.22, R9.23, 12.2 R12.8, 12.4 R12.12
- claim: R9.23: "Clicking a focusable focuses it"; `focusVisible` is set on keyboard moves and cleared on pointer moves.
- problem, four parts. (1) A pointerdown on a non-focusable target: does focus clear (DOM: yes, focus goes to the body) or stay? Either answer breaks something unless the rule is "nearest focusable ancestor": with "clear", pressing on an open Select's menu (menu items are not focusable) blurs the Select, which R12.12 says closes on focus loss, before the `pointerup` can pick, so no Select ever works by mouse. With "stay", clicking the battlefield leaves a text field focused and eating keys. (2) The focused component becomes invisible, disabled, or `opacity 0` (a button hidden after the phase changes): the spec only covers unmount (R9.21). HTML's "focus fixup rule" moves focus to the body; inside a modal scope focus must land on the scope's first focusable or Tab dies. (3) Programmatic `focus()` (dialog open focuses its first control) after a mouse click: is the ring drawn? The HTML heuristic keeps the current modality (the ring is not drawn after a pointer interaction; text fields always show focus). (4) ARIA composites (listbox, radiogroup, tablist, toolbar, menu) are one Tab stop with arrows inside (roving tabindex). The spec has this for TabBar and Slider but a list of ListRows is either not keyboard-reachable (worldsim: ListRow is not focusable) or one Tab stop per row. The deck list, the settings list, and "Tab cycles through valid targets" in the design doc need a group primitive.
- proposed change:

  > R9.23 (replace) A `pointerdown` focuses the nearest focusable inclusive ancestor of the target (so a press inside a Select's menu keeps the Select focused); if there is none, focus is cleared, unless the press was consumed by a component that sets `event.preventFocus()` (scrollbars, drag handles). Focus moved by a pointer clears `focusVisible`; focus moved by Tab, arrows, directional navigation, or `activate` sets it; programmatic `focus()` keeps the current modality, except that text-entry components always draw their caret and focus border.

  > R9.28 (new) At the end of each frame's layout the focus manager checks `canReceiveFocus()` on the focused component; if it no longer holds, focus is cleared with `focusLost` and, when a scope is active, moved to the scope's first focusable.

  > R9.29 (new) A container with `focusGroup: true` is a single Tab stop: Tab enters it at its last active child (or first), arrows and Home/End move `activeChild` within it (`orientation: horizontal | vertical | both`, wrap optional), `activate` fires the active child's activation, and Tab leaves it. List, RadioGroup, TabBar, Menu, and Toolbar are focus groups. Children of a focus group are not in the sequential Tab order.

### U10. Input timing: events arrive between frames against stale or absent layout

- severity: major
- location: 8.4 R8.16, 9.1 R9.2
- claim: R8.16: "Input for a frame uses the previous frame's layout; render never runs layout implicitly." R9.2: events "are delivered as they arrive from the platform when the platform is event-driven (browsers)".
- problem: in a browser, events arrive between animation frames, so they are dispatched against whatever layout last ran, which is fine until state changes without a layout in between: a keydown opens a modal dialog (mounted, not yet laid out, bounds zero), the next pointerdown arrives before the frame and passes through the non-existent scrim to the button beneath. Same for the first frame (input before any layout), a resize (one frame of stale hit rectangles), and any callback that mutates the tree and then the same burst of events continues. "Delivered as they arrive" also makes injection non-deterministic relative to `update` and breaks R3.4-style determinism in tests. Flutter and Unity both dispatch pointer events on the frame with layout current.
- proposed change:

  > R9.2 (replace) Platform events are queued as they arrive and dispatched at the start of the next frame, in arrival order, with coalescing of consecutive `pointermove` events per pointer (the last position wins; intermediate positions are available on the event for gesture consumers). Before the first hit test of a frame, and after any dispatch that dirtied layout, the dispatcher MUST run layout for dirty subtrees (`layoutIfDirty()`, free when clean) so hit testing always sees current geometry. Consequently R8.16 becomes: input (with layout on demand), update, layout, render, snapshot; render never runs layout. In the polled case at most one down and one up per button per frame are generated.

### U11. The visual-state precedence makes states exclusive when the design language composes them, and hides the focus ring under hover

- severity: major
- location: 11.3 R11.11, R11.12
- claim: "Precedence, highest first: `disabled`, `pressed`, `selected`, `hover`, `focusVisible`, `normal`; `open` and `active` combine with the others."
- problem: a single winning state cannot express what R11.12 itself specifies: hover is "a white 4.5% wash" (an overlay), pressed is "nudge 1 px" (a transform) plus a fill, selected is "accent wash with bright text" (a base), focus is "a 1 px outline" (a decoration). With precedence, a selected row under the pointer shows no hover response, a pressed selected tab loses its selected look, and a keyboard-focused button that the mouse rests on loses its focus ring (`hover` beats `focusVisible`), which is exactly what keyboard users must never experience. CSS composes (`.selected:hover`, `:focus-visible` is independent). The state table `variant x state -> {fill, border, text, glow, offset}` also cannot be reused across components with an exclusive state.
- proposed change:

  > R11.11 (replace) Every interactive component carries a set of boolean state flags maintained by the framework: `hovered`, `pressed`, `focused`, `focusVisible`, `enabled`, plus the component's own `selected`, `open`, `active`, `dropActive`. Style resolution layers them in a fixed order over the variant's base look: base (`selected` ? selected base : normal base) -> hover wash (when `hovered && enabled && !pressed`) -> pressed treatment (fill and the 1 px offset, when `pressed && enabled`) -> `open`/`active`/`dropActive` accents -> disabled treatment (replaces text colour, removes glow and washes, when `!enabled`) -> focus ring (drawn whenever `focusVisible && enabled`, independent of the others). `visualState` in the snapshot is this set, not one name.

  Keep R11.12's values; restate them as the layers above.

### U12. Style objects and variant tables are two systems with no defined merge

- severity: major
- location: 8.7 R8.24, 11.4 R11.14, R11.15, 11.3 R11.12
- claim: R11.15: "Per-instance style overrides layer on top of the variant table for that instance; there is no cascade." R11.14: "A style property that is accepted MUST be rendered."
- problem: "layer on top" of a table keyed by state does not say what `style: { backgroundColor: 'red' }` on a Button does in the `hover` and `pressed` rows. CSS inline style beats the hover rule, so the button turns red and stays red on hover and press, which is the bug the sibling engine's `setFillColor` reverting on hover was a symptom of, from the other side. The accepted property set is also open-ended ("CSS names in camelCase"): the sibling engine's `Style` type has `transform`, `filter`, `cursor`, `whiteSpace`, `display`; R11.14 would force an implementation to render `filter`. Two implementations will accept different sets.
- proposed change:

  > R11.14 (replace) The style object accepts exactly this closed set, each with a defined meaning on every component that accepts it: `backgroundColor`, `color`, `borderColor`, `borderWidth`, `borderRadius`, `opacity`, `fontSize`, `fontRole` (`display | body | mono`), `fontWeight`, `letterSpacing`, `textTransform`, `textAlign`, `padding` (number or per side), `shadow` (elevation token or `{color, blur, spread, offset}`), `cursor`. Any other key is a development-build error. Values are numbers in logical pixels, colour strings, or token references. A component that accepts a property MUST render it; a component that does not accept one MUST reject it at construction, never ignore it.

  > R11.15 (replace) Resolution order for any drawn value: variant base from tokens -> per-instance style object (replaces the base for the `normal` and `selected` bases) -> state layers of R11.11, which are defined as overlays relative to the base (a wash with alpha, an offset, a ring), so an override keeps hover, pressed, focus, and disabled feedback -> transitions. Per-state overrides are written `style: { hover: { ... }, pressed: { ... } }` and replace that state's overlay only. There is no inheritance between components except the propagated properties of chapter 8.

### U13. Components have no transform, so a fanned hand, a rotated drag ghost, and a scaled hover lift cannot be expressed in the tree

- severity: major
- location: 8.1 R8.1, 8.3 R8.10, 2.2 R2.4, 4.2 R4.7, 12.9
- claim: the draw API has `pushTransform(matrix)`; the object model has `position`, `size`, `margin` only.
- problem: every card game fans its hand by rotating cards around a pivot below the hand and scales the hovered card; the deck builder's design does too. A Card composite could push its own transform in `render()`, but then (a) the framework's hit walk computes "local position (filled in as the event descends)" without the inverse transform, so the card's children are hit in the wrong place and `containsPoint` on an axis-aligned box is wrong; (b) `screenBounds` (U2) and the lint see the untransformed box; (c) R4.7 already anticipates rotated clips. PixiJS, Flutter (`Transform`), Unity (`RectTransform` rotation/scale, style `rotate`/`scale`/`transform-origin`), and CSS all put the transform on the node and keep layout untransformed.
- proposed change:

  > R8.26 (new) Every component has `transform`: `{ rotate?: radians, scale?: number | [sx, sy], translate?: [dx, dy], origin?: [ox, oy] }` (origin as fractions of the content box, default centre), identity by default. Layout ignores it (CSS `transform` semantics: the layout box is untransformed). Render pushes it after the parent's origin and content offset; the hit walk applies the inverse to the point before `containsPoint` and before descending; `screenBounds` reports the axis-aligned bounds of the transformed box and `screenQuad` the four corners. Clips under a rotated transform follow R4.7. The layout lint uses the untransformed box and the snapshot emits `transform` when non-identity. Setting `transform` invalidates the render order only, never layout.

### U14. No keyed reconciliation and no state-preserving move: a hand rebuilt every turn unmounts every card

- severity: major
- location: 8.2 R8.5, R8.7, 12.9
- claim: R8.5 gives `addChild`, `insertChild`, `removeChild`, `clearChildren`; re-parenting "removes it from the old parent first", which unmounts (R8.7).
- problem: the deck builder's hand changes every turn and on every draw and discard; `PlayerHandLayer.setHand` today rebuilds every Card (note D, section 8). Under this spec the rebuild unmounts each card: hover, pressed, transition state (U11), tooltip timers, and focus are lost mid-animation, and a card that is animating to the discard pile is destroyed. Reordering a card (drag within the hand) by remove-then-insert also unmounts it and, by R9.21, clears focus. The DOM got `moveBefore()` in 2025 for exactly this ("state-preserving atomic move"); React, Flutter, and ImGui solve the first half with keys.
- proposed change:

  > R8.5 (append) `moveChild(child, index)` and `insertChild(index, child)` of a child that is already mounted under the same root MUST move it without unmounting: no `unmount`/`mount`, focus and hover kept, transitions continue. Only removal from the tree or a move across roots unmounts.

  > R8.27 (new) `Container.reconcileChildren(items, { key, create, update, remove? })` performs a keyed diff: existing children whose key is still present are kept (and `update(child, item)` is called), new keys are created and inserted, missing keys are removed (unmounted after an optional `remove(child)` returns, so an exit animation can run), and the final order matches `items` using state-preserving moves. Implementations MUST provide it; game code SHOULD use it for any list driven by model data (hand, log, shop).

### U15. `update` opt-in, the clock, and animation are underspecified; there is no tween primitive

- severity: major
- location: 8.4 R8.17, 8.4 R8.15 ("scheduler"), 1.4 R1.6 ("clock"), 11.3 R11.13, 12.7 R12.24
- claim: "`update(dt)` is opt-in per component"; the context carries a "scheduler" (R8.15) or a "clock" (R1.6); transitions "interpolate ... over the motion tokens"; the meter "fill animates over `dur_slow`".
- problem: the opt-in mechanism is not defined (a flag? overriding `update`? registering?), and a walk of the whole tree each frame to find opted-in components costs a full traversal for a static screen. The name of the service differs between chapters. Transitions are only defined for style states; there is no way for a component or a screen to tween a number (hover lift by 20 px, a card flying to the discard pile, a damage counter rolling, a dialog's entrance scale of R12.21, a screen fade) except by subscribing to `update` and writing easing by hand, which every screen will do differently. Every game UI toolkit ships a tween (Unity `DOTween`-style, Flutter `AnimationController`, PixiJS via Ticker plus a tween library, Godot `Tween`).
- proposed change:

  > R8.17 (replace) A component receives `update(dt)` on the next frame only after calling `this.requestUpdate()` (one-shot, like `requestAnimationFrame`); animations re-request each frame. The frame calls `update` on the requested set, skipping components that are unmounted or in an invisible subtree, before layout. `dt` is clamped (R13.9). Static screens therefore cost nothing in the update phase.

  > R8.28 (new) The mount context carries one `clock` (frame time, `dt`, `now`, injectable and freezable for tests, R13.37) and one `animator`. `animator.tween({ target?, from, to, duration, ease, onUpdate, onComplete })` returns a handle with `cancel()`; durations and eases default to the motion tokens; under reduced motion a tween completes on its first tick. Tweens tick in the update phase in creation order and are cancelled when their owning component unmounts. Style transitions (R11.13), the dialog entrance, the meter fill, and the toast lifecycle are implemented on this primitive. A tween that is retargeted mid-flight starts from its current interpolated value (CSS reversing semantics), so a quick hover in and out never snaps.

### U16. Layout algorithm gaps found by tracing the cases

- severity: major
- location: 10.1 R10.1, R10.3, R10.4, 10.3 R10.7 to R10.10, 10.4 R10.13, 10.5 R10.15, R10.16
- claim and trace, per case:
  1. Hug row with a fill child: pass 2 is skipped, the fill child keeps its intrinsic size. That matches CSS flex under max-content sizing and Figma, and is fine. But R10.9's pass 3 uses `contentMain`, which R10.8 defines only "when the main axis is definite"; on a hug axis `contentMain` must be the hug measurement (so `leftover` is 0). Unstated.
  2. Fill in a definite row has no minimum. Row 300 wide: `[Button fixed 200, Button fixed 200, Text fill]` gives `leftover = max(300 - 400, 0) = 0`, so the Text is assigned width 0, wraps every word onto its own line, and its hug height explodes. CSS flex items have `min-width: auto` (min-content) for exactly this, which is why "min-width: 0" is a famous fix in the other direction. A `fill` Text or Button squeezed to 0 is the common outcome in a dense HUD row, and R10.4 says min sizes are out of scope.
  3. Hug text in a non-stretch column never wraps. Column fixed 200 wide, `crossAlign: start`, child `Text { wrap: 'word' }` with hug width: pass 1 assigns a width only to fill or stretched children, so the text keeps its unwrapped width (say 600) and overflows. Yoga and CSS shrink-to-fit an auto-width item to the available space, so it wraps at 200. Authors will expect wrapping.
  4. Stretch cross axis with a fixed child: left alone at `start`, which is CSS behaviour for definite-size items. Fine, but without `alignSelf` the fixed child cannot be centred, and the R10.9 cross rules give `center` only per container. Note D's combat screen has both a full-height battlefield and a centred phase display in one row.
  5. Fill weights 25/40/35 in a 1000 px row with padding 10 and gap 10: `contentMain = 980`, `leftover = 960`, children 240/384/336, i.e. 24/38.4/33.6% of the row. R10.3 calls this "a 25/40/35 split of a screen"; it is a split of the leftover, and margins of fill children also come out of it (R10.8). Correct, but the phrase "percent" invites the wrong expectation and the exact-float rule means non-integer edges (R7.8 only snaps hairlines). `totalWeight = 0` (every fill weight 0) divides by zero; unstated.
  6. Anchors are named (R10.15 `anchor: 'topRight'`) and never defined; R10.16's absolute children are placed "by their own position" only, so a badge in a card's top-right corner or an end-turn button at the bottom-right of a band still needs the parent's size in game code (which R8.13 forbids reading directly).
  7. Overlap is a first-class need (fanned cards, avatar stacks) and `gap` is not said to allow negative values; the lint exempts overlapping siblings only when `zIndex` differs, which fanned cards do satisfy.
  8. "No negative offsets, degrade to start" (R10.10): this is CSS `safe center`; right for layout, since clipping is the container's separate property (chapter 4). It should say so, and say that overflow is visible unless the container clips.
- proposed change:

  > R10.8 (append) On a hug main axis `contentMain` is the hug measurement of R10.12 and `leftover` is 0. If `totalWeight` is 0, fill children receive 0.

  > R10.4 (replace) `minSize` and `maxSize` per axis are required, not optional, and clamp the resolved size after fill distribution and before positioning; the clamp re-runs distribution once with clamped children treated as fixed (the CSS flexbox "frozen items" step). A Text's default main-axis `minSize` is its longest unbreakable word (CSS `min-width: auto` semantics) unless `overflow` is `clip` or `ellipsis`, in which case it is 0. `aspectRatio` (width / height) resolves the unassigned axis from the assigned one. `alignSelf` overrides the container's `crossAlign` per child. Wrap and grid remain out of scope.

  > R10.7 (append) A hug child on the cross axis receives `availableCross = contentCross` as a measurement constraint, not an assignment: text and any component with a `measure(availableWidth, availableHeight)` hook resolves to `min(intrinsic, available)` and wraps or reflows accordingly (shrink-to-fit). `setLayoutSize` remains the assignment path for fill and stretch.

  > R10.15/R10.16 (replace) `positioned: 'absolute'` children are excluded from flow and placed by `anchor` (fractions `[ax, ay]` of the parent's content box, default `[0, 0]`), `pivot` (fractions of the child's own margin box, default equal to `anchor`), and `position` as an offset: `origin = parentContent.origin + anchor * parentContent.size - pivot * child.size + position`. Named anchors (`topLeft`, `topRight`, `center`, `bottomRight`, ...) are shorthands. This is the Unity RectTransform and Godot anchor model and covers badges, corner buttons, toast stacks, and centred dialogs. A screen's top-level regions are a full-viewport stack or anchored children; the root's size follows the viewport through the same path.

  > R10.2 (append) `gap` MAY be negative (overlap); the lint exempts siblings that overlap by at most the negative gap.

  > R10.10 (append) This is CSS `safe` alignment. Overflowing children are drawn unless the container clips (chapter 4); the lint reports them.

### U17. Layout bounds versus ink: focus rings and glows drawn outside `bounds` contradict R8.8 and get clipped; margins are uniform only

- severity: major
- location: 8.2 R8.8, 8.3 R8.10, R8.11, 11.3 R11.12, 12.5 R12.20, 8.2 R8.2 (`margin` is a number)
- claim: R8.8: a widget's "reported bounds cover everything they draw except promoted popups." R11.12: focus is "1 px accent outline, 2 px offset, `outside` border position." Elevation: raised surfaces have drop shadows, active elements a glow of 8 to 26 px blur.
- problem: a Button with `margin: 0` draws its focus ring 3 px outside its content box and its glow 8 px outside; R8.8 is violated by every interactive component in the catalog. Worse, a ScrollContainer clips to its own bounds, so a focused row's ring and a hovered button's glow are cut off at the scroll viewport edge, which is the classic CSS `overflow: hidden` complaint. Flutter distinguishes the layout size from paint bounds; CSS distinguishes the border box from ink overflow. The margin-box convention itself is fine (section C), but `margin` as a single number means a component cannot have an asymmetric margin, while padding is per side (R10.2).
- proposed change:

  > R8.8 (replace) A component's `bounds` cover its layout box. Drawing MAY extend past it for *ink overflow*: shadows, glows, focus rings, and the pressed 1 px nudge. Ink overflow does not affect layout, hit testing, or the lint, and it is clipped by any clipping ancestor like everything else; a component reports `inkExtent` (the maximum outset it may draw) so that ScrollContainer and Dialog SHOULD inset their clip by the largest `inkExtent` of a direct child when they have padding to spare, and so the snapshot can carry `inkBounds`.

  > R8.2 (amend) `margin` is per side (`{ top, right, bottom, left }`), with a number as the uniform shorthand. R8.11's reported width becomes `size.width + margin.left + margin.right`.

### U18. Dialog dismissal and root ownership: non-modal dialogs must not light-dismiss, and roots should not be hand-ordered

- severity: major
- location: 12.5 R12.21, 3.4 R3.15, 8.6 R8.21, 9.4 R9.13
- claim: R12.21: "a press outside the panel closes (modal and non-modal)". R3.15 and R8.21: the application supplies open dialogs as roots "in open order, latest last"; closed dialogs are not roots.
- problem: a non-modal dialog exists so the player can use the rest of the screen while it is open (a card inspector, a detached combat log); closing it on any outside press makes it a modal with a see-through scrim. HTML's `<dialog>` never light-dismisses a non-modal dialog and, since the 2025 `closedby` attribute, modal dialogs default to close-request (Escape) only, with `closedby="any"` as the opt-in. For a game, accidental dismissal of "Abandon run?" by a stray click is worse than an extra Escape. Separately, the dialog's four-state machine (`opening ... closing`) means it must be a root for the whole animation, so "closed dialogs are not roots" requires the scene to add the root on `open()` and remove it when `closing` finishes; nothing says who does that, and R3.15 makes the scene hand-order roots, which is the pattern R3.7 rejected for popups.
- proposed change:

  > R12.21 (amend) `dismissOnOutsidePress` (default `false`) closes the dialog on a press outside its panel; modal dialogs consume the press either way (R9.7), non-modal dialogs never consume it. Escape closes when `closeOnEscape` (default `true`) and the dialog is fully open. The X button always closes.

  > R8.21 (replace) A scene owns its main root and HUD roots. Overlay roots (dialogs, toast stacks, any component opened through `context.overlays.open(component, { layer })`) are owned by the overlay service in the mount context, which mounts them as roots after the scene's roots in open order, walks them for render, hit testing, snapshot, and lint, and removes them when the component reports `finished` (a dialog after its closing fade, a toast stack never). R3.15's "the application MUST supply modal dialogs in open order" is satisfied by the service; hand-ordering is no longer needed.

### U19. Popup dismissal details: trigger-to-trigger switching, secondary-button re-open, and tooltips during presses and drags

- severity: minor
- location: 9.4 R9.13, R9.14, 12.4 R12.14, 12.6 R12.22
- claim: menus and selects consume the outside press; tooltips never consume; tooltip state machine driven by enter and leave.
- problem: with the outside press consumed, switching from one open Select to another takes two clicks (the first only closes); native menu bars and every web select avoid that. A right-click elsewhere while a ContextMenu is open should close it and open a new one at the new point (Windows and macOS behaviour); consuming eats the second press. Under capture `pointerleave` is suppressed (R9.10), so the tooltip of a card being dragged stays `visible` for the whole drag, and a tooltip is not hidden when its owner is pressed.
- proposed change:

  > R9.13 (append) The outside press is not consumed when its target is a component flagged `popupTrigger` (a Select, DropdownButton, or a component whose `onPointerDown` opens a popup): the open popup closes and the press proceeds, so one press switches between triggers. A secondary-button press outside closes the popup and is never consumed.

  > R12.22 (append) The tooltip service hides on any `pointerdown` on its owner, stays hidden while a pointer is captured or a drag is active, shows on keyboard focus of the owner after the same delay (accessibility: tooltips must be reachable without a pointer), and MAY show on `contextmenu` for touch. `tooltip` accepts `TooltipContent | () => Component` so a card preview can be a full component in the `tooltip` layer; the service owns its lifetime.

### U20. Snapshot schema is too thin to verify a UI and its coordinate space is undefined; lint lacks the rules that catch the bugs on the board

- severity: major
- location: 13.4 R13.22, R13.23, 13.5 R13.25, R13.26, 8.3 R8.10
- claim: node schema `{ id, type, bounds, margin, zIndex, visible, enabled, text, children }`; prose says `hover` is included but the JSON does not show it; R8.10 says `bounds` is in the parent's content box; the R13.22 example shows a button at x 1204 that reads as screen coordinates; lint MUST rules are overlap, containment, viewport, zero size.
- problem: (1) local versus screen coordinates for `bounds` is unspecified, and the lint's `outside-viewport` and the screenshot cross-check (R13.34) only work with screen coordinates while `child-outside-parent` is naturally local; the two implementations will differ. (2) An agent verifying "the End Turn button is disabled, the tooltip is showing, the dialog is open and focused, the scroll list is at the bottom, this text was ellipsised" cannot: no `state` set, no `focused`, no `layer`, no effective `opacity`, no effective `clip` (R4.17 only SHOULD), no `contentOffset`, no `value` for inputs, sliders, selects, checkboxes, no measured text extent or `overflowed` flag, no computed fill and text colours. (3) The board's visible bugs (DDB-28 title overprint, DDB-30 overlap and off-centre title, DDB-29 hand overflow) are text overflow and clipped content; `text-overflow` is only SHOULD, and there is no rule for an interactive component that is entirely clipped (unreachable), for tap targets below the WCAG 2.5.8 24 px minimum (44 px on the Steam Deck), or for text contrast, which needs computed colours in the snapshot. (4) Interactive components without ids are addressable only as `Button[3]`, which changes whenever a sibling is inserted.
- proposed change:

  > R13.22 (replace) Node schema: `{ id, type, bounds, screenBounds, margin, zIndex, layer, visible, enabled, opacity, clip, contentOffset, transform, focusable, state, text, value, style, inkBounds, children }` where `bounds` is the margin box in the parent's content-box space (chapter 8) and `screenBounds` the content box in viewport space after offsets and transforms; `layer`, `opacity`, `clip` are the effective values; `state` is the R11.11 set as booleans (`hovered`, `pressed`, `focused`, `focusVisible`, `selected`, `open`, `active`, `dropActive`); `text` carries `{ content, measured: { w, h, lines }, overflow: none | clipped | ellipsis }`; `value` is the component's controlled value when it has one; `style` is the resolved `{ fill, text, border }` colours after state resolution; optional fields are omitted when not applicable, never emitted as zero.

  > R13.25 (append MUST rules) 5. `text-overflow` (promoted from SHOULD): a text's measured extent exceeds its box without wrap, clip, or ellipsis. 6. `unreachable-interactive`: a focusable or `pointerEvents: auto | unit` component whose `screenBounds` intersect no ancestor clip and are not covered entirely by a sibling above it in the same layer (a covered End Turn button is the DDB-31 class of bug). 7. `target-size`: an interactive component whose content box is under 24 x 24 logical pixels (configurable, 44 for touch profiles) and whose spacing offset does not compensate.
  > R13.26 (append SHOULD) `text-contrast` (resolved text over resolved fill under 4.5:1, 3:1 for 18 px and above), `missing-id` (an interactive or focusable component with `id: null`).

  > R8.4 (append) Ids SHOULD be unique within a root and SHOULD be set on every interactive component; the framework provides `root.findById(id)` and `component.parent`, `component.root`, `component.isMounted`, `component.context`.

### U21. Keyboard routing: hotkeys need scoping, text fields must own printable keys, and repeat needs a flag

- severity: major
- location: 9.5 R9.15, R9.16, R9.17, R9.24
- claim: keys go to the focused component, bubble to the root, then "a root-level hotkey table (function keys, Escape when nothing consumed it) is the last stop."
- problem: the combat screen registers Space for End Turn and 1 to 7 for cards (design doc 8.1). With one root-level table, Space still ends the turn while the battle-result dialog is open, and a `char` event 'e' typed into a name field also reaches a hotkey 'e' unless the field consumes every key, which the spec does not require (R9.17 lists what a field must support, not that it consumes what it does not use). Held Enter on a focused button fires `onClick` on every repeat (DOM fires click on repeated Enter but not Space; games generally want neither). The table's API and precedence (per root, per scene, per dialog) are not defined at all.
- proposed change:

  > R9.15 (replace) Keyboard events are delivered to the focused component, bubble through its ancestors to its root, then to that root's `hotkeys` table, then to each overlay root's table from topmost down until a modal root is reached (a modal root stops the search: hotkeys of roots beneath a modal never fire), and finally to the scene table. A component that accepts text (`TextInput`, a search field) consumes every `keydown` and `char` it receives while focused except Tab, Escape, and bound modifier chords, so printable hotkeys never fire from inside a field. `keydown` carries `repeat`; `activate` (U7) is synthesised on the first Enter or Space only, and buttons ignore repeats.

### U22. Wheel: "per notch token" contradicts normalised pixel deltas; no latching; no horizontal rule

- severity: minor
- location: 9.1 R9.3, 4.3 R4.13, 12.5 R12.20
- claim: R9.3 normalises deltas to logical pixels (a line is 16 px); R12.20 says the ScrollContainer "wheel scrolls a token number of pixels per notch"; R4.13: "Wheel input scrolls the innermost scrollable ancestor under the pointer that can still move in that direction, then bubbles."
- problem: trackpads deliver fractional pixel deltas dozens of times a second; quantising to "per notch" throws that away and makes trackpad scrolling jerky. Chaining to the parent the instant the inner list hits its end is the jump every browser eliminated with scroll latching (Chromium's wheel latching: a scroll sequence stays on the scroller that started it until a timeout without wheel events). Shift+wheel for horizontal and `deltaX` handling are unstated though the event carries both axes.
- proposed change:

  > R9.3 (replace) Wheel deltas are normalised to logical pixels per axis (pixel mode as is, line mode times 16, page mode times the scroller's viewport) and used directly as scroll distances; no per-notch constant exists. Shift with a vertical-only delta swaps the axes. R4.13/R12.20: the first wheel event of a sequence picks the innermost scroller under the pointer that can move in that direction; subsequent events within 150 ms of the last stay latched to it even at its end (no chaining mid-gesture); a scroller consumes events it is latched to, and passes the first event of a sequence it cannot move on.

### U23. Pointer capture details: captured target, loss of capture, hover after release, and cancellation

- severity: minor
- location: 9.3 R9.10, R9.11, 9.2 R9.9
- claim: "until `releasePointer()` or the matching `pointerup`, every pointer event is delivered to it first regardless of position, with `pointerleave` suppressed."
- problem: "delivered to it first" implies it then continues to whatever is under the pointer; the Pointer Events model targets captured events at the captor exclusively (they bubble from the captor, no hit test). What happens when the captor unmounts, becomes invisible, or the window loses focus mid-drag is unstated (a Slider stays "dragging" forever). After release outside, R9.9 re-evaluates hover, but the captor that suppressed `pointerleave` never receives one, so its `hovered` stays true. The W3C sequence is `lostpointercapture` followed by boundary events as if the pointer had moved.
- proposed change:

  > R9.10 (replace) `capturePointer(pointerId?)` from a `pointerdown` handler routes every event of that pointer to the capturing component as `target`, bubbling from it, with no hit test, until `releasePointer()`, the pointer's `pointerup`, or a `pointercancel`. Boundary events for that pointer are computed against the captor only (enter when inside, leave when outside). On release the dispatcher fires `lostpointercapture` on the captor and re-evaluates hover from the current position as R9.9, delivering `pointerleave` to the captor if the pointer is outside. Unmount, `visible: false`, or `enabled: false` of the captor, and window blur, release capture and deliver `pointercancel` to it first.

### U24. `opacity: 0` and invisibility need hit, occlusion, and focus semantics spelled out (chapter 3 consistency)

- severity: minor
- location: 3.7 R3.27, 8.1 R8.3, 9.2 R9.4
- claim: "`opacity: 0` MUST still lay out and MUST NOT receive pointer input; `visible: false` does neither."
- problem: "not receive" leaves open whether an opacity-0 component still occludes (a scrim fading in at opacity 0.01 receives input, at 0 lets clicks through beneath: the dialog is clickable through during the first frame of its entrance and never afterwards), whether it can hold focus (CSS: yes, and a Dialog's entrance fade starts at 0 while it takes focus), and whether hover enters it. Chapter 3 and chapter 9 do not cross-reference U4's `pointerEvents`.
- proposed change:

  > R3.27 (replace) `opacity: 0` lays out, is skipped by hit testing as if `pointerEvents: none` (neither target nor occluder), keeps focus and focusability, and is not `hovered`; `visible: false` is skipped by layout, render, hit testing, update, and focus (R9.28). A dialog whose scrim must block input from its first frame sets its scrim's `opacity` from 0.01 or uses `pointerEvents: auto` on an opaque-to-hits scrim rect drawn at the fade opacity; the spec recommends the latter: the scrim's hit-testability is independent of its alpha.

### U25. The base interface should carry generic event callbacks, `cursor`, and async texture semantics

- severity: minor
- location: 8.1 R8.1, 8.2 R8.2, 8.7 R8.25, 12.1 R12.5
- claim: components expose `handleEvent(event)`; callbacks are per-widget properties (`onClick`, `onChange`).
- problem: a game composite (Card, Vehicle, targeting reticle) that wants pointer events must subclass and override `handleEvent`; the R8.23 authoring style (named-argument construction) has no way to attach behaviour without a subclass. There is no `cursor` anywhere, though a web and Electron player expects a pointer over buttons and a grab hand during drags. `Image.texture` is "a handle" (R2.17) with no rule for a texture still loading (card art arrives asynchronously): draw nothing, a placeholder, and invalidate when ready?
- proposed change:

  > R8.2 (append) Base callbacks, all optional: `onPointerDown`, `onPointerUp`, `onPointerMove`, `onPointerEnter`, `onPointerLeave`, `onClick`, `onContextMenu`, `onWheel`, `onKeyDown`, `onKeyUp`, `onFocus`, `onBlur`, `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`. The base `handleEvent` invokes them before its own default handling; subclassing remains available. Base property `cursor` (`default | pointer | grab | grabbing | text | notAllowed | none`) is resolved from the innermost hovered component that sets one and applied by the platform shell; `Button` defaults to `pointer`, a drag source to `grab`, the drag ghost to `grabbing`.

  > R12.5 (append) `Image` with a texture that is not yet resident draws `placeholder` (a fill colour or nothing) and requests a re-render when the texture becomes resident; its layout size never depends on the texture (it is `size` or `aspectRatio`). Texture ownership is the asset cache in the mount context; components hold handles only (R1.2).

### U26. Invalidation contract: define relayout boundaries and what does not invalidate layout

- severity: minor
- location: 8.5 R8.18, 10.7 R10.18
- claim: a size-affecting change "marks the component dirty and propagates up through parents to the nearest flow container and beyond."
- problem: "and beyond" means to the root, so a caret blink that changes nothing still relayouts the screen if it is implemented as a text change, and a label update in the HUD relayouts the hand. Flutter stops propagation at a "relayout boundary" (a node whose size cannot change given its constraints); Yoga stops at nodes whose dimensions are fixed. `position` changes on absolutely positioned children, `zIndex`, `opacity`, `transform` (U13), `layer`, and hover states must be listed as *not* layout-invalidating, or an implementation will relayout on every hover.
- proposed change:

  > R8.18 (append) Propagation stops at the nearest ancestor whose sizing modes are both `fixed` (or which is a root with a viewport-derived size): that ancestor is the relayout boundary and layout runs from it downward. Changes to `position` of an absolutely positioned child, `zIndex`, `layer`, `opacity`, `transform`, `cursor`, interaction state, and style values that do not affect measurement (colours, shadows) MUST NOT invalidate layout; `zIndex` invalidates the render-order view only.

### U27. Catalog contracts that are wrong or too thin to test

- severity: minor
- location: 12.2 R12.9, 12.4 R12.11 to R12.17, 12.5 R12.20
- items:
  1. Checkbox/Toggle (R12.9): unspecified: does the label click toggle (yes; the whole row is the hit area), what `indeterminate` becomes on click (`checked`), the keyboard (Space toggles, Enter does not), the `onChange(checked, event)` signature, and that Toggle is a Checkbox with a different look and no indeterminate. Write the state machine like Button's.
  2. TabBar (R12.16): "A missing or disabled `selectedId` falls back to the first enabled tab" makes a controlled component pick its own value without telling the parent; either fire `onSelect(firstEnabled)` on mount and on prop change, or render with no selection. `onSelect` not firing for the current tab is correct.
  3. ContextMenu (R12.14): add "a secondary-button press outside closes the menu without consuming, so the scene can open a new one at the new point" (U19).
  4. ScrollContainer (R12.20): it handles Page Up/Down "when focused" but is not in the focusable list anywhere; make it `focusable: true, tabIndex: -1` (focusable by click and programmatic focus, not in Tab order, the browser convention for scrollable regions), and define `scrollIntoView(child, { block: nearest | center })`. Add: "the thumb press sets `preventFocus`" (U9).
  5. Menu (R12.11): long option lists need vertical scrolling and a max height from the placement result; state that a Menu whose height exceeds the placed rect scrolls internally.
  6. Slider (R12.15): the drag SHOULD use pointer capture through the framework (R9.10), not its own flag; "press elsewhere jumps then drags" is fine.
  7. TextInput (R12.10): "Escape clears selection" is non-standard; native fields ignore Escape or revert. Recommend Escape is left unconsumed so dialogs receive it (a name field in a dialog must not swallow the dialog's Escape).
  8. Toast (R12.23): "a click elsewhere fires `onClick` then dismisses" is fine; add `pause auto-dismiss while hovered` (every toast library does; a player reading a toast should not lose it).

### U28. Components the deck builder needs that the catalog lacks

- severity: major
- location: 12.9, 12.10
- claim: "Cards, vehicles, hand fans, and the like are built from the catalog and the draw API by the game."
- problem: the library owes more than image, text, and layers. Without the following, each screen re-invents them, which is the pattern note B's item 11 warns about ("when a widget is missing, the game code grows manual drawRect plus hit-test code").
- proposed change: add to 12.6 to 12.9 and the checklist:
  1. `Popover` (required): an anchored, interactive, non-modal floating surface (card inspector on right-click, a driver's stat breakdown), placed by the placement service against an anchor component or point, `overlay` or `popup` layer by option, closes on Escape and, optionally, outside press (not consumed), never steals focus unless it contains focusables. Tooltip is the non-interactive special case.
  2. `FocusGroup` / `List` (required): U9's roving container with `selected`/`activeChild`, `onSelect`, `onActivate`, orientation, type-ahead optional; `RadioGroup` is a FocusGroup of radio items with a single value and `onChange`.
  3. `NumberInput` / `Stepper` (recommended): value, min, max, step, arrow keys and buttons, wheel with focus.
  4. `Scrollbar` (recommended): standalone track and thumb bound to any `{ offset, extent, viewport }`, so horizontal scrolling and custom scroll views (a wide hand, a map) reuse one implementation; ScrollContainer composes it.
  5. `ScreenTransition` (required): a root-level overlay in a `transition` layer above `drag` (add to R3.5) that fades between screens with a single full-viewport quad whose alpha is tweened (U15), so a crossfade never depends on the optional group opacity of R3.26; defines the order: fade out, unmount outgoing roots (R8.22), mount incoming, layout once, fade in; input is blocked while active.
  6. `Counter` (recommended): a `Text` whose displayed number tweens toward `value` over `dur_slow` with a formatter; the health and resource numbers of the HUD.
  7. `Sprite`/`Image` frames: covered by `sourceRect`; add `SpriteSheet` metadata (`frames` by name) to the asset cache, not to the component.
  8. `DragSource` and `DropTarget` are not components: they are the U5 protocol, available on every component through `context.drag` and the `onDrag*` callbacks.

### U29. Frame loop and roots: first-frame layout, viewport-sized roots, and `Screen` mount order

- severity: minor
- location: 8.4 R8.15, R8.16, 8.6 R8.21, R8.22, 10.5 R10.15
- claim: mount is top-down; frame order is input, update, layout, render; screens are full-viewport stacks.
- problem: nothing says how a root gets its size. R10.15 says a screen "SHOULD express its top-level regions as a full-viewport stack (bands with fill weights)" but a stack fills its *parent*, and roots have none; the sibling engine's root "sized from the window rather than from the viewport it was mounted in" is called out as an anti-pattern (R8.13) without the replacement rule. `mount` runs before the first layout, so a component that reads `bounds` or `screenBounds` in `mount` sees zeros; the spec should say when geometry first becomes valid and offer a hook (`onLayout`/`onResized`, which the sibling engine relies on in 19 places).
- proposed change:

  > R8.21 (append) A root's layout box is the viewport rectangle supplied by the mount context (logical size after `uiScale`); a root stack with `fill` on both axes therefore fills the viewport and a viewport change re-lays out every root through R10.18 with no screen code involved. Geometry is invalid until the first layout after mount; components that need their size use the `onLayout(bounds)` callback (fired after each layout in which their bounds changed), never `mount`.

### U30. Token and naming nits

- severity: nit
- location: 11.1 R11.3, 11.3 R11.12, 8.1 R8.1, 8.7 R8.23, 1.4 R1.6
- items:
  1. The focus ring (1 px, 2 px offset, accent), control heights (26/34/46), icon sizes (12/16/24), the drag threshold, the tooltip delay (500 ms), and the hover-move tolerance (4 px) are prose numbers; make them tokens (`focus_ring_width`, `focus_ring_offset`, `control_h_sm|md|lg`, `icon_sm|md|lg`, `drag_threshold`, `tooltip_delay`) so both implementations read the same file, as R11.2 intends.
  2. R8.1 lists `position` setter and `setLayoutSize(w, h)`; R8.23 says accessors, not `get`/`set` pairs. Settle on `position` (accessor), `size` (accessor, meaningful for `fixed`), `bounds` (read-only), and `measure(availableW, availableH)` plus `assignSize(w, h)` as the layout protocol.
  3. R1.6 says `clock`, R8.15 says `scheduler`; U15 names both.
  4. R3.5's ladder needs `transition` above `drag` (U28) and the glossary should list `ink overflow`, `pointerEvents`, `focus group`, `relayout boundary`.
  5. `char` events: name the field `codePoint`, say it is a Unicode scalar value, and that a keydown for a printable key precedes its `char` in the same frame.

---

## B. Worked authoring example: the combat screen under this spec

What a screen author writes for the deck builder's combat screen, using only what the draft defines, with each place the spec makes it awkward or ambiguous marked `[n]` and mapped to a finding. TypeScript, named-argument constructors, accessors, tabs elided for readability.

```ts
class CombatScreen extends Screen {
	onMount(ctx: MountContext) {
		// Bands. R10.15 says "full-viewport stack (bands with fill weights)".
		const root = new Stack({ id: 'combat', direction: 'vertical', widthMode: 'fill', heightMode: 'fill' });
		// [1] Nothing defines what a root fills; a stack fills its parent and a root has none (U29).

		const resources = new Stack({ id: 'resources', direction: 'horizontal', widthMode: 'fill',
			heightMode: 'fill', fillWeight: 7, padding: tokens.space.space_2, crossAlign: 'center',
			distribution: 'spaceBetween' });
		const middle = new Stack({ id: 'middle', direction: 'horizontal', widthMode: 'fill', heightMode: 'fill', fillWeight: 63 });
		const arena = new Stack({ id: 'arena', direction: 'vertical', widthMode: 'fill', heightMode: 'fill' });
		const enemies = new Container({ id: 'enemies', widthMode: 'fill', heightMode: 'fill', fillWeight: 23 });
		const battlefield = new Container({ id: 'battlefield', widthMode: 'fill', heightMode: 'fill', fillWeight: 40 });
		const log = new ScrollContainer({ id: 'log', size: { width: 240, height: 0 }, heightMode: 'fill' });
		// [2] 7/23/40/18 "percent" weights are shares of leftover after padding and gaps, not of the viewport (U16.5).
		const hand = new Hand({ id: 'hand', widthMode: 'fill', heightMode: 'fill', fillWeight: 18 });
		// [3] The hand must be a Container with hand-positioned cards: Stack has no negative gap and no transform,
		//     so a fan (overlap plus rotation) cannot be a Stack (U13, U16.7).

		arena.addChild(enemies); arena.addChild(battlefield);
		middle.addChild(arena); middle.addChild(log);
		root.addChild(resources); root.addChild(middle); root.addChild(hand);
		this.roots = [root];

		// End turn button, right end of the resource bar (spaceBetween puts it there; an anchored
		// bottom-right placement is not possible because anchors are undefined, U16.6).
		const endTurn = new Button({ id: 'end_turn', label: 'End turn', variant: 'primary', size: 'lg',
			tooltip: { title: 'End turn', hotkey: 'Space' }, onClick: () => this.game.endTurn() });
		resources.addChild(new Text({ id: 'turn', text: 'Turn 1' }));
		resources.addChild(endTurn);

		// Hotkeys from the design doc: Space ends the turn, 1-7 select cards, Escape cancels targeting.
		root.hotkeys = { Space: () => this.game.endTurn(), Escape: () => this.cancelTargeting() /* , '1'..'7' */ };
		// [4] No hotkey API is defined, and a root table keeps firing while the result dialog is open (U21).

		// Toasts and the result dialog are roots the scene must order by hand (R3.15, R8.21).
		this.toasts = new ToastStack({ id: 'toasts', anchor: 'topRight', spacing: 8 });
		this.roots.push(this.toasts);
		// [5] Who adds the Dialog root on open() and removes it after its closing fade is unspecified (U18).
		this.result = new Dialog({ id: 'result', title: 'Victory', modal: true, footer: [ /* buttons */ ] });

		this.game.on('hand', cards => hand.cards = cards);
	}
}

class Hand extends Container {
	set cards(cards: CardModel[]) {
		// [6] No keyed reconcile: either clearChildren() (unmounts every card, kills hover/transition state,
		//     destroys a card mid-animation) or a hand-written diff by id (U14).
		this.clearChildren();
		cards.forEach((c, i) => {
			const view = new CardView({ id: `card:${c.id}`, model: c, zIndex: i });
			// [7] Fan positions computed from this.bounds; the hand cannot rotate cards (U13) and reads its own size
			//     only through `bounds`, which is stale until the next layout (U29).
			view.position = { x: fanX(i, cards.length, this.bounds.width), y: 25 };
			this.addChild(view);
		});
	}
}

class CardView extends Container {
	constructor(args: { id: string; model: CardModel; zIndex: number }) {
		super({ id: args.id, size: { width: 150, height: 210 }, zIndex: args.zIndex,
			tooltip: { title: args.model.name, description: args.model.text } });
		// [8] tooltip is text-only; the design wants a full-size card preview (U19).
		const body = new Stack({ direction: 'vertical', widthMode: 'fill', heightMode: 'fill', padding: 8, gap: 4 });
		body.addChild(new Image({ texture: ctx.assets.texture(args.model.art), widthMode: 'fill', size: { width: 0, height: 90 }, fit: 'cover' }));
		// [9] Texture loads asynchronously; what draws meanwhile and who re-renders is unspecified (U25).
		body.addChild(new Text({ text: args.model.name, font: 'display', wrap: 'none', overflow: 'ellipsis', widthMode: 'fill' }));
		body.addChild(new Text({ text: args.model.text, wrap: 'word', widthMode: 'fill', heightMode: 'fill' }));
		// [10] With a fill width the description wraps; a hug width in a start-aligned column would not (U16.3).
		this.addChild(body);
		this.addChild(new Badge({ label: `${args.model.cost}`, positioned: 'absolute', position: { x: 4, y: 4 } }));
		// [11] Top-right placement needs anchors (U16.6).
	}

	handleEvent(e: UIEvent) {
		// [12] No onPointerDown-style callbacks on the base; subclass and override (U25).
		switch (e.type) {
			case 'pointerenter':
				// [13] Does the card count as hovered when the pointer is over its own label Text? (U4)
				this.layer = 'raised'; this.zIndex = 100;
				// [14] Does setting `layer` move the card to screen space? (U2). No tween for the 20 px lift (U15).
				this.position = { ...this.position, y: this.position.y - 20 };
				break;
			case 'pointerleave':
				this.layer = 'inherit'; this.zIndex = this.index; this.position = { ...this.position, y: this.position.y + 20 };
				break;
			case 'pointerdown':
				this.capturePointer(); this.pressOrigin = e.screen; e.consume();
				// [15] Consumed down: is a click still synthesised for click-and-confirm? No threshold defined (U4, U5).
				break;
			case 'pointermove':
				if (!this.captured) break;
				if (!this.dragging && distance(e.screen, this.pressOrigin) > 4) { this.dragging = true; this.layer = 'drag'; }
				if (this.dragging) {
					this.position = /* [16] screen or hand-local? (U2) */ this.parent.screenToLocal(e.screen);
					// [17] Cannot highlight the enemy under the pointer: capture suppresses its pointerenter and there is
					//      no hitTest API to ask what is under the ghost (U5).
				}
				break;
			case 'pointerup':
				if (this.dragging) {
					const target = /* [18] "the framework hit-tests with the dragged item excluded": no API (U5) */ null;
					if (target instanceof VehicleView) this.game.play(this.model, target.model);
					this.dragging = false; this.layer = 'inherit';
				}
				break;
		}
	}
}
```

Targeting mode (click a card, then click an enemy; everything else cancels) needs a scrim beneath the valid targets: the scrim is a root child submitted after the battlefield, so with both in `overlay` the scrim paints over the enemies and swallows their clicks; the author has to put the scrim in `raised` and promote the valid enemies to `overlay`, or insert the scrim as the first child of the root. [19] The ladder works but the spec should say this is the pattern (a note in R3.9), and `pointerEvents: passthrough` on the scrim plus a screen-level cancel would be simpler (U4).

Keyboard and controller: "Tab cycles through valid targets" and D-pad navigation are unbuildable without a focus group and directional focus (U7, U9). Touch drag of a card on the Steam Deck does not start because capture and hover are mouse-only (U6).

Toasts and dialog are fine once ownership is settled (U18). The full-viewport stack handles resize without a second layout, which fixes the sibling engine's two-layout combat screen; that part of the spec delivers.

---

## C. What is right and should not be changed

- One interface for leaves and widgets, with the design-system primitives in the tree (R8.1). The margin-box `bounds` with content-box hit testing and half-open edges (R8.10 to R8.12) is consistent, cheap, and already pinned by worldsim's layout and lint fixtures; keep it, and add per-side margins and ink extents (U17) rather than switching to CSS boxes.
- The mount context with no singletons, construction that touches no service, and `removeChild` that unmounts (R8.14, R8.15, R8.7). Keep, add state-preserving moves (U14).
- Layer promotion as the only escape hatch, with the named ladder and `zIndex` local to siblings (R3.5 to R3.14). Keep; just settle the coordinate origin (U2).
- Hit order equals reverse paint order across layers (R3.28, R9.4), framework-derived enter and leave with `hovered` owned by the dispatcher (R9.8, R9.9), pointer capture (R9.10), bubbling with consume (R9.6), the popup service for exclusivity instead of focus theft (R9.14). These are the right corrections to worldsim; the findings above fill them in rather than replace them.
- Focus scopes, `focusVisible`, unregister-without-callbacks (R9.20 to R9.23). Keep the intent; derive order from the tree (U8).
- The fixed/hug/fill vocabulary, the three-pass algorithm with the cross pass before the main pass so wrapping text feeds hug height, definite-zero as a valid size, no negative offsets, worldsim's numeric fixtures as the conformance suite (chapter 10). Keep, fix the freeze (U1) and add minimums and anchors (U16).
- The token pipeline, the two-accent rule, three type roles, the radius and spacing scales, measurement with the render transform (chapter 11, R10.14).
- Controlled-value semantics (`value` set programmatically is silent, user change fires once) for Select, Slider, TabBar, Checkbox, TextInput; Menu as a dumb building block; Toast and ToastStack lifecycle and "invisible while empty"; tooltip declared on components and driven by the service; one placement service; `opacity: 0` not receiving input.
- Snapshot plus lint as the merge gate, the same code in tests and live, `null` for unknown, ids in paths (chapter 13). Keep; widen the schema (U20).
- Behaviour tests that drive components through the dispatcher, never through handlers (R9.25, R14.3).
