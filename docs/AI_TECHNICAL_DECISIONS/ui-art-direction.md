# UI art direction for the first playtest

Date: 2026-10-16. Status: chosen by Kevin as the working direction for the first playtest, design only, nothing built. Not the final UI.

Spec: [UI Art Direction](../specs/UI%20Art%20Direction.md). Design canvas: "Wasteland Wheels UI Concept" on claude.ai. Its sources are checked in at `docs/design/ui-art-direction/canvas/` and renders of every board at `docs/design/ui-art-direction/` and `exploration/`.

## Context

The area map had just been restyled as a road atlas ([area-map-atlas-style.md](./area-map-atlas-style.md)), and every screen around it still wore a generic dark web-app look: flat grey panels, a yellow primary button, no relation to the setting. The game needed a UI look that carries the map's aesthetic, reads as a game rather than a web page, and gets the meta screens to a first playtest. The combat screen and card faces were explicitly left out; both get their own passes.

## Decision 1: a road atlas, printed and then marked by hand

The mood board set the idea: the UI is the crew's road atlas, printed before the end and revised by hand after. The game prints (names, numbers, panels, buttons) and the player draws (highlighter for selection, grease pencil on plates). Palette, type, map glyphs, and the highway's casing all come from the area map.

Mood board options:

- A clean atlas (`exploration/mood-board-clean.png`): right idea, but too crisp to feel post-apocalyptic.
- Heavily weathered (`exploration/mood-board-weathered.png`): stains, tears, scorch, and grime everywhere. Rejected: readability suffered.
- In between (`mood-board.png`), with the dirt texture scaled back once more: kept.
- After dark (`exploration/rejected-lamplight.png`): the atlas under a red or amber map light for night and danger screens. Rejected outright.

## Decision 2: wear has rules

The weathering passes showed that dirt applied evenly reads as a filter, not as history. So wear got standards: four levels (W0 clean, W1 handled, W2 worn, W3 damaged), each tied to a reason the player could guess (age, handling, exposure, damage); wear grows from the edges in and never sits on the reading window; states never borrow dirt (disabled is faded print, locked is the rust hatch); damage appears only after a game event; and each screen has a budget. Details are in the spec's Wear section.

## Decision 3: Glovebox Atlas, with the Field Kit's compound layout

Three directions were drawn, each as a compound screen and a main menu:

- A, Glovebox Atlas (`exploration/a-atlas-*.png`): the screen is the map page. Neatlines, legend boxes, thumb-index tabs, a site plan of the compound, a contents page for the menu.
- B, Field Kit (`exploration/b-kit-*.png`): the UI is objects on a rusted dash. Manila tags, label tape, a clipboard, and an illustrated overhead view of the compound yard.
- C, Survey Form (`exploration/c-form-*.png`): printed dispatch paperwork. Flat, typographic, numbered form sections, overprinted spot colours.

Kevin preferred A overall and B's compound layout. The chosen look is A's language (sheet, legend boxes, tabs, highway primary, map glyphs) with B's composition for the compound: a large illustrated overhead plate of the yard on the left, and a right column for the selected building, the needs, the day's orders, and the primary action.

Two corrections came during the work: the compound has to be an overhead view, not a grid of building cards, and the gameplay (combat) screen is not part of this pass.

## Decision 4: a hand-drawn logo

The logo is letterwork, not a font: "Wasteland" in a broad-nib ink script over "WHEELS" in sign-painted brush capitals, Highway orange on a Casing outline with a drop shadow and chipped paint, two tire tracks beneath, and a large inked wheel behind the right half. The first attempt (single-stroke letters with a rough displacement filter) read as crayon and was redrawn with broad-nib strokes; a stencilled WASTELAND band was tried and replaced by the script. `logo.svg` is the source.

## Decision 5: quiet card hints, and a splash

It's a card game and the home screen didn't say so. Rather than one loud card element, the two decks (one per driver, in the two drivers' colours) show up quietly in many places: set down on the menu cover, lying on the table beside the closed atlas on the splash, and as a small deck glyph on the Crew tab, the bunkhouse, and the card showcase. The card back is atlas stock with the logo's W in a shield; card faces stay with the card spec. The launch splash is the closed atlas with both decks and a scale-bar loader.

## Trade-offs and consequences

- A second theme. Tokens are global today, and combat keeps the dark look until its own pass, so the `atlas` theme needs per-screen selection (the spec's open question 1). The alternative, re-theming globally, changes combat early.
- The area map's side panels move onto the sheet. [area-map-atlas-style.md](./area-map-atlas-style.md) kept them in the dark UI; this supersedes that point.
- New art in the UI atlas (paper nine-slices per wear level, tape, hand marks, stamps, card backs, the compound plate, the logo, new icons) and two font weights (Barlow Condensed 700, Open Sans 600). Serif and hand roles are deferred.
- All texture is baked. The canvas used SVG filters as stand-ins; the engine draws nine-sliced textures from resident atlases and stays at one GPU draw per flush, so the highlighter is baked, not drawn with a multiply blend.
- The main menu's primary is Continue when a save exists, which changes [Game Flow and UI Specification](../specs/Game%20Flow%20and%20UI%20Specification.md) 1.1 (New Campaign was always the most prominent).
- Provisional by design. After the playtest the direction gets another pass; nothing here should be cited as the final UI.

## In the C++ alpha

The direction holds; how it's built changed (2026-10-31, [procedural-paper.md](./procedural-paper.md)). Nothing is baked: the paper and its wear are computed in the shader per surface, highlighter is a second shader fill, and the rest of the new art is flat-fill vector or icons. One GPU draw per flush still holds, since a shader fill is one more rect in the batch.
