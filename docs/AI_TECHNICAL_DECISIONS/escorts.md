# Escorts

## Date
2026-09-25

## Context

The battle screen was sized for a convoy bigger than two vehicles, and the road model record left escorts as "a new system with no design yet beyond slots and plates, no hand". DDB-133 asked for the design: escorts are vehicles with slots and plates but no hand, ordered with cards from the drivers' decks. Writing it down also had to settle a road question the grid left open. A flanker keeps its formation slot reserved and nobody starts on a shoulder, so a side can never have more than six vehicles on the road, even though Combat Rules and the screen both said nine.

Kevin made every decision in the next section on 2026-09-25. The specs: [Combat Rules](../specs/Combat%20Rules.md) (Escorts, plus Team, Vehicle, The road, Flanking, Losing vehicles and drivers, and Enemy intents), [Card System Design](../specs/Card%20System%20Design.md) 1.3 and 4.5, [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 3.2, 4.2, and 5.2, and [Battle Screen Design](../specs/Battle%20Screen%20Design.md) sections 1, 3, and 9.

## Options considered

- **Road capacity.** Keep the cap at six a side; let a flanker give up its reserved slot so the convoy can close up; or let an encounter start some vehicles already on the shoulder (chosen). Closing up breaks "nothing moves that you didn't move" from the road model, and a six cap wastes the three shoulder slots the grid was sized for.
- **How escorts act.** On their own every turn with a simple AI; through a third hand or escort deck; or only when a driver plays an order card (chosen). Automatic escorts make a big convoy play itself, and a third hand is the 15-cards-a-turn load the road model already rejected.
- **Order targeting.** Two drops (pick the escort, then the target); drop on the escort and let it pick; or drop attack orders on the raider and buff orders on the escort (chosen). Two drops breaks the rule that every card is one drop.
- **Escort durability.** A crew with HP like a driver, or structure only (chosen).
- **A driven vehicle that loses its driver.** Leaves the road (the original draft's rule), or carries on as an escort (chosen).

## Decisions (Kevin, 2026-09-25)

1. **Ambush starts.** An encounter can start some vehicles already flanking, on the other team's shoulder: raider reinforcements, or an escort in a set piece. They have no reserved slot and no outran vehicle. That makes nine a side possible: six in formation, three on the shoulder. At the end-of-turn drop-back check an ambusher holds the shoulder, the same as a flanker whose outran vehicle is wrecked. The mock's Full road scenario was said to be legal only as an ambush start; decision 14 revisits that.
2. **Orders.** Escorts act only when an order card is played. Each escort brings one signature order card into a driver's deck, removed if the escort is lost. Generic order cards join the reward pool only while you own an escort.
3. **Order targeting.** Attack orders target the raider, and the nearest ready escort in range carries them out; the drag highlights that escort. Buff orders (armor, Draw Fire) target an escort directly. Every card stays a single drop.
4. **Raider targeting.** Raider archetypes have target preferences, shown through planned intents: looters go for haulers, killers go for drivers. Draw Fire is the counter.
5. **Acquisition.** Events and garage hire. Convoy contracts come later.
6. **Action economy.** Each escort acts once per turn and shows a SPENT chip.
7. **Loss.** A lost escort is gone for the run, with its signature card. Haulers pay an after-fight dividend (Fuel Hauler +1 fuel, Salvage Rig +15 scrap). Escort damage persists between fights and the garage repairs it. Escorts never count toward defeat, which stays "all drivers dead" (decision 21 changed that to "no driver left in the fight").
8. **Stats.** Escorts have their own gunnery, evade, ramming, and base speed, and no HP. Past armor, all damage goes to structure (16 covers an escort carrying a passenger). They flank under the normal rules.
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
- **Wrecked mid-fight.** The signature card an escort brought stays in the deck, hand, or discard for the rest of the fight, then leaves the deck when the fight ends. Decision 18 makes it playable while any escort of its type lives.
- **Ready resets** at the start of the player's turn. Escorts don't act on the enemy turn.
- **Preference fallback.** A raider with a target preference picks its preferred target when that target is legal for the card, and otherwise plans as it does today. Which raiders are looters or killers isn't defined anywhere yet; DDB-150 assigns archetypes. AI System Technical Design 2.1 points here.
- **Speed.** An escort's speed is its base speed, and an unmanned vehicle keeps its own base speed with default crew skills.
- **Capacity.** You own up to four escorts; at four, taking another (hire or event) means dismissing one first. Hiring is offered in the garage's Convoy strip.
- **Rally the Convoy** fires at range 2, the same as Covering Fire, with a gunnery against evade check per escort.
- **Rarity.** Covering Fire, Ramming Run, and Close Ranks are common. Draw Fire (uncommon) and Rally the Convoy (rare) were given.
- **Numbers left to the build.** Escort gunnery, evade, ramming, armor, and structure; the haulers' speeds; default crew stats; hire and repair costs; upgraded card values.

## Follow-up decisions (Kevin, 2026-09-25)

The first draft of this record had nine open questions. Kevin answered four the same day.

13. **Draw Fire never cancels.** It redirects only the intents whose card can reach the escort. The rest hit their original target as planned. Draw Fire protects; it never makes an attack fizzle. (Before this, the rule for player-caused changes would have fizzled a redirected card that couldn't reach the escort, turning Draw Fire into a way to cancel attacks.)
14. **Who can ambush.** Ambushers are raiders and set-piece escorts. Raider encounters and reinforcement waves can place raiders on the player's shoulder, at the start of the fight or when a wave arrives. A set-piece escort (an event ally, say) can start on the raiders' shoulder. The player's two driven vehicles always start in formation. The Interceptor on the shoulder in the mock's Full road scenario got there by flanking, not by ambush.
15. **Spending.** Attack orders (Covering Fire, Ramming Run, Rally the Convoy) and Draw Fire spend the escort. Close Ranks and Triage don't; Triage is the Med Truck's card, not its action. Buff orders can target a spent escort.
16. **A passenger in an escort.** When an escort carries a passenger, damage past armor splits half to structure and half to the passenger, the same as a driven vehicle. An empty escort takes it all on structure.

Three edges the answers didn't cover, noted rather than decided, each left to its build task:

- Whether a driver-only attack (Headshot) can target a passenger riding in an escort. DDB-148 settled it: yes (see Undriven damage).
- Whether an area intent aimed at both driven vehicles counts as "aimed at a driven vehicle in the escort's row" for Draw Fire. DDB-150.
- Whether a set-piece escort joins the convoy after the fight. DDB-153.

Full road, read against 14: its raider side (six in formation, three on the player's shoulder) is a legal ambush. Its player side isn't a legal position. The Interceptor flanked, so its formation slot should be empty and reserved, but the formation is full, and it holds five escorts against the cap of four. The scenario stays as a layout stress case with a legal raider side. DDB-155 builds the legal gallery scenes.

## Review decisions (Kevin, 2026-09-25)

Answered during the review of #45.

17. **Seats.** Every vehicle, escorts included, has one passenger seat. A wreck's passenger jumps too, the driver first. A driver with no free seat is out of the fight but alive: their hand is gone for that fight and they come back after it. This matches the code in PR #46.
18. **Duplicate escort types.** Allowed. When two escorts want the same preferred slot, roster order settles it (first acquired wins). Triage needs any living Med Truck. Each duplicate brings its own copy of its signature card.
19. **Ambush rows.** Ambushers start only in rows with an opposing vehicle. After that, a shoulder vehicle with nothing opposite is legal, since its target can die. Battle Screen Design 10's lint checks this at placement only.
20. **Draw Fire timing.** It lasts until the end of the next enemy turn. Each intent aimed at a driven vehicle in that row is judged as it plays: if its card can reach the escort, it hits the escort instead. Target marks update so the end-turn preview shows the redirect. If two Draw Fires cover the same row, the last one played wins.

Review fixes that aren't Kevin's calls, applied at the same time:

- Losing a driver is scoped by team. On the player's team a driverless vehicle becomes an escort; a raider vehicle that loses its driver with no passenger is out of the fight and leaves the road at the end of the turn, like a wreck, and its plan drops. The partner's-vehicle-then-nearest-escort order is the player's; raider occupants take any free seat on their team, as the rule said before escorts.
- A vehicle that becomes an escort mid-turn starts spent.
- Rally the Convoy resolves escorts in roster order and re-picks the nearest raider for each escort from raiders still alive.
- Triage heals the driver or passenger you choose in the targeted vehicle, up to their starting HP, like Medical Kit. How you choose is a proposal, since a card is one drop onto a vehicle: dropping on the plate's passenger row picks the passenger.
- Headshot on an escort: DDB-148 settled it: an empty escort isn't a legal Headshot target (see Undriven damage).

## Defeat (Kevin, 2026-09-25)

The seat rule (17) left a gap: a driver with no free seat is out of the fight but alive, so two drivers could both be out while defeat, still "all drivers dead", didn't trigger. Kevin's framing: one driver must survive to circle back down the road to pick up the other player who crashed out, so the run only needs one survivor to continue, and both out means true death.

21. **Crashed out and defeat.** A driver with no free seat has crashed out: out of the fight but alive. After a won fight, the surviving driver goes back down the road and picks them up, so they rejoin the run. Defeat is no longer "all drivers dead". The fight continues while at least one of your drivers is still in it, driving or riding as a passenger. When none are (every driver dead or crashed out), the run ends: true death, the session is over, with no rescue even for a driver who crashed out alive.

## Undriven damage (DDB-148, 2026-09-26)

Built with DDB-148, which gave escorts hit checks and damage. The passenger split (16) was Kevin's; the Headshot call below was the build's, as the review asked, and is written into Combat Rules. It's a proposal for Kevin to confirm or change.

22. **Headshot and escorts.** An empty escort is not a legal target for a driver-only attack. The drag doesn't light it, the AI never plans at it, and nothing is spent. An escort carrying a passenger is a legal target, and Headshot hits the passenger, with the hit check against the escort's own evade (plus Headshot's modifier) like any other attack on it. If a planned Headshot's passenger dies before it plays, the escort has nobody aboard to hit and the card fizzles, the same as any planned card whose target turned illegal.

Why not let it fizzle: Combat Rules says an escort is a legal target like any vehicle, but the fizzle rules in the intents record are for plans the board changed after they were made, not a way to throw a card at something it can't hurt. An illegal target keeps the drop highlight honest, so a player never pays two adrenaline for nothing, and it answers Draw Fire's "can its card reach the escort" cleanly: Headshot can't reach an empty one, so it hits its original target, and decision 13's "Draw Fire never makes an attack fizzle" holds.

What else the build settled:

- **One hit rule.** `Battle.checkHit` is the only hit check. Play, raider planning (`BoardProjection.apply`), and the AI's damage estimate all call it. Each side's skills come from its vehicle (`Vehicle.crewSkills`): an escort's own, whoever rides in it or orders it; otherwise the caster's when attacking and the driver's when defending. A debuff a raider plans at an escort now rolls against the escort's evade in the projection, the same as in play.
- **Damage.** `Vehicle.takeDamage` splits damage past armor half to structure and half to each living occupant, and with nobody aboard puts it all on structure. That covers the empty escort and, for DDB-152, the escort with a passenger.
- **Wrecks.** A wrecked escort holds its slot for the rest of the turn and leaves at the end of it, like any wreck. It has nobody to jump unless a passenger rides in it, and a card planned at it fizzles because nobody got out.
- **Self costs.** They resolve the same whatever the target is. Self statuses, adrenaline, and draws are their own effects and apply on a hit or a miss. A self-damage effect on a targeted card still rolls with the card, as it does against a driven vehicle today, so a miss skips it; no current card has one on an attack. Whether a cost should land on a miss is the same question as open question 2 (Ramming Run), left to DDB-149.
- **Ram and speed.** The ram formula and speed checks read `Vehicle.getTotalSpeed` on both sides, which is base speed plus statuses for an escort. The driven side's double-counted driver speed is DDB-159 and wasn't touched.

## Open questions

These change gameplay, so they're Kevin's. Kevin filed the build as DDB-146 to DDB-155, and each question names the task that settles it.

1. **The other signature cards.** Only the Med Truck's (Triage) is named. The Outrider, Pilot Car, and Fuel Hauler each need one. DDB-149 (ORDER cards and order resolution).
2. **Ramming Run on a miss.** Does the escort still take its 2 structure when the ram misses? DDB-149.
3. **After the fight, an unmanned vehicle** is an escort "for the rest of the fight". Does it stay in the convoy afterwards (counting toward four, with no signature card), or is it gone? DDB-152 (passengers in escorts, unmanned vehicles becoming escorts).
4. **Med Truck dividend.** The Med Truck is a hauler, but only the Fuel Hauler has a dividend set. Does the Med Truck pay one, or is Triage its payoff? DDB-151 (escort loss, persistence, and dividends).
5. **Orders that move an escort to the shoulder.** Escorts flank under the normal rules, but no order in the first set moves one onto the shoulder, so in the first version an escort only gets there as a set-piece ambusher. DDB-149.

## Consequences

- `Vehicle` already allows a null driver. Escorts need crew skills on the vehicle, a ready flag, and speed from base speed alone. `Battle` gains order resolution (pick the escort, check range and hit, spend it), the SPENT state, and the passenger and unmanned rules.
- Enemy planning gains archetype target preferences. Draw Fire doesn't rewrite committed plans: it's a row cover checked as each intent plays, plus target marks that update for the preview. Reinforcement waves need a way to place raiders on the player's shoulder when they arrive.
- `CardLoader` will need to accept the `escort` target type (`validTargets` in `CardLoader.ts` doesn't list it today) and card data will gain the `order` tag and `signatureOf`. `cards.json` has no order cards yet, so the card data check doesn't cover them; the six summaries were measured by hand at 44 to 58 rendered characters against the 60 proxy.
- Code that conflicts with these rules today:
  - `Team.addVehicle` throws past two player vehicles, so escorts can't join a player team.
  - `Team.handleDriverEscape` puts the driver in the first vehicle with a free seat, not the partner's vehicle and then the nearest escort.
  - `Vehicle.handleDriverDeath` is never called (DDB-156), so neither passenger promotion nor a driverless vehicle becoming an escort happens.
  - `Driver.isAttackCard` treats any card with a damage or ram effect, or with "attack", "shot", or "ram" in its name, as an attack, so passengers couldn't play Covering Fire, Ramming Run, or Rally the Convoy. The passenger gate needs to use the `order` tag.
- Signature cards are per escort, so a card instance needs to know which escort brought it.
- After PR #46, `Team.isDefeated` already behaves like decision 21 in a fight, since stranded drivers leave the team. Nothing yet carries a crashed-out driver back into the run after a won fight; that's a future run-state task.
- Escorts are run state: they persist between fights with their damage, and the map, events, and garage read them.
- The battle screen mock still draws a driver HP bar on escort plates and has seven escorts in Full road. It was left alone apart from a comment on the Full road scenario pointing at the ambush-start rule and saying the Interceptor got onto the shoulder by flanking.
