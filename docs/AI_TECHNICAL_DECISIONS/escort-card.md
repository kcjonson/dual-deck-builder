# Escort card: a vehicle's card, its staying state, and its detail view

Status: decided 2026-10-08, DDB-313 (epic DDB-277). Design source: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) section 7.0, "Drivers and escorts are cards too", and the "Card sizes" board (`docs/design/supply-runs/card-sizes.png`); where escort cards get used: sections 1.2 (load out's escorts), 4.2 (the garage's convoy strip), and 5 (escort offers in events); the escorts themselves: [escorts.md](./escorts.md).

## Context

Section 7.0 makes escorts cards: 80x112, a mini card's size so an escort lines up with the play cards it adds, set apart by a hazard-stripe header, with art, the name, a structure bar, and the signature card it brings. At load out the convoy's escorts sit between the seats; clicking one leaves it at home for the run, faded and tagged STAYING. Hover, focus, or a touch hold opens its detail view: its profile and its signature card. The garage's convoy strip shows the same card with repair and dismiss under it, and an event can offer one to hire.

The driver card (DDB-312, [driver-card.md](./driver-card.md)) set the pattern: a plain view-model each screen maps onto, state set on the card, the play card's inspect path. Its review asked for the card plumbing to be shared before a third card copied it.

## Decisions

### What the three cards share

The play card, the driver card, and the escort card share one base (`_legacy/src/renderer/game/ui/CardBase.ts`): each is one hit target (R8.29), shows the pointer cursor once something listens, and hands its data to a selection listener on a click (R9.31) or `activate` (R9.27), with Enter and Space left to the screen's hotkeys when nothing listens; each draws the focus ring under its own tags and hex, settles its look on every state change, and pins a pinned view again when the data changes. Each card keeps its own look; the play card adds its lift on top.

Considered: free helpers each card calls. Four of the six pieces are overrides of the component base, which a base class states once and a helper can't.

The detail views share less: a row of mono (a label's or a stat's), the stat bar (the driver's HP and the escort's structure in their own hues on one track), and the placement that builds a view each time it opens and centres it over its card.

### STAYING is the card's, not the escort's

Whether an escort goes on this run is load out's to say, so it's set on the card, as a driver card's seat is: staying fades the card and puts a STAYING tag on its top edge, the mini card's status tag at the mini's place. A staying card stays enabled, focusable, and inspectable, so a click brings it back and its view still opens. A disabled card fades the same way and takes no input, for a screen that needs one.

Selection outlines the card in the bright yellow, a pixel heavier, as a selected mini's frame does. That's a trade-off: hover and selection are then both yellow lines, which the driver card found too close to tell apart on one line (1.15:1) and answered with a ring for the Crew roster's chosen driver. The escort card takes the mini's look anyway, since it's a mini's size in a mini's grid and load out and the convoy strip select nothing. A screen that both hovers and selects escorts (an event's offer of several, say) should give it the driver card's ring rather than ask players to read the two yellows apart.

### The face

Laid out from the board in its own pixels: the header, then the art strip, the name on up to two lines with two lines' room whatever it needs (so a row of cards keeps its bars level, as driver cards do), the structure bar with its figures in a box sized for five mono figures, which every escort's fits (the widest, a Fuel Hauler's, is 40/40), and "+ Top Off" in mono for the card it brings. The structure and signature rows are 11 px, a driver card's, so the 5 px bar sits on a whole pixel. The tag reaches 7 px up and 4 right, a mini's ink, so escort cards spaced on the mini grid clear each other's tags as minis do.

- The frame is a mini card's corners and line width in the dim line a driver card's frame takes, since nobody owns an escort's card the way a driver owns a play card. It's drawn as a ground, then the header, then the line over both, so the header never covers the line and a selected card's heavier line reads the same all round.
- The header is the road shoulder's 135 degree hatch in the card's muted bone on the stat bar's sunk black, inside the line. The hatch follows the header's rounded top corners, so no stripe pokes past the curve. The board draws the stripes black and white; a yellow-and-black hazard stripe would take a yellow the interaction and the keywords already own, and amber is driver 1's.
- The structure bar is the road's structure green, on the driver card's track.
- No escort art exists. The placeholder is the driver portrait's: the unowned art strip's gradient with the rear view the road draws for the vehicle (a truck for every escort, and a bike for a bike's name) in the portrait's faint bone.

### The detail view

The detail view is the profile on the left and the signature card on the right, past a rule, under the escort card's header and frame and the play card detail view's shadow. The profile: the art beside the name on up to two lines and its role (HAULER or GUN ESCORT); its structure as figures and a bar; its armor, speed, and crew skills flowed in rows; and a hauler's dividend ("AFTER A WIN +1 FUEL"). An escort in the convoy shows as it stands between fights: its structure, its full armor (armor refills between fights, [escorts.md](./escorts.md)), and its own speed. The card is a full face (section 5 of Battle Screen Design), so its summary reads without a second hover; it takes no pointer, as the driver view's minis don't. A card the screen's card lookup doesn't know is left out, with the card's signature line empty, and the view is the profile alone. A foot says how to pin it. The type and spacing are the driver detail view's, so the two read as one family.

It's 426 px wide and about 270 tall, so it fits the 582 px a detail view has at 1024x600 with room to spare. Side by side because a card face beside a short profile covers less of a short screen than a profile stacked over a card.

It opens on the same path as every card's: built from the card's data each time it opens, resting on the screen's bottom edge, centred over the card; hover, keyboard focus, and a touch hold open it, and a secondary click or I pins it. A pinned view is pinned again when the card's data changes, unless the new data shows the same.

Considered: the play card's 250 px detail view of the signature card, keyword boxes and all, inside the escort's. Two views in one tooltip, and the escort's profile would be the smaller half.

## Consequences

- The states the card is checked in, at 1440x882 and 1024x600: coming on this run, staying, each other type whole or hurt, and selected; the detail view for a hauler with its card, and pinned for a gun escort.
- The play card and the driver card draw and behave as they did.
