# Event stops: events as data, and the event screen (DDB-45)

Date: 2026-10-18. Code: `src/renderer/game/campaign/Events.ts` (the model), `src/renderer/game/data/events.json` (the content), `src/renderer/game/screens/event/` (`EventScreen`, `ChoiceCard`, `JournalPage`, `EventPlate`, `EventIcon`, `eventText`), and `src/gallery/scenes/EventScenes.ts`. Specs: [Game Flow and UI](../specs/Game%20Flow%20and%20UI%20Specification.md) 5 and 7.0, [UI Art Direction](../specs/UI%20Art%20Direction.md), [Runs and Encounters](../specs/Runs%20and%20Encounters.md) (What a stop can be).

## Context

Most stops that aren't fights (wrecks, distress signals, checkpoints, finds, hazards) resolve as a short scene with a choice. Game Flow 5 describes the page: an illustration, a setup and a situation, and choices drawn as cards with risk and reward icons, some locked by what the party lacks. Nothing in the run could show one yet; the run screen treats a calm stop as a quiet stretch.

This item builds the content format and the screen, and stops there. The run loop (`campaign/SupplyRun*.ts`, `screens/run/`) is another session's, and it hooks event stops up once both land.

## Content is data, outcomes are data

An event is a JSON object: an id, the stop type it resolves, a title, an illustration key and caption, the setup, the situation, and two to four choices. A choice has a title, a hint, what it needs (an archetype, a card in a run deck, an escort), what it costs, its danger (0 to 3 skulls), and one to four weighted outcomes. An outcome is text plus what it gives or takes: resources (signed), settlers, cards for the locker, the reward picker, an escort, drivers, structure, HP, extra hours, and a fight to hand off with what winning it gives.

Options considered for outcomes:

- Effects as a list of typed objects (`{ "kind": "resources", ... }`), the shape card effects use. Open-ended, but verbose to write, and an outcome would need its own rules about repeats and order.
- Effects as optional fields on the outcome. Each kind once, in a fixed order, read into a normalized record with every field present.

Fields won. The reader (`readEvents`) normalizes them into `EventOutcome`, so the run applies a record with no optional parts, and `EventResult` (the event, the choice, its cost, the outcome landed on) is plain JSON the run can save with its step. Settlers are written as `settlers` but carried as `resources.people`, the store they land in.

The reader is strict, as the stop tables' is: an unknown field, a missing one, a value out of range, a text over its cap, a card cards.json doesn't list or that is an escort's signature card, or an event with no free choice throws as the module loads, naming its path. The text caps are what the journal and the choice cards hold at 1024x600; the screen's layout test lints every shipped event and every outcome at both gate sizes against them.

`Events.ts` is pure. It never touches a campaign: `choiceLock` says why a party can't take a choice, `resolveChoice` checks the lock and lands a draw on an outcome, `landOutcome` lands it with no lock check (for a saved step rebuilt after its cost is paid), `choicePreview` is what a card shows, `pickEvent` picks a stop's event, and `eventParty` reads the party off a campaign with a run out.

A card shows the most hours any of its outcomes takes, and its skulls are written per choice rather than worked out from the outcomes: the card hints at the risk without saying which outcome lands.

## The screen

`EventScreen` is an atlas sheet (UI Art Direction): the plate on the left, the title and the journal beside it, and the choices along the foot as cards. Taking one swaps the cards for the outcome: a legend box with what happened and a ledger of what it gave and took, any cards or escort it gave drawn as cards with their detail views, and the highway (Drive on, or Fight them).

