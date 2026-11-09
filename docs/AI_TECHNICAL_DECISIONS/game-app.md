# The game app: scenes, saves, settings, and the dev server on salal's app and ui

## Date
2026-10-31

## Context

Port plan step 6 starts with the part of the presentation that doesn't wait on the UI art decision: the game's executable, its scenes in the order Game Flow and UI Specification has them, saves and settings, and the dev server, all over the rules and the AI through their real API. The look is a placeholder until the art decision lands. salal was pinned at v0.30.1 when this was written and is at v0.39.0 since 2026-11-09, which adds a log file per run, a crash handler, and drag and drop; its `app` (the frame, scenes, saves, settings, the dev server) and `ui` (the component tree, layout, focus, the overlay stack, the controls) are both in, and worldsim runs on them.

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

**The layout.** `apps/wasteland-wheels/` builds `ddb_game`, a library over `ddb::rules`, `ddb::ai`, and salal's `app` and `ui`, and `wasteland-wheels`, its `Main.cpp` alone. The library carries the base shader with the game's fill hooks and the atlas tokens, so the tests draw with what the game does. `ddb_check_layering()` holds both, and every target under `libs/` to linking none of salal's renderer, ui, or app, tests included.

| file | what it is |
|---|---|
| `Main.cpp` | the command line, the packs loaded before any window, the App, the context, the scenes and routes, the splash |
| `GameRules` | everything the game reads from its packs, loaded once: content, the campaign's rules and events, the raiders' policies, the unlocked archetypes, the map content and route tuning |
| `GameContext.h` | the App's context object: the rules, the store, the map makers, the seed source, and the session |
| `Session` | the campaign being played and its map (`SessionMap`, which owns a made map or borrows a test's layers), and `MapMakers`, makeCampaignMap and loadCampaign over the packs, the seam a test swaps |
| `MapJob.h` | a map made on a worker: its progress, its result or its throw, and its cancel |
| `CampaignStore` | the save and the history over salal's `SaveStore` |
| `Words` | what the scenes call things: names from the packs and the rules' blockers worded. A driver is "Road Warrior 1" everywhere, the fight's seats included, and an archetype as a need "a Mechanic" |
| `DevRoutes` | the game's dev server routes |
| `Fonts` | the game's faces, a font family each, and the theme that puts ui's font roles on them |
| `shaders/`, `tokens/`, `icons/`, `art/` | the base shader's fill hooks (`salal_base_shader`), the game's theme in its two modes, the atlas and dark (`salal_tokens`, a resolver), the icons (`salal_icons`), and the flat-fill vector art (`salal_art`; `scripts/vector-art.mjs` writes the logo, the marks and the stamps), each built into the library |
| `atlas/` | the atlas look (UI Art Direction): its theme, the paper (procedural-paper.md), the art drawn at a size and a tint (`ArtView`), and the parts a meta scene is built from, its gauges and markers included |
| `cards/` | the card in its sizes, its detail view, and the decks' backs ([cards-and-kit-on-salal.md](./cards-and-kit-on-salal.md)) |
| `road/` | the road's pieces: its layout, what it shows of a fight, the road itself, and the vehicle token |
| `scenes/` | one folder a scene, `GameScene.h` for what they share, `AtlasPage` for the sheet the menu's appendices and the waits on a map share, `SceneKit` for the placeholder look, `Scenes` for their names |

**The scenes.** Each is a salal `Scene` on the App's stack, its page rebuilt from the campaign whenever it changes. A scene with arguments is pushed by type and has no name; the rest are added by name, for `--scene`, the dev server's `scene` control, and each other.

```
splash -> main_menu -> founding -> compound -> area_map -> run_route -> load_out -> run -> debrief -> compound
              |            ^           |                                             |  ^
              |            |           +-> campaign_end <- debrief                   |  |
              +-> loading -+-> compound or run                                       battle -> battle_result, event
              +-> settings, credits, campaign_history
```

- `splash`: the closed atlas on the table with the two decks partly under it, and the scale-bar loader filling while it fades in and holds; the menu after a second and a half or a press.
- `main_menu`: the atlas cover with the logo in its cartouche and the decks set on it, and the contents page: Continue first, with the day in its shield and "Day 12 - 3 drivers - 1 stronghold taken" under it, or in faded print with the line under it saying why (nothing to continue, a damaged save, another save format) and New Campaign first; New Campaign, which asks first in a dialog over a campaign in progress; Campaign History; and the appendices, settings, the card showcase, credits, developer tools (the art gallery, in a build with the dev server), and Exit. Continue skips the load when the session already holds the saved campaign.
- `founding`: the map made on a worker on the seed given or a fresh one, its progress shown ("Making the area map: water (2 of 9)"), then `foundCampaign`, the save, and the compound. Cancel stops the making at the next stage and goes back with nothing kept, disabled once pressed. A seed whose attempts all fail says so and offers another.
- `loading`: Continue. The save's map made again on a worker by `loadCampaign`, then the compound, the run when one is on the road, or the campaign's end. A save the rules refuse, its fingerprint another map's or anything else, shows the reason and offers a new campaign; there are no migrations.
- `compound`: in the atlas ([compound-screen.md](./compound-screen.md), In the C++ alpha): the plate of the yard, the chosen building, the needs, the day's two ways to end it with what each costs, and the log, with Plan a supply run.
- `area_map`: in the atlas ([area-map-route-pick.md](./area-map-route-pick.md) and [area-map-atlas-style.md](./area-map-atlas-style.md), each In the C++ alpha): the map drawn from the whole `AreaMap` the session holds, fitted to what's revealed, the POIs found as destinations, the chosen one's box, and Plan a run here.
- `run_route`: pushed over the area map with a POI: the map cropped to its routes, a card per route, the picked route's stops and its time home against dark, and Load out the crew.
- `load_out`: in the atlas ([load-out-screen.md](./load-out-screen.md), In the C++ alpha): the route, two seats with their drivers and decks, the pool with each driver who can't be seated faded with `seatBlocker`'s reason, and the escorts to bring or leave. Start run is enabled once a departure tried on a copy of the campaign passes (`startRun`, then `departBlocker`), so the page's reason is the rules', and it seats one driver only when nobody else can be seated beside them (solo-driver-fights.md's call). Customize deals the run decks and pushes `customize` for a seat.
- `run`: in the atlas ([mvp-supply-run.md](./mvp-supply-run.md), In the C++ alpha): the step `ahead` says comes next in a fresh box, a fight, a find to take or leave, an event to pull over for, a reward's cards as cards, the objective, or the road home; the crew and the cargo under it; the road's stops in driving order beside it; and the step's highway.
- `event`: pushed over the run at an event stop ([event-screen.md](./event-screen.md), In the C++ alpha): the plate, the journal, and the choices as cards with `choiceBlocker`'s reasons; the outcome once one's taken, and back to the run or into its fight.
- `battle`: in the dark theme ([battle-scene.md](./battle-scene.md)): the top bar, the road with every vehicle on it as a token, the dock with each driver's hand and End Turn, the log drawer and the turn banner. A card is dragged from the hand onto what it's played at, or picked up and dropped with the keys; every play is one of `legalActions`, made with `apply`, and what `apply` returns plays back, the raiders' turn beat by beat. The raiders plan each turn through `OpponentPolicies`. It finishes with the fight, and the run writes it back with `endRunFight`.
- `battle_result`: in the atlas ([result-screens.md](./result-screens.md)), pushed by the run over itself after a fight won or broken off is written back: the outcome and what the run carries out of it, then back on the road. A lost fight's result is the debrief.
- `debrief`: in the atlas ([result-screens.md](./result-screens.md)): where the run went and what it brought home, stamped LOOTED, or what a failed one lost, stamped LOST; the crew as they stand after the night; and the night.
- `campaign_end`: in the atlas ([result-screens.md](./result-screens.md)), on a burnt sheet: how the compound fell and why, stamped FALLEN, the last day's log, and the record. The rules have no win yet, so a fall is the only end.
- `settings`, `credits`, `campaign_history`: the menu's appendices, an atlas sheet each with tabs between them and Menu (Escape goes back too): vsync, fullscreen, the ui's scale, and reduced motion; the licence, the authors, the faces and what the game is built with, a test holding every bundled face to an entry; and past campaigns newest first, each with its ending, days, strongholds and seed.
- `art_gallery`: a developer's page, outside the flow, reached by `--scene` or the dev server: every piece in `art/` at the size a screen uses it, and the closed atlas's pieces laid on a cover as the splash will lay them. Its test fails when a piece in `art/` isn't on it.
- `crew`: in the atlas ([crew-screen.md](./crew-screen.md), In the C++ alpha), from the bunkhouse and the Crew tabs: the driver pool, the chosen driver's default deck, and the locker, every move the rules' and saved as it's made.
- `customize`: pushed by load out with a seat's driver ([customize-screen.md](./customize-screen.md), In the C++ alpha): that driver's run deck against the locker, and the escort cards.
- `card_showcase`: every card in the game, in the atlas, from the main menu ([cards-and-kit-on-salal.md](./cards-and-kit-on-salal.md)).

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

**The placeholder look**, every scene's not yet in the atlas, is salal's default tokens and its controls: a page with a title, a row of panels, rows (`ListRow`) and buttons, and a notice line, with no game art, theme, or icons.

**The faces** are the game's own (UI Art Direction, Type), the msdf-atlas-gen atlases the TypeScript built, copied from `_legacy/src/assets/fonts/` into `fonts/` with each face's OFL and staged beside the exe: Barlow Condensed Bold and SemiBold for display, Open Sans Regular for body, the default, and JetBrains Mono Regular for mono, a family each (`Fonts.h`). salal reads msdf-atlas-gen's JSON and lays text out by code point since v0.35.0. Every scene's ui loads ui's own tokens with its font roles on those families (`fonts::theme()`, from `GameScene`), so headings are display, prose body, and figures mono, as ui's tokens assign them: a page's, a panel's, and a dialog's titles are display; rows, buttons, and lines of text are body; and a row's trailing text is mono, as is a line `kit::figures` makes for a ledger or a code (the stores, unrest, a seed). A font is one weight, so the display role is both Barlow faces under one name, registered with their weights, and a style's weight picks the face (salal since v0.37.0): ui's display typography at 700 draws the bold, its title at 600 the semibold. Open Sans SemiBold isn't loaded: salal's text reads no weight, so nothing would ask for it.

The faces hold printable ASCII, the Latin-1 Supplement, and most of the punctuation font-pipeline.md's charset lists. Everything the game draws today is ASCII: every source under `apps/` and `libs/` and every file of the base pack, names, cards, and events included, with no escapes past it, and salal's ui writes no character of its own past it. A character a face lacks draws as U+FFFD, or as '?' in Barlow Condensed, which has no U+FFFD. Within that charset, Barlow Condensed lacks the typographic spaces (U+2002 to U+200B and U+202F), U+2011, U+2012, U+2015, U+201B, U+201F, U+2060, and U+FEFF; JetBrains Mono lacks U+2002 to U+200A, U+2011, U+2012, U+2015, U+202F, and U+2060; and Open Sans lacks U+2010 to U+2012, U+201F, U+202F, and U+2060. The TypeScript's loader stood in for those (a hyphen, a blank of the space's width), and salal's doesn't. Text the game doesn't write, such as a refused save's reason, is body, which has U+FFFD.

**Tests** run headless on salal's `HeadlessPlatform` and null renderer, through the App's own frame and input. The fast lane founds and loads on the map tests' fixture map, which a founding hands back at once or holds until cancelled; it covers every scene's flow, a founding cancelled, a save on another map refused with an offer to start fresh, a run out through every stop to its debrief, the compound's actions, the campaign's end, settings, and the store's round trips, statuses, and history; and the faces, loaded from beside the test's exe, where the build stages them as it does beside the game's, and a scene's text in its role's face. The slow lane runs the rules' own map making on the scenes' workers: Continue making a saved map again, and a founding cancelled part way.

## Rationale

The library is what lets the tests drive the real scenes without a window, and it's the balance sim's arrangement already. A job of its own per generation is the founding contract as the TypeScript had it, with the stop token doing what its worker's terminate did, and nothing about it is shared between scenes. Pressing through the App catches what calling a scene's method would miss, at the cost of finding components by id, which the dev server needs them to have anyway.

The rows show every number the rules work out and every reason they refuse, so the shell plays the whole loop with nothing re-implemented: each refusal on screen is a blocker's, and Start run tries the departure on a copy rather than repeating its checks.

No gameplay calls: the flow is Game Flow's, and the one rule load out adds, a run of one only when nobody else can be seated, is solo-driver-fights.md's.

## Salal gaps

- **A theme for every scene.** Each scene's ui context starts on ui's default theme, so a game's tokens and its font families (the roles display, body, and mono) have to be set on each scene's context by the scene, as `GameScene` sets the families. An App-level theme every scene's ui starts with is the generic shape, and the game will need it the day it has tokens.
- **Pushing a scene by name.** `SceneStack` pushes by type only; by name it can only reset (`switchTo`). The game resets everywhere a scene has no arguments (the settings over the menu, the area map over the compound), which rebuilds the scene underneath when it comes back.
- **The drag tier.** Closed by salal v0.39.0 (`ui/Drag.h`): a component declares itself a drag source or a drop target, the ghost lifts into the drag tier, and activate on a focused source picks it up for the keys.
- **A cancellable background job.** `MapJob` (run on a thread, progress and the result polled from update, cancel through a stop token) is nothing the game owns; if worldsim's world creator wants the same, it belongs in app.

## Consequences

- The whole loop plays headless: found, plan, load out, fight, take a find or an event, come home or fail, rest, scavenge, and fall, saved at every step and continued from the save.
- Nothing has been launched with a window. The checks owed once the machine is free: the game opens and draws its text in its own faces, headings in Barlow Condensed, prose in Open Sans, and figures in JetBrains Mono; `/api/ui/lint` is 0 on every scene, which no test checks; a real founding's progress moves with the frame responsive and Cancel works mid-generation; quitting and relaunching continues from the save, and the settings and window size come back; a run plays end to end with the mouse, wheel-scrolling long panels; a Release build opens no socket.
- The real screens need: the paper as a fill hook on salal's fill hooks ([procedural-paper.md](./procedural-paper.md)), with the rest of the art as flat-fill vector; the game's tokens as a theme (the gap above); icons through `salal_icons` (msdfgen then joins the vcpkg manifest as a host port), the driver and escort cards (Game Flow 7.0), and the compound's illustrated scene. The garage and the victory screen aren't scenes yet.
- The packs are read from the source tree, as the balance sim reads them, until playtest builds ship them (port plan step 7).
