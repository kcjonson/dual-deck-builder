# Gameplay Mechanics and Style Document

## 1\. Overview

This document outlines the core gameplay mechanics, style, and unique features for the new deckbuilder roguelike game, **Wasteland Wheels**. Set in a desolate, post-apocalyptic world ravaged by environmental catastrophe and societal collapse, players take on the roles of skilled drivers navigating treacherous terrains in heavily customized combat vehicles. Drawing inspiration from the gritty aesthetics and vehicular mayhem of _Mad Max_, the destructive creativity of _Carmageddon_, the gadgetry of _Spy Hunter_, and the tactical depth of _Car Wars_, this game blends intense card-based combat with strategic deckbuilding and vehicle customization. The central unique mechanic is the "Symbiotic Driver System," designed for both engaging single-player and cooperative couch co-op experiences.

## 2\. Core Gameplay Loop

The game is a roguelike campaign around a compound. The player runs a settlement in the ruins of a metro area and keeps it alive by sending supply runs out into a procedurally generated region: pick a point of interest on the area map, pick a route to it, pick two drivers, and drive. The compound, its resources, its pool of drivers, and the map's fog persist between runs; the campaign ends when the last driver dies. Full rules: [Compound and Supply Runs](./Compound%20and%20Supply%20Runs.md). Map generation: [Area Map Generation](./Area%20Map%20Generation.md).

1. **Crew Selection (The Symbiotic Drivers):** Each supply run takes a duo of two distinct drivers from the compound's pool. Drivers persist for the campaign, with their decks, until they die. Each driver possesses:
   - A unique starting vehicle (e.g., agile dune buggy, heavily armored war rig, nimble interceptor motorcycle, versatile gyrocopter).
   - A small, specialized deck of "Tactics" cards (representing driver skills, vehicle maneuvers, and weapon systems).
   - A unique passive skill or a signature piece of starting vehicle equipment (e.g., a jury-rigged EMP field, a salvaged grappling hook, enhanced engine components).
2. **Wasteland Navigation:** The area map is a procedurally generated region (ruined towns, barren deserts, toxic swamps, badlands and canyons) whose roads are the highways leading out of the metro, branching into back roads and trails. Points of interest sit at the ends of those roads, and each can be reached by two or three routes from different branches. Fog covers what hasn't been explored; driving a road charts it. A run resolves the stops along its route in order:
   - **Combat Zones:** Raider ambushes and warbands: marauder gangs, mutated creatures, rival scavengers, or automated security systems.
   - **Wrecks and Finds:** Scrap (primary currency), Fuel (paid to drive a route), food, water, meds, new Tactics cards, and the compound's growth: new drivers, settlers, and vehicles.
   - **Makeshift Garages:** Safe havens to repair vehicles, upgrade cards, install powerful Vehicle Mods, or discard unwanted cards from their decks.
   - **Distress Signals, Checkpoints & Hazards:** Narrative choices, factions holding the road, and the terrain itself.
   - **Strongholds:** Heavily defended faction seats, hidden in the fog in every direction, each guarded by a boss. They're objectives the player chooses to take on when ready, never forced.
3. **Vehicular Combat:** Turn-based card combat where players strategically manage the actions of both their drivers and their vehicles.
   - **Synergistic Play:** Success hinges on effectively combining the abilities, weapons, and maneuvers of the two vehicles. Card effects can be amplified or altered based on the partner's actions or status.
   - **Resource Management:** Players utilize "Adrenaline" (generated each turn and through specific card effects) to play Tactics cards. Some powerful abilities might also consume Fuel or specific Ammo types.
   - **Targeting & Positioning:** Both convoys drive the same direction on a freeway laid out as a grid of lanes and rows (see Battle Screen Design). Relative positioning (flanking around the enemy's outside lane, pulling ahead or dropping behind, keeping in weapon range) is tactically important. Players can target specific enemy vehicles or, in some cases, their vulnerable components (e.g., engines, weapons, tires).
4. **Deckbuilding & Vehicle Customization:** Post-encounter, players are rewarded with choices of new Tactics cards to add to either driver's deck, discover powerful Vehicle Mods (the game's equivalent of artifacts/relics), and salvage Scrap (currency).
   - **Scrap Utilization:** Scrap is used in Garages to upgrade cards (e.g., increasing damage, reducing Adrenaline cost, adding secondary effects), enhance vehicle attributes (Armor, Speed, Handling, Cargo Capacity, Weapon Mounts), or install new Mods.
   - **Deck Refinement:** Options to remove cards from decks are crucial for maintaining efficiency, especially when managing two distinct but cooperating decks.
