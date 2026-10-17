# The atlas components

Date: 2026-10-16, with DDB-505 (epic DDB-500). Spec: [UI Art Direction](../specs/UI%20Art%20Direction.md), Components and Card hints. Rules: R11.7, R11.9, R11.12, R11.13, R12.7, R12.16, R12.18, R12.19, R5.17, R10.15, R3.28. Builds on [theme-selection.md](./theme-selection.md). The atlas is the playtest direction, not the final UI.

## Context

The meta screens (DDB-506 to DDB-511) all build from the same parts: the sheet, its tabs, legend boxes, the highway and back-road buttons, contents rows, the resource strip, gauges, map glyphs, plates, the deck objects, and the hand's marks. Each has geometry the token scale doesn't carry (1.4 px borders, a 0.6 px rule 6 px in, an 18.66 px label floor), and most draw things the engine catalog has no component for. The UI art atlas (DDB-504) wasn't merged when they were built.

## Where they live

Options:

1. The engine's `ui/` folder, beside Button and Panel.
2. A game folder, `src/renderer/game/ui/atlas/`. Chosen.

The engine catalog is themed by tokens and meant to be reusable; these are this game's art direction, with its palette names (Highway, Casing, back road), its map glyphs, and its decks. CLAUDE.md keeps game-specific code out of the engine. The decision record for themes rejected "separate atlas components (`AtlasButton`)" as the way to theme the catalog, and that still holds: the catalog's Button follows the atlas through tokens. These parts aren't twins of catalog components. The highway's casing offset, the sheet's neatline, and the contents page's leaders have no counterpart to re-alias.

## What the engine got

Two tokens and one variant change, so the catalog's accent Button on an atlas screen stops contradicting the highway (the DDB-502 review's points):

- `accent_edge`: a filled accent control's border. Dark aliases it to `accent`, so nothing dark moves; the atlas aliases it to `accent_dim`, the Casing. `buttonLayers` borders the accent tone in it, and an edge of its own survives hover.
- `focus_ring`: R11.12's layer 6. Dark aliases it to `accent`; the atlas sets it to ink. Every variant builder rings in it.

`back_road` and `duct_tape` join the base colours at their atlas values, as the other atlas additions did.

The render walk's fallback ring (for focusables without a look of their own), TabBar, and Slider read the node's `themeTokens` rather than the dark table, so focus stays visible on paper: the dark accent is about 1.2:1 there.

The catalog Button still can't be the highway: border width and label size aren't paint, so a theme can't change them. Atlas screens use `AtlasButton` for their primary.

## How they're built

- Colours come from `atlasInks(theme)`, one table per theme, cached, built from `themeTokens`. Every part re-reads it in `onThemeChange`, so a part built detached and inserted under an atlas screen draws in the atlas. Text parts use token names and follow on their own.
- The spec's off-scale geometry is in one table, `ATLAS` in `atlasStyle.ts`, rather than spread through the parts or forced into tokens. Space and size tokens are the same in every theme, and these values are the atlas's alone.
- Bold goes through `fontWeight` (`DISPLAY_BOLD`, `MONO_MEDIUM` resolve through `resolveFontRole`), never an atlas name, so the generated 700 and 500 faces (DDB-503) apply without code changes. Until then they fall back to the loaded weight.
- Pressables use R12.7's press machine. The buttons and tabs extend `LabelledPressable`, so their states are R11.12 look layers and move by R11.13's transitions; the hover lift and the press drop are the look's `offsetY`. Tabs reuse R12.16's keyboard model (one Tab stop, arrows with wrap, Home and End).
- A button's geometry is laid out once per size; a hover's lift or a press's drop translates it in `render`.
- Render paths allocate nothing of their own: rects, polygons, glyph outlines, leaders, and the dashed disabled border are built at layout into arrays the part keeps, and a mark's loop is rebuilt only when its target moves. Draw option literals are the engine's API, as everywhere else.
- Outlines that aren't convex (the star) are cut by `triangulatePolygon`, so R5.17's feather holds and the dev build doesn't report them.
- A contents row moves between `primary` and `standard` in place (`variant`), and its lead glyph's label and its subtitle are settable, because the main menu's lead row changes with the save (DDB-507): Continue leads when there's a campaign, New campaign otherwise. Rebuilding the rows instead would drop the focus Back restores to Continue while the save is still being read. The two rows trade heights, so nothing under them moves.

## The art

Every baked piece goes through `drawAtlasArt(draw, { name, rect, tint })` in `atlasArt.ts`, which is `drawUiArt` from the UI art atlas ([ui-art-atlas.md](./ui-art-atlas.md)): the 2x raster by the frame's ratio, nine-slicing where a piece has insets. The sheet, legend boxes, tape, card backs and edges, resource icons, the deck glyph, the highlighter, and the grease loops all draw from it. With the page not resident a surface draws as a flat tint and the rest return false, and each part keeps a flat stand-in for that case (and for tests, which have no page).

Surfaces take their wear by size: `paperPiece` gives W2 only to a surface at least 288 px on its short side and W3 at 352, W1 below, so a small panel never squeezes a worn piece's corners. The fresh (W0) legend box is a flat fill, never art, per the wear standards. The loop's stroke sits inside its piece, so the piece is drawn further out (20 px) than the flat loop (12 px).

## The hand layer

Highlighter goes down before the ink it marks, at normal blend, so the label keeps full strength; a grease loop goes over everything. One `HandMarkLayer` class covers both by `place`: `under` is `zIndex -1`, `over` is `zIndex 1`, out of the flow and filling its stack's content box (R10.15), with no hits. Different stacking is what the layout lint reads as declared overlap (R3.28), so a layer over its rows lints clean. A mark follows its target through `localToAncestorInto` against the parent they share. Variants cycle so two marks never match.

## Consequences

- Screens build from these parts and opt into the atlas with `ScreenOptions.theme`. A catalog component an atlas screen uses still has to be converted to `themeTokens` if it isn't already.
- The parts' look is flat until the art lands; the gallery goldens of the `atlas-*` scenes move once when it does.
- `ATLAS` holds numbers a later pass may want as tokens if a second theme needs different ones.
