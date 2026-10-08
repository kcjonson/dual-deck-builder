# Compound campaign and the area map

Date: 2026-10-06. Status: decided by Kevin, design only, nothing built.

Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md), [Area Map Generation](../specs/Area%20Map%20Generation.md). Wireframes: the "Supply Run Map" design canvas.

## Context

The game had driver selection and a fight, and the specs described a Slay the Spire style run: one long climb up a layered map to a region boss, the run ending in that boss or in death. There was no way to choose where to go beyond the next node, nothing persisted between runs but meta-progression, and nothing in the docs set up a reason to be out on the road.

## Decision 1: a compound campaign of supply runs

The player runs a compound in the ruins of a metro area. The game is a campaign of supply runs: pick a point of interest on an always-open area map, pick one of its routes, pick two drivers from the compound's pool, resolve the stops on the route, take the objective, come home down the road just cleared.

- Runs are one way. The cleared road home is safe, except for a rare late-game ambush.
- The driver pool is finite and only refilled by Find: driver stops. Drivers and their decks persist; death is permanent. When the last driver dies the compound falls and the campaign ends.
- Bosses are strongholds in the fog in every direction. The player picks when to fight one; none is forced.

Options considered:

- Keep the single run to a region boss. Rejected: no home to fight for, no reason to choose a destination, and supply runs were the premise.
- A compound hub with the old node map per run (a fresh layered map each time). Rejected: geography wouldn't persist, so charting and fog would mean nothing.
- Chosen: one persistent area map, explored over the campaign.

Consequences: "run" now means one supply run and "campaign" the whole save; Combat Rules' game over became "run lost", and the campaign's loss condition moved to the driver pool. Card rewards accrue to persistent drivers, which makes deck growth a campaign-length arc.

## Decision 2: the road network is trees grown outward from the metro

The roads are highways leaving the metro at irregular angles, bending with the terrain, and branching into back roads and trails, grown step by step with an outward-only rule and a clearance check. POIs are dead ends where two or three approach roads from different branches meet.

Options considered:

- A layered DAG, Slay the Spire style. Rejected: no geography and no destinations.
- Per-POI routes generated independently. Rejected: routes to different POIs would cross and disagree, and charting a road on one run wouldn't carry to another.
- A planar mesh: Delaunay triangulation of all sites, thinned under constraints, with road geometry confined to per-edge regions. This was the first draft. Rejected in review: it reads as a web, lets you drive from objective to objective, and doesn't look like the roads of a real region.
- Chosen: outward growth. It's how roads leave a city, the outward rule alone rules out a web, and the clearance check makes crossings impossible as roads are laid down.

Consequences:

- Routes need no search: within a tree there's one path back to the root, so a POI's routes are its approaches plus the walk home along parent links.
- Route separation is a placement rule: a POI is only kept if it gets at least two approaches whose paths to the compound split inside tier 1. Routes can share a highway's first stretch out of the metro and nothing after.
- Every loop in the network closes at a POI, so there's never a road onward from one objective to another.
- Planarity holds by construction; the validator still sweeps for crossings to catch bugs.

## Decision 3: saves store the gameplay map

The save holds the generated gameplay map (drivable roads, POIs, stops, tiers, territories) plus the resolved parameters and the mutable state (fog, road knowledge, stop state, POI stock), not just the seed. Generator changes can't alter a campaign in progress, and floating-point differences between JS engines don't matter for loading. Terrain and scenery are only pictures once the gameplay map exists, so they're regenerated on load.

## Decision 4: drivable roads and scenery are separate layers

Kevin, 2026-10-06: a region with only the drivable trees looks empty. The map has a drivable network, which carries every gameplay rule, and a scenery layer of street grids, county roads, rail lines, and broken pre-war highways that carries none.

- Scenery is generated last, from its own stream, and writes nothing back, so tuning it can't move a drivable road or a stop. A test generates with scenery off and on and asserts the gameplay layer is identical.
- Scenery may cross drivable roads and itself. Its only rules keep it from misleading the player: it never reaches a POI, never joins near a drivable junction or stop, never shadows a drivable road, and is always drawn lighter.

Option rejected: one road layer with a "drivable" flag. Every rule (no crossings, outward growth, clearance) would need exceptions, and a scenery tweak could shift the gameplay roads through shared randomness.

## Decision 5: generation is parameterised, tuned in a Map Lab, rolled in the finished game

Kevin, 2026-10-06: the map needs tunable characteristics beyond the seed (density, environment, mountains, rivers and so on), visible and tweakable during the prototype, randomised with the seed in the finished game.

- One `MapParams` object: seed, environment preset, world, drivable network, gameplay, and scenery groups. Each parameter has a tuning range, a default, and a campaign range.
- The Map Lab, a Developer screen section, regenerates live as parameters change, with layer toggles, a guarantee readout, timings, and JSON presets in the repo.
- The finished game calls `rollParams(seed)` on its own stream, then generates. The guarantees must hold across the whole tuning range, which is what the property tests sample.

## Decision 6: runs are hours against daylight

Kevin, 2026-10-06: runs aren't measured in days. A run leaves at dawn and must be home by dark; one run is one day at the compound. Roads, stops, and the objective cost hours, and the route screen projects the return time against dark.

- Generation keeps every POI in tiers 1 to 3 reachable and leavable in daylight; tiers 4 and 5 are banded to run past it.
- Night is a late-game mechanic: far POIs and strongholds push runs into the dark, which has its own challenges, not yet designed. Until then, a run out after dark rolls the return ambush at full odds.

## Decision 7: default decks, a shared locker, and per-run decks

Kevin, 2026-10-06: the settlement needs deck management. Each driver has a deck and a hand limit; the player adds and removes cards from a driver's default deck at the compound, and adjusts it for one run at load out.

- Every card copy lives in exactly one place: a driver's default deck, the compound's locker, or a run deck. Rewards go to the locker.
- Moving cards at the compound is free (the Crew screen, from the bunkhouse), which retires the garage's paid card removal.
- Run decks start as copies of the default decks; borrowed cards return when the driver does and are lost if the driver dies.
- Escort signature cards are added to a run deck the player picks, locked, outside the size limit. This settles the old open question about escort cards and persistent decks.
- Load out replaces the old driver selection screen: one screen with two seats, each showing the driver's deck view only, the pool with reasons a driver can't go, synergy, and escorts. Most runs use the default decks; "Customize" is an optional mode per driver, laid out like the Crew screen so it's the same tool.

## Decision 8: cards look like cards, in three sizes

Kevin, 2026-10-06: this is a card game, so cards are never shown as rows or text. Three sizes of one `Card` component: the detail view (250 wide, exists), the face (128x180, exists), and a new mini card (80x112: cost, name, art, type, rarity, no summary) for deck building and other screens with many cards. Copies stack with a count. Drivers and escorts are cards too: a driver card (104x146, riveted double frame) and an escort card (80x112, hazard-stripe header), each with an edge no play card has. Game Flow 7.0 has the tables and the states.

Option rejected: per-driver card ownership with no shared locker. Cards would be stuck with whoever earned them, and losing a driver would lose cards nobody chose to risk.

## Open

Listed in the specs' open questions: what wins the campaign, whether shortages alone can end it, deck size limits, driver names, night rules, found vehicles, mid-route branching, starting pool size, map size, and rivers. The noise dependency is settled in [terrain-fields.md](./terrain-fields.md).
