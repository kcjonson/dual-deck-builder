# Card face and pinnable detail view

Status: decided 2026-10-02, DDB-137 (DDB-127), with DDB-204 and DDB-172. Design source: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) sections 4 to 8 and the mock's `.card`, `.cdetail` and `.kwpanel` at `docs/design/battle-screen/index.html`.

## Context

The face was a 150x210 layout scaled to 128 in the fan, with a rarity-coloured rim, the cost as a number in the corner, the summary in one colour at 11 px, and a row of tags. The hand's preview (DDB-88) was the same component at `LARGE` with the full text, centred over the card. Section 5 asks for a 128x180 face with a cost hex, a name that shrinks and then ellipsises, art, three lines of 12 px summary with keywords in yellow, and a rarity gem; and a 250 px detail view anchored to the screen's bottom, growing to 440 px, with keyword boxes beside it, opened by hover, focus, or a touch hold and pinned by a secondary click, I, or the controller's inspect button, used in the hand, the piles, and rewards.

## Decisions

### The face is 128x180 natively

`Card` at `NORMAL` is the mock's `.card` box for box, in its own pixels from the outer edge: the hex hangs 7 px off the top-left corner (`inkExtent` says so, and the hex and its digits are the card's own draws, so no child sits outside the card for the lint), the type and driver mark top right, the name at 16 px condensed in a 112 px slot, the art strip with the driver's gradient and a placeholder glyph, the summary in 114 px, and the foot with the gem, the rarity name, and an R1 or R2 chip. The frame is the driver's colour, the neutral line when unowned; rarity is only the gem (section 7). `LARGE` and `fullText` are gone: the detail view is its own component. `HandFan`'s scale becomes 1; it stays a constant so DDB-136's dock can size the hand without laying the face out again.

Disabled dims through colours rather than opacity, since a translucent card would show the fan through it: the card's own draws darken to the mock's 0.62 and its words take `saturate(0.3) brightness(0.62)` versions of their colours. Unaffordable is separate from disabled (`Card.unaffordable`, from `PlayerHandView.unaffordable`, cost over adrenaline): a card disabled because another is being targeted dims, but only a card its driver can't pay for turns its cost dark red.

The name shrinks once, the first time the card can measure: measured at 16 against the slot, set to 14 if it doesn't fit, and the text's own ellipsis does the rest. No card today needs 14 (the widest, "Coordinated Attack+", is 111.9 of 112 px); the tests use made-up names.

### Keywords: a component that wraps its own words

The engine's text draws one colour per run. `KeywordText` cuts the text into words, and each word into keyword and plain pieces (`keywordWords`: "[Flank]s" is one word in two colours), makes each piece a hugging `Text`, and wraps them greedily on their measured widths with the face's measured space. Each piece is an ordinary text, so measurement, ink, the subtree cull, the snapshot and the lint all work unchanged. A summary marks its keywords with brackets; the full text isn't marked up, so the detail view highlights every keyword name it finds (`auto`), as the mock does. Keywords are colour only: the body role has one face, so the mock's 600 weight isn't available.

Considered: rich runs in `Text` and `drawText`. That is the better end state for the engine (R12.4 has no runs), but it touches the text layout, the metrics service, the atlas path and the snapshot for one consumer; a game component does it with what exists. If more screens want inline colour, it should move into the engine.

Considered: drawing runs from the card's own `render`. It would need its own cull ink and leave the words out of the snapshot and the text records the visual gate checks.

### The card data check measures the face as it lays out

`cards.test.ts` mounts a face and reads `Card.summaryLines`, the line count `KeywordText` lays out at 12 over 17 in 114 (`FACE_RULES`), against three. That found the three summaries DDB-204 named; their wording is tightened in `cards.json` and the Card System Design (meaning and brackets kept). A new check: every bracketed word is a keyword the boxes can explain.

### The detail view rides the tooltip service, which learns to pin

`makeInspectable(card)` sets the card's `tooltip` to a factory, as DDB-88's preview did, so hover after the delay, keyboard focus at once, and the no-delay swap between cards all come from the existing service. The factory builds a `CardInspectSurface`: the `CardInspectView` (detail view plus keyword boxes) in logical pixels inside a frame scaled to the stage, so it keeps its size relative to the hand at every viewport. `inspectLayout` centres the detail view over the card, clamps it 8 px inside the screen, and puts the keyword boxes right for driver 1 and unowned cards and left for driver 2, flipping when there's no room (the mock's rule). The placement asks the service for an `owner` anchor at the screen's bottom edge, 10 px up, side `top`, so the view rests there and grows upward. The detail view lays itself out from its measured text: the head (hex, a name on up to two lines, type and mark), the art, the full text at 15 over 21, the foot; past 440 the art shrinks to 20 first. With the engine's Open Sans the view holds about 410 characters whole, against the mock's 357 and the 330 budget, so no real card shrinks the art; the gallery shows one that does.

