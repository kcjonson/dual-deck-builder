# The campaign in the C++ alpha

## Date
2026-10-31

## Context

The first campaign slice of the port, in `libs/rules/campaign/`: everything the campaign does that doesn't need the area map. That's the model and its save, founding, the deck rules and the locker, run decks, and the combat bridge. The TypeScript's records say what each of those does ([campaign-state-model.md](./campaign-state-model.md), [campaign-founding.md](./campaign-founding.md), [campaign-save-and-load.md](./campaign-save-and-load.md), [locker-and-deck-rules.md](./locker-and-deck-rules.md), [run-decks.md](./run-decks.md), [cards-won.md](./cards-won.md), [combat-bridge.md](./combat-bridge.md), [campaign-end.md](./campaign-end.md)), and this one says how the alpha builds them and where it changed them.

The combat slices left the campaign its half of a fight: seating a hurt driver, the stage a fight grows by, revival and pickup after a win or a break-off (call 198), hauler dividends, and which escort brought each signature copy. A fight is a `BattleState` value, and its result is on the state.

Most of the TypeScript's campaign machinery was there because its state was mutable models with listeners: a checked `set` on every model, change events that could see half a card move, a registry of open fights, a set of campaigns partway through storing, and a `RunParty` the run controller held beside the campaign's run decks, checked against them by identity at every step. None of that has a reason to exist when the campaign is a value.

## Options considered

For the model:

1. **Port the models.** `Campaign`, `DriverRecord`, and `Convoy` behind checked setters, with their events. A great deal of code guarding against listeners, for screens that don't exist yet.
2. **A plain value with functions over it (chosen),** as the fight is. The functions are how play changes it, each checking what it's asked and keeping the invariants, and the save reader checks them all again.

For the run:

1. **A party the run controller holds,** saved beside the campaign, with the campaign holding the run decks, as the TypeScript had it. Every function that ends or fights a run then has to check the party against the run decks and the run id.
2. **The run is part of the campaign (chosen).** `Campaign::run` holds the run's id, its stage, each seat's run deck, the escorts that came along, the cargo and cards won, and how many fights it has written back. There's one value to save and nothing to keep in step with it.

For the campaign's pack files:

1. **Load them in `loadPacks`** with the rest of the content. Then the pack loader would depend on the campaign's types.
2. **A loader of their own over the same override rule (chosen),** which Pack.h already says the other folders get.

## Decision

**The model** (`Campaign.h`) is a `Campaign` struct: the packs it was made with, the seed, the day, the stores and unrest, the buildings standing, the driver pool, the locker, the convoy, the run out, and the counters that hand out ids.

- A driver's record keeps what play changes: their archetype, status, HP, injured days, their own vehicle's structure and armor, and their default deck. Their max HP, hand limit, skills, adrenaline, and the vehicle's maximums are the archetype's, read from the packs each fight (call 394), and a fight clamps the record to those maximums as they stand, so a retune never breaks a save.
- Records have no name. "Road Warrior 2" (call 4) is the archetype and how many of it joined the pool before them, which the pool already says, since it keeps everyone, the dead included.
- An escort in the convoy keeps its type and its structure, and the rest comes from its type (call 395).
- Ids come from saved counters, `driver-3`, `escort-2`, and `run-5`, and none is reused. Card copies have no identity, so decks, the locker, and cards won are card counts.
- Every draw forks from the campaign's seed by a name and a saved counter, so nothing is saved partway through a stream: founding deals on `fork("founding").fork("pool")`, and the run's next fight plays on `fork("run", n).fork("fight", fights)`.
- The log, the tally, and the campaign's end came with the second slice (The day, the infirmary, and the end, below), and the garage's stock and who a run found with the third (The garage, finds, and escorts on the road). The map's origin and what's changed on it came with the fourth (The map on the campaign).

**The save** (`CampaignJson.h`) is the campaign's JSON at `kSaveVersion`: 1 for this slice, 2 once the second added the log, the tally, and the end, 3 once the third added the garage's stock and who a run found, and 4 once the fourth added the map. The JSON carries the version, and the game hands the same number to salal's `SaveFormat` when it writes the JSON to a slot; writing to a slot is the game app's, through salal's `app`, since the rules can't depend on it. Any change to the JSON's shape bumps the version, and a save of another version doesn't load.

