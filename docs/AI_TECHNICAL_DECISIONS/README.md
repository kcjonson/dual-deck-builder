# AI Technical Decisions

This folder contains detailed documentation of significant technical decisions made during the development of Wasteland Wheels.

## Purpose

Each file in this directory documents a major architectural or implementation decision, providing:
- Context and problem statement
- Options that were considered
- The decision that was made
- Rationale for the decision
- Trade-offs and consequences

## File Naming Convention

Files should be named descriptively to indicate the decision topic:
- `coordinate-system-design.md`
- `input-handling-architecture.md`
- `scrollable-panel-implementation.md`
- `text-rendering-approach.md`

## Template

When creating a new technical decision document, use this template:

```markdown
# [Decision Title]

## Date
YYYY-MM-DD

## Context
What problem were we trying to solve? What constraints existed?

## Options Considered
1. **Option A**: Description
   - Pros: 
   - Cons:
   
2. **Option B**: Description
   - Pros:
   - Cons:

## Decision
What was decided and how it will be implemented.

## Rationale
Why this option was chosen over the alternatives.

## Consequences
- What are the trade-offs?
- What becomes easier or harder?
- What risks are introduced?
- What technical debt might accumulate?

## Implementation Notes
Any specific implementation details or code examples.
```

## Index of Decisions

_This section will be updated as decision documents are added._

