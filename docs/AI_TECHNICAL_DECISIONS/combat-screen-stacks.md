# The combat screen on stacks

Status: implemented (DDB-82, DDB-55 phase 4), 2026-09-28. Also closes DDB-183.
Spec: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) sections 2 and 4, chapter 10 of the [UI rendering spec](../ui-rendering-spec/10-layout.md), R4.7
Builds on: [stack-layout.md](./stack-layout.md), [game-code-on-the-tree.md](./game-code-on-the-tree.md)

## Problem

DDB-124 gave combat one layout function, but it was the old one: percentage bands (resource bar 7%, raiders 23%, player 40%, hand 18%) with the bottom 12% empty, every size in viewport pixels, and a hand laid out at its natural width and centred, so at 1024 px the first driver's first card started at x = -368 (DDB-183). At 800x450 the resource bar was 31 px tall and the adrenaline and pile counts hung below it into the raiders' lane. The Battle Screen Design replaced those bands on 2026-09-25 with a 36 px top bar, the road, and a 228 px dock on a 1280x720 logical reference scaled by one number.

## Decision

**One stage, scaled.** `computeCombatStage` in `CombatLayout.ts` is section 2's formula: `s = min(W/1280, H/720)`, held at 0.8 or above, over a logical canvas of `W/s` by `H/s`. The screen's root is still sized from the mount context's viewport by `Screen`; its one child, `combat_stage`, is a fixed-size stack at the logical canvas with `transform: { scale: s, origin: [0, 0] }`. `applyLayout` sets those two things on mount and on every resize, and is the whole of the screen's own layout code; everything inside the stage is placed by stacks in the frame's layout phase. The render walk, the dispatcher's hit test, `screenBounds` and the tree snapshot all go through the transform already (R8.26), so a click or a lint rectangle is in viewport pixels while every number in the screen's code is logical.

**The bands are a column.** `combat_bands` is a vertical stack, `fill` on both axes with `maxSize.width` 1600, inside the horizontal stage stack with `distribution: 'center'`, which is the cap-and-centre rule. Its children are the top bar (36 fixed), the road (`fill`), and the dock (228 fixed), all stretched across.

**The road holds today's layers until the grid.** The raiders' and the player's battlefield layers share the road as `fill` children weighted 23 and 40, the proportions of the old bands, until the slot grid (DDB-134 under DDB-127) replaces both. The turn banner and the log drawer are `positioned: 'absolute'` children of the road: the banner anchored on the line between the two bands at the left edge, where no lane centres a vehicle; the drawer anchored `topRight`, 320 wide, `fill` on its height, so it covers the right of the road and never the dock or END TURN (section 6). Both carry `zIndex: 1`, since they paint over the road on purpose.

**The top bar** is a row: the turn, a ticker of the last log entry (`fill`, one line, ellipsis), scrap and fuel with their icons, and a LOG button. The menu and the wave counter join it when the game has them. Fuel was shown per driver with a TODO; it is shared, as section 2 has it.

**The dock** is a row: the hand (`fill`) and the 148 px End Turn column (section 4), padded 8 on top and 16 at the sides as the mock is. The hand is two halves, one per driver, each a tab over a fan. The tab (`DriverTab`, replacing `DriverStatsDisplay`) is the driver's mark (square or diamond in their colour), name, a PASSENGER tag, adrenaline pips with the count, and draw and discard counts; a fill spacer pushes the counts right, and the name ellipsises first. The End Turn column has the turn and whose move it is above the button and "N adrenaline unspent" under it.

**The fan fits its half (DDB-183).** Cards are 128x180 in the design and 150x210 in `Card`'s own layout, so each fan's row is a horizontal stack scaled by 128/150 about its top centre and anchored to the fan's top centre. Its gap is 10 when the cards fit and otherwise the negative gap that spreads them across the half, floored to a whole card-space pixel, recomputed when the fan is resized or dealt. Every card starts inside its half at every size down to 800x450 with seven cards a driver; at the hand cap on 1280x720 about 67 logical px of each card shows, against the design's 68. A negative gap is also what R13.25.1 exempts, so the overlap is not a lint violation. A lifted card (hovered or selected) takes `zIndex: 1` so it paints and hit-tests above its neighbours.

**Tab order follows the dock.** The hand is one Tab stop, then END TURN; the LOG button has `tabIndex: -1`, since F6 is the keyboard's way to the log. END TURN used to be first because the resource bar was at the top of the tree.

**R4.7's warning is for rotation and skew.** `pushClip` warned under any transform that was not a translation, which the scaled stage made fire every frame, and the visual harness fails a capture with a console error. Under a scale without rotation a rect stays on the axes and its transformed bounds are exact, so there is nothing approximate to warn about. `isAxisAligned` in `geometry.ts` gates the warning; `DrawApi.test.ts` covers the quiet, exact case.

## Departures and gaps, recorded

- R4.7 says a development build must warn "when a clip is pushed under a non-translate transform and only the approximation is implemented". The approximation is exact under an axis-aligned scale, so the warning is narrowed to rotation and skew, which is the rule's intent.
- Section 2 says the logical canvas is never smaller than 1280x720, which holds only while `s` is not floored. Below 1024x576 the canvas is smaller (800x450 gives 1000x562.5) and the road is under its 456 minimum; the design leaves phone landscape to a compact layout it does not cover. Nothing overlaps or leaves the screen there, but the raider's plate crowds its lane label.
- Road art does not run to the screen edges on 21:9 yet; the screen ground does, and the road is the stage's width.
- `Card` is scaled rather than laid out at 128x180, so its type sizes are the old card's times 0.853 and its cost sits at the top right, where the next card in the fan covers it. The mock's card face (cost top left, short text, art strip) is phase 6's.
- The log drawer's lines do not wrap or scroll yet (section 6); `CombatLogLayer` still places fixed 20 px rows in a `Panel`, which clips long lines. Scrolling arrives with the Wave A scroll container (DDB-85).
- The banner is the old 200x40 phase box; section 6's banner that crosses the road on the enemy turn is phase 6's.

## Tests

`CombatLayout.test.ts` holds the stage formula to seven viewports, the floor, and an unmeasured viewport. `CombatScreen.test.ts` checks the bands at 36 and 228 logical, scaled, filling the stage at 1024x768 and 800x450 and capped and centred at 2560x1080; the drawer over the road and not the dock; END TURN on screen after mount and resize, and clickable; a resize matching a fresh mount; and, for DDB-183, seven cards a driver fully on screen, inside their own half, each showing more than 30 px of itself, at 1024x768, 1024x600, 800x450, 1280x720 and 1920x1080. `CombatScreenKeyboard.test.ts` follows the new Tab order.

## Consequences

- `ResourceBarLayer` and `DriverStatsDisplay` are deleted; `TopBarLayer`, `EndTurnColumn` and `DriverTab` replace them, and `PlayerHandView` no longer carries seat labels.
- Combat lint, main against this branch, as `window.__ui.lint().count`: 1440x882 282 to 215, 1280x720 323 to 222, 1920x1080 258 to 230, 1024x600 357 to 216, 800x450 397 to 237. What is left is sibling overlap inside cards and vehicles (180 in the ten cards alone) and the battlefields' own backgrounds and labels, plus two parts of the raider's plate escaping it at 800x450; nothing is outside the viewport at any of the five sizes.
- DDB-134 onward replaces the road's two layers with the slot grid inside the same band; DDB-88 builds the dock's detail view and drag targeting on the halves and fans here.