- It names its packs by id and version. A save loads only with every one of them loaded, and fails naming the one that isn't. A pack at another version loads, as long as everything the save names still resolves.
- `readCampaign` is strict: exactly its fields, every card, archetype, and escort type defined by a loaded pack, no signature card in a deck or the locker, ids in shape and under their counters, and every rule the campaign keeps holding (0 HP exactly when dead, injured days exactly while injured, a seated driver ready with their deck in their run deck, no card both left at home and borrowed, each escort along bringing one card). Anything else is a `ContentError` naming the path, `campaign.drivers[1].status`. The TypeScript let a save holding a card the packs had dropped load; the alpha fails it, since a save is pack content's to resolve and a silent gap is worse than a refusal.
- `writeCampaign` reads its own JSON back and throws `std::logic_error` if it doesn't come back as the campaign it was written from, so a bug that would write a save nothing can load fails where it happened.

**The campaign's pack files** (`CampaignRules.h`). `loadCampaignRules` reads each loaded pack's `campaign/` folder in load order: `start.json`, `deck-rules.json`, and `compound-rules.json`, the TypeScript's files as they were. Each is one object with no id, so a later pack's file replaces an earlier one's whole, and only when it requires that pack, directly or through another, the rule `loadPacks` holds content to (`packRequires`, in Pack.h). Every file has to come from some pack, the start's escorts have to be defined, and any other file in the folder fails. The compound rules are read and checked with the rest, so the whole folder is, and the day clock, the infirmary, scavenging, and the fall read them. A scavenging party's fuel has a least of 1, so the file can't be tuned into a soft-lock.

**Founding** (`Founding.h`). `foundCampaign` deals the pool as the TypeScript did, from the unlocked archetypes sorted, shuffled on the seed, and cut to the start's pool size, each recruited at full HP with their archetype's starting deck as their default deck, and takes the start's stores, escorts, and buildings, on day 1. The unlocked archetypes come in as a list; `unlockedAtStart` is the packs' own `unlocked` flags, until meta-progression keeps unlocks. Founding draws nothing but the deal and, since the third slice, the garage's first stock, each on its own stream; since the fourth it founds on a map made first, whose seed is the campaign's (The map on the campaign).

