# Card System Design

## 1\. Card Configuration System

### 1.1 Card Data Structure (JSON)

{

"cards": {

"strike_basic": {

"id": "strike_basic",

"name": "Ramming Speed",

"summary": "Deal {damage}. [Range 1]. If [Vulnerable]: +{adrenaline} Adrenaline.",

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

#### Short and full text

Every card carries two texts, both required, both templated with the same `{variables}`:

- `summary` is the card face in the hand: three lines of 12px text in a 114px box, written with keywords in brackets (`[Range 1]`, `[Vulnerable]`, `[Sure-hit]`, `[Armor]`, `[Partner]`, `[Flank]`, `[Exhaust]`, `[Escort]`), which render highlighted and get definitions in the detail view.
- `description` is the full rules text for the card detail view (hover, focus, or long-press; right-click pins it), up to 330 characters with values filled in. Keywords in it are highlighted automatically.

A summary that wraps past three lines, or a description past 330 characters, fails the card data check; the fix is rewriting, never smaller type. Layout and budgets: [Battle Screen Design](./Battle%20Screen%20Design.md) section 5.

### 1.2 Card Types & Rarities

#### Card Types

- **Attack**: Direct damage cards
- **Defense**: Armor and damage mitigation
- **Utility**: Resource generation, card draw, movement
- **Power**: Persistent effects (stay in play)
- **Synergy**: Require both drivers or specific conditions
- **Exhaust**: One-time use per combat
- **Order**: Commands an escort. Not an attack, so a passenger can play it. See 1.3

#### Rarities

- **Starter**: Only in starting decks
- **Common**: 60% drop rate
- **Uncommon**: 30% drop rate
- **Rare**: 9% drop rate
- **Legendary**: 1% drop rate

### 1.3 Order cards

Escorts are vehicles in your convoy with a slot and a plate but no driver and no hand. They act only when an order card is played. The rules for escorts are in [Combat Rules](./Combat%20Rules.md), section Escorts; this is the card side.

- **Order** is its own card type, tagged `order` in card data and never `attack`. Any driver can play one, active or passenger, paying from their own adrenaline.
- **Attack orders** target a raider (`enemy_single`). The nearest ready escort within the card's range of that raider carries it out and is spent; ties go to the inside lane, then the outside lane, then the enemy shoulder, and within a lane to ahead, center, behind. The drag lights up that escort. A raider with no ready escort in range isn't a legal target.
- **Buff orders** target an escort directly, with the new `escort` target type, and can target a spent one. Armor orders and Draw Fire are buff orders.
- **Spending.** Attack orders and Draw Fire spend the escort. Close Ranks and Triage don't; Triage is the Med Truck's card, not its action.
- Every order card is a single drop, the same as any other card. No order asks for two targets.
- **`[Escort]`**: "An undriven vehicle in your convoy. Acts only when ordered, once per turn."
- **Signature cards.** Each escort type has one signature order card, and each escort brings its own copy into a driver's deck when it joins; the player picks which driver. Card data names the type with `signatureOf` (the escort type's id), and each copy remembers the escort that brought it. A signature card is never in the reward pool or the shop. It's playable while any living escort of its type is in the convoy. The copy an escort brought leaves the deck at the end of the fight it's wrecked in, or when it's dismissed.
- **Reward pool.** Generic order cards join the reward pool only while you own at least one escort.

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

### 4.5 Order cards

The initial set. All cost 1 except Rally the Convoy. Rarities marked "proposed" weren't part of the decision. Summaries follow 1.1: keywords in brackets, three lines on the card face. Upgraded values aren't set yet.

**Covering Fire** (1 Adrenaline, common, proposed). Attack order, `enemy_single`, range 2.

- Summary: "Nearest [Escort] in [Range 2] of target deals {damage}."
- Full text: "The nearest ready escort within range 2 of the target attacks it for {damage} damage, using the escort's gunnery against the target's evade. That escort is spent."
- Damage 3.

**Ramming Run** (1 Adrenaline, common, proposed). Attack order, `enemy_single`, range 1.

- Summary: "Nearest [Escort] in [Range 1] rams for {damage} + speed gap. Takes 2."
- Full text: "The nearest ready escort within range 1 of the target rams it for {damage} plus the speed gap (escort speed minus target speed), using the escort's ramming against the target's evade. The escort takes 2 structure damage and is spent."
- Damage 4.

**Draw Fire** (1 Adrenaline, uncommon). Buff order, `escort`.

- Summary: "This [Escort] draws its row's raider fire. +{armor} [Armor]."
- Full text: "Target escort gains {armor} Armor and is spent. Until the end of the next enemy turn, each raider intent aimed at a driven vehicle in its row hits the escort instead, if the card can reach it. The rest hit their original target as planned."
- Armor 4. The counter to killers, which aim at driven vehicles. It protects and never cancels: each intent is judged as it plays, and one whose card can't reach the escort keeps its target. Target marks update when it's played, so the end-turn preview shows the redirect. If two Draw Fires cover the same row, the last one played wins. Can target a spent escort.

**Close Ranks** (1 Adrenaline, common, proposed). Buff order, `escort`.

- Summary: "This [Escort] gains {armor} [Armor]. Doesn't spend it."
- Full text: "Target escort gains {armor} Armor. The escort isn't spent and can still act this turn."
- Armor 6.

**Triage** (1 Adrenaline, signature of the Med Truck). Targets a vehicle in your convoy (`ally`).

- Summary: "Heal {healing} HP to a driver or passenger. Needs a Med Truck."
- Full text: "Heal {healing} HP to the driver or passenger you choose in the target vehicle, up to their starting HP. Playable while any Med Truck lives, and doesn't spend it."
- Healing 4. Heals up to starting HP, like Medical Kit.
- Choosing the occupant is a proposal, because a card is one drop and `ally` targets a vehicle: dropping on the passenger row of the plate picks the passenger, anywhere else on the vehicle picks the driver. The model already carries a target driver for Medical Kit.

**Rally the Convoy** (2 Adrenaline, rare). `enemy_all`, dropped anywhere on the road like EMP Blast.

- Summary: "Each ready [Escort] deals {damage} to its nearest raider. [Exhaust]."
- Full text: "Ready escorts fire one at a time in roster order. Each deals {damage} damage to its nearest living raider within range 2, using its gunnery against that raider's evade. Then every escort is spent, including any with no raider in range. Exhaust."
- Damage 2. Range 2 and the per-escort hit check are proposed; the decision says "in range". Escorts resolve in roster order, and each one picks its nearest raider again from the raiders still alive, so a raider wrecked by an earlier escort isn't shot twice. Ties for the nearest raider go to their inside lane, then their outside lane, then your shoulder, and ahead, center, behind within a lane.

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

summary: "Deal {damage}. Push back."

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
