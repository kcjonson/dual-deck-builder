# Escorts

## Date
2026-09-25

## Context

The battle screen was sized for a convoy bigger than two vehicles, and the road model record left escorts as "a new system with no design yet beyond slots and plates, no hand". DDB-133 asked for the design: escorts are vehicles with slots and plates but no hand, ordered with cards from the drivers' decks. Writing it down also had to settle a road question the grid left open. A flanker keeps its formation slot reserved and nobody starts on a shoulder, so a side can never have more than six vehicles on the road, even though Combat Rules and the screen both said nine.

Kevin made every call below on 2026-09-25. The specs: [Combat Rules](../specs/Combat%20Rules.md) (Escorts, plus Team, Vehicle, The road, Flanking, Losing vehicles and drivers, and Enemy intents), [Card System Design](../specs/Card%20System%20Design.md) 1.3 and 4.5, [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 3.2, 4.2, and 5.2, and [Battle Screen Design](../specs/Battle%20Screen%20Design.md) sections 1, 3, and 9.

## Options considered

- **Road capacity.** Keep the cap at six a side; let a flanker give up its reserved slot so the convoy can close up; or let an encounter start some vehicles already on the shoulder (chosen). Closing up breaks "nothing moves that you didn't move" from the road model, and a six cap wastes the three shoulder slots the grid was sized for.
- **How escorts act.** On their own every turn with a simple AI; through a third hand or escort deck; or only when a driver plays an order card (chosen). Automatic escorts make a big convoy play itself, and a third hand is the 15-cards-a-turn load the road model already rejected.
- **Order targeting.** Two drops (pick the escort, then the target); drop on the escort and let it pick; or drop attack orders on the raider and buff orders on the escort (chosen). Two drops breaks the rule that every card is one drop.
- **Escort durability.** A crew with HP like a driver, or structure only (chosen).
- **A driven vehicle that loses its driver.** Leaves the road (the original draft's rule), or carries on as an escort (chosen).

## Decisions (Kevin, 2026-09-25)

1. **Ambush starts.** An encounter can start some vehicles already flanking, on the other team's shoulder: raider reinforcements, or an escort in a set piece. They have no reserved slot and no outran vehicle. That makes nine a side possible: six in formation, three on the shoulder. At the end-of-turn drop-back check an ambusher holds the shoulder, the same as a flanker whose outran vehicle is wrecked. The mock's Full road scenario is legal only as an ambush start.
2. **Orders.** Escorts act only when an order card is played. Each escort brings one signature order card into a driver's deck, removed if the escort is lost. Generic order cards join the reward pool only while you own an escort.
3. **Order targeting.** Attack orders target the raider, and the nearest ready escort in range carries them out; the drag highlights that escort. Buff orders (armor, Draw Fire) target an escort directly. Every card stays a single drop.
4. **Raider targeting.** Raider archetypes have target preferences, shown through planned intents: looters go for haulers, killers go for drivers. Draw Fire is the counter.
5. **Acquisition.** Events and garage hire. Convoy contracts come later.
6. **Action economy.** Each escort acts once per turn and shows a SPENT chip.
7. **Loss.** A lost escort is gone for the run, with its signature card. Haulers pay an after-fight dividend (Fuel Hauler +1 fuel, Salvage Rig +15 scrap). Escort damage persists between fights and the garage repairs it. Escorts never count toward defeat, which stays "all drivers dead".
8. **Stats.** Escorts have their own gunnery, evade, ramming, and base speed, and no HP. Past armor, all damage goes to structure. They flank under the normal rules.
9. **Slots and range.** Same as any vehicle, no cover geometry. Escorts fill the formation after the drivers, and each type has a preferred slot, used as its encounter or opening slot.
10. **Passengers.** A driver whose vehicle is wrecked goes to the partner's vehicle first, then the nearest escort. A passenger can play order cards, which are a new card type, not attack.
11. **Unmanned.** A driven vehicle whose driver dies with no passenger becomes an escort for the rest of the fight, with default crew stats.
12. **Map and garage.** The map's convoy marker shows the escort count, and events can be gated on an escort ("(Med Truck) Treat the survivors"). The garage gets a Convoy strip in the mods panel with repair and dismiss.

The minimal first version: up to four escorts in formation, four starting types (Outrider, gun, speed 5; Pilot Car, gun, speed 4; Fuel Hauler, +1 fuel dividend; Med Truck, brings Triage), the `[Escort]` keyword ("An undriven vehicle in your convoy. Acts only when ordered, once per turn."), and six order cards: Covering Fire, Ramming Run, Draw Fire, Close Ranks, Triage, and Rally the Convoy.

## Rationale

- **Ambush starts keep the road model intact.** The reserved slot is the cost of flanking and the reason the board holds still between turns. Starting some vehicles on the shoulder gets to nine without touching either.
- **Orders keep two hands.** Escorts cost cards and adrenaline from the same two decks, so the Symbiotic Driver System stays the thing you manage, and a bigger convoy means more choices per turn rather than more hands. The signature card ties each escort into a deck, which makes losing one cost something in the next fight too.
- **One drop per card.** Letting the rules pick the escort for an attack order, and showing which one while you drag, keeps orders as quick to play as any attack.
- **Preferences through intents.** Planned intents already show who each raider is aiming at before you act. Looters and killers make escorts something to protect, and a hauler worth protecting is why the dividend exists.
- **No HP.** One damage track per escort keeps the plate simple and keeps defeat about the drivers.

## Calls made while writing it up

These weren't in the decision and are needed for the text to be buildable. Each is marked in the specs where it matters. They're proposals for Kevin to confirm or change.

- **Attack order ties.** Nearest is lowest range to the target raider. Ties go to the inside lane, then the outside lane, then the enemy shoulder, and within a lane to ahead, then center, then behind. The same order breaks ties for "the nearest escort" a passenger moves to (range measured from the wreck), and, mirrored, for Rally the Convoy's "nearest raider".
- **No escort in range.** A raider with no ready escort in range of an attack order isn't a legal target for it.
- **Preferred slots.** Outrider inside ahead, Pilot Car outside ahead, Fuel Hauler outside center, Med Truck outside behind. With the drivers at inside center and inside behind, the four fill the formation without colliding. If a preferred slot is taken, the escort takes the next free slot in the normal fill order.
- **Which deck.** The player picks which driver's deck a signature card goes into, the same way the garage asks which driver gets a bought card.
- **Wrecked mid-fight.** A signature card whose escort is wrecked stays in the deck, hand, or discard but can't be played for the rest of the fight, then leaves the deck when the fight ends. This reads Triage's "only playable while the Med Truck lives" as the general rule.
- **Ready resets** at the start of the player's turn. Escorts don't act on the enemy turn.
- **Preference fallback.** A raider with a target preference picks its preferred target when that target is legal for the card, and otherwise plans as it does today.
- **Speed.** An escort's speed is its base speed, and an unmanned vehicle keeps its own base speed with default crew skills.
- **Capacity.** You own up to four escorts; at four, taking another (hire or event) means dismissing one first. Hiring is offered in the garage's Convoy strip.
- **Rally the Convoy** fires at range 2, the same as Covering Fire, with a gunnery against evade check per escort.
- **Rarity.** Covering Fire, Ramming Run, and Close Ranks are common. Draw Fire (uncommon) and Rally the Convoy (rare) were given.
- **Numbers left to the build.** Escort gunnery, evade, ramming, armor, and structure; the haulers' speeds; default crew stats; hire and repair costs; upgraded card values.

## Open questions

These change gameplay, so they're Kevin's.

1. **The other signature cards.** Only the Med Truck's (Triage) is named. The Outrider, Pilot Car, and Fuel Hauler each need one.
2. **Does a buff order spend its escort?** Close Ranks says it doesn't, which suggests others might. Do Draw Fire and Triage spend the escort, and can a buff order target an escort that is already spent? Triage also doesn't say whether the Med Truck needs to be ready.
3. **Draw Fire and range.** When an intent retargets to the escort but the raider's card can't reach it (a range 1 shot at a vehicle in the inside lane, redirected to an escort in the outside lane), the existing rule for player-caused changes makes it fizzle. That turns Draw Fire into a way to cancel attacks outright. Is that intended, or should out-of-range intents stay on their original target? The same question applies to area intents aimed at both vehicles.
4. **A passenger in an escort.** All damage past armor goes to an escort's structure, so a passenger riding in one never takes damage until the escort is wrecked, and a driver-only attack (Headshot) has nothing to hit. Should damage reach the passenger, and how?
5. **Ramming Run on a miss.** Does the escort still take its 2 structure when the ram misses?
6. **After the fight, an unmanned vehicle** is an escort "for the rest of the fight". Does it stay in the convoy afterwards (counting toward four, with no signature card), or is it gone?
7. **Who can ambush.** The examples are raider reinforcements and set-piece escorts, but the Full road mock starts a driven vehicle (the Interceptor) on the raiders' shoulder. Can a driven vehicle be an ambush start? Does a set-piece escort beyond the four join the convoy after the fight? And can a reinforcement wave that arrives mid-fight arrive on the shoulder, or only at the start?
8. **Med Truck dividend.** The Med Truck is a hauler, but only the Fuel Hauler has a dividend set. Does the Med Truck pay one, or is Triage its payoff?
9. **Flank orders.** Escorts flank under the normal rules, but no order in the first set moves one onto the shoulder, so in the first version an escort only flanks by starting there.

## Consequences

- `Vehicle` already allows a null driver. Escorts need crew skills on the vehicle, a ready flag, and speed from base speed alone. `Battle` gains order resolution (pick the escort, check range and hit, spend it), the SPENT state, and the passenger and unmanned rules.
- Enemy planning gains archetype target preferences, and Draw Fire has to rewrite committed plans, which the planner doesn't do today.
- `CardLoader` accepts the `escort` target type and the `order` tag, and card data gains `signatureOf`. The card data check covers the six new summaries; all are under the 60-character proxy.
- Escorts are run state: they persist between fights with their damage, and the map, events, and garage read them.
- The battle screen mock still draws a driver HP bar on escort plates and has seven escorts in Full road. It was left alone apart from a comment on the Full road scenario pointing at the ambush-start rule.