**The deck rules and the locker** (`Locker.h`). A move names a card, a count, and two places, the locker, a driver's default deck, or a seated driver's run deck, and `cardMoveBlocker` gives the rules' reason to refuse it as a `CardBlocker`, in the TypeScript's order: away, on the run, too few (or already borrowed by the other seat, or locked as an escort's card), the card marked for another archetype, a full deck, a deck at its minimum. `moveCards` asks the same and throws on a refusal, so a screen's greyed action and the move can't disagree, and a move no rule covers throws from both. The archetype marks are each card's `driverRestriction` in the packs. Scrapping pays `scrapPerCard` a copy.

**Run decks** (`RunDecks.h`). `startRun` seats one or two drivers by load out's own check, `seatBlocker` (injured, away, already seated, or a same-archetype pair while a mixed one is ready, call 35), moves each one's default deck whole into their run deck, and puts each escort's signature card in Driver 1's. Into a run deck the driver's own left at home come back first, and out of one borrowed copies go back first (call 136); only escort cards move between seats (call 137), and a reset leaves them (call 139). A load out given up unwinds everything; one that has fought or picked anything up can't be given up, since it has left. `unloadRun` is the run home: every run deck unwinds, then the cargo goes into the stores and the cards won into the locker. Cards won are the run's cargo until then (call 19), checked against the packs as they come in.

**The combat bridge** (`CombatBridge.h`).

- `startCampaignFight` builds the run's next fight: each seat at the HP and vehicle damage their record carries, clamped, dealt their run deck's own and borrowed copies in card order and then the escort cards; the escorts that came along in roster order at the structure they carry; and the encounter the caller picked, fielded at the run's stage on `nextFightSeed`, which `pickEncounter` takes too. `PlayerSeat` gained the HP, structure, and armor a seat opens with for it.
- A `CampaignFight` names the run and how many fights it had written back, and `writeBackFight` refuses any other, so a fight can't be written back twice or onto another run, and a fight started again after a reload is the same fight (call 65). No registry of open fights is needed.
- Won or broken off, the run carries on. Each seat keeps the HP and vehicle damage the fight left, a wreck limping on at 1 structure with no armor and armor past base dropped (calls 15, 16, and 393); a driver down is revived at 1 HP and one who crashed out is picked up, after a break-off as after a win (call 198). Wrecked escorts leave the convoy and their cards leave the run decks, read off `broughtBy`; the rest keep their structure. After a win each surviving hauler pays: fuel and scrap into the cargo, and the Med Truck's HP to every seat still above 0, capped at max, before anyone is revived (call 15).
- Lost, the run ends in the write-back: the down are dead, the rest missing (campaign-end.md), the dead lose their own and borrowed cards and what they left at home goes to the locker, the missing get theirs back (call 138), and the cargo, cards won, and every escort that came along are lost. The result names all of it for the debrief.

## Rationale

A value with functions is what the fight already is, and it makes the guards against half-stored changes unnecessary rather than something to get right. The run in the campaign removes a second copy of who's on it, which is where most of the TypeScript bridge's refusals came from. Reading the save as strictly as pack content is the fail-loud rule applied to the one input that lasts longest.

## Provisional calls

Pending Kevin's approval in [gameplay-calls.md](../gameplay-calls.md) (The C++ campaign).

- 393: a driven vehicle comes out of a fight with its armor at most its base, because heavy-armor.md has armor past base as plating welded on for the fight, and carrying it would let a Rig stack plating from fight to fight.
- 394: a driver's record keeps what play changes, and their max HP, hand limit, skills, adrenaline, and the vehicle's maximums are their archetype's, read each fight, because nothing changes one per driver yet and a retune should reach campaigns in progress.
- 395: an escort in the convoy keeps its type and structure, and the rest comes from its type each fight, reversing the TypeScript's saved stat block, because the battle seats an escort from its type and nothing changes an escort's stats yet.

## Consequences

- The rules can found a campaign, save and load it, run the Crew screen's and Customize's moves, send a run out, fight it through the bridge, and bring it home or lose it, all headless, and the balance sim can play a campaign's fights through the same bridge with the stand-ins.
- The garage's sales at home, a Find: driver's recruit and a missing driver found on a run, an escort joining or leaving mid-run, and Customize's choice of which stack a move takes from came with the third slice, and what's left needs the map (The garage, finds, and escorts on the road, Consequences).
- The run carries only what this slice needs; the supply run adds its route and progress to it.
- A save loads only with the packs it names, and no TypeScript save ever loads.

## The day, the infirmary, and the end

The second slice: the day clock and the scavenging party, the infirmary, the campaign's end, and the log and the tally they write. [day-clock.md](./day-clock.md), [scavenging-party.md](./scavenging-party.md), [injuries.md](./injuries.md), and [campaign-end.md](./campaign-end.md) are the rules, and their calls (30 to 43, 52, 64, 109 to 115, and 128 to 134) hold as they are, so this slice makes none of its own.

### Decision

- **The log and the tally** are on the campaign: lines dated the day they happened, in day order and none after today, and the runs home, runs failed, and fights won the defeat screen counts. Founding writes "Founded the compound." The save checks the log's order and that the tally counts no more runs ended than ids handed out, less the one out.
- **The day** (`DayClock.h`). `endDay` is a rest, and the end of every other day: a scavenging party's haul at dusk with its line, upkeep for the People there at dusk, each unit short costing people and unrest, a day off every injury, the short night's line, and the day turning, or the campaign ending when the night leaves no People with no run out. The map's day-end step, stop cooldowns, came with the map (The map on the campaign). `forecastNeeds` is the needs panel's.
- **Scavenging** is `scavenge`: the day's haul from the seed's `fork("scavenge", day)` (`rollHaul`, so the button can say it), then the night. `scavengeBlocker` refuses a campaign that's over, one at 0 People, and one with a run out.
- **The infirmary** (`Infirmary.h`). `unloadRun` now puts each seat home hurt in the infirmary for the HP missing over `hitpointsPerDay`, rounded up, so the caller's `endDay` after it is the first day out. `treatDriver` spends meds for days off, with `treatmentBlocker`'s reasons first. One function, `healDays`, takes a day off for a night and for a med, so a driver bought fit is the record a night would have left.
- **The end** (`CampaignEnd.h`). The bridge's write-back of a lost fight counts the run failed, logs the cargo it lost, and ends the campaign when every driver in the pool is dead or missing; `endDay` ends it at 0 People. The fall is read off the stores and unrest after that step, starved before rioted before disbanded, with one log line. Once `Campaign::end` is set every blocker gives `CampaignOver` first and every action refuses, and the save checks that the end is one the state shows.

### Consequences

- A run comes home hurt into the infirmary, a lost run ends the campaign when nobody's left, and a compound can starve, riot, or disband, all headless.
- The defeat screen's numbers that aren't the tally (days held, the dead and the missing, strongholds taken) are derived where it reads them.
- The save format went to version 2.

## The garage, finds, and escorts on the road

The third slice, and the last of what the campaign does without the area map: the garage's sales at home, a Find: driver's recruit and a missing driver found on a run, an escort joining or leaving mid-run, and Customize's choice of which stack a move takes from. Compound and Supply Runs (Buildings, The driver pool, Decks and the locker), Game Flow 4 and 5, and [find-stops.md](./find-stops.md), [escorts.md](./escorts.md), [run-decks.md](./run-decks.md), and [customize-screen.md](./customize-screen.md) are the rules. Where something needs a stop or a route, the campaign side takes a plain input instead: a stop's seed for who a find turns up, and an escort's type for one that joins.

The TypeScript never built a garage. It had `addToLocker`, which took whatever price its caller named, so the prices, the stock, and the repairs here are new, and provisional.

### Decision

- **The garage** (`Garage.h`) sells cards for the locker, hires escorts, and repairs, all for scrap from the stores, between runs only, whether or not its building stands (calls 396 and 397). Its numbers are pack content, `campaign/garage-rules.json`, the fourth file `loadCampaignRules` reads: the stock's size, a price for each rarity a shop sells, the scrap a point of repair costs, and a hire price for each escort type for hire, every one of them a type some pack defines.
  - The stock is the day's: `rollGarageStock` draws its different cards on the seed's `fork("garage", day)` at founding and at each dawn in `endDay`, and the campaign keeps it, each offer one copy, sold or not (call 398). It's saved rather than rolled again when asked, so an escort hired at noon can't change what's on the shelf.
  - The draw is `rollCardOffers` (`CardOffers.h`), the TypeScript's reward picker: a rarity at Card System Design's drop rates among those with a card left, then a card of it evenly, never a starter or a signature card, and order cards only while the convoy has an escort. The fight reward and Find: cards will draw the same way.
  - `buyCard` puts an offer's copy in the locker for its rarity's price. `hireEscort` pays and joins the convoy, any priced type, any day (call 399). `repairVehicle` puts points back at a price a point: an escort's structure, or a driver's own vehicle's structure and then its armor, up to the archetype's whole, which nothing else ever restores (call 400). `pointsToRepair` says what's missing.
  - Each has its blocker, one `GarageBlocker` in one order: `CampaignOver`, `RunOut`, then the action's own (`SoldOut`; `ConvoyFull`; `DriverAway`, `Undamaged`, and `TooManyPoints`, which isn't clamped), then `TooLittleScrap`, with the price.
  - There are no mods: nothing in the packs or the rules defines a vehicle mod yet.
