# Driver card: a person's card, its tags, and its detail view

Status: decided 2026-10-07, DDB-312 (epic DDB-277). Design source: [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) section 7.0, "Drivers and escorts are cards too", and the "Card sizes" board (`docs/design/supply-runs/card-sizes.png`); where driver cards get used: sections 1.2 (load out), 3.2 (Crew), and 6.1 (debrief), and [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md), "The driver pool".

## Context

Section 7.0 makes drivers cards: 104x146, squarer corners, a riveted double frame no play card has, with a portrait, the name, the specialty, an HP bar, the hand limit, the deck size, and a status tag (injured, seated, lost, new, custom). A driver card opens its own detail view on hover, focus, or a touch hold: their full stats and their deck. The Crew roster shows every driver in the pool and the ones lost on runs; load out shows a card in each seat and the whole pool, faded where a driver can't go; the debrief shows who came home and who didn't. Load out's pool sits beside dozens of mini cards, so a driver card has to be as cheap as a mini.

Each screen has its own idea of a driver: the campaign's driver record at the compound (`campaign/DriverRecord.ts`, DDB-282), a seat and a run deck at load out, who came home at the debrief; the combat `Driver` is a fight's state. Driver names are open (DDB-318); the campaign model calls them "Road Warrior 2" for now.

## Decisions

### A plain view-model, mapped by each screen

`DriverCard` shows `DriverCardData` (`game/ui/driverCardData.ts`): the name, specialty, HP and its maximum, hand limit, and the deck as copies by card type, the shape the campaign keeps decks in, so a record's deck passes straight through. Optional fields feed the detail view: the vehicle, the skills, and a note. The deck size isn't a field; it's the deck's count, so the two can't disagree.

`driverCardData({ archetype, ...overrides })` fills it from `DRIVER_CONFIGS` and takes whatever the caller's model says instead. The gallery and the tests use it bare; a screen mapping a campaign record passes the record's name, HP, hand limit, and deck and takes the specialty, vehicle, and skills from the archetype.

Considered: taking the campaign record or the combat `Driver`. Either would tie the card to one screen's model.

### Status is the card's, not the driver's

Where a driver stands is set on the card, not in the data, as a mini's state is: the same driver shows SEAT 1 on load out's pool card and no tag on the seat's own card, on one screen at one moment. `status` is one of `injured`, `lost`, `new`, `seat1`, `seat2`, or null, and `customDeck` and `unavailable` are flags beside it. All three are setters, so a screen moves a tag or a fade in place as the player seats and clears drivers.

### Two tags rather than a combined one

Load out's pool can show a seated driver whose run deck is customized. The card shows two tags then: the status tag at the corner, where a mini's tag sits, and CUSTOM to its left, 3 px apart. Both are the mini card's `StatusTagDraw`, which gained a settable `right` and its measured `width` so a second tag can stand beside a first.

Why two:

- They're two facts that change apart. The seat comes and goes with Seat and Clear seat, CUSTOM with Customize and Reset to default.
- The seat tag stays at the corner whether or not the deck is customized, so a scan along the pool finds SEAT 1 and SEAT 2 in the same place on every card.
- Each tag stays one word in the tag's own style; a combined "SEAT 1 · CUSTOM" would need a separator the tags don't use and a phrase per pair.
- They fit. The widest pair, CUSTOM beside INJURED, is about 95 px of a 104 px top edge.

A seat's own card shows CUSTOM alone, at the corner.

### What fades, and why lost always does

A faded card is the face's disabled look, through colours rather than opacity, as a faded mini's is, and it stays enabled, focusable, and inspectable. `unavailable` fades a card with no tag of its own: the reason goes on the consumer's control under the card ("Same archetype as a seated driver"), as for minis. A lost driver's card is always faded, since a lost driver can't be picked anywhere. An injured driver isn't faded by the tag alone: at load out they can't go, so load out sets `unavailable` too, while the Crew screen leaves them at full strength because their deck can still be worked on (the boards show both).

A lost driver's card can say how they went ("KILLED DAY 9", the board's lost card) in the specialty's place, through the data's `note`; the detail view shows both.

### The face

Laid out from the board in its own pixels, everything inside the corner rivets: the portrait across the top; the name at 13 px condensed on up to two lines, then an ellipsis; the specialty; the HP figures in a box sized for "40/40" with the bar to their left; the hand limit at the left of the foot and the deck size at the right. The name always takes two lines' room, so in a row of cards the specialty, the bars, and the foot line up whether a name wraps or not, as the board's do. Names are shown as they're given.

