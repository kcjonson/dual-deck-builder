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

- **One hit rule.** `Battle.checkHit` is the only hit check. Play and raider planning (`BoardProjection.apply`) both call it, and the combat screen's drag highlight skips an empty escort for Headshot. Each side's skills come from its vehicle (`Vehicle.crewSkills`): an escort's own, whoever rides in it or orders it; otherwise the caster's when attacking and the driver's when defending. A debuff a raider plans at an escort now rolls against the escort's evade in the projection, the same as in play.
- **Damage.** `Vehicle.takeDamage` splits damage past armor half to structure and half to each living occupant, and with nobody aboard puts it all on structure. That covers the empty escort and, for DDB-152, the escort with a passenger.
- **Wrecks.** A wrecked escort holds its slot for the rest of the turn and leaves at the end of it, like any wreck. It has nobody to jump unless a passenger rides in it, and a card planned at it fizzles because nobody got out.
- **Self costs.** They resolve the same whatever the target is. Self statuses, adrenaline, and draws are their own effects and apply on a hit or a miss. This line used to say a self-damage effect on a targeted card rolls with the card, so a miss skips it; DDB-160, which landed after it, made self damage a flat printed cost that lands hit or miss, and that's the engine rule now. Ramming Run's self damage is the exception and is marked as such in its card data (decision 26).
- **Ram and speed.** The ram formula and speed checks read `Vehicle.speed` on both sides, which is base speed plus statuses for an escort. A driven vehicle used to count its driver's speed twice; DDB-159 fixed that, so it's base speed plus the driver's speed skill plus statuses.

## Order cards (DDB-149, 2026-09-26)

Built with DDB-149, which added the order card type and order resolution. Open questions 1, 2, and 5 were Kevin's; he delegated them, and they were decided 2026-09-26. Each is written into Combat Rules (Escorts) and Card System Design 1.3 and 4.5.