- **The convoy** (`Convoy.h`). `joinConvoy` is how every escort joins, founding's starters and the garage's hires included: the next id, its type's full structure, last in roster order. With a run out it comes along at once, last among the run's escorts, and its signature card goes in Driver 1's run deck, which `moveEscortCard` gives to Driver 2 (call 402). `dismissEscort` sends one off for nothing; one along leaves the run, and its own copy leaves whichever run deck holds it, a second escort of its type keeping the copy it brought. `joinBlocker` refuses a fifth (`ConvoyFull`), and `dismissBlocker` refuses, with a run out, an escort that stayed home (`NotAlong`, call 403). The bridge's wrecks still leave by the write-back's own rule.
- **Drivers found and recruited** (`Recruits.h`).
  - `recruitDriver` is how every driver joins the pool, founding's deal included: the next id, the archetype's full HP, the vehicle whole, its starting deck. `driverName` is the name a screen or the log gives them, "Road Warrior 2" (call 4).
  - `whoIsFound` is who a Find: driver turns up, from the stop's seed: the first missing driver in pool order not found on this run already, or someone new, `recruitArchetype`'s, the unlocked archetype with fewest living drivers, the missing and recruits riding home counted, drawn on the seed among ties (call 211). An event's driver is `recruitArchetype` alone (call 273).
  - `takeFoundDriver` puts them on the run, the missing in `Run::found` and someone new in `Run::recruits`. `unloadRun` brings the found back in the pool, their vehicle at `kLimpStructure` with the armor the crash left, injured for the HP they're missing by the same `injureOnArrival` as the seats (call 41), and recruits someone new, with "Interceptor 2 joined the compound, found on the road." in the log. A lost fight's write-back names both in `RunLost`, and they go with the run: the missing stay missing, and someone new never joins (calls 43 and 212). A load out that has found anyone can't be given up.
