# AI Technical Decisions

One record per significant decision about how Wasteland Wheels works: the context, the options, what was picked and why. Game rules live in [../specs/](../specs/); these say how the game carries them out.

The records come from the TypeScript proof of concept. The ones here still describe the game; the C++ alpha can change any of them, and when it does, the record changes with it. Records about the TypeScript engine, its ui framework and its tooling are in [_legacy/docs/AI_TECHNICAL_DECISIONS/](../../_legacy/docs/AI_TECHNICAL_DECISIONS/).

## Writing one

Name the file for the topic (`road-network.md`, not `decision-12.md`) and cover:

```markdown
# [Decision title]

## Date
YYYY-MM-DD

## Context
What problem were we trying to solve? What constraints existed?

## Options considered
1. **Option A**: description, pros, cons
2. **Option B**: description, pros, cons

## Decision
What was decided and how it will be implemented.

## Rationale
Why this option over the others.

## Consequences
The trade-offs: what gets easier, what gets harder, what it risks.
```

## Index
### Architecture

- [The rules core, opponents, and content packs](./rules-ai-and-packs.md)

### Campaign and the compound

- [Founding a campaign](./campaign-founding.md)
- [Campaign state model and its save format](./campaign-state-model.md)
- [Saving and loading a campaign](./campaign-save-and-load.md)
- [The campaign's end: death, missing drivers, and the compound falling](./campaign-end.md)
- [Compound campaign and the area map](./compound-and-area-map.md)
- [The compound screen, the campaign's hub](./compound-screen.md)
- [The day clock and the end of a day](./day-clock.md)
- [Injuries and the infirmary](./injuries.md)
- [The scavenging party](./scavenging-party.md)
- [The main menu's campaign entries](./main-menu-campaigns.md)

### Crew, decks and cards

- [Locker and default deck rules](./locker-and-deck-rules.md)
- [Run decks: copy, borrow, leave home, escort cards, unwind](./run-decks.md)
- [Cards won: cargo on the road, the locker at home, the debrief](./cards-won.md)
- [Hand limit as a per-driver stat](./per-driver-hand-limit.md)
- [The Crew screen, and the deck builder Customize shares](./crew-screen.md)
- [Customize: one driver's run deck](./customize-screen.md)
- [Load out: the screen between the run route and the road](./load-out-screen.md)
- [Driver card: a person's card, its tags, and its detail view](./driver-card.md)
- [Escort card: a vehicle's card, its staying state, and its detail view](./escort-card.md)
- [Mini card: a size of Card, with stacks and states](./mini-card.md)

### Supply runs and stops

- [MVP supply run: pick a route, drive its stops, fight, come home](./mvp-supply-run.md)
- [Stops on legs, route descriptors, and the run loop's routes](./stops-and-routes.md)
- [The route tree, legs, meeting points, POIs, and strongholds](./route-tree-and-pois.md)
- [Clearing: stop cooldowns and cleared POIs](./stop-clearing.md)
- [Event stops: events as data, and the event screen](./event-screen.md)
- [Event stops on a run: wrecks and distress signals](./event-stops-on-a-run.md)
- [Find stops: cards, supplies, and a driver](./find-stops.md)

### Combat

- [The battle state, its actions, and its events](./battle-state.md)
- [Battle screen road model](./battle-screen-road-model.md)
- [Combat bridge: fights from the campaign, results written back](./combat-bridge.md)
- [Combat log content: the record and the player's line](./combat-log-content.md)
- [Enemy intent planning](./enemy-intent-planning.md)
- [Enemy turn pacing](./enemy-turn-pacing.md)
- [Escorts](./escorts.md)
- [Heavy armor](./heavy-armor.md)
- [Movement cards: the swerve model](./movement-cards.md)
- [Raider waves and how fights end](./raider-waves-and-fight-ends.md)
- [Fights with one driver](./solo-driver-fights.md)
- [Slot targeting: picking a slot, and two-step plays](./slot-targeting.md)
- [Targeting preview: ranges, outlines, damage ghost, hit check](./targeting-preview.md)
- [Hand target preview and blocked cards](./hand-target-preview.md)
- [The split dock](./split-dock.md)
- [Road view](./road-view.md)
- [Vehicle token](./vehicle-token.md)

### AI

- [AI draw value and the hand limit](./ai-draw-value.md)
- [Intent-aware player stand-in](./intent-aware-stand-in.md)

### Area map generation

- [Seeded PRNG and named streams](./seeded-prng.md)
- [Map parameters in code](./map-params.md)
- [The map pipeline runner](./map-pipeline-worker.md)
- [Terrain fields](./terrain-fields.md)
- [Terrain from uplift and erosion](./terrain-erosion.md)
- [Water, biomes, hazards, and the cost of a move](./water-and-biomes.md)
- [Places and hazards](./places.md)
- [The road network: links and the graph](./road-network.md)
- [Realistic geography, a real road network, and tree-shaped routes](./realistic-map.md)
- [The dressing stage](./dressing.md)

### Area map screens

- [The area map as a road atlas, on what the map already has](./area-map-atlas-style.md)
- [The area map and run route panels on the atlas sheet](./area-map-atlas-panels.md)
- [Area map and run route: the supply run's pick on the real map](./area-map-route-pick.md)

### Look and assets

- [UI art direction for the first playtest](./ui-art-direction.md)
- [The UI art atlas](./ui-art-atlas.md)
- [Theme tokens: file format, generator, starting palette](./theme-tokens.md)
- [Font pipeline: faces, atlases, and the loader](./font-pipeline.md)

### Process

- [Playtest builds as downloadable binaries, not a web page](./playtest-binaries-over-web.md)
