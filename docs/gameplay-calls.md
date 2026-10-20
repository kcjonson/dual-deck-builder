# Provisional gameplay calls

Calls made during the build so work isn't blocked on a design question. They're temporary unblockers, not decisions: none is written into a spec, and a spec keeps its open question until Kevin approves or changes the call. This file is where they live and where they're approved.

Every entry is pending unless it says otherwise. To settle one, mark it approved or changed (with what it becomes); an approved call that answers a spec's open question goes into the spec then, and the entry says so. The reasoning for each call is in the decision record named in its section, under its provisional calls.

New calls take the next number, one a line in the form "the item that made it: the call, because why", and go in the decision record too. Numbers never change or get reused; a call that's replaced says what replaced it.

Kevin's own rules from 2026-10-08 aren't here, because they're his and final: run cargo, damage carried, limping, the Med Truck cap, and revival in a won fight.

## Campaign rules, from the Decide items (1 to 23)

1. DDB-307, win: every stronghold taken wins, with no final boss. Depends: the campaign's end (DDB-276).
2. DDB-308, loss: the last driver's death, or People reaching 0. Depends: the day-end step (DDB-276).
3. DDB-317, decks: 8 to 20 cards, with hand limits as each archetype's config sets them. Depends: locker rules (DDB-310), load out (DDB-320), the Crew screen (DDB-314).
4. DDB-318, names: archetype plus an ordinal for now.
5. DDB-326, night: no night mechanic, and runs are home by dusk. Depends: the run controller (DDB-322) and the return ambush (DDB-325).
6. DDB-327: one run per day.
7. DDB-334: a found vehicle only becomes an escort. Depends: "Find: vehicle" (DDB-279).
8. DDB-390: no mid-route branching.
9. DDB-391: four drivers, dealt from the seed.
10. DDB-392: no player-facing map params.
11. DDB-395: strongholds range 2 to 7; the validator already clamps 8 to 7.
12. DDB-402: the scenery and stops stages retry only themselves, and the save keeps a revealed stop's rolled contents. Depends: the validator and retries (DDB-296), the run controller (DDB-322).
13. DDB-405: rename `aridity` to `moisture`. No rename is scheduled until it's approved.
14. DDB-388: the escort proposals are confirmed as built. Decision 33 is withdrawn by Kevin's own revive rule.
15. DDB-429: a revived driver stays at 1 HP, and the Med Truck doesn't reach them; driven vehicles keep structure and armor damage, so a wreck limps back at 1 structure and 0 armor, while escorts refill armor; a missing driver who returns comes back with their vehicle at 1 structure.
16. DDB-286: on a run, the combat top bar shows the cargo; the fight log says a driver at 0 HP "is down"; REVIVE_HP and LIMP_STRUCTURE are 1.
17. DDB-430: Headshot deals 2 damage, per Combat Rules.
18. DDB-301: on the compound screen, Back to menu or Escape goes to the main menu. Game Flow 8.1 has Escape open a pause and settings menu that isn't built yet. Record: compound-screen.md.
19. DDB-286 and DDB-316: cards won on a run (rewards, finds, roadside purchases) count as loot, so they're cargo: they reach the locker on getting home and are lost with a failed run. Records: combat-bridge.md, run-decks.md.
20. DDB-316, debrief: each card won is offered to any driver at the compound, injured ones included, not only the two who went out. Record: cards-won.md.
21. DDB-316, debrief: a full deck refuses a card (deck_full) with no swap offered; the player makes room on the Crew screen.
22. DDB-316, debrief: a card nobody takes stays in the locker, and quitting partway leaves the rest there too.
23. DDB-316: a failed run logs the cargo it lost (resources and cards) in one line, and nothing when it carried nothing.

## Crew screen (24 to 29)

Record: crew-screen.md, which also lists smaller layout calls (no portrait in the deck header, no NEW tag, the selection not remembered between visits).

24. DDB-314: dead and missing drivers both sit under "Lost on runs". Their cards open the detail view but can't be selected, so a missing driver's deck can't be edited until they're found.
25. DDB-314: injured drivers are tagged, and their default decks can still be edited.
26. DDB-314: Scrap takes one copy per press, with no confirmation. Replaced by 29.
27. DDB-314: the locker filter's kinds are All, Attack, Defense, Utility, and Order. Power cards file under Attack, and synergy cards under their first tag.
28. DDB-314: a driver out on a run shows their seat and their run deck, read-only ("Out on a run").
29. DDB-314: Scrap takes two presses. The first arms the button, which reads "Confirm" in the same place; a second press on the same card scraps one copy. It disarms when focus or the pointer leaves, after 3 seconds, or on any other change.

## Scavenging party (30 to 36, and 52)

Record: scavenging-party.md.

30. DDB-303: the haul lands at dusk, before upkeep. Today's numbers don't change, because upkeep eats only food and water.
31. DDB-303: settlers go, not drivers. It needs People 1 or more and nothing else; injured, dead, or missing drivers don't stop it.
32. DDB-303: the haul is a flat 1 to 2 fuel and 5 to 15 scrap. It doesn't scale with People, the day, or unrest.
33. DDB-303: no risk: nobody is lost or hurt, and a party never comes home empty. To weigh with 31 and 32: with no cost or risk, scavenging is never worse than Rest, so Rest becomes a dead button. Approving them as they stand means Rest needs an edge of its own (an extra day of healing, lower unrest); otherwise scavenging needs a risk or a cost.
34. DDB-303: scavenging refuses while a run is out (reason run_out), since the run's arrival would end a second day. This changed from "doesn't check whether a run is out, the same as Rest".
35. The soft-lock, found by DDB-303's QA: a pool that can't seat a legal pair could never send a run. If the drivers at home include two of different archetypes, the pair rule stands; otherwise, when two or more are at home but all share one archetype, a same-archetype pair may go; with only one driver at home, a run goes with one driven vehicle plus any escorts. The loss rule (2) is unchanged. Records: mvp-supply-run.md, campaign-end.md.
36. DDB-303: if scrap is tuned to 0, the scavenging log line leaves scrap out.

