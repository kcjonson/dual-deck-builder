# Road growth (DDB-290), retired

Date: 2026-10-08, retired 2026-10-10. Outward growth, highways leaving the metro and roads grown a step at a time into trees, was the area map's network until the road links and graph (Maps 7 and 8) replaced it; [road-network.md](./road-network.md) has what replaced it and why, and [realistic-map.md](./realistic-map.md), decision 2, why trees of roads had to go. `Highways.ts`, `RoadGrowth.ts` with its step rules, their tests, and `scripts/road-growth.mjs` are gone. What survives:

- `Geometry.ts`: segment distances, crossings, and Chaikin's corner cutting, which the road graph smooths with and the checks sweep with.
- `SegmentIndex.ts`: the spatial hash of segments, now the POI stage's index of highways.
- `RoadNetwork.ts`: the network as plain data a save can hold, reshaped for a network with loops.
- `RoadChecks.ts`: the checks from the data alone, rewritten for a network with loops.

## Geometry without trigonometry

Generation branches on plain arithmetic so a seed makes the same map in every engine (seeded-prng.md). Headings are unit vectors. `unitVector` turns degrees into one by Taylor series after reducing the angle to within 45 degrees of a quarter turn, under 1e-16 from the true values, and angles are compared by their cosines. Square roots are fine: ECMAScript specifies `Math.sqrt` as the correctly rounded root, while `hypot`, `atan2`, and the rest are only approximated, so none of those is used.
