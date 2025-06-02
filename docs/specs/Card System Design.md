# Card System Design

## 1\. Card Configuration System

### 1.1 Card Data Structure (JSON)

{

"cards": {

"strike_basic": {

"id": "strike_basic",

"name": "Ramming Speed",

"description": "Deal {damage} damage. If target has Vulnerable, gain {adrenaline} Adrenaline.",

"driverRestriction": null,

"rarity": "common",

"cost": 2,

"targetType": "enemy_single",

"effects": \[

{

"type": "damage",

"value": 12,

"scaling": "ramming",

"target": "target"

},

{

"type": "conditional",

"condition": "target_has_status",

"status": "vulnerable",

"effect": {

"type": "gain_resource",

"resource": "adrenaline",

"value": 1,

"target": "self"

}

}

\],

"upgrades": {

"damage": 18,

"adrenaline": 2

},

"tags": \["attack", "physical"\],

"image": "cards/ramming_speed.png"

}

}

}

### 1.2 Card Types & Rarities

#### Card Types

- **Attack**: Direct damage cards
- **Defense**: Armor and damage mitigation
- **Utility**: Resource generation, card draw, movement
- **Power**: Persistent effects (stay in play)
- **Synergy**: Require both drivers or specific conditions
- **Exhaust**: One-time use per combat

#### Rarities

- **Starter**: Only in starting decks
- **Common**: 60% drop rate
- **Uncommon**: 30% drop rate
- **Rare**: 9% drop rate
- **Legendary**: 1% drop rate

## 2\. Driver-Specific Starting Decks

### 2.1 The Road Warrior (Tank)

**Vehicle**: War Rig **Theme**: High armor, ramming attacks, area damage

Starting Deck:

1. **Reinforced Ram** (2 Adrenaline) - Deal 10 damage, gain 5 Armor
2. **Armor Plating** (1 Adrenaline) - Gain 8 Armor
3. **Bulldoze** (3 Adrenaline) - Deal 8 damage to ALL enemies
4. **Emergency Repairs** (1 Adrenaline) - Heal 5 HP, Exhaust
5. **Rev Engine** (0 Adrenaline) - Gain 2 Adrenaline, draw 1 card
6. **Defensive Position** (2 Adrenaline) - Gain 12 Armor, next turn +1 Adrenaline
7. **Scrap Shot** x3 (1 Adrenaline) - Deal 6 damage

### 2.2 The Interceptor (Assassin)

**Vehicle**: Lightning Bike **Theme**: High damage, speed, critical hits

Starting Deck:

1. **Nitro Boost** (1 Adrenaline) - Gain Speed+, draw 2 cards
2. **Precision Shot** (2 Adrenaline) - Deal 15 damage, +5 if Speed+
3. **Evasive Maneuvers** (1 Adrenaline) - Gain 5 Armor, apply Evasion
4. **Hit and Run** (2 Adrenaline) - Deal 8 damage, gain Speed+
5. **Cheap Shot** (0 Adrenaline) - Deal 4 damage, apply Vulnerable
6. **Redline** (1 Adrenaline) - Next 2 attacks deal +50% damage, take 3 damage
7. **Quick Strike** x3 (1 Adrenaline) - Deal 7 damage

### 2.3 The Mechanic (Support)

**Vehicle**: Mobile Workshop **Theme**: Buffs, debuffs, resource generation

Starting Deck:

1. **Jury Rig** (1 Adrenaline) - Draw 2 cards, gain 1 Fuel
2. **Sabotage** (2 Adrenaline) - Enemy loses 50% armor, gains Vulnerable
3. **Field Repairs** (1 Adrenaline) - Target vehicle heals 8 HP
4. **Scavenge** (1 Adrenaline) - Gain 15 Scrap (once per combat)
5. **EMP Blast** (3 Adrenaline) - All enemies skip next turn
6. **Overclock** (0 Adrenaline) - Next card costs 0, Exhaust
7. **Tool Throw** x3 (1 Adrenaline) - Deal 5 damage, draw 1 card

### 2.4 The Raider (Berserker)

**Vehicle**: Spike Buggy **Theme**: Self-damage for power, lifesteal, chaos

Starting Deck:

1. **Blood for Chrome** (1 Adrenaline) - Take 3 damage, gain 3 Adrenaline
2. **Reckless Charge** (2 Adrenaline) - Deal 20 damage, take 5 damage
3. **Siphon Fuel** (2 Adrenaline) - Deal 10 damage, heal 5 HP
4. **Berserk Mode** (1 Adrenaline) - Gain Strength+, take 1 damage per turn
5. **Salvage** (1 Adrenaline) - If enemy dies this turn, gain 25 Scrap
6. **Chaos Engine** (0 Adrenaline) - Add 3 random cards to hand, Exhaust
7. **Scrap Slash** x3 (1 Adrenaline) - Deal 6 damage

