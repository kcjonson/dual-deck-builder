# Customize: one driver's run deck (DDB-321)

Date: 2026-10-09. Code: `src/renderer/game/screens/customize/` (`CustomizeScreen.ts`, `customizeSources.ts`, `customizeText.ts`), `core/CampaignVisit.ts`, which it shares with the Crew screen, and the developer screen's launcher, `screens/developer/CustomizeLauncherSection.ts`. Specs: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 1.2 (Customize) and [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Decks and the locker, At load out), and the wireframe `docs/design/supply-runs/customize.png`. Registered as `customizeScreen`. Builds on [crew-screen.md](./crew-screen.md), whose `DeckBuilder` it reuses, [run-decks.md](./run-decks.md), whose moves it calls, and [mini-card.md](./mini-card.md), whose +N, HOME, and LOCKED states it shows.

## Context

Run decks had their rules (`moveCards` with a run deck at one end, `moveEscortCard`, `resetRunDeck`, a typed blocker for each refusal) and the Crew screen had built its deck and locker as a `DeckBuilder` with Customize in mind: per-entry keys, an optional pool note, controls disabled with no caption of their own. What was missing was the screen. Load out (DDB-320) is what opens it.

## Decisions

### The Crew screen's builder, with three sources over a run deck

The screen is a `DeckBuilder` with its own left column, header, and foot, and three sources in `customizeSources.ts` (the run deck, the locker, and the escort cards), which are the only code that touches the campaign. The left column is `DECK_BUILDER.sideWidth`, the Crew screen's roster's width, so the run deck and the locker get the Crew screen's widths and its three columns of entries at 1024 px, five at 1440 px. What the panel gained for Customize knows nothing of campaigns: a pool kicker that can change, an entry's `focusHeir`, and no control row on an entry with no controls.

### A card in three stacks, each control asking the rules for its own copies

A run deck holds a card's own copies going (`own`), its copies borrowed (`borrowed`), and its own copies left at home (`leftHome`), never a card both borrowed and left at home. Each is a stack of its own, keyed `<card>`, `<card>-borrowed`, and `<card>-home` (card types are snake case, so the hyphen can't collide), plain, dashed with +N, and faded with HOME. The builder sorts by card and then key, so a card's +N or HOME stack sits right after its own.

Each stack has one-fewer and one-more (`-` and `+`; the icon atlas has a remove glyph but no add), each a `moveCards` between the run deck and the locker that names the copies it moves (`CardMove.copies`, [run-decks.md](./run-decks.md)):

| Stack | One-fewer | One-more |
| --- | --- | --- |
| Own | one of the driver's own stays home (`own`) | one comes back from home (`home`) |
| +N | a borrowed copy goes back to the locker (`borrowed`) | another is borrowed (`borrowed`) |
| HOME | another of the driver's own stays home (`own`) | one comes back from home (`home`) |

Every control asks `getCardMoveBlocker` for its move and shows `cardBlockerReason` under the card when the rules refuse it, so the screen restates none of the move order: "Borrowed go first" on the own stack's one-fewer while that card's borrowed copies are in (they go back before the driver's own stay home), "Yours at home" on Borrow for a card the driver left some of their own at home (they come back before anything's borrowed), and "Deck at minimum", "Deck full", "None left", "Other seat has it" as on the Crew screen. The rules check the locker before the deck limits, so a +N stack at a full deck whose card the locker has run out of says "None left". One refusal says nothing: the run deck itself holding no such copy (`too_few` on the run deck), which is a full stack's one-more, as on the wireframe, and HOME's one-fewer once all the driver's own are home. The stack's count already says it, and the line stays free for a reason that tells the player something.

The locker is `campaign.locker`, which already lacks what the other seat borrowed. A card for another archetype is faded and says whose it is, as on the Crew screen, by the rules' `isForOtherArchetype`, which the two screens share.

Rejected: one stack per card with its +N or HOME tag on it, which can't show three copies going and two at home at once; controls that run the rules' default move from any stack, which make pressing one-fewer under the plain stack shrink the +N stack beside it; and a screen-side table of which control is live, which restated the move order and drifted from it.

### The left column

