# Mini card: a size of Card, with stacks and states

Status: decided 2026-10-06, DDB-311 (epic DDB-277). Design source: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) section 7.0 and its "Card sizes" board (`docs/design/supply-runs/card-sizes.png`); where minis get used: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md), "Decks and the locker".

## Context

`Card` had a 50x70 `MINI` for driver selection's starting deck: the face scaled by 0.35, a 4 px name, and the quantity on a `Badge` under the card. Section 7.0 replaces it with an 80x112 mini card for every screen where many cards share the space (the Crew screen, the locker, load out, Customize, the debrief): the cost hex, the name on up to two lines, art, type and the rarity gem, no summary. Copies of one card stack, with up to two card edges behind and an "x5" count, and a copy can be borrowed for this run, left at home, an escort's locked card, or unavailable. The Crew screen will show a 20-card deck beside a locker of dozens, so a mini has to be cheap.

## Decisions

### One component, a second layout table

The mini is `Card` at `CardSize.MINI`, laid out from its own table (`MINI`) as the face is from `FACE`, in its own pixels from the outer edge. The hex hangs off the top-left corner as the face's does (22 px, 5 px out); the name sits beside it at 13 px condensed, wrapping to two lines in 56 px with the text's own ellipsis past that, and every name in `cards.json` fits whole, upgraded or not; the art strip has the face's driver gradient and placeholder glyph; the foot holds the type and the gem. The type uses the face's abbreviations (ATK, UTL, ORD) rather than the board's ATT and UTI, since the board is low fidelity and the two sizes should agree. The frame is the driver's colour, the neutral line when unowned, as on the face. The summary, the rarity name, the range chip and the driver mark stay the face's.

A mini doesn't rise under the pointer (`liftable` is false by default): it always sits in a grid, where a lift would cover the control under it.

Considered: a separate `MiniCard` widget. Section 7.0 asks for a size of the same component, and hover, focus, selection, dimming and the inspect path would all be written twice.

### Stacks, tags and dashes are the card's own draws

A consumer asks for a stack with `copies` and for a state with `miniState`, both on the constructor and as setters. The card edges behind a stack, the count, a state's tag and a borrowed copy's dashes are the card's own draws, like the cost hex, rather than parts: the tag straddles the top edge and hangs past the right one, the edges and the count reach past the bottom-right corner, and R13.25.2 doesn't let a part sit outside its parent. So they're ink. `MINI_CARD_INK` (7) is how far a mini draws past its box on any side and is its `inkExtent`; a grid of minis leaves at least twice that between cards (driver selection uses 16), or one stack runs into the next card's hex.

The tag and the count draw through `drawText` and come back as `drawnText`, so the text record still checks "HOME" or "x5" (DDB-206). The cost numeral isn't reported at either size, as before; reporting it on the face would re-mint every text record with a card in it.

Considered: growing the box to hold the stack and the tag. The 80x112 card would stop being the box layout lines up, a single card and a stack in one grid would sit differently, and the box would change with the copy count.

### What each state looks like

- Borrowed: the frame's border turns to dashes in the same colour, and a "+1" tag. The dashes come from `dashedOutlineTriangles`, which gains a `corner` option so no dash pokes past the rounded corners; one triangle list, built the first time any mini is borrowed and shared by all of them. A borrowed stack's tag counts its copies ("+2" on a pair), since "+1" on a stack of two would undercount what the run takes out of the locker. Hover, focus and selection replace the dashes with their solid outline, as they replace any card's resting frame.
- Left at home: faded, with a HOME tag.
- Locked: a LOCKED tag, at full strength.
- Unavailable: faded, no tag. The reason belongs to the consumer's control under the card.

Faded is the face's disabled look (the mock's `.cant`: darker and greyer, through colours), but a faded mini stays enabled, so it still takes hover and focus and still opens its detail view; a disabled card would refuse both. The tag is the card's ground with a muted outline and bone text, and the count is the cost hex's bone with dark digits, so neither brings a new colour.

Considered: opacity for the fade. A translucent card shows whatever is behind it, which is why the face dims through colours too.

### Cheap enough for a locker of dozens

Every draw is built once and recoloured or moved in place, and a frame hands the draw API the same objects each time. The tag and the count are measured when their text changes and on no other layout. A full stack adds two rects behind the card, the count a rect and a text, a tag a rect and a text, and the dashes one polygon, all inside the uber shader's batch. The tests check the object reuse and the single measure.

## Consequences

- Driver selection's starting deck uses the new mini, each card stacked to its quantity; the `Badge` under it is gone. The screen is due to go with load out (DDB-320), so it was moved over rather than redesigned: the grid's gap and margin and the deck scroller's minimum height grew for the bigger card and its ink, and at 1024x600 the deck scrolls sooner.
- A new gallery scene, `card-minis`: a driver's run deck and the locker, every state at real size, in the lint gate at 1440x882 and 1024x600. The developer screen's scroll thumb moves with the new section.
- The face draws exactly what it did; its local captures match main's.
- The Crew screen, load out, Customize and the debrief build on `copies`, `miniState`, `MINI_CARD_INK`, and `makeInspectable` with `inspectOnContextMenu` for the detail view. Driver and escort cards (section 7.0's second table) aren't part of this.
