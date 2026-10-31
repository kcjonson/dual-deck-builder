# The Crew screen, and the deck builder Customize shares (DDB-314)

Date: 2026-10-09. Code: `_legacy/src/renderer/game/screens/crew/` (`CrewScreen.ts`, `crewSources.ts`, `crewText.ts`), `_legacy/src/renderer/game/ui/deckBuilder/` (`DeckBuilder.ts`, `CardEntryGrid.ts`, `CostCurve.ts`, `cardSource.ts`), and `_legacy/src/renderer/game/campaign/cardBlockerText.ts`. Specs: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 3.2 and 7.0, [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Decks and the locker), and the wireframe `docs/design/supply-runs/crew-and-decks.png`. Opened from the compound with its campaign ([compound-screen.md](./compound-screen.md)). Builds on [locker-and-deck-rules.md](./locker-and-deck-rules.md), [run-decks.md](./run-decks.md), [mini-card.md](./mini-card.md), [driver-card.md](./driver-card.md), and [scroll-into-view-ink.md](../../_legacy/docs/AI_TECHNICAL_DECISIONS/scroll-into-view-ink.md).

## Context

The rules were all there: `getCardMoveBlocker` and `moveCards` for the locker and default decks, `getScrapBlocker` and `scrapCards`, a typed reason for every refusal, and the mini and driver cards to draw them with. The bunkhouse tile on the compound was disabled, waiting for a screen. Customize (DDB-321) is the same layout over a run deck ("the two feel like the same tool"), so whatever the Crew screen builds for its deck and locker has to take other sources and other controls without a rewrite.

## Decisions

### A deck builder that knows nothing of campaigns

The deck builder is the three columns: a left column the caller builds and sizes, the deck in a flush panel under the caller's header and over the caller's foot, and the pool in a flush panel with its title, a filter, and an optional note. What each side shows comes from a `CardSource`, a function returning `CardEntry`s (a key, a card type, its copies, a mini state, and its controls), read again on refresh. A control is a key, a label, whether it's quiet (ghost) or destructive, a reason or null, whether it's disabled with no line of its own, and what it runs. The builder sorts what it's handed cheapest first and then by name (`deckOrder`, shared with the driver detail view so the two can't drift), then by key, drops a type the card lookup doesn't know, and filters the pool by kind. The builder imports nothing from the campaign.

An entry's key is its card type unless it has one of its own. Customize shows a card's own copies and its borrowed ones as two stacks of one card type (the +N stack beside the plain one), so it keys them apart, and the grids look entries up by the key.

The Crew screen's sources (`crewDeckSource`, `crewLockerSource`) are the only code that touches the campaign: Remove is `moveCards` from the chosen driver to the locker, Add the other way, Scrap is `scrapCards`, and each control's reason is `cardBlockerReason` (`campaign/cardBlockerText.ts`) on what `getCardMoveBlocker` or `getScrapBlocker` returns. Customize writes two more sources over a run deck (one fewer, one more, Borrow) and passes its own side column and header; the reasons for `already_borrowed`, `card_locked`, and the garage's `too_little_scrap` are already worded.

Rejected: a Crew screen with the grids inline, which Customize would have had to copy or untangle; and a builder that takes a campaign and a place, which would put load out's rules (borrowing, leaving at home, escort cards) inside a UI component.

### An entry is a mini, its controls, and the reason

Each card is an entry: the mini stacked to its copies, its controls side by side under it, and a line under those for why a control is disabled. A disabled control takes no focus or hover (R9.5) and a tooltip needs one of them (R12.22), so the reason has to be text on screen, as it is on the compound and on load out's wireframe. The reasons are worded from the blocker codes, not from `blockerMessage`, which names the driver and the card in full for the log, and they name nobody: "Deck full", "Deck at minimum", "Interceptor only", "Out on a run", "Other seat has it". A test measures every one the rules can give in the real face against the entry's width.

An entry is 96 px wide, the mini centred in it, so two controls and the longest reason ("Road Warrior only") fit one line each, an armed Scrap's "Confirm" included. Entries sit 8 px apart, and a stack's edges, count, and tag stay inside their own entry. The controls start 8 px under the mini, past the count that hangs below it. The grid keeps a margin round it, so a stack's ink stays inside the scroller's clip.

A grid with no entries is hidden, and so is a row of the roster with no drivers, rather than drawn as a box with no height (R13.25's fourth rule); what the side says when it's empty shows instead.

### Fitting 1024 px

Three columns of entries in the deck and in the locker at 1024 px is what the layout is sized for, with little slack: the roster takes two driver cards and its scroller's gutter (a width Customize's left column shares), the columns are 12 px apart, and the three panels are flush, so the grids get the width a panel's inset would take; what isn't a grid sits in inset sections. At 1440 px the deck and the locker each get five columns. A layout test at 1024x600 checks the column count, so a spacing change that loses one fails there.

The header's figures are written as the driver card writes HP ("HP 40/40", "DECK 12/20"), so the four chips sit on one row at 1024 px for a driver who's ready; a longer standing ("Injured, fit in 2 days") wraps to a second. The cost curve sits on one row with its label and the limits, as the wireframe draws it, and shows only under a chosen driver's deck once the cards are there.

Vertically, 1024x600 shows about a row and a half of the deck and two rows of the locker; each scrolls on its own (R12.20), with Page Up and Page Down from anywhere inside it, and keyboard focus scrolls all a mini draws, tags included, into view.

### Focus kept through a move

An entry that stays through a move keeps its hover and focus, and only its count, state, and controls change. Three things would otherwise throw focus back to Back (R9.28):