- [battle-screen-road-model.md](./battle-screen-road-model.md): the combat screen's road grid, the rules calls made with it, and short and full card text (2026-09-25)
- [resource-layer-and-viewport.md](./resource-layer-and-viewport.md): texture ownership, metered uploads and context-loss recovery; the single viewport owner and R15.4 sizing (2026-09-28)
- [deferred-engine-items.md](./deferred-engine-items.md): phase 7's deferred and optional engine items, each classified against the spec and decided not now (2026-10-02)
- [uber-shader.md](./uber-shader.md): the one-program uber shader, exact-coverage borders, premultiplied output and the clip as per-draw data; the phase 1 re-baseline and what moved (2026-09-28)
- [seeded-prng.md](./seeded-prng.md): sfc32, named streams forked by hashing (seed, name, attempt) with MurmurHash3, and the draw counts every generator stage depends on (2026-10-06)
- [map-params.md](./map-params.md): the area map's parameters in code: one table, environment defaults with explicit overrides, presets that hold only overrides, the validator's combination rules, and rolls split at the environment's value, each drawn on a stream of its own (2026-10-06)
- [mini-card.md](./mini-card.md): the 80x112 mini card as a size of `Card`: stacks and states as the card's own draws, `MINI_GRID` spacing, the status tag, the card's own focus ring and hit area, and driver selection's two-row decks (2026-10-06)
- [campaign-save-and-load.md](./campaign-save-and-load.md): the campaign store: saves kept per build and stamped with the save format version, with no migrations; one active save written whole through two slots and found the same way by every call; a history list kept apart; checkpoints at the end of each step; lineages that retire stale campaign instances; async storage over local storage with measured sizes and an 800,000-character budget; and damaged saves set aside rather than destroyed (2026-10-07, revised 2026-10-08)
- [campaign-state-model.md](./campaign-state-model.md): the campaign and driver record models, checked on every change; driver ids from a saved counter; card-type counts for decks and the locker; the strict save JSON, with map params repaired on load (2026-10-06)
- [campaign-state-model.md](./campaign-state-model.md): the campaign and driver record models, checked on every change; driver ids from a saved counter; card-type counts for decks and the locker; the strict, versioned save JSON, with map params repaired on load (2026-10-06)
- [locker-and-deck-rules.md](./locker-and-deck-rules.md): the deck rules kept inside `moveCards`, with a typed blocker the Crew screen shows and the move throws; size limits checked by direction, not on the record; eligibility read from the bundled cards.json; scrapping locker copies; and the provisional calls on limits and scrap (2026-10-08)
- [driver-card.md](./driver-card.md): the 104x146 driver card: a plain view-model each screen maps onto, status set on the card, a seat and CUSTOM as two tags, what fades, the riveted frame, and the detail view of full stats and the deck as minis on the play card's inspect path (2026-10-07)
- [escort-card.md](./escort-card.md): the 80x112 escort card: `CardBase`, the plumbing every card shares; a plain view-model mapped from a type or a convoy escort; STAYING set on the card; the hazard-stripe header; and the detail view of the profile beside the signature card's face (2026-10-08)
- [terrain-fields.md](./terrain-fields.md): the terrain stage: in-repo simplex noise with exact derivatives, the field model and calibrated shares, biome thresholds, the start, sites, and slope (2026-10-07)
- [campaign-founding.md](./campaign-founding.md): founding a campaign from a seed and the unlocked archetypes: params rolled or given and validated, the generator's slot and the map stand-in, the starting pool dealt on its own stream, starting values in a data file, and day 1 at dawn (2026-10-07)
- [scroll-into-view-ink.md](./scroll-into-view-ink.md): scrolling a focused component into view brings in what it draws now (`revealInk`), not just its box, carried up through nested scrollers and their clips; the rule for ink or a box taller than the clip, and the reveal after the focus event and after a pending layout (2026-10-07)
- [ai-draw-value.md](./ai-draw-value.md): the AIs value a draw by the cards that fit under the drawer's hand limit, through one estimate on the rule `Driver.drawCards` keeps by, against the player's hand less the played card; why planned draws aren't counted (2026-10-08)
- [road-growth.md](./road-growth.md): stages 2 to 4 of the area map: irregular highway departures with drifting headings, outward growth scored by terrain, course, and kin crowding, a clearance that tapers at shared junctions, branching into open room, back roads degrading to trails, smoothing rechecked against every rule, the network as plain data, and the checks that hold it (2026-10-08)
- [realistic-map.md](./realistic-map.md): the area map redesigned as a road atlas: land from uplift and stream-power erosion with rivers, lakes, and ranges; settlements where the land puts them; a real road network of least-cost links with loops; routes as the quickest-way-home tree over it, POIs where its branches meet, splitting before halfway; generation at founding in a worker; saves that keep every drawn line; and what happens to the terrain, road growth, POI, and map view work (2026-10-08)
- [combat-bridge.md](./combat-bridge.md): a supply run's fights built from the campaign's records and escorts, and each result written back in one order: HP and vehicle damage, drivers revived or picked up after a win, dead or missing after a failed run, the convoy, and the haulers' dividends as the run's cargo; its provisional calls (2026-10-08)
- [day-clock.md](./day-clock.md): the end of a day as one pipeline over the campaign's public API: upkeep, shortfalls costing people and unrest, healing, and the map's stop and POI hooks as pure steps, stored whole or not at all; the needs forecast; the rules in a data file; and the provisional calls it builds to (2026-10-08)
- [main-menu-campaigns.md](./main-menu-campaigns.md): the main menu's campaign entries: the save loaded on mount for Continue's line and handed on, Continue disabled with its reason as text, New Campaign asking first and ending a campaign in progress as abandoned before the new save, Campaign History as its own screen, and goldens over saved campaigns (2026-10-08)
- [injuries.md](./injuries.md): drivers home below max HP injured for days scaled by the HP missing, the night home counting as the first; one step for a day off, by night or by meds; the meds action and load out's seat check, each with a typed reason; the infirmary's values in compound-rules.json; and its provisional calls (2026-10-08)
- [map-pipeline-worker.md](./map-pipeline-worker.md): the area map's pipeline runner, stages on nested streams with their own checks, the accept hook, per-stage attempts, escalation to an upstream stage, map restarts, and local retries, and a typed give-up that founding answers with the next seed; today's stages through it; generation in a worker per generation, the map packed into transferred typed arrays, the eroded land among them, bundled by webpack 5's worker syntax for the web build and the Electron renderer; the in-process fallback, the timings, and what a save needs from it (2026-10-09)
- [area-map-view.md](./area-map-view.md): the area map view: one component drawing through the draw API under a camera matrix, the terrain baked once on two coarse lattices with biomes classified per texel and cliffs from the interpolated slope, roads live with detail levels by zoom, knowledge as solid, pale, and dashed stubs, fog as a blurred wash, the typed inputs for the stages to come, and the draw calls and frame cost at radius 1600 (2026-10-08)
- [run-decks.md](./run-decks.md): run decks: the default deck emptied into the run deck at load out, going or left at home, beside what's borrowed; a run deck as a `CardPlace`, with `already_borrowed`, `card_locked`, and `on_run`; escort cards locked, outside the limits, and checked against the convoy; unwinding, where the dead lose what went with them; the bridge dealing from run decks; cards won as cargo; and the provisional calls (2026-10-09)
- [cards-won.md](./cards-won.md): cards won as cargo on the road; new copies checked against the bundled cards.json, signature cards refused; arrival as one call that unwinds the run decks then unloads the cargo into the stores and locker; a failed run losing its cargo with a log line; run ids from a saved counter, so a party from an earlier run can't end a later one; no run ending while a fight is open; the debrief over the Crew screen's own move; the garage's paid locker deposit; and the provisional calls (2026-10-09)
- [solo-driver-fights.md](./solo-driver-fights.md): fights with one driver, for a run down to its last: a player team of one or two driven vehicles, a vehicle carrying on unmanned counted as its driver's in a new team, what leaned on a partner and what each does without one, the player-side AIs playing escort-target orders, passengers playing their orders, and the battle's card check asked before a card is offered, the bridge seating one and only the run's drivers, the dock's empty seat, and the provisional calls (2026-10-09)
- [compound-screen.md](./compound-screen.md): the compound hub: the buildings, the Area map, and Plan a supply run disabled with their reasons as text; Rest ending the day and checkpointing it; the needs panel's forecasts, injured drivers, and rumors; the fall handed to the defeat screen once its end is saved; focus and Escape; and the provisional calls (2026-10-09)
- [terrain-erosion.md](./terrain-erosion.md): the area map's land from uplift and erosion: a grid a fifth wider than the disc, range belts along one grain covering `mountainCoverage` by quantile, Braun and Willett's implicit stream power run coarse then fine, priority-flood drainage by steepest descent with ties by index and water levels, outlets on the edge or a closed basin, elevation on a fixed scale, monotone dry terraces applied as the terrain is sampled, a metro lowered by grade with its ways out kept open and its water filled, the drainage kept as plain data for the water stage and sent across the worker boundary, the determinism lint, timings at four radii, and its provisional calls (2026-10-09)
- [crew-screen.md](./crew-screen.md): the Crew screen, opened from the bunkhouse: the roster as one focus group with the lost below, the chosen driver's deck and the locker as a `DeckBuilder` that Customize reuses with its own `CardSource`s, each control's reason worded from the rules' blocker codes, entries keyed and reconciled in place with focus kept when a control disables, an entry goes, or a grid empties, Scrap in two presses, three columns at 1024 px, a checkpoint after each move, and the provisional calls (2026-10-09)
- [water-and-biomes.md](./water-and-biomes.md): the area map's water stage: moisture before the rivers and rain from it, the land routed again with noise under a hundredth of grade so flats stop draining in ruler lines, rivers traced main stem first and drawn as smoothed, resampled lines that always wander a little and meander on flat ground, with a width by drainage area, and hold the water, reservoirs flooded upstream of a dam's wall to a drawn size and held below the lowest saddle, and natural lakes in the land's wet pits, read off a depth field, wetness, low ground calibrated per map, and canyons from the nearest water, biomes on the new fields with the colour a blend, rough country from eroded slope with an exact flood fill on the land grid and cliffs on its averaged grade at main's share, craters kept off the drainage, the cost of a move by grade, side slope, and bridges, old growth on it, the water across the worker boundary, rivers drawn live, timings at four radii, and its provisional calls (2026-10-09)
- [scavenging-party.md](./scavenging-party.md): the scavenging party on foot: a haul of fuel and scrap rolled from the day's own stream, stored in the day end's one `set` at dusk before upkeep, refused once People is 0 or while a run is out, fuel's floor of 1 in the rules as the no-soft-lock guarantee, the tests that sweep it, and the provisional calls (2026-10-09)
- [campaign-end.md](./campaign-end.md): the campaign's end: death held permanent on the record, a missing driver found on a run coming home with it, the campaign lost when a failed run leaves nobody at the compound or a night leaves no People, how the compound falls by its stores and unrest, the end as one checked set that closes the campaign, its records, and its convoy to every change, with the checks saying so, saved and ended in the store by the next checkpoint with one history line, the tally and stats the defeat screen reads, and the provisional calls (2026-10-09)
- [customize-screen.md](./customize-screen.md): Customize, one seated driver's run deck on the Crew screen's `DeckBuilder`: a card's own, borrowed (+N), and left-at-home (HOME) copies as keyed stacks, each control a move for its own stack's copies that the rules refuse with their own reason, focus handed to a card's own stack when a +N or HOME stack empties, Borrow and the locker after the other seat, escort cards given across, Reset to default, the load and checkpoint it shares with the Crew screen, Done back to whoever opened it with what they handed over, a developer launcher that saves into memory, and the provisional calls (2026-10-09)