## Campaign end (37 to 43)

Record: campaign-end.md.

37. DDB-305: missing drivers count as lost. The campaign ends when nobody is left at the compound (every driver dead or missing), not only at the last death.
38. DDB-305: People reaching 0 ends the campaign only when no run is out. With a run out, the night reports the compound abandoned, and the first night after the run gets home ends it.
39. DDB-305: the night that empties the compound doesn't turn the day; the campaign stops on the day it fell.
40. DDB-305: how it fell: starved at 0 food, rioted at 10 unrest, otherwise disbanded. Hunger is checked before unrest, and water doesn't count.
41. DDB-305: a found driver comes home injured on `unloadRun`, the day their run gets home (43), with their vehicle at structure 1 and the armor the crash left them. Corrected from "injured from the day they're found".
42. DDB-305: the fall writes one log line.
43. DDB-305: a missing driver found on a run travels with the party and comes home with it on `unloadRun`, like the run's other finds. If that run fails, they stay missing.

## Solo-driver fights (44 to 51)

Record: solo-driver-fights.md.

44. DDB-166: Coordinated Attack stays playable for a lone driver and deals its base damage; the partner bonus can't trigger.
45. DDB-166: a card whose only target is the partner is unplayable for a lone driver, and shows its reason. No such card exists yet.
46. DDB-166: a card that targets both drivers lands on the lone driver's own vehicle. No card uses it yet.
47. DDB-166: a lone driver whose vehicle is wrecked rides in the nearest escort with a free seat; with none, they crash out, the fight is lost, and they're missing. To weigh: riding, only orders can be played, and in a 150-fight sweep that won 6 times (the rest lost or tied at the sweep's 60-turn cap; campaign fights have no limit, so in play it's a long grind). Alternatives: a wrecked lone driver crashes out at once, or the riding driver can still play some attacks through the escort.
48. DDB-166: a lone driver at 0 HP loses the fight at once, and the failed run leaves them dead.
49. DDB-166: the battle dock shows the second half as an empty seat. The lone driver keeps seat 1's colour and mark.
50. DDB-166: on a one-seat run, the escorts' cards go into the lone driver's run deck.
51. DDB-166: a driver's vehicle that kept going as an escort counts as one of the drivers' vehicles, not one of the convoy's four, when it's put in a new team.

## Scavenge button (52)

52. DDB-303: the Scavenge button's line previews today's exact haul ("brings back 2 fuel and 12 scrap"), not a range, since the haul is seeded from the campaign seed and the day. Rest and Scavenge are both off while a run is out (34). Record: scavenging-party.md.

## Customize screen (53 to 57)

Record: customize-screen.md, which also lists smaller layout calls (the chips at 1024, the locker kicker wording, no cost curve).

53. DDB-321: each copy kind has its own stack (own, borrowed +N, left at home HOME), and each stack's controls ask the campaign. The own stack's "-" says "Borrowed go first" while borrowed copies are in. HOME's "-" is live and leaves another of the driver's own copies at home. A full stack's "+", and HOME's "-" once all the driver's own copies are home, are off with no caption. As amended by DDB-321's fix pass.
54. DDB-321: Borrow is off with "Yours at home" for a card the driver left some of their own copies of at home, and says it before "Deck full" when both apply.
55. DDB-321: Reset to default takes one press, with no confirmation.
56. DDB-321: there's no separate Back button. Changes save as they're made, and Done or Escape returns to whoever opened the screen.
57. DDB-321: the driver card shows CUSTOM once the run deck differs from the default.

## Defeat screen (58 to 61)

Record: campaign-end.md.

58. DDB-305: the defeat screen is text only until there's art for it.
59. DDB-305: the title is the fall ("The compound starved", "rioted", or "disbanded"), and the line under it pairs the cause with the ending.
60. DDB-305: in place of Game Flow 6.3's critical moment, an "At the end" row (People, food, water, unrest), the state the ending was read from. Whatever the campaign doesn't record is left out: the last fight's stats, the explored percentage, unlocks.
61. DDB-305: Back to menu is the only way on from the defeat screen.

## Customize screen, continued (62, 63)

62. DDB-321: on a run of one, escort cards have no Give control, and the locker reads "Spare copies, free to borrow".
63. DDB-321: when a borrowed or HOME stack empties, focus goes to that card's own stack, or else to the card that slides into its place.

## MVP supply run (64 to 73)

Record: mvp-supply-run.md.

64. DDB-454: a failed run ends the day too, unless it ends the campaign.
65. DDB-454: a fight in progress isn't saved. Quitting mid-fight resumes at the stop before it, and the fight replays from the same seed.
66. DDB-454: the reward offers 3 cards, pick one or skip: rarity at Card System Design's drop rates, no duplicates, no signature cards, order cards only while the convoy has an escort, and the same three after a reload.
67. DDB-454: the quick load out (a stub) seats the first legal pair in pool order on their default decks, and takes every escort, their cards in Driver 1's deck. Replaced by 177.
68. DDB-454: arrival is summed up in one line. Cards won stay in the locker, with no per-card debrief offer.
69. DDB-454: a load out that never set off is given up on Continue, its run decks unwound.
70. DDB-454: a "Quiet stretch" is a stop where nothing happens, standing in for the other stop kinds.
71. DDB-454: every day offers a tier 1 destination. Replaced by 89.
72. DDB-454: encounters: 1 skull is one Rust Buggy, 2 is two, 3 is a Rust Buggy and a Spike Buggy. Replaced by 94.
73. DDB-454: Plan a supply run is off when no two drivers at home can go together, as well as on a run out or too little fuel. Replaced by 86.

