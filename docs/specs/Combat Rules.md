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
  - Speed: 1-5
  - Driver: driver (required)
  - Passenger: driver (optional)
- Derived States
  - Alive = Structure > 0

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
- Flanking - True if a vehicle is faster than another and they cast a card with Flanking
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

## Cards

- Ranged Attack cards

  - Range 1-2
  - Damage
    - An attack chance to hit is based on the 20% + (attacking drivers gunnery - the defending drivers evade) / attacking drivers gunnery.
    - Damage done is: 1 - infinite
    - Drivers with flanking do 2X damage
    - Reduces armor first
    - When armor <= 0, Applies half of remaining to the structure of a vehicle and its driver and passengers

- Point Blank : Ranged Attack
  - Range 1
  - Damage - 3
- Far Shoot: Ranged Attack
  - Range 2
  - Damage - 1
- Headshot: Ranged Attack
  - Target: driver
  - An attack chance to hit is based on the 5% + (attacking drivers gunnery - the defending drivers evade) / attacking drivers gunnery.
  - Does no structure damage
- Ram: Physical Attack
  - Change to hit is based on 30% + (attacking drivers ramming - the defending drivers evade) / attacking drivers ramming
  - Damage = armor / 10 + (attacker velocity - defender velocity)
- Flank:
  - Can only flank an enemy with slower velocity
  - Move into the enemies flanking position
  - Play another attack card
- Oil slick
  - Reduce a vehicle’s speed by 4 for 2 turns.
- Caltrops
  - Reduce a vehicle’s speed by 2 for combat

Do 2 points of structure damage
