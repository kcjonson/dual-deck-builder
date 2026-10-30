# Software Specification: Wasteland Wheels

## 1. Introduction

This document outlines the software specification for **Wasteland Wheels**, a new deckbuilder roguelike game. Set in a desolate, post-apocalyptic world reminiscent of _Mad Max_ and _Carmageddon_, players control a duo of unique drivers and their heavily customized combat vehicles. The game aims to innovate within the genre by introducing a unique core mechanic, the "Symbiotic Driver System," and offering a compelling couch co-op experience, while building upon the successful elements of established titles like Slay the Spire, Monster Train, and Balatro. The primary goal is to deliver a deeply strategic, highly replayable, and engaging experience for fans of the genre and newcomers alike.

## 2. Core Gameplay Loop

The game follows a run-based roguelike structure. Players embark on perilous journeys across a ravaged wasteland, making strategic choices that shape their drivers' abilities, vehicle loadouts, and chances of survival.

1. **Driver & Vehicle Selection (The Symbiotic Drivers):** At the start of each run, players (or player, in single-player mode) select a pair of two distinct drivers. Each driver comes with a unique starting vehicle (e.g., agile buggy, armored truck, nimble motorcycle, versatile gyrocopter), a small specialized deck of ability/maneuver cards, and a passive skill or unique piece of starting equipment (e.g., a specific weapon, defensive mod, or unique gadget).
2. **Wasteland Navigation:** Players progress through a procedurally generated map, representing different sectors of the wasteland (e.g., ruined cities, barren deserts, toxic swamps, fortified canyons). Nodes can include:
   - **Combat Encounters:** Battles against rival gangs, mutated creatures, or automated defense systems.
   - **Scavenge Sites:** Opportunities to find Scrap (currency), fuel, parts, or new cards.
   - **Garages/Workshops:** Places to repair vehicles, upgrade cards, install mods, or remove unwanted cards.
   - **Distress Signals/Points of Interest:** Unique events with narrative choices, risks, and rewards.
   - **Outposts/Strongholds:** Elite encounters or boss battles guarding valuable resources or passage to new areas.
3. **Vehicular Combat:** Turn-based card combat where players manage the actions of both their drivers/vehicles. Success hinges on effectively synergizing the abilities, weapons, and maneuvers of the two vehicles. Combat will involve:
   - **Positioning:** Relative positioning (e.g., flanking, cover, range bands) will be a factor, though not necessarily grid-based movement unless deemed essential in prototyping.
   - **Targeting:** Players can target specific enemy vehicles or, in some cases, vulnerable components.
   - **Resource Management:** Managing "Adrenaline" (the primary resource for playing cards) and potentially vehicle-specific resources like ammo or special fuel.
4. **Deckbuilding & Vehicle Customization:** After encounters, players will acquire new ability/maneuver cards for either driver's deck, find powerful vehicle modifications ("Mods" - equivalent to artifacts/relics), and salvage "Scrap" (currency). Players can use Scrap at Garages to upgrade cards, improve vehicle stats (e.g., Armor, Speed, Handling, Weapon Slots), or install new Mods.
5. **Run Culmination & Consequences:** Runs culminate in challenging boss battles against formidable wasteland warlords or massive mutated beasts.
   - **Victory:** Successfully defeating the final boss completes the run, potentially unlocking new drivers, vehicles, cards, Mods, or higher difficulty tiers.
   - **Defeat (Lose Scenarios):**
      - **One Driver Down:** If one driver's vehicle is destroyed, they are incapacitated. The remaining driver might receive a temporary

_The original document ends here, mid-sentence. Its content was carried forward and expanded in [Gameplay Mechanics and Style](../specs/Gameplay%20Mechanics%20and%20Style.md)._