## Stops and route descriptors (74 to 82)

Record: stops-and-routes.md, with the tuning numbers.

74. DDB-293: a checkpoint isn't a non-fight for the per-route rules, so three stops of fights and checkpoints break "a non-fight in any three". Read literally, the two rules are the same rule.
75. DDB-293: a fight's skulls are fixed with the map: 1 at tier 1, rising half a skull a tier times dangerCurve, rounded by a draw; a warband is one more; the cap is 3.
76. DDB-293: Find: driver keeps the driverFinds floor in tiers 1 and 2, and at least 4% of the stops in tiers 3 to 5. Stops turned into finds are events first and fights last.
77. DDB-293: guarantee 10 is kept inside the stops stage. A tier 1 to 3 POI with no route home by dark sheds stops from its quickest route: on its own legs first, then the costliest stops, then the furthest out.
78. DDB-295: the daylight estimate's stop hours: a fight 1, a warband 1.5, an event, find, or checkpoint 0.5, a garage 1, a hazard 1 (its contents roll 0.5 to 2). The objective takes 1.5, a stronghold's 2, and runs leave at 06:00.
79. DDB-295: fuel is a unit per 150 units of road, out and back, with at least one.
80. DDB-295: a route is named from its own road past where it parts from the POI's other routes, by a biome where it covers half of that road, or else by its dominant class; two alike take the side they come in from. Until place names exist, a POI is its type and its bearing from the compound (101 replaced that part).
81. DDB-295: until the area map screen exists, a day offers a tier 1 destination and up to two from tiers 2 and 3, only ones home by dark, never a stronghold. Replaced by 89.
82. DDB-295: a route's risk is its worst known fight; in the run's model it's 1 with no fight (the objective's), and every stop that isn't a fight runs as a quiet stretch (70).

## MVP supply run, final pass (83 to 88)

Record: mvp-supply-run.md.

83. DDB-454: destinations come in tiers 1, 2, and 3, and the whole yield loads when the run reaches the destination. The yield itself is now the POI type's (stops-and-routes.md), scaled by what's left there (102 to 108).
84. DDB-454: abandoning a fight (the combat menu, behind a confirm that starts on "Keep fighting") means the crew flees and goes missing, and the run's cargo and escorts are lost. When they're the compound's last drivers, the warning says the campaign ends.
85. DDB-454: call 35 as built: the crew rule counts drivers whose status is ready. One ready driver goes solo; ready drivers who all share an archetype go as a same-archetype pair. To weigh with 47: solo runs were close to hopeless as tuned (raider tuning, 94 to 100, looked at it).
86. DDB-454: Plan a supply run is off when nobody is fit and when no routes are known.
87. DDB-454: arrival ("Home from X with Y") and failure (the dead and missing by name) each write a log line before the day ends.
88. DDB-454: a forfeit gets its own result line ("The crew abandoned the fight.").

## The area map as the route pick (89 to 93)

Record: area-map-route-pick.md.

89. DDB-43: any known POI can be picked from the area map; the day offers (71, 81) no longer gate it, and a departure accepts any route the map offers. With fog deferred, every POI is known.
90. DDB-43: strongholds show on the map, but Plan a run here is off for them ("Not yet") until assaults exist.
91. DDB-319: a route that runs past dark warns and can still go. There's no night penalty yet.
92. DDB-43: Plan a supply run opens the area map; on the run route screen, Load out the crew runs the quick load out stub (67, 85) and departs. Replaced by 177: it opens load out, which departs.
93. DDB-43: POI state isn't tracked: every POI shows as unvisited, and yields don't deplete. Replaced by 102 to 108.

## Raider tuning (94 to 100)

Record: raider-tuning.md. The player-card and archetype problems it found (EMP Blast stun-lock, the Mechanic deck dealing no damage, the Rig's reach, raiders aiming at Driver 1) are Kevin's: DDB-492 to 495.

94. DDB-462: encounters: one Rust Buggy at 1 skull, one Spike Buggy at 2, two Rust Buggies at 3. Gangs wait for 3 skulls because the Rig only reaches the raider across from it.
95. DDB-462: a lone raider opens across from the crew's vehicle with the most structure (Driver 1's on a tie).
96. DDB-462: against a lone driver, every raider refills to 3 adrenaline, one card a turn.
97. DDB-462: the Rust Buggy refills to 5 (was 10) with gunnery 9 (was 6), so it can hit the Interceptor's bike.
98. DDB-462: a raider starts a fight at its refill; the unused starting-adrenaline field is gone.
99. DDB-462: the Spike Buggy has its own raider profile (gunnery 9, 85 structure, armor 8, 85 HP, refill 7; Ramming Speed 3, Precision Shot 2, Armor Plating 1). The player's Raider driver is untouched.
100. DDB-462: the skirmish fields the 1-skull encounter.

## POI names (101)

Record: places.md.