- **Customize's stacks** (`Locker.h`). A `CardMove` can name its `copies`: coming out of a run deck the driver's own (`Own`) or borrowed ones (`Borrowed`), going in the driver's own from home (`Home`) or borrowed ones. Call 136's order still holds, through two more refusals: `OwnAtHome`, borrowing while some of the driver's own wait at home (call 54), and `BorrowedFirst`, leaving the driver's own at home while copies are borrowed (call 53), each with the copies that come first. `Own` going in, `Home` coming out, and copies named with no run deck at either end throw. A move naming none moves as before.
- **The save** goes to version 3, for the garage's stock and a run's `found` and `recruits`. It refuses an offer of a card no shop sells, one offered twice, a found driver who isn't one of the pool's missing or is listed twice, and a recruit of an archetype no pack defines.

### Provisional calls

Pending Kevin's approval in [gameplay-calls.md](../gameplay-calls.md) (The C++ campaign).

- 396: the compound's garage works whether or not its building stands, as the infirmary already does, because nothing builds a building yet (call 182) and a garage that waited for its own would never open.
- 397: the garage at home works only between runs, because the run's drivers and escorts are on the road, and a run's shopping is a roadside garage's.
- 398: the garage's cards are 4 different ones a day, one copy each, rolled at dawn at the reward's drop rates and pool and kept with the campaign, because Game Flow 4.2 has a shop offer 3 to 5 cards with a SOLD stamp, and the day is the compound's clock.
- 399: every escort type the garage file prices is for hire any day, as many as the convoy's four allow, because nothing in the spec rations escorts beyond the cap.
- 400: the garage repairs a driver's own vehicle too, a point at a time, structure before armor, because Combat Rules has a driver's vehicle carry its damage until it's repaired, and nothing else repairs one.
- 401: the garage's starting prices: 30, 50, 90, and 150 scrap for a common, uncommon, rare, and legendary card, 60 to hire an Outrider or a Pilot Car, 80 a Fuel Hauler, 90 a Med Truck, and 1 a point repaired.
- 402: an escort that joins on the road joins the run at once, its card in Driver 1's run deck, and with four in the convoy one is dismissed first, replacing call 270, because the run can deal a card mid-run now.
- 403: on the road only an escort along can be dismissed, because the ones at home aren't there to send off.

### Consequences

