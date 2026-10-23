# Heavy armor (DDB-164)

## Context

Every armor gain was capped at the vehicle's starting armor (`Vehicle.addArmor` clamped to `maxArmor`), and vehicles start a fight at full armor. Armor Plating did nothing until a vehicle had been hit, and Repair Kit's overflow into armor was capped the same way. DDB-164 asked whether those cards should move to Shield, as Close Ranks and Draw Fire did (escorts.md, decision 28).

## Options

- Move Armor Plating and Repair Kit's overflow to Shield. Works at full armor, but Shield clears every turn, which turns plating into a one-round block.
- Keep them on armor and drop the cap. Lasts the fight, but with nothing to pay for it, stacking Armor Plating has no downside.
- Drop the cap and charge for the extra plating with speed. Kevin's call.

## Decision

Kevin, 2026-10-23: armor isn't capped. Armor past `maxArmor` is plating welded on for the fight, and `maxArmor` is now the vehicle's base armor, not a cap. The field keeps its name, since saves carry it.

- `Vehicle.isHeavy` is armor past base. `Vehicle.speedChange` drops a positive speed change on a Heavy vehicle, and `speedSum`, the planning projection (`BoardProjection`'s status speed and flank bonus), and MCTS's boost scoring all go through it. Slows still land.
- Damage takes armor in one pool, so hits strip the plating before the base armor, and a vehicle stops being Heavy once it's back down to base.
- `Vehicle.leaveRoad` cuts armor back to base at the end of a fight. Escorts already refill to base there. CombatBridge's cap at the driver's stat stays as a second guard.
- The AI no longer treats armor at base as full: armor gains and Repair Kit's overflow always count at face value.

## Provisional calls

Calls 277 to 279 are Kevin's (approved 2026-10-23). Call 280 is pending: Heavy is a neutral chip in the status row, after Shield, its count the armor past base, using the `build` (wrench) glyph already in the icon atlas, and the plate's armor shield turns amber (`#d9b26a`) while Heavy. The status row already holds the speed statuses that Heavy cancels.

## Trade-offs

- A Heavy vehicle that plays Armor Plating and then Nitro in one turn gets no boost, but planning doesn't project armor gains, so a raider may plan that pair expecting the boost. Planning is checked again when the cards are played, so the cost is a wasted card, not a bad board.
- Stacking plating has no ceiling. Speed is the only limit, and a vehicle that never needed speed (the War Rig) pays nothing for it. That's for balance to answer, and Ram's armor/10 grows with the plating.
