# The battle screen fit suite

## Date
2026-10-02

## Context

DDB-141. The battle screen mock (docs/design/battle-screen/index.html) carries a fit matrix: six scenarios at six viewports in five states, each run through a `lint` that reports overflowing text, things off the frame, colliding tokens and chips, tokens scaled under x1, and broken slot rules. With the road, token, dock, card face, targeting, intents, and top bar all built, the same matrix has to hold on the real screen, and stay held in CI.

## Options considered

1. **Gallery panels that compose the screen's pieces** (road, dock, top bar) the way `combat-targeting` and `combat-dock` do.
   - Cons: a second copy of `CombatScreen`'s layout to keep in step, and none of the screen's own states: its detail view placement, its drag, its End Turn hover. The suite would measure the copy.
2. **A dev-only scenario switch on the game page** (`navigate('combatScreen', { scenario })`).
   - Cons: the fixtures would have to be reachable from production code, or hidden behind a dynamic import under `__DEV_TOOLS__`.
3. **Gallery scenes that mount the real screen with a prepared fight (chosen).**
   - Pros: the fixtures live under `src/gallery/`, which never ships; what's measured is the screen itself, driven with the same injected input a player's events go through.

## Decision

Option 3.

- `SceneHost` takes a second kind of scene, a `ScreenScene` (`{ name, screen: () => ({ screen, data }) }`), which it mounts on the context as `ScreenManager` would: the screen's root is the debug root in place of the host's, it updates and renders with the frame, and it resizes in place, paused or not, as the game's screens do. A panel scene still rebuilds on resize.
- `CombatScreen` takes a prepared fight: mount data `{ prepare: () => Promise<PreparedCombat> }`, where `PreparedCombat` is a started `Battle`, whose seats are the drivers (`Battle.playerSeats`), and the top bar's wave, scrap, fuel, and log lines. `initializeCombat` builds its default fight into the same shape and both go through `beginCombat`. It's the seam an encounter will use once encounters carry their own raiders and resources.
- `src/gallery/scenes/battleFitScenarios.ts` builds the mock's six (`battle-typical`, `-opening`, `-convoy`, `-fullroad`, `-passenger`, `-bighands`) from real mechanics: real drivers, escorts, raiders with decks, a started `Battle`, then the mock's board set on top (hands, adrenaline, piles, mods, statuses). A driven vehicle on the raiders' shoulder starts in formation and swerves there after placement, since only raiders and set-piece escorts may start flanking; the passenger scene wrecks the Rig through `Team.handleVehicleDestruction`. Raider pills are the AI's own plans from the decks given, so they show what the game would show for that board, not the mock's exact values. Big hands uses the mock's 318 character Tag Team Takedown, which isn't in `cards.json`. A seventh, `battle-solo`, isn't the mock's: the Interceptor alone with three escorts, the dock's second seat empty ([solo-driver-fights.md](./solo-driver-fights.md)).
- `tests/visual/web/battleFit.spec.ts` runs each scenario on one page load at 1920x1080, 1440x882, 1280x800, 2560x1080, 1024x768, and the 1024x600 gate size, in five states: planning, the detail view of the leftmost and rightmost card across the hands, driver 1's and driver 2's when both are seated (pinned with a secondary click, which places it exactly as the hover does without waiting out the tooltip delay, and required to show that card's name), Headshot mid-drag over the nearest raider in reach, and End Turn hovered with the preview drawing its totals. 1280x720 isn't measured on its own: the stage is `max(0.8, min(W / 1280, H / 720))`, so it lays out the same logical stage and road as 1920x1080, which measures them at x1.5 where the tolerances are tighter; a unit test holds the two layouts equal.
- Each case must have a clean layout lint and pass `battleFit` (`tests/visual/support/battleFit.ts`), the mock's `lint` on the tree snapshot: overflow either way for any text but an ellipsis (a word wider than the wrap width runs out the side, which the engine lint lets off), off-frame boxes, collisions, token scale, the mock's four slot rules (own shoulder, two in a slot, a flanker in a row the other formation has nobody in, and the hand cap of seven), plus a token drawn outside the slot its id names and any parked subtree. The token-scale check uses the road's uncapped scale for each token's height (`tokenScaleFor`), since a token never draws below x1 and can't show it. Not ported: the mock's `.predict`, since the incoming total is drawn inside its token's box and the token collisions cover it, and `.hitchip`, which is paint-only and has no box in the tree.
- Each size first checks the scenario's worst case is on screen: the token count (5, 3, 11, 18, 5, 11, 7), all 18 slots distinct on the full road, 7 + 7 cards with Tag Team Takedown leftmost and EMP Blast rightmost in big hands, the Interceptor flanking in typical, both drivers inside on turn 1 in opening, three escorts and two shoulder raiders in convoy, the wreck's stamp and the PASSENGER tag in passenger, and in solo one tab and hand with the second seat empty.
- Software GL draws a 1920x1080 frame in well over 100 ms, so the spec is written in frames: one burst of input per state (putting the last state away first), a few frames, one tree read, and the engine's `layoutLint` run on that same tree in the test process rather than serialised again in the page.
- A case that fails a real check is listed in `EXPECTED_FAILURES` with its bug key; a listed case that starts passing fails the suite.
- Goldens: the typical scene at rest, before any input, at 1440x882 (`scene-battle-typical`) and at 2560x1080 (`scene-battle-typical-2560x1080`), where the road's art bleeds past the 1600 column to the screen's edges, and the solo scene at the two gate sizes (`scene-battle-solo`, `scene-battle-solo-1024x600`). The rest is assertions only.

## Found by it

- At a stage scale past about 1.25 (1920x1080, 2560x1080) the fan's second and fourth cards poked 0.4 logical pixels above the row, which the stage scaled past the lint's half-pixel tolerance. Those cards turn 0.9 degrees and drop only 0.6, so their top corner rises, and the row's padding only took the edge cards' reach. The row now pads by the most any card reaches each way. The gate sizes (1440x882 and 1024x600) are both at scale 1 or under, which is why the lint gate never saw it.

## Consequences

- The fit suite is the most expensive spec in the visual job, about 6 minutes on the runner. On pull requests `.github/workflows/visual.yml` runs it only when the diff touches `src/`, `tests/visual/`, `docs/design/`, the build, or the workflow (otherwise `--grep-invert "battle screen fit"`); pushes to main always run it.
- New battle screen states (log open, enemy turn) can join the state list; the enemy turn parks the dock, so it would need `battleFit` to allow a park there.
