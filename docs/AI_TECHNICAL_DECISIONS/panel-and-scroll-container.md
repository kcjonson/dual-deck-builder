# Panel, ScrollContainer, and Scrollbar

Status: decided 2026-09-28 with DDB-85's second PR (DDB-55 phase 5, Wave A). Rules R12.18 to R12.20 and R12.37 in [chapter 12](../ui-rendering-spec/12-component-catalog.md); R9.32's wheel latching from [input-dispatcher.md](./input-dispatcher.md); the clip and offset rules of chapter 4; the caches of [subtree-ink-cull.md](./subtree-ink-cull.md). Supersedes the scrolling half of [panel-padding.md](./panel-padding.md). Closes DDB-32 and DDB-210.

## What exists

- `ui/Panel.ts` is R12.19's panel on the closed style set: `variant` (`panel`, `raised`, `inset`) from tokens, `title` and `kicker` in a header band with a hairline under it, `actions` laid out at the header's right end, `corners` (four L ticks straddling the border in the accent), `glow`, `compact`, `flush`, and a content slot that is a stack. It no longer scrolls.
- `ui/ScrollContainer.ts` is R12.20: vertical scrolling of one content child, `scrollTo`, `scrollBy`, `scrollToTop`, `scrollToBottom`, `scrollIntoView(child, { block })` (which reveals the child's ink, not only its box: [scroll-into-view-ink.md](./scroll-into-view-ink.md)), `scrollHeight` (the spec's `contentHeight`), `onScroll`, `focusable` with `tabIndex: -1`, the wheel, and Page Up, Page Down, arrows, Home, and End.
- `ui/Scrollbar.ts` is R12.37: a track and thumb bound to `{ offset, extent, viewport }` on either axis, reporting the offset a drag or track press asks for through `onScroll`.
- `Stack.flows(child)`: which children take part in the flow, so a subclass can place some itself.
- `PopupService.scrolled(scroller)` and the `scroll` close reason (R3.6a, DDB-210). `Dispatcher.contentMoved()` for a scroll by code (R9.9).
- Game: the developer screen and the card showcase scroll through a ScrollContainer over one content layer; the combat log is a ScrollContainer over a stack of lines reconciled by entry id, following the newest (DDB-32).

## Decisions

**The panel's content slot is the panel itself.** R12.19 says the content slot is a stack container by default, and R12.18 says a library container never inserts implicit children, which is exactly what the sibling engine's panel got wrong. So `Panel` extends `Stack`: the caller's children are the content and flow as a column inside the content inset, with the header's height added to the top padding. The kicker and title are the panel's parts (marked, never in the flow), and the actions are the caller's own components that the panel takes out of the flow and places in the header. `layout: 'free'` turns the flow off, so every child sits at its `position` inside the content box; the developer sections and the nested-panel example use it, since they are placed by hand.

**The content inset never goes below the edge.** Superseded by [component-rounded-clip.md](./component-rounded-clip.md) (DDB-231): a panel that clips (`overflow: 'hidden'`) cuts its corners with R4.14's rounded clip and insets content only to the border; one that does not clip still insets by `max(borderWidth, radius)`, and `flush` and a smaller `padding` are raised to that edge. The nested-panel example does not clip, so its children keep the 8 px inset they were moved for.

**The inset is anchor placement now, not a content offset.** DDB-196 put the padding into `contentOffset` so the walk, hit test, and snapshot all agreed. A stack already places children inside its padding (flow children by position, the rest by anchor against the padded box), so the panel's `contentOffset` is zero and the snapshot no longer reports one for a panel. Screen positions did not move: every gallery scene's text record is identical, measured in the browser against the committed JSON.

**Style.** Panel accepts `backgroundColor`, `borderColor`, `borderWidth`, `borderRadius`, `opacity`, `padding`, and `shadow` and rejects the rest (R11.14). The default look is the variant's (bg_panel, line_edge, radius_panel). The developer sections and the nested panel pass their old colours explicitly, so their pixels stay; `border: '2px solid ...'` became `borderWidth` and `borderColor`.

