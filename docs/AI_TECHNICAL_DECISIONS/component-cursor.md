# Component cursor and the canvas cursor

Date: 2026-10-06. Task: DDB-244 (DDB-55). Spec: R8.2, R8.18, R9.5, R9.8, R9.10, R11.14, R12.7.

## Context

R8.2 lists `cursor` among the properties of every component, defaulting to `default`, and R12.7 gives Button `pointer`. The engine had no such property. `cursor` sat in the closed style set (R11.14) but every component rejected it, since nothing rendered it, so the canvas showed the arrow over every button, card, and field, and playtesters read clickable things as dead.

## Decision

- **The property.** `Component.cursor` is `'default' | 'pointer' | 'text' | null`, an option and an accessor. Null inherits. The getter returns the component's own value, else its kind's `defaultCursor`; setting null goes back to the kind's default. Only the dispatcher reads it, so a change touches neither layout nor paint (R8.18). The set is the three keywords the game uses; it widens when something needs `grab` or `not-allowed`.
- **Kind defaults.** `pointer` on `Pressable` (Button, DropdownButton, ListRow, Checkbox, Toggle, Radio, Segment, Tab, the tree's rows), Select, Slider, the number input's stepper, and a menu's rows; `text` on TextInput and so on NumberInput's field; null (inherit) everywhere else, Scrollbar included, as a browser shows the arrow on a scrollbar. In the game a Card says `pointer` once something listens for its select, and a Vehicle sets `pointer` while it is a target someone can choose.
- **Resolution.** The dispatcher walks from the innermost hovered component outward and takes the first non-null cursor; with none, or with no hovering pointer over the surface, it shows `default`. R8.2's default of `default` is that root answer, so a container that says `pointer` reaches the leaves inside it, as CSS's inherited `cursor` does.
- **Disabled.** An effectively disabled component that sets a cursor shows `default`, and that ends the walk: a disabled button inside a clickable card shows the arrow, not the card's hand. R9.5 already keeps hover and click off it, and the hand would promise a click that never comes.
- **Drag.** While the hovering pointer is captured, the captor's chain answers instead of the hovered one. Hover under capture only says whether the pointer is over the captor (R9.10), so following it would flip a slider drag, a text selection, or a card drag between the control's cursor and the arrow every time the pointer crossed the edge. On release hover is re-derived and the cursor follows it.
- **When.** Once at the end of every `dispatchPending`, so a property or enabled change under a still pointer shows on the next frame and a batch of moves reports only where it ended. A leave of the canvas clears the hover position, so the same pass resets to `default`.
- **Platform.** `createMountContext({ onCursorChange })` hands the dispatcher a callback, called only when the resolved value changes; `dispatcher.cursor` reads the last value. The web page and the gallery set `canvas.style.cursor` from it; the keywords are CSS's. Engine code never touches the DOM, and Electron runs the web page's shell.
- **Style.** Button and TextInput accept `cursor` in their base style (not in state overlays), which sets the component's property; a later style without it goes back to the kind's default, as `opacity` does.
- **TreeView.** Its keyboard cursor is renamed to free the name: `TreeView.cursorRow` and the row's `keyboardCursor`.

## Options considered

- Resolve on every hover change inside `setHoverTarget`: rejected. It misses a cursor or enabled change under a still pointer, and a captured drag changes hover without the cursor needing to.
- A cursor service in the mount context, separate from the dispatcher: rejected for now. The dispatcher already owns the hovered chain and the captures, which is everything resolution needs, and nothing else writes a cursor yet.
- Give the base component `default` rather than null: rejected. Every label inside a clickable card would then reset the card's hand to the arrow.
- `pointer` wherever a component handles a click: rejected as a guess. Kinds declare it, and game components say so where they mean it.

## Consequences

- Chapter 14's "Properties of R8.2" row scores yes.
- A menu's disabled items and separators show the hand, since the rows are one component. Per-item resolution waits for a menu that needs it.
- Touch never hovers, so the canvas stays at `default` under a finger.
