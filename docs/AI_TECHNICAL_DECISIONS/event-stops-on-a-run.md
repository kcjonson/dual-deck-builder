# Event stops on a run: wrecks and distress signals (DDB-535)

Date: 2026-10-19. Code: `_legacy/src/renderer/game/campaign/SupplyRun.ts` (`stopEvent`, `takeEventChoice`, `handOffFight`, `abandonHandOff`, and the hand-off in `startStopFight` and `finishStopFight`), `RunEvents.ts` (paying and applying an outcome), `SupplyRoutes.ts` (the `event` stop kind, `RUN_EVENT_TYPES`), `MapRoutes.ts` (`routeStop`, `stopKind`), `SupplyRunState.ts` (the `hand_off` phase, `handOff`, `escortsFound`), `SaveUpgrades.ts` (version 12), and `screens/run/RunScreen.ts` (`eventMount`). Specs: [Runs and Encounters](../specs/Runs%20and%20Encounters.md) (What a stop can be), [Game Flow and UI](../specs/Game%20Flow%20and%20UI%20Specification.md) 5. Builds on [event-screen.md](./event-screen.md), whose "What the run's hook-up has to add" this answers, [find-stops.md](./find-stops.md), and [stop-clearing.md](./stop-clearing.md).

## Context

DDB-45 landed the event content, the pure event model (`Events.ts`), and the event screen, and stopped short of the run: nothing on a run navigated to the event screen, and `routeStop` turned every wreck and distress stop into a quiet stretch. The screen applies nothing; it hands the run an `EventResult` through `onChoose` and leaves where to go to `onDone`.

## The stop

A wreck or distress stop is a `RouteStop` of kind `event` carrying its map stop type (`RUN_EVENT_TYPES`). Its event isn't fixed on the route: `stopEvent` picks it when the run gets there, on the run's stream for the stop (`fork('event', stop)`), then draws the outcome's landing on the same stream, so a load meets the same event and lands the same outcome (calls 253, 258). Picking at the stop rather than at departure keeps the saved route free of content ids, so editing events.json doesn't strand a run on the road.

`RESOLVABLE_STOP_TYPES` (map/StopData.ts) lists every map stop type the run resolves: the fights, the three finds, and wreck and distress; the stop tables weigh every other type at 0, so none is placed (DDB-524). `stopKind` (MapRoutes.ts) says how the run takes each type, a quiet stretch for any it has no screen for, and a test holds the types it doesn't take as quiet to the resolvable list.

## Taking a choice

`takeEventChoice` checks the choice against the party (`eventParty`, `resolveChoice`), pays its cost from the cargo and then the stores (call 251), and applies the outcome (`applyEventGains`): resources and settlers into the cargo, losses from the cargo then the stores and never below 0, cards into the cargo cards, drivers as recruits, an escort into `escortsFound`, and HP and structure on every seated driver and vehicle, a loss stopping at 1 and a gain at their most (calls 252, 259). Then one of three things, in the same `set`:

- An outcome that hands off to a fight leaves the run at the stop in the `hand_off` phase, with the choice saved (`handOff`).
- An outcome with the card picker opens the reward phase at the stop, the same picker a won fight or a Find: cards opens.
- Anything else drives on.

The event screen calls this from `onChoose`, and the run screen's hook saves at once, so what the screen shows next is what the save holds. When the step throws, the hook returns false and the screen keeps its choices up rather than showing an outcome the run never took. A reload mid-event, before a choice, finds the run still driving to the stop, and the screen opens on the same event.

## The hand-off

`handOff` is the event's id and the choice, from which `handOffFight` works the fight out again: its skulls and what winning gives. `startStopFight` fights it like a stop fight at those skulls, on the stop's fight stream. A win applies the fight's gains to the write-back's party, then opens the reward picker, as every won stop fight does (call 255; the content reader keeps the picker off an event fight's gains and off an outcome that hands off, and holds a fight's gains to gains, since the fight is the cost); the log and the run screen's report line carry the fight's text and what it gave. A break-off drives on with nothing more given. A loss fails the run as any stop fight's does. Like any fight, the fight under way isn't saved: a load finds the run at its hand-off, and the run screen offers Fight them. The event screen's highway goes into the fight only once the hand-off's save has landed; a save that failed or was refused goes back to the run screen with it, which says so or strands, as after any step.

A hand-off saved before its event or choice left events.json can't be fought. The save reader can't check it, since the run state module would have to import the event content, which imports the campaign; and refusing the save at load would cost the player the whole campaign for a content edit. So the run screen asks `handOffStands`, and when it doesn't, says so and offers Drive on (`abandonHandOff`), which drives past the stop with nothing more.

Options considered for the hand-off's state:

- Start the fight in the same step as the choice, saving nothing. A load would then find the run driving to the event with the outcome's gains already applied, and the event would open again: paid twice.
- Save the whole `EventResult`. Plain data, but it copies content into the save, and the fight's gains are all that's needed of it.
- Save the event and the choice (chosen), and land the outcome again from the stream's draw. Small, and the same draw gives the same fight.

## Escorts and drivers found

Escorts an event gives ride home in `escortsFound` and join the convoy in `arriveHome`, after the unload, or are left behind with a line in the log when the convoy is full (call 270). Drivers an event gives join `recruits`, the same list Find: driver uses, each of the archetype the compound has fewest living drivers of (call 273). Both are lost with a failed run.

## Clearing

An event stop is one of the run's steps, so getting home clears it with the rest (stop-clearing.md). A cleared one is driven past like any cleared stop, and one that's come back picks its event again on the next run's stream.

## Version 12 saves load

The run out has two new fields, so the save format goes to version 13. Version 12 saves load with `escortsFound: []` and `handOff: null`, since no version 12 stop was an event (`SaveUpgrades.ts`). Their routes keep wreck and distress stops as quiet stretches, as they were rolled.

## In the C++ alpha

Event stops wait for the map's stops. The campaign side of what they give is in `libs/rules/campaign/` (2026-10-31, DDB-573), and [campaign.md](./campaign.md) has how. What differs:

- An escort an event gives joins the convoy and the run at once through `joinConvoy`, its signature card in Driver 1's run deck, and with four in the convoy the player dismisses one along first (calls 402 and 403, replacing 270). So there's no `escortsFound` riding home.
- Drivers an event gives are `recruitArchetype`'s, riding home in the run's `recruits` as a Find: driver's someone new does.

## Provisional calls

None of these is in a spec. They're calls 270 to 275 in [gameplay-calls.md](../gameplay-calls.md).

1. An escort an event gives joins the convoy when the run gets home, is lost if it fails, and is left behind with the convoy full (call 270, replaced by 402 in the C++ alpha).
2. An event's extra hours do nothing until the run keeps a clock (call 271).
3. A hand-off's fight is a stop fight at its skulls, a win goes to the reward picker after its gains, and a break-off drives on with nothing more (call 272).
4. Drivers an event gives are someone new of the archetype the compound has fewest of, never a missing driver (call 273).
5. The run screen offers only Pull over at an event, since every event's own Drive on passes it up (call 274).
6. HP and structure an event gives stop at their most (call 275).

## Consequences

- Checkpoint, hazard, Find: settlers, and Find: vehicle need only content (and, for a checkpoint, nothing new: its hand-off is this one) to join `RUN_EVENT_TYPES`; the garage is a shop, not an event.
- Mid-run escorts (riding with the run, their signature cards dealt in) wait for DDB-153's acquisition rules.
- The event screen still reopens on a result only from the gallery; the run never needs it, since it saves the step and leaves the screen.
