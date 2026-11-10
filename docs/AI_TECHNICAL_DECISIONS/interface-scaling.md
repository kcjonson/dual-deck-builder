# Interface scaling: 1080p px, scaled with the window's resolution

## Date
2026-11-10

## Context

The first windowed runs of the C++ game showed three faults when the window changes size: content overlaps on small windows, the main menu's cover and the compound plate stretch with the window's shape, and scrollbars show on scenes that shouldn't scroll. All three come from the same place. Every scene lays out in salal's logical px at whatever size the window is, and the ui's scale is a fixed choice (100, 125 or 150%), so a scene can be handed any size from a few hundred px up, and the scenes coped by scrolling their bodies and mapping design canvases onto whatever box they got.

A fourth fault surfaced while deciding: nobody could picture the sizes. The scenes' numbers were set against the battle spec's 1280x720 reference, so a card is "128 x 180", which Kevin, who designs in Figma and reads sizes as screen pixels, read correctly as a postage stamp. Whatever the scaling is, a size in the code has to mean a size he can picture.

What salal v0.39.0 has: layout in logical px with the framebuffer at native resolution (a logical px is an OS point on macOS and a device pixel on Windows); one ui scale that lays the ui out at `window / scale` and draws it scaled (`App::setUiScale`, kept as `ui.scale`); flex and grid layout with min and max sizes; MSDF text; borderless fullscreen at the monitor's mode; and a layout lint. What it hasn't: a scale chosen from the window, a minimum window size, an aspect ratio in layout, a list of video modes, letterboxing (its `app-api.md` leaves a fixed-aspect virtual resolution to the game "until a second game wants the same one"), and pixel-snapped text under any transform but a translation.

