## Entity Types

- Team
- Vehicle  
- Driver

### Team

- Properties
  - Type: Player or Enemy
  - Vehicles: Array of vehicles. Player teams start with exactly 2 driven vehicles, plus up to 4 escorts in formation (see Escorts), plus any vehicles the encounter starts on the enemy shoulder (ambush starts, see The road). Enemy teams are variable.
  - Up to 9 vehicles on the road per side: 6 in formation and 3 on the shoulder. A flanker keeps its formation slot reserved, so a side only gets past 6 through ambush starts.
- Derived States
  - Defeated = All drivers dead. Escorts never count.

### Vehicle

- Properties
  - Armor: 0 - infinite
  - Structure: 0 - infinite
  - Base Speed: 1-5
  - Driver: driver (driven vehicles) or none (escorts)
  - Passenger: driver (optional)
  - Crew skills (escorts only): Gunnery, Evade, Ramming, 0 - 10
  - Statuses: 
    - Vulnerable - The vehicle is exposed and unprepared for attack
- Derived States
  - Alive = Structure > 0
  - Speed = Driver speed + vehicle base speed. An escort's speed is its base speed.
  - Escort = no driver
  - Ready = an escort that hasn't acted this turn

### Driver

- Properties
  - Hitpoints: 0 - infinite
  - Speed: 1-5
  - Individual Adrenaline Pool: 0 - infinite (refills each turn)
  - Individual Hand of Cards: drawn from their personal deck
  - Individual Discard Pile: their played cards
  - Role: Active (driving) or Passenger
  - Skills 0 - 10
    - Ramming
    - Gunnery
    - Evade
- Derived States
  - Alive = Hitpoints > 0
  - Can Play Attack Cards = Role is Active (passengers cannot play attack cards)
  - Can Play Order Cards = always, active or passenger (orders are their own card type, not attack)

## Game State

### The road

Both teams drive the same direction on a wide freeway. The road is a grid of slots, one vehicle per slot. Lanes across the road, left to right, and who may use them:

| Lane | Used by |
|---|---|
| Player shoulder | enemy flankers only |
| Player outside | player formation |
| Player inside | player formation |
| Enemy inside | enemy formation |
| Enemy outside | enemy formation |
| Enemy shoulder | player flankers only |

Each lane has three rows along the road: ahead, center, behind. A team's formation is its inside and outside lanes by three rows, six slots. A shoulder is only for flankers from the other team; nobody parks on their own shoulder. "Ahead" and "behind" replace the old "front" and "back"; the old Front / Back / Flanking positions map to inside / outside / the far shoulder. Screen layout is in [Battle Screen Design](./Battle%20Screen%20Design.md).

Opening placement: a vehicle whose encounter gives it a slot starts there; the rest fill their own formation inside lane first, center then behind then ahead. So the player's two vehicles start inside center and inside behind. Escorts place after the driven vehicles: each takes its type's preferred slot, or the next free slot in that fill order if the preferred one is taken.

Ambush starts: an encounter can start a vehicle already flanking, on the other team's shoulder in a row the encounter names. Raider reinforcements do this, and so can an escort in a set piece. An ambusher has no reserved formation slot and no outran vehicle. It counts as flanking for every rule that asks. This is the only way a side reaches 9 on the road: 6 in formation and 3 on the shoulder. Without it, every flanker leaves a reserved slot behind and a side caps at 6. The battle screen mock's Full road scenario is legal only as an ambush start.

### Flanking

