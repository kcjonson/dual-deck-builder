# Gameplay Mechanics and Style Document

## 1\. Overview

This document outlines the core gameplay mechanics, style, and unique features for the new deckbuilder roguelike game, **Wasteland Wheels**. Set in a desolate, post-apocalyptic world ravaged by environmental catastrophe and societal collapse, players take on the roles of skilled drivers navigating treacherous terrains in heavily customized combat vehicles. Drawing inspiration from the gritty aesthetics and vehicular mayhem of _Mad Max_, the destructive creativity of _Carmageddon_, the gadgetry of _Spy Hunter_, and the tactical depth of _Car Wars_, this game blends intense card-based combat with strategic deckbuilding and vehicle customization. The central unique mechanic is the "Symbiotic Driver System," designed for both engaging single-player and cooperative couch co-op experiences.

## 2\. Core Gameplay Loop

The game will follow a run-based roguelike structure. Players embark on perilous journeys across a dynamic wasteland map, making critical decisions that shape their drivers' abilities, vehicle loadouts, and ultimate chances of survival against hostile factions and environmental hazards.

1. **Crew Selection (The Symbiotic Drivers):** At the start of each run, players (or player, in single-player mode) select a duo of two distinct drivers. Each driver possesses:
   - A unique starting vehicle (e.g., agile dune buggy, heavily armored war rig, nimble interceptor motorcycle, versatile gyrocopter).
   - A small, specialized deck of "Tactics" cards (representing driver skills, vehicle maneuvers, and weapon systems).
   - A unique passive skill or a signature piece of starting vehicle equipment (e.g., a jury-rigged EMP field, a salvaged grappling hook, enhanced engine components).
2. **Wasteland Navigation:** Players progress through a procedurally generated map, representing different sectors of the wasteland (e.g., ruined cities, barren deserts, toxic swamps, fortified canyons). Nodes on the map represent various encounters:
   - **Combat Zones:** Engagements with marauder gangs, mutated creatures, rival scavengers, or automated security systems.
   - **Scavenge Points:** Opportunities to find "Scrap" (primary currency), Fuel (a potential secondary resource for special actions or travel), spare parts (for repairs or crafting), or new Tactics cards.
   - **Makeshift Garages:** Safe havens to repair vehicles, upgrade cards, install powerful Vehicle Mods, or discard unwanted cards from their decks.
   - **Distress Signals & Anomalies:** Unique narrative events presenting choices with significant risks and rewards, potentially impacting driver morale, resources, or unlocking rare opportunities.
   - **Faction Outposts/Boss Arenas:** Heavily defended locations controlled by powerful warlords or monstrous entities, guarding valuable loot or critical path progression.
3. **Vehicular Combat:** Turn-based card combat where players strategically manage the actions of both their drivers and their vehicles.
   - **Synergistic Play:** Success hinges on effectively combining the abilities, weapons, and maneuvers of the two vehicles. Card effects can be amplified or altered based on the partner's actions or status.
   - **Resource Management:** Players utilize "Adrenaline" (generated each turn and through specific card effects) to play Tactics cards. Some powerful abilities might also consume Fuel or specific Ammo types.
   - **Targeting & Positioning:** While not strictly grid-based, relative positioning (e.g., flanking, taking cover behind wreckage, maintaining optimal weapon range) will be tactically important. Players can target specific enemy vehicles or, in some cases, their vulnerable components (e.g., engines, weapons, tires).
4. **Deckbuilding & Vehicle Customization:** Post-encounter, players are rewarded with choices of new Tactics cards to add to either driver's deck, discover powerful Vehicle Mods (the game's equivalent of artifacts/relics), and salvage Scrap (currency).
   - **Scrap Utilization:** Scrap is used in Garages to upgrade cards (e.g., increasing damage, reducing Adrenaline cost, adding secondary effects), enhance vehicle attributes (Armor, Speed, Handling, Cargo Capacity, Weapon Mounts), or install new Mods.
   - **Deck Refinement:** Options to remove cards from decks are crucial for maintaining efficiency, especially when managing two distinct but cooperating decks.
5. **Run Culmination & Consequences:** Runs typically culminate in challenging boss battles against formidable wasteland leaders or colossal mutated threats.
   - **Victory:** Defeating the final boss of a region or the ultimate antagonist completes the run, potentially unlocking new drivers, vehicles, Tactics cards, Vehicle Mods, cosmetic items, or higher difficulty tiers ("Wasteland Infamy Levels").
   - **Defeat (Lose Scenarios):**
     - **One Driver Down:** If one driver's vehicle is destroyed (HP reaches zero), that driver is incapacitated for the remainder of the current combat. The surviving driver may receive a temporary "Lone Wolf" buff (e.g., increased Adrenaline generation, temporary stat boost) but loses access to their partner's deck and synergistic abilities. The downed vehicle can be repaired at a Garage if the encounter is won, but perhaps at a significant Scrap cost or with lasting minor damage for the run (e.g., a permanent reduction in max HP for that vehicle until the run ends or a specific repair event is found).
     - **Both Drivers Down:** If both player vehicles are destroyed in the same combat, or if the sole remaining vehicle is destroyed, the run ends. Players return to the hub/main menu, retaining any meta-progression unlocks but losing run-specific progress.
     - **Critical Resource Depletion (Optional):** Running out of Fuel in a critical map segment without means to refuel could also lead to a run-ending scenario (e.g., stranded and overwhelmed by ambient threats).
6. **Meta-Progression:** A persistent progression system rewards players across multiple runs. This includes unlocking:
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
