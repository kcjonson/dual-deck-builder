# Interface Scaling

How the game fits any window: one scale for the whole interface, chosen from the window's size, over a logical canvas whose size is bounded, so every scene is designed and tested for a short list of sizes rather than all of them. Decision record: [interface-scaling.md](../AI_TECHNICAL_DECISIONS/interface-scaling.md).

## The problem

Every scene lays out in salal's logical px at whatever size the window is, and the ui's scale is a fixed choice of 100, 125 or 150%. Nothing bounds the logical size a scene sees, so:

- Content overlaps on small windows. Fixed side columns (200, 360, 452 px), 560 px boxes on pages that don't scroll, and a battle road with no height floor all assume more room than a small window has.
- Art that has a shape stretches. The main menu's cover and the compound plate map a design canvas onto their box one axis at a time, so their proportions follow the window's.
- Scrollbars show where nothing should scroll. Whole scene bodies scroll as a guard against small windows, list scrollers sit inside them, and salal shows a bar for any overflow, even a fraction of a pixel.

## The scale

The interface has one scale, `s`, and lays out on a logical canvas of `W/s x H/s`, where `W x H` is the window's size in salal's logical px (points on macOS):

`s = max(0.8, min(W / 1280, H / 720) x f)`

- `1280 x 720` is the reference. At `f = 1` the canvas is never smaller than it, and one axis always grows past it.
- `f` is the player's interface size, 100, 90 or 80% (Settings, below). Below 100% the interface is smaller and the canvas larger; there's no setting above 100%, since that would shrink the canvas under the reference.
- 0.8 is the floor, which keeps rules text (12 logical) at 9.6 px or more. The window can't be made smaller than `1024 x 576`, where the floor and the reference meet, so the canvas is never smaller than `1280 x 720` whatever the window.
- The scale is recomputed on every resize, before any scene lays out at the new size, and it changes nothing a scene keeps.

Some sizes it gives:

| Window | s at 100% | Canvas | Frame (below) |
|---|---|---|---|
| 1920 x 1080 | 1.5 | 1280 x 720 | the whole canvas |
| 2560 x 1440 | 2 | 1280 x 720 | the whole canvas |
| 3840 x 2160 | 3 | 1280 x 720 | the whole canvas |
| 1440 x 900 (MacBook) | 1.125 | 1280 x 800 | the whole canvas |
| 1024 x 768 | 0.8 | 1280 x 960 | the whole canvas |
| 3440 x 1440 | 2 | 1720 x 720 | the whole canvas |
| 5120 x 1440 | 2 | 2560 x 720 | 1728 x 720, centred |
| 1280 x 1024 | 1 | 1280 x 1024 | 1280 x 960, centred |
| 1024 x 576 (the smallest) | 0.8 | 1280 x 720 | the whole canvas |

The scale follows the window, not the display's DPI. A Retina Mac, a 150% Windows display and a 100% one all give the same canvas for the same window; DPI changes only how many device pixels the canvas draws with, and the framebuffer is always native.

## The frame

A scene's content lays out in a frame: the canvas, clamped to an aspect between 4:3 and 2.4:1 and centred. Inside those aspects the frame is the whole canvas. Outside them the scene's background (the table under the atlas sheets, the road under the battle) still fills the window, and the content sits in the frame with the background showing either side, or above and below.

So every scene's content sees a size between `1280 x 720` and the frame's largest, which at 80% is `2160 x 900` wide and `1600 x 1200` tall. Those corners are what a scene is designed for and tested at (Checks, below); nothing outside them is a size a scene can be given.

Overlays (dialogs, the card detail, menus) lay out against the frame too, so a dialog never centres over a pillarbox.

## Display settings

- **Interface size**: 100% (the default), 90% or 80%, the `f` above, in place of today's 100, 125 and 150%.
- **Fullscreen**: borderless at the monitor's own mode, as now.
- **Vsync**: as now.

There's no resolution setting. The art is vector and the text MSDF, so drawing at the display's native resolution is always right, and a lower internal resolution would only buy GPU headroom a 2D game doesn't need. In a window, the window's size is the resolution, and it comes back at the next launch.

## What keeps its shape

Everything is laid out in logical px, so everything scales with `s` and nothing changes shape when the window does. What the window's shape changes is the space a scene has, and each piece takes that space one of two ways.

