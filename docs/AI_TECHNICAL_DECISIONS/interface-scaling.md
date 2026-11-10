# Interface scaling: Figma px, scaled only at the edges

## Date
2026-11-10

## Context

The first windowed runs of the C++ game showed three faults when the window changes size: content overlaps on small windows, the main menu's cover and the compound plate stretch with the window's shape, and scrollbars show on scenes that shouldn't scroll. All three come from the same place. Every scene lays out in salal's logical px at whatever size the window is, and the ui's scale is a fixed choice (100, 125 or 150%), so a scene can be handed any size from a few hundred px up, and the scenes coped by scrolling their bodies and mapping design canvases onto whatever box they got.

A fourth fault surfaced while deciding: nobody could picture the sizes. The scenes' numbers were set against the battle spec's 1280x720 reference, so a card is "128 x 180", which Kevin, who designs in Figma at 100% and reads every size as screen px, read correctly as a postage stamp. Whatever the scaling is, a size in the code has to mean what it means in Figma.

What salal v0.39.0 has: layout in logical px with the framebuffer at native resolution, which on macOS makes a logical px an OS point and on Windows a device pixel (it never reads the display scale there); one ui scale that lays the ui out at `window / scale` and draws it scaled (`App::setUiScale`, kept as `ui.scale`); flex and grid layout with min and max sizes; MSDF text; borderless fullscreen at the monitor's mode; and a layout lint. What it hasn't: the Windows display scale, a scale chosen from the window, a minimum window size, an aspect ratio in layout, a list of video modes, letterboxing (its `app-api.md` leaves a fixed-aspect virtual resolution to the game "until a second game wants the same one"), and pixel-snapped text under any transform but a translation.

## Options considered

1. **A fixed virtual resolution, letterboxed.** Every scene lays out at one size and the whole picture scales to fit with bars. One layout, nothing overflows, but bars on 16:10 and ultrawide screens, and sizes in units of the virtual resolution rather than anything Kevin can picture.
2. **Fully dynamic layout at OS points (what the game has, on macOS).** Sizes are Figma px, but every scene has to work at every size, which is the bug list, and on a huge screen the interface spreads apart.
3. **A reference size scaled to the window.** `s = min(W/1280, H/720)`, the battle spec's rule, for every scene: the composition is the same share of every screen and the test range is bounded. This was the first draft. Its units are shares of the window: a size in the code matches nothing in Figma, and moving the reference to 1920x1080 only makes them match on a 1080p screen.
4. **A resolution picker.** A list of video modes with the game rendering at the one picked. The art is vector and the text MSDF, so a lower resolution buys only GPU headroom, and it says nothing about layout. salal has no mode list either.
5. **Figma px, scaled only at the edges (chosen).** A px is an OS point on every platform, the scale is 1 at the player's default size, and the window's size decides the room a scene has between a smallest and a largest canvas. Below the smallest the interface shrinks to fit; above the largest it grows instead of spreading.

## Decision

[Interface Scaling](../specs/Interface%20Scaling.md) is the spec. In short:

- A game px is an OS point, the unit Figma shows at 100%. Rendering stays at native resolution.
- `s = clamp(f, max(W/3440, H/1440), min(W/1600, H/900))`, with `f` the player's interface size (80 to 125%), recomputed on every resize before the scenes lay out. The smallest canvas wins where the bounds cross. The window's minimum is 1200x675, so `s` is never under 0.75.
- Each scene's content lays out in a frame capped at the largest canvas and centred; backgrounds fill the window. The scale keeps the canvas under the cap for all but extreme window shapes.
- No resolution setting. Fullscreen stays borderless at the monitor's mode.
- Every size in the scenes is set again in Figma px; nothing carries over from the 1280x720 units by arithmetic.
- Art with a shape keeps it: a ratio box, and a drawing scaled by one number, contained or covering, never mapped per axis. Cards never shrink.
- Scene bodies never scroll; only lists do.
- Every scene is linted headless at the canvas's corners and common sizes, with checks that only lists show a scrollbar and fixed-shape art keeps its ratio.

**Where it lives.** The mechanism is salal's and the numbers are the game's. Worldsim wants the same unit and scale with its own smallest canvas and factors, and no largest canvas, since its play area takes whatever room it's given while this game's interface comes apart when spread too far. salal takes every number as a parameter and builds:

- px as OS points on Windows too, from the monitor's content scale;
- the scale from the window, with the factor as the setting and the largest canvas optional;
- a minimum window size;
- the frame, opt-in per scene. It's layout rather than a render target, and worldsim is the second game `app-api.md` was waiting for;
- an aspect ratio in layout;
- pixel-snapped text under a scale and translation;
- no scrollbar for overflow under a pixel;
- a headless helper that lays a scene out at a window size through the scale and the frame, which the game's `lintAt` becomes.

The game keeps its numbers, which scenes use the frame, every size, how each piece of art keeps its shape (`ArtView` and its fit modes are the game's, and salal has no Image component by its own decision), the scroll rule, every scene's layout, and its test sizes.

## Rationale

Matching Figma at 100% is what makes the sizes designable. Kevin's sense of how big 400 px is carries straight into the game, and so does every asset drawn at that size, because the game draws it at the size it was drawn.

Bounding the canvas is what fixes the three faults. With the canvas at least 1600x900, a scene designed there always fits, so the scrolling bodies that guarded against small windows can go. With the canvas at most 3440x1440, the interface never spreads into islands, and a ratio box can't be pushed out of its column by an extreme window. And the test surface becomes seven sizes instead of all of them.

Scaling only at the edges keeps 1:1 on the displays people design and play on: 1080p, 1440p, 4K at 150% or 200%, Retina Macs, and 3440x1440 ultrawides all run at exactly the Figma size. Only laptops below the smallest canvas shrink a little (a 13" MacBook Air to 0.92), and only screens whose display scale leaves them enormous in px (4K at 100%) grow.

## Consequences

- Every size in the scenes and in the specs that state them (Battle Screen Design's bands, the card sizes) is reset in Figma px, which is a design pass before the layout work, and the battle's bands must fit the new smallest canvas.
- Small laptops and the smallest window run below 1:1, so text must snap under a scale; until salal does that, text edges soften there.
- Type has a floor of 14 px so it stays at 10.5 px at the 0.75 floor.
- The same window gives a different canvas at a different display scale. A player at 4K and 100% gets a 1.5x interface; at 150%, 1:1 with more room. That's the OS setting doing what the player set it for.
- Extreme window shapes (wider than 32:9 at the smallest height, or taller than wide) show the background beside or above the content.
- Today's `ui.scale` of 100, 125 or 150% stops meaning anything; the setting becomes the factor. There's nothing to migrate.
- Every design canvas the scenes draw from (the menu cover, the compound plate, the splash atlas) has a ratio the layout has to honour, so new art comes with one, and raster art, if any, comes at 2x or more.