23. **Outrider signature: Run Ahead** (decided 2026-09-26, Kevin delegated the call). 1 adrenaline, targets a raider (`enemy_single`). The nearest ready Outrider gains +2 Speed for 2 turns, then flanks the target under the normal flank rules: the target must be in the raiders' formation and slower than the Outrider after the boost; the Outrider moves to the enemy shoulder in the target's row; the flank fails and the card goes back to the hand if that shoulder slot is taken; its formation slot stays reserved; it drops back at the end of a turn as usual. Spends the Outrider. Range isn't a constraint; nearest-with-ties picks among ready Outriders that can legally flank the target, and a raider no ready Outrider can flank isn't a legal target. Why: speed 5 is the Outrider's only distinguishing stat, and without the boost it can't flank a speed 5 raider like the Rust Buggy, since ties can't flank. Rarity: signature, never in the reward pool or shop.
24. **Pilot Car signature: Flag Down** (decided 2026-09-26, Kevin delegated the call). 1 adrenaline, targets a raider within range 2 of a ready Pilot Car (nearest-with-ties picks which). The raider becomes Vulnerable and gets -2 Speed until the end of the next enemy turn. Sure-hit, like Oil Slick. Spends the Pilot Car. Why: it gives the gun escorts a setup play before Covering Fire, and the slow lets drivers flank.
25. **Fuel Hauler signature: Top Off** (decided 2026-09-26, Kevin delegated the call). 0 adrenaline, targets a vehicle in your convoy (`ally`). The driver of that vehicle gains +1 Adrenaline, with the same occupant picking as Triage and Medical Kit (dropping on a plate's passenger row picks the passenger). Needs a living Fuel Hauler and doesn't spend it. Why: it makes the hauler your adrenaline source, which is what looters target, so protecting it with Draw Fire is a real choice; it also lets one driver fuel the partner.
26. **Ramming Run on a miss** (decided 2026-09-26, Kevin delegated the call). The 2 self damage to the escort applies only on a hit. A miss means no collision; the card, adrenaline, and escort action are already lost. The decision assumed this matched the engine's rule that self damage on a targeted card rolls with the card. That was true when "Self costs" was written, but DDB-160 changed it (self damage is now flat and lands on a miss), so the card marks its self damage `on_hit`: it happens only if an earlier effect of the card landed on someone else. The summary says "Takes 2 on a hit."
27. **Orders and the shoulder** (decided 2026-09-26, Kevin delegated the call). Orders move an escort onto the shoulder only through Run Ahead. There's no generic flank order in the first set.

28. **Shield** (decided 2026-09-26, Kevin delegated the call). Close Ranks and Draw Fire grant Shield instead of armor. Shield is temporary armor: it absorbs damage before armor, isn't capped by the vehicle's armor, stacks, and clears from every vehicle at the start of the player's turn and when a fight starts. Close Ranks gives 6 and doesn't spend; Draw Fire gives 4, spends, and redirects. Damage that skips armor skips Shield too (Ramming Run's structure-only cost, Headshot), and Ram's Armor/10 ignores it. Keyword `[Shield]`: "Temporary armor. Absorbs damage before Armor. Clears at the start of your next turn." Why: every armor card is capped at the vehicle's starting armor, so order armor did nothing on an escort at full armor or with none. That made Close Ranks a dead card and left the Outrider (0 armor) unable to use armor orders at all. Temporary armor that clears each turn is what players expect from Block in Slay the Spire, and it matches Draw Fire's one-enemy-turn window. Armor Plating and Repair Kit stay on capped armor; DDB-164 decides whether they move to Shield.

What the build settled. These are implementation calls, not Kevin's, and each is small enough to change:

- **Card data.** Orders are tagged `order` and never `attack`; `CardLoader` rejects an order tagged attack, an escort-commanding card that isn't tagged order, and a `signatureOf` that isn't an escort type or doesn't come with `signature` rarity. The `escort` target type is new. `spendsEscort` marks the orders that spend. A card copy carries `broughtBy` (the escort's id). DDB-151 reads it to take a lost or dismissed escort's copy out; DDB-153 fills it when an escort joins, and until then nothing sets it.
- **The passenger gate is the tag.** `Driver.isAttackCard`'s damage and name heuristics are gone; a passenger can't play a card tagged `attack`. Two existing cards changed: Oil Slick (tagged attack, no damage) is now blocked for passengers, and Berserker (self damage, tagged utility) is now allowed. Both match how Combat Rules classes them.
- **Ready and spent.** `Vehicle.spent`, with `isReady` meaning an escort in the fight that hasn't acted. `Team.readyEscorts` clears it at the start of every player turn and at `Battle.start`, since escorts persist between fights. A vehicle that becomes an escort mid-turn should start spent, but nothing converts a vehicle yet (DDB-152), so there was nothing to hook; DDB-152 sets `spent` when it converts one.
- **The selector.** `BoardProjection.orderCarrier` is the one rule: ready escorts on the other team from the raider, filtered by the card's longest effect range, by `signatureOf`, and for a flanking card by the flank rules with the card's own speed boost counted; then `nearestTo` with `compareTieOrder` (both in `Road.ts`), which reads lanes from their own side so Rally uses the same order mirrored. `targetBlocker` sends orders there, so the battle, the player AIs, and the combat screen agree; an order's range and flank checks are the carrier's, never the caster's. The combat screen lights the carrier through `CombatModel.carrierVehicleId` on the existing focus border, asks the battle for an order's legal targets, and greys a signature card with no living escort of its type. Plates show a SPENT chip.
- **Rally the Convoy** isn't playable with no ready escort, by analogy with an attack order that has no carrier. Exhaust is new: an `exhaust` card goes to the driver's `exhausted` pile, out of the draw and discard for the rest of the fight, and `Battle.endCombat` puts it back in the deck.
- **Draw Fire.** A list of covering escorts in play order, cleared at the end of the enemy turn. Each planned card is judged as it plays, after a wreck is followed to its survivors: if its target is a driven vehicle in the row a covering escort is in now, the last cover played on that row takes it, when the card could reach that escort from where the raider is (range, flank, target-flanking, Headshot rules). Only cards that land something on their target are redirected, so a flank intent keeps its target; an area intent keeps "both", which is DDB-150's open edge. `getIntents` runs the same check from the raider's planned slot (`PlannedAction.slot`, new), so target marks and the preview damage update when Draw Fire is played. A wrecked covering escort covers nothing, so the last living cover played on the row wins, in the preview and in play.
- **Ramming Run's self damage is structure only**, past armor and passenger, as "takes 2 structure damage" reads (`structure_only`). Elsewhere "structure damage" is loose today (Caltrops goes through armor).
- **Picking who aboard.** `Battle.playCard` takes `targetOccupant`; it must be aboard the target, and without one the effect lands on the driver, or on an escort's passenger. Medical Kit uses the same pick. The plate has no passenger row to drop on yet, so the screen always takes the default. Triage and Top Off can't target a vehicle with nobody aboard.
- **Top Off** is capped at the driver's maximum adrenaline, as every adrenaline gain is.
- **Content numbers.** None new: escort stats are DDB-146's and card values are the spec's.
- **Shield in code.** `Vehicle.shield` (unset means 0), `addShield`, and `takeDamage` taking Shield before armor; `damageStructure` and driver damage never touch it. `Battle.clearShields` runs on both teams beside `readyEscorts`, at `start` and each player turn. The damage log lists "to shield" and adds a Shield before and after when there was any. The preview's per-hit number is worked out before armor, so Shield doesn't change it, and the projection doesn't model damage, so planning needed nothing. Plates show Shield as "SHN" after the armor number (plain ASCII, since the font atlas has nothing else), and the armor pill lights when there is Shield even with no armor.

## Persistence and dividends (DDB-151, 2026-09-26)

Built with DDB-151, which carries escorts from one fight to the next. Open questions 3 and 4 were Kevin's; he delegated them, and they're written into Combat Rules (Losing vehicles and drivers, Escorts).

32. **Med Truck dividend** (decided 2026-09-26, Kevin delegated the call). After each fight it survives, every living driver in the run heals 3 HP, up to their starting HP. That includes a driver who crashed out, since a won fight picks them up. Duplicates each pay, so two Med Trucks heal 6. Why: Triage is in-fight healing, and between-fight healing is the scarce resource in this kind of game, so the heal makes the Med Truck worth protecting from looters, which is what a hauler's dividend is for.
33. **An unmanned vehicle after the fight** (decided 2026-09-26, Kevin delegated the call). A driven vehicle that became an escort because its driver died with no passenger stays in the convoy after the fight, as an escort with default crew stats. It counts toward the four and brings no signature card. Why: with one driver left, the lost partner's vehicle rolling on beside the survivor is worth keeping. If it's a fifth escort, the convoy holds five until you dismiss one; a team can't field five, so that happens before the next fight.

What the build settled. These are implementation calls, not Kevin's; the first one changes gameplay and is a proposal for Kevin to confirm or change:

- **Armor refills between fights.** Only structure carries over; armor is back to full at the start of the next fight. The spec says an escort "starts the next fight with the structure it ended on", and the garage's Convoy strip repairs structure only, so persisting armor would leave the Pilot Car's or Fuel Hauler's armor gone for the run with nothing to fix it. Flipping it is one line in `Vehicle.leaveFight`.
- **Where the fight's state is cleared: at the end of the fight.** `Battle.endCombat` calls `Vehicle.leaveFight` on every living convoy escort: slot, flank, statuses, Shield, and spent are cleared, armor refills, and a passenger gets out for the run to seat. An escort between fights looks like a fresh one from `createEscort` apart from its structure, so `Battle.placeOpeningFormation` can keep reading a preset slot as the encounter's, and an escort that ended the fight on the raiders' shoulder opens the next one in its preferred slot instead of throwing. Clearing on entry instead would mean the battle couldn't tell a leftover slot from an encounter's. This fixes the PR #50 review note.
- **Losing an escort.** The battle remembers the convoy's escorts as the fight began, since a wreck leaves the team at the end of its turn. At `endCombat`, each one wrecked is in the result's `lost`, and every copy it brought (`Card.broughtBy` is its id) leaves each of the player's drivers' cards: deck, hand, discard, and exhausted (`Driver.removeCardsBroughtBy`). Until then the copy stays where it is, playable while another escort of its type lives, which DDB-149 already gated.
- **Dividends.** Every living convoy escort with a dividend pays at `endCombat`, unless the fight was lost (the run is over then). A wrecked hauler pays nothing. `EscortDividend` is `{ kind: 'fuel' | 'scrap' | 'heal', amount }`. The battle applies a heal itself, since it has the drivers who fought. Nothing holds fuel or scrap yet (the combat screen's fuel 5 and scrap 150 are placeholders), so those payouts are in the result for the run layer to add.
- **The result.** `endCombat` returns an `AfterFight` (`escorts`, `lost`, `dividends`), also readable as `battle.afterFight`. It runs once; a second call returns the same result and heals nobody twice. `escorts` is every living escort on the player team at the end, whatever made it one, so a vehicle DDB-152 converts mid-fight is covered without its code. Set-piece allies aren't in it; whether one joins the convoy is DDB-153's.
- **The roster is a `Convoy`** (`src/renderer/game/mechanics/Convoy.ts`), the smallest run-state model that fits: escort vehicles in roster order, `add` (refused at four), `dismiss({ escort, drivers })`, which takes the copy it brought out of those drivers' cards, `afterFight(result)`, which drops the lost and appends anything new at the end of the roster, even past four, and `isOverCap` for the garage to resolve. It holds escorts only; drivers, fuel, scrap, and the map are for a future run-state task. A player team fields the convoy's escorts in roster order.
- **Salvage Rig** isn't built. Adding the type needs a signature card, which isn't designed, so its +15 scrap stays in the spec. The dividend kind already covers scrap.

## Open questions

The first draft's nine open questions are all answered: four the same day (decisions 13 to 16), 1, 2, and 5 with DDB-149 (decisions 23 to 27), and 3 and 4 with DDB-151 (decisions 32 and 33).

## Consequences

- `Vehicle` already allows a null driver. Escorts need crew skills on the vehicle, a ready flag, and speed from base speed alone. `Battle` gains order resolution (pick the escort, check range and hit, spend it), the SPENT state, and the passenger and unmanned rules.
- Enemy planning gains archetype target preferences. Draw Fire doesn't rewrite committed plans: it's a row cover checked as each intent plays, plus target marks that update for the preview. Reinforcement waves need a way to place raiders on the player's shoulder when they arrive.
- `CardLoader` accepts the `escort` target type, and card data has the `order` tag and `signatureOf` (DDB-149). All nine order cards are in `cards.json`, so the card data check covers them: summaries render at 44 to 59 characters against the 60 proxy.
- Code that conflicts with these rules today:
  - `Team.addVehicle` throws past two player vehicles, so escorts can't join a player team.
  - `Team.handleDriverEscape` puts the driver in the first vehicle with a free seat, not the partner's vehicle and then the nearest escort.
  - `Vehicle.handleDriverDeath` is never called (DDB-156), so neither passenger promotion nor a driverless vehicle becoming an escort happens.
  - `Driver.isAttackCard` treated any card with a damage or ram effect, or with "attack", "shot", or "ram" in its name, as an attack. DDB-149 replaced it with the `attack` tag, and orders never carry it.
- Signature cards are per escort, so a card instance needs to know which escort brought it. DDB-149 added `Card.broughtBy`; removal reads it (DDB-151), and deck insertion (DDB-153) will fill it.
- After PR #46, `Team.isDefeated` already behaves like decision 21 in a fight, since stranded drivers leave the team. Nothing yet carries a crashed-out driver back into the run after a won fight; that's a future run-state task.
- Escorts are run state: they persist between fights with their structure, and the map, events, and garage read them. DDB-151 put the roster in `Convoy`; nothing else of the run exists yet.
- A run with one driver left can't field a team yet: `Team` wants exactly two driven vehicles. That's for the run-state task, along with where fuel, scrap, and the drivers live between fights.
- The battle screen mock still draws a driver HP bar on escort plates and has seven escorts in Full road. It was left alone apart from a comment on the Full road scenario pointing at the ambush-start rule and saying the Interceptor got onto the shoulder by flanking.
