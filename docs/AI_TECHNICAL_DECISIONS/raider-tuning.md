# Raider encounter tuning (DDB-462)

Date: 2026-10-10. Code: `src/renderer/game/mechanics/Raiders.ts` (the profiles, `soloAdrenaline`), `campaign/Encounters.ts` (the table, where a lone raider opens, sizing up the crew), `campaign/SupplyRun.ts` (`startStopFight` hands over the seats' structure), `campaign/CombatBridge.ts` (`openingStructure`), `screens/combat/CombatScreen.ts` (the skirmish), and `scripts/raider-sim.mjs`, the fight simulator. Replaces the encounter table in [mvp-supply-run.md](./mvp-supply-run.md), and leans on [combat-bridge.md](./combat-bridge.md), [solo-driver-fights.md](./solo-driver-fights.md), and [stops-and-routes.md](./stops-and-routes.md). Rules it works inside: Combat Rules, The road (an encounter may give a raider its opening slot), Enemy intents (raider archetypes), and the hit rule.

## Context

The MVP supply run's stand-in table fielded one Rust Buggy at one skull, two at two, and a Rust Buggy beside the Raider archetype's Spike Buggy at three. Playtests found a lone driver losing to the one-skull Rust Buggy in two turns, Interceptor pairs taking no damage because every Precision Shot at the bike missed, and a Mechanic and Road Warrior crew losing three fights of three. On real maps tier 1 legs are all one skull, tier 2 mostly one or two, and tier 3 mostly two (stops-and-routes.md), so one and two skulls are most of what a run meets.

The aim, per skull count, for every crew the starting pool can send (each pair of different archetypes, and each driver alone), fresh and on default decks: at one skull a pair wins about 85 to 95% and comes home with damage that matters but doesn't cripple, and a lone driver wins more often than not; at two a fresh pair wins about 60 to 75% and a lone driver seldom; at three a fresh pair wins about 35 to 55%. No crew immune at two skulls, none hopeless at one.

## The simulator

Nothing headless played a whole fight with both sides deciding, beyond `SeededFight.test.ts`'s random AIs, so `scripts/raider-sim.mjs` does. Like `road-network.mjs` it transpiles the game modules it reaches into a temporary folder and runs them in a child process, one process, no workers. Each fight seats the crew as the combat bridge does (the archetype's skills, vehicle, adrenaline, and starting deck, full HP), builds the raiders with `encounterTeam` as a run's stop does, and plays it with the aggressive AI on both sides through `AIController.playPlayerCards` and `endPlayerTurn`. A pair swaps seats on every other run, so both seatings count equally, and the by-seat column splits them. A route (`1+2`) carries each won fight's damage into the next the way the bridge writes it back, a driver down revived at `REVIVE_HP` and a wreck at `LIMP_STRUCTURE`; armor carries too. A fight still going after 25 turns is a stall, which a player can only abandon. `--set` tries a profile or table change without touching the source, and `--log` prints one fight.

```
node scripts/raider-sim.mjs --fights 150 --routes 1,2,3,1+1,1+2,2+1
```

It takes about 20 seconds. The tables below are seed 1, 150 runs a cell.

The player side is a stand-in. The aggressive AI plays every card it can afford, damage first, never reads the raiders' intents, and doesn't hold Armor Plating for the big hit, so a person should do somewhat better than these rates, and a person who finds the Mechanic's stun lock (below) does what the AI does.

## What the baseline showed

1. A hit is a comparison, not a roll: gunnery has to beat evade plus the card's modifier, and a ram needs ramming at least the evade. The Interceptor's evade is 8, the Rust Buggy's gunnery 6 and ramming 5, the Spike Buggy's ramming 7, so nothing either raider carried could touch the bike. The aggressive AI doesn't check a hit before aiming, so it kept shooting at it.
2. The Rust Buggy's starting 3 adrenaline never applied: `Battle.start` refills every driver before the raiders plan. At 10 it drew its whole five-card deck and played all of it every turn, three Precision Shots and two Ramming Speeds, 69 damage.
3. The Road Warrior's only damage is Ramming Speed, range 1, so the Rig reaches exactly one raider slot, the enemy inside lane in its own row. A lone raider filled inside center, across from Driver 1, and a Rig in seat 2 sat the fight out; with a Mechanic beside it the fight never ended.
4. EMP Blast stuns every raider for its turn. The Mechanic's eight-card starter shows it nearly every turn (five drawn, two Nitro Boosts drawing two more, and the deck cycling every other turn), and in the sim no raider facing a Mechanic pair played a single card.
5. The Mechanic's starter has no damage card, so a Mechanic alone can't win anything; it stun-locks the raider until the player gives up.
6. The Spike Buggy was the Raider archetype's kit as it stands. Under the AI it plays Berserker for adrenaline, three HP off its own driver and Vulnerable each time, and Flanking Maneuver carries it onto your shoulder, out of its own rams' reach, so mostly it hurt itself.

