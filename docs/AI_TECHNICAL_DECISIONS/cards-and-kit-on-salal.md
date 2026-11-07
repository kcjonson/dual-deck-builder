# The card, its back, the vehicle token, gauges and markers on salal

## Date
2026-11-06

## Context

The compound pilot ported the atlas parts it used ([compound-screen.md](./compound-screen.md), In the C++ alpha). The other screen ports need the rest: the card in its three sizes, the detail view, face, and mini (Game Flow 7.0, [mini-card.md](./mini-card.md), and the TypeScript's `card-face-and-detail-view.md` in `_legacy/docs/`); the card back (UI Art Direction, Card hints); the vehicle token ([vehicle-token.md](./vehicle-token.md)); the gauges and the map's markers (UI Art Direction, Components); and a gallery to see them in, the card showcase the main menu's appendices open. Card text also reached the screen with its `{variables}` and `[keywords]` unfilled, because nothing in the alpha filled them.

## Options considered

How a card draws its words:

1. **A `ui::Text` a word piece,** as the TypeScript's `KeywordText` did, so the lint and the tree see every word. About fifteen components a card, and the showcase shows a hundred cards.
2. **The card's own draws (chosen):** its render prints each run where a flow laid it out, and `describe` puts its name, cost and summary in the tree.

Where the detail view lives:

1. **salal's tooltip, extended to pin and to open on focus.** The generic shape, and engine work.
2. **An overlay the card opens (chosen):** hover through the tooltip service with the card's own opener, and keyboard focus and the pin opened by the card itself.

## Decision

**Card text is the rules'.** `libs/rules/core/CardText.h` fills a card's summary and description from its variables, base or upgraded, with the upgrade's own texts where it has them, cuts a text into keyword and plain pieces (brackets in a summary, any keyword's name in the full text), and holds the keywords' meanings. A test over the base pack holds every card's text to no unfilled variable and no bracketed word the keyword boxes can't explain. The run scene's reward rows show the filled text without its brackets.

**One card, two sizes, drawing itself** (`cards/Card`). A `ui::Control` at 128 by 180 or 80 by 112, laid out from the tables in `cards/CardStyle.h`, which are the TypeScript's. The face's name is measured at 16 px and set at 14 if it doesn't fit, then cut; its summary is flowed once at mount, 12 over 17 in 114, keywords in yellow. The mini's name takes two lines; its stack, count, state tag and dashes are its own draws past its box, inside `mini::kInk`, and grids of minis sit `mini::kGridGap` apart. The card's stock is the combat screen's dark one on every scene, so its colours are constants beside the tables, not tokens: a card is the same object on the road and on the atlas. Unaffordable and faded dim through colours. Art is a placeholder glyph per kind until cards have art.

The layout lint can't see words a card prints itself, so a test does the card data check: every base-pack face holds its summary to three lines and its name uncut, and every detail view fits 440.

**The detail view is an overlay the card opens** (`cards/CardDetail`). A `CardInspect` is the 250 px view and up to three keyword boxes, on its right for driver 1's cards and nobody's, on its left for driver 2's. Hover opens it in the tooltip tier after the tooltip delay, through `setTooltip` with the card's opener; keyboard focus opens the same at once; a secondary press or I pins it as a panel, non-modal, with the hover tooltip off until it's let go by the same again or Escape. It's anchored beside the card, flipping to the other side when there's no room, so it never covers the card; the TypeScript rested it on the screen's bottom edge, which the battle scene can do by changing its placement.

**The card back** (`cards/CardBack`) is W1 paper through the paper hook with an ink edge and 7 px corners at 100 wide, the band in the deck's colour on its casing, a paper panel with a fine rule and five faint contour loops, and the small mark at the centre. The mark is `art/mark-small.svg`, a copy of the design's with its reused W copies written out as plain paths, which `salal_art` accepts; deck B's back recolours its Highway and Casing paints to Route teal's. A deck set down as an object (`cards/DeckStack`, for the splash and the menu cover) is its top card's back with three or four card edges under it and a drop shadow, squared up or fanned from the bottom-left corner, all decoration.

**The card showcase** (`scenes/showcase`, `card_showcase`) is an atlas sheet with a Menu tab: the two backs, the sizes and states on one card, every card's face by name, then each rarity's cards as minis. Page Up and Page Down scroll it. The main menu's appendices open it.

**The vehicle token** (`road/VehicleToken`) takes a `TokenData`, which the battle scene fills from the fight, and draws the mock's fixed layout scaled as a whole. Status chips are short labels ("SH4", "VUL") until status icons exist.

**Gauges and markers** (`atlas/Gauges`, `atlas/Markers`) are leaves with intrinsic sizes: the scale bar 32 px a segment by 8, the cased bar 160 by 12, each as wide as its box; a marker as tall as its extent, the shield 40:49.

## Trade-offs and consequences

- The card's words aren't `ui::Text`, so the lint's overflowing-text rule doesn't see them; the card data test does.
- Pinning and opening on focus are the card's, not salal's. A driver or escort card with a detail view of its own copies the pattern, or salal's tooltip service learns both.
- The token has no tooltips on its chips and intents yet, and nothing fills it from the fight; both come with the battle scene's port.
- Driver and escort cards (Game Flow 7.0's second table) came with the Crew screen and load out (`cards/DriverCard`, 104 by 146 on a riveted double frame, and `cards/EscortCard`, mini size under a hazard-stripe header), each drawing itself on the card's stock with its tags through `drawTag`. Neither has its detail view yet.
