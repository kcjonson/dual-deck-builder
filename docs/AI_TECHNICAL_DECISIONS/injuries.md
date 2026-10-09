# Injuries and the infirmary (DDB-304)

Date: 2026-10-08. Code: `src/renderer/game/campaign/Infirmary.ts` and `Seating.ts`, with the numbers in `src/renderer/game/data/compound-rules.json` (`infirmary`). Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The driver pool; Resources; Buildings), [Game Flow](../specs/Game%20Flow%20and%20UI%20Specification.md) (1.2 Load Out). Builds on [day-clock.md](./day-clock.md), [combat-bridge.md](./combat-bridge.md), [campaign-state-model.md](./campaign-state-model.md), and [locker-and-deck-rules.md](./locker-and-deck-rules.md).

## Context

Driver records already had an injured status and `injuredDays`, and `endDay` took a day off each night and set a driver who got to 0 ready at full HP. Nothing put a driver in the infirmary, though, meds did nothing, and the only thing refusing an injured driver a seat was the combat bridge, by throwing. The run controller (DDB-322) needs something to call when a run gets home, the infirmary screen (DDB-301) an action that spends meds and a reason when it can't, and load out (DDB-320) a reason under each driver it won't seat.

All of it fits in fields a save already has (status, `injuredDays`, HP, the stores' meds). So it's module functions over the campaign's public API, as the day clock is, with no change to `Campaign.ts` or the save format.

## Coming home

`injureOnArrival({ campaign, drivers })` takes the seats of a run that got home, as the bridge left them. A driver below max HP is injured for `injuryDays`: the HP they're missing over `infirmary.hitpointsPerDay`, rounded up. Their HP stays where they came home with it. It returns the injuries (driver, HP missing, days) frozen; the injured records emit, the campaign doesn't.

It refuses, changing nothing, while the campaign's fight is open or partway through its write-back (`hasOpenFight`, from the bridge), since the write-back has to fit the records as the fight left them. It refuses a driver outside the pool, one listed twice, or one who isn't ready, too. A run leaves with ready drivers, on the road only a failed run changes a seat's status, and a failed run never gets home, so a dead driver here is the caller's bug. `injuryDays` throws at 0 HP for the same reason: the dead aren't injured.

The run controller calls it after unloading the cargo and before `endDay`, so the night home is the first day in the infirmary. That keeps `injuredDays` meaning one thing everywhere, day ends until fit, which load out shows as "fit in N days".

## A day off is one step

`healingChanges({ driver, days })` is the only place a day comes off: fewer days left, or ready at full HP with none. `endDay` takes one a night through it, and the meds action as many as were bought, so a driver bought fit is the record a night would have left.

## Meds

`treatDriver({ campaign, driver, days = 1 })` spends `days` times `medsPerDay` meds from the stores and takes that many days off. A driver left with none is ready at full HP straight away and can go out today. `getTreatmentBlocker` says why not first, as `getCardMoveBlocker` does for the locker:

- `not_injured`, with the driver's status;
- `too_many_days`, with the days they have left;
- `too_few_meds`, with the meds needed and held.

`treatDriver` throws a `TreatmentRuleError`, a `RangeError` carrying the same blocker, so the screen's disabled button and the action can't disagree. A driver from outside the pool, or days that aren't a whole number from 1, are bugs rather than reasons, and throw from both. `treatmentCost` prices the button. The record is stored before the campaign, so the campaign's `change`, which the screen listens to, comes once the treatment is whole.

Rejected: meds put on a driver for the night, doubling that night's healing. That's new state on the record (a schema bump), its effect only lands at dawn, and the spec asks only that meds speed healing up.

## Seating

`getSeatBlocker({ campaign, driver, partner })` says why load out won't seat a driver beside whoever holds the other seat, in this order:

- `injured`, with `injuredDays`, for "Injured, fit in 2 days";
- `driver_away`, for any status but ready (dead and missing today), so a status added later isn't seatable until someone says it is;
- `already_seated`, when the partner is the driver, so the driver in seat 1 isn't faded as their own partner;
- `same_archetype`, naming the partner, for "Same archetype as a seated driver".

`startCampaignFight` refuses its seats through the same check, asking it of each seat alone in seat order and then of the pair, so a seat's own reason wins over the pairing's, the order the bridge's refusals have always had. It's in `Seating.ts` rather than the infirmary, since most of its reasons aren't injuries.

## Rules

Two values beside the day clock's in `compound-rules.json`, read by the same strict reader as whole numbers from 1 to 100:

| Value | Start | Why |
| --- | --- | --- |
| `infirmary.hitpointsPerDay` | 10 | a provisional call, below |
| `infirmary.medsPerDay` | 1 | a provisional call, below |

Nothing here draws randomness.

## Provisional calls

Each is a value or a line or two to change, and none is in the spec.

- Days are the HP missing over 10, rounded up. Absolute HP rather than a share of max: a Road Warrior at 1 HP (39 down) is out 4 days, an Interceptor at 1 HP (24 down) 3. Scaling by the share of max HP instead is one line in `injuryDays`.
- Any HP missing injures. 1 HP down is a day, and since the night home is that day, the driver is ready at dawn at full HP: a scratch costs no run. HP a driver can come home down and stay ready would be one more rule value.
- The night home is the first day in the infirmary (arrival before `endDay`). Arrival after `endDay` would cost every hurt driver at least one run.
- A driver the partner revived at `REVIVE_HP` comes home injured like anyone else at that HP: 4 days for a Road Warrior, 3 for an Interceptor.
- HP stays where a driver came home with it until they're fit, then fills, as the day clock already had it. HP rising 10 a night would show the same days on a filling bar; one line in `healingChanges`.
- A med takes a day off. Meds can be spent at any time, on as many days as there are, so a driver can be bought fit and seated the same day. The founding stores hold 3.
- Treating more days than are left is refused, not clamped to what's left.
- Only the injured are treated. A ready driver below max HP isn't in the infirmary, and arrival never leaves one.
- Coming home writes nothing in the log; that's the debrief's call, as for the bridge.

## Consequences

- The run controller's arrival (DDB-322): unload the cargo, `injureOnArrival({ campaign, drivers: party.seats })`, count `runsCompleted`, `endDay`, then checkpoint. A failed run has no arrival.
- The infirmary (DDB-301) lists the injured with their `injuredDays`, prices days with `treatmentCost`, disables with `getTreatmentBlocker`, and calls `treatDriver` then `CampaignStore.checkpoint`, recomputing on the campaign's `change`.
- Load out (DDB-320) asks `getSeatBlocker` of each driver in the pool, with the other seat's driver as `partner`, and words the reason itself.
- Infirmary upgrades (DDB-309) can tune `hitpointsPerDay` or `medsPerDay` by building level, or take more than one day off a night in `endDay`.
- No save format change: everything here lives in fields a save already holds.
