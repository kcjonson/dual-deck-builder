# The game app: scenes, saves, settings, and the dev server on salal's app and ui

## Date
2026-10-31

## Context

Port plan step 6 starts with the part of the presentation that doesn't wait on the UI art decision: the game's executable, its scenes in the order Game Flow and UI Specification has them, saves and settings, and the dev server, all over the rules and the AI through their real API. The look is a placeholder until the art decision lands. salal is pinned at v0.30.1, whose `app` (the frame, scenes, saves, settings, the dev server) and `ui` (the component tree, layout, focus, the overlay stack, the controls) are both in, and worldsim runs on them.

The rules already found a campaign on a map made off the frame, read and write its save, play its runs stop by stop, fight through the combat bridge, and end its days and the campaign itself ([campaign.md](./campaign.md)). Writing the save to a slot, the history, and holding the map beside the campaign were left to the game ([campaign-save-and-load.md](./campaign-save-and-load.md), In the C++ alpha).

## Options considered

Where the game's code lives:

1. **All of it in the executable,** as worldsim's `world-sim` is. The tests would have to build the scenes again or launch the game.
2. **A library the executable and the tests share (chosen),** as the balance sim's core is. The executable is `main` alone.

How a scene that waits on a map gets it:

1. **salal's `TaskPool`,** which the balance sim spreads its runs over. It has no cancel, and a scene would still need somewhere to keep the progress and the result.
2. **A job on a `std::jthread` of its own (chosen),** whose stop token is the pipeline's cancel, polled from the scene's update.

How the tests drive the scenes:

1. **Calling each scene's methods.** Quick, but it skips the layout, the hit test, and the App's dispatch, which is where a button that's covered or off the page would fail.
2. **Presses through the App's own input (chosen),** at the middle of a component found by its id, after checking it's the topmost hit there: what a player does, and what a dev-server session does with `/api/ui/tree` and `/api/input`.

## Decision

**The layout.** `apps/wasteland-wheels/` builds `ddb_game`, a library over `ddb::rules`, `ddb::ai`, and salal's `app` and `ui`, and `wasteland-wheels`, its `Main.cpp` alone, with salal's base shader and no hooks. `ddb_check_layering()` holds both, and every target under `libs/` to linking none of salal's renderer, ui, or app, tests included.

