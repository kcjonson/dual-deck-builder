## Entity Types

- Vehicle
- Driver

### Vehicle

- Properties
  - Armor: 0 - infinite
  - Structure: 0 - infinite
  - Speed: 1-5
  - Driver: driver
  - Passenger: driver
- Derived States
  - Alive = Structure > 0

### Driver

- Properties
  - Hitpoints 0 - infinite
  - Speed 1-5
  - Adrenaline 0 - infinite
  - Skills 0 - 10
    - Ramming
    - Gunnery
    - Evade

## Game State

- Entities can be in any of 3 positions, Front, Back, Flanking.
- Flanking - True if an entity is faster than another and they cast a card with Flanking
- Game over - All drivers on a side are dead
- Driver death - The vehicle they are driving is removed from the board
- Vehicle death - Driver jumps to a remaining vehicle as a passenger

## Combat sequence

- Roll initiative for each driver(1-3). Add their speed and the vehicle speed to it. This is their velocity for the turn

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