Points 4 and 5 are the player's cards, which this change doesn't touch, and 3 is the Rig's deck against the road's rules, so they bound what raider tuning can do; they're follow-ups, not settled here.

## Options considered

1. **Raider stats alone, the table as it was.** Halving the Rust Buggy's refill and raising its gunnery fixes the solo fight and the immune bike, but a Rig in seat 2 still can't reach a lone raider, two Rust Buggies at two skulls still leave a Rig and Mechanic crew a raider it can never reach, and the Spike Buggy at three still mostly hurts itself.
2. **Gangs from two skulls up, one raider facing each seat.** The natural reading of more skulls, and the gang version of two skulls lands near 50% for the Road Warrior and Interceptor. But the Rig reaches one raider, so a Rig and Mechanic crew can't clear any gang, and two skulls is the common fight past tier 1.
3. **Targeting: a raider going for the vehicle with the most structure, or checking a hit before it aims.** Both change rules the specs own (an archetype's preference) or every fight's planning, and once the Rust Buggy's gunnery reaches the bike there's nothing left for a hit check to save.
4. **One raider at one and two skulls, placed where the Rig reaches it, a gang at three, and a lighter turn against a lone driver (chosen).** The smallest set of table and stat changes that gives every starting pair a fight it can win at one and two skulls.

## Decision

Option 4.

- The table: one Rust Buggy at one skull (Scavengers), one Spike Buggy at two (Spike raider), two Rust Buggies at three (Road gang).
- A lone raider opens on the enemy inside lane across from the crew's vehicle with the most structure as the fight opens, Driver 1's on a tie, where a ram from either side reaches. The encounter gives it that slot, which The road allows. `encounterTeam` reads `crewStructure`, each seat's opening structure in seat order; `startStopFight` hands over `openingStructure` of each seat, the record's structure clamped to the archetype's maximum as the bridge clamps it. A gang, or a lone raider with no crew given, fills the opening order as before.
- Against a lone driver every raider refills to its `soloAdrenaline`, since a lone driver brings half a pair's guns and so gives the raider about twice the turns.
- Rust Buggy: refills to 5 against a pair, two of its cards a turn (was 10, all five), 3 against a lone driver, one card; gunnery 9 (was 6), so its Precision Shots hit everyone, the bike included. Ramming 5, evade 4, 30 structure, armor 5, 30 HP, and its deck are as they were.
- Spike Buggy: a raider profile of its own, keeping the archetype's ramming 7, evade, speed, vehicle, and name. Gunnery 9 (6), 85 structure (65), armor 8 (2), driver HP 85 (33), refills to 7 against a pair (5) and 3 against a lone driver, deck Ramming Speed 3, Precision Shot 2, Armor Plating 1 (the archetype's is Berserker 3, Ramming Speed 2, Flanking Maneuver, Repair Kit, Armor Plating, Nitro Boost). The player's Raider archetype is untouched.
- The profiles drop their starting adrenaline: a raider starts a fight at what it refills to, which `Battle.start` already made true.
- The combat screen's skirmish fields the one-skull encounter against its pair, so its Rust Buggy also opens across from the tougher vehicle. One profile still serves both, so the skirmish didn't need its own.

## Results

Fights won, with the HP the crew lost over the fights it won in brackets; a stall is a fight still going at turn 25. RW is the Road Warrior, Int the Interceptor, Mech the Mechanic.

| Crew | 1 skull, before | 1 skull, after | 2 skulls, before | 2 skulls, after | 3 skulls, before | 3 skulls, after |
|---|---|---|---|---|---|---|
| RW + Int | 100% (19%) | 100% (16%) | 100% (56%) | 75% (62%) | 100% (27%) | 50% (55%) |
| RW + Mech | 50% (1%), 49% stall | 100% (0%) | 0%, 99% stall | 100% (0%) | 0%, 99% stall | 0%, 99% stall |
| Int + Mech | 100% (0%) | 100% (0%) | 100% (1%) | 100% (1%) | 100% (1%) | 99% (0%) |
| RW alone | 0% | 100% (27%) | 0% | 4% (91%) | 0% | 0% |
| Int alone | 100% (0%) | 100% (40%) | 100% (0%) | 0% | 100% (0%) | 0% |
| Mech alone | 0%, 99% stall | 0%, 100% stall | 0%, 99% stall | 0%, 100% stall | 0%, 99% stall | 0%, 100% stall |