| file | what it is |
|---|---|
| `Main.cpp` | the command line, the packs loaded before any window, the App, the context, the scenes and routes, the splash |
| `GameRules` | everything the game reads from its packs, loaded once: content, the campaign's rules and events, the raiders' policies, the unlocked archetypes, the map content and route tuning |
| `GameContext.h` | the App's context object: the rules, the store, the map makers, the seed source, and the session |
| `Session` | the campaign being played and its map (`SessionMap`, which owns a made map or borrows a test's layers), and `MapMakers`, makeCampaignMap and loadCampaign over the packs, the seam a test swaps |
| `MapJob.h` | a map made on a worker: its progress, its result or its throw, and its cancel |
| `CampaignStore` | the save and the history over salal's `SaveStore` |
| `Words` | what the scenes call things: names from the packs and the rules' blockers worded |
| `DevRoutes` | the game's dev server routes |
| `scenes/` | one folder a scene, `GameScene.h` for what they share, `SceneKit` for the placeholder look, `Scenes` for their names |

**The scenes.** Each is a salal `Scene` on the App's stack, its page rebuilt from the campaign whenever it changes. A scene with arguments is pushed by type and has no name; the rest are added by name, for `--scene`, the dev server's `scene` control, and each other.

```
splash -> main_menu -> founding -> compound -> area_map -> load_out -> run -> debrief -> compound
              |            ^           |                                |  ^
              |            |           +-> campaign_end <- debrief      |  |
              +-> loading -+-> compound or run                          battle
              +-> settings
```

- `splash`: the name, then the menu after a second and a half or a press.
- `main_menu`: Continue with "Day 12 - 3 drivers - 1 stronghold taken", or disabled with the line under it saying why (nothing to continue, a damaged save, another save format); New Campaign, which asks first in a dialog over a campaign in progress; Settings; Quit; and Campaign History. Continue skips the load when the session already holds the saved campaign.
- `founding`: the map made on a worker on the seed given or a fresh one, its progress shown ("Making the area map: water (2 of 9)"), then `foundCampaign`, the save, and the compound. Cancel stops the making at the next stage and goes back with nothing kept. A seed whose attempts all fail says so and offers another.
- `loading`: Continue. The save's map made again on a worker by `loadCampaign`, then the compound, the run when one is on the road, or the campaign's end. A save the rules refuse, its fingerprint another map's or anything else, shows the reason and offers a new campaign; there are no migrations.
- `compound`: the stores, the needs forecast, the pool, the convoy, and the log, with Plan a supply run, Send a scavenging party (its haul on the button, or why not), and Rest a day.
- `area_map`: every POI `offersToday` offers, then the picked POI's routes, each with its hours, fuel, risk, and stops.
- `load_out`: two seats and the pool, each driver who can't be seated faded with `seatBlocker`'s reason, and the escorts to bring. Start run is enabled once a departure tried on a copy of the campaign passes (`startRun`, then `departBlocker`), so the page's reason is the rules', and it seats one driver only when nobody else can be seated beside them (solo-driver-fights.md's call). Run decks are the defaults until Customize lands.
- `run`: the route's stops in driving order, how far down them the run is, the crew and the cargo, and what `ahead` says comes next: a fight, a find to take or leave, an event's choices with `choiceBlocker`'s reasons, a reward to pick from, the objective, or the road home.
- `battle`: each driver's hand as rows, a card's targets once it's picked (a card with one way to play plays at once), and the raiders with their intents (`intentsOf`) and who's arriving (`arrivalsOf`). Every play is one of `legalActions`, made with `apply`; the raiders plan each turn through `OpponentPolicies`. It finishes with the fight, and the run writes it back with `endRunFight`.
- `debrief`: what a run brought home and the injuries it came back with, or what a failed one lost and what became of each seat, and the night after it.
- `campaign_end`: how the compound fell and why, the days it held, and the tally. The rules have no win yet, so a fall is the only end.
- `settings`: vsync, fullscreen, the ui's scale, and reduced motion.

**Map work.** Founding and Continue each run a whole generation, so both run on a `MapJob`. The job's `std::jthread` stop token goes into the rules' `MapMaking::cancel`, which `makeCampaignMap` and `loadCampaign` now pass to the pipeline's own cancel ([map-pipeline-worker.md](./map-pipeline-worker.md)): a stop waits at most a stage, throws `MapPipelineCancelled`, and never moves founding to another seed. The scene polls the job each update, shows its progress, and takes its result or its throw once it's done; leaving the scene, or the App going, cancels the job and waits for it. The session holds one campaign's map at a time, the one its founding or its load made.

**Saves** ([campaign-save-and-load.md](./campaign-save-and-load.md)). `CampaignStore` keeps the campaign's JSON in the slot `campaign` and the history in `history`, both through salal's `SaveStore`, whose envelope carries `kSaveVersion` as the game's save format, so a save of another version reads as a newer build's or as an upgrade that failed, and the menu says it's from another save format. salal's store writes each save whole, keeps the one before as the backup, and sets a damaged one aside rather than deleting it.

- `status()` reads the envelope, the JSON, and the campaign strictly with `readCampaign`, never its map, which is all the menu needs. A throw the reader didn't mean (a bug) is logged as an error and reads as damaged, so one bad save can't lock the player out of the menu.
- Every step that changes the campaign saves it once it's done: a compound action, a load out leaving, each stop's step, a fight written back, a run home or failed, and founding. A fight in progress isn't saved, so a reload starts it again, the same fight (call 65).
- `replace` is a new campaign over the save: written over it, then the one it replaced, if this build reads it, into the history as abandoned.
- `end` puts a campaign into the history with its fall and removes its save; `campaign_end` calls it as it opens. The same ending twice is one line.
- A history entry is the seed, the day it ended on, the strongholds taken, and the ending.

**Settings** are salal's user settings file, `settings.json` in the per-user config folder, read by the App at create. The game keeps nothing of its own there yet; the settings scene applies the App's keys at once and saves the file, and `main` saves it at exit, so the window's size comes back. The per-user folders are named for "Bear Cave Interactive" and "Wasteland Wheels": the saves under `%LOCALAPPDATA%` and the settings under `%APPDATA%` on Windows.

**The dev server** is salal's, on 127.0.0.1:8070 in Debug and RelWithDebInfo, or `--http-port`'s port. Besides the engine's tree, lint, screenshot, input, control, and every scene's `exportState` under `/api/state?what=scene`, the game registers, only where the server is compiled in:

- `/api/state?what=game`: the top scene, the save's status, and the campaign being played as its save JSON.
- `/api/dev/found?seed=N`: a new campaign founded on a seed, through the founding scene.
- `/api/dev/continue`: the save continued, through the loading scene.
- While a fight is up, `/api/state?what=battle` with the actions on offer in order, `/api/dev/battle-act?index=N` to take one, and `/api/dev/battle-play-out`, which plays the rest of the fight with the player's seats on the first playable card, for a session that needs a fight over rather than played well.

**The placeholder look** is salal's default tokens and its controls: a page with a title, a row of panels, rows (`ListRow`) and buttons, and a notice line, with no game art, theme, or icons. Text draws in JetBrains Mono, salal's sandbox atlas copied with its licence into `fonts/`, since salal ships no font and the game's own atlases don't load yet (Salal gaps, below).

**Tests** run headless on salal's `HeadlessPlatform` and null renderer, through the App's own frame and input. The fast lane founds and loads on the map tests' fixture map, which a founding hands back at once or holds until cancelled; it covers every scene's flow, a founding cancelled, a save on another map refused with an offer to start fresh, a run out through every stop to its debrief, the compound's actions, the campaign's end, settings, and the store's round trips, statuses, and history. The slow lane runs the rules' own map making on the scenes' workers: Continue making a saved map again, and a founding cancelled part way.

## Rationale

The library is what lets the tests drive the real scenes without a window, and it's the balance sim's arrangement already. A job of its own per generation is the founding contract as the TypeScript had it, with the stop token doing what its worker's terminate did, and nothing about it is shared between scenes. Pressing through the App catches what calling a scene's method would miss, at the cost of finding components by id, which the dev server needs them to have anyway.

The rows show every number the rules work out and every reason they refuse, so the shell plays the whole loop with nothing re-implemented: each refusal on screen is a blocker's, and Start run tries the departure on a copy rather than repeating its checks.

No gameplay calls: the flow is Game Flow's, and the one rule load out adds, a run of one only when nobody else can be seated, is solo-driver-fights.md's.

## Salal gaps

- **The font atlas format.** salal's `FontRenderer` reads its own JSON: glyphs keyed by a one-byte character, atlas bounds in 0 to 1. The game's atlases (`_legacy/src/assets/fonts/`, Barlow Condensed, Open Sans, and JetBrains Mono) are msdf-atlas-gen's own output, a glyph array keyed by Unicode code point with pixel bounds, and don't load; and no character past one byte has a glyph. Reading msdf-atlas-gen's format, and keying glyphs by code point, would let the game ship its faces.
- **A theme for every scene.** Each scene's ui context starts on ui's default theme, and a game's tokens and its font families (the roles display, body, and mono) have to be set on each scene's context by the scene. An App-level theme every scene's ui starts with is the generic shape, and the game will need it the day it has tokens.
- **Pushing a scene by name.** `SceneStack` pushes by type only; by name it can only reset (`switchTo`). The game resets everywhere a scene has no arguments (the settings over the menu, the area map over the compound), which rebuilds the scene underneath when it comes back.
- **The drag tier.** ui-plan.md leaves the drag service out of its sequence. The battle screen's cards are dragged onto targets (Game Flow 2.3), so the real battle screen needs it.
- **A cancellable background job.** `MapJob` (run on a thread, progress and the result polled from update, cancel through a stop token) is nothing the game owns; if worldsim's world creator wants the same, it belongs in app.

## Consequences

- The whole loop plays headless: found, plan, load out, fight, take a find or an event, come home or fail, rest, scavenge, and fall, saved at every step and continued from the save.
- Nothing has been launched with a window. The checks owed once the machine is free: the game opens and draws its text; `/api/ui/lint` is 0 on every scene, which no test checks; a real founding's progress moves with the frame responsive and Cancel works mid-generation; quitting and relaunching continues from the save, and the settings and window size come back; a run plays end to end with the mouse, wheel-scrolling long panels; a Release build opens no socket.
- The real screens wait on the art decision (DDB-577). When it lands they need: the game's tokens and faces as a theme (the two gaps above), icons through `salal_icons` (msdfgen then joins the vcpkg manifest as a host port), the card in its three sizes with the driver and escort cards and the detail view (Game Flow 7.0), the battle screen's road drawn through Primitives with targeting previews from `apply` on a copy and animation from the events `apply` returns (the scene drops them today) and drag and drop (the drag tier), the area map drawn from the whole `AreaMap` the session already holds (`SessionMap::areaMap`), and the compound's illustrated scene. The Crew screen, Customize, the garage, and the victory screen aren't scenes yet.
- The packs are read from the source tree, as the balance sim reads them, until playtest builds ship them (port plan step 7).
