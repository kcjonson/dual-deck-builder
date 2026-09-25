## Entity Types

- Team
- Vehicle  
- Driver

### Team

- Properties
  - Type: Player or Enemy
  - Vehicles: Array of vehicles. Player teams have exactly 2 driven vehicles, plus optional escorts (vehicles with no driver hand, ordered by cards; not designed yet). Enemy teams are variable.
  - Up to 9 vehicles on the road per side: 6 in formation and 3 flanking
- Derived States
  - Defeated = All drivers dead

### Vehicle

- Properties
  - Armor: 0 - infinite
  - Structure: 0 - infinite
  - Base Speed: 1-5
  - Driver: driver (required)
  - Passenger: driver (optional)
  - Statuses: 
    - Vulnerable - The vehicle is exposed and unprepared for attack
- Derived States
  - Alive = Structure > 0
  - Speed = Driver speed + vehicle base speed

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

Opening placement: a vehicle whose encounter gives it a slot starts there; the rest fill their own formation inside lane first, center then behind then ahead. So the player's two vehicles start inside center and inside behind. Nobody starts on a shoulder.

### Flanking

- A flank card targets the vehicle to outrun. The target must be in the other team's formation (not itself flanking) and slower than the flanker.
- The flanker moves to the far shoulder, in the row of the vehicle it outran. If that shoulder slot is taken, the flank fails and the card goes back to the hand.
- Its old formation slot stays empty and reserved; the rest of the convoy doesn't shift. Swerving again from the shoulder keeps the original reservation.
- At the end of every turn (yours and the enemy's), a flanker that is no longer faster than the vehicle it outran loses flanking and returns to its reserved slot. If the vehicle it outran is wrecked, it holds the shoulder.
- Flanking works the same for both sides: raiders flank onto the player's shoulder, up to three at a time.

### Losing vehicles and drivers

- Game over - All drivers on a team are dead
- Driver death - If driver dies, vehicle becomes unmanned (if no passenger) or passenger becomes driver
- Vehicle death - Driver jumps to a remaining team vehicle as a passenger (if space available). The passenger keeps their own deck, hand, discard, and adrenaline, draws every turn, and can't play attack cards. A wrecked vehicle stays on the road for the turn it dies, then is removed.

## Combat sequence

- Players always go first (initiative system to be determined later)
- Each driver draws 5 cards from their personal deck into their individual hand
- Hand cap: 7 cards per driver. A card drawn past the cap goes straight to discard
- Each driver's adrenaline pool refills to maximum
- Players can play cards from either driver's hand (single player) or their own driver's hand (co-op)
- Cards cost adrenaline from the specific driver who plays them
- Passengers can play support/utility cards but NOT attack cards

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
