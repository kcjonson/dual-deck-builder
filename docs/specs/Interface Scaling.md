# Interface Scaling

How the game fits any screen. A game px is a pixel on a 1920 x 1080 screen: the interface is designed in a 1920 x 1080 Figma frame and scaled with the window's resolution, the way Unity, Unreal and Godot projects ship. The canvas a scene lays out on is 1080 high or more and grows on the axis with room to spare, within bounds, so every scene is designed for one range of sizes and tested at a short list of them. Decision record: [interface-scaling.md](../AI_TECHNICAL_DECISIONS/interface-scaling.md).

## The problem

Every scene lays out in salal's logical px at whatever size the window is, and the ui's scale is a fixed choice of 100, 125 or 150%. Nothing bounds the size a scene sees, so:

- Content overlaps on small windows. Fixed side columns, fixed-width boxes on pages that don't scroll, and a battle road with no height floor all assume more room than a small window has.
- Art that has a shape stretches. The main menu's cover and the compound plate map a design canvas onto their box one axis at a time, so their proportions follow the window's.
- Scrollbars show where nothing should scroll. Whole scene bodies scroll as a guard against small windows, list scrollers sit inside them, and salal shows a bar for any overflow, even a fraction of a pixel.

And the sizes the scenes use were set in units nobody could picture: a card is 128 x 180, which reads as a postage stamp because on a 1080p screen it is one.

## The unit

A game px is a pixel on a 1920 x 1080 screen. Every size in a scene, a spec or a Figma file is that px: a 1200 px column is 1200 pixels wide at 1080p, 1600 at 1440p and 2400 at 4K, the same share of the screen on each.

- Screens are designed in Figma at 1920 x 1080, the frame standing for the screen. At 100% zoom a Figma px is a game px on a 1080p display.
- Rendering is always at the display's native resolution: shapes are tessellated and text is MSDF, so a px drawn with 2 device pixels at 4K is sharp, not upsampled.
- Raster art, when there is any, is made at 2x or more (for 4K) so it stays sharp.
- The operating system's display scale doesn't enter into it. A 4K screen gives the same interface at 100%, 150% or 200% display scale, as games do.

## The scale

The scale follows the window's size in device pixels, `W x H`, and the player's interface size, `f`:

`s = max(2/3, f x min(W / 1920, H / 1080))`

and a scene lays out on a canvas of `W/s x H/s`.

- At 100% the canvas is at least `1920 x 1080`: one axis is exactly at it and the other has the window's extra room, wider on 21:9, taller on 16:10 and 4:3.
- `f` runs from 80 to 120%. Above 100% the interface is larger and the canvas smaller, down to `1600 x 900`; below it the interface is smaller and the canvas larger.
- The window can't be smaller than `1280 x 720` device pixels. The scale never drops below 2/3, so type designed at 14 px or more stays at 9.3 px or more, Valve's 9 px floor, and rules text designed at 18 px stays at 12, Valve's recommendation.
- The scale is recomputed on every resize, before any scene lays out at the new size.

Some screens, at 100%:

| Screen | s | Canvas |
|---|---|---|
| 1920 x 1080 | 1 | 1920 x 1080 |
| 2560 x 1440 | 1.33 | 1920 x 1080 |
| 3840 x 2160 (4K), any display scale | 2 | 1920 x 1080 |
| 3440 x 1440 ultrawide | 1.33 | 2580 x 1080 |
| 5120 x 2160 (5K2K) | 2 | 2560 x 1080 |
| 5120 x 1440 (32:9) | 1.33 | 3840 x 1080, frame 2600 x 1080 |
| 2560 x 1600 | 1.33 | 1920 x 1200 |
| MacBook Pro 16" (3456 x 2234) | 1.8 | 1920 x 1241 |
| MacBook Air 13" (2940 x 1912) | 1.53 | 1920 x 1249 |
| Steam Deck (1280 x 800) | 0.67 | 1920 x 1200 |
| The smallest window (1280 x 720) | 0.67 | 1920 x 1080 |

## The frame

Past a point the interface doesn't gain room, it comes apart: columns drift away from each other, a hand fans across half a monitor, and a page reads as islands. So a scene's content lays out in a frame: the canvas, capped at `2600 x 1440` and centred. Every common screen fits inside it, up to 3440 x 1440 ultrawides and 4:3; beyond it (32:9, 5:4, the 80% interface size on wide screens) the scene's background (the table under the atlas sheets, the road under the battle) still fills the window and the content sits in the frame.

So every scene's content sees a size between `1600 x 900` and `2600 x 1440`, and at the default size between `1920 x 1080` and `2600 x 1440`. That range is what a scene is designed for and tested at (Checks, below).

Overlays (dialogs, the card detail, menus) lay out against the frame too.

Every scene in this game opts into the frame. A game whose play area stretches as far as the window goes, a world map under a HUD, wants the scale and no cap, so the frame is salal's and opt-in per scene (Engine work, below).