101. DDB-472: a POI takes the name of the nearest town or village within a quarter of the map's radius plus its type's label in title case ("Elk Creek Clinic"), nearest POI-place pairs first, a second POI of a type taking the next place in its reach, then a number ("Elk Creek Clinic 2"); with no town or village in reach it keeps "Clinic, north-east"; strongholds stay their faction's. Because a quarter of the radius is the towns' own spacing, nearest-first keeps the plain name for the POI that's actually in town, and the stand-in is the smallest fallback that already reads. To weigh: on crowded maps several POIs of one type near one place end up numbered (seed 1: 7 of 34); reaching to a farther town before numbering would cut that.

## POI depletion (102 to 108)

Record: poi-depletion.md, since replaced by stop-clearing.md.

102. DDB-483: a POI holds 3 runs' worth, so the third depletes it, because the spec says two or three and the yield already falls by thirds, so the third run is a small one. Replaced by Kevin's rule of 2026-10-17, a run clears its POI and a cleared POI is disabled (186 to 188).
103. DDB-483: a run's yield is the POI type's scaled by shares left, each resource rounded up (full, two thirds, a third, nothing), because a POI with anything left should give some of everything it yields. Replaced by Kevin's rule of 2026-10-17, a run clears its POI and a cleared POI is disabled (186 to 188).
104. DDB-483: a share comes back every third of 20 nights from the last run, full 20 nights after depletion; looted POIs refill too, and each run restarts the refill, because 20 is the spec's starting value and partial refills keep a twice-hit POI from staying low. Replaced by Kevin's rule of 2026-10-17, a run clears its POI and a cleared POI is disabled (186 to 188).
105. DDB-483: the share goes when the run reaches the POI, in the step that loads its yield, so a run that fails afterwards has still emptied it, because the yield and the share can't come apart in a save. Nothing fails a run after the POI yet. Replaced by Kevin's rule of 2026-10-17, a run clears its POI and a cleared POI is disabled (186 to 188).
106. DDB-483: a depleted POI stays plannable and yields nothing, its row dimmed and its state and next share shown, because its routes' fights still pay cards and no new blocker is the smallest change. Replaced by Kevin's rule of 2026-10-17, a run clears its POI and a cleared POI is disabled (186 to 188).
107. DDB-483: a POI that fills up again shows as unvisited, because the view has three states and full is what unvisited means to the player. Replaced by Kevin's rule of 2026-10-17, a run clears its POI and a cleared POI is disabled (186 to 188).
108. DDB-483: version 8 saves load with every POI full and keep their history, because version 8 never wrote POI state and full is exactly what it meant. Replaced by Kevin's rule of 2026-10-17, a run clears its POI and a cleared POI is disabled (186 to 188).

## Day clock (109 to 115)

Record: day-clock.md.

109. DDB-302: upkeep is 1 food and 1 water per 4 people, rounded up (from the spec), with People counted at dusk, before that night's losses.
110. DDB-302: each unit short costs 1 person and 1 unrest, food and water shortfalls summed. Counting only the larger one is a one-line change.
111. DDB-302: unrest only rises, since nothing in the spec lowers it yet.
112. DDB-302: a driver whose injury reaches 0 days is ready at full HP.
113. DDB-302: one log line per short day.
114. DDB-302: getting home ends the day (6).
115. DDB-302: 0 People reports the campaign as abandoned (2); ending it is the campaign end's job (37 to 42).

## Locker rules and the main menu (116 to 119)

Records: locker-and-deck-rules.md, main-menu-campaigns.md.

116. DDB-310: scrapping a locker card pays 5 scrap a copy, at every rarity.
117. DDB-310: when a move breaks more than one rule, "card for another archetype" is the reason shown, ahead of "deck full".
118. DDB-310: cards can move straight from one driver's default deck to another's, with the rules checked at both ends.
119. DDB-283: until load out replaces driver selection, the main menu keeps a Skirmish entry to driver selection and a quick fight, so playtesters can still play fights. Retired by 181.

## Damage and the fight log (120)

Record: combat-bridge.md.

120. DDB-286: raiders brought to 0 HP are still logged as "is dead", since their death is final; "is down" is only for the player's drivers (16). Gap, not a call: nothing repairs a driven vehicle until the garage (DDB-44) exists, so a wreck that limped home stays at 1 structure and 0 armor.

## POIs and strongholds, stage 5 (121 to 127)

Made for the first POI stage, whose record pois-and-strongholds.md was replaced by realistic-map.md and route-tree-and-pois.md; check each against those before approving.

121. DDB-291: a home area stands in for tier 1: road within the metro radius plus 0.25R, along the roads, until tiers make it tier 1.
122. DDB-291: strongholds reach 0.25R (at least 5 clearances); POIs reach 0.12R (at least 3).
123. DDB-291: each stronghold seats the not-yet-seated faction whose biome and ruin weights best fit its site.
124. DDB-291: POI types by place: hospitals and malls in ruins; water plants on low or wet ground; fuel depots within 60 units of a highway; farms and silos in scrub; salvage yards elsewhere.
125. DDB-291: yields are per successful run, in whole units.
126. DDB-291: ring targets don't scale with radius.
127. DDB-291: a dead end carries on as an approach only within its turn limit.

## Infirmary (128 to 134)

Record: injuries.md.

128. DDB-304: injury days are the HP missing divided by 10, rounded up: a Road Warrior at 1 HP is out 4 days, an Interceptor 3.
129. DDB-304: any missing HP injures, but the night home counts as the first day, so a 1-day injury heals by dawn.
130. DDB-304: a driver revived at 1 HP comes home injured like anyone else.
131. DDB-304: HP stays where it was until the driver is fit, then fills.
132. DDB-304: one med takes one day off and can be spent at any time, so a driver can be made fit and seated the same day.
133. DDB-304: asking for more days than are left is refused, not clamped.
134. DDB-304: coming home writes nothing to the campaign log.