- The compound can buy, hire, repair, and dismiss, a run can take on an escort or a driver it finds and bring them home or lose them, and each Customize control can name its stack, all headless.
- Scrapping still pays 5 a copy, a sixth of the cheapest card's price, so it stays a way to thin the locker and isn't income (locker-and-deck-rules.md asked to look again beside the garage's prices).
- The save format went to version 3.
- What the campaign still needs from the map is in The map on the campaign, Consequences.

## The map on the campaign

The fourth slice, and the first on the area map: founding makes the map, the campaign keeps what makes it again and what's changed on it since, a load makes it again, the day end brings cleared stops back, and `gameStage` counts the strongholds taken. Supply runs and everything on the road come after, on `routeOffers` ([stops-and-routes.md](./stops-and-routes.md)). [campaign-founding.md](./campaign-founding.md), [campaign-save-and-load.md](./campaign-save-and-load.md), [map-pipeline-worker.md](./map-pipeline-worker.md), [stop-clearing.md](./stop-clearing.md), and Area Map Generation (Saving) are the rules.

### Options considered

What the save keeps of the map:

1. **The map's lines,** as Area Map Generation's Saving had it: the road network, rivers, shores, the route layer, and every stop, about 40,000 characters, with the land made again under them. A generator change could never move a campaign, but it's a format of its own to write, read, and keep in step with every stage, for saves that have no compatibility to keep.
2. **What makes it again, and a version,** the TypeScript's: the params, the attempts, and `AREA_MAP_GENERATOR_VERSION`, bumped by hand when a stage changes what it makes. A change whose author forgets the bump loads old saves onto another map, their ids naming other stops.
3. **What makes it again, and a fingerprint (chosen):** the params, the attempts by stage name, and a hash of what the campaign's ids name on the map, which a load checks against the map it made.

Whether a load hands back the map:

1. **Made on demand,** the campaign read alone and its map made when a screen asks. The map state's ids can't be checked until then, so a load could pass a save that fails later, and every caller wanting the map would need a cache of its own.
2. **Made by the load and returned with the campaign (chosen).**

### Decision

- **The model** (`Campaign.h`) gained `mapOrigin` and `mapState`.
  - `MapOrigin` is what makes the map again, fixed at founding: the params rolled from the seed, the map attempt and each stage's winning attempt by name (streams nest, so every one is needed), and the map's fingerprint.
  - `MapState` is what's changed since, by the map's ids: the POIs cleared, the legs runs charted, each stop cleared now or back since, as the TypeScript's `{stop, roll, cleared}`, and the strongholds taken, by their POIs. Each list runs in id order, each id once. What starts charted is the map's own starting knowledge, which isn't built yet, and isn't saved.
- **Founding** (`CampaignMap.h`, `Founding.h`). `makeCampaignMap(seed, mapContent)` rolls the params from the seed, makes the map, and records its origin. Past a seed's map attempts a release build goes on to the next seed, up to 4 (`kFoundingSeeds`, map-pipeline-worker.md's call 1), and the origin's params hold the seed it landed on; a debug build throws at once. `foundCampaign` takes the origin in `Founding`, and the campaign's seed is the map's, so the two can't disagree; the deal and the garage's stock draw on it as before. An origin on params the validator would change, or with no stage's attempt, is refused. The map comes back beside the origin for the game to keep, and since it's a whole generation, the game makes it off the frame.
- **The fingerprint** (`mapFingerprint`) is FNV-1a over what the campaign's ids name: each POI's type, ring, tier, and arrivals, the strongholds, the legs and each destination's last legs, which make its routes, and each stop's leg, type, skulls, stage, class, and biome, with each leg's stops and the contents' seed. Positions and lengths stay out, so a last bit of floating point can't fail a load whose play would be the same. The save writes it as 16 hex digits.
- **The save** goes to version 4, with `mapOrigin` and `mapState`. `readCampaign` reads them for shape: every parameter there, on the campaign's seed, and valid as they stand; a map attempt under 32 and each stage's under 8; the fingerprint in its digits; the lists in id order, no stop cleared after today, and none neither cleared nor back, which is a stop with no entry. Whether the attempts fit the pipeline and the ids are on the map waits for the map.
- **Loading** (`loadCampaign`) is how the game opens a save: `readCampaign`, then the map made again from the origin, each stage replayed once on the attempt that won it, unchecked, then `checkCampaignMap` against it.
  - Attempts that don't fit the pipeline fail before any stage runs.
  - A map with another fingerprint fails. That's what attempts that fit but didn't win make, and what another build's generator makes.
  - So does a POI, leg, or stop past the map's, and a stronghold taken that isn't a stronghold.
  - Each is a `ContentError` naming the path, `campaign.mapState.stops[2]`. It returns the campaign and its map as a `LoadedCampaign`, and the game holds the map beside the campaign. It takes as long as founding's map, less the attempts that failed.
