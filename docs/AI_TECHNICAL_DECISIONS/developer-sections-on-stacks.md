# Developer sections on stacks (DDB-235, DDB-236, DDB-239)

Status: implemented 2026-10-02, phase 6 of [ui-rendering-engine-implementation.md](../specs/ui-rendering-engine-implementation.md). Follows [screens-at-lint-zero.md](screens-at-lint-zero.md).

## Context

After DDB-91 the developer screen was a column of the gallery's section factories, each built once at the viewport's width when the screen mounted. A section placed its content from that width and published its height from its constructor, so it was fixed on both axes. Nothing rebuilt it on resize: mounting at 1440x882 and shrinking the window to 1024x600 took the screen from lint 0 to 133. Nine of the older sections still placed their content by hand from `(x, y, width)` constructors, the four that wrapped through `FlowWrap` predicted its line breaks with `wrappedLineCount` (a copy of FlowWrap's break rule fed hand-written widths), and the shading fixture drew at fixed coordinates out to about 1,300 px.

## Decisions

### A section is a column that hugs

`DeveloperSectionPanel` is a stack-layout Panel. It takes named options (`id`, `title`, and optionally `x`, `y`, `width`), adds the title as a 50 px row, and its children flow below it. Its height hugs its content at whatever width it has; its width is fixed when the gallery gives one and hugs otherwise. The developer screen builds every section with no options and its column has `crossAlign: 'stretch'`, so the scroll container's width reaches each section through layout. A resize is the frame re-laying out the root (R8.21): the column, the sections, and every FlowWrap inside them take the new width, and nothing is rebuilt.

`fitContentHeight`, `sectionContentWidth`, and `wrappedLineCount` are gone. With the height measured, there is nothing to predict, so the review's point about the duplicated break rule is answered by deleting the copy rather than sharing it.

The six gallery-only scenes (overlays, dialog, popover, toasts, transition, scroll-hug) still place their content by hand, so the panel keeps one escape hatch for them: `contentHeight` fixes the frame at that content height and switches it to free layout. They are fixtures for overlay services at one known width, and the gallery re-enters a scene on resize anyway.

### The hand-placed sections become stacks

Interactive controls, style guide, rectangles, buttons, text, primitive shapes, nested panels, and icons are rebuilt from stacks and FlowWraps; the catalog sections (`CatalogSection`) lose the height argument to `addRow`. Their content is the same, their spacing is the stack's (gaps rather than hand-tuned y offsets), and the text samples' alignment row is three fill texts, so it follows the width. The interactive controls' rectangle is the one thing still positioned by hand, inside a fixed-height stage of its own, since moving it by coordinates is what the section demonstrates.

The icons section's two grids (bare and on a badge fill) are FlowWrap items, so the badged grid sits beside the bare one where there is room and wraps under it where there is not, each with its own caption.

### Fixtures become tiles

`DrawFixture` stays the way the chapter 4 and 5 fixtures talk to the draw API, but a fixture is now a fixed-size tile and a scene that reflows lays tiles out with FlowWrap. The clipping fixture's nine cells are nine 440 by 250 tiles in one FlowWrap. The shading fixture is five rows, each a FlowWrap of tiles whose widths are their pitch (radii 700 then circles; three border tiles of 384, one per width; gradients 720 then lines; shadows 840 then glows; two blend tiles of 520 then the nine-slice), so at the gallery's 1,334 px every tile lands exactly where the single drawing put it, and at 1024 the wide groups break between their cases. The paint-order columns are fixed at the fixture height, which leaves the scroller's menu its room, so the FlowWrap measures them as the old prediction did.

### Smaller items from the #130 review

- The hand fan's zIndex exemption covers every neighbouring pair, so `HandFan.test.ts` bounds the overlap: for 2 to 10 cards in 420, 532 (the fan at both gate sizes), and 700 wide fans, neighbours overlap by no more than the negative gap plus the posed cards' reach, start left to right, stay inside the fan, and span it.
- An empty hand hides its row, so the hugging empty stack no longer reports a zero size.
- The implementation spec's combat line said "`zIndex` and `raised` for hover lift"; it now says zIndex is the fan's order and the lift is the raised layer.
- The developer screen uses the theme (`bg_base`, the display face at `fs_4xl`), and the card showcase's rarity colours come from `Card.colorForRarity` instead of a second copy.

## Consequences

- `DeveloperScreen.test.ts` mounts the screen at 1440x882, resizes to 1024x600 and back, and holds the lint at zero and the section instances the same.
- Goldens move for every developer section whose layout changed and for the developer screen; the shading scene's pixels stay where they were. The PR lists each.
- A section's builder is `(options) => new Section(options)`; a new section is a column of stacks and needs no height arithmetic.
