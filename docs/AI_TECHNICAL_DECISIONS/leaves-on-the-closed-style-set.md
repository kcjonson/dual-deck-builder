# Leaves on the closed style set, and Container

Status: decided 2026-09-28 with DDB-85's third PR (DDB-55 phase 5, Wave A), which closes DDB-209. Rules R11.14 to R11.16 in [chapter 11](../ui-rendering-spec/11-style-and-theme.md) and R12.1 to R12.5 and R12.18 in [chapter 12](../ui-rendering-spec/12-component-catalog.md). Follows [style-states-and-variants.md](./style-states-and-variants.md), which put Button and Input on the closed set and left the rest for this.

## What changed

- The legacy `Style` type (`engine/types/Style.ts`) and its `StyleParser` are deleted. `ComponentOptions` has no `style`; each component that renders style properties declares its own subset of R11.14's set, validates it at construction and in its `style` setter, and rejects the rest.
- Colours: `resolveColor` in `style/styleObject.ts` parses `transparent`, `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, and `rgba()` itself, reads token names, and accepts float arrays. A string it cannot read throws in a development build and in production warns and draws magenta (`INVALID_COLOR`), the same split `validateStyle` makes for unknown keys; a typo in a new call site is caught in development and never takes a screen down in a player's build. The old parser drew it as white.
- `Rectangle` (R12.1): `backgroundColor`, `borderColor`, `borderWidth`, `borderRadius`, `opacity`, `shadow`. The shadow is new (R12.1 lists it) and counts as ink.
- `Circle`, `Triangle`, `Polygon`: `backgroundColor`, `borderColor`, `borderWidth`, `opacity` (`components/shapeStyle.ts`).
- `Text` (R12.4): `color`, `fontSize`, `fontRole`, `fontFamily`, `fontWeight`, `letterSpacing`, `textTransform`, `textAlign`, `textDecoration`, `opacity`. What R12.4 names as text properties rather than style are options now: `verticalAlign`, `wrap` (`word` or `none`, was `whiteSpace`), `textOverflow` (`visible`, `clip`, `ellipsis`; was `textOverflow` in the style with `hidden` for clip), and `lineHeight`. `textStyle` is gone for the `style` setter and a `layoutOptions` setter.
- `Line` (R12.3) and `Image` (R12.5) are new leaves.
- `Layer` is renamed `Container` (R12.18) and has no visuals: its `setBackgroundColor` is gone. `Stack` takes the box properties as an optional `style` and draws them behind its children, which is how the stack gallery's demo boxes and the combat stage (the screen background) keep their fills.
- Every call site in the game moved over. The mechanical part (moving `verticalAlign`, `whiteSpace`, `textOverflow`, and `lineHeight` out of style objects, expanding the `border` shorthand, dropping `px` strings) was done by a one-off script; the rest by hand. `fontFamily: 'display' | 'mono' | 'body'` became `fontRole`.

## Decisions

**Every `style` setter replaces.** R11.16 wants runtime style changes on construction's path. Each leaf (and Stack, Line, Image) has a `style` getter and setter, and the setter validates and then resolves the new object over the component's defaults, exactly as the constructor does: a property the new style leaves out goes back to its default, not to its previous value. Button and Input re-apply their look's colour to their labels after a restyle for that reason. The single-value accessors (`fillColor`, a text's `color`; `setFillColor` and `setColor` before phase 6's accessor rename) change one value and leave `style` as it was; they are for code that animates or recolours.

**Each component owns its subset.** R11.14 says a component that accepts a property must render it and one that does not must reject it. A TypeScript `Pick` of `StyleProperties` per component makes most mistakes compile errors, and `validateStyle` catches the rest at run time (a legacy key throws in development builds; an accepted-elsewhere key throws always).

**Text layout is options, not style.** R11.14's closed set has no `verticalAlign`, `whiteSpace`, `textOverflow`, or `lineHeight`, and R12.4 lists alignment, wrap, and overflow as the text's own properties. The option is `textOverflow` rather than R12.4's `overflow`, since the base component's `overflow` already means whether it clips its children.

**Container has no visuals; Stack may have a box.** R12.18 is explicit that a container has none. A stack is a layout container too, but chapter 10 says nothing against a background, and the alternatives for the demo boxes (a backdrop Rectangle child) would sit inside the padding and add a child the lint pairs against its siblings. Recorded as a small departure: `Stack` accepts R11.14's box properties.

**Line.** Endpoints are in the line's own space and its box is their extent from the origin, so `position` moves both. The thickness is an option (`thickness`, since `width` is the box), the colour is `style.color`. It is not resized by layout.

**Image.** A texture from the asset cache by `src` (acquired on mount, released on unmount) or a caller's `texture`, placed by `fit` (`fill`, `contain`, `cover`, `none`) from a `sourceRect` in texture pixels, with a `tint`. Until the texture is resident it draws the placeholder, the style's `backgroundColor`. The frame renders every frame, so nothing needs to request a re-render when the texture arrives. A failed load keeps the placeholder and is left to the asset cache to report. Nine-slice (R5.19, recommended) stays with DDB-203.

## Departures

- `Stack` draws an optional box (above).
- Text's `overflow` is spelled `textOverflow`.
- `cursor` was accepted nowhere then; DDB-244 added it to Button and TextInput ([component-cursor.md](./component-cursor.md)).

## What moved on screen

Nothing, by intent: every call site keeps its colours, sizes, and text settings. The rename changes the type names in the tree snapshot (`Layer` to `Container`), so text records whose paths name an id-less container change their paths and nothing else. The gallery gains `leaves` (lines and images).
