# Driver selection on stacks

Status: implemented (DDB-89, DDB-55 phase 6), 2026-10-01. Closes DDB-31, DDB-101, DDB-102, DDB-108.
Spec: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) section 1.2, chapter 10 of the [UI rendering spec](../ui-rendering-spec/10-layout.md), R12.12, R12.20, R12.26
Builds on: [stack-layout.md](./stack-layout.md), [game-code-on-the-tree.md](./game-code-on-the-tree.md), [combat-screen-stacks.md](./combat-screen-stacks.md)

## Problem

The screen placed everything from percentages of the root in `placeElements`: panels at 35 percent of the width and 60 of the height, the synergy panel at 55 percent down, START RUN at 85. Inside each panel the portrait was 40 percent of its height and every line below it a fixed offset from the portrait, with the deck preview clipped to whatever was left above the cycle button. At 1024x600 that was nothing: the preview clamped to zero height, "Starting Deck:" with it, and the flavour text ran under the button (DDB-67's note). The quantity badges were 10 px text on the mini card's corner, over its cost digit. Driver choice was a cycle button.

## Decision

The page is one vertical stack the viewport's size, holding a header row, the body row, and a footer row. `onResized` sizes the page and nothing else.

- Header: Back (200 wide), the title filling the row with centred text, and a 200-wide spacer so the title centres on the screen rather than on what Back leaves.
- Body: left panel, synergy column, right panel, `fill` with weights 35, 18, 35 (the old proportions). The synergy panel hugs its height and the column centres it.
- Footer: the summary filling the space left of START RUN, right-aligned and wrapping, the button, and an empty fill the same weight on the right, so the button stays centred and an empty summary moves nothing. The spec puts the summary "next to" the button; side by side also gives the panels 34 px more height than stacking it above.

Each `DriverPanel` is a column: the portrait (`fill`, minimum 8), name, vehicle, specialty, a scroll container, and the `Select`. The scroll container holds a column of the flavour text, "Starting Deck:", and the mini cards.

The scroll container hugs its content. That needed an engine change: `ScrollContainer.measure` on a `hug` height returns the content's measured height plus padding, and `minContentSize('height')` is 0, so a column with room gives it exactly its content and a column without shrinks it (CSS flex-shrink) down to its `minSize`. That is CSS's `max-height` with `overflow: auto`. With the portrait as the only `fill` child, a tall window grows the portrait and a short one shrinks the portrait to its minimum and then the scroller to a card height, past which the flavour and deck scroll.

Options considered for the panel:

1. Portrait and deck preview both `fill`, weighted. The deck gets a share of the height whether it needs it or not, so the reference size (1440x882) scrolled a deck that would have fit if the portrait gave a little. Rejected.
2. Flavour text in the panel's flow, only the deck in the scroller. Wrapped text in a column that is out of room shrinks to one line under chapter 10's shrink-to-fit and overlaps what follows, so at 1024x600 the flavour ran into the deck title. Rejected.
3. Flavour and deck in one hugging scroller (chosen). Nothing overlaps at any height, the deck title is never the thing that vanishes first, and nothing scrolls at 1280x720 and above.

The mini cards need rows, and wrap is out of the engine's scope (R10.4: "Wrap (multi-line flex) and grid are out of scope"). `game/ui/FlowWrap.ts` is a small container that takes part in stack layout like a wrapping text: a stack assigns its width, it measures its rows' height at that width, and each item keeps its own measured size. Two rows of the game use it, the deck preview and the synergy tags. It stays in game code until the engine adopts wrap, at which point it should be deleted for that.

Each deck entry is one 80x112 mini card stacked to its quantity, the count on the stack itself ([mini-card.md](./mini-card.md), DDB-311). The grid is spaced by `MINI_GRID` and takes two rows' height whatever the deck holds: a six-card deck wraps to two rows below about 1650 wide while a four-card one fits in one, and two hugging decks of different heights would put one panel's portrait and name higher than the other's. Two rows is the most an unlocked driver's deck needs from 1024 wide up, so the panels match for any pair. The portrait gives way first, down to 8 px (it was 40 before the minis grew), so both decks' two rows still fit at 1280x720 without scrolling.

The `Select` lists every unlocked driver with the partner's driver `enabled: false`, so a conflicting pick can't be made from the UI; `DriverPanel.selectDriver` still moves on to the next open driver if one arrives. The panels' public surface is `select`, `deckPreview`, and `selectDriver(archetype)`; `cycleDriver` is deleted.

## Departures and gaps, recorded

- The portrait is wider and taller than 40 percent of the screen height at 1920x1080 (558 of 1080). It is a placeholder rectangle, and holding it to 40 percent would leave the empty space below the Select instead.
- Locked drivers aren't listed (they never were). The spec's greyed, locked entries with an unlock tooltip need lock state on `Driver`, which doesn't exist.
- Part 2 of spec 1.2, locked drivers greyed in the Select, is open (DDB-226). The mini cards preview the full card on hover and focus (DDB-226 part 1): `makeInspectable`, the hand's detail view, with the deck grid a focus group so Tab reaches it once and the arrows walk its cards. The first Escape dismisses a visible preview, the next leaves.
- `Game.setupEventHandlers` had a document-level Escape that navigated to the main menu ahead of the dispatcher, so Escape on an open Select left the screen. DDB-89 made it defer to screens whose root registers Escape; DDB-225 deleted it once every screen did, and the screen now builds in `onMount` and unregisters its Escape on unmount.
- The screen lints to 50, every one a sibling overlap between `Card`'s own rectangles and texts. Making those parts is DDB-91's.

## Tests

`DriverSelectionScreen.test.ts` drives the real screen on the measuring backend: options and disabling, a keyboard pick, Escape on an open Select, tab order, three resizes with the same children and selections, the scroller's room above the Select at 1024x600, 1280x720, and 1920x1080, scrolling at 1024x600, each card stacked to its quantity and an entry of none left out, both panels' names level with nothing scrolling at 1440x882, 1280x720, and 1920x1080, and the card-load race. `FlowWrap.test.ts` covers wrapping, centring, reflow on a narrower column, an oversized item, growth, and hugging outside a stack. `ScrollContainer.test.ts` adds four hug-height cases.

## Consequences

The driver selection golden moves wholesale. The screen needs no per-size code; a new element goes into one of the stacks.
