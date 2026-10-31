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
- Not in it yet: the map's params and attempts, what's changed on the map, strongholds taken, the log, the tally of runs and fights, and the campaign's end. Each comes with the code that needs it.

**The save** (`CampaignJson.h`) is the campaign's JSON at `kSaveVersion`, 1. The JSON carries the version, and the game hands the same number to salal's `SaveFormat` when it writes the JSON to a slot; writing to a slot is the game app's, through salal's `app`, since the rules can't depend on it. Any change to the JSON's shape bumps the version, and a save of another version doesn't load.

- It names its packs by id and version. A save loads only with every one of them loaded, and fails naming the one that isn't. A pack at another version loads, as long as everything the save names still resolves.
- `readCampaign` is strict: exactly its fields, every card, archetype, and escort type defined by a loaded pack, no signature card in a deck or the locker, ids in shape and under their counters, and every rule the campaign keeps holding (0 HP exactly when dead, injured days exactly while injured, a seated driver ready with their deck in their run deck, no card both left at home and borrowed, each escort along bringing one card). Anything else is a `ContentError` naming the path, `campaign.drivers[1].status`. The TypeScript let a save holding a card the packs had dropped load; the alpha fails it, since a save is pack content's to resolve and a silent gap is worse than a refusal.
- `writeCampaign` reads its own JSON back and throws `std::logic_error` if it doesn't come back as the campaign it was written from, so a bug that would write a save nothing can load fails where it happened.

**The campaign's pack files** (`CampaignRules.h`). `loadCampaignRules` reads each loaded pack's `campaign/` folder in load order: `start.json`, `deck-rules.json`, and `compound-rules.json`, the TypeScript's files as they were. Each is one object with no id, so a later pack's file replaces an earlier one's whole, and only when it requires that pack, directly or through another, the rule `loadPacks` holds content to (`packRequires`, in Pack.h). Every file has to come from some pack, the start's escorts have to be defined, and any other file in the folder fails. The compound rules are read and checked with the rest, so the whole folder is, though only the day clock, the infirmary, scavenging, and the fall will use them.

**Founding** (`Founding.h`). `foundCampaign` deals the pool as the TypeScript did, from the unlocked archetypes sorted, shuffled on the seed, and cut to the start's pool size, each recruited at full HP with their archetype's starting deck as their default deck, and takes the start's stores, escorts, and buildings, on day 1. The unlocked archetypes come in as a list; `unlockedAtStart` is the packs' own `unlocked` flags, until meta-progression keeps unlocks. There's no map to found on yet, so founding draws nothing but the deal.

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
- Not built, and none of it needs the map: the day clock and upkeep, the infirmary (injuries on arrival, meds), the scavenging party, the campaign's end and how the compound falls, the log and the tally the defeat screen reads, the garage's sales at home, a Find: driver's recruit, an escort joining or leaving mid-run, and Customize's choice of which stack a move takes from. A run that comes home doesn't injure anyone yet, and a lost run doesn't end the campaign when nobody's left.
- Needing the map: the map params and attempts founding makes the map from, map state and strongholds (so `gameStage`'s strongholds come from the caller), supply runs, routes and stops, the return ambush, and picking a fight's skulls and tier.
- The run carries only what this slice needs; the supply run adds its route and progress to it.
- A save loads only with the packs it names, and no TypeScript save ever loads.
