# Mini card: a size of Card, with stacks and states

Status: decided 2026-10-06, DDB-311 (epic DDB-277). Design source: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) section 7.0 and its "Card sizes" board (`docs/design/supply-runs/card-sizes.png`); where minis get used: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md), "Decks and the locker".

## Context

`Card` had a 50x70 `MINI` for driver selection's starting deck: the face scaled by 0.35, a 4 px name, and the quantity on a `Badge` under the card. Section 7.0 replaces it with an 80x112 mini card for every screen where many cards share the space (the Crew screen, the locker, load out, Customize, and the debrief): the cost hex, the name on up to two lines, art, type, and the rarity gem, and no summary. Copies of one card stack, with up to two card edges behind and an "x5" count, and a copy can be borrowed for this run, left at home, an escort's locked card, or unavailable. The Crew screen will show a 20-card deck beside a locker of dozens, so a mini has to be cheap.

## Decisions

### One component, a second layout table

The mini is `Card` at `CardSize.MINI`, laid out from its own table (`MINI`) as the face is from `FACE`, in its own pixels from the outer edge. The hex hangs off the top-left corner as the face's does (22 px, 5 px out); the name sits beside it at 13 px condensed, wrapping to two lines in 56 px with the text's own ellipsis past that, and every name in `cards.json` fits whole, upgraded or not; the art strip has the face's driver gradient and placeholder glyph; the foot holds the type and the gem. The type uses the face's abbreviations (ATK, UTL, ORD) rather than the board's ATT and UTI, since the board is low fidelity and the two sizes should agree. The frame is the driver's colour, the neutral line when unowned, as on the face. The summary, the rarity name, the range chip, and the driver mark stay the face's.

A mini doesn't rise under the pointer (`liftable` is false by default): it always sits in a grid, where a lift would cover the control under it.

Considered: a separate `MiniCard` widget. Section 7.0 asks for a size of the same component, and hover, focus, selection, dimming, and the inspect path would all be written twice.

### Stacks, tags, and dashes are the card's own draws

A consumer asks for a stack with `copies` and for a state with `miniState`, both on the constructor and as setters. The card edges behind a stack, the count, a state's tag, and a borrowed copy's dashes are the card's own draws, like the cost hex, rather than parts: the tag straddles the top edge and hangs past the right one, the edges and the count reach past the bottom-right corner, and R13.25.2 doesn't let a part sit outside its parent. So they're ink. `MINI_CARD_INK` (7) is how far a mini draws past its box on any side and is its `inkExtent`.

Layout and the lint both ignore ink, so nothing stops a grid of minis from being built so tight that one stack runs into the next card's hex while the lint stays clean. `MINI_GRID` is the spacing every grid of minis takes instead of picking its own: a 16 px gap (twice the ink, and 2 px to breathe) and a 7 px margin round the grid, which keeps the ink inside a scroller's clip; `miniGridHeight(rows)` is what a number of rows takes. Driver selection and the gallery use it, and the Crew screen will.

The tag is `StatusTagDraw` (`game/ui/statusTag.ts`): mono capitals in a box of the card's ground with a muted outline, right-aligned to a point and measured only when its text changes. The driver card (INJURED, LOST, SEAT 1) and the escort card (STAYING) wear the same tag, so it isn't private to the mini.

The tag and the count draw through `drawText` and come back as `drawnText`, so the text record still checks "HOME" or "x5" (DDB-206). Labels belong to the node that draws them, so the record pairs those strings with the card's 80x112 box, not with the rect each is drawn in; a tag that moved inside the card's ink would pass the text record and show only in the golden. The cost numeral isn't reported at either size, as before; reporting it on the face would re-mint every text record with a card in it.

When a setter changes which draws a card makes (a stack's edges and count, a tag, the dashes, the face's driver mark), it calls `invalidateInk`, so the render walk recounts the card's draw groups before the subtree cull uses the count again.

Considered: growing the box to hold the stack and the tag. The 80x112 card would stop being the box layout lines up, a single card and a stack in one grid would sit differently, and the box would change with the copy count.

### What each state looks like

