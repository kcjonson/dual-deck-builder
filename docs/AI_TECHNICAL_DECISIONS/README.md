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
- [map-params.md](./map-params.md): the area map's parameters in code: one table, environment defaults with explicit overrides, presets that hold only overrides, the validator's combination rules, and triangular rolls on a stream per parameter (2026-10-06)
- [mini-card.md](./mini-card.md): the 80x112 mini card as a size of `Card`: stacks and states as the card's own draws, `MINI_GRID` spacing, the status tag, the card's own focus ring and hit area, and driver selection's two-row decks (2026-10-06)
- [campaign-state-model.md](./campaign-state-model.md): the campaign and driver record models, checked on every change; driver ids from a saved counter; card-type counts for decks and the locker; the strict, versioned save JSON, with map params repaired on load (2026-10-06)
- [terrain-fields.md](./terrain-fields.md): the terrain stage: in-repo simplex noise with exact derivatives, the field model and calibrated shares, biome thresholds, the start, sites, slope and cost, rough islands that keep the land connected, and the water seam (2026-10-07)
- [campaign-founding.md](./campaign-founding.md): founding a campaign from a seed and the unlocked archetypes: params rolled or given and validated, the generator's slot and the map stand-in, the starting pool dealt on its own stream, starting values in a data file, and day 1 at dawn (2026-10-07)
- [ai-draw-value.md](./ai-draw-value.md): the AIs value a draw by the cards that fit under the drawer's hand limit, through one estimate on the rule `Driver.drawCards` keeps by, against the player's hand less the played card; why planned draws aren't counted (2026-10-08)