## 3\. Synergy Card Examples

### 3.1 Combo Cards (Require specific driver combinations)

**Tag Team Takedown** (3 Adrenaline)

- Requires: Road Warrior + Interceptor
- Both vehicles attack the same target for combined damage
- If target dies, gain 2 Adrenaline each

**Supply Line** (2 Adrenaline)

- Requires: Mechanic + Any
- Mechanic generates 2 Fuel, partner draws 3 cards

### 3.2 Status Synergy Cards

**Exploit Weakness** (1 Adrenaline)

- If target has any debuff, deal 15 damage
- Otherwise, deal 5 damage

**Coordinated Strike** (2 Adrenaline)

- Deal 8 damage
- If partner played an Attack this turn, deal 8 again

## 4\. Card Pool by Category

### 4.1 Common Cards (Available to all drivers)

1. **Nitrous Injection** - Gain Speed+ and 2 Adrenaline
2. **Makeshift Armor** - Gain 6 Armor
3. **Potshot** - Deal 8 damage
4. **Swerve** - Gain 4 Armor, draw 1 card
5. **Ram** - Deal damage equal to your Armor
6. **Fuel Efficient** - Gain 1 Fuel
7. **Lucky Find** - Gain 10-30 Scrap (random)
8. **Patch Up** - Heal 4 HP

### 4.2 Uncommon Cards

1. **Twin Turbo** - Play the next card twice
2. **Smoke Screen** - All enemies get -50% accuracy next turn
3. **Explosive Rounds** - Next 3 attacks deal splash damage
4. **Reinforced Chassis** - Gain 15 Armor, heal 5 HP
5. **Ambush** - If enemy has Speed-, deal triple damage

### 4.3 Rare Cards

1. **Nuclear Engine** - Gain 5 Adrenaline, take 10 damage
2. **EMP Mine** - Stun target for 2 turns
3. **Scrap Tornado** - Deal 5 damage 5 times to random enemies
4. **Phoenix Protocol** - If you would die, heal to 15 HP instead (Exhaust)

### 4.4 Legendary Cards

1. **Witness Me!** - Triple all damage this turn, die at end of turn
2. **War Rig's Fury** - Deal damage equal to your max HP
3. **Time Dilation** - Take an extra turn after this one

## 5\. Vehicle Mods (Permanent Upgrades)

### 5.1 Offensive Mods

- **Spiked Bumper**: Ram attacks deal +3 damage
- **Turret Mount**: Start combat with Automated Turret (deals 3 damage/turn)
- **Flamethrower**: Attack cards apply Burning

### 5.2 Defensive Mods

- **Reactive Armor**: When hit, gain 2 Armor
- **Shield Generator**: Start combat with 10 Armor
- **Auto-Repair**: Heal 2 HP at end of turn

### 5.3 Utility Mods

- **Nitrous System**: Start combat with Speed+
- **Expanded Tank**: +2 Max Fuel
- **Card Printer**: Start combat with +1 card

## 6\. Status Effects

### 6.1 Buffs

- **Speed+**: +1 card draw, some cards get bonus effects
- **Strength+**: +25% damage on attacks
- **Armor+**: Armor doesn't decay at turn end
- **Regeneration**: Heal 3 HP at turn end

### 6.2 Debuffs

- **Vulnerable**: Take +50% damage
- **Slow**: -1 card draw
- **Burning**: Take 3 damage at turn end
- **Jammed**: Can't play Attack cards next turn

## 7\. Developer Tools

### 7.1 Card Browser Screen

- Filter by: Driver, Rarity, Type, Cost
- Search by: Name, Description text
- View: Card art, full stats, upgrade paths
- Test: Add to test deck, simulate draws
- Statistics: Pick rate, win rate when in deck

### 7.2 Balance Testing Tools

- Damage calculator
- Deck simulator (draw probability)
- Combat scenario tester
- Win rate tracker by card combination

### 7.3 Card Configuration Format

\# cards.yaml

cards:

\- id: ramming_speed

name: Ramming Speed

cost: 2

description: "Deal {damage} damage. Push enemy back."

variables:

damage:

base: 12

upgraded: 18

scaling: vehicle_weight

effects:

\- type: damage

target: enemy_single

\- type: push

distance: 1

restrictions:

min_vehicle_weight: 2

tags: \[attack, physical, positional\]

## 8\. Card Unlocking System

### 8.1 Unlock Conditions

- **Run Completion**: Unlock 2-3 random cards
- **Achievement**: Specific cards for specific achievements
- **Character Mastery**: Play X runs with a driver
- **Synergy Discovery**: Use certain combinations

### 8.2 Card Pool Evolution

- Start with ~40 cards available
- Full unlock: ~150 cards
- Some cards only available after certain story beats
- Seasonal cards for events/updates
