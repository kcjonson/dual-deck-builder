# Runs and Encounters

Status: designed 2026-10-17, not built. How a supply run is paced and how hard it is: how many stops a route carries and what they can be, what a fight is (a group of raiders arriving in waves), how difficulty grows over a campaign, and the targets runs are tuned to. The run itself (the loop, the drive, cargo, fog) is [Compound and Supply Runs](./Compound%20and%20Supply%20Runs.md); where stops sit on the map is [Area Map Generation](./Area%20Map%20Generation.md), stage 9; the fight rules waves add to are [Combat Rules](./Combat%20Rules.md); how all of it is measured is [Balance Simulation](./Balance%20Simulation.md).

## Kevin's rules

Decided by Kevin, 2026-10-17. Everything below serves these.

1. Every run has a fight.
2. No empty steps. Every stop on a run is something to play or decide.
3. Runs are a similar length: 3 to 4 stops early in a campaign, longer as it goes on. Distance (the destination's tier) sets the base, and game stage adds a stop or two late.
4. A fight is a group, 4 to 20 raiders to kill, reinforced partway through. Never a single vehicle.
5. A run clears its POI, so there's no reason to go back: a cleared POI is disabled. Cleared ground doesn't come back right away, and POIs are spaced out enough that clearing one doesn't make its neighbor too easy.

Also decided by Kevin that day:

- A stop type goes on the map only once the run can resolve it, and the cheapest kinds get built first.
- Where the player's starting cards make groups unfair (EMP Blast's stun lock, the Mechanic's starter dealing no damage, the Rig reaching one raider slot, raiders aiming at Driver 1 on ties), the fix here is on the raider side. The card fixes are Kevin's and stay open (DDB-492 to 495).
- Balance is tested by simulation: one sim shared by a command line tool and a browser Balance Lab.

## Run shape

A run is its route's stops in order, then the objective. The objective (Compound and Supply Runs, The loop) isn't one of the stops counted here.

### How many stops

A route's stop count comes from a band set by its destination's tier, not from the length of its road. Starting values, at game stage 0:

| Destination tier | Stops | Fights |
|---|---|---|
| 1 | 3-4 | 1-2 |
| 2 | 3-4 | 1-2 |
| 3 | 4-5 | 2-3 |
| 4 | 5-6 | 2-3 |
| Stronghold | 6-7 | 2-3, then the boss |

- Game stage adds calm stops on top: one from stage 2, two from stage 4 (see Game stage). Fights don't grow in number with the stage, they grow in size.
- The fight floor is never 0, so every route keeps rule 1. The per-route rules still hold: no more than two fights in a row, and a non-fight in any three.
- A checkpoint, once there is one, counts toward a route's fight ceiling, since it can turn into a fight, and not toward its floor.
- Inside its band a route still leans on its road: a long route sits at the top of its band, a short one at the bottom.
- When the clock and the band disagree, home by dark wins (Area Map Generation, guarantee 10), then the fight floor, then the band's minimum. A route can lose a calm stop to get home in daylight; it never loses its last fight.
- Stops are fixed with the map, so the route card shows what a charted route holds. The route card and departure read a route at today's game stage, and a run keeps the route it left with.
- Every route keeps its fight floor, and at least half its band (starting value), on its own road: legs no other POI's routes use. That's what spacing POIs out buys (rule 5): a run never loses its floor fights to stops another run cleared.

How the stops stage meets the bands on a route tree whose legs are shared is in Area Map Generation, stage 9.

### What a stop can be

Every stop is a fight or a stop with a choice in it. A stop type goes on the map only once the run has a screen that resolves it; until then its weight in the stop tables is 0, so a quiet stretch, a stop where nothing happens, never appears.

- What the least a calm stop can be is open question 5.
- The first calm stops are the cheapest to build:
  - Find: cards, through the reward picker a fight already uses.
  - Find: supplies, the haul the stop's contents already roll.
  - Find: driver, which has to come in the first batch because the map promises one within tiers 1 and 2 (Area Map Generation, guarantee 7).
- Next: a wreck (pick it over for scrap or a card, and some are bait for a fight), a roadside garage (repairs for scrap), and a hazard.
- Distress signals, checkpoints, and the richer wrecks wait on the event screen (Game Flow 5).

While few calm types exist, the tables lean on those, and a route's calm stops may repeat a type.

### Clearing

- A run clears every stop it resolves. A cleared stop stays cleared for a cooldown (starting value: 5 days), then comes back with its contents rerolled; its type is fixed with the map. A later run down that road drives past a stop still cleared: it isn't a step, so it isn't an empty one, and the route card shows it as cleared.
- A run that reaches its POI clears it, taking its yield, and a cleared POI is disabled: the area map shows it cleared, and it can't be planned (Kevin, 2026-10-17).
- A run sharing road with a POI cleared in the last few days is shorter than its band, by the shared stops still cleared. Its own road still holds its floor fights and at least half its band (How many stops), so it's never fight-free and never a free ride.

## Fights

A fight is a group of raiders arriving in waves. A fight stop's skulls (1 to 3, fixed with the map and shown on the route card) say how big a group it is.

### How big

Starting values for the raiders to kill:

| Skulls | Raiders | Waves | On the road at once |
|---|---|---|---|
| 1 | 4-6 | 2 | up to 3 |
| 2 | 6-10 | 2-3 | up to 4 |
| 3 | 9-14 | 3 | up to 5 |

- A warband adds a leader, an elite (Combat Rules, Enemy intents: an elite hides its values and its cards).
- Game stage grows a fight (Encounters, below), so a late warband reaches 20.
- A fight should take 4 to 8 turns. A group is mostly light raiders, so it goes down fast enough to fit.
- A lone driver meets the encounter's solo size: half its raiders, rounded up and never fewer than 4, cut from the last wave first. There's no separate solo adrenaline for raiders.

### Waves

Every raider on the road commits its turn at the start of the player's turn (Combat Rules, Enemy intents), and reinforcements keep that promise, the way Into the Breach's arrivals do: a wave is announced a turn ahead, pulls in between turns, and plans with everyone else. The rules are in Combat Rules, Reinforcements. In short:

- A wave is due when the road thins to its arrival count or its turn count has passed, whichever comes first, and the top bar announces it ("+3 arriving") with the rows it will take marked on the road.
- It pulls in at the end of the enemy turn, inside lane first, from the row the latest wreck left.
- Clearing the road early brings the next wave at the end of that enemy turn. The empty enemy turn is a breather, on purpose.
- No wave lands on the player's shoulder for now, since the Rig can't reach it (DDB-494).

The top bar's readout ("Wave 2 of 3", "+3 arriving") is the one [Battle Screen Design](./Battle%20Screen%20Design.md) already reserves.

### Raider-side rules that keep groups fair

Groups expose the gaps in the starting cards, and these rules work around them from the raider side (Combat Rules, Raider formation and stuns, and How a fight ends). Each is measured against the cards as they are.

- Close-up keeps the slot across from each driven vehicle filled, so a crew whose damage reaches one slot (the Rig's rams) keeps finding targets. It brings raiders into ram range as well, which raises their damage a little.
- Shake-off: a raider can't be stunned two enemy turns running, which halves EMP Blast's lock without touching the card.
- Rout: the rest flee when a warband's leader falls, or when the threat left is at or under a quarter of the start. It cuts a fight's long tail, the last raider alone, and ends one the crew has all but won. Threat is nominal (Encounters, below), so spreading damage around can't set it off early.
- Break-off: a fight going nowhere for three player turns ends with no reward. It's the backstop for a fight a crew can't finish, like a Mechanic facing a raider the Rig can't reach. What counts as going nowhere is open question 6.

### Winning and losing

A fight is won when every raider on the road and in the queue is out, or the rest rout; a break-off ends it with nothing won; losing and abandoning are as they were (Combat Rules, How a fight ends).

## Encounters

What a fight stop fields is an encounter: authored data, picked when the fight starts.

### Raider classes

| Class | Role | Threat |
|---|---|---|
| Mook | light and quick; one starter attack wrecks it or takes out its driver; plays one card a turn | low |
| Regular | the Rust Buggy | middling |
| Heavy | the Spike Buggy: soaks hits and hits hard | high |
| Leader | a warband's elite; hides its values; its fall routs the rest | highest |

- Every raider profile has a nominal threat, a number the balance sim measures (Balance Simulation, calibrate) and the data carries. Rout counts it.
- These are raider profiles like the two that exist, so they're raider-side tuning. Faction rosters come with the factions ([Faction Concepts](./Faction%20Concepts.md)); until then every territory fields the scavengers'.

### Encounter data

An encounter is a JSON template: the skulls and tiers it's for, and its waves, each a list of raiders with an arrival count and a turn count. Two or three templates for each skull count and tier band, so one stop doesn't always field one fight.

```json
{
	"id": "scav_pack",
	"skulls": 1,
	"tiers": [1, 2],
	"waves": [
		{ "raiders": ["scav_bike", "scav_bike", "rust_buggy"] },
		{ "raiders": ["scav_bike", "scav_bike"], "arriveAt": 1, "afterTurns": 2 }
	],
	"grow": "scav_bike"
}
```

- A fight picks its template from the run's fight stream, the one its shuffles already come from, so a fight replayed after a reload is the same fight.
- Skulls already rise with tier (Area Map Generation, stage 9), so there's no separate tier scale on a template; its tiers only say which roster it draws from as the map gets further out.
- Game stage grows a template: one more of its `grow` raider queued in its last wave for every two stages, and raider structure and HP up 5% a stage (starting values). The stage is the one saved with the run when it left.

## Game stage

Game stage is how far into the campaign it is: `floor(day / 8) + 2 x strongholds taken`, at most 6 (starting values). It moves three things:

- Run length: a route's calm extras, one from stage 2 and two from stage 4.
- Fight size: templates grow, as above.
- The return ambush (Compound and Supply Runs, Return): none before stage 2, then 3% a stage, up to 15% at stage 6.

Tier sets where a fight starts and stage lifts everything as the campaign goes on, so the near roads a late run still drives through aren't a free ride.

## Just hard enough

A fresh crew should come home from a run it ought to manage, and come home hurt, with the hurt costing days. Injury days are a driver's missing HP over 10 ([injuries.md](../AI_TECHNICAL_DECISIONS/injuries.md)), so a run's damage turns straight into drivers sitting out, and a pool of four has to rotate. Damage that matters, not damage that decides.

The targets are for every starting pair of different archetypes, fresh and on default decks, played by the balance sim's stand-in, over real routes from generated maps. They're starting values, and playtests move them.

### Per run

| Tier | Home | Crew HP and structure lost, over runs home |
|---|---|---|
| 1 | 95% or more | 20-35% |
| 2 | 88% or more | 30-45% |
| 3 | 75% or more | 40-55% |
| 4 | 60% or more fresh; 75% with a grown deck at stage 2 or later | 45-60% |

Per run is the target, and per fight follows from it, given how many fights each tier's runs hold. Starting values for one fight: 1 skull won 98% or more with 12-20% lost, 2 skulls 93% or more, 3 skulls 85% or more. No fight stalls: every one ends won, lost, or broken off.

### Over a campaign

A pool of four sending one run a day, to the tiers its stage reaches, keeps going: injuries leave a legal pair fit most mornings, and a driver lost on a run is rare enough for Find: driver to replace. The campaign sim measures it once there is one.

### Fairness

- Between the best and worst starting pair on the same runs: 15 points of home rate or less.
- Between the two seatings of one pair: 10 points or less.
- No crew comes through tier 2 or later losing under 5%.

These are reported from the start but don't count against a change until DDB-492 to 495 land, so raider tuning doesn't paper over the cards.

### The stand-in isn't a person

The sim's player plays worse than a person: the aggressive AI plays every card it can afford and never reads intents. Two things keep the targets honest. A second stand-in reads the raiders' intents a step ahead, so a target sits between a floor and a ceiling. And fights played by people get logged as their seed and the player's actions, so the sim can replay them and measure how much better people do (Balance Simulation, Calibration against people).

## What depends on what

- Waves need encounter data and the mook class to be worth anything, and the top bar's readout to be readable. Close-up, shake-off, rout, and break-off land with waves or before them.
- The stop bands need the first calm stops (the finds) at the same time, or the new stops would be empty.
- Game stage needs the day clock and strongholds taken, both of which exist; its extras need the bands.
- Clearing needs each stop's state in the save (the day it was cleared, its roll count) and the day clock's cooldown hook. Clearing a POI replaces the share-based POI depletion, and spacing POIs for their own road is a change to the POI stage.
- Every number here is tuned with the balance sim, so the sim comes first.

## Open questions

1. When POI objectives become encounters (Compound and Supply Runs, The loop, step 6), does a route's band come down by one, since every run would then end on a fight?
2. Should a bigger fight pay more: scrap a raider, or a better card pick?
3. Ambush waves onto the player's shoulder, once the Rig can reach it (DDB-494).
4. Does a cleared POI ever reopen, late in a campaign, or is it gone for good?
5. What's the least a calm stop can be? It has to be a choice (rule 2), and a find on its own is a gift, not a choice.
6. What counts as a fight going nowhere, for a break-off?
7. Does every raider class need a card that can hit every starting archetype's vehicle, so no crew is immune to a whole class?
