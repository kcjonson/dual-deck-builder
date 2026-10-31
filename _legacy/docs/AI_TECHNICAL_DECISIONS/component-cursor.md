# Component cursor and the canvas cursor

Date: 2026-10-06. Task: DDB-244 (DDB-55). Spec: R8.2, R8.3, R8.18, R9.8, R9.10, R11.14, R12.7.

## Context

R8.2 lists `cursor` among the properties of every component, defaulting to `default`, and R12.7 gives Button `pointer`. The engine had no such property. `cursor` sat in the closed style set (R11.14) but every component rejected it, since nothing rendered it, so the canvas showed the arrow over every button, card, and field, and playtesters read clickable things as dead.

## Decision

- **The property.** `Component.cursor` is `'default' | 'pointer' | 'text' | null`, an option and an accessor. Null inherits (a departure, below). The getter returns the component's own value, else its kind's `defaultCursor`; setting null goes back to the kind's default. Only the dispatcher reads it, so a change touches neither layout nor paint (R8.18). The set is the three keywords the game uses; it widens when something needs `grab` or `not-allowed`.
- **Kind defaults.** `pointer` on `Pressable` (Button, DropdownButton, ListRow, Checkbox, Toggle, Radio, Segment, Tab, the tree's rows), Select, Slider, and a live Toast; `text` on TextInput and so on NumberInput's field; null everywhere else, Scrollbar included, as a browser shows the arrow on a scrollbar. Two parts answer per region, since one component draws several targets: a menu's rows show `pointer` over an item that selects and `default` over a separator, a disabled item, or the padding (read from the dispatcher's `hoverPoint`, so a scroll under a still pointer is right too); the number stepper shows `pointer` over a half that can step and `default` over one at its limit. A Toast fading out shows `default`, since it takes no click. In the game a Card says `pointer` once something listens for its select, and a Vehicle says `pointer` while it is a target someone can choose; both are `defaultCursor` overrides, so a cursor set on them stays.
- **Resolution.** The dispatcher starts at the innermost hovered component, skips any hidden since hover was last derived, and walks outward to the first non-null cursor; with none, or with no hovering pointer over the surface, it shows `default`.
- **Disabled.** If the innermost visible component is effectively disabled, the cursor is `default` whatever it or its ancestors set (a departure, below). Enabled is inherited downward, so that one check covers the chain: a disabled button inside a clickable card shows the arrow, and so does a disabled label with no cursor of its own inside an enabled card that says `pointer`, because the click on it is dropped (R9.5) and a hand would promise one.
- **Drag.** While the hovering pointer is captured, the captor's chain answers instead of the hovered one. Hover under capture only says whether the pointer is over the captor (R9.10), so following it would flip a slider drag, a text selection, or a card drag between the control's cursor and the arrow every time the pointer crossed the edge. On release hover is re-derived and the cursor follows it.
- **When.** Once at the end of every `dispatchPending`, and on `reset`, so a property, enabled, or visibility change under a still pointer shows on the next frame and a batch of moves reports only where it ended. A leave of the canvas clears the hover position, so the same pass resets to `default`.
- **Platform.** `createMountContext({ onCursorChange })` hands the dispatcher a callback, called only when the resolved value changes; `dispatcher.cursor` reads the last value. The web page and the gallery set `canvas.style.cursor` from it; the keywords are CSS's. Engine code never touches the DOM, and Electron runs the web page's shell.
- **Style.** Button and TextInput accept `cursor` in their base style (not in state overlays), which sets the component's property. A later style without `cursor` puts back the kind's default only when the cursor is still the one the last style set; a cursor assigned on the component since then stays. (`opacity` resets unconditionally; a cursor is more often set directly, by game code, so it gets the narrower rule.)
- **TreeView.** Its keyboard cursor is renamed to free the name: `TreeView.cursorRow` and the row's `keyboardCursor`.

## Departures

Both keep chapter 14's "Properties of R8.2" row partial until the specification text allows them.

- **Null inherits.** R8.2 gives `cursor` the default `default`, and R8.3 lists the properties derived from the parent (visibility, enabled state, opacity, layer) without it. Here the base default is null and the dispatcher takes the nearest ancestor's value, as CSS's inherited `cursor` does. With `default` on every component, a container that says `pointer` would lose it over every label and icon inside it, which is the common case for a clickable card or row built from leaves. The resolved value with nothing set anywhere is still `default`.
- **Disabled shows `default`.** No rule says what cursor a disabled component shows; R9.5 covers hit testing, click, hover, and focus, and R12.7 gives Button `pointer` without a disabled case. Showing `default` over a disabled component matches what it does with a click.

## Options considered

- Resolve on every hover change inside `setHoverTarget`: rejected. It misses a cursor, enabled, or visibility change under a still pointer, and a captured drag changes hover without the cursor needing to.
- A cursor service in the mount context, separate from the dispatcher: rejected for now. The dispatcher already owns the hovered chain and the captures, which is everything resolution needs, and nothing else writes a cursor yet.
- Give the base component `default` rather than null, as R8.2 says: rejected, for the reason in the first departure.
- Check enabled on whichever node supplies the cursor: rejected. An enabled ancestor's hand would show over a disabled leaf whose click is dropped.
- `pointer` wherever a component handles a click: rejected as a guess. Kinds declare it, and game components say so where they mean it.

## Consequences

- Chapter 14's "Properties of R8.2" row stays partial, naming the two departures.
- Touch never hovers, so the canvas stays at `default` under a finger.