- The journal is a ruled page (`JournalPage`): W1 paper, a printed margin rule in stronghold red, and river-blue rules at the text's pitch, paragraphs a line apart so every line sits on a rule. It fills its column, which a short setup otherwise leaves as an empty frame. Its type is 17 px where the window is at least 800 tall, 14 below.
- A choice card (`ChoiceCard`) is atlas card stock with 7 px corners: an index band with what it needs (or, in stronghold red, why it's locked) and its number key; the title in display 700; the hint; and two rows of icons, the risks (swords for a fight, skulls, costs in red, hours) and what it can give (in sage). Its text parts move with the face on a hover's lift and a press.
- A card that can't be taken is one of the art direction's two states. Locked, for a need the party lacks (an archetype, a card, an escort): the rust hatch over it, the label clean, the band naming the need. Unavailable, for a stores shortfall: faded print, a dashed border, the title struck through as Game Flow 5.2 has it, and the band keeping a met need beside the shortfall ("Mechanic / Need 8 scrap, have 5"). Both are disabled, so neither takes focus or a press.
- The outcome's ledger gives each line a tone: gains in sage, costs and losses in stronghold red. An outcome with the reward picker labels the highway Pick a card.
- The icons (`EventIcon`) are flat strokes on the stores' 18 px grid until the UI art atlas holds them; the stores' own come from `drawResourceIcon`, factored out of `ResourceStrip`.
- The plate (`EventPlate`) is a stand-in until event art is painted: a road on its casing across contour lines, and the stop's scene in ink (a distress signal's rings in stronghold red), scaled to the plate. Grease pencil is the player's, so neither the plate nor the journal uses it. An event's `illustration.art` names the piece the painted plate will be.

### Plain data in, callbacks out

The screen takes the event, the party, the draw, and optionally a result to reopen on (a saved step mid-event, rebuilt with `landOutcome` from its event, choice, and draw; the party isn't needed then). It reports through two callbacks: `onChoose` with the `EventResult` as the choice is made, so the run applies and saves it before anything else happens, and `onDone` on the highway. That's the opposite of load out's call (data, not callbacks, [load-out-screen.md](./load-out-screen.md)), on purpose: load out owns its departure, but the event screen is a step inside the run, and applying the result belongs to the run loop. With no callbacks, as the gallery and the screen capture open it, Drive on returns to the main menu. Opened with nothing at all, it shows the first event with a stand-in party (`STAND_IN_PARTY`).

## Provisional calls

None of these is in a spec. They're calls 250 to 259 in [gameplay-calls.md](../gameplay-calls.md).

- 250: a choice is taken when it's pressed, with no confirm.
- 251: costs are paid from the stores and the run's cargo together, the cargo first.
- 252: structure and HP outcomes hit every seated driver's vehicle and every seated driver.
- 253: the outcome lands on a draw from the run's stream for the stop, so a reload lands the same.
- 254: every event has a choice that needs and costs nothing.
- 255: a hand-off's outcome gains apply before the fight, the gains on its fight on a win only, and a loss is any stop fight's loss.
- 256: settlers ride home in the cargo; drivers are new recruits who join the pool when the run gets home.
- 257: a card requirement is met by either seated driver's run deck, escort cards included, never the locker.
- 258: a stop picks its event evenly among its type's.
- 259: event losses stop at 1 HP and 1 structure, and at 0 of a resource, cargo first.

## What the run's hook-up has to add

These sit in the run loop's files, which this item doesn't touch. DDB-535 added them for wrecks and distress signals ([event-stops-on-a-run.md](./event-stops-on-a-run.md)), the escort's mid-run join aside.

- A `RouteStop` keeps only fight or quiet today, so the run has no stop type to hand `pickEvent`. It needs the map's type, which the strict stop reader makes a save change.
- An escort gain needs the convoy's add (`createEscort`, `Convoy.add`), its signature card dealt into a run deck's escort cards, and, with four already, a step to dismiss one (Game Flow 5) before driving on.
- Drivers an event gives need somewhere to wait for home (the run keeps only missing drivers it found), and a rule for their archetype.
- Hours do nothing until the run keeps an hour of day; today only the planning screens know home-by and dark.
- The reward picker (`cardPick`) and an event's fight both need an entry into the run's reward phase and stop fight that doesn't assume a fight stop.
- `onChoose` is synchronous. The run can save in it and pass its checkpoint on through `onDone` to the run screen, which already shows a step that couldn't be saved.

## Trade-offs

- Callbacks in the navigate data can't survive a save; the run has to rebuild them when it reopens a step, from the saved `EventResult`.
- Fields for effects cap an outcome at one of each kind. Nothing in Game Flow 5 needs two, and a list can replace the fields later behind the same normalized record.
- Five events, three wrecks and two distress signals, is enough to build against and too few to play long. Checkpoints, finds, and hazards need only content and the run's hook-up.
- The plate stand-in draws one wreck shape for every wreck; telling the tanker from the bus waits for the painted plates.
- New goldens (the event screen at both sizes and six gallery scenes) come from the Visual workflow's mint, as every baseline does.