**Fixed proportions.** Art and objects with a shape keep it. A box that holds one has its ratio fixed (its height from its width, or its width from its height), and what's drawn inside it from a design canvas scales by one number on both axes. Either it's contained (the whole drawing shows, centred, with the box's surface around it) or it covers (it fills the box and the edges crop). A drawing is never mapped onto a box one axis at a time.

| Piece | Today | Kept by |
|---|---|---|
| Play cards, driver cards, escort cards, minis | fixed px, but can be squashed in a crowded row | fixed px, never shrunk |
| Card backs and deck stacks | height from width | as is |
| Card detail | fixed width, height from content | as is |
| Vehicle tokens | uniform scale, x1 to x1.25 | as is |
| Area map and run route map | contained, one scale | as is |
| Stamps (run, results) | height from width | as is |
| Main menu cover (640 x 840) | stretched: width from the window, height from the sheet | ratio box, width from the sheet's height |
| Splash atlas (820 x 560) | ratio kept, but the book can be squashed in its column, and its edges and spine stretch | ratio box that doesn't shrink; edges and spine sized from it |
| Compound plate (920 x 760) | stretched on purpose: roofs and ground follow each axis | contained, one scale; hit spots in the plate's own space |
| Event plate background | placed by fractions | covers |

**Flexible.** Everything else takes the space: sheets and their margins, the columns that grow, lists, the top bar's spacing, the dock's fan, the gaps between things. Fixed-width side columns stay fixed; the growing column beside them is what changes.

The event's choice cards are panels, not cards: they grow with the foot and change shape by design.

## Scrolling

A scene's body never scrolls. Within the frame's sizes everything a scene shows fits, so a scrolling body only hides a layout that doesn't.

Lists scroll, and only lists: the battle log, the event's journal, the crew's roster, deck and locker, the customize scene's side, deck and locker, the area map's destinations, the run route's routes, campaign history, credits, and the developer galleries. The load out's pools join them if a full locker can outgrow the frame. A list that's shorter than its box shows no bar, and neither does overflow of less than a pixel.

What scrolls today and stops: the main menu's contents page, the map pages' body (area map, run route, run), the load out's body, the result pages' body, the compound's column of boxes, and the run's column of boxes.

## Battle

The battle's bands ([Battle Screen Design](./Battle%20Screen%20Design.md), Screen bands) are this spec's canvas: a 36 px top bar, a 228 px dock, and the road takes the rest, which at the smallest frame is its 456 px minimum. The stage caps at 1600 wide and centres, and the road's art runs to the window's edges, past the frame.

## Checks

The game's headless tests check every scene at the frame's corners and the sizes between that players have, `1280 x 720`, `1280 x 800`, `1280 x 960`, `1728 x 720`, `1600 x 1200` and `2160 x 900`, in the states that fill it most (a full hand, a full roster, the longest names):

- salal's layout lint is clean: no overlapping siblings, nothing outside its parent or the viewport, no text overflowing.
- No scroller outside the lists above shows a bar.
- Every fixed-proportion piece is drawn at its art's ratio.

No pixels, no screenshots.

## Engine work

salal has the scale, the logical viewport and the layout these need, and four pieces it doesn't, which are salal's to build:

1. **The scale from the window.** The App computes `s` from a reference size, a floor and the player's factor on every resize, before the scenes hear of it, and keeps the factor, not `s`, as the setting.
2. **A minimum window size**, set at create and kept by the window.
3. **An aspect ratio in layout**, so a box's height can follow its width or its width its height.
4. **Text on whole pixels under a scale.** Text is snapped to device pixels only under a translation today; under the interface's scale (anything but 100% at 1280 x 720) it isn't, and its edges soften.

Also, overflow of less than a pixel shows no scrollbar.

## Open decisions

1. The reference, `1280 x 720`. Proposed because it's 16:9, the battle was designed on it, and at 1920 x 1080 it gives 1.5 with rules text at 18 px.
2. The floor, 0.8, and with it the smallest window, `1024 x 576`.
3. The frame's aspects, 4:3 to 2.4:1. Proposed so the widest common monitors (3440 x 1440, 2560 x 1080) fill and only super-ultrawides pillarbox.
4. The interface sizes, 100, 90 and 80%. A player who wants larger text on a small window can't have it under this scheme; a text size setting would be its own thing.
5. Window size presets in Settings. Proposed: none; the window is resized by dragging and comes back at its size.
