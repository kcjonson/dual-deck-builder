# Interface scaling: one scale from the window over a bounded canvas

## Date
2026-11-10

## Context

The first windowed runs of the C++ game showed three faults when the window changes size: content overlaps on small windows, the main menu's cover and the compound plate stretch with the window's shape, and scrollbars show on scenes that shouldn't scroll. All three come from the same place. Every scene lays out in salal's logical px at whatever size the window is, and the ui's scale is a fixed choice (100, 125 or 150%), so a scene can be handed any logical size from a few hundred px up, and the scenes coped with that by scrolling their bodies and by mapping design canvases onto whatever box they got.

What salal v0.39.0 has: layout in logical px with HiDPI handled under it (the framebuffer is native, the ratio is framebuffer over window), one ui scale that lays the ui out at `window / scale` and draws it scaled (`App::setUiScale`, kept as `ui.scale`), flex and grid layout with min and max sizes, MSDF text, borderless fullscreen at the monitor's mode, and a layout lint. What it hasn't: a scale chosen from the window, a minimum window size, an aspect ratio in layout, a list of video modes, letterboxing (its `app-api.md` leaves a fixed-aspect virtual resolution to the game "until a second game wants the same one"), and pixel-snapped text under any transform but a translation.

The battle's spec already had the answer for one scene, `s = min(W/1280, H/720)` floored at 0.8, and [battle-scene.md](./battle-scene.md) dropped it so the battle would scale as the other scenes do.

## Options considered

1. **A fixed virtual resolution, letterboxed.** Every scene lays out at 1280x720 and the whole picture scales to fit the window with bars. One layout and nothing ever overflows, but a 16:10 MacBook gets bars top and bottom, an ultrawide gets wide ones, a 4:3 window wastes a quarter of itself, and salal has none of it, so the game would build render-target scaling to get worse use of the screen.
2. **Fully dynamic layout (what the game has).** Fills any window, but every scene has to be right at every size, which is the bug list. The test surface is unbounded.
3. **A resolution picker.** A list of video modes for fullscreen, with the game rendering at the one picked. The art is vector and the text MSDF, so a lower resolution buys only GPU headroom a 2D game doesn't need, and it says nothing about layout: the scenes would still meet every logical size. salal has no mode list either.
4. **One scale from the window over a bounded canvas (chosen).** The scale is computed from the window so the logical canvas is never smaller than 1280x720, the content's frame is capped at 1728x960 so it never spreads past where it holds together, and the player gets a factor of 100, 90 or 80% on top. Layout stays dynamic, but within a short, known range of sizes.

## Decision

[Interface Scaling](../specs/Interface%20Scaling.md) is the spec. In short:

- `s = max(0.8, min(W/1280, H/720) x f)`, with `f` the player's interface size (100, 90 or 80%), recomputed on every resize before the scenes lay out. The window's minimum is 1024x576, so the canvas is never smaller than 1280x720.
- Each scene's content lays out in a frame, the canvas capped at 1728x960 and centred; backgrounds fill the window. Overlays lay out against the frame. At 100% that cap means every aspect from 4:3 to 2.4:1 fills.
- No resolution setting. Fullscreen stays borderless at the monitor's mode.
- Art with a shape keeps it: a ratio box, and a drawing scaled by one number, contained or covering, never mapped per axis. Cards stay at fixed px and never shrink.
- Scene bodies never scroll; only lists do.
- Every scene is linted headless at the frame's corners, with checks that only lists show a scrollbar and fixed-shape art keeps its ratio.

**Where it lives.** The mechanism is salal's and the numbers are the game's. Worldsim has the same problem: its `ui-scale-setting.md` measures its UI at about 40% of its mocks' size on a 3072x1728 window, and plans one scale against a 1600x1000 reference, 0.75 to 1.5x, with a default from the window as a later step. salal takes the reference, the floor, the factor's range, the minimum window and the frame's largest size as parameters, and builds:

- the scale from the window, with the factor as the setting;
- a minimum window size;
- the frame, opt-in per scene. The two games want opposite things past the minimum: worldsim's play area stretches as far as the window goes, so it takes any aspect over its minimum size and wants no frame on its world (its menus might want one), while this game's interface comes apart when it's spread too far, so it caps it. salal's `app-api.md` left a fixed-aspect virtual resolution to the game until a second game wanted one; the frame is layout rather than a render target, and worldsim is the second game;
- an aspect ratio in layout;
- pixel-snapped text under a scale and translation;
- no scrollbar for overflow under a pixel;
- a headless helper that lays a scene out at a window size through the scale and the frame, which the game's `lintAt` becomes.

The game keeps its numbers, which scenes use the frame, how each piece of art keeps its shape (`ArtView` and its fit modes are the game's, and salal has no Image component by its own decision), the scroll rule, every scene's layout, and its test sizes.

## Rationale

Bounding the canvas is what fixes the three faults at once. With the canvas at least 1280x720, the fixed columns, the 560 px boxes and the road's 456 px floor always fit, so the scrolling bodies that guarded against small windows can go. With the frame capped, the interface can't spread until it reads as islands, and a ratio box can't be pushed out of its column by a window that's very tall or very wide. And the test surface becomes seven sizes instead of all of them, which the headless tests can cover on every scene.

Keeping layout dynamic inside the bound uses the whole screen on 16:10 and ultrawide monitors, which a letterbox wastes, and the scale following the window rather than the display's DPI means a Retina Mac and a 150% Windows display get the same canvas, so DPI is the renderer's business and never a scene's.

The player's factor only goes down because going up would shrink the canvas under the reference, which is the one thing the scheme rules out.

## Consequences

- Most players run at a scale other than 1, so text must snap under a scale. Until salal does that, text edges are softer than at 100%.
- Text at the floor is small: rules text is 9.6 px on a 1024x576 window. A player who wants larger text on a small window can't have it; a text size setting would be separate.
- Super-ultrawide (32:9) and portrait-ish windows show the background beside or above the content.
- Today's `ui.scale` of 100, 125 or 150% stops meaning anything; the setting becomes the factor. There's nothing to migrate.
- Every design canvas the scenes draw from (the menu cover, the compound plate, the splash atlas) has a ratio the layout now has to honour, so new art comes with one.
- A scene that wants more room than the frame's smallest size has to be redesigned, not scrolled.
