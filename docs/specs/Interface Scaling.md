# Interface Scaling

How the game fits any window. A game px is a Figma px at 100% zoom: what you design is what shows, at the size you pictured it. The interface scales only at the edges, down to fit a small window and up to fill a huge one, so every scene is designed for one range of sizes and tested at a short list of them. Decision record: [interface-scaling.md](../AI_TECHNICAL_DECISIONS/interface-scaling.md).

## The problem

Every scene lays out in salal's logical px at whatever size the window is, and the ui's scale is a fixed choice of 100, 125 or 150%. Nothing bounds the size a scene sees, so:

- Content overlaps on small windows. Fixed side columns, fixed-width boxes on pages that don't scroll, and a battle road with no height floor all assume more room than a small window has.
- Art that has a shape stretches. The main menu's cover and the compound plate map a design canvas onto their box one axis at a time, so their proportions follow the window's.
- Scrollbars show where nothing should scroll. Whole scene bodies scroll as a guard against small windows, list scrollers sit inside them, and salal shows a bar for any overflow, even a fraction of a pixel.

And the sizes the scenes use were set in units nobody could picture: a card is 128 x 180, which reads as a postage stamp because in screen pixels it is one.

## The unit

A game px is an OS point: the unit the operating system's display scale is applied to, which is a CSS px in a browser and a px in Figma at 100% zoom. 400 px in Figma and 400 px in the game are the same size on the same monitor.

- On a 4K monitor at 150% display scale a px is 1.5 device pixels; at 200%, 2. On a Retina Mac it's 2.
- Rendering is always at the display's native resolution: shapes are tessellated and text is MSDF, so a px drawn with 1.5 or 2 device pixels is sharp, not upsampled.
- Raster art, when there is any, is made at 2x or more so it stays sharp on high-density displays.

## The scale

At the player's interface size of 100%, the scale is 1: the game is drawn in Figma px. The window's size in px, `W x H`, decides how much room a scene has. Two sizes bound it:

- **The smallest canvas**, `1600 x 900`. Every scene is laid out to work here. A window smaller than this in either direction scales the interface down until it fits.
- **The largest canvas**, `3440 x 1440`. Past this the interface would spread apart (columns drift away from each other, a hand fans across half a monitor, a page reads as islands), so a window larger than this in both directions scales the interface up until it fits instead of adding room.

In one line, with `f` the player's interface size:

`s = clamp(f, max(W / 3440, H / 1440), min(W / 1600, H / 900))`

and the canvas a scene lays out on is `W/s x H/s`. Where the two bounds cross (a window too wide for its height to fit both), the smallest canvas wins and the frame (below) takes the rest.

- The window can't be smaller than `1200 x 675` px, so the scale never drops below 0.75. Type is designed at 14 px or more so it stays at 10.5 px or more there.
- The scale is recomputed on every resize, before any scene lays out at the new size.
- It follows the window in px, so it's the same on every platform and every display density.

Some displays, at 100%:

| Display | Window (px) | s | Canvas |
|---|---|---|---|
| 1080p at 100%, or 4K at 200% | 1920 x 1080 | 1 | 1920 x 1080 |
| 1440p at 100%, or 4K at 150% | 2560 x 1440 | 1 | 2560 x 1440 |
| 4K Mac, "looks like 2560 x 1440" | 2560 x 1440 | 1 | 2560 x 1440 |
| 3440 x 1440 ultrawide at 100% | 3440 x 1440 | 1 | 3440 x 1440 |
| 5K2K (5120 x 2160) at 150% | 3413 x 1440 | 1 | 3413 x 1440 |
| 5K2K at 100% | 5120 x 2160 | 1.5 | 3413 x 1440 |
| 4K at 100% | 3840 x 2160 | 1.5 | 2560 x 1440 |
| Dual 4K (7680 x 2160) at 150% | 5120 x 1440 | 1.49 | 3440 x 968 |
| MacBook Pro 16" | 1728 x 1117 | 1 | 1728 x 1117 |
| MacBook Air 13" | 1470 x 956 | 0.92 | 1600 x 1040 |
| The smallest window | 1200 x 675 | 0.75 | 1600 x 900 |

## The frame

A scene's content lays out in a frame: the canvas, capped at the largest canvas and centred. The scale keeps the canvas inside that cap for every window but the most extreme shapes, so the frame is almost always the whole canvas. When it isn't, the scene's background (the table under the atlas sheets, the road under the battle) still fills the window and the content sits in the frame.

Overlays (dialogs, the card detail, menus) lay out against the frame too.

Every scene in this game opts into the frame. A game whose play area stretches as far as the window goes, a world map under a HUD, wants the smallest canvas and no largest, so the frame is salal's and opt-in per scene (Engine work, below).

## Display settings

- **Interface size**: 80, 90, 100 (the default), 110 or 125%, the `f` above, in place of today's 100, 125 and 150%. It's clamped by the window like everything else, so 125% on a small window gives what fits.
- **Fullscreen**: borderless at the monitor's own mode, as now.
- **Vsync**: as now.

There's no resolution setting. Drawing at the display's native resolution is always right for vector art and MSDF text, and a lower internal resolution would only buy GPU headroom a 2D game doesn't need. In a window, the window's size is the resolution, and it comes back at the next launch.

## Sizes

Every size in the scenes is a Figma px: card faces, columns, bars, type, padding, gaps. The sizes the scenes use now were set against a 1280 x 720 canvas and none of them carry over by arithmetic; each is set again in Figma at 100%, at the smallest canvas first, and the specs that state sizes (Battle Screen Design's bands, Card System Design's card sizes) change to match.

