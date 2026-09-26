## Entity Types

- Team
- Vehicle  
- Driver

### Team

- Properties
  - Type: Player or Enemy
  - Vehicles: Array of vehicles. Player teams start with exactly 2 driven vehicles, plus up to 4 escorts in formation (see Escorts), plus any set-piece escorts the encounter starts on the enemy shoulder (ambush starts, see The road). Enemy teams are variable, and their raiders can start on the player's shoulder.
  - Up to 9 vehicles on the road per side: 6 in formation and 3 on the shoulder. A flanker keeps its formation slot reserved, so a side only gets past 6 through ambush starts.
- Derived States
  - Defeated = No driver still in the fight, driving or riding as a passenger. Every driver is dead or crashed out. Escorts never count.

### Vehicle

- Properties
  - Armor: 0 - infinite
  - Shield: 0 - infinite. Temporary armor: absorbs damage before Armor, isn't capped by the vehicle's armor, stacks, and clears from every vehicle at the start of the player's turn (and when a fight starts). Decided 2026-09-26; see [escorts.md](../AI_TECHNICAL_DECISIONS/escorts.md) decision 28.
  - Structure: 0 - infinite
  - Base Speed: 1-5
  - Driver: driver (driven vehicles) or none (escorts)
  - Passenger: driver (optional). Every vehicle, escorts included, has one passenger seat.
  - Crew skills (escorts only): Gunnery, Evade, Ramming, 0 - 10
  - Statuses: 
    - Vulnerable - The vehicle is exposed and unprepared for attack
- Derived States
  - Alive = Structure > 0
  - Speed = Driver speed + vehicle base speed + statuses. The driver is whoever is at the wheel, so a passenger who takes over brings their own speed. An escort's speed is its base speed.
  - Escort = no driver
  - Ready = an escort that hasn't acted this turn

### Driver

- Properties
  - Hitpoints: 0 - infinite
  - Speed: 1-5, added to the base speed of the vehicle they're driving
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

#### Driver speeds

Decided by Kevin, 2026-09-26 (DDB-159). Each driver's speed, their signature vehicle's base speed, and the speed they drive it at:

| Driver | Driver speed | Vehicle | Base speed | Speed |
|---|---|---|---|---|
| The Road Warrior | 1 | Apocalypse Rig | 1 | 2 |
| The Interceptor | 3 | Lightning Bike | 5 | 8 |
| The Mechanic | 2 | Mobile Workshop | 2 | 4 |
| The Raider | 2 | Spike Buggy | 3 | 5 |