## Display settings

- **Interface size**: 80, 90, 100 (the default), 110 or 120%, the `f` above, in place of today's 100, 125 and 150%.
- **Fullscreen**: borderless at the monitor's own mode, as now.
- **Vsync**: as now.

There's no resolution setting. Drawing at the display's native resolution is always right for vector art and MSDF text, and a lower internal resolution would only buy GPU headroom a 2D game doesn't need. In a window, the window's size is the resolution, and it comes back at the next launch.

## Sizes

Every size in the scenes is a 1080p px: card faces, columns, bars, type, padding, gaps. The sizes the scenes use now were set against a 1280 x 720 canvas and none of them carry over by arithmetic; each is set again in a 1920 x 1080 Figma frame, then checked at the canvas's other sizes, and the specs that state sizes (Battle Screen Design's bands, Card System Design's card sizes) change to match. Type is 14 px or more, and rules text 18 px, Xbox's minimum for PC at 1080p.

## What keeps its shape

Nothing changes shape when the window does. What the window changes is the room a scene has within the frame, and each piece takes that room one of two ways.

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

A scene's body never scrolls. Within the frame's sizes everything a scene shows fits, so a scrolling body only hides a layout that doesn't.

Lists scroll, and only lists: the battle log, the event's journal, the crew's roster, deck and locker, the customize scene's side, deck and locker, the area map's destinations, the run route's routes, campaign history, credits, and the developer galleries. The load out's pools join them if a full locker can outgrow the smallest canvas. A list that's shorter than its box shows no bar, and neither does overflow of less than a pixel.

What scrolls today and stops: the main menu's contents page, the map pages' body (area map, run route, run), the load out's body, the result pages' body, the compound's column of boxes, and the run's column of boxes.

## Battle

The battle's bands ([Battle Screen Design](./Battle%20Screen%20Design.md), Screen bands) lay out on this canvas: a top bar, the road, and the dock, with the road taking what the bars leave and the stage capped in width and centred, its art running to the window's edges past the frame. At the smallest canvas the road is at its minimum height. The bands' sizes are set again in 1080p px with the rest (Sizes, above).

## Checks

The game's headless tests check every scene at the frame's corners and the shapes players have most, `1600 x 900`, `1920 x 1080`, `1920 x 1200`, `1920 x 1440`, `2600 x 1080`, `2600 x 1350` and `2400 x 1440`, in the states that fill it most (a full hand, a full roster, the longest names):

- salal's layout lint is clean: no overlapping siblings, nothing outside its parent or the viewport, no text overflowing.
- No scroller outside the lists above shows a bar.
- Every fixed-proportion piece is drawn at its art's ratio.

No pixels, no screenshots. Each scene is laid out at a window size through the real scale and frame, with salal's headless helper for it.

## Engine work

The mechanism is salal's and the numbers are the game's. worldsim wants the same scale with its own reference and factors and no frame, since its play area takes whatever room it's given. salal takes every number below as a parameter, and this game passes the ones in this spec.

1. **The scale from the window's resolution.** The App computes `s` from the framebuffer's size in device pixels, a reference size, a floor and the player's factor on every resize, before the scenes hear of it, and keeps the factor as the setting. The OS display scale doesn't change it.
2. **Native pixels on Windows.** The process is per-monitor DPI aware (V2), so Windows never scales the game's output and the framebuffer is the monitor's own resolution at any display scale.
3. **A minimum window size**, in device pixels, set at create and kept by the window.
4. **The frame.** A scene opts into a content area with a maximum size, centred: its roots and its overlays lay out against the frame, and its background layer against the window. A scene that doesn't opt in lays out against the window.
5. **An aspect ratio in layout**, so a box's height can follow its width or its width its height.
6. **Text on whole pixels under a scale.** Text is snapped to device pixels only under a translation today; under any other scale it isn't, and its edges soften.
7. **A headless helper that lays a scene out at a window size** through the App's scale and frame, and lints it, for a game's tests. The game's `lintAt` moves there.

Also, overflow of less than a pixel shows no scrollbar.

The game keeps the numbers, which scenes use the frame, every size in 1080p px, how each piece of art keeps its shape (contain or cover, its ratio box), the scroll rule and its list, every scene's layout, and the sizes its tests check.

## Open decisions

1. The reference, `1920 x 1080`: the most common screen on Steam and the size the Figma frames are drawn at.
2. The frame's cap, `2600 x 1440`: how far a screen may spread before it pillarboxes. Proposed so 3440 x 1440 ultrawides and 4:3 fill.
3. The smallest window, `1280 x 720` device pixels, and with it the 2/3 floor, 14 px minimum type, and 18 px rules text.
4. The interface sizes, 80 to 120% in steps of 10.
5. A text size setting separate from interface size, which Xbox's guideline (up to 200%) and Valve both recommend. Proposed: later, as its own item.
6. Window size presets in Settings. Proposed: none; the window is resized by dragging and comes back at its size.