How the engines do it, checked 2026-11-10: Unity's usual setting scales the canvas with the screen from a reference resolution, expanding on the axis with room to spare ([CanvasScaler](https://docs.unity3d.com/ru/Manual/script-CanvasScaler.html)); Unreal's UI scale is a curve over the viewport's shortest side and doesn't read the OS display scale ([DPI scaling](https://dev.epicgames.com/documentation/en-us/unreal-engine/dpi-scaling-in-unreal-engine)); Godot recommends `canvas_items` with `expand` for games that aren't pixel art ([multiple resolutions](https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html)). Xbox's accessibility guideline states text minimums by resolution, 18 px at 1080p and 36 px at 4K for PC, with a player text size up to 200% ([XAG 101](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/101)). Valve requires text of 9 px or more at the Deck's 1280x800 and recommends 12 ([Deck compatibility](https://partner.steamgames.com/doc/steamdeck/compat)). Microsoft recommends a PC game be per-monitor DPI aware and do its own scaling ([high DPI](https://devdocs.xbox.com/build/gdk-and-engines/guides/high-dpi-displays)).

## Options considered

1. **A fixed virtual resolution, letterboxed.** Every scene lays out at one size and the whole picture scales to fit with bars. One layout, nothing overflows, but bars on 16:10 and ultrawide screens.
2. **Fully dynamic layout (what the game has).** Every scene has to work at every size, which is the bug list, and on a huge screen the interface spreads apart.
3. **A 1280x720 reference scaled to the window.** The battle spec's rule for every scene. The first draft: bounded and standard in shape, but its units match nothing anyone designs at.
4. **OS points (Figma at 100% on your own monitor), scaled only at the edges.** The second draft: a px is what the operating system's display scale makes it, the scale is 1 on most screens, and the window decides the room between 1600x900 and 3440x1440. Exact Figma sizes on a high-density monitor, but it's the app and web convention, not the game one. On 1440p at 100%, the second most common Steam screen, every scene has to hold together across 2560x1440 at 1:1, the spreading this game can't take; and at 4K and 150% it draws 18 px text at 27 device pixels, under Xbox's 36.
5. **A resolution picker.** A lower render resolution buys only GPU headroom for vector art and MSDF text, and says nothing about layout.
6. **1080p px scaled with the window's resolution (chosen).** The engines' way, with a 1920x1080 reference: the canvas is at least 1920x1080 and expands on the axis with room, capped by a frame.

## Decision

[Interface Scaling](../specs/Interface%20Scaling.md) is the spec. In short:

- A game px is a pixel on a 1920x1080 screen. Screens are designed in a 1920x1080 Figma frame. Rendering stays at native resolution, and the OS display scale doesn't enter into it.
- `s = max(2/3, f x min(W/1920, H/1080))`, on the window's device pixels, with `f` the player's interface size (80 to 120%), recomputed on every resize before the scenes lay out. The window's minimum is 1280x720.
- Each scene's content lays out in a frame capped at 2600x1440 and centred; backgrounds fill the window.
- No resolution setting. Fullscreen stays borderless at the monitor's mode.
- Every size in the scenes is set again in 1080p px; nothing carries over from the 1280x720 units by arithmetic. Type is 14 px or more and rules text 18.
- Art with a shape keeps it: a ratio box, and a drawing scaled by one number, contained or covering, never mapped per axis. Cards never shrink.
- Scene bodies never scroll; only lists do.
- Every scene is linted headless at the frame's corners and common shapes, with checks that only lists show a scrollbar and fixed-shape art keeps its ratio.

**Where it lives.** The mechanism is salal's and the numbers are the game's. Worldsim wants the same scale with its own reference and factors and no frame, since its play area takes whatever room it's given while this game's interface comes apart when spread too far. salal takes every number as a parameter and builds:

- the scale from the framebuffer's resolution, with the factor as the setting;
- per-monitor DPI awareness on Windows, so the framebuffer is native at any display scale;
- a minimum window size;
- the frame, opt-in per scene. It's layout rather than a render target, and worldsim is the second game `app-api.md` was waiting for;
- an aspect ratio in layout;
- pixel-snapped text under a scale and translation;
- no scrollbar for overflow under a pixel;
- a headless helper that lays a scene out at a window size through the scale and the frame, which the game's `lintAt` becomes.

The game keeps its numbers, which scenes use the frame, every size, how each piece of art keeps its shape (`ArtView` and its fit modes are the game's, and salal has no Image component by its own decision), the scroll rule, every scene's layout, and its test sizes.

## Rationale

The canvas stays 1080 high on every 16:9 screen from 1080p to 4K, so a scene is designed once at 1920x1080 and only the extra width of 21:9 or the extra height of 16:10 and 4:3 varies, which is the narrowest design range of the options that fill the screen. That's what this game needs, because its interface comes apart when it spreads.

1080p px are sizes Kevin can picture: a 1200 px column is 1200 pixels on the screen half of Steam's players have, and a 1920x1080 Figma frame is the screen. Text minimums line up with Xbox's by construction (18 px at 1080p is 36 at 4K) and with Valve's at the Deck's floor.

Bounding the canvas fixes the three faults. With the canvas at least 1600x900 even at the largest interface size, a scene designed there always fits, so the scrolling bodies that guarded against small windows can go. With the frame capped at 2600x1440, a ratio box can't be pushed out of its column by an extreme window. And the test surface becomes seven sizes instead of all of them.

## Consequences

- Every size in the scenes and in the specs that state them (Battle Screen Design's bands, the card sizes) is reset in 1080p px, which is a design pass before the layout work.
- Figma at 100% on a high-density monitor shows a px at the OS display scale, not the game's: on 4K at 150% the game draws a third larger than Figma does. The 1920x1080 frame is the reference, not the monitor.
- Most screens run at a scale other than 1 (1.33 at 1440p, 2 at 4K, 0.67 on the Deck), so text must snap under a scale; until salal does that, text edges soften.
- The Deck runs at the 2/3 floor, which is why type has a 14 px minimum.
- 32:9 and 5:4 screens, and the 80% size on wide ones, show the background beside or above the content.
- A text size setting, which Xbox and Valve both recommend, is separate and not in this decision.
- Today's `ui.scale` of 100, 125 or 150% stops meaning anything; the setting becomes the factor. There's nothing to migrate.
- Every design canvas the scenes draw from (the menu cover, the compound plate, the splash atlas) has a ratio the layout has to honour, so new art comes with one, and raster art, if any, comes at 2x for 4K.
