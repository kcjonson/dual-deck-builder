# Escort card: a vehicle's card, its staying state, and its detail view

Status: decided 2026-10-08, DDB-313 (epic DDB-277). Design source: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) section 7.0, "Drivers and escorts are cards too", and the "Card sizes" board (`docs/design/supply-runs/card-sizes.png`); where escort cards get used: sections 1.2 (load out's escorts), 4.2 (the garage's convoy strip), and 5 (escort offers in events); the escorts themselves: [escorts.md](./escorts.md).

## Context

Section 7.0 makes escorts cards: 80x112, a mini card's size so an escort lines up with the play cards it adds, set apart by a hazard-stripe header, with art, the name, a structure bar, and the signature card it brings. At load out the convoy's escorts sit between the seats; clicking one leaves it at home for the run, faded and tagged STAYING. Hover, focus, or a touch hold opens its detail view: its profile and its signature card. The garage's convoy strip shows the same card with repair and dismiss under it, and an event can offer one to hire.

The driver card (DDB-312, [driver-card.md](./driver-card.md)) set the pattern: a plain view-model each screen maps onto, state set on the card, the play card's inspect path. Its review asked for the card plumbing to be shared before a third card copied it.

## Decisions

### What the three cards share

`CardBase<Data>` (`game/ui/CardBase.ts`) is what the play card, the driver card, and the escort card had, or would have, in common: one composite target (R8.29), the pointer cursor once something listens, a click (R9.31) or `activate` (R9.27) handing `onSelect` the card's data, with Enter and Space left to the screen's hotkeys when nothing listens; the focus ring each draws under its own tags and hex; settling its look on every state change and when it mounts again, since unmounting clears hover and focus without telling it (R9.21); and pinning a pinned view again when the data changes. Each card keeps its own `updateLook`; the play card adds its lift on top.

Considered: free helpers each card calls. Four of the six pieces are overrides of `Component`, which a base class states once and a helper can't.

The detail views share less, and share it as functions: `detailMono` (a row of mono, a label's or a stat's), the stat bar (`statBar.ts`, the driver's HP and the escort's structure in their own hues on one track), and `makeCentredInspectable` in `cardInspect.ts`, which builds a view each time it opens and centres it over its card. The gallery's card rows share `CatalogSection.captionedRow`.

### A plain view-model, from a type or from the convoy

`EscortCard` shows `EscortCardData` (`game/ui/escortCardData.ts`): the name, type, role, structure and its maximum, armor, speed, the crew skills, the signature card's type, and the dividend. `escortCardData({ type, ...overrides })` fills it from `ESCORT_CONFIGS` for an offer to hire, the gallery, and the tests; `escortCardDataOf(vehicle)` maps an escort in the convoy (a `Vehicle` with an `EscortProfile`) as it stands between fights: its structure, its full armor (armor refills between fights, escorts.md), and its own speed. Every escort the convoy holds is a hired type with its signature card, as the convoy's reader (`readConvoy`) holds it to, so the type and the card are never null here, and `escortCardDataOf` refuses a vehicle without them as the reader does. The data names the signature card by type, as the profile does, and the card looks the name up in the screen's cards, which it takes on construction, since game UI doesn't reach for the card loader; it looks again only when the data names another card. A type the lookup doesn't know leaves the signature line empty and the detail view without its card, as the driver detail view leaves an unknown type out of its deck.

Considered: the data carrying the signature card's name, or the `GameCard`. Either moves the lookup into every screen's mapping, and the detail view still needs the whole card.

### STAYING is the card's, not the escort's

Whether an escort goes on this run is load out's to say, so it's a setter on the card, as a driver card's seat is: `staying` fades the card and puts a STAYING tag on its top edge, the mini card's `StatusTagDraw` at the mini's place. A staying card stays enabled, focusable, and inspectable, so a click brings it back and its view still opens. A disabled card fades the same way and takes no input, for a screen that needs one.

Selection outlines the card in the bright yellow, a pixel heavier, as a selected mini's frame does. That's a trade-off: hover and selection are then both yellow lines, which the driver card found too close to tell apart on one line (1.15:1) and answered with a ring for the Crew roster's chosen driver. The escort card takes the mini's look anyway, since it's a mini's size in a mini's grid and load out and the convoy strip select nothing. A screen that both hovers and selects escorts (an event's offer of several, say) should give it the driver card's ring (`outsideRingDraw`) rather than ask players to read the two yellows apart.

### The face

