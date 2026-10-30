# Every screen at lint zero, at two window sizes (DDB-91)

Status: implemented 2026-10-02, phase 6 of [ui-rendering-engine-implementation.md](../specs/ui-rendering-engine-implementation.md).

## Context

Phase 6's last item asks for every screen at R13.29's lint zero with a golden. Before this change the screen gate covered four screens (splash, menu, settings, credits) at one size, 1440x882. The rest stood at: card showcase 705, combat 224, driver selection 50, developer 3, and the battle result had no golden at all because the dev navigate hook could not carry its data (DDB-230). At a short window the developer screen went to 170 as its sections overran a narrower column.

Almost every violation had one cause: a composite built its own background out of sibling `Rectangle`s and then put its text on top of them, which rule 1 (sibling overlap) reports pair by pair. The card was a rarity rectangle, a face rectangle over it, a badge rectangle, and texts over all three; the vehicle plate was a portrait rectangle under four texts, plus a structure track and fill on top of each other with the value overlapping both; each battlefield half was a ground rectangle under its lane dividers, labels, and plates; the developer and card showcase screens were a background rectangle under everything.

## Decisions

### A composite draws its own frame

`Card`, `Vehicle`, and `BattlefieldLayer` draw their backgrounds in `render()` (R8.1: a component emits its own draws, then its children paint over them), the way `Panel` and `ArmorBadge` already do. Their remaining children are the texts and controls, which no longer overlap anything. The draw options are built once and recoloured in place (the draw API copies what it is given), so there is no per-frame allocation. `resolvedColors` reports the card's face and rarity rim and the plate's portrait panel and border, so the snapshot still has the colours a test reads.

This is a fix, not an exemption: rule 1's question is whether two separately laid-out things land on each other, and a card's face is not a separately laid-out thing.

The plate also had two real overlaps. The structure value sat half over the bar's lower edge; it is now centred on the bar, as a label on its own fill. And at the 0.8 scale floor the driver's name and HP lines overlapped by a pixel, since rows were placed at fixed fractions of the plate's height. Each row now starts at its fraction or below the measured row above, whichever is lower.

### The hand fan declares its overlap with `zIndex`

The fan overlaps its cards through a negative gap, which rule 1 allows, but it also turns and drops each card through its transform, and a turned card's screen bounds are wider than its box. The edge pairs overlapped by a few pixels more than the gap. Each card's `FanPose` now carries its `order`, which becomes its `zIndex`: each card covers the one before it. That is what the fan has always painted (ascending `zIndex` is insertion order), and R13.25.1 reads a differing `zIndex` as declared stacking. A lifted card no longer sets `zIndex` itself, since it is on the `raised` layer and a higher layer is hit and painted first whatever the siblings' order.

This is the one place the PR leans on an exemption rather than removing an overlap, and it is the exemption's intended use: the cards are meant to overlap, and the order is meant.

The row also gains padding equal to how far the edge card's corners reach past its box when turned and dropped (`fanReach`), so the posed cards stay inside the row (rule 2) and the fan's width still holds them, as `fitCards` already reserved that room.

### The card showcase and developer screens are root stacks

Both follow DDB-90's pattern: a fill root stack with the title, a fill `ScrollContainer`, and Back, built in `onMount` and cleared in `onUnmount`, with Escape and Page Up/Down on the root and focus on Back. The showcase's cards flow through `FlowWrap` in groups (all cards, then each rarity) instead of being placed on a hand-computed grid. The showcase now uses the theme (`bg_base`, the display face) like the other menu screens.

The developer screen's column is a `Stack` of the same section factories the gallery mounts as scenes, so each section is one gallery scene and the screen is just all of them in a column. The column stretches each section to its width, and a section hugs its content, so a resize reflows the sections with nothing rebuilt; see [developer-sections-on-stacks.md](developer-sections-on-stacks.md) (DDB-235). This PR first built them at the mount-time width, fixed on both axes.

### Sections reflow at narrower widths

Six sections assumed about 1,320 px of width: icons, stacks, paint order, scrolling, panels, and the clipping fixture. They now wrap: the stack, paint order, scrolling, and panel rows through `FlowWrap`, the icon badges under the bare glyphs instead of beside them, and the clipping fixture's nine cells two to a row instead of three. At 1440x882 in the gallery every one of them lays out as before except paint order, whose column gap went from 40 to 30 so its three columns fit the gallery's 1,334 px content width without wrapping.

The shading fixture drew at fixed coordinates out to about 1,300 px and was left alone here; DDB-236 split it into fixed-size tiles in FlowWraps, so it wraps at a narrow width too.

### A short window joins the gate: 1024x600

Every screen scenario is captured and linted twice, at 1440x882 and at 1024x600 (`SHORT_VIEWPORT` in `playwright.config.ts`). 1024x600 is short and narrow at once, so layout differs on every screen that has any: combat is at its 0.8 scale floor (a 1280x750 logical canvas), credits, the card showcase, and the developer screen scroll, driver selection shrinks its portraits and scrolls its decks, and the developer sections reflow. It is the width the battle screen design names as its floor, at a laptop-short height. A second size could have been 1280x720, but at that width nothing reflows that 1440 doesn't already show.

The gallery scenes stay at 1440x882 only: the gallery is a fixture host with no scrolling, and its scenes are the sections at a known width.

### The navigate hook carries the screen's data

`window.__app.navigate(name, data)` passes `data` to `ScreenManager.navigate`, so a capture reaches the battle result exactly as a finished fight does. `BattleResultData` lost its `battleState` field, which the screen never read, so the payload is plain JSON and nothing has to be fabricated in the page: `{ victory: true }` is the whole of what the combat screen passes. The battle result has goldens for both outcomes at both sizes (DDB-230).

## Consequences

- 20 screen scenarios, each in the lint gate and with a golden in both projects and a text record in chromium.
- Goldens that moved: combat (the structure value on the bar, the hand row's padding), card showcase (rebuilt), developer (rebuilt), paint-order (column gap); see the PR for each.
- A section added later has to fit 932 px of content width or wrap, or the developer screen's short-window lint fails. That is the intent.