- Borrowed: the frame's border turns to dashes in the same colour, and a "+1" tag. The dashes come from `dashedOutlineTriangles`, which gains a `corner` option so no dash pokes past the rounded corners; one triangle list, built the first time any mini is borrowed and shared by all of them. A borrowed stack's tag counts its copies ("+2" on a pair), since "+1" on a stack of two would undercount what the run takes out of the locker. Hover, focus, and selection replace the dashes with their solid outline, as they replace any card's resting frame.
- Left at home: faded, with a HOME tag.
- Locked: a LOCKED tag, at full strength.
- Unavailable: faded, no tag. The reason belongs to the consumer's control under the card.

Faded is the face's disabled look (the mock's `.cant`: darker and greyer, through colours), but a faded mini stays enabled, so it still takes hover and focus and still opens its detail view; a disabled card would refuse both. The tag is the card's ground with a muted outline and bone text, and the count is the cost hex's bone with dark digits, so neither brings a new colour. A stack's edges are outlined a step darker than an owner's frame; an unowned card's frame line is translucent and would vanish against a dark screen behind the edges, so an unowned stack's edges take the opaque dim line instead.

Considered: opacity for the fade. A translucent card shows whatever is behind it, which is why the face dims through colours too.

### Focus ring and hit area

The render walk draws its fallback focus ring after a component and its children, which put the ring through a mini's tag and count and over the hex. A card now draws that ring itself (`drawsOwnFocusRing`, as Button and Select do), with the walk's tokens, after the frame and before the hex, so the hex, the tag, and the count sit on top of it. That holds at both sizes.

R8.8 leaves ink out of hit testing. The face already made one exception, the hex hanging off its corner, and the mini makes three more next to it: the stack edges it shows, its tag, and its count take the pointer too, so moving from the card onto "x5" doesn't drop the hover. Each reaches at most 7 px past the box, inside the 16 px `MINI_GRID` gap, so two neighbours' areas never meet.

### Changing the driver

The `driver` setter recolours the frame, the art, and a mini's dashes and edges for the new seat, and keeps a selected, hovered, or keyboard-focused card's outline. The face used to put a keyboard-focused card's frame back to its resting colour when its driver changed, losing the focus outline while the card was still focused.

### Cheap enough for a locker of dozens

Every draw is built once and recoloured or moved in place, and a frame hands the draw API the same objects each time. The tag and the count are measured when their text changes and on no other layout. A full stack adds two rects behind the card, the count a rect and a text, a tag a rect and a text, and the dashes one polygon, all inside the uber shader's batch. The tests check the object reuse and the single measure.

## Consequences

- Driver selection's starting deck uses the new mini, each card stacked to its quantity; the `Badge` under it is gone, and an entry of no copies is left out. The screen is due to go with load out (DDB-320), so it was moved over rather than redesigned. Six minis don't fit one row of a panel below about 1650 wide, so a six-card deck wraps where a four-card one doesn't, and the taller deck pushed one panel's portrait and name up past the other's. Both decks now take two rows' height whatever they hold, the most an unlocked driver's deck needs from 1024 wide up, so both decks take the same height for any pair; at 1920 wide that leaves an empty row under a one-row deck. Only the decks match: the flavour text can still run a line longer for one driver and move that panel's name. The portrait, a placeholder that gives way first, now goes down to 8 px rather than 40, so the two rows fit at 1280x720 without scrolling (it's 14 px there, 176 at 1440x882). Nothing scrolls at 1280x720 and above; at 1024x600 the flavour and the deck scroll, as before.
- A new gallery scene, `card-minis`: a driver's run deck and the locker, every state at real size, in the lint gate at 1440x882 and 1024x600. The new developer section moves the developer screen's scroll thumb; that golden differs within its tolerance there, so the baseline run, which re-mints only failing goldens, left it alone.
- The face draws what it did at rest. Two things change when it's focused: its focus ring is under its hex rather than over it, and it keeps its focus outline through a change of driver. No golden captures a focused card.
- The Crew screen, load out, Customize, and the debrief build on `copies`, `miniState`, `MINI_GRID`, and `makeInspectable` with `inspectOnContextMenu` for the detail view. Driver and escort cards (section 7.0's second table) aren't part of this; they take `StatusTagDraw` for their tags ([driver-card.md](./driver-card.md)).
