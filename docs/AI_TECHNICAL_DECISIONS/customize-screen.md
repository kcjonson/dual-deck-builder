# Customize: one driver's run deck (DDB-321)

Date: 2026-10-09. Code: `src/renderer/game/screens/customize/` (`CustomizeScreen.ts`, `customizeSources.ts`, `customizeText.ts`), and the developer screen's launcher, `screens/developer/CustomizeLauncherSection.ts`. Specs: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 1.2 (Customize) and [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Decks and the locker, At load out), and the wireframe `docs/design/supply-runs/customize.png`. Registered as `customizeScreen`. Builds on [crew-screen.md](./crew-screen.md), whose `DeckBuilder` it reuses, [run-decks.md](./run-decks.md), whose moves it calls, and [mini-card.md](./mini-card.md), whose +N, HOME, and LOCKED states it shows.

## Context

Run decks had their rules (`moveCards` with a run deck at one end, `moveEscortCard`, `resetRunDeck`, a typed blocker for each refusal) and the Crew screen had built its deck and locker as a `DeckBuilder` with Customize in mind: per-entry keys, an optional pool note, controls disabled with no caption of their own. What was missing was the screen. Load out (DDB-320), which opens it, isn't built, since it waits on solo runs (DDB-166).

## Decisions

### The Crew screen's builder, with three sources over a run deck

The screen is a `DeckBuilder` with its own left column, header, and foot, and two sources in `customizeSources.ts`, which with the escort cards' source are the only code that touches the campaign. Nothing was added to `ui/deckBuilder`. The left column is as wide as the Crew screen's roster (`ROSTER_WIDTH`), so the run deck and the locker get the Crew screen's widths and its three columns of entries at 1024 px, five at 1440 px.

### A card in three stacks, and a control live only where its move lands

A run deck holds a card's own copies going (`own`), its copies borrowed (`borrowed`), and its own copies left at home (`leftHome`), never a card both borrowed and left at home. Each is a stack of its own, keyed `<card>`, `<card>-borrowed`, and `<card>-home` (card types are snake case, so the hyphen can't collide), plain, dashed with +N, and faded with HOME. The builder sorts by card and then key, so a card's +N or HOME stack sits right after its own.

Each stack has one-fewer and one-more (`-` and `+`; the icon atlas has a remove glyph but no add). Both are `moveCards` between the run deck and the locker, and the campaign decides which copies move: out, borrowed copies first, then the driver's own stay home; in, the driver's own from home first, then the locker's. So the same press acts on whichever stack the rules pick, and a control is live only on the stack it changes:

| Stack | One-fewer | One-more |
| --- | --- | --- |
| Own | leaves one at home; off, with nothing said, while copies of the card are borrowed (the +N stack's one-fewer returns those first) | brings one back from home; off, with nothing said, when nothing is at home (a full stack, as on the wireframe) |
| +N | returns one to the locker | borrows another |
| HOME | off, with nothing said | brings one back |

A live control the rules refuse is disabled with `cardBlockerReason` under the card, as on the Crew screen: "Deck at minimum", "Deck full", "None left", "Other seat has it". The rules check the locker before the deck limits, so a +N stack at a full deck whose card the locker has run out of says "None left".

The locker is `campaign.locker`, which already lacks what the other seat borrowed, each card with Borrow. A card for another archetype is faded and says whose it is, as on the Crew screen. A card the driver has left some of their own at home says "Yours at home": the rules bring those back before borrowing, so Borrow would restore one rather than borrow, and the HOME stack's one-more is the way to do that.

Rejected: one stack per card with its +N or HOME tag on it, which can't show three copies going and two at home at once; and controls that run the move from any stack, which make pressing one-fewer under the plain stack shrink the +N stack beside it.

### The left column

The driver card (CUSTOM once the run deck differs from the default deck, its DECK figure the run deck's size), the vehicle, a line saying whether the run deck still matches the default deck and how it differs, Reset to default, and the escort cards. Reset is `resetRunDeck`, off with no caption when there's nothing to undo, since the line above it says so. Escort cards are a `CardEntryGrid` of their own, keyed by the escort that brought each, LOCKED, each with the wireframe's "Give to driver 2" (`moveEscortCard`), disabled with the rules' reason if either driver is away; it fits a 96 px entry with 20 px to spare, which a test measures. The column scrolls, since four escorts' cards are more than 1024x600 holds.

### The header and the foot

Three chips, "RUN DECK 12/20", "BORROWED 1", and "LEFT HOME 2", on one row at 1024 px. The wireframe's ", MIN 8" adds 50 px, which pushes the third chip past the run deck panel's 335 px there onto a second row, and "Deck at minimum" says the minimum where it matters. The engine has no dashed border, so BORROWED is a solid chip like the others. The foot is the wireframe's line on what borrowing risks. There's no cost curve: the wireframe has none, and the run deck's room goes to the cards.

### Saved at each step, and shown on the campaign's change

As on the Crew screen: every control checkpoints after its move, the screen shows the campaign again on its `change`, never a record's, and a save that fails says so under the top bar until a later one lands.

### Opening and leaving

Opened with `{ campaign, driver, returnTo }`, the screen shows that driver's run deck at once. `returnTo` is the screen Done goes back to, handed `{ campaign }` with `restoreFocus`, so load out gets the campaign back and focus lands on the seat's Customize; until load out exists it defaults to the compound. Opened with nothing, as the screen captures do, it loads the save as Continue would and shows the first seat. With no run out it says so in place of the run deck and the locker; a driver handed over who isn't seated says that instead. A campaign that's over never has a run out ([campaign-end.md](./campaign-end.md)), so there it says "Campaign over." and how the compound fell (`fallMessage`). Every check the controls ask names the end first, so "Campaign over" would show under any control the same way, as on the Crew screen, and Reset is off.

The data can also carry a `store`, which this visit saves into in place of the screen's own. The developer launcher uses it to open the screen on the test campaign without writing over the player's save; load out won't need it.

### Focus and keys

Focus starts on Done. Tab goes Done, the driver card, Reset, the escort cards, the run deck, the filter, the locker (R9.18). Each grid is one focus group (R9.29): Left and Right walk minis and controls in reading order, Down from a mini goes to its first live control (one-more on a HOME stack) and Up back (R9.26). The grids keep focus as the Crew screen's do: a control that a move disables hands focus to its mini, an entry that goes hands it to the same part of the entry now in its place (a card's last own copy left at home lands on its new HOME stack), and the escort grid, emptied, hands it to the driver card. Reset, disabled by its own press, hands focus to the driver card above it rather than letting R9.28 drop it. Escape is Done, unless a pinned detail view takes it first; I and a secondary click pin a card's detail view.

### A way in until load out

A developer section, `customize`, opens the screen on the store fixture's run, either seat, saved into memory, with Done coming back to the developer screen. In the gallery, where it's a scene like every section and no screens are mounted, its buttons do nothing.

## Provisional calls

Each is the simplest reading where the spec or the wireframe leaves the call open.

- A control is live only on the stack its move changes (the table above): the own stack's one-fewer is off while the card has borrowed copies in, and HOME's one-fewer is always off, both with nothing said.
- Borrow is off, "Yours at home", for a card the driver left some of their own at home.
- No "Back to load out": every change is saved as it's made, so Back would do what Done does. Done sits at the top right, as on the wireframe, and Escape is Done.
- Done goes back to the screen the opener names, the compound until load out exists.
- Opened with no driver, the screen shows the first seat.
- Reset to default takes one press, with no confirmation: it undoes this run's changes and destroys nothing.
- The chips leave the minimum out, BORROWED isn't dashed, and the locker's kicker is "Copies the other seat hasn't borrowed", since the wireframe's "free copies, after driver 2's run deck" is cut off at 1024 px.
- The driver card shows CUSTOM once the run deck differs from the default deck, and no seat tag, since the column's title says the seat.
- No cost curve under the run deck.

## Consequences

- Load out (DDB-320) navigates to `customizeScreen` with `{ campaign, driver, returnTo }` and gets `{ campaign }` back. `isCustomized` in `customizeText.ts` is its CUSTOM tag's test.
- The screen captures are `customizeScreen` over the fixture's run (seat 1: a card left at home, one borrowed, an escort card) and `customizeScreen-full`, a 20-card run deck with both escorts' cards beside the full locker (`fullRunCampaign`), each at both sizes. A locker of 44 kinds is in the Jest lint test, with made-up cards, and so are no run out, no save, and cards that don't load.
- Nothing new is saved, so `CAMPAIGN_SCHEMA_VERSION` stays where it was.