**One content child, measured.** ScrollContainer gives its first non-part child the inner width and takes the height the child measures there; if that overflows, it takes the scrollbar's gutter off the width and measures once more. The extent is that height plus the padding, which scrolls with the content (R4.13). A given `contentHeight` overrides the measure, which is also what lets a scroll position hold before the first layout.

**The scrollbar is a part placed at the offset.** R4.9's content offset moves every child, the scrollbar included, so the container places the scrollbar at `y = clip.y + scroll` to keep it fixed on screen. The alternative, a per-child offset in the walk, the hit test, `screenMatrix`, the snapshot, and the ink cache, was five readers to change for one component. It sits in the gutter the content gives up while it overflows, inside the right padding, so it is always inside the clip, and draws and hits nothing when there is nothing to scroll.

**The scrollbar's box is its target.** R13.25.7 wants 24 px targets and a 6 px track reads better, so the scrollbar's box is 24 px across (`SCROLLBAR_BREADTH`) with the track and thumb drawn 6 px thick along its middle, and the gutter is the same 24 px. The whole target lies beside the content, so it never takes a click meant for a row, and nothing needs a hit slop, a margin, or an override of the hit test. The first version of this PR drew the box 6 px wide and reached 9 px past it by margin; review found that it took the rightmost pixels of every row and was clipped on the other side.

**The clip.** Inside the border, with the corners cut by R4.14's rounded clip since DDB-231 (it was inset by the corner radius before), and out into the padding as far as the direct children's ink reaches (R8.8), so a focused row's ring is not cut at the edge. It reads the children's ink, which `computeClipRect` may not assume fixed, so `Component.invalidateClip()` exists and the container calls it when the ink it measured changes.

**Wheel and keys.** `canScroll` says yes while there is room in the wheel's direction; the dispatcher latches the innermost such scroller for 150 ms, and a latched container consumes even at its end (R9.32). A wheel only bubbling through, with nothing latched, is left alone. Page Up and Page Down work from anywhere inside the container; the arrows, Home, and End only when the container itself has focus, so a list or a field inside keeps its own. A page is the clip less one `scroll_step`.

**`scrollToBottom` holds to the next layout.** Content added just before the call is measured by the next layout, so the request is kept and applied there too; any other scroll cancels it. The combat log calls it after reconciling its lines, but only when the reader was already at the bottom (`atBottom`), so reading back through the log is never interrupted.

**Scrollbar input.** A press on the thumb grabs it where it was pressed and drags with the pointer captured, mapping the pointer's travel over the track's free length to the scroll range; a press on the track centres the thumb there and keeps dragging. Both consume the press and call `preventFocus`, so a press on a scrollbar never blurs a field inside (R9.23).

**Popups.** When a container's offset moves, a popup whose trigger or anchor is inside it closes with `scroll` (R3.6a allows reposition or close; the placement was made against where the anchor was, and an inline popup keeps its host's offset). A scroller inside the popup itself, a long menu, does not close it.

## Departures

- `contentHeight` is the constructor option and `scrollHeight` the accessor, since `Component` keeps a private `contentHeight` for its own box.
- R13.25.2 (child outside parent) exempts nothing, but a scroll container's content is taller than it by definition. The lint exempts the direct children of a node that carries `contentOffset` and counts them as exempt; what overflows inside the content is still judged. The old Panel's test that pinned the absence of an exemption described a structure (background and content layer under the scroller) that no longer exists.
- Horizontal and smooth scrolling are not implemented (optional in R12.20); `Scrollbar` itself works on either axis.
- The combat log keeps its hand-drawn header rather than becoming a Panel with a title; it is hidden in every golden and gets its real design in phase 6.

## What moved on screen

The developer screen and the card showcase draw a scrollbar at their right edge, since their content overflows; nothing else on them moved. The gallery gains `panels` and `scrolling`. No other golden should move.
