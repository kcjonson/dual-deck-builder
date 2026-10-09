# Fights with one driver (DDB-166)

## Date
2026-10-09

## Context

A player `Team` had to hold exactly two driven vehicles, and threw otherwise. Since 2026-09-25 defeat only needs one of your drivers still in the fight, so a fight can carry on after one goes down, but nothing could start a fight with one. Two cases hit that wall:

- Campaign mode's soft-lock, found by DDB-303's QA. A pool down to one driver at home can never send a run, so the campaign can't move. The provisional call for it (logged for Kevin with the other provisional calls) is that a run with one driver at home goes with one driven vehicle plus any escorts. Load out (DDB-320) and the run controller (DDB-322) build that call; this record is the combat half.
- DDB-152's review: a driven vehicle that converted to an escort when its driver died couldn't go into a new player `Team` either, since it no longer counts as driven.

The Symbiotic Driver System is built around two drivers, so the question was which of its rules lean on there being a partner, and what each does without one.

## Options considered

1. **Fill the empty seat with a stand-in**, an AI-driven or inert second driver.
   - Cons: a driver who isn't there would draw, count toward defeat, take wreck survivors, and show a hand, and every rule would need an exception for it.
2. **Keep two seats and let the second be empty**, with nulls through `Team`, `Battle`, the bridge, and the screen.
   - Cons: every reader of the seats grows a null check, for a state the rules already describe as "one driver left".
3. **One or two driven vehicles (chosen).** Almost every rule is already per driver, so a team of one mostly works as it stands; the work is the team's own counts, the bridge's seat checks, the AI's targets, and the dock.

## Decision

Option 3.

### The team

- A player `Team` holds one or two driven vehicles (`PLAYER_DRIVEN_VEHICLES` is the most), plus up to four convoy escorts, plus set-piece allies. None is refused, as is a third.
- A driver's vehicle that carried on unmanned (`Vehicle.carriesOnUnmanned`: an escort profile of no hired type, `convertToEscort`'s) can go into a new team beside one driven vehicle. It's still its driver's, so it counts toward the two drivers' vehicles, driven or carrying on unmanned, and not toward the convoy's four. `Team.convoyEscorts` is the convoy's own, the escorts that count toward the four, and `Battle` takes its convoy from it when a fight starts, so a vehicle carrying on unmanned from an earlier fight isn't refilled, paid out, or lost as the convoy's when this one ends. The campaign never does this, since the bridge builds each fight's driven vehicles fresh from the records; it's for a caller that carries a team from fight to fight.

### What leaned on a partner

Each was checked against the code and covered by `SoloDriver.test.ts`:

- **Shared resources.** There are none. Each driver has their own adrenaline pool, deck, hand, discard, and hand limit, and refills, draws, and discards their own each turn.
- **Turn order.** The player's side goes first and every driver acts in the one player turn, so a lone driver's turn is the same turn with one hand.
- **Defeat.** "No driver still in the fight" holds for one: a lone driver at 0 HP or crashed out loses the fight on the spot.
- **Wrecks.** A wreck's survivor goes to the partner's vehicle first, then the nearest escort with a free seat. With no partner, the lone driver goes straight to the nearest escort, and crashes out if there's none.
- **Cards.** No card in `cards.json` targets the partner alone, and none is `both_drivers`. Coordinated Attack is the only card that reads the partner, through its `partner_attacked` bonus. See the provisional calls.
- **The AI.** Every AI reads the other team's vehicles as a list, so raiders target, plan, and project against one player vehicle as they do against two. Player-side AIs never offered an order aimed at an escort (Draw Fire, Close Ranks): `AIPlayer` had no case for the `escort` target type, so it put up the card with no target, the battle refused it, and the turn stopped there. It now offers the team's own escorts in the fight as targets. A lone driver leans on escorts more than a pair does, so this mattered here first.

### The bridge

`startCampaignFight` takes a `RunParty` of one or two seats. One seat is checked by load out's own check (`getSeatBlocker`) alone; two are checked each alone and then as a pair, as before. The fight seats the lone driver at the wheel of their own vehicle, opening inside center, with the escorts that came along in roster order. `writeBackFight` was already per seat: after a win the lone driver goes on, and a lost fight leaves them dead (down) or missing (crashed out).

The campaign's run decks are one per seat, so a run out holds one or two (`readRunDecks`), and a run with one seat saves and loads. `startRunDecks` and `getSeatBlocker` are unchanged: when load out seats one driver is load out's call (DDB-320), which owns the pair rule.

### The screen

`PreparedCombat.drivers` is one or two drivers (`assertDriverSeats`: one, or two different ones). The dock keeps both halves, so the lone driver's hand and tab stay where a first driver's always are, at the width they always have. The second half is an empty seat: no tab and no fan, and a dim line where the fan would be, the same treatment as a driver who crashed out (`PlayerHandLayer.driverCount`). The log opens on the lone driver's name against the raiders.

The gallery's `battle-solo` scene is that fight: the Interceptor alone with an Outrider, a Fuel Hauler, and a Med Truck against the typical scene's three raiders. It runs in the battle fit suite with the mock's six, at every size and state, and has goldens at both gate sizes.

## Provisional calls

These unblock the build and aren't settled rules. They aren't in the specs, which still say a player team starts with exactly two driven vehicles until Kevin approves the call above. Each is a small change to flip.

1. **Coordinated Attack stays playable for a lone driver, and deals its base damage.** Its bonus needs a partner who attacked this turn, which a lone driver never has, but the card still hits for its printed damage, so it isn't dead in the hand. The `partner_attacked` condition has no handler in `Battle` at all, so a pair's Coordinated Attack also deals only its base damage today.
2. **A card whose only target is the partner would be unplayable without one, with the reason shown**, rather than fizzling. No card is like that yet, so nothing enforces it; the first one adds the check to `Battle.getCardBlocker`.
3. **A `both_drivers` card lands on the lone driver's own vehicle**, as it lands on the caster's for a pair. No card uses the target type.
4. **A lone driver whose vehicle is wrecked rides on in the nearest escort with a free seat**, and with none crashes out, which loses the fight and leaves them missing.
5. **A lone driver at 0 HP loses the fight at once, and the failed run leaves them dead.** There's no partner to win the fight and revive them. The fight log still says they're down before it says the fight is lost.
6. **The dock's second half is an empty seat**: no tab, no hand, and the line "Empty seat: one driver on this run". The lone driver keeps seat 1's colour and triangle mark whichever archetype they are, and an area intent still shows both marks.
7. **The escorts' cards go in the lone seat's run deck**, as they go in the first seat's for a pair.
8. **A driver's vehicle that carried on unmanned counts toward the two drivers' vehicles, not the convoy's four,** when a caller puts it in a new team, and the fight that ends doesn't treat it as the convoy's.

## Consequences

- Load out (DDB-320) can seat one driver as soon as it lets `startRunDecks` take one seat; the bridge, the run decks, and the save already take a run of one. The run controller (DDB-322) hands the bridge a party of one.
- Founding still needs two archetypes unlocked, and the campaign's starting pool still deals four; neither is about a run of one.
- A future card that reads the partner needs its lone-driver behaviour decided with it, against call 2.
- Coordinated Attack's bonus not landing for a pair is a bug of its own, outside this work.
