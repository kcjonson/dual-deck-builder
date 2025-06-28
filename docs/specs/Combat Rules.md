## Entity Types

- Team
- Vehicle  
- Driver

### Team

- Properties
  - Type: Player or Enemy
  - Vehicles: Array of vehicles (Player teams have exactly 2, Enemy teams variable)
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

- Vehicles can be in any of 3 positions, Front, Back, Flanking.
- Flanking - A vehicle can flank another vehicle if the vehicle speed is faster than the other vehicle and they cast a card with Flanking
- Game over - All drivers on a team are dead
- Driver death - If driver dies, vehicle becomes unmanned (if no passenger) or passenger becomes driver
- Vehicle death - Driver jumps to a remaining team vehicle as a passenger (if space available)

## Combat sequence

- Players always go first (initiative system to be determined later)
- Each driver draws 5 cards from their personal deck into their individual hand
- Each driver's adrenaline pool refills to maximum
- Players can play cards from either driver's hand (single player) or their own driver's hand (co-op)
- Cards cost adrenaline from the specific driver who plays them
- Passengers can play support/utility cards but NOT attack cards
- After combat if a flanking vehicle is no longer faster it loses flanking and returns to the back position

## Cards

- Rules for all Ranged Attack cards
  - Range 1-2.  Range is determined by the relative vehicle position, for example team 1 front to team 2 front is range 1.  team 1 front to team 2 back is range 2.  Flanking to front is range 2.  Think of the battlefield as layed as out F1, B1, F1 -> F2, B2, F2
  - Damage
    - An attack hits if the attacking drivers gunnery > the defending drivers evade.  
    - Damage done is: 1 - infinite
    - Drivers with flanking do 2X damage
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
  - Move into the enemies flanking position
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