- **The day end.** `endDay` brings back, as the day turns, every stop cleared `stopCooldownDays` or more before the new day, its roll up one, and `DayEnd::stopsBack` names them: one cleared on day 3 is back at the dawn of day 8. The 5 days are pack content now, `clearing.stopCooldownDays` in `campaign/compound-rules.json`. A night that ends the campaign doesn't turn the day, so nothing comes back on it.
- **The game stage.** `gameStage(campaign)` counts the strongholds taken off the map state, where its caller used to pass them.
- **The map today.** `mapToday(campaign)` is the map state as `routeOffers` reads it: the stops cleared and not back, each stop's roll, and the game stage. Every leg reads charted, as the map stands until it has starting knowledge and fog.

### Rationale

The fingerprint does what the generator version was for without anyone remembering to bump it: a change that moves what a save's ids name fails that save's load, and one that only moves the land under the roads, or a stage nothing reads, doesn't. Attempts are saved by stage name, so an inert stage after the stops, the dressing, can join without a save change, since the fingerprint doesn't read it and the replay can run an inert stage's first attempt where a save names none. Returning the map from the load puts every check a save needs in the one call that opens it.

No gameplay calls: stop-clearing.md's calls stand, and the cooldown moved into the pack at the same 5 days.

### Consequences

- A campaign is founded on its own map, saved with what makes the map again, and loaded with the map made beside it, all headless. The map state is saved and checked, though only the day end changes it yet.
- A change to map generation that moves a POI, a leg, or a stop ends every campaign in progress at its next load, with an error naming the fingerprint, as a change to the save format does. That's the trade for not keeping the map's lines while saves have no compatibility to keep; when saves have to outlive a generator change, the lines go in.
- Loading costs a whole generation, so the game loads off the frame, as it founds.
- Tests about everything but the map found on a stub origin, as the TypeScript's did, which `loadCampaign` refuses. The rest found on a map put together from the map tests' fixtures, so the fast lane makes no map of its own; making one and loading it again are in the slow lane.
- The save format went to version 4.
- What the campaign still needs from the map, in the order it should be built:
  1. Supply runs: `routeOffers` over the map and `mapToday`, a cleared POI's routes left out, and the run taking one at load out, its fuel paid at departure, `Run` holding the route and the stop it's at.
  2. Stops in order, each on the run's stream for that stop: a fight's skulls and tier for `pickEncounter`, then the reward picker on `rollCardOffers` into `addCardsWon`; Find: cards, Find: supplies with the haul the route rolled, and Find: driver handing its seed to `whoIsFound`; event stops, read from `packs/base/events/`, their costs from the cargo then the stores, their escorts through `joinConvoy` and their drivers through `recruitArchetype`; a roadside garage, with a stock of its own on the run's stream, paid for on the road and working on the run's seats and escorts; and hazards.
  3. The objective at the POI, its yields into the cargo, and the POI cleared.
  4. The return: the return ambush by game stage, then arriving home charts the legs driven and clears the route's stops in the map state, on the day, before `unloadRun` and `endDay`.
  5. The clock on the road, racing the dark, and fog of war, as the run reveals the stops ahead; `mapToday`'s legs then come from the starting knowledge with the charted legs over it.
  6. Strongholds: a stronghold run's boss fight, a stronghold taken in the map state, and the win (call 1).