## What keeps its shape

Nothing changes shape when the window does. What the window changes is the room a scene has between the smallest and largest canvas, and each piece takes that room one of two ways.

**Fixed proportions.** Art and objects with a shape keep it. A box that holds one has its ratio fixed (its height from its width, or its width from its height), and what's drawn inside it from a design canvas scales by one number on both axes. Either it's contained (the whole drawing shows, centred, with the box's surface around it) or it covers (it fills the box and the edges crop). A drawing is never mapped onto a box one axis at a time.

| Piece | Today | Kept by |
|---|---|---|
| Play cards, driver cards, escort cards, minis | fixed size, but can be squashed in a crowded row | fixed size, never shrunk |
| Card backs and deck stacks | height from width | as is |
| Card detail | fixed width, height from content | as is |
| Vehicle tokens | uniform scale, x1 to x1.25 | as is |
| Area map and run route map | contained, one scale | as is |
| Stamps (run, results) | height from width | as is |
| Main menu cover (640 x 840 canvas) | stretched: width from the window, height from the sheet | ratio box, width from the sheet's height |
| Splash atlas (820 x 560 canvas) | ratio kept, but the book can be squashed in its column, and its edges and spine stretch | ratio box that doesn't shrink; edges and spine sized from it |
| Compound plate (920 x 760 canvas) | stretched on purpose: roofs and ground follow each axis | contained, one scale; hit spots in the plate's own space |
| Event plate background | placed by fractions | covers |

**Flexible.** Everything else takes the room: sheets and their margins, the columns that grow, lists, the top bar's spacing, the dock's fan, the gaps between things. Fixed-width side columns stay fixed; the growing column beside them is what changes, up to a maximum width where a column would read as too wide.

The event's choice cards are panels, not cards: they grow with the foot and change shape by design.

## Scrolling

A scene's body never scrolls. Between the smallest and largest canvas everything a scene shows fits, so a scrolling body only hides a layout that doesn't.

Lists scroll, and only lists: the battle log, the event's journal, the crew's roster, deck and locker, the customize scene's side, deck and locker, the area map's destinations, the run route's routes, campaign history, credits, and the developer galleries. The load out's pools join them if a full locker can outgrow the smallest canvas. A list that's shorter than its box shows no bar, and neither does overflow of less than a pixel.

What scrolls today and stops: the main menu's contents page, the map pages' body (area map, run route, run), the load out's body, the result pages' body, the compound's column of boxes, and the run's column of boxes.

## Battle

The battle's bands ([Battle Screen Design](./Battle%20Screen%20Design.md), Screen bands) lay out on this canvas: a top bar, the road, and the dock, with the road taking what the bars leave and the stage capped in width and centred, its art running to the window's edges past the frame. At the smallest canvas the road is at its minimum height. The bands' sizes are set again in Figma px with the rest (Sizes, above).

## Checks

The game's headless tests check every scene at the canvas's reachable corners and the sizes players have most, `1600 x 900`, `1600 x 1040`, `1600 x 1440`, `1920 x 1080`, `2560 x 1440`, `3440 x 1440` and `3440 x 968`, in the states that fill it most (a full hand, a full roster, the longest names):

- salal's layout lint is clean: no overlapping siblings, nothing outside its parent or the viewport, no text overflowing.
- No scroller outside the lists above shows a bar.
- Every fixed-proportion piece is drawn at its art's ratio.

No pixels, no screenshots. Each scene is laid out at a window size through the real scale and frame, with salal's headless helper for it.

## Engine work

The mechanism is salal's and the numbers are the game's. worldsim wants the same unit and scale with its own smallest canvas, factors of its own, and no largest canvas, since its play area takes any room it's given. salal takes every number below as a parameter, and this game passes the ones in this spec.

1. **px are OS points on every platform.** On macOS the window already measures in points. On Windows salal measures in device pixels and ignores the display scale, so a 4K monitor at 150% lays out in raw pixels; salal reads the monitor's content scale, follows it when the window moves between monitors, and divides by it.
2. **The scale.** The App computes `s` from the smallest canvas, the largest (optional) and the player's factor on every resize, before the scenes hear of it, and keeps the factor as the setting.
3. **A minimum window size**, set at create and kept by the window.
4. **The frame.** A scene opts into a content area with a maximum size, centred: its roots and its overlays lay out against the frame, and its background layer against the window. A scene that doesn't opt in lays out against the window.
5. **An aspect ratio in layout**, so a box's height can follow its width or its width its height.
6. **Text on whole pixels under a scale.** Text is snapped to device pixels only under a translation today; under any other scale it isn't, and its edges soften.
7. **A headless helper that lays a scene out at a window size** through the App's scale and frame, and lints it, for a game's tests. The game's `lintAt` moves there.

Also, overflow of less than a pixel shows no scrollbar.

The game keeps the numbers, which scenes use the frame, every size in Figma px, how each piece of art keeps its shape (contain or cover, its ratio box), the scroll rule and its list, every scene's layout, and the sizes its tests check.

## Open decisions

1. The smallest canvas, `1600 x 900`: the smallest Figma frame every screen is designed at. Smaller lets laptops run at 1:1 but makes every screen fit tighter.
2. The largest canvas, `3440 x 1440`: how far a screen may spread before the interface grows instead. Proposed so 1440p, 4K at 150% and 3440 x 1440 ultrawides all run at 1:1.
3. The smallest window, `1200 x 675`, and with it the 0.75 floor and 14 px minimum type.
4. The interface sizes, 80, 90, 100, 110 and 125%.
5. Window size presets in Settings. Proposed: none; the window is resized by dragging and comes back at its size.