## Run decks (135 to 139)

Record: run-decks.md.

135. DDB-315: cards a driver leaves home stay reserved for that driver; they don't go to the locker for the other driver to borrow.
136. DDB-315: moving into a run deck, the driver's own left-home copies come back before anything is borrowed; moving out, borrowed copies go back before the driver's own.
137. DDB-315: only escort cards move between the two run decks.
138. DDB-315: a missing driver's run deck unwinds as if they came home; only a death loses one.
139. DDB-315: "Reset to default" leaves escort cards where they are.

## Compound screen (140 to 147)

Record: compound-screen.md.

140. DDB-301: Rest a day is a button above Plan a supply run, not a building or the gate, and it doesn't ask to confirm.
141. DDB-301: focus starts on Back to menu, so a stray Enter can't spend a day.
142. DDB-301: food and water forecasts always show, and only tonight's shortfall is marked urgent.
143. DDB-301: resource chips show amounts only; the days to run out are in the needs panel.
144. DDB-301: the screen's title is "The Compound".
145. DDB-301: the wireframe's driver pool list, escorts and losses lines, and gate tile are left out for now.
146. DDB-301: each Rest reports the night under the button.
147. DDB-301: the fallen-compound notice leaves the save at 0 People until the campaign end ends it. Since built (37 to 42).

## Area map and run route details (148 to 152)

Record: area-map-route-pick.md.

148. DDB-43: a route the stores can't fuel stays pickable on the run route screen, dimmed with its reason, so its stops can be read; Load out is what's off.
149. DDB-43: too little fuel for a POI's routes doesn't turn off its Plan a run here; the run route screen says which routes can go.
150. DDB-43: the destinations list (nearest first: tier, then the quickest hours out, strongholds last) is the keyboard's way to the POIs; the map is last in the focus order.
151. DDB-319: the run route frame spans at least 800 world units, so a near POI's baked land isn't drawn blurry.
152. DDB-43: on the planning screens a town or village name steps to the left of its dot, or is left out, rather than cover a POI marker.

## Generation and visual calls (153 to 176)

Tuning for how the map is made and drawn rather than how the game plays. Two records keep theirs as lists without numbers here: realistic-map.md (22 calls: the route split, the quickest-time route tree, POIs only where routes meet, class speeds, the land grid, worker budgets, what saves keep, and the rest) and road-network.md (15 calls: highways through towns, back road links and detours, trails through rough country, spurs and passes, broken spans, the loops check).

153. DDB-487: no road crosses a river less than 30 degrees off the river's line, in the metro or out, because roads were crossing creeks nearly along them (83 such crossings on 23 of 30 sampled maps), and it costs only a few detours (bridges 69 to 65 a map at radius 1000, loops unchanged). Record: road-network.md.
154. DDB-489: a broken highway span is never the last highway stretch ending on a highway exit (the span further in breaks instead, if it can), because otherwise the exit showed no highway where the map says one leaves (4 of 30 sampled maps); broken spans still come to about 2 a map. Record: road-network.md.

Record for 155 to 164: dressing.md.

155. DDB-297: the dressing is a pipeline stage marked inert (retries only itself, nothing gameplay follows it, a replay without its attempt runs attempt 0), because that's the only way to add the stage without bumping the generator version and outdating every save.
156. DDB-297: metro street grids are 2 districts plus one per 50 units of metro radius, at most 7, angles spread evenly over a quarter turn, because even spreading guarantees neighbours read as different grids.
157. DDB-297: street spacing 14 to 8 units and block survival 0.3 to 0.9 by streetGrids, falling toward each ruin's edge, because the spec ties both to streetGrids and the atlas renders show dense cores with ragged edges.
158. DDB-297: rail lines run rim to rim (ends 140 to 220 degrees apart, each at the lowest ground within 25 degrees), costed so they follow valleys and cross rivers instead of running down them.
159. DDB-297: dressing (the amount) thins grids and rails below its default 0.6 and keeps them to streetGrids/railLines above it, while hatching, stipple, and labels scale on up; at 0 only the labels of what play uses remain.
160. DDB-297: label priorities are metro 100, strongholds 95, POIs 90, towns 80, shields 70, ranges 65, lakes and reservoirs 60, rivers 55, villages 50, passes 40, because what play needs should never lose its label to scenery.
161. DDB-297: rivers named from 4x the stream threshold and labelled from 8x, "River" from 25x and "Creek" below; ranges named from 30 cells and labelled from 60, "Mountains" from a peak elevation of 0.55 and "Hills" below.
162. DDB-297: route numbers 2 to 99, none twice, one per highway, with shields 0.35 of the radius apart outside the metro, because the prototype renders show two-digit numbers and two or three shields a highway.
163. DDB-297: crater hatching runs to where a plume falls to 0.15 contamination, 8 units between lines; mire stipple is a dot per 12-unit cell.
164. DDB-297: feature names (rivers, lakes, ranges, passes) come from 40 placeholder roots, and the metro is named from the places' namer, because there were no names for them yet; a writer can replace the word lists.

Record for 165 to 175: area-map-atlas-style.md (its Visual calls).

