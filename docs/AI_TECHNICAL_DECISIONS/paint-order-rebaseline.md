# Paint order: text in submission order, and the sites that leaned on it

DDB-67, DDB-55 phase 1, the epic's second deliberate re-baseline. Landed 2026-09-28.

## The problem

Two temporary pieces kept the goldens a picture of the old text batch, which R2.2 names as this
engine's bug: text submitted in a clip scope painted above every shape in that scope, and a clip
change ended the scope.

- `DrawApiOptions.legacyTextOrder` ended a sort domain at every clip push and pop, which is where
  `Renderer.enableScissor` and `disableScissor` used to flush. It violated R3.20 ("not a clip
  change") by design and was set in one place, `createDrawApi`.
- `LegacyPaintOrder`, applied by `WebGL2Backend.submit`, moved each layer's text after that layer's
  shapes and grouped it by colour, as `TextRenderer` had.

Chapter 3 says a draw paints where it was submitted within its layer. Deleting both makes that true
on screen, and spec 14.6 says what follows: every site that relied on text floating over a later
shape changes, and each needs a layout decision in the same change, with a before and after pass of
every screen.

## What was deleted

`LegacyPaintOrder.ts`, `components/legacyDrawOrder.test.ts`, the `legacyTextOrder` option, field and
barrier calls in `DrawApi`, its use in `createDrawApi`, and the paint-order tests in
`UberGeometryEncoder.test.ts`. The `legacyTextOrder (TEMPORARY)` describe in `DrawApi.test.ts`
became two permanent contract tests: a clip push and pop keep one domain with no barrier counted,
and text drawn before a clipped shape is submitted before it. `WebGL2Backend.test.ts` builds its
multi-domain frames with explicit `flush()` barriers instead of relying on clips to cut them.

Nothing of the old facade survives: `Renderer` has no draw methods, there is no `enableScissor`,
`disableScissor`, text batch or `SCISSOR_BOX` read anywhere in `src`, and both frame loops open the
frame with `beginFrame` in their render section and close it with `endFrame` in their flush
section (`Game.render`/`Game.flush`, `src/gallery/index.ts`). Comments in `FrameTimer`, `Game`,
`src/index.ts` and the gallery that described a clip boundary submitting mid-walk now say that the
flush section is the whole frame's submission.

## The reorder sites

Found by capturing every screen and scene on `main` and on the branch with only the deletion
applied, and diffing the pairs pixel for pixel. Four screens moved; all eight gallery scenes, the
splash and the main menu were byte-identical.

**Card title under the driver badge (spec 14.6, DDB-28).** Combat hand cards add the title before
the driver badge's circle at the same top-left spot, so the badge now covers the first two or three
letters ("pair Kit"). Before, the title painted over the badge and hid the badge's own "D1". Fix, as
14.6 prescribes: the title starts past the badge (`badgeX + badgeSize + 6`, 41 px on a normal card)
and keeps its right edge. Cards without a badge are unchanged.

**Driver-selection deck preview (spec 14.6, DDB-31).** The preview laid mini cards two to a row in a
container 97 px tall, so a four-card deck ran two rows and a six-card deck three, past the cycle
button and out of the panel. The overflow was already under the button, since both are shapes, so
ordering alone moved only glyph overlaps inside the mini cards; the layout was wrong either way and
14.6 asks for it to be fixed here. Fix, hug sizing
with a clip as the backstop: the container reaches from its top to 10 px above the selector and
clips (`overflow: 'hidden'`), and a row holds as many cards as the width fits, capped at the deck
size. Every starting deck (four or six entries) is one centred row at the reference size, inside
the panel. At a narrow window a deck that needs a second row that does not fit is clipped at the
container rather than drawn over the button.

**Developer screen title and the scroll panel (spec 14.6).** The title's line box ran from 30 to
87.6 px while the opaque scroll panel starts at 80, so with true order the panel would cover
whatever of the title fell below 80. At 1440x882 nothing visibly did (the capture was
byte-identical with the deletion alone), but the geometry was wrong and depended on the bitmap
atlas's ink sitting high in the box, which phase 2's metrics change. Fix: the 80 px header and
footer are named constants, the title's line height is explicit, and its line box ends 6 px above
the panel (`TITLE_TOP` 16). The title moves up 14 px. The unmount hook finds the scroll panel by
reference instead of by `getY() === 80`.

**Combat resource bar driver names (not in 14.6; found by the pass).** Each `DriverStatsDisplay`
put the driver's name at 20% of the bar's height, on top of the adrenaline icons added after it, so
with true order the names vanished under the icons. Fix: the name gets a 16 px band (a 12 px line
box and a 2 px margin each side) and the icons shrink until the band is free while staying
vertically centred; at the 61 px bar that is 29 px icons instead of 36, and the draw, discard and
fuel icons scale with them.

**Developer overlay background (spec 14.6).** F5's overlay draws after the screen, and its black
panel used to have screen text from the same domain hoisted over it. Not in any golden (the overlay
is hidden by default); checked by hand on combat with F5: the overlay now covers the END TURN
button, the lane label and the raider under it.

**The card showcase double render** named in the implementation spec was already deleted
(DDB-110).

Where differently coloured text runs overlap, the per-colour grouping no longer decides which is on
top; submission order does. On the card showcase that is 125 pixels where two cards' "COMMON"
labels overlap their overflowing descriptions, and on driver selection the mini cards' cost digit
against their "x2" badges. Both are overlaps that should not exist (text estimated rather than
measured, DDB-71), not ordering decisions.

## Measured

GPU draws per frame, `scripts/perf-capture.mjs` at 1440x882, vsync off, timer off, one Mac (Radeon
Pro 560X, ANGLE Metal). `main` is `b28be19`.

| Screen | API draws | GPU draws on main | GPU draws now | Flushes on main | Flushes now | Frame median main | Frame median now |
|---|---|---|---|---|---|---|---|
| splash | 4 | 1 | 1 | endFrame 1 | endFrame 1 | 1.24 ms | 0.87 ms |
| main menu | 12 | 1 | 1 | endFrame 1 | endFrame 1 | 1.86 ms | 1.55 ms |
| developer | 37 | 2 | 1 | barrier 2 | endFrame 1 | 9.10 ms | 1.14 ms |
| card showcase | 288 | 2 | 1 | barrier 2 | endFrame 1 | 8.62 ms | 3.39 ms |
| driver selection | 88 | 1 | 1 | endFrame 1 | endFrame 1 | 2.11 ms | 1.09 ms |
| combat | 173 | 6 | 1 | barrier 5, endFrame 1 | endFrame 1 | 5.79 ms | 1.37 ms |

Every screen is one sort domain and one GPU draw. The frame medians are one capture each on a
laptop and read as direction, not magnitude, but the three screens that lost barriers are the three
that sped up most, which fits each mid-frame submit costing a ring upload and a pass on this
driver (compare DDB-195's index-ring cost on combat).

## Goldens

Re-minted on CI. Changed, per project: `screen-combatScreen` (hand titles past the badges, badges
whole, resource bar names above smaller icons), `screen-driverSelectionScreen` (deck previews in one
row inside each panel), `screen-developerScreen` (title 14 px higher), `screen-cardShowcaseScreen`
(the overlapping "COMMON" labels, a text-over-text order change). Unchanged: splash, main menu,
all eight gallery scenes.

## Left open

- Long card titles still run into the cost digit ("Armor Plating" on a badged card, "Coordinated
  Attack" on any card). Titles are `nowrap` with an estimated width and never truncate; the badge
  fix narrows the slot by 29 px, so a badged card reaches the cost sooner. Real metrics and
  measured ellipsis are DDB-71's; filed as a follow-up for the card face.
- DDB-196 (developer section titles sitting on their bordered panels) is layout, not order, and
  touches every section and gallery scene; left to its own change.