Pinning is new on the service: `pin(owner)`, `unpin()`, `pinned`. A pinned tooltip ignores hover, focus and presses, and goes on `unpin`, `hide`, Escape, or its owner unmounting, which is checked after each layout (an unmount always causes one) rather than by asking for a tick every frame. The Escape that lets a pin go is consumed, so one press peels one layer (a pin, then the dialog or the target choice beneath it); a plain tooltip still lets Escape through. A modal opening over a pinned owner sets the pin aside, R3.6a's rule for popups applied to a pin, so the view never sits over a dialog and the dialog's own cards can open theirs; the pin comes back, if its owner is still mounted, once no modal is open. `unpin` re-derives the hovered owner, so the card under the pointer shows its view again without the pointer leaving and returning.

One tooltip at a time is kept: while a pin is up, hovering an intent disc or the tab shows nothing. Holding the pinned surface apart from the hover one would fix that and is DDB-263. `pin` builds the content again, so the foot can say PINNED. `TooltipSpec.pinnable` keeps the view up through a secondary press on its owner, so a right-click doesn't blink it before the pin on release.

Input: R9.30 already synthesises `contextmenu` for a secondary click and for a 500 ms touch hold under the drag threshold, and a hold produces no click. In combat a secondary press anywhere in the hand cancels a drag or a click-then-target choice first (section 6), and that press pins nothing; a pin is refused while a choice is live. `inspectOnContextMenu(container)` handles both on the container rather than the card, because delivery skips a disabled card and an unaffordable one must still be readable: a touch hold shows the view, a mouse right-click toggles the pin (refused mid-drag in combat, where the secondary button cancels). I is a hotkey on the combat screen, the card browser, and the pile dialog: it pins the card whose view is showing, or the focused card, or lets a pinned one go. There is no controller input yet; `inspectHotkey` is what its inspect button should call.

Considered: a separate pinned overlay beside the tooltip. Two code paths for one view, and the hover tooltip would have to be suppressed while it was up.

Considered: anchoring above the card, as the preview did. Section 5 anchors to the bottom so the view never jumps with the card's position in the fan, and so a pinned view reads like a panel.

### The same view in the piles and rewards

`CardPileView` is a titled wrap of inspectable, focusable faces with an optional `onPick`, which is the reward screen's card row. Combat opens a driver's draw and discard piles in a dialog from a click on their tab (`openPileDialog`; the draw pile in name order so it gives nothing away). The card browser's cards are inspectable too. There is no reward screen yet; the gallery's `card-reward` scene is the row it will use.

### DDB-172 is already gone; the lift is explicit

`Card.updateVisuals`' y-multiple-of-10 nudge went with DDB-82's move onto the tree (1c2b111): the lift became the transform, so layout owns the card's position. DDB-88 made the resting pose (`fanPose`) and the lifted one (`LIFTED_TRANSFORM`) explicit and blended between them. DDB-124's replay of the visuals pass after a resize went with the old hand layer; nothing in the hand reruns anything on resize now, and the face tests hold a card at y 25 through hover and selection.

## Consequences

- Every golden with a card face moves: the combat screen, the card browser, driver selection's mini cards, and the developer screen's scroll thumb (new sections). Seven new scenes, one state each so every one fits a 1024x600 capture: `card-faces` (owners, unaffordable, a name shrunk and one cut), `card-detail` (keyword boxes right), `card-detail-pinned` (pinned, boxes flipped left), `card-detail-cap` (the art shrunk at 440), and the gallery-only `card-pile-draw`, `card-pile-discard` and `card-reward`, each with a detail view pinned through the tooltip service. All seven are in the layout lint gate at 1440x882 and at 1024x600 (`SHORT_SCENE_SCENARIOS`), since the view is placed against the viewport.
- Every draw the face and the detail view make is built once (in the constructor, or in layout where the view places it) and recoloured in place on a state change, so a frame allocates nothing.
- The hand still deals every element again on each change, so a pin on a hand card lasts until the next deal (a card played, a draw). DDB-136's move to `reconcileChildren` keeps the element and with it the pin.
- Section 6's "the vehicle the card acts from lights up in its driver colour" while inspecting is left for the road (DDB-134/135), which has the slot tokens to light.
- The art is a placeholder glyph per card kind until cards have art.