After the change a Road Warrior and Interceptor pair goes down a driver in none of its one-skull wins, 83% of its two-skull wins, and 59% of its three-skull wins.

Routes, each fight carrying the last one's damage:

| Crew | 1+1, before | 1+1, after | 1+2, before | 1+2, after | 2+1, before | 2+1, after |
|---|---|---|---|---|---|---|
| RW + Int | 100% (27%) | 100% (30%) | 100% (57%) | 55% (71%) | 100% (60%) | 74% (64%) |
| RW + Mech | 50%, 49% stall | 100% (1%) | 0%, 99% stall | 99% (0%) | 0%, 99% stall | 100% (1%) |
| Int + Mech | 100% (1%) | 100% (1%) | 100% (1%) | 99% (1%) | 100% (1%) | 100% (1%) |
| RW alone | 0% | 100% (57%) | 0% | 0% | | |
| Int alone | 100% (0%) | 95% (78%) | 100% (0%) | 0% | | |

The Road Warrior and Interceptor's rates split by who sits in seat 1, Road Warrior first then Interceptor first: 100/100 at one skull, 100/49 at two, 100/0 at three, 99/12 on 1+2, and 100/48 on 2+1. A raider facing two equally healthy vehicles aims at the first in the team's order, Driver 1, and keeps aiming at whoever is hurt worst; with the Interceptor in seat 1 the bike goes down first, and at three skulls the raider across from it is out of the Rig's reach. Drawing between equal targets on the fight's AI stream evens it out, 73/76 at two skulls, 52/49 at three, and 44/45 on 1+2, with the same averages, but it changes every raider's planning, two combat screen tests lean on raiders focusing one vehicle, and it showed an intent row glitch (a leaving pill overlapping the one that slides into its place), so it isn't in this change.

Against the aim: one skull lands a little easy for pairs (100%, about a sixth of the crew's HP) and lone drivers win it every time with a quarter to two fifths of their HP gone; two skulls lands at the top of its band for the only pair the raiders can reach; three skulls is in its band on average; and no crew is hopeless at one skull but the lone Mechanic. The Mechanic pairs stay untouched at every skull count and the Rig and Mechanic pair can't clear a three-skull gang, both from the player's side, above.

## Provisional calls

None of these is in a spec.

1. The encounter table: one Rust Buggy at one skull, one Spike Buggy at two, two Rust Buggies at three. A gang waits for three skulls because the Rig only ever reaches one raider.
2. A lone raider opens on the inside lane across from the crew's vehicle with the most structure as the fight opens, Driver 1's on a tie; a gang fills the opening order.
3. Against a lone driver every raider refills to its solo adrenaline: 3 for both raiders, one card a turn.
4. The Rust Buggy refills to 5 against a pair and shoots at gunnery 9.
5. A raider starts a fight at the adrenaline it refills to.
6. The Spike Buggy's raider profile: gunnery 9, 85 structure, armor 8, driver HP 85, refills to 7 against a pair, and a deck of Ramming Speed 3, Precision Shot 2, and Armor Plating 1.
7. The combat screen's skirmish is the one-skull encounter against its pair.

## Not settled here

- EMP Blast in the Mechanic's starting deck keeps every raider skipping its turn, so Mechanic pairs come through every fight untouched whatever the raiders are.
- The Mechanic's starting deck deals no damage: a lone Mechanic can't win, and beside the Rig a fight with a raider out of the Rig's row can't end.
- The Rig reaches one raider slot, so a crew relying on it can't clear a gang.
- Raiders open on Driver 1 when targets tie, so seat order decides some fights outright.
- The player side of every number here is the aggressive AI.

## Consequences

- Retuning is a rerun: `--set` tries a change, and the command above regenerates both tables (run it against the old profiles for the before columns).
- The combat screen's skirmish and a run's one-skull fight are the same fight now, so tuning one tunes both, placement included.
- A raider's intents change with the profiles: the Rust Buggy plans two cards a turn where it planned five, so screens and goldens showing its pills change.
- `encounterTeam` needs the crew to place a lone raider; anything that builds an encounter without it gets the old opening order.