5. **Consequences:** A supply run ends at its objective, and the convoy comes home down the road it cleared (late in a campaign, a rare ambush can catch it on the way back). Runs are measured in hours and leave at dawn: they have to be home by dark. Early routes all fit in daylight; the far POIs and strongholds don't, and night, with its own challenges, is the late game.
   - **Bosses:** Some objectives are strongholds with boss fights. The player decides when they're ready for one, and can keep doing non-boss runs to build up first. Taking a stronghold breaks its faction's hold on its territory.
   - **Victory:** The campaign is won by taking the region's strongholds (whether a final boss follows is open), unlocking new drivers, vehicles, Tactics cards, Vehicle Mods, cosmetic items, or higher difficulty tiers ("Wasteland Infamy Levels").
   - **Defeat (Lose Scenarios):**
     - **One Vehicle Down:** If one driver's vehicle is destroyed (structure reaches zero), that driver jumps into the partner's vehicle as a passenger. They keep their own deck, hand, and adrenaline and keep drawing, but can't play attack cards, so both drivers (and both co-op players) stay in the fight. The downed vehicle can be repaired at a Garage if the encounter is won, but perhaps at a significant Scrap cost or with lasting minor damage.
     - **Both Drivers Down:** If no driver is left in a fight, the supply run fails: the dead are gone for good, a driver who crashed out is missing, and the cargo and the run's escorts are lost. The campaign goes on with the drivers left at the compound.
     - **The Compound Falls:** When the last driver in the pool dies, the campaign ends: the compound starves, riots, or disbands. Meta-progression unlocks are kept.
     - **Fuel:** Routes are paid for in fuel at departure, so a run can't be stranded part way. A compound with no fuel can always send a scavenging party on foot, so it never soft-locks.
6. **Meta-Progression:** A persistent progression system rewards players across campaigns. This includes unlocking:
   - New playable Driver/Vehicle combinations.
   - New pools of Tactics cards and Vehicle Mods to appear in subsequent runs.
   - Starting bonuses or alternative loadouts for existing drivers.
   - Cosmetic customization options for vehicles or driver portraits.

## 6\. Couch Co-op Mode

The game will feature a seamless drop-in/drop-out couch co-op mode where two players can team up, each controlling one of the drivers in the Symbiotic Driver System.

- **Shared Screen Experience:** Both players will view and interact with the game on a single screen.
- **Turn Structure:** During combat, each player has their own individual Adrenaline pool that refills at the start of each turn. Players can play cards from their driver's deck as long as they have sufficient adrenaline. This ensures both players stay engaged even if one vehicle is destroyed - the surviving driver becomes a passenger but can still play non-attack cards from their deck using their own adrenaline pool.
- **Decision Making:** Map navigation choices, event decisions, and shop purchases will ideally be made collaboratively. A simple confirmation system (e.g., both players must agree or one player initiates and the other confirms) could be implemented for key decisions.
- **Resource Sharing:** Scrap and other collected resources will be shared. Decisions on how to spend them will be part_of the co-op strategy.
- **Revival Mechanic (Co-op Specific):** If one player's vehicle is destroyed, the other player might have a limited opportunity (e.g., within a few turns, or by reaching a specific objective in the fight) to perform a risky maneuver or use a rare item to revive their partner, albeit with penalties (e.g., reduced health, discarded hand).
- **Passenger Limitations:** When a driver becomes a passenger (due to vehicle destruction), they can still play cards from their deck using their own adrenaline pool, but with restrictions:
  - **Cannot play attack cards** (ranged attacks, ramming, etc.)
  - **Can play support cards** (repairs, buffs, defensive abilities)
  - **Can play utility cards** (card draw, adrenaline generation, etc.)
  - This keeps both players engaged while maintaining thematic consistency.

## 7\. Art Style and Presentation

- **Visuals:** A gritty, stylized aesthetic inspired by post-apocalyptic media like _Mad Max_, _Borderlands_, and _Rage_. Vehicles will be distinct, customizable, and show wear and tear. Environments will be desolate but visually interesting, featuring ruined cityscapes, vast deserts, toxic wastelands, and makeshift settlements. The art will be crisp, with impactful animations for attacks, explosions, and vehicle maneuvers. The UI will be clear, thematic (e.g., resembling a salvaged dashboard interface), and provide all necessary information without clutter.
- **User Interface (UI):** Intuitive and designed for clarity, especially in managing two characters/vehicles. Enemy intents, status effects, and resource levels must be easily discernible. For co-op, UI elements should clearly distinguish between Player 1 and Player 2 actions/resources if not fully shared.
- **Audio:** A dynamic soundtrack blending industrial, rock, and desolate atmospheric themes. Sound effects will be punchy and satisfying, emphasizing the impact of vehicular combat – engine roars, weapon fire, explosions, and crunching metal.

## 8\. Target Audience

- Fans of roguelike deckbuilder games (e.g., Slay the Spire, Monster Train, Balatro).
- Players who enjoy strategic card games and RPGs with a strong thematic wrapper.
- Players looking for a high degree of replayability and strategic depth.
- Gamers who appreciate post-apocalyptic settings and vehicular combat themes.
- Players looking for engaging couch co-op experiences.

## 9\. Key Elements (Thematic Alignment)

- **Cards (Tactics):** Represent driver skills, vehicle maneuvers, weapon systems, and salvaged tech. Card names and effects will reflect the post-apocalyptic vehicle combat theme (e.g.,

_The original document ends here, mid-sentence, and never had sections 3 to 5._
