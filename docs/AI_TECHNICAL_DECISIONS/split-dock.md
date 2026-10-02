# The split dock

DDB-136 under DDB-127, folding in DDB-167. Spec: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) section 4, with section 9's crash-out rule. Geometry from the mock's dock in [docs/design/battle-screen/index.html](../design/battle-screen/index.html) (`.dtab`, `fanHand`, `.endturn`).

## Context

PR 103 (DDB-82) built the frame: a `HandHalf` per driver with a `DriverTab` over a `HandFan`, and the End Turn column. DDB-88 fanned and lifted the cards, and DDB-137 made the face 128x180 natively. What was left was the tab's contents (mod icons, pile and bolt icons, pips past six), the fan at the cap of seven, a fan row 2 px past its box at six or more cards, a hand rebuilt on every deal (which dropped a pinned detail view), the End Turn column against the mock, and DDB-167: a driver who crashed out still showed their hand.

## Decisions

**The dock is its own component.** `CombatDock` is the `ChromeStack` the screen used to build inline: the two halves and End Turn column, with the mock's padding. The screen keeps `dock`, `handLayer` and `endTurnColumn` as fields, so DDB-139's drop and grey still act on `this.dock`. The gallery builds the same component, so the scenes are the screen's dock rather than a copy.

**The fan runs to the dock's foot.** Cards hang 38 below the dock's edge and are 180 tall, leaving 10; the edge cards of a full hand lean and drop up to 9 into that. The dock's bottom padding was 5, which cut the fan to 185 and put a six-card row (187) past it. The padding is now 0, so the fan is 190 and the row's reach-padded box fits up to the cap. The 5 px only ever existed to hold the fan's box off the edge, which nothing draws.

**The hand is reconciled by card.** `HandFan` diffs its row with `reconcileChildren`, keyed by element, and `PlayerHandLayer` keeps each card's element while the card stays in the hand. A deal moves the elements still there instead of unmounting and rebuilding them, so a pinned detail view, a lift, and focus survive a draw or a play elsewhere in the hand. Element ids are a build count plus the card type: on the first deal the count is the slot, as before, and later cards get fresh numbers, so ids stay unique without renaming an element that moved.

**The tab follows the mock.** Mark, name, a tag (PASSENGER, or CRASHED OUT, in the mock's dark red `.ptag`), the name and tag filling what's left so the name is what ellipsizes, then mods, adrenaline, and piles. Adrenaline is the mock's bolts (`flash_on`): one per point of maximum up to six, lit from the outer end; past six, one bolt and the count. Mods are 18 px squares with a 12 px icon, up to four, and past four three and "+N" (the mock's `slice(0, 3)`), each named in its tooltip and the "+N" naming the rest. The piles are an icon and a count each (`style` for draw, `exit_to_app` for discard, added to the icon atlas; the build is deterministic, so existing glyphs are unchanged). The tab's padding no longer reserves the 3 px stripe, so its row centres on the full 30 px as the mock's inset stripe does.

**Only the piles open the pile dialog.** The whole tab was a `unit` target, which made the mod icons unreachable for their tooltips. Now the pile group is the button, and it is the tab's full height so it stays a 24 px target at the stage's 0.8 floor (the lint's `target-size`). The discard pile is still where discards fly.

**Mods are vehicle data.** `Vehicle.mods` is a list of `{ name, kind }` (offense, defense, utility, Card System Design section 5), empty until the garage fits them; the tab shows the driven vehicle's, with the kind choosing the icon. None of the mods do anything in a fight yet.

**A crashed-out driver's half has no hand (DDB-167).** `Team.isAboard(driver)` says whether a driver holds a seat; a living driver who doesn't crashed out. `buildPlayerHandView` leaves their cards out (it takes named options now), the tab says CRASHED OUT with no adrenaline or mods, the fan gives way to a one-line note ("No free seat after the wreck: out of this fight"), and their adrenaline no longer counts toward the unspent warning.

**End Turn.** Checked against the mock: 148 wide, 26 below the dock's edge, the turn label above, the 64 px button, and the warning under it at 12 on 15. The warning wraps inside the column, since two pools past six can make "16 adrenaline unspent" wider than 148.

## Departures

- The mock shows "SPACE" under END TURN; the game has no Space binding for it (Space activates the focused control), so the hint isn't drawn.
- The turn label reads "Turn N · Raiders" while they act, not the mock's "raiders acting": at 13 px tracked 0.14 em that runs past the 148 px column (the lint's text-overflow).
- The pile icons are Material's nearest glyphs rather than the mock's own drawings.
- Mod icons are per kind, not per mod, until mods carry art of their own.