165. DDB-498: land palette dry (235,229,207), middling (229,228,209), wet (214,221,199), high ground (212,204,188), because the target render's land histogram centres there.
166. DDB-498: hill shade tanh(slope x 140), 0.16 on flat land to 0.4 in the ranges, the lit side at 0.4 of the shadow side, because that gives the target's shadows without clipping highlights.
167. DDB-498: cliffs as a 32% grey-brown scarp shade instead of a solid band, because the hill shade already draws the slope and a band read as paint.
168. DDB-498: contamination hatched lightly (lines 12 units apart, at most 28% rust), because a third to a half of most maps is contaminated and stronger hatching swamps the page.
169. DDB-498: built-up patches pale brick (229,212,204) with an 11-unit street grid on the metro and towns, villages plain, edges 18% ragged.
170. DDB-498: highways (216,96,54) 2.4 px in a (104,44,30) 4.2 px casing, back roads grey 1.1 px on a 2.7 px pale edge, trails dashed 4 on 3, because those read like the target at both zooms.
171. DDB-498: bridges as flared parapets, collapsed spans as a 9 px gap under a red cross, passes as a dark chevron, dams as a dark bar across the river.
172. DDB-498: bridges and passes drawn only from 0.3 px a world unit in, because fitted whole they crowd out the roads.
173. DDB-498: POI glyphs are letters (hospital H, clinic C, school S, store G, mall M, water plant W, fuel depot F, truck stop T, quarry Q, mine X, farm B, silo O, salvage yard J), because the target uses letters and the icon atlas can't gain glyphs without msdf-atlas-gen.
174. DDB-498: names in the condensed bold face (towns 14 px; POIs, strongholds, and Home 13 px), villages in the body face at 10.5 px, the metro at 17 px spaced capitals, all on a 2.2 px paper halo.
175. DDB-498: tier numbers leave the map (POIs show their type's glyph) and stay in the destinations list and the run route panel, because the target has no tier badges.

Record for 176: stops-and-routes.md.

176. DDB-499: a highway route's name takes the route number on its highway's shields ("Route 47 highway"), the main highway of the route's own leg with the most highway, instead of that highway's index plus one, because the run route card and the shields (drawn once DDB-447 lands) should say the same number; two routes on one highway share it and are told apart by side, then letter, as before.

## Load out (177 to 181)

Record: load-out-screen.md.

177. DDB-320: load out opens on the crew the quick load out would send (67) and every escort up to four, and the player changes seats, decks, and escorts from there, because the default should be a run that can go.
178. DDB-320: a seat change or Swap seats after the run decks are out deals them fresh from the default decks, losing any customizing, because the campaign has no move for a customized run deck between seats and escort cards are dealt to Driver 1.
179. DDB-320: Back from load out gives up its run decks, customizing and all, and returns to the run route screen, because a started run must never be stranded.
180. DDB-320: a solo run (35) shows the second seat empty with "Solo run: nobody else is fit to go", and the synergy line says there's no partner, because the pair hints have nothing to compare.
181. DDB-320: the main menu's Skirmish entry and its quick fight go with driver selection, because 119 kept them only until load out replaced it.

## Compound buildings (182)

Record: campaign-state-model.md.

182. DDB-508: a new campaign is founded with only the bunkhouse standing, and nothing builds a building yet, so the radio mast, infirmary, map room, garage, and stores show as staked-out plots on the compound plate; `Campaign.buildings` holds what stands (save format 10), founding takes it from `campaign-start.json`, and version 9 saves load with the bunkhouse standing, because the plate draws what stands and the bunkhouse's Crew screen was the only building screen in play.

## Runs and encounters (183 to 189)

Made writing [Runs and Encounters](./specs/Runs%20and%20Encounters.md), beyond what Kevin approved in its plan and review on 2026-10-17. The spec keeps 183 to 185 as its open questions 4 to 6; 186 is approved; 187 to 189 fill in how his clearing and spacing rule gets built. Records: find-stops.md (183), stop-clearing.md (186 to 188); 184, 185, and 189 have none yet.

183. DDB-523: the least a calm stop offers is take it, spending the stop's hours, or drive on and keep them, because it's the cheapest way to make a find a choice rather than an empty step, and it costs no new screen.
184. DDB-525: a fight going nowhere, for a break-off, is three player turns running with no damage to any raider (armor, structure, or HP), because "neither side takes damage", as the plan had it, misses the case break-off exists for: a raider the crew can't reach that's still hitting the crew.
185. DDB-328: every raider class carries a card that can hit each starting archetype's vehicle, because a class the bike's evade beats leaves an Interceptor pair untouched, as the Rust Buggy's old gunnery of 6 did.
186. DDB-336: a cleared POI stays disabled for the rest of the campaign, because "disabled" with nothing said about reopening reads as for good, and the cooldown that brings stops back is for roads, not POIs. Approved by Kevin, 2026-10-17 ("no story reason for it to magically get stuff back"); now in Runs and Encounters (Kevin's rule 5, Clearing) and Compound and Supply Runs (POIs).
187. DDB-336: the run that clears a POI takes its type's whole yield, what a full POI gives today, because there's no second run to take the rest.
188. DDB-336: a POI is cleared when the run reaches it, in the step that loads its yield (as call 105 had the share), so a run that fails on the way home has still cleared it, because the yield and the clearing can't come apart in a save. Replaced in part by 260: a failed run no longer clears its POI.
189. DDB-529: each route keeps its floor fights and at least half its stop band on its own road, legs no other POI's routes use, and the POI stage seats a POI only where that fits, because it's the least that keeps a neighbor's cleared road from leaving a run fight-free or nearly empty.

## Finds (210 to 214, 220)

Record: find-stops.md.

210. DDB-523: taking a find costs nothing yet, because call 183 makes the stop's hours its price and the run doesn't keep its clock on the road yet; until it does a find is a gift, and Runs and Encounters' open question 4 stays open.
211. DDB-523: a Find: driver turns up the pool's first missing driver who can be found, and only with nobody missing someone new, of the unlocked archetype the compound has fewest living drivers of, because the missing are the compound's own and the spec's "a new archetype" reads as filling the pool out.
212. DDB-523: someone new found on the road rides home with the run and joins the pool there, lost with the run if it fails, because a found missing driver already does, and the convoy is what brings them in.
213. DDB-523: a Find: cards is the fight reward's picker and pool, three cards at the drop rates, the one picked riding home as cargo, because the spec names that picker and a find's cards shouldn't be safer than a fight's.
214. DDB-523: a Find: supplies haul is the stop's rolled contents, one resource in the stop tuning's range, meds included, because the cargo and the stores carry meds though POI yields don't.
220. DDB-523: a calm stop type the run can't resolve yet (wreck, distress, garage, hazard, Find: settlers, Find: vehicle) still runs as a quiet stretch, rather than the stops stage giving it weight 0 as Runs and Encounters asks, because zeroing it is a stops-stage change that reshapes every map's stops, and finds are what this batch could resolve; the stops stage drops the quiet stretch once it zeroes those weights.

## Clearing (215 to 219, 221, 222)

Record: stop-clearing.md. Calls 186 to 188 are the clearing rule itself.

215. DDB-336: a run clears a stop when it moves past it, a find left by the road and a won fight included, on the day of the run, and a fight it loses isn't cleared, because the spec's "every stop it resolves" covers a choice declined, and a lost fight's raiders are still there.
216. DDB-336: a cleared stop is back at the dawn five days after the day it was cleared (cleared on day 3, back on day 8), its roll up one, and only a Find: supplies haul rerolls yet, since a fight's raiders and a find's cards and driver come from the run's own stream, because the cooldown is the spec's 5 days counted the way the day clock counts nights.
217. DDB-336: a route with stops cleared keeps the map's fuel and hours, which then overestimate a little, and takes its risk from the fights it still meets, because the run keeps no clock on the road yet and the daylight estimate should err safe.
218. DDB-336: a cleared POI draws with the map's depleted marker and a dimmed row, its details say cleared, and its Plan is off with the reason, because the struck-through marker already means nothing left and the view has no fourth state to draw.
222. DDB-336: the debrief stamps the POI the run cleared LOOTED, after an injured driver's tear, and DEPLETED is no longer struck, because every run that gets there clears its POI now, so the stamp says what happened rather than marking a rare state.
219. DDB-336: version 11 saves load with every POI that still had stock taken cleared, a POI that had refilled reading as never reached (as call 107 had it), and no stop cleared, because a POI with stock taken is one a run reached, a refilled one left no trace to tell it from an unvisited one, and nothing kept stop state.
221. DDB-336: the save keeps a stop's roll and the day it was cleared, not its rolled contents, where Area Map Generation lists the contents too, because `rollStop` gives the same contents for the same stop and roll, and a run on the road carries what it rolled in its saved route.

## Fight guarantee (260)

Record: stop-clearing.md.

260. DDB-519: a failed run clears nothing, neither the stops it got past nor its POI, so a retry within the 5-day cooldown meets the same fight stops, replacing the part of 188 that has a run failing on the way home clear its POI, because the raiders still hold the road, and a failed run loses its cargo, so the POI's yield is still there.

## Player stand-ins (240 to 244)

Record: intent-aware-stand-in.md. Numbered from 240, the range set aside for this work.

240. DDB-528: the intent-aware stand-in reads an elite's hidden attacks from its plan, the card and its damage worked out on the board as it stands, which is more than a player sees (the card is hidden too), because the ceiling should not be capped by a tier rule, and today's encounters are all basic anyway.
241. DDB-528: the harm it weighs is structure plus occupant hitpoints lost next enemy turn, split as a hit splits, with a wreck or a dead driver counting 20 more, because either costs a run far more than its points.
242. DDB-528: non-lethal damage counts for half a turn of the hurt raider's harm, times the share of its toughness it removes, because weighted higher it outbid Flanking Maneuver, and one step can't see that the flank boosts the rest of the turn's hits.
243. DDB-528: what the harm count doesn't cover (flanking, draws, adrenaline, cards with no effect) is scored as the aggressive AI scores it, so the ceiling keeps the floor's priorities whenever no intent is at stake.
244. DDB-528: a flanker the play outpaces is taken to lose its flank bonus whole (its hits divided by 1.5, rounded up) and to stay in range, because re-deriving range from the reserved slot needs Battle's enemy-turn preview, which projects only from the board as it stands.

## Event stops (250 to 259)

Record: event-screen.md.

250. DDB-45: a choice at an event is taken when it's pressed (a click, Enter, or its number key), with no confirm step, because its card already shows the risks and nothing on the screen can be undone anyway.
251. DDB-45: an event's costs are paid from the stores and the run's cargo together, the cargo first, and a choice is locked when the two hold less, because cargo alone is empty at a run's first stop and would lock nearly every cost there.
252. DDB-45: an outcome's structure and HP apply to every seated driver's vehicle and every seated driver alike, because an event has no picker for whose, and a run has at most two of each.
253. DDB-45: an event's outcome lands on a draw from the run's stream for that stop, so a reload lands the same outcome, because otherwise reloading would be a free reroll.
254. DDB-45: every event has a choice that needs nothing and costs nothing (usually Drive on), and the content reader refuses one without, because a party that meets nothing must never be stuck at a stop.
255. DDB-45: a fight hand-off's outcome gains apply before the fight and the gains written on its fight only on a win, and losing it is settled as any stop fight's loss is, because an event shouldn't carry loss rules of its own.
256. DDB-45: settlers an event gives ride home in the cargo as people, and drivers it gives are new recruits who join the pool when the run gets home, because both reach the compound only on a run that gets home.
257. DDB-45: a card requirement is met by a copy in either seated driver's run deck, an escort's signature card included, and never by the locker, because the choice is what the crew on the road can do with what they brought.
258. DDB-45: an event stop picks its event evenly among its stop type's events, with no weights or repeat rule yet, because five events can't carry a weighting worth tuning.
259. DDB-45: an event's HP and structure losses stop at 1 and its resource losses stop at 0, taken from the cargo first and then the stores, because an event that kills a driver or wrecks a vehicle outright would be a fight with no chance to fight back.

## Combat run pacing (190 to 209)

Made building the combat side of [Runs and Encounters](./specs/Runs%20and%20Encounters.md) (epic DDB-519). Record: raider-waves-and-fight-ends.md.

190. DDB-522: "across from" a driven vehicle, for close-up, is the enemy inside slot in its row, whatever lane it's in, and when one raider is nearest to two such slots Driver 1's row is filled first, because the row is what range reads and seat order is how every other tie on the player's side goes.
191. DDB-522: Steady shows as a green check chip, because the icon atlas has no better glyph and adding one means rebuilding the font; the chip's title and detail say what it is.
192. DDB-46: a driven vehicle flanking on the raiders' shoulder isn't across from any slot, for close-up, because it's beside the raiders' outside lane, and pulling the raider there into the inside lane would move it away from the flanker instead of toward it.
193. DDB-46: a wave's turn count runs from the first player turn the last wave played (the fight's turn 1 for the first), so a wave with a turn count of 2 is due at the start of turn 3, because "has passed" means two whole turns of the last wave on the road.
194. DDB-46: the top bar's "+N arriving" counts the whole due wave even when the formation can only take some of it, and the row marks show only the rows those with room will take, because the announcement promises the raiders and the marks promise the road. Replaced by 207.
195. DDB-46: the top bar drops the "+N incoming" count of every raider still queued and shows only "+N arriving" while a wave is due, because section 9 reserves the one readout, and a count of raiders that may never come (a rout, DDB-525) tells the player nothing to act on.
196. DDB-525: the Rust Buggy's nominal threat is 2 and the Spike Buggy's 6, until the balance sim's calibrate fits them (DDB-526), because that's about each one's toughness (60 HP and structure against 170) times what it plays in a turn (5 adrenaline against 7).
197. DDB-525: for a break-off, only damage during the player's turn counts, and a hit a shield takes all of doesn't, because call 184 names armor, structure, and HP, and the break-off is checked at the end of the player's turn.
198. DDB-525: after a break-off, a driver who went down is revived and one who crashed out is picked up, as after a win, because the run goes on and the partner is still standing (Kevin's rule from 2026-10-08 for a won fight).
199. DDB-328: the mook is the Scav Bike (5 HP, 12 structure, no armor, 1 adrenaline, gunnery 9, Point Blank 3 and Far Shoot 2) and the leader the Warlord (elite, 70 structure, armor 6, 50 HP, 6 adrenaline), because those are about the least that meet the class rules: one starter attack takes the mook out, it plays one card a turn, and both can hit every starting vehicle (call 185).
200. DDB-328: every raider carries one Precision Shot at most (Rust Buggy: Ramming Speed 2, Precision Shot 1, Point Blank 2; Spike Buggy: Ramming Speed 3, Precision Shot 1, Armor Plating 2; Warlord: Ramming Speed 2, Precision Shot 1, Point Blank 2, Armor Plating 1), and the Spike Buggy drops to 55 structure, armor 6, 50 HP, and 5 adrenaline, because in a group two Precision Shots a raider take the Interceptor's 25 HP in a turn, and the heavy at its lone-fight numbers left its templates near 20% won.
201. DDB-328: nominal threat is Scav Bike 1, Rust Buggy 2, Spike Buggy 4 (replacing call 196's 6), and Warlord 6, until calibrate (DDB-526), because that's toughness times damage after call 200.
202. DDB-328: tiers 1 to 4 field the same nine scavenger templates, and a stronghold's tier 5 borrows them, because skulls already rise with tier, a template's tiers only pick its roster, and there's one roster until the factions (DDB-142).
203. DDB-328: a later wave is due at 1 or 2 raiders left on the road, or after 2 or 3 turns, as each template sets, with the skull count's road cap holding back whatever doesn't fit, because that keeps How big's "on the road at once" and gives a crew a turn or two to finish one wave before the next.
204. DDB-328: cutting a fight to a lone driver's size never empties the first wave, because the fight has to open with a raider on the road.
205. DDB-525: a stop's fight draws its template at the run's destination tier, not a tier of its own, because a route's stops don't carry one and skulls already rise with tier.
206. DDB-525: a warband's leader is its vehicle, so the leader is out, and the rest rout, when that vehicle is wrecked or loses its driver, even if the driver jumps to another raider, because the leader is the War Rig the warband rides behind, and a driver riding as a passenger can't lead it.
207. DDB-328: the top bar's "+N arriving" and the log's "N raiders arriving" count only the raiders that will pull in at the end of this enemy turn, under the road cap and into free slots, replacing 194, because with road caps a whole wave rarely lands at once, and the readout should promise what the player will see.

## Same-archetype fights (261)

Record: mvp-supply-run.md.

261. DDB-539: combat seats whatever pair the crew rule sends, so two drivers of one archetype fight together when call 35 lets them go, and combat's own check is only that one driver can't fill both seats, because the archetype rule is load out's (call 35), two Mechanics are two people with their own decks, and a fight refusing a pair load out allowed left the run stuck at its fight.