For the escorts: the Outrider (5) outruns the Rig and the Workshop, ties the Spike Buggy (a tie can't flank), and can't catch the Bike. The combat screen's test raider, the Rust Buggy, is base 3 with a speed 2 driver, so it's 5 too.

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

Opening placement: a vehicle whose encounter gives it a slot starts there; the rest fill their own formation inside lane first, center then behind then ahead. So the player's two vehicles start inside center and inside behind. Escorts place after the driven vehicles, in roster order (the order they joined the convoy): each takes its type's preferred slot, or the next free slot in that fill order if the preferred one is taken. When two escorts of the same type want the same slot, the first acquired gets it.

Ambush starts: an encounter can place a vehicle already flanking, on the other team's shoulder in a row the encounter names. Ambushers are raiders and set-piece escorts, nothing else:

- Raider encounters and reinforcement waves can place raiders on the player's shoulder, at the start of the fight or when a wave arrives.
- A set-piece escort (an event ally, for example) can start on the raiders' shoulder.
- The player's two driven vehicles always start in formation.

Ambushers start only in rows with an opposing vehicle. After that, a shoulder vehicle with nothing opposite is legal, since the vehicle it was beside can be wrecked.

An ambusher has no reserved formation slot and no outran vehicle. It counts as flanking for every rule that asks. This is the only way a side reaches 9 on the road: 6 in formation and 3 on the shoulder. Without it, every flanker leaves a reserved slot behind and a side caps at 6. The battle screen mock's Full road scenario is a layout stress case, not a legal position. Its raider side is a legal ambush (six in formation, three on your shoulder), but its player side isn't: the Interceptor got onto the shoulder by flanking, so its formation slot should be empty and reserved, and the formation also holds five escorts against a cap of four.

### Flanking

- A flank card targets the vehicle to outrun. The target must be in the other team's formation (not itself flanking) and slower than the flanker.
- The flanker moves to the far shoulder, in the row of the vehicle it outran. If that shoulder slot is taken, the flank fails and the card goes back to the hand.
- Its old formation slot stays empty and reserved; the rest of the convoy doesn't shift. Swerving again from the shoulder keeps the original reservation.
- At the end of every turn (yours and the enemy's), a flanker that is no longer faster than the vehicle it outran loses flanking and returns to its reserved slot. If the vehicle it outran is wrecked, it holds the shoulder. A flanker with no reserved slot (an ambush start) holds the shoulder too, for the same reason: there's nowhere to drop back to.
- Flanking works the same for both sides: raiders flank onto the player's shoulder, up to three at a time.

### Losing vehicles and drivers

- Game over - The fight goes on while at least one of your drivers is still in it, driving or riding as a passenger. When none are (every driver dead or crashed out), the run ends: true death, the session is over, and there's no rescue even for a driver who crashed out alive. Escorts never count toward defeat. Decided by Kevin, 2026-09-25: one driver has to survive to circle back down the road for the other.
- Driver death - If the vehicle has a passenger, the passenger becomes the driver. If not:
  - On the player's team, the vehicle becomes an escort for the rest of the fight, with default crew stats (gunnery, evade, ramming) and its own base speed. It brings no signature card, and if this happens mid-turn it starts spent.
  - A raider vehicle is out of the fight and leaves the road at the end of the turn, like a wreck. Its plan drops (see Enemy intents).
- Vehicle death - Every vehicle, escorts included, has one passenger seat. The wreck's occupants jump, the driver first, then the passenger.
  - On the player's team, each goes to the partner's vehicle first, then the nearest escort (lowest range from the wreck, ties broken as for attack orders), whichever has a free seat.
  - On a raider team, each goes to any other vehicle on the team with a free seat.
  - A driver with no free seat has crashed out: out of the fight but alive, and their hand is gone for that fight. If the fight is won, the surviving driver goes back down the road and picks them up, so they rejoin the run.
  - A passenger keeps their own deck, hand, discard, and adrenaline, draws every turn, can't play attack cards, and can play order cards.
  - A wrecked vehicle stays on the road for the turn it dies, then is removed.
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
- Raider archetypes have target preferences, applied when the raider plans: looters go for haulers (escorts whose role is hauler), killers go for drivers (driven vehicles). A raider can have neither. The archetype belongs to the raider, whatever AI plans for it. The preference shows only through the planned intents' target marks, so the player reads it off the road before acting. An archetype picks its preferred target when that target is legal for the card, and otherwise plans as usual; among several preferred targets, the raider's usual judgment picks. It applies to cards aimed at one of your vehicles that land something on it, not to a flank, whose target is only the vehicle it outruns. Draw Fire counters a killer, since it pulls aimed fire off a driven vehicle. It doesn't pull fire off a hauler, so against a looter the counters are Shield on the hauler (from Draw Fire or Close Ranks) or keeping the hauler out of the looter's range (see Escorts). The Rust Buggy is a looter (decided 2026-09-26, Kevin delegated the call; [escorts.md](../AI_TECHNICAL_DECISIONS/escorts.md) decision 30).
- Draw Fire lasts until the end of the next enemy turn. Each aimed intent (one target) at a driven vehicle in the escort's row is judged as it plays: if its card can reach the escort, it hits the escort instead; if not, it hits its original target as planned. Draw Fire protects; it never makes an attack fizzle. Target marks update when Draw Fire is played, so the end-turn preview shows the redirect. If two Draw Fires cover the same row, the last one played wins.
- Draw Fire never redirects an area intent. An intent aimed at both driven vehicles hits both as planned, even with an escort drawing fire in one of their rows; Draw Fire pulls aimed fire, and it can't pull a blast. Decided 2026-09-26, Kevin delegated the call; [escorts.md](../AI_TECHNICAL_DECISIONS/escorts.md) decision 29.
- An escort is a legal target like any vehicle, except for a driver-only attack (Headshot): an empty escort has no HP of its own, so it isn't a legal Headshot target. An escort carrying a passenger is, and Headshot hits the passenger. A planned Headshot whose passenger dies before it plays fizzles. Decided in DDB-148; see [escorts.md](../AI_TECHNICAL_DECISIONS/escorts.md) decision 22.

## Escorts

Decided by Kevin, 2026-09-25. Record: [escorts.md](../AI_TECHNICAL_DECISIONS/escorts.md). Order cards are in [Card System Design](./Card%20System%20Design.md) section 1.3 and 4.5.

An escort is an undriven vehicle in your convoy: it has a slot and a plate but no driver and no hand. It acts only when an order card is played, once per turn. Keyword: `[Escort]`.

### Stats

- Armor, structure, gunnery, evade, ramming, and base speed, all its own. No HP.
- Its speed is its base speed.
- Past armor, an empty escort takes all damage on structure. An escort carrying a passenger splits it, half to structure and half to the passenger, the same as a driven vehicle.
- Hit checks use the escort's own skills, in both directions: its gunnery or ramming when it attacks, its evade when it's attacked.

### Slots, range, and flanking

- Same slots and range as any vehicle. There's no cover geometry: an escort doesn't block or shield anything by where it sits.
- Escorts place after the driven vehicles. Each escort type has a preferred slot, used as its encounter or opening slot; if it's taken, the escort takes the next free slot in the fill order.
- Escorts flank under the normal rules, including the +50% from the shoulder and the end-of-turn drop-back. A set-piece escort can also start on the raiders' shoulder as an ambusher.
- The only order that moves an escort onto the shoulder is the Outrider's Run Ahead. There's no generic flank order in the first set (decided 2026-09-26).

### Orders

- An escort does nothing on its own. It acts when a driver plays an order card, and it acts at most once per turn. Once it has acted it is spent and shows a SPENT chip until the start of the player's turn.
- Any driver can play an order card, active or passenger. The adrenaline comes from the driver who plays it.
- Attack orders target a raider. The nearest ready escort within the card's range of that raider carries it out and is spent. Nearest means lowest range to the raider. Ties go to the inside lane, then the outside lane, then the enemy shoulder, and within a lane to ahead, then center, then behind. While the card is dragged over a raider, the escort that would carry it out lights up. A raider with no ready escort in range isn't a legal target.
- A signature attack order is carried out only by an escort of its type: Run Ahead by the nearest ready Outrider that can legally flank the target (range isn't a limit), Flag Down by the nearest ready Pilot Car within range 2.
- Ramming Run's 2 structure damage to the escort lands only on a hit. A miss means no collision; the card, the adrenaline, and the escort's action are still spent (decided 2026-09-26).
- Buff orders (Close Ranks, Draw Fire) target an escort directly, and can target a spent one. Both give Shield, not armor, so they work on an escort at full armor and on the Outrider, which has none.
- Spending: attack orders (Covering Fire, Ramming Run, Rally the Convoy, Run Ahead, Flag Down) and Draw Fire spend the escort. Close Ranks, Triage, and Top Off don't. Triage and Top Off are the Med Truck's and Fuel Hauler's cards, not their actions, so neither needs to be ready.
- Every order card is a single drop, the same as any other card.

### Signature cards

- Each escort type has one signature order card, and each escort brings its own copy: two Med Trucks mean two Triages. When the escort joins, the player picks which driver's deck its copy goes into.
- A signature card is playable while any living escort of its type is in the convoy. Triage needs any living Med Truck.
- When an escort is wrecked mid-fight, the copy it brought stays where it is for the rest of the fight (playable only if another escort of its type lives) and leaves the deck when the fight ends.
- Dismissing an escort in the garage removes the copy it brought.
- Generic order cards join the reward pool only while you own at least one escort. Order cards already in a deck stay there if the last escort is lost.

### Owning escorts

- You get escorts from events and by hiring them in the garage. Convoy contracts come later.
- Up to 4 escorts. At 4, taking another means dismissing one first.
- Duplicate types are allowed.
- The roster is the order your escorts joined the convoy, first acquired first. It settles preferred-slot collisions and the order Rally the Convoy resolves in.
- Damage persists between fights: an escort starts the next fight with the structure it ended on. The garage repairs it.
- A lost escort is gone for the run, with its signature card.
- Haulers pay a dividend after every fight they survive: the Fuel Hauler +1 fuel, the Salvage Rig (not one of the first four) +15 scrap.

### Passengers and unmanned vehicles

- Every escort has one passenger seat. A driver whose vehicle is wrecked rides in the partner's vehicle first, then the nearest escort with a free seat, and crashes out of the fight if there's none, to be picked up after a won fight (see Losing vehicles and drivers). A passenger in an escort can play order cards and any other card that isn't an attack.
- A driven vehicle whose driver dies with no passenger becomes an escort for the rest of the fight, with default crew stats and its own base speed. It can be ordered like any escort, it starts spent if it converts mid-turn, and it brings no signature card.

### Starting escort types

The minimal first version has four. The driven vehicles open at inside center and inside behind, so these preferred slots fill the rest of the formation without colliding.

| Escort | Role | Speed | Preferred slot | Signature card |
|---|---|---|---|---|
| Outrider | gun | 5 | inside ahead | Run Ahead |
| Pilot Car | gun | 4 | outside ahead | Flag Down |
| Fuel Hauler | hauler, +1 fuel after each fight | not set | outside center | Top Off |
| Med Truck | hauler, dividend not set | not set | outside behind | Triage |

The three new signature cards were decided 2026-09-26 (Kevin delegated the call; record in [escorts.md](../AI_TECHNICAL_DECISIONS/escorts.md) decisions 23 to 27, cards in Card System Design 4.5):

- Run Ahead (Outrider): the Outrider gains +2 Speed for 2 turns, then flanks the target raider. Speed 5 is the Outrider's only distinguishing stat, and a tie can't flank, so without the boost it couldn't flank a speed 5 raider like the Rust Buggy.
- Flag Down (Pilot Car): the target raider is Vulnerable and 2 slower until the end of the next enemy turn, sure-hit. A setup play for the gun escorts before Covering Fire, and the slow lets drivers flank.
- Top Off (Fuel Hauler): +1 Adrenaline to the driver or passenger you pick in a convoy vehicle, 0 cost, doesn't spend the hauler. It makes the hauler your adrenaline source, which is what looters target, so protecting it with Draw Fire is a real choice.

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
    - Reduces Shield first, then armor
    - When shield and armor are gone, Applies half of remaining to the structure of a vehicle and its driver and passengers. With nobody aboard (an empty escort), all of it goes to structure.
    - Damage that skips armor skips Shield the same way: a structure-only cost (Ramming Run's) and a driver-only hit (Headshot). Ram's Armor/10 counts armor only, never Shield.
    - An escort attacks and defends with its own gunnery, ramming, and evade (see Escorts).

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
  - Target: driver, or the passenger riding in an escort. An empty escort isn't a legal target.
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
  - Always hits: every enemy vehicle still in the fight is stunned, whatever its evade (decided 2026-09-26)
  - Upgraded -1 Adrenaline
- Beserker: Utility
  - Rarity Common
  - Adrenaline 1
  - Driver takes 3 damage
  - The self damage is a flat printed cost: no hit check, and Vulnerable and flanking don't raise it (decided 2026-09-26)
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