Laid out from the board in its own pixels: the header, then the art strip, the name on up to two lines with two lines' room whatever it needs (so a row of cards keeps its bars level, as driver cards do), the structure bar with its figures in a box sized for five mono figures, which every escort's fits (the widest, a Fuel Hauler's, is 40/40), and "+ Top Off" in mono for the card it brings. The structure and signature rows are 11 px, a driver card's, so the 5 px bar sits on a whole pixel.

- The frame is a mini card's corners and line width in the dim line a driver card's frame takes, since nobody owns an escort's card the way a driver owns a play card. It's drawn as a ground, then the header, then the line over both, so the header never covers the line and a selected card's heavier line reads the same all round.
- The header is the road shoulder's 135 degree hatch (`stripes.ts`) in the card's muted bone on the stat bar's sunk black (`TRACK_FILLS`), inside the line. `hatchPolygonTriangles` hatches any convex polygon and `roundedRectPolygon` gives it the header's rounded top corners, so no stripe pokes past the curve. The stripes are built once per frame width and shared by every card and view that wide. The board draws the stripes black and white; a yellow-and-black hazard stripe would take a yellow the interaction and the keywords already own, and amber is driver 1's.
- The structure bar is the road's structure green (`STRUCTURE_COLOR`, now shared with `Vehicle`), on the driver card's track.
- No escort art exists. The placeholder is the driver portrait's: the unowned art strip's gradient with the rear view the road draws for the vehicle (`VehicleSprite` through `spriteKindForEscort`, a truck for every escort and a bike for a bike's name) in the portrait's faint bone.

### The detail view

`EscortDetailView` is the profile on the left and the signature card on the right, past a rule, under the escort card's header and frame and the play card detail view's shadow. The profile: the art beside the name on up to two lines and its role (HAULER or GUN ESCORT); its structure as figures and a bar; its armor, speed, and crew skills flowed in rows; and a hauler's dividend ("AFTER A WIN +1 FUEL"). The card is a full face (section 5 of Battle Screen Design), so its summary reads without a second hover; it takes no pointer, as the driver view's minis don't. A card the lookup doesn't know is left out, and the view is the profile alone. A foot says how to pin it. The type and spacing are the driver detail view's, so the two read as one family.

It's 426 px wide and about 270 tall, so it fits the 582 px the tooltip service has at 1024x600 with room to spare. Side by side because a card face beside a short profile covers less of a short screen than a profile stacked over a card.

It opens on the same path as every card's: `makeEscortInspectable(card)` builds the view from the card's data and lookup each time it opens, resting on the screen's bottom edge, centred over the card; hover, keyboard focus, and a touch hold open it, and a secondary click or I pins it (`inspectOnContextMenu`, `inspectHotkey`). A pinned view is pinned again when the card's data changes, unless the new data shows the same.

Considered: the play card's 250 px detail view of the signature card, keyword boxes and all, inside the escort's. Two views in one tooltip, and the escort's profile would be the smaller half.

Considered: caching the built view on the card, keyed on the data, the scale, and whether it's pinned. The surface carries placement state from the tooltip service (the room it was shrunk into, the clip it lifted, the card's centre), so a cached one would need resetting on every reuse and its key would need the card's place and the screen's size too. A view is built when it opens, not every frame, so it isn't done.

### As cheap as a mini

Every draw is built once and recoloured in place, and a frame hands the draw API the same objects each time. The tag is measured when its text changes and on no other layout, and new data re-measures only the words that changed. A card draws its ground, header band, stripes, and line, the art's ground and the vehicle's seven shapes, the bar's two rects, and the tag's two, all inside the uber shader's batch. The tag reaches 7 px up and 4 right (`ESCORT_CARD_INK` is 7, a mini's), so escort cards spaced by `MINI_GRID` clear each other's tags as minis do. The tests check the object reuse and the single measure.

## Consequences

- The API load out (DDB-320), the garage's convoy strip (DDB-44), and escort offers build on: `new EscortCard({ data, cards, staying })` and the `staying` and `data` setters, `selected`, `onSelect`, `focusable`, `makeEscortInspectable(card)` with `inspectOnContextMenu` on the container, `escortCardDataOf(vehicle)` and `escortCardData({ type })` to map a model, and `ESCORT_CARD_SIZE` and `MINI_GRID` to lay cards out.
- Three gallery scenes: `escort-cards` (coming on this run, staying, each other type whole or hurt, and selected), `escort-detail` (a hauler with its card), and `escort-detail-pinned` (a gun escort, pinned). They're gallery-only scenes with their own spec, `tests/visual/web/escortCards.spec.ts`, which holds their goldens, text records, and the lint gate at 1440x882 and 1024x600.
- The play card and the driver card draw and behave as they did; their tests are unchanged apart from the helpers they now share (`game/ui/testing.ts`).