The driver card (CUSTOM once the run deck differs from the default deck, `RunDeck.isCustomized`, its DECK figure the run deck's size), the vehicle, a line saying whether the run deck still matches the default deck and how it differs, Reset to default, and the escort cards. Reset is `resetRunDeck`, live while there's something to undo and `getResetRunDeckBlocker` lets it, so the button and the guard behind it ask the rules the reset itself asks. Escort cards are a `CardEntryGrid` of their own, keyed by the escort that brought each, LOCKED, each with the wireframe's "Give to driver 2" (`moveEscortCard`), disabled with the rules' reason if either driver is away; it fits a 96 px entry with 20 px to spare, which a test measures. On a run of one there's nobody to give one to, so an escort card there has no control and no row for one. While the cards load, or after they fail, the escort cards' place says so as the run deck and the locker do. The column scrolls, since four escorts' cards are more than 1024x600 holds, and a secondary click on any card in it pins its detail view, the driver's included, as on the Crew screen's roster.

### The header and the foot

Three chips, "RUN DECK 12/20", "BORROWED 1", and "LEFT HOME 2", on one row at 1024 px. The wireframe's ", MIN 8" adds 50 px, which pushes the third chip past the run deck panel's 335 px there onto a second row, and "Deck at minimum" says the minimum where it matters. The engine has no dashed border, so BORROWED is a solid chip like the others. The foot is the wireframe's line on what borrowing risks. There's no cost curve: the wireframe has none, and the run deck's room goes to the cards. The locker's kicker is "Copies the other seat hasn't borrowed" with two seats, and "Spare copies, free to borrow" with one.

### Loaded, saved at each step, and shown on the campaign's change

The Crew screen and Customize load the campaign and the cards, checkpoint each step, and say a failed save the same way, so that's one `CampaignVisit` they both hold, and the card loader's lookup (`loadedCardLookup`) sits beside the card loader. A visit starts on mount and stops on unmount, and an answer from an earlier visit changes nothing. Every control checkpoints after its move, the screen shows the campaign again on its `change`, never a record's, and a save that fails says so under the top bar until a later one lands.

### Opening and leaving

Opened with `{ campaign, driver, returnTo, returnData }`, the screen shows that driver's run deck at once. Done goes to `returnTo`, the compound when it's left out, with `restoreFocus`, handing back `{ ...returnData, campaign }`, so load out gets back whatever it handed over to keep (its run summary, say) and the campaign as it now is, and focus lands on the seat's Customize. Opened with nothing, as the screen captures do, it loads the save as Continue would and shows the first seat. With no run out it says so in place of the run deck and the locker; a driver handed over who isn't seated says that instead. A campaign that's over never has a run out ([campaign-end.md](./campaign-end.md)), so there it says "Campaign over." and how the compound fell (`fallMessage`). Every check the controls ask names the end first, so "Campaign over" would show under any control the same way, as on the Crew screen, and Reset is off.

The data can also carry a `store`, which this visit saves into in place of the screen's own. The developer launcher uses it to open the screen on the test campaign without writing over the player's save; load out has no use for it.

### Focus and keys

Focus starts on Done. Tab goes Done, the driver card, Reset, the escort cards, the run deck, the filter, the locker (R9.18). Each grid is one focus group (R9.29): Left and Right walk minis and controls in reading order, Down from a mini goes to its first live control (one-more on a HOME stack) and Up back (R9.26). The grids keep focus as the Crew screen's do: a control that a move disables hands focus to its mini, an entry that goes hands it to the same part of the entry now in its place (a card's last own copy left at home lands on its new HOME stack), and the escort grid, emptied, hands it to the driver card. A +N or HOME stack names its card as its `focusHeir`, so when one empties, focus lands on that card's plain stack, or with none left, on the mini, never a control, of the entry now in its place: pressing Enter twice on a Medical Kit +1's one-fewer can't leave a Ramming Speed at home on the second press. Reset, disabled by its own press, hands focus to the driver card above it rather than letting R9.28 drop it. Escape is Done, unless a pinned detail view takes it first; I and a secondary click pin a card's detail view.

### A developer way in

A developer section, `customize`, opens the screen on the store fixture's run, either seat, saved into memory, with Done coming back to the developer screen. In the gallery, where it's a scene with a golden and the lint gate like every section, and no screens are mounted, its buttons do nothing.

## Provisional calls

Each is the simplest reading where the spec or the wireframe leaves the call open.

- Each stack's controls move that stack's own kind of copy. The own stack's one-fewer says "Borrowed go first" while that card's borrowed copies are in, and HOME's one-fewer leaves another of the driver's own at home.
- A full stack's one-more, and HOME's one-fewer with none of the driver's own left, are off with nothing said.
- Borrow says "Yours at home" for a card the driver left some of their own at home.
- A +N or HOME stack that empties hands focus to its card's plain stack, else to the mini in its place.
- On a run of one, escort cards have no control, and the locker's kicker reads "Spare copies, free to borrow".
- No "Back to load out": every change is saved as it's made, so Back would do what Done does. Done sits at the top right, as on the wireframe, and Escape is Done.
- Done goes back to the screen the opener names, the compound by default, with what it handed over to hand back and the campaign.
- Opened with no driver, the screen shows the first seat.
- Reset to default takes one press, with no confirmation: it undoes this run's changes and destroys nothing.
- The chips leave the minimum out, BORROWED isn't dashed, and the locker's kicker is "Copies the other seat hasn't borrowed", since the wireframe's "free copies, after driver 2's run deck" is cut off at 1024 px.
- The driver card shows CUSTOM once the run deck differs from the default deck, and no seat tag, since the column's title says the seat.
- No cost curve under the run deck.

## Consequences

- Load out (DDB-320) navigates to `customizeScreen` with `{ campaign, driver, returnTo, returnData }` and gets `{ ...returnData, campaign }` back. `RunDeck.isCustomized` is its CUSTOM tag's test.
- The screen captures are `customizeScreen` over the fixture's run (seat 1: a card left at home, one borrowed, an escort card) and `customizeScreen-full`, a 20-card run deck with both escorts' cards beside the full locker (`fullRunCampaign`), each at both sizes, and the `customize` gallery scene. A locker of 44 kinds is in the Jest lint test, with made-up cards, and so are a run of one, no run out, a campaign that's over, no save, and cards that don't load.
- Nothing new is saved, so `CAMPAIGN_SCHEMA_VERSION` stays where it was.