- A control that a move disables while it has focus (Add when the deck fills) hands focus to the mini above it, with the reason right under it.
- An entry that goes while it has focus (the last copy of a card added) puts focus on the same part of the entry now in its place, or the one before it. After a destructive control it lands on that entry's mini instead, so the next press can't destroy a card the player didn't aim at.
- A grid that empties under focus hands it on: the locker to the filter's selected segment, the deck to the locker's first card or the filter.

Down from a mini goes to its first live control, and Up from a control back to the mini. Directional focus alone passes a control by for the next row's mini, since the mini below overlaps across far more than a half-width button does (R9.26).

The roster keeps its cards by driver id the same way, and a driver card's data follows the deck as it changes.

### Scrap takes two presses

Scrap destroys a copy, and the grid closes up after it, so the next card lands under the pointer and the next press. The first press arms Scrap: it reads "Confirm" in R12.7's danger tone (`crit`, as the main menu's destructive confirm is), in the same place. A second press on the same card scraps one copy, unless it comes within 300 ms of arming, which is a double-click's second press and is ignored. It disarms when focus or the pointer leaves it, after 3 s on the frame clock, on Escape, which it consumes so the screen stays (the `cancel` action, R9.15, R9.27), or when the entry is shown again for any change, a filter change included, so a card that slides into place after a scrap is only ever armed by the next press. Any control marked destructive works this way.

Disarming a hovered Scrap fades the danger tone's glow out over the transition rather than cutting it.

### Recomputed on the campaign's change, saved at each step

The screen refreshes on the campaign's `change`, never a record's, since a record's listener can see half a move ([locker-and-deck-rules.md](./locker-and-deck-rules.md)). Each control makes its move, then checkpoints (`CampaignStore.checkpoint`), so each press is one step, saved. A save that fails shows the store's message under the top bar in the critical colour, as the compound's does over Rest and Scavenge, and the next checkpoint that lands clears it. A move is never held back for a save: the checkpoint after it holds the whole move, which is what the store asks.

### Opening and leaving

The bunkhouse opens the Crew screen with the campaign on show, but not while a day end is being saved. Back and Escape go back to the compound with focus on the Bunkhouse. A campaign handed over shows at once, roster and header, so Back hands it back even before the cards are in; opened with no campaign, the screen loads the save as Continue would. The cards load from the start, and the deck and locker say so until they're there; a roster card's detail view, which lays the deck out as minis, opens only once they are. If they can't load, the roster still shows and the deck and locker say the cards couldn't be loaded.

### Focus and keys

Focus starts on Back, as on the compound. Tab goes Back, the roster, the deck, the filter, the locker (R9.18). The roster is one focus group across the drivers at the compound and the lost (R9.29), so Left and Right read on from one row to the next instead of turning off diagonally at a row's end, as DDB-312's review asked; Up and Down go unconsumed to directional focus (R9.24, R9.26). Each grid is a focus group the same way: Left and Right walk every mini and control in reading order, Up and Down move between a mini and its controls and between rows. Escape is Back, unless an armed Scrap or a pinned detail view takes it first; I and a secondary click pin a card's detail view.

## Provisional calls

Each is the simplest option where the spec leaves the call open, and a line or two to change.

- The dead and the missing are both "lost on runs", faded with a LOST tag. Their cards open the detail view but can't be picked, so a missing driver's deck can't be worked on until they're found.
- A lost driver's card says how they went in the specialty's place, "Killed on a run" or "Missing on a run", without the day: the record keeps none, and reading it out of the log's wording would be brittle. A dead driver's card reads DECK 0, since their deck went with them; a missing driver's keeps its count. This settles DDB-312's open question without a change to the campaign model.
- A card for another archetype is faded in the locker, since it can never go in that deck. A full deck disables every Add with "Deck full" but fades nothing, since any card would fit once one comes out.
- Scrap is two-step: the first press arms it as "Confirm", the second on the same card scraps one copy (not within 300 ms, a double-click's), and leaving it, Escape, 3 s, or any other change disarms it. The locker's note says what a copy pays and what the compound holds ("Scrap destroys a copy for 5 scrap; the compound has 35.").
- The filter's kinds are All, Attack, Defense, Utility, and Order. A power card files under Attack, as its placeholder art does, and a synergy card under its first tag, so every card is under exactly one kind.
- The first driver at the compound is chosen when the screen opens; the choice isn't remembered between visits.
- A driver out on a run (only possible with run decks out) shows SEAT 1 or SEAT 2 and their default deck as it sits in their run deck, with every Add and Remove disabled "Out on a run".
- No NEW tag: the campaign doesn't record when a driver joined.
- No portrait in the deck's header: the chosen driver's card beside it has one, and the room goes to the deck at 1024x600.

## Consequences

- Customize (DDB-321) builds the deck builder with its own side column, header, and foot, and two sources over `moveCards` with a run deck at one end. A card's own copies and its borrowed ones are two entries of one card type with keys of their own; the +N, HOME, and LOCKED looks are the mini's states, which an entry's state passes through; and a control at a limit can be disabled with no line of its own beside one that says why.
- The cases the screen is checked in, at 1440x882 and 1024x600: the fixture's campaign with its run brought home, a 20-card deck beside one to four copies of every card that isn't an escort's, a locker of 44 kinds with made-up cards (the shipped cards stop at 23 such kinds), a new campaign, a lone driver, nobody at the compound, no save, and cards that don't load.
- Nothing new is saved, so the save format version stays where it was.