- A flank card targets the vehicle to outrun. The target must be in the other team's formation (not itself flanking) and slower than the flanker.
- The flanker moves to the far shoulder, in the row of the vehicle it outran. If that shoulder slot is taken, the flank fails and the card goes back to the hand.
- Its old formation slot stays empty and reserved; the rest of the convoy doesn't shift. Swerving again from the shoulder keeps the original reservation.
- At the end of every turn (yours and the enemy's), a flanker that is no longer faster than the vehicle it outran loses flanking and returns to its reserved slot. If the vehicle it outran is wrecked, it holds the shoulder. A flanker with no reserved slot (an ambush start) holds the shoulder too, for the same reason: there's nowhere to drop back to.
- Flanking works the same for both sides: raiders flank onto the player's shoulder, up to three at a time.

### Losing vehicles and drivers

- Game over - All drivers on a team are dead. Escorts never count toward defeat.
- Driver death - If the vehicle has a passenger, the passenger becomes the driver. If not, the vehicle is unmanned and becomes an escort for the rest of the fight, with default crew stats (gunnery, evade, ramming) and its own base speed. It brings no signature card.
- Vehicle death - The driver moves to the partner's vehicle as a passenger first, then to the nearest escort (lowest range from the wreck, ties broken as for attack orders), if space is available. The passenger keeps their own deck, hand, discard, and adrenaline, draws every turn, can't play attack cards, and can play order cards. A wrecked vehicle stays on the road for the turn it dies, then is removed.
- Escort death - A wrecked escort is gone for the rest of the run, and its signature card with it. See Escorts.

## Combat sequence

- Players always go first (initiative system to be determined later)
- Each driver draws 5 cards from their personal deck into their individual hand
- Hand cap: 7 cards per driver. A card drawn past the cap goes straight to discard
- Each driver's adrenaline pool refills to maximum
- Players can play cards from either driver's hand (single player) or their own driver's hand (co-op)
- Cards cost adrenaline from the specific driver who plays them
- Passengers can play support/utility and order cards but NOT attack cards
- Every escort is ready again at the start of the player's turn

### Enemy intents

Decided by Kevin, 2026-09-25. Record: [enemy-intent-planning.md](../AI_TECHNICAL_DECISIONS/enemy-intent-planning.md).

- At the start of the player's turn, after the draw, every raider commits its whole coming turn: each card it will play, in order, with a type (attack, defend, buff, debuff, unknown), a value, and a target vehicle, or both vehicles for an area hit. The player sees these as intents. The enemy turn plays the plan; nobody chooses again.
- A raider plans against a projection of the road that tracks slots, flank state, and speed, so a card planned after its own flank or speed boost is judged from where the raider will be.
- An attack's value is its damage per hit, worked out when shown, so a Vulnerable picked up during the player's turn raises it. Multi-hit shows as damage x hits.
- When the player makes a planned card illegal (moves out of range, speeds past a planned flank, or slows a flanker so it drops back), the card fizzles: it's spent, does nothing, and the log says why.
- When a planned target was wrecked earlier in the enemy turn, the card goes to the vehicle the wrecked driver now rides in as a passenger. If there's no such vehicle, it fizzles.
- A raider that is wrecked, or has lost its driver, drops the rest of its plan.
- Basic raiders show everything. Elites show the type and target but hide the value and the card. Bosses behave like elites until bosses are designed.
- Raider archetypes have target preferences, applied when the raider plans: looters go for haulers, killers go for drivers (driven vehicles). The preference shows only through the planned intents' target marks, so the player reads it off the road before acting. An archetype picks its preferred target when that target is legal for the card, and otherwise plans as usual. Draw Fire is the counter (see Escorts).
- An escort is a legal target like any vehicle. It has no HP, so damage aimed only at a driver (Headshot) has nothing to hit on it.

## Escorts

Decided by Kevin, 2026-09-25. Record: [escorts.md](../AI_TECHNICAL_DECISIONS/escorts.md). Order cards are in [Card System Design](./Card%20System%20Design.md) section 1.3 and 4.5.

An escort is an undriven vehicle in your convoy: it has a slot and a plate but no driver and no hand. It acts only when an order card is played, once per turn. Keyword: `[Escort]`.

### Stats

- Armor, structure, gunnery, evade, ramming, and base speed, all its own. No HP.
- Its speed is its base speed.
- Past armor, all damage goes to structure.
- Hit checks use the escort's own skills, in both directions: its gunnery or ramming when it attacks, its evade when it's attacked.

### Slots, range, and flanking

- Same slots and range as any vehicle. There's no cover geometry: an escort doesn't block or shield anything by where it sits.
- Escorts place after the driven vehicles. Each escort type has a preferred slot, used as its encounter or opening slot; if it's taken, the escort takes the next free slot in the fill order.
- Escorts flank under the normal rules, including the +50% from the shoulder and the end-of-turn drop-back. An escort can also be an ambush start in a set piece.

### Orders

- An escort does nothing on its own. It acts when a driver plays an order card, and it acts at most once per turn. Once it has acted it is spent and shows a SPENT chip until the start of the player's turn.
- Any driver can play an order card, active or passenger. The adrenaline comes from the driver who plays it.
- Attack orders target a raider. The nearest ready escort within the card's range of that raider carries it out and is spent. Nearest means lowest range to the raider. Ties go to the inside lane, then the outside lane, then the enemy shoulder, and within a lane to ahead, then center, then behind. While the card is dragged over a raider, the escort that would carry it out lights up. A raider with no ready escort in range isn't a legal target.
- Buff orders (armor, Draw Fire) target an escort directly. Close Ranks doesn't spend the escort. Whether Draw Fire and Triage spend one is open (see the record).
- Every order card is a single drop, the same as any other card.

### Signature cards

- Each escort type brings one signature order card. When the escort joins, the player picks which driver's deck it goes into.
- A signature card only works while its escort lives. If the escort is wrecked mid-fight, the card stays where it is but can't be played for the rest of the fight, and it's removed from the deck when the fight ends.
- Dismissing an escort in the garage removes its signature card too.
- Generic order cards join the reward pool only while you own at least one escort. Order cards already in a deck stay there if the last escort is lost.

### Owning escorts

- You get escorts from events and by hiring them in the garage. Convoy contracts come later.
- Up to 4 escorts. At 4, taking another means dismissing one first.
- Damage persists between fights: an escort starts the next fight with the structure it ended on. The garage repairs it.
- A lost escort is gone for the run, with its signature card.
- Haulers pay a dividend after every fight they survive: the Fuel Hauler +1 fuel, the Salvage Rig (not one of the first four) +15 scrap.

### Passengers and unmanned vehicles

- A driver whose vehicle is wrecked rides in the partner's vehicle first, then the nearest escort (see Losing vehicles and drivers). A passenger in an escort can play order cards and any other card that isn't an attack.
- A driven vehicle whose driver dies with no passenger becomes an escort for the rest of the fight, with default crew stats and its own base speed. It can be ordered like any escort. It brings no signature card.

### Starting escort types

The minimal first version has four. The driven vehicles open at inside center and inside behind, so these preferred slots fill the rest of the formation without colliding.

| Escort | Role | Speed | Preferred slot | Signature card |
|---|---|---|---|---|
| Outrider | gun | 5 | inside ahead | not yet named |
| Pilot Car | gun | 4 | outside ahead | not yet named |
| Fuel Hauler | hauler, +1 fuel after each fight | not set | outside center | not yet named |
| Med Truck | hauler, dividend not set | not set | outside behind | Triage |

Gunnery, evade, ramming, armor, structure, the haulers' speeds, and the default crew stats for an unmanned vehicle are content numbers, set when escorts are built.

## Cards

- Every card has a short text, shown on the card face in the hand (three lines, keyword-based), and a full text, shown in the card detail view (up to 330 characters). See Card System Design 1.1.
- Driver selection may not pick the same driver for both slots.

- Rules for all Ranged Attack cards
  - Range 1-2. Range is lanes apart plus rows apart on the road grid, with no diagonal shortcut. Player inside to enemy inside on the same row is range 1; one row ahead or behind adds 1; player inside to enemy outside is range 2; a flanker on the enemy shoulder to the enemy inside lane is range 2.
  - Damage
    - An attack hits if the attacking drivers gunnery > the defending drivers evade.  
    - Damage done is: 1 - infinite
    - Drivers with flanking do 50% more damage (the Flank card, the code, and this rule agree)
    - Reduces armor first
    - When armor <= 0, Applies half of remaining to the structure of a vehicle and its driver and passengers

Specific Cards
- Point Blank : Ranged Attack
  - Rarity Common
  - Adrenaline 1
  - Range 1
  - Damage 3
  - Upgraded adds +2 to damage
- Far Shoot: Ranged Attack
  - Rarity Common
  - Adrenaline 1
  - Range 2
  - Damage 1
  - Upgraded adds +1 to damage
- Headshot: Ranged Attack
  - Rarity Rare
  - Adrenaline 2
  - Target: driver
  - An attack hits if the attacking drivers gunnery > the defending drivers evade + 2.  
  - Does no structure damage
  - Damage 2
  - Upgraded makes it easier to hit, at attack hits if attacking drivers gunnery > the defending drivers evade + 1
- Ram: Physical Attack
  - Rarity Common
  - Adrenaline 2
  - An attack hits if attacking drivers ramming >= the defending drivers evade. 
  - Damage = attacking vehicle armor / 10 + (attacker speed - defender speed)
  - Upgraded changes the damage formula to: attacking vehicle armor / 7 + (attacker speed - defender speed) * 2
- Flank: Utility
  - Rarity Common
  - Adrenaline 2
  - Can only flank an enemy with slower speed
  - Move to the enemy shoulder, in the row of the target it outran
  - Attack cards do 50% more damage
  - Upgraded: Adrenaline -1
- Oil slick: Ranged Attack
  - Rarity Uncommon
  - Adrenaline 1
  - Can only attack flanking vehicles
  - This attack always hits
  - Reduce a vehicle’s speed by 4 for 2 turns.  The vehicle becomes vulnerable
- Caltrops: Ranged Attack
  - Rarity Rare
  - Adrenaline 2
  - Can only attack flanking vehicles
  - This attack always hits
  - Reduce a vehicle’s speed by 2 for combat
  - Do 2 points of structure damage
- Repair Kit: Utility
  - Rarity Common
  - Adrenaline 1
  - Can only target the vehicle the driver is in
  - Increases structure by 8.  If this exceeds the max structure it heals armor up to its max
  - Upgraded adds +4 to the healing
- Medical Kit: Utility
  - Rarity Uncommon
  - Adrenaline 2
  - Can only target yourself or a passenger in the same vehicle
  - Increases hit points by 4 up to their initial value
  - Upgraded adds +2 to the healing
- Nitro Boost: Utility
  - Rarity Uncommon
  - Adrenaline 1
  - Gain 3 speed for 2 turns
  - Draw 2 cards
  - Upgraded adds +1 draw cards
- Coordinated Attack: Attack
  - Rarity uncommon
  - Adrenaline 3
  - Damage 3.  If partner attacked this turn double the damage
  - Upgraded +2 damage
- EMP Blast: Utility
  - Rarity Rare
  - Adrenaline 3
  - All enemies skip their turn
  - Upgraded -1 Adrenaline
- Beserker: Utility
  - Rarity Common
  - Adrenaline 1
  - Driver takes 3 damage
  - Gain 3 Adrenaline
  - Vehicle gains Vulnerable
  - Upgraded damage -1, Adrenaline +1

## Ideas from the original draft

Not current rules. The first version of this document had a few mechanics that didn't carry into the rules above; they're kept here as options, not as requirements.

- **Initiative and velocity.** At the start of each turn every driver rolls initiative (1-3) and adds their speed and their vehicle's speed. The total is their velocity for that turn, and velocity (not speed) drives flanking and ram damage. The current rules still say "initiative system to be determined later", and this is the one idea on record for it.
- **Percentage hit chances instead of a hard threshold.**
  - Ranged attack: 20% + (attacker gunnery - defender evade) / attacker gunnery.
  - Headshot: 5% + (attacker gunnery - defender evade) / attacker gunnery.
  - Ram: 30% + (attacker ramming - defender evade) / attacker ramming.
  - The current rules use a deterministic check (gunnery > evade), which the battle screen's hit-check chip depends on; switching back would turn that chip into a percentage.
- **Flank grants another attack.** Flank moved you into the enemy's flanking position and let you play another attack card, rather than giving a damage bonus.
- **Driver death removes the vehicle.** A dead driver's vehicle left the board, rather than carrying on unmanned or passing to its passenger.