- The frame is two lines in the dim line, 2 px and 1 px with a 2 px gap, on corners of radius 2, and a rivet in each corner a step brighter. Hover and keyboard focus turn the outer line the interaction yellow; selection (the Crew roster's chosen driver) turns it bright yellow at 3 px. The inner line and the rivets stay, so a selected card still reads as a driver's.
- The specialty is the condensed display face at 10 px, tracked. The board's mono doesn't fit SUPPORT SPECIALIST in the 82 px between the rivets at a size anyone can read: it's 106 px at the tag's 9.
- The HP bar is the driver HP hue the road uses (`DRIVER_HP_COLOR`, now shared with `Vehicle`), on a dark track outlined in the card line, so an empty bar still shows its length.
- No portrait art exists. The placeholder is in the card art placeholder's style: the unowned art strip's gradient, with a head and shoulders in the art glyph's bone where the glyph would be, fainter since they're solid.

Considered: the board's centred names (the Crew wireframe's). The "Card sizes" board and load out's both left-align, as the mini does.

### The detail view

`DriverDetailView` heads with the person: the portrait beside the name on up to two lines, and the vehicle and specialty on one line under it ("Lightning Bike / AGILE STRIKER"), as the Crew wireframe's header writes them. Then the stats: HP as figures and a bar, then the hand limit and the skills (ramming, gunnery, evade, and speed, which adds to the vehicle's), flowed in rows. A rule, then the deck as mini cards stacked to their copies, cheapest first and then by name as the Crew wireframe orders them, spaced by `MINI_GRID`; then a foot with the note at the left, cut short of the pin hint at the right. It wears the card's riveted frame and the play card detail view's shadow.

The deck takes as few rows as seven columns allow, its kinds spread evenly across them, never under four columns and never over three rows: a starting deck's four or six kinds sit in one row, nine kinds in rows of five and four, and twenty in three rows. A run deck can reach 24 cards, its 20 and the signature cards of up to four escorts, all different at worst, so past 21 kinds the columns grow instead of a fourth row: 24 kinds are three rows of eight, 798 px wide. The view is as wide as its columns, which it knows before it lays out, so the inspector places it then. Its minis take no pointer: it's a view to read.

On a 1024x600 screen the tooltip service has 582 px for the view: 600, less the 10 it rests above the bottom edge and its own 8 px gap at the top. Three rows of minis take 382 of that, so nothing optional adds a row. A note sits in the foot rather than the head, the vehicle and specialty share a line, and the gaps between sections are 10 px. With a two-line name, the view is 575 px. A view that still doesn't fit, on a smaller screen, shrinks into the room: the service sizes the surface to the room it has, and `InspectSurface` scales the view down to it rather than growing back past it at the next layout.

It opens on the play card's path: `makeDriverInspectable(card, { cards })` gives the card a tooltip factory that builds the view each time it opens, resting on the screen's bottom edge, centred over the card, and clamped inside the screen; hover, keyboard focus, and a touch hold open it, and a secondary click or I pins it. A pinned view is pinned again when the card's data changes, which builds it from the new data. `cards` is the screen's card lookup, since game UI doesn't reach for the card loader; a type it doesn't know is left out. The wiring is `makeDetailInspectable(owner, open)`, which the play card's `makeInspectable` uses too: `open` builds the surface and says where its left edge goes. `inspectOnContextMenu` and `inspectHotkey` find an owner by its tooltip pinning, which only an inspect view's does, so the escort card (DDB-313) needs nothing new there. `CardInspectSurface` is one case of a shared `InspectSurface`, `DriverInspectSurface` another.

Considered: the play card's 250 px detail view with the deck in two columns. Six kinds would take three rows of minis and a tall narrow view; the wide one covers less of a short screen.

### As cheap as a mini

Every draw is built once and recoloured or moved in place, and a frame hands the draw API the same objects each time. The tags are measured when their text changes and on no other layout, and new data re-measures only the words that changed. A card draws its frame, inner line, four rivets, the portrait's three shapes, the bar's two, and a tag's two, all inside the uber shader's batch. The tags reach 7 px up and 4 right (`DRIVER_CARD_INK`), so driver cards spaced by `MINI_GRID` clear each other's tags as minis do. The tests check the object reuse and the single measure.

## Consequences

- The API the Crew screen (DDB-314), load out (DDB-320), and the debrief build on: `new DriverCard({ data, status, customDeck, unavailable })` and the setters of the same names, `selected` for the roster's ring, `onSelect`, `focusable`, `makeDriverInspectable(card, { cards })` with `inspectOnContextMenu` on the container, `driverCardData` to map a model, and `DRIVER_CARD_SIZE` and `MINI_GRID` to lay cards out.
- A dead driver's record keeps an empty deck (DDB-282), so the Crew screen's lost cards read DECK 0 unless the record keeps the deck they died with; the debrief has the run deck.
- Three gallery scenes: `driver-cards` (the board's four states, then new, injured at the compound, seat 1, seat 2 with CUSTOM, that seat's own card, and unavailable), `driver-detail` (a starting deck in one row), and `driver-detail-pinned` (a campaign deck of nine kinds in two rows, pinned). All three are in the lint gate at 1440x882 and 1024x600; the new developer sections move the developer screen's scroll thumb.
- The escort card (section 7.0's other row) can take `StatusTagDraw` the same way, and `InspectSurface` for its detail view.
